const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const Database = require('better-sqlite3');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-zoom-gateway-'));
  const dbPath = path.join(root, 'gateway.db');
  const envPath = path.join(root, '.env.staging');
  const secret = 'dedicated-gateway-fixture-secret';
  const inheritedSecret = 'inherited-gateway-fixture-secret';
  const port = 48813;
  const base = `http://127.0.0.1:${port}`;
  const classroom = 'https://classroom-staging.example.test';
  const embed = 'https://zoom-staging.example.net';
  let child, exited, db;
  let logs = '';
  try {
    fs.writeFileSync(envPath, [
      `DATABASE_PATH="${dbPath.replaceAll('\\', '/')}"`,
      `STAGING_DATA_DIR="${root.replaceAll('\\', '/')}"`,
      `PORT=${port}`, 'HOST=127.0.0.1',
      `JWT_SECRET=${'s'.repeat(64)}`, `JWT_REFRESH_SECRET=${'r'.repeat(64)}`, `MFA_ENCRYPTION_KEY=${'a'.repeat(64)}`,
      'ZOOM_EMBED_ENABLED=true', `ZOOM_PARENT_ORIGIN=${classroom}`, `ZOOM_EMBED_ORIGIN=${embed}`,
      'ZOOM_WEBHOOK_ENABLED=true', `ZOOM_WEBHOOK_SECRET=${secret}`, 'ZOOM_ACCOUNT_ID=staging-test-account'
    ].join('\n'));
    child = spawn(process.execPath, ['server/staging-server.js'], {
      cwd: path.resolve(__dirname, '..'), windowsHide: true,
      env: {SystemRoot: process.env.SystemRoot, Path: process.env.Path, TEMP: process.env.TEMP,
        STAGING_ENV_FILE: envPath, ZOOM_WEBHOOK_SECRET: inheritedSecret,
        ZOOM_AUTO_ATTENDANCE_ENABLED: 'true', ZOOM_AUTO_ATTENDANCE_FROM: '2026-01-01'}
    });
    exited = new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs += data; });
    const marker = `BFI Classroom API Gateway running on port ${port}`;
    for (let attempt = 0; !logs.includes(marker) && child.exitCode === null && attempt < 150; attempt++) await delay(200);
    assert.ok(logs.includes(marker), 'Guarded gateway did not start on the test port:\n' +
      logs.replaceAll(secret, '[redacted]').replaceAll(inheritedSecret, '[redacted]').slice(-1600));
    const health = await fetch(base + '/api/health', {signal: AbortSignal.timeout(5000)});
    assert.equal(health.status, 200);
    const frameSrc = health.headers.get('content-security-policy').split(';').find(item => item.trim().startsWith('frame-src'));
    assert.ok(frameSrc.split(/\s+/).includes(embed));

    const body = JSON.stringify({event:'endpoint.url_validation', payload:{plainToken:'staging-endpoint-challenge'}});
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = key => ({
      method:'POST', body, signal:AbortSignal.timeout(5000), headers:{
        'content-type':'application/json', 'x-zm-request-timestamp':timestamp,
        'x-zm-signature':'v0=' + crypto.createHmac('sha256', key).update(`v0:${timestamp}:${body}`).digest('hex')
      }
    });
    for (const route of ['/api/zoom-webhook', '/bfi-classroom/api/zoom-webhook']) {
      assert.equal((await fetch(base + route, signed(inheritedSecret))).status, 401);
      const response = await fetch(base + route, signed(secret));
      assert.equal(response.status, 200, await response.clone().text());
      const digest = crypto.createHmac('sha256', secret).update('staging-endpoint-challenge').digest('hex');
      assert.equal((await response.json()).encryptedToken, digest);
    }
    db = new Database(dbPath, {readonly:true, fileMustExist:true});
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM zoom_event_receipts').get().n, 0);
    console.log('PASS: guarded production-mode gateway, staging CSP, both Zoom challenge routes and inherited-secret rejection');
  } finally {
    if (db) db.close();
    if (child && child.exitCode === null) child.kill();
    if (exited) await exited;
    for (const name of ['.env.staging', 'gateway.db', 'gateway.db-wal', 'gateway.db-shm']) fs.rmSync(path.join(root, name), {force:true});
    fs.rmdirSync(root);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
