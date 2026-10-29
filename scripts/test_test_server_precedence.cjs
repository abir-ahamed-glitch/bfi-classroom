#!/usr/bin/env node
/**
 * scripts/test_test_server_precedence.cjs
 *
 * Regression test for server/bootstrap.js configuration precedence:
 * 1. Spawns actual server/test-server.js entry point with conflicting default configuration
 *    (PORT=3001, NODE_ENV=development, DATABASE_PATH=server/bfi_classroom.db).
 * 2. Verifies effective database identity, test mode, listening address, and port via
 *    live HTTP endpoint /api/test/db-identity.
 * 3. Asserts isolated test sentinels are strictly preserved and never replaced by
 *    default production/development .env configuration.
 * 4. Exercises independent reviewer's exact reproduction probe: setting test sentinels
 *    before importing server/bootstrap.js directly.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json !== null ? json : data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServerReady(port, path = '/api/test/db-identity', maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        timeout: 2000
      });
      if (res.status === 200) {
        return res;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server failed to respond with 200 on port ${port} at ${path} within ${maxWaitMs}ms`);
}

async function runRegressionSuite() {
  console.log('================================================================');
  console.log('START: TEST-SERVER CONFIGURATION PRECEDENCE REGRESSION SUITE');
  console.log('================================================================\n');

  const projectRoot = path.resolve(__dirname, '..');
  const testServerPath = path.join(projectRoot, 'server', 'test-server.js');
  const isolatedDbPath = path.join(projectRoot, 'server', 'test_isolated_bfi.db');

  // Clean any leftover isolated test db from previous runs
  try {
    if (fs.existsSync(isolatedDbPath)) fs.unlinkSync(isolatedDbPath);
  } catch {}

  // ── TEST PART 1: Reviewer Reproduction Probe (Direct Bootstrap Import) ──────
  console.log('--- [Part 1] Independent Reviewer Direct Bootstrap Probe ---');
  const probeScript = `
    import path from 'path';
    import { fileURLToPath } from 'url';

    process.env.PORT = '3099';
    process.env.NODE_ENV = 'test';
    process.env.IS_TEST_SERVER = 'true';
    process.env.DATABASE_PATH = 'isolated-test-sentinel.db';

    await import('./server/bootstrap.js');

    const result = {
      port: process.env.PORT,
      nodeEnv: process.env.NODE_ENV,
      isTestServer: process.env.IS_TEST_SERVER,
      databasePath: process.env.DATABASE_PATH,
      hasJwtSecret: Boolean(process.env.JWT_SECRET)
    };

    console.log(JSON.stringify(result));
  `;

  const probeRes = child_process.spawnSync(process.execPath, ['--input-type=module', '-e', probeScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env }
  });

  assert(probeRes.status === 0, `Probe child process exited cleanly (exit code ${probeRes.status})`);

  let probeData = {};
  try {
    probeData = JSON.parse(probeRes.stdout.trim().split('\n').pop());
  } catch (e) {
    console.error('Failed to parse probe output:', probeRes.stdout, probeRes.stderr);
  }

  assert(probeData.port === '3099', `Probe port preserved as 3099 (got ${probeData.port}, not overwritten by .env 3001)`);
  assert(probeData.nodeEnv === 'test', `Probe NODE_ENV preserved as 'test' (got ${probeData.nodeEnv}, not overwritten by .env development)`);
  assert(probeData.isTestServer === 'true', `Probe IS_TEST_SERVER preserved as 'true' (got ${probeData.isTestServer})`);
  assert(probeData.databasePath === 'isolated-test-sentinel.db', `Probe DATABASE_PATH preserved as sentinel (got ${probeData.databasePath})`);
  assert(probeData.hasJwtSecret === true, 'Probe populated missing JWT_SECRET from .env without clobbering sentinels');

  // ── TEST PART 2: Actual server/test-server.js with Conflicting Default Config ──
  console.log('\n--- [Part 2] Actual server/test-server.js with Conflicting Default Config ---');

  const conflictingDefaultEnv = {
    ...process.env,
    PORT: '3001',                             // Conflicting default dev/prod port
    NODE_ENV: 'development',                   // Conflicting default dev environment
    DATABASE_PATH: 'server/bfi_classroom.db',  // Conflicting production database path
    IS_TEST_SERVER: 'false',                   // Conflicting flag in parent env
    DISABLE_OUTBOUND_NOTIFICATIONS: 'true',
    ALLOW_WINDOWS_DEV_PREFLIGHT: 'true'
  };

  const childServer = child_process.spawn(process.execPath, [testServerPath], {
    cwd: projectRoot,
    env: conflictingDefaultEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverStderr = '';
  childServer.stderr.on('data', d => {
    serverStderr += d.toString();
  });

  try {
    console.log('   Waiting for isolated test server to respond on port 3099...');
    const identityRes = await waitForServerReady(3099, '/api/test/db-identity', 15000);

    assert(identityRes.status === 200, 'Test server /api/test/db-identity responded with HTTP 200 OK');
    const body = identityRes.body;

    assert(body.status === 'ok', "Identity check reports status: 'ok'");
    assert(body.port === 3099, `Effective listening port is 3099 (got ${body.port}, conflicting default 3001 discarded)`);
    assert(body.isTestServer === true, 'Effective isTestServer is strictly true');
    assert(body.nodeEnv === 'test', `Effective nodeEnv is 'test' (got '${body.nodeEnv}', conflicting 'development' discarded)`);
    assert(body.isIsolatedTestDb === true, 'Effective database is strictly isolated test db (isIsolatedTestDb=true)');
    assert(body.isProductionDb === false, 'Production database is strictly NOT mounted (isProductionDb=false)');
    assert(body.dbPath === 'test_isolated_bfi.db', `Effective database file is 'test_isolated_bfi.db' (got '${body.dbPath}')`);

    // Verify port 3001 is NOT serving this test server
    let port3001HandledByUs = false;
    try {
      const check3001 = await httpRequest({
        hostname: '127.0.0.1',
        port: 3001,
        path: '/api/test/db-identity',
        method: 'GET',
        timeout: 1000
      });
      // If 3001 is open and returned this specific test db, that's a failure
      if (check3001.status === 200 && check3001.body && check3001.body.dbPath === 'test_isolated_bfi.db') {
        port3001HandledByUs = true;
      }
    } catch {
      // Expected: connection refused on 3001
    }
    assert(port3001HandledByUs === false, 'Test server did NOT bind to conflicting port 3001');

  } finally {
    console.log('   Stopping isolated test server...');
    childServer.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));
    try {
      if (fs.existsSync(isolatedDbPath)) fs.unlinkSync(isolatedDbPath);
    } catch {}
  }

  // ── TEST SUMMARY ────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`TEST RUN COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch(err => {
  console.error('Fatal regression suite error:', err);
  process.exit(1);
});
