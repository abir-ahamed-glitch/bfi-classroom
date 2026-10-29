#!/usr/bin/env node
/**
 * scripts/test_staging_auth_exceptions.cjs
 *
 * Regression Suite: Verifies Staging Mock CAPTCHA Exceptions and Safe Failure Behavior.
 *
 * Enforces:
 * 1. Staging mock CAPTCHA tokens are strictly rejected in normal production configuration.
 * 2. Staging mock tokens require the intended isolated configuration (loopback socket, loopback HOST, no proxy headers).
 * 3. Accidental staging flags cannot silently enable a publicly accessible bypass.
 * 4. Safe fail-closed failure behavior when Turnstile secret is unconfigured in production.
 * 5. Complete removal of hardcoded Turnstile secrets from source.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Test ${totalTests}: ${name}... `);
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

async function main() {
  console.log('================================================================');
  console.log('STAGING AUTHENTICATION EXCEPTIONS & SAFE FAILURE REGRESSION SUITE');
  console.log('================================================================\n');

  // Test 1: Verify absence of hardcoded fallback Turnstile secrets in auth.js
  await runTest('No hardcoded Turnstile secrets present in server/routes/auth.js', () => {
    const authSrc = fs.readFileSync(path.resolve(__dirname, '../server/routes/auth.js'), 'utf8');
    assert.ok(!authSrc.includes('0x4AAAAAAFjcgxWdsFD76vYeWwOAe3VG7pI'), 'Must not contain old production secret');
    assert.ok(!authSrc.includes('TURNSTILE_DEFAULT_SECRET'), 'Must not define TURNSTILE_DEFAULT_SECRET');
  });

  // Setup disposable database for HTTP route testing
  const tempDir = path.join(require('os').tmpdir(), 'bfi_auth_test_' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  const disposableDbPath = path.join(tempDir, 'test_auth.db');

  const testDb = new Database(disposableDbPath);
  testDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      archived_at DATETIME DEFAULT NULL,
      last_login DATETIME DEFAULT NULL,
      deleted_at DATETIME DEFAULT NULL,
      is_super_admin INTEGER NOT NULL DEFAULT 0,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      last_activity DATETIME NOT NULL,
      sudo_verified_at DATETIME
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      target_user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE mfa_login_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      expires_at DATETIME NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      consumed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const passwordHash = bcrypt.hashSync('StrongTestPass123!', 10);
  testDb.prepare(`
    INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_super_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('admin@test.local', 'admin@test.local', passwordHash, 'admin', 'Test', 'Admin', 1);

  // Set environment variables before importing auth routes
  process.env.DATABASE_PATH = disposableDbPath;
  process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_characters_123456';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_minimum_32_characters_123456';
  process.env.NODE_ENV = 'production';

  const authRoutesModule = await import('../server/routes/auth.js');
  const authRouter = authRoutesModule.default;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  function makeLoginRequest(headers = {}, body = {}) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        username: 'admin@test.local',
        password: 'StrongTestPass123!',
        type: 'admin',
        ...body
      });
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
          resolve({ status: res.statusCode, data: parsed });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  try {
    // Test 2: In normal production configuration (no staging flag), missing Turnstile secret fails closed (503)
    delete process.env.IS_STAGING_SERVER;
    delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SECRET;
    process.env.HOST = '0.0.0.0';

    await runTest('Normal production: missing Turnstile secret fails closed with 503', async () => {
      const res = await makeLoginRequest({}, { turnstileToken: 'staging-turnstile-token' });
      assert.strictEqual(res.status, 503, `Expected 503, got ${res.status}`);
      assert.ok(res.data.error.includes('unconfigured'), 'Expected unconfigured error message');
    });

    // Test 3: In normal production configuration with a secret configured, staging mock token is rejected (403)
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'mock_production_turnstile_secret';
    await runTest('Normal production: staging mock token is rejected with 403', async () => {
      const res = await makeLoginRequest({}, { turnstileToken: 'staging-turnstile-token' });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.data.field, 'turnstile');
    });

    // Test 4: Accidental staging flag on non-loopback host (e.g. HOST=0.0.0.0) is rejected
    process.env.IS_STAGING_SERVER = 'true';
    process.env.HOST = '0.0.0.0'; // Bound publicly
    await runTest('Accidental staging flag: rejected when server HOST is not loopback (0.0.0.0)', async () => {
      const res = await makeLoginRequest({}, { turnstileToken: 'staging-turnstile-token' });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
    });

    // Test 5: Accidental staging flag with proxy forwarding headers is rejected
    process.env.HOST = '127.0.0.1';
    await runTest('Accidental staging flag: rejected when request carries x-forwarded-for header', async () => {
      const res = await makeLoginRequest({ 'x-forwarded-for': '203.0.113.195' }, { turnstileToken: 'staging-turnstile-token' });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
    });

    await runTest('Accidental staging flag: rejected when request carries cf-connecting-ip header', async () => {
      const res = await makeLoginRequest({ 'cf-connecting-ip': '203.0.113.195' }, { turnstileToken: 'staging-turnstile-token' });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
    });

    // Test 6: Staging isolated configuration: missing token is rejected (400)
    await runTest('Staging isolated configuration: missing token is rejected with 400', async () => {
      const res = await makeLoginRequest({}, {}); // no turnstileToken
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.data.field, 'turnstile');
    });

    // Test 7: Staging isolated configuration: arbitrary invalid token is rejected (403)
    await runTest('Staging isolated configuration: invalid random token is rejected with 403', async () => {
      const res = await makeLoginRequest({}, { turnstileToken: 'arbitrary_invalid_token_xyz' });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
    });

    // Test 8: Intended isolated staging configuration: valid staging mock token succeeds (200)
    await runTest('Intended isolated configuration: staging-turnstile-token succeeds with 200', async () => {
      const res = await makeLoginRequest({}, { turnstileToken: 'staging-turnstile-token' });
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.ok(res.data.token, 'Expected session token in response');
      assert.strictEqual(res.data.user.username, 'admin@test.local');
    });

  } finally {
    server.close();
    testDb.close();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n================================================================`);
  console.log(`Staging Auth Exceptions Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
