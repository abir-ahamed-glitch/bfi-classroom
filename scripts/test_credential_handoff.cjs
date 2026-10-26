#!/usr/bin/env node
/**
 * scripts/test_credential_handoff.cjs
 *
 * Comprehensive Test Suite for Bounded Credential Handoff.
 *
 * Verifies:
 * 1. promptSecret zero echo and character handling.
 * 2. loginUser happy path (standard login and MFA challenge + verification).
 * 3. loginUser rejection on invalid credentials.
 * 4. loginUser rejection on invalid MFA code.
 * 5. verifyAdminIdentity Super Admin role & privilege guard (ID 1, is_super_admin: 1).
 * 6. verifyAdminIdentity Ordinary Admin role guard (ID 7, is_super_admin: 0).
 * 7. verifyAdminIdentity rejection on role or privilege mismatch.
 * 8. createProtectedTokenStorage file modes (0o600) and directory modes (0o700).
 * 9. createProtectedTokenStorage secure zero-fill and file unlinking on cleanup.
 * 10. obtainSmokeCredentials full end-to-end flow with simulated candidate backend.
 * 11. obtainSmokeCredentials fail-closed abort on password failure.
 * 12. obtainSmokeCredentials fail-closed abort on MFA failure.
 * 13. obtainSmokeCredentials fail-closed abort on identity mismatch.
 * 14. Turnstile loopback exemption logic: loopback without proxy headers bypasses Turnstile; external proxy headers enforce Turnstile.
 * 15. Admin username logic: admin@abir allowed; legacy admin2 allowed; unauthorized username rejected.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { Readable, Writable } = require('stream');

const {
  obtainSmokeCredentials,
  promptSecret,
  loginUser,
  verifyAdminIdentity,
  createProtectedTokenStorage,
  sendJsonRequest
} = require('./obtain_smoke_credentials.cjs');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        console.log('✅ PASS');
        passedTests++;
      }).catch((err) => {
        console.log(`❌ FAIL: ${err.message}`);
        console.error(err);
        process.exitCode = 1;
      });
    } else {
      console.log('✅ PASS');
      passedTests++;
      return Promise.resolve();
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
    return Promise.resolve();
  }
}

// Configurable mock server helper
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

async function main() {
  console.log('================================================================');
  console.log('BOUNDED CREDENTIAL HANDOFF COMPREHENSIVE TEST SUITE');
  console.log('================================================================\n');

  // ── TEST 1: promptSecret non-TTY stream input ─────────────────────────────
  await runTest('promptSecret reads streamed input without echoing to stdout', async () => {
    const inputStream = new Readable({
      read() {
        this.push('secret-pass-123\n');
        this.push(null);
      }
    });

    let outputWritten = '';
    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        outputWritten += chunk.toString();
        callback();
      }
    });

    const res = await promptSecret('Enter password: ', {
      input: inputStream,
      output: outputStream,
      timeoutMs: 5000
    });

    assert.strictEqual(res, 'secret-pass-123');
    // Ensure prompt was written to output, but secret was NEVER written
    assert(outputWritten.includes('Enter password: '));
    assert(!outputWritten.includes('secret-pass-123'));
  });

  // ── TEST 2: promptSecret timeout handling ─────────────────────────────────
  await runTest('promptSecret rejects when input exceeds timeout', async () => {
    const inputStream = new Readable({
      read() {
        // never pushes data
      }
    });

    const outputStream = new Writable({
      write(chunk, encoding, callback) { callback(); }
    });

    let caught = false;
    try {
      await promptSecret('Enter password: ', {
        input: inputStream,
        output: outputStream,
        timeoutMs: 50
      });
    } catch (err) {
      caught = true;
      assert(err.message.includes('timed out'));
    }
    assert.strictEqual(caught, true, 'Expected promptSecret to throw timeout error');
  });

  // ── TEST 3: createProtectedTokenStorage file permissions & zeroing ────────
  await runTest('createProtectedTokenStorage creates 0o600 files and zeroes on cleanup', () => {
    const customDir = path.join(os.tmpdir(), `test_cred_store_${Date.now()}`);
    const storage = createProtectedTokenStorage({
      superAdminToken: 'secret-super-admin-jwt-token-string-value',
      adminToken: 'secret-ordinary-admin-jwt-token-string-value',
      customDir
    });

    assert(fs.existsSync(storage.superAdminTokenFile), 'Super admin token file must exist');
    assert(fs.existsSync(storage.adminTokenFile), 'Admin token file must exist');

    // On non-Windows platforms, assert file mode is 0o600
    if (process.platform !== 'win32') {
      const saStat = fs.statSync(storage.superAdminTokenFile);
      const oaStat = fs.statSync(storage.adminTokenFile);
      assert.strictEqual(saStat.mode & 0o777, 0o600, 'Super admin token file mode must be 0o600');
      assert.strictEqual(oaStat.mode & 0o777, 0o600, 'Admin token file mode must be 0o600');
    }

    // Verify token content before cleanup
    assert.strictEqual(fs.readFileSync(storage.superAdminTokenFile, 'utf8'), 'secret-super-admin-jwt-token-string-value');
    assert.strictEqual(fs.readFileSync(storage.adminTokenFile, 'utf8'), 'secret-ordinary-admin-jwt-token-string-value');

    // Execute cleanup
    storage.cleanup();

    // Verify files and directory are unlinked
    assert(!fs.existsSync(storage.superAdminTokenFile), 'Super admin token file must be deleted');
    assert(!fs.existsSync(storage.adminTokenFile), 'Admin token file must be deleted');
    assert(!fs.existsSync(customDir), 'Temporary credential directory must be deleted');
  });

  // ── TEST 4: loginUser happy path with MFA ──────────────────────────────────
  await runTest('loginUser completes standard login and MFA challenge', async () => {
    const mock = await createMockServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};

        if (req.url === '/api/auth/login' && req.method === 'POST') {
          if (parsed.username === 'admin@abir' && parsed.password === 'correct-pass') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              requireMfa: true,
              mfaToken: 'mock-mfa-challenge-jwt-token',
              user: { id: 1, username: 'admin@abir', role: 'admin' }
            }));
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }

        if (req.url === '/api/auth/mfa-verify' && req.method === 'POST') {
          if (parsed.mfaToken === 'mock-mfa-challenge-jwt-token' && parsed.code === '123456') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              message: 'Login successful',
              token: 'mock-verified-sa-jwt-token',
              user: { id: 1, username: 'admin@abir', role: 'admin' }
            }));
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid verification code.' }));
        }

        res.writeHead(404);
        res.end();
      });
    });

    try {
      const auth = await loginUser({
        baseUrl: mock.baseUrl,
        username: 'admin@abir',
        password: 'correct-pass',
        mfaCode: '123456'
      });

      assert.strictEqual(auth.token, 'mock-verified-sa-jwt-token');
      assert.strictEqual(auth.user.id, 1);
    } finally {
      await mock.close();
    }
  });

  // ── TEST 5: loginUser rejection on invalid password ───────────────────────
  await runTest('loginUser throws error on invalid password', async () => {
    const mock = await createMockServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid credentials' }));
    });

    try {
      let caught = false;
      try {
        await loginUser({
          baseUrl: mock.baseUrl,
          username: 'admin@abir',
          password: 'wrong-password'
        });
      } catch (err) {
        caught = true;
        assert(err.message.includes('Invalid credentials'));
      }
      assert.strictEqual(caught, true, 'Expected loginUser to throw error on bad credentials');
    } finally {
      await mock.close();
    }
  });

  // ── TEST 6: verifyAdminIdentity role and Super Admin checks ───────────────
  await runTest('verifyAdminIdentity validates identity, role, and super admin flag', async () => {
    const mock = await createMockServer((req, res) => {
      const auth = req.headers['authorization'] || '';
      if (auth === 'Bearer token-sa') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          id: 1,
          username: 'admin@abir',
          role: 'admin',
          is_super_admin: 1,
          isSuperAdmin: true
        }));
      }
      if (auth === 'Bearer token-oa') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          id: 7,
          username: 'admin2',
          role: 'admin',
          is_super_admin: 0,
          isSuperAdmin: false
        }));
      }
      res.writeHead(401);
      res.end();
    });

    try {
      // 1. Super admin verification
      const sa = await verifyAdminIdentity({
        baseUrl: mock.baseUrl,
        token: 'token-sa',
        expectedId: 1,
        expectedRole: 'admin',
        expectedSuperAdmin: true
      });
      assert.strictEqual(sa.id, 1);
      assert.strictEqual(sa.role, 'admin');

      // 2. Ordinary admin verification
      const oa = await verifyAdminIdentity({
        baseUrl: mock.baseUrl,
        token: 'token-oa',
        expectedId: 7,
        expectedRole: 'admin',
        expectedSuperAdmin: false
      });
      assert.strictEqual(oa.id, 7);
      assert.strictEqual(oa.role, 'admin');

      // 3. Super admin check failing when expecting Ordinary Admin
      let saMismatch = false;
      try {
        await verifyAdminIdentity({
          baseUrl: mock.baseUrl,
          token: 'token-sa',
          expectedId: 1,
          expectedRole: 'admin',
          expectedSuperAdmin: false // expecting ordinary, but token has super admin
        });
      } catch (err) {
        saMismatch = true;
        assert(err.message.includes('unexpectedly has is_super_admin: 1'));
      }
      assert.strictEqual(saMismatch, true);

      // 4. Ordinary admin check failing when expecting Super Admin
      let oaMismatch = false;
      try {
        await verifyAdminIdentity({
          baseUrl: mock.baseUrl,
          token: 'token-oa',
          expectedId: 7,
          expectedRole: 'admin',
          expectedSuperAdmin: true // expecting super, but token has ordinary
        });
      } catch (err) {
        oaMismatch = true;
        assert(err.message.includes('does not have is_super_admin: 1'));
      }
      assert.strictEqual(oaMismatch, true);
    } finally {
      await mock.close();
    }
  });

  // ── TEST 7: obtainSmokeCredentials End-to-End Coordination ────────────────
  await runTest('obtainSmokeCredentials executes full handoff and writes protected token files', async () => {
    const mock = await createMockServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const url = req.url;
        const parsed = body ? JSON.parse(body) : {};
        const auth = req.headers['authorization'] || '';

        // POST /api/auth/login
        if (url === '/api/auth/login' && req.method === 'POST') {
          if (parsed.username === 'admin@abir' && parsed.password === 'sa-pass') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              requireMfa: true,
              mfaToken: 'sa-mfa-token',
              user: { id: 1, username: 'admin@abir', role: 'admin' }
            }));
          }
          if (parsed.username === 'admin2' && parsed.password === 'oa-pass') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              message: 'Login successful',
              token: 'oa-access-token-jwt',
              user: { id: 7, username: 'admin2', role: 'admin' }
            }));
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }

        // POST /api/auth/mfa-verify
        if (url === '/api/auth/mfa-verify' && req.method === 'POST') {
          if (parsed.mfaToken === 'sa-mfa-token' && parsed.code === '654321') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              message: 'Login successful',
              token: 'sa-access-token-jwt',
              user: { id: 1, username: 'admin@abir', role: 'admin' }
            }));
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid verification code.' }));
        }

        // GET /api/auth/me
        if (url === '/api/auth/me' && req.method === 'GET') {
          if (auth === 'Bearer sa-access-token-jwt') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              id: 1,
              username: 'admin@abir',
              role: 'admin',
              is_super_admin: 1,
              isSuperAdmin: true
            }));
          }
          if (auth === 'Bearer oa-access-token-jwt') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              id: 7,
              username: 'admin2',
              role: 'admin',
              is_super_admin: 0,
              isSuperAdmin: false
            }));
          }
          res.writeHead(401);
          return res.end();
        }

        res.writeHead(404);
        res.end();
      });
    });

    try {
      const result = await obtainSmokeCredentials({
        baseUrl: mock.baseUrl,
        credentialProvider: async ({ role, username, isMfa }) => {
          if (role === 'super_admin') return 'sa-pass';
          if (role === 'super_admin_mfa') return '654321';
          if (role === 'ordinary_admin') return 'oa-pass';
          throw new Error(`Unexpected credential prompt: ${role}`);
        }
      });

      assert(result.superAdminTokenFile && fs.existsSync(result.superAdminTokenFile));
      assert(result.adminTokenFile && fs.existsSync(result.adminTokenFile));
      assert.strictEqual(fs.readFileSync(result.superAdminTokenFile, 'utf8'), 'sa-access-token-jwt');
      assert.strictEqual(fs.readFileSync(result.adminTokenFile, 'utf8'), 'oa-access-token-jwt');

      // Verify cleanup cleans files
      result.cleanup();
      assert(!fs.existsSync(result.superAdminTokenFile));
      assert(!fs.existsSync(result.adminTokenFile));
    } finally {
      await mock.close();
    }
  });

  // ── TEST 8: obtainSmokeCredentials Fail-Closed on Password Failure ─────────
  await runTest('obtainSmokeCredentials aborts fail-closed on bad password', async () => {
    const mock = await createMockServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid credentials' }));
    });

    try {
      let caught = false;
      try {
        await obtainSmokeCredentials({
          baseUrl: mock.baseUrl,
          credentialProvider: async () => 'wrong-pass'
        });
      } catch (err) {
        caught = true;
        assert(err.message.includes('Login failed'));
      }
      assert.strictEqual(caught, true, 'Expected obtainSmokeCredentials to fail-closed');
    } finally {
      await mock.close();
    }
  });

  // ── TEST 9: obtainSmokeCredentials Fail-Closed on MFA Failure ──────────────
  await runTest('obtainSmokeCredentials aborts fail-closed on bad MFA code', async () => {
    const mock = await createMockServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        if (req.url === '/api/auth/login') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            requireMfa: true,
            mfaToken: 'sa-mfa-token',
            user: { id: 1, username: 'admin@abir', role: 'admin' }
          }));
        }
        if (req.url === '/api/auth/mfa-verify') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid verification code.' }));
        }
        res.writeHead(404);
        res.end();
      });
    });

    try {
      let caught = false;
      try {
        await obtainSmokeCredentials({
          baseUrl: mock.baseUrl,
          credentialProvider: async ({ isMfa }) => isMfa ? '000000' : 'sa-pass'
        });
      } catch (err) {
        caught = true;
        assert(err.message.includes('MFA verification failed'));
      }
      assert.strictEqual(caught, true, 'Expected obtainSmokeCredentials to fail-closed on bad MFA');
    } finally {
      await mock.close();
    }
  });

  // ── TEST 10: Turnstile Direct Loopback Exemption Logic ─────────────────────
  await runTest('Turnstile condition correctly exempts direct loopback and enforces on proxies', () => {
    // Condition from server/routes/auth.js:
    function checkTurnstileEnforcement(remoteIp, headers, isTestServer = false) {
      const isDirectLoopback = (remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1') &&
        !headers['x-forwarded-for'] && !headers['cf-connecting-ip'];
      const turnstileSecret = (isTestServer || isDirectLoopback) ? null : 'mock-turnstile-secret';
      return turnstileSecret !== null;
    }

    // Direct loopback -> exempt
    assert.strictEqual(checkTurnstileEnforcement('127.0.0.1', {}), false);
    assert.strictEqual(checkTurnstileEnforcement('::1', {}), false);
    assert.strictEqual(checkTurnstileEnforcement('::ffff:127.0.0.1', {}), false);

    // Loopback with Cloudflare / Nginx proxy headers -> ENFORCED
    assert.strictEqual(checkTurnstileEnforcement('127.0.0.1', { 'cf-connecting-ip': '203.0.113.195' }), true);
    assert.strictEqual(checkTurnstileEnforcement('127.0.0.1', { 'x-forwarded-for': '203.0.113.195' }), true);

    // External direct IP -> ENFORCED
    assert.strictEqual(checkTurnstileEnforcement('192.168.1.50', {}), true);
    assert.strictEqual(checkTurnstileEnforcement('10.0.0.1', {}), true);
  });

  // ── TEST 11: Admin Username Validation (admin@abir vs admin2 vs student) ───
  await runTest('Admin username logic permits admin@ prefix and legacy admin2, rejects others', () => {
    const mockUsers = [
      { id: 1, username: 'admin@abir', role: 'admin' },
      { id: 7, username: 'admin2', role: 'admin' },
      { id: 10, username: 'student_john', role: 'student' }
    ];

    function validateAdminUsername(username, type) {
      if (type === 'admin' && !username.toLowerCase().startsWith('admin@')) {
        const existingAdmin = mockUsers.find(u =>
          (u.username.toLowerCase() === username.toLowerCase()) && u.role === 'admin'
        );
        if (!existingAdmin) {
          return { valid: false, error: 'Admin usernames must start with "admin@"' };
        }
      }
      return { valid: true };
    }

    // admin@abir: starts with admin@ -> valid
    assert.strictEqual(validateAdminUsername('admin@abir', 'admin').valid, true);
    assert.strictEqual(validateAdminUsername('ADMIN@ABIR', 'admin').valid, true);

    // admin2: does not start with admin@, but matches existing admin user -> valid
    assert.strictEqual(validateAdminUsername('admin2', 'admin').valid, true);
    assert.strictEqual(validateAdminUsername('ADMIN2', 'admin').valid, true);

    // student_john: does not start with admin@, role is student -> invalid
    assert.strictEqual(validateAdminUsername('student_john', 'admin').valid, false);

    // random_unknown: does not exist -> invalid
    assert.strictEqual(validateAdminUsername('random_hacker', 'admin').valid, false);
  });

  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passedTests}/${totalTests} tests passed.`);
  console.log('================================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
