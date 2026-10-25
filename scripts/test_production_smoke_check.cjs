#!/usr/bin/env node
/**
 * scripts/test_production_smoke_check.cjs
 *
 * Comprehensive CLI test suite for scripts/production_smoke_check.cjs.
 * 
 * Verifies:
 * 1. Neither credential supplied -> Exits 1 (FATAL PRE-CHECK ERROR)
 * 2. Either credential missing or empty -> Exits 1 (FATAL PRE-CHECK ERROR)
 * 3. Both credentials supplied, with all required tiers passing -> Exits 0 (Deployment gate cleared)
 * 4. Protected endpoints returning unexpected statuses -> Exits 1
 * 5. Protected endpoints returning malformed JSON -> Exits 1
 * 6. Connection failure (ECONNREFUSED) -> Exits 1
 * 7. Request timeout -> Exits 1
 * 8. Credential protection -> Sensitive tokens are NEVER printed
 * 9. Partial diagnostics (--diagnostics) -> Exits 0 for troubleshooting without granting deployment approval
 */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT_PATH = path.resolve(__dirname, 'production_smoke_check.cjs');

// Helper to run CLI process asynchronously with timeout and captured IO
function runCli(args = [], env = {}, timeout = 10000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? -1 : code,
        signal,
        timedOut,
        stdout,
        stderr
      });
    });
  });
}

// Configurable mock HTTP server
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

// Default standard mock server handler returning valid responses for all tiers
function standardHandler(req, res) {
  const url = req.url;
  const auth = req.headers['authorization'] || '';

  // Tier 1: Static SPA HTML shell
  if (req.method === 'GET' && url === '/bfi-classroom/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<!DOCTYPE html><html><body><div id="root">App</div></body></html>');
  }

  // Tier 2: Unauthenticated POST /api/auth/login
  if (req.method === 'POST' && url === '/api/auth/login') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Username/email and password are required' }));
    });
    return;
  }

  // Tier 3: GET /api/auth/me
  if (req.method === 'GET' && url === '/api/auth/me') {
    if (auth.includes('mock-super-admin-token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 1,
        username: 'admin@abir',
        role: 'admin',
        is_super_admin: 1,
        isSuperAdmin: true
      }));
    }
    if (auth.includes('mock-ordinary-admin-token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 7,
        username: 'admin2',
        role: 'admin',
        is_super_admin: 0,
        isSuperAdmin: false
      }));
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Authentication required' }));
  }

  // Tier 4: GET /api/admin/administrators
  if (req.method === 'GET' && url === '/api/admin/administrators') {
    if (auth.includes('mock-super-admin-token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        administrators: [
          { id: 1, username: 'admin@abir', is_super_admin: 1 },
          { id: 7, username: 'admin2', is_super_admin: 0 }
        ]
      }));
    }
    if (auth.includes('mock-ordinary-admin-token')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Access denied: Super Administrator privilege required'
      }));
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Authentication required' }));
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

