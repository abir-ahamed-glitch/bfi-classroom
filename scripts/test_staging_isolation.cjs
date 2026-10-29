/**
 * Regression Suite: Staging Environment Isolation & Validation
 * Verifies that staging configuration rejects unsafe/production settings,
 * initializes the database explicitly, and enforces loopback-only binding.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const assert = require('assert');
const { loadAndValidateStagingEnv, validateStagingConfig } = require('./staging_guard.cjs');
const { initStagingDb } = require('./init_staging_db.cjs');

const DISPOSABLE_DIR = path.resolve(__dirname, '../tests/fixtures/staging-disposable');
const DISPOSABLE_ENV = path.join(DISPOSABLE_DIR, '.env.staging');
const DISPOSABLE_DB = path.join(DISPOSABLE_DIR, 'staging_classroom.db');

function cleanup() {
  if (fs.existsSync(DISPOSABLE_DIR)) {
    fs.rmSync(DISPOSABLE_DIR, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('STAGING ENVIRONMENT ISOLATION & VALIDATION SUITE');
  console.log('================================================================\n');

  cleanup();
  fs.mkdirSync(DISPOSABLE_DIR, { recursive: true });

  let passed = 0;
  const total = 7;

  // Test 1: Rejection when DATABASE_PATH points to production database
  process.stdout.write('Testing: Rejection of production database path... ');
  try {
    process.env.DATABASE_PATH = path.resolve(__dirname, '../server/bfi_classroom.db');
    process.env.PORT = '3002';
    process.env.HOST = '127.0.0.1';
    validateStagingConfig();
    assert.fail('Should have rejected production DATABASE_PATH');
  } catch (err) {
    assert(err.message.includes('SAFETY REJECTION'), `Expected SAFETY REJECTION error, got: ${err.message}`);
    console.log('✅ PASS');
    passed++;
  }

  // Test 2: Rejection of production port (3001)
  process.stdout.write('Testing: Rejection of production port 3001... ');
  try {
    process.env.DATABASE_PATH = DISPOSABLE_DB;
    process.env.PORT = '3001';
    process.env.HOST = '127.0.0.1';
    validateStagingConfig();
    assert.fail('Should have rejected production port 3001');
  } catch (err) {
    assert(err.message.includes('Port must be set to an isolated non-production port'), `Unexpected error: ${err.message}`);
    console.log('✅ PASS');
    passed++;
  }

  // Test 3: Rejection of non-loopback host (0.0.0.0 or missing)
  process.stdout.write('Testing: Rejection of non-loopback HOST (0.0.0.0)... ');
  try {
    process.env.DATABASE_PATH = DISPOSABLE_DB;
    process.env.PORT = '3002';
    process.env.HOST = '0.0.0.0';
    validateStagingConfig();
    assert.fail('Should have rejected 0.0.0.0 HOST');
  } catch (err) {
    assert(err.message.includes('HOST must be strictly set to \'127.0.0.1\''), `Unexpected error: ${err.message}`);
    console.log('✅ PASS');
    passed++;
  }

  // Test 4: Explicit loading of .env.staging file
  process.stdout.write('Testing: Explicit loading of .env.staging file... ');
  const validStagingContent = [
    `DATABASE_PATH=${DISPOSABLE_DB}`,
    'PORT=3002',
    'HOST=127.0.0.1',
    'JWT_SECRET=staging_super_secret_jwt_key_minimum_length_for_hmac_sha256_hash_1234567890',
    'JWT_REFRESH_SECRET=staging_super_secret_refresh_jwt_key_minimum_length_for_hmac_1234567890',
    'MFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'PREVIOUS_MFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'EMAIL_USER=',
    'EMAIL_PASS=',
    'SMS_API_KEY='
  ].join('\n');
  fs.writeFileSync(DISPOSABLE_ENV, validStagingContent);

  delete process.env.DATABASE_PATH;
  delete process.env.PORT;
  delete process.env.HOST;

  const loadedConfig = loadAndValidateStagingEnv(DISPOSABLE_ENV);
  assert.strictEqual(loadedConfig.port, 3002);
  assert.strictEqual(loadedConfig.host, '127.0.0.1');
  assert.strictEqual(loadedConfig.databasePath, path.resolve(DISPOSABLE_DB));
  console.log('✅ PASS');
  passed++;

  // Test 5: Explicit database initialization and schema verification in child process
  process.stdout.write('Testing: Staging DB initialization and schema verification... ');
  const initProc = spawnSync('node', ['scripts/init_staging_db.cjs', DISPOSABLE_ENV], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.strictEqual(initProc.status, 0, `Init script failed with status ${initProc.status}: ${initProc.stderr}`);
  assert(fs.existsSync(DISPOSABLE_DB), 'Staging database file was not created');
  console.log('✅ PASS');
  passed++;

  // Test 6: Staging server starts on loopback and serves healthcheck and frontend
  process.stdout.write('Testing: Staging server starts on 127.0.0.1:3002 and serves frontend & API... ');
  const serverProcess = spawn('node', ['server/staging-server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      STAGING_ENV_FILE: DISPOSABLE_ENV,
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverStarted = false;
  serverProcess.stdout.on('data', data => {
    const text = data.toString();
    if (text.includes('BFI Classroom API Gateway running on port 3002')) {
      serverStarted = true;
    }
  });

  // Wait for server to bind
  const deadline = Date.now() + 15000;
  while (!serverStarted && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
  }
  assert(serverStarted, 'Staging server failed to start on 127.0.0.1:3002 within timeout');

  // Verify API routing probe: POST /api/auth/login with empty body returns HTTP 400
  const loginProbe = await fetch('http://127.0.0.1:3002/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.strictEqual(loginProbe.status, 400, `Expected 400 from login probe, got ${loginProbe.status}`);

  // Verify auth guard probe: GET /api/auth/me without token returns HTTP 401
  const authProbe = await fetch('http://127.0.0.1:3002/api/auth/me');
  assert.strictEqual(authProbe.status, 401, `Expected 401 from auth probe, got ${authProbe.status}`);

  // Verify frontend SPA fallback on /bfi-classroom/
  const spaRes = await fetch('http://127.0.0.1:3002/bfi-classroom/');
  assert.strictEqual(spaRes.status, 200, `Expected 200 from SPA route, got ${spaRes.status}`);
  const spaHtml = await spaRes.text();
  assert(spaHtml.includes('<!DOCTYPE html>') || spaHtml.includes('<html'), 'Expected HTML output for SPA');
  console.log('✅ PASS');
  passed++;

  // Test 7: Clean process shutdown
  process.stdout.write('Testing: Clean staging server process shutdown... ');
  serverProcess.kill('SIGTERM');
  await new Promise(r => serverProcess.on('exit', r));
  console.log('✅ PASS');
  passed++;

  cleanup();

  console.log('\n================================================================');
  console.log(`Staging Isolation Results: ${passed}/${total} Passed`);
  console.log('================================================================');
  if (passed !== total) process.exit(1);
}

runTests().catch(err => {
  console.error('\n[StagingIsolationTest] FAILED:', err);
  try { cleanup(); } catch (_) {}
  process.exit(1);
});
