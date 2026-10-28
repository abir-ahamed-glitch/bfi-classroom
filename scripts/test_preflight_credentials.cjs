#!/usr/bin/env node
/**
 * scripts/test_preflight_credentials.cjs
 *
 * Automated Regression Test Suite for Production Credential Preflight Handling.
 *
 * Invariants Enforced:
 * 1. Explicit authentication failures (HTTP 401/403/invalid role) must be rejected immediately
 *    and NEVER masked by subsequent network errors or timeouts.
 * 2. Confirmed service downtime (ECONNREFUSED on port 3001) is strictly distinguished from
 *    ambiguous connection failures (ETIMEDOUT, ECONNRESET, HTTP 5xx). Ambiguity must fail closed.
 * 3. Finite numeric expiry claim (typeof exp === 'number' && Number.isFinite(exp)) is mandatory
 *    for unattended tokens, with an explicit 15m (900s) maintenance duration buffer.
 * 4. Zero service-stop commands (nginx or pm2) are executed when credentials fail preflight.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const jwt = require('jsonwebtoken');

const {
  validateTokenPair,
  verifyTokensAgainstLiveServer,
  executeDeployment
} = require('./production_lifecycle.cjs');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeToken(payload) {
  // Use a base64url encoded mock JWT
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('mock_signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 1: validateTokenPair (Syntax, Expiry, Role Invariants)
// ─────────────────────────────────────────────────────────────────────────────

async function testValidateTokenPair() {
  const nowSec = Math.floor(Date.now() / 1000);

  // 1.1 Missing or non-numeric exp claim
  {
    const tokenNoExp = makeToken({ id: 1, role: 'admin', is_super_admin: 1 });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenNoExp, tokenValidOa, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /lacks a valid finite numeric 'exp' expiration claim/);
  }

  // 1.2 String exp claim (e.g. "1730000000")
  {
    const tokenStringExp = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: String(nowSec + 1200) });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenStringExp, tokenValidOa, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /lacks a valid finite numeric 'exp' expiration claim/);
  }

  // 1.3 NaN or Infinity exp claim
  {
    const tokenNanExp = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: null });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenNanExp, tokenValidOa, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /lacks a valid finite numeric 'exp' expiration claim/);
  }

  // 1.4 Token expiring in 5 minutes (300s) < 15m (900s) maintenance buffer
  {
    const token5mExp = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 300 });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(token5mExp, tokenValidOa, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /insufficient for the 15m deployment maintenance duration buffer/);
  }

  // 1.5 Token already expired
  {
    const tokenExpired = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec - 60 });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenExpired, tokenValidOa, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /has already expired/);
  }

  // 1.6 Super admin without super admin privileges
  {
    const tokenNotSuper = makeToken({ id: 1, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenNotSuper, tokenValidOa, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /does not assert super admin privileges/);
  }

  // 1.7 Ordinary admin asserting super admin privileges
  {
    const tokenValidSa = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
    const tokenOaIsSuper = makeToken({ id: 2, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenValidSa, tokenOaIsSuper, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /incorrectly asserts super admin privileges/);
  }

  // 1.8 Tokens belong to same user ID
  {
    const tokenValidSa = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
    const tokenOaSameId = makeToken({ id: 1, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenValidSa, tokenOaSameId, 'test');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /belong to the same account ID/);
  }

  // 1.9 Valid token pair with 20 minutes remaining
  {
    const tokenValidSa = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
    const tokenValidOa = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });
    const res = validateTokenPair(tokenValidSa, tokenValidOa, 'test');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.saPayload.id, 1);
    assert.strictEqual(res.oaPayload.id, 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 2: verifyTokensAgainstLiveServer (HTTP Responses & Error Handling)
// ─────────────────────────────────────────────────────────────────────────────

async function testVerifyTokensAgainstLiveServer() {
  const nowSec = Math.floor(Date.now() / 1000);
  const saToken = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
  const oaToken = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });

  // 2.1 Explicit failure: Super Admin HTTP 401, OA times out
  // Must preserve HTTP 401 immediately and NOT be masked by OA timeout!
  {
    const server = http.createServer((req, res) => {
      const auth = req.headers['authorization'] || '';
      if (auth.includes(saToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or revoked token' }));
      } else {
        // Deliberately do not respond, causing timeout
      }
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${port}`, 200);
      assert.strictEqual(check.status, 'auth_failure');
      assert.strictEqual(check.explicitAuthFailure, true);
      assert.match(check.reason, /Super Admin token rejected by server/);
      assert.match(check.reason, /Invalid or revoked token/);
    } finally {
      server.close();
    }
  }

  // 2.2 Explicit failure: Super Admin 200, Ordinary Admin 403
  {
    const server = http.createServer((req, res) => {
      const auth = req.headers['authorization'] || '';
      if (auth.includes(saToken)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 1, role: 'admin', is_super_admin: 1 }));
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Administrative role required' }));
      }
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${port}`, 200);
      assert.strictEqual(check.status, 'auth_failure');
      assert.strictEqual(check.explicitAuthFailure, true);
      assert.match(check.reason, /Ordinary Admin token rejected by server/);
    } finally {
      server.close();
    }
  }

  // 2.3 Explicit failure: Super Admin lacks super_admin privilege on server
  {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 1, role: 'admin', is_super_admin: 0 }));
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${port}`, 200);
      assert.strictEqual(check.status, 'auth_failure');
      assert.match(check.reason, /lacks verified super admin privileges on server/);
    } finally {
      server.close();
    }
  }

  // 2.4 Confirmed offline: port is closed (ECONNREFUSED)
  {
    // Find an unused port
    const probeServer = http.createServer();
    await new Promise(r => probeServer.listen(0, '127.0.0.1', r));
    const unusedPort = probeServer.address().port;
    await new Promise(r => probeServer.close(r));

    const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${unusedPort}`, 200);
    assert.strictEqual(check.status, 'confirmed_offline');
    assert.match(check.reason, /connection refused/);
  }

  // 2.5 Ambiguous connection failure: server hangs / times out
  {
    const server = http.createServer((req, res) => {
      // Never respond
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${port}`, 100);
      assert.strictEqual(check.status, 'ambiguous_failure');
      assert.strictEqual(check.isAmbiguous, true);
      assert.match(check.reason, /Ambiguous connection failure/);
    } finally {
      server.close();
    }
  }

  // 2.6 Ambiguous connection failure: server returns HTTP 500
  {
    const server = http.createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${port}`, 200);
      assert.strictEqual(check.status, 'ambiguous_failure');
      assert.strictEqual(check.isAmbiguous, true);
    } finally {
      server.close();
    }
  }

  // 2.7 Authenticated success: both return HTTP 200 with valid roles
  {
    const server = http.createServer((req, res) => {
      const auth = req.headers['authorization'] || '';
      if (auth.includes(saToken)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 1, role: 'admin', is_super_admin: 1 }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 2, role: 'admin', is_super_admin: 0 }));
      }
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const check = await verifyTokensAgainstLiveServer(saToken, oaToken, `http://127.0.0.1:${port}`, 200);
      assert.strictEqual(check.status, 'authenticated');
      assert.strictEqual(check.superAdmin.id, 1);
      assert.strictEqual(check.ordinaryAdmin.id, 2);
    } finally {
      server.close();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 3: executeDeployment Invariant (Zero Service Stop on Preflight Failures)
// ─────────────────────────────────────────────────────────────────────────────

function createTrackingSpawner() {
  const executedCommands = [];
  const spawner = (cmd, args = [], spawnOpts = {}) => {
    const cmdStr = `${cmd} ${args.join(' ')}`.trim();
    executedCommands.push({ cmd, args, cmdStr });

    // Mock git rev-parse HEAD
    if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { status: 0, stdout: '0c71163495e58a51f1709272ec55d99a31251ec3\n', stderr: '', error: null };
    }

    // Default mock success
    return { status: 0, stdout: '', stderr: '', error: null };
  };

  return { spawner, executedCommands };
}

async function testDeploymentPreflightSafety() {
  const nowSec = Math.floor(Date.now() / 1000);
  const tempDir = path.join(__dirname, '..', 'test_preflight_env_' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'server'), { recursive: true });

  const dummyCommit = '0c71163495e58a51f1709272ec55d99a31251ec3';

  try {
    // 3.1 Preflight Failure: Super Admin HTTP 401 on live server
    // Asserts: Throws error AND executes ZERO service-stop commands
    {
      const saToken = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
      const oaToken = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });

      const server = http.createServer((req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token revoked' }));
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;

      const { spawner, executedCommands } = createTrackingSpawner();

      let threw = false;
      try {
        await executeDeployment({
          spawner,
          rootDir: tempDir,
          targetCommit: dummyCommit,
          superAdminToken: saToken,
          adminToken: oaToken,
          baseUrl: `http://127.0.0.1:${port}`,
          tokenPreflightTimeoutMs: 200
        });
      } catch (err) {
        threw = true;
        assert.match(err.message, /Pre-disruption token verification failed/);
      } finally {
        server.close();
      }

      assert.strictEqual(threw, true, 'Deployment should have aborted');
      const stopCmds = executedCommands.filter(c => c.cmdStr.includes('stop') || c.cmdStr.includes('delete'));
      assert.strictEqual(stopCmds.length, 0, `Expected 0 service-stop commands, but got ${stopCmds.length}: ${JSON.stringify(stopCmds)}`);
    }

    // 3.2 Preflight Failure: Ambiguous timeout on live server
    // Asserts: Throws error AND executes ZERO service-stop commands
    {
      const saToken = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
      const oaToken = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });

      const server = http.createServer((req, res) => {
        // Hang indefinitely
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;

      const { spawner, executedCommands } = createTrackingSpawner();

      let threw = false;
      try {
        await executeDeployment({
          spawner,
          rootDir: tempDir,
          targetCommit: dummyCommit,
          superAdminToken: saToken,
          adminToken: oaToken,
          baseUrl: `http://127.0.0.1:${port}`,
          tokenPreflightTimeoutMs: 200
        });
      } catch (err) {
        threw = true;
        assert.match(err.message, /Pre-disruption credential check ambiguous/);
      } finally {
        server.close();
      }

      assert.strictEqual(threw, true, 'Deployment should have aborted');
      const stopCmds = executedCommands.filter(c => c.cmdStr.includes('stop') || c.cmdStr.includes('delete'));
      assert.strictEqual(stopCmds.length, 0, `Expected 0 service-stop commands, but got ${stopCmds.length}: ${JSON.stringify(stopCmds)}`);
    }

    // 3.3 Preflight Failure: Token without finite numeric exp
    // Asserts: Throws error AND executes ZERO service-stop commands
    {
      const saTokenNoExp = makeToken({ id: 1, role: 'admin', is_super_admin: 1 });
      const oaToken = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });

      const { spawner, executedCommands } = createTrackingSpawner();

      let threw = false;
      try {
        await executeDeployment({
          spawner,
          rootDir: tempDir,
          targetCommit: dummyCommit,
          superAdminToken: saTokenNoExp,
          adminToken: oaToken
        });
      } catch (err) {
        threw = true;
        assert.match(err.message, /lacks a valid finite numeric 'exp' expiration claim/);
      }

      assert.strictEqual(threw, true, 'Deployment should have aborted');
      const stopCmds = executedCommands.filter(c => c.cmdStr.includes('stop') || c.cmdStr.includes('delete'));
      assert.strictEqual(stopCmds.length, 0, `Expected 0 service-stop commands, but got: ${JSON.stringify(stopCmds)}`);
    }

    // 3.4 Preflight Failure: Short expiration token (<15m buffer)
    // Asserts: Throws error AND executes ZERO service-stop commands
    {
      const saTokenShort = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 300 });
      const oaToken = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });

      const { spawner, executedCommands } = createTrackingSpawner();

      let threw = false;
      try {
        await executeDeployment({
          spawner,
          rootDir: tempDir,
          targetCommit: dummyCommit,
          superAdminToken: saTokenShort,
          adminToken: oaToken
        });
      } catch (err) {
        threw = true;
        assert.match(err.message, /insufficient for the 15m deployment maintenance duration buffer/);
      }

      assert.strictEqual(threw, true, 'Deployment should have aborted');
      const stopCmds = executedCommands.filter(c => c.cmdStr.includes('stop') || c.cmdStr.includes('delete'));
      assert.strictEqual(stopCmds.length, 0, `Expected 0 service-stop commands, but got: ${JSON.stringify(stopCmds)}`);
    }

    // 3.5 Preflight Failure: Nonexistent token file
    // Asserts: Throws error AND executes ZERO service-stop commands
    {
      const { spawner, executedCommands } = createTrackingSpawner();

      let threw = false;
      try {
        await executeDeployment({
          spawner,
          rootDir: tempDir,
          targetCommit: dummyCommit,
          superAdminTokenFile: path.join(tempDir, 'nonexistent_sa.token'),
          adminTokenFile: path.join(tempDir, 'nonexistent_oa.token')
        });
      } catch (err) {
        threw = true;
        assert.match(err.message, /Configured smoke token file missing on disk/);
      }

      assert.strictEqual(threw, true, 'Deployment should have aborted');
      const stopCmds = executedCommands.filter(c => c.cmdStr.includes('stop') || c.cmdStr.includes('delete'));
      assert.strictEqual(stopCmds.length, 0, `Expected 0 service-stop commands, but got: ${JSON.stringify(stopCmds)}`);
    }

    // 3.6 Confirmed ECONNREFUSED on port 3001 allows pre-validation to proceed
    // Asserts: Does NOT abort in Phase 0; proceeds to git show / recovery tooling extraction
    {
      const probeServer = http.createServer();
      await new Promise(r => probeServer.listen(0, '127.0.0.1', r));
      const closedPort = probeServer.address().port;
      await new Promise(r => probeServer.close(r));

      const saToken = makeToken({ id: 1, role: 'admin', is_super_admin: 1, exp: nowSec + 1200 });
      const oaToken = makeToken({ id: 2, role: 'admin', is_super_admin: 0, exp: nowSec + 1200 });

      const { spawner, executedCommands } = createTrackingSpawner();

      // Deliberately halt during tool extraction to verify Phase 0.1 passed without stopping services
      let phase0Passed = false;
      try {
        await executeDeployment({
          spawner,
          rootDir: tempDir,
          targetCommit: dummyCommit,
          superAdminToken: saToken,
          adminToken: oaToken,
          baseUrl: `http://127.0.0.1:${closedPort}`,
          tokenPreflightTimeoutMs: 200
        });
      } catch (err) {
        // Will throw at git show since dummy commit has no tools
        if (err.message.includes('Failed to extract') || err.message.includes('Recovery tool bundle failed')) {
          phase0Passed = true;
        }
      }

      assert.strictEqual(phase0Passed, true, 'Deployment should have passed token preflight and proceeded to extraction');
      const stopCmds = executedCommands.filter(c => c.cmdStr.includes('stop') || c.cmdStr.includes('delete'));
      assert.strictEqual(stopCmds.length, 0, 'No service stop commands should be executed during preflight/staging');
    }
  } finally {
    if (fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('================================================================');
  console.log('CREDENTIAL PREFLIGHT & ZERO-SERVICE-STOP REGRESSION SUITE');
  console.log('================================================================\n');

  await runTest('validateTokenPair syntax, finite numeric exp, & role guards', testValidateTokenPair);
  await runTest('verifyTokensAgainstLiveServer failure preservation & ambiguity', testVerifyTokensAgainstLiveServer);
  await runTest('executeDeployment zero service-stop commands on preflight failure', testDeploymentPreflightSafety);

  console.log(`\n================================================================`);
  console.log(`Preflight Regression Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Test harness exception:', err);
    process.exit(1);
  });
}