async function main() {
  console.log('================================================================');
  console.log('PRODUCTION SMOKE CHECK CLI SPECIFICATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, detail = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name}`);
      if (detail) console.error(`   ${detail}`);
      failed++;
    }
  }

  const standardServer = await createMockServer(standardHandler);

  try {
    // -----------------------------------------------------------------
    // 1. Neither credential supplied -> Exits nonzero (code 1)
    // -----------------------------------------------------------------
    console.log('Test 1: Neither credential supplied...');
    const res1 = await runCli([standardServer.baseUrl], {
      SUPER_ADMIN_TOKEN: '',
      ADMIN_TOKEN: '',
      ORDINARY_ADMIN_TOKEN: ''
    });
    assert('Test 1.1: Exits with non-zero exit code (1)', res1.code === 1, `Received exit code: ${res1.code}`);
    assert('Test 1.2: Outputs fatal missing credentials error', res1.stderr.includes('Deployment verification requires BOTH Super Admin and Ordinary Admin credentials'));
    assert('Test 1.3: Rejects deployment gate', !res1.stdout.includes('Deployment gate cleared'));

    // -----------------------------------------------------------------
    // 2. Either credential missing or empty -> Exits nonzero (code 1)
    // -----------------------------------------------------------------
    console.log('\nTest 2a: Only Super Admin credential supplied...');
    const res2a = await runCli([standardServer.baseUrl], {
      SUPER_ADMIN_TOKEN: 'mock-super-admin-token',
      ADMIN_TOKEN: '',
      ORDINARY_ADMIN_TOKEN: ''
    });
    assert('Test 2a.1: Exits with code 1 when Ordinary Admin token is missing', res2a.code === 1, `Received: ${res2a.code}`);
    assert('Test 2a.2: Identifies Ordinary Admin token as missing', res2a.stderr.includes('Ordinary Admin Token'));

    console.log('Test 2b: Only Ordinary Admin credential supplied...');
    const res2b = await runCli([standardServer.baseUrl], {
      SUPER_ADMIN_TOKEN: '',
      ADMIN_TOKEN: 'mock-ordinary-admin-token',
      ORDINARY_ADMIN_TOKEN: ''
    });
    assert('Test 2b.1: Exits with code 1 when Super Admin token is missing', res2b.code === 1, `Received: ${res2b.code}`);
    assert('Test 2b.2: Identifies Super Admin token as missing', res2b.stderr.includes('Super Admin Token'));

    console.log('Test 2c: Whitespace-only credentials supplied...');
    const res2c = await runCli([standardServer.baseUrl], {
      SUPER_ADMIN_TOKEN: '   ',
      ADMIN_TOKEN: ' \t  '
    });
    assert('Test 2c.1: Exits with code 1 for whitespace-only credentials', res2c.code === 1, `Received: ${res2c.code}`);
    assert('Test 2c.2: Identifies credentials as missing/empty', res2c.stderr.includes('missing required credentials'));

    // -----------------------------------------------------------------
    // 3. Both credentials supplied -> All tiers pass -> Exits 0
    // -----------------------------------------------------------------
    console.log('\nTest 3: Both credentials supplied via protected environment variables...');
    const SA_SECRET = 'super-secret-sa-token-99881122';
    const ORD_SECRET = 'ordinary-secret-ord-token-33445566';
    const res3 = await runCli([standardServer.baseUrl], {
      SUPER_ADMIN_TOKEN: 'mock-super-admin-token',
      ADMIN_TOKEN: 'mock-ordinary-admin-token'
    });
    assert('Test 3.1: Exits with code 0 on full deployment pass', res3.code === 0, `Received: ${res3.code}, stderr: ${res3.stderr}`);
    assert('Test 3.2: Tier 1 SPA Shell verified', res3.stdout.includes('Tier 1.1: SPA Shell returns HTTP 200'));
    assert('Test 3.3: Tier 2 Login Validation verified', res3.stdout.includes('Tier 2.1: Login validation returns HTTP 400 Bad Request'));
    assert('Test 3.4: Tier 3 Authenticated Profile verified', res3.stdout.includes('Tier 3.1: Authenticated Ordinary Admin /api/auth/me returns HTTP 200'));
    assert('Test 3.5: Tier 4a Super Admin Endpoint verified', res3.stdout.includes('Tier 4a.1: Super Admin GET /api/admin/administrators returns HTTP 200'));
    assert('Test 3.6: Tier 4b Ordinary Admin 403 verified', res3.stdout.includes('Tier 4b.1: Ordinary Admin GET /api/admin/administrators returns HTTP 403 Forbidden'));
    assert('Test 3.7: Deployment gate cleared', res3.stdout.includes('Deployment gate cleared'));

    // -----------------------------------------------------------------
    // 4. Credential confidentiality -> Sensitive tokens NEVER printed
    // -----------------------------------------------------------------
    console.log('\nTest 4: Credential confidentiality test...');
    const res4 = await runCli([standardServer.baseUrl, '--super-admin-token', SA_SECRET, '--admin-token', ORD_SECRET]);
    assert('Test 4.1: Secret SA token is NEVER printed in stdout', !res4.stdout.includes(SA_SECRET));
    assert('Test 4.2: Secret SA token is NEVER printed in stderr', !res4.stderr.includes(SA_SECRET));
    assert('Test 4.3: Secret Ord token is NEVER printed in stdout', !res4.stdout.includes(ORD_SECRET));
    assert('Test 4.4: Secret Ord token is NEVER printed in stderr', !res4.stderr.includes(ORD_SECRET));

    // -----------------------------------------------------------------
    // 5. Diagnostics mode (--diagnostics) explicitly separated from deployment
    // -----------------------------------------------------------------
    console.log('\nTest 5: Partial diagnostics mode (--diagnostics)...');
    const res5 = await runCli([standardServer.baseUrl, '--diagnostics'], {
      SUPER_ADMIN_TOKEN: '',
      ADMIN_TOKEN: ''
    });
    assert('Test 5.1: Diagnostics mode exits with code 0 for unauthenticated tiers', res5.code === 0, `Received code: ${res5.code}`);
    assert('Test 5.2: Clearly outputs that run is partial diagnostics', res5.stdout.includes('PARTIAL DIAGNOSTIC COMPLETE'));
    assert('Test 5.3: Explicitly states run DOES NOT authorize deployment', res5.stdout.includes('DOES NOT authorize deployment'));
    assert('Test 5.4: Does not state deployment gate cleared', !res5.stdout.includes('Deployment gate cleared'));

    // -----------------------------------------------------------------
    // 6. Protected endpoint returning unexpected status (e.g. 200 instead of 403 for Ordinary Admin)
    // -----------------------------------------------------------------
    console.log('\nTest 6: Protected endpoint returning unexpected status (RBAC leak simulation)...');
    const badStatusServer = await createMockServer((req, res) => {
      if (req.url === '/api/admin/administrators' && req.headers['authorization'].includes('mock-ordinary-admin-token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ administrators: [] })); // WRONG: should be 403!
      }
      return standardHandler(req, res);
    });

    const res6 = await runCli([badStatusServer.baseUrl], {
      SUPER_ADMIN_TOKEN: 'mock-super-admin-token',
      ADMIN_TOKEN: 'mock-ordinary-admin-token'
    });
    assert('Test 6.1: Exits with code 1 when Ordinary Admin gets 200 instead of 403', res6.code === 1, `Received: ${res6.code}`);
    assert('Test 6.2: Identifies status assertion failure', res6.stderr.includes('Expected status 403, received 200'));
    await badStatusServer.close();

    // -----------------------------------------------------------------
    // 7. Protected endpoint returning malformed JSON
    // -----------------------------------------------------------------
    console.log('\nTest 7: Protected endpoint returning malformed JSON...');
    const malformedServer = await createMockServer((req, res) => {
      if (req.url === '/api/admin/administrators' && req.headers['authorization'].includes('mock-super-admin-token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('<!DOCTYPE html><html><body>Internal Server Error</body></html>'); // WRONG: not JSON
      }
      return standardHandler(req, res);
    });

    const res7 = await runCli([malformedServer.baseUrl], {
      SUPER_ADMIN_TOKEN: 'mock-super-admin-token',
      ADMIN_TOKEN: 'mock-ordinary-admin-token'
    });
    assert('Test 7.1: Exits with code 1 when endpoint returns non-JSON body', res7.code === 1, `Received: ${res7.code}`);
    assert('Test 7.2: Identifies JSON parse failure', res7.stderr.includes('Failed to parse response'));
    await malformedServer.close();

    // -----------------------------------------------------------------
    // 8. Connection failure (ECONNREFUSED)
    // -----------------------------------------------------------------
    console.log('\nTest 8: Connection failure (ECONNREFUSED)...');
    const res8 = await runCli(['http://127.0.0.1:59998'], {
      SUPER_ADMIN_TOKEN: 'mock-super-admin-token',
      ADMIN_TOKEN: 'mock-ordinary-admin-token'
    });
    assert('Test 8.1: Exits with code 1 on connection failure', res8.code === 1, `Received: ${res8.code}`);
    assert('Test 8.2: Reports connection failure', res8.stderr.includes('Connection failed') || res8.stderr.includes('ECONNREFUSED'));

    // -----------------------------------------------------------------
    // 9. Request timeout
    // -----------------------------------------------------------------
    console.log('\nTest 9: Request timeout...');
    const timeoutServer = await createMockServer((req, res) => {
      // Delay response by 600ms, smoke check configured with 150ms timeout
      setTimeout(() => {
        standardHandler(req, res);
      }, 600);
    });

    const res9 = await runCli([timeoutServer.baseUrl, '--timeout', '150'], {
      SUPER_ADMIN_TOKEN: 'mock-super-admin-token',
      ADMIN_TOKEN: 'mock-ordinary-admin-token'
    });
    assert('Test 9.1: Exits with code 1 on request timeout', res9.code === 1, `Received: ${res9.code}`);
    assert('Test 9.2: Reports request timeout', res9.stderr.includes('timed out after 150ms'));
    await timeoutServer.close();

  } finally {
    await standardServer.close();
  }

  console.log('\n================================================================');
  console.log(`CLI TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI test suite error:', err);
  process.exit(1);
});
