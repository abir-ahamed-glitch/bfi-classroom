#!/usr/bin/env node
/**
 * scripts/test_credential_handoff.cjs
 *
 * Comprehensive Integration & Unit Test Suite for Bounded Credential Handoff
 * and Maintenance-Scoped Authentication Authorization.
 *
 * Test Coverage:
 * 1. Secret-Input Listener Cleanup & Terminal State:
 *    - Timeout removes 'data' and 'error' listeners and closes readline.
 *    - Cancellation (Ctrl+C) cleans up all listeners and restores raw mode.
 *    - Success cleans up listeners and restores raw mode.
 *    - Protected token storage enforces 0o600/0o700 and best-effort cleanup.
 * 2. Real Route Integration Tests against server/routes/auth.js using disposable DB:
 *    - External proxy Turnstile enforcement (HTTP 400).
 *    - External proxy with maintenance token rejected (HTTP 400).
 *    - Direct loopback without token rejected (HTTP 400).
 *    - Invalid maintenance token rejected (HTTP 400).
 *    - Replay defense: single-use token consumed atomically; replay returns HTTP 400.
 *    - Concurrent reuse defense: parallel requests with same token allow exactly one to succeed.
 *    - Missing metadata: state containing only {backupValidated:true} rejected (HTTP 400).
 *    - Missing metadata: missing explicit boolean exposure flags rejected (HTTP 400).
 *    - Missing metadata: capability file missing attemptId (bare token) rejected (HTTP 400).
 *    - Wrong attempt: capability bound to different attemptId rejected (HTTP 400).
 *    - Terminal state: rollbackCompleted: true rejected (HTTP 400).
 *    - Terminal state: rolledBackAt / completed / terminal rejected (HTTP 400).
 *    - Expiration: capability with expired timestamp rejected (HTTP 400).
 *    - Exposure: trafficMayReopen: true rejected (HTTP 400).
 *    - Exposure: trafficReopened: true rejected (HTTP 400).
 *    - Backup association mismatch: backup file missing on disk rejected (HTTP 400).
 *    - Separate capabilities: distinct tokens for multiple accounts consumed independently.
 *    - Capability account mismatch: token bound to admin@abir cannot be used by admin2 (HTTP 400).
 *    - Legacy admin login (admin2, ID 7) succeeds with valid capability (HTTP 200).
 *    - Non-admin student login rejected on admin portal (HTTP 400).
 *    - Wrong password rejected (HTTP 401).
 *    - MFA challenge issuance & TOTP verification flow (HTTP 200).
 *    - Profile role guards via GET /api/auth/me confirm roles and flags.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const {
  obtainSmokeCredentials,
  promptSecret,
  createProtectedTokenStorage,
  verifyAdminIdentity,
  sendJsonRequest
} = require('./obtain_smoke_credentials.cjs');

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

// Mock Raw TTY Stream for Prompt Testing
class MockTtyStream extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.isRaw = false;
    this.resumed = false;
    this.paused = false;
  }
  setRawMode(val) {
    this.isRaw = val;
  }
  resume() {
    this.resumed = true;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

async function main() {
  console.log('================================================================');
  console.log('BOUNDED CREDENTIAL HANDOFF & REAL ROUTE AUTH TEST SUITE');
  console.log('================================================================\n');

  // ── PART 1: Secret-Input Listener Cleanup & TTY State Tests ─────────────────
  console.log('--- PART 1: Secret-Input Listener Cleanup & Terminal State ---');

  await runTest('promptSecret timeout removes data listener and prevents late input', async () => {
    const mockTty = new MockTtyStream();
    const outputStream = new Writable({ write(c, e, cb) { cb(); } });

    assert.strictEqual(mockTty.listenerCount('data'), 0, 'Initial listener count must be 0');

    let caughtError = false;
    try {
      await promptSecret('Enter password: ', {
        input: mockTty,
        output: outputStream,
        timeoutMs: 30
      });
    } catch (err) {
      caughtError = true;
      assert(err.message.includes('timed out'), `Expected timeout error, got: ${err.message}`);
    }

    assert.strictEqual(caughtError, true, 'Prompt must reject on timeout');
    assert.strictEqual(mockTty.listenerCount('data'), 0, 'All data listeners must be removed on timeout');
    assert.strictEqual(mockTty.listenerCount('error'), 0, 'All error listeners must be removed on timeout');
    assert.strictEqual(mockTty.isRaw, false, 'Raw mode must be restored to prior state (false)');

    // Emit subsequent input: must not throw or trigger any lingering listener
    let lateDataReceived = false;
    mockTty.on('data', () => { lateDataReceived = true; });
    mockTty.emit('data', Buffer.from('late-secret-value\n'));
    assert.strictEqual(lateDataReceived, true);
  });

  await runTest('promptSecret cancellation (Ctrl+C) cleans up all listeners and raw mode', async () => {
    const mockTty = new MockTtyStream();
    const outputStream = new Writable({ write(c, e, cb) { cb(); } });

    const promptPromise = promptSecret('Enter password: ', {
      input: mockTty,
      output: outputStream,
      timeoutMs: 5000
    });

    assert.strictEqual(mockTty.listenerCount('data'), 1, 'Data listener must be attached during prompt');
    assert.strictEqual(mockTty.isRaw, true, 'Raw mode must be engaged');

    // Emit Ctrl+C (character code 3)
    mockTty.emit('data', Buffer.from([3]));

    let caughtCancel = false;
    try {
      await promptPromise;
    } catch (err) {
      caughtCancel = true;
      assert(err.message.includes('cancelled by operator'), `Expected cancel message, got: ${err.message}`);
    }

    assert.strictEqual(caughtCancel, true);
    assert.strictEqual(mockTty.listenerCount('data'), 0, 'Data listeners must be cleaned up on cancellation');
    assert.strictEqual(mockTty.isRaw, false, 'Raw mode must be restored on cancellation');
  });

  await runTest('promptSecret success removes listeners and restores terminal state', async () => {
    const mockTty = new MockTtyStream();
    const outputStream = new Writable({ write(c, e, cb) { cb(); } });

    const promptPromise = promptSecret('Enter secret: ', {
      input: mockTty,
      output: outputStream,
      timeoutMs: 5000
    });

    mockTty.emit('data', Buffer.from('my-secret-key'));
    mockTty.emit('data', Buffer.from([13])); // Enter

    const res = await promptPromise;
    assert.strictEqual(res, 'my-secret-key');
    assert.strictEqual(mockTty.listenerCount('data'), 0, 'Data listeners must be cleaned up on success');
    assert.strictEqual(mockTty.isRaw, false, 'Raw mode must be restored on success');
  });

  await runTest('createProtectedTokenStorage enforces 0o600/0o700 and zeroes files on cleanup', () => {
    const customDir = path.join(os.tmpdir(), `test_store_${Date.now()}`);
    const storage = createProtectedTokenStorage({
      superAdminToken: 'test-super-admin-jwt',
      adminToken: 'test-ordinary-admin-jwt',
      customDir
    });

    assert(fs.existsSync(storage.superAdminTokenFile));
    assert(fs.existsSync(storage.adminTokenFile));

    if (process.platform !== 'win32') {
      const saStat = fs.statSync(storage.superAdminTokenFile);
      assert.strictEqual(saStat.mode & 0o777, 0o600);
      const dirStat = fs.statSync(customDir);
      assert.strictEqual(dirStat.mode & 0o777, 0o700);
    }

    storage.cleanup();
    assert(!fs.existsSync(storage.superAdminTokenFile), 'Token file must be unlinked');
    assert(!fs.existsSync(storage.adminTokenFile), 'Token file must be unlinked');
    assert(!fs.existsSync(customDir), 'Token directory must be unlinked');
  });

  // ── PART 2: Real Route Integration Tests (server/routes/auth.js) ────────────
  console.log('\n--- PART 2: Real Route Integration Tests (server/routes/auth.js) ---');

  // Setup isolated disposable SQLite database for auth.js
  const tempTestDir = path.join(os.tmpdir(), `bfi_auth_integration_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tempTestDir, { recursive: true });
  const disposableDbPath = path.join(tempTestDir, 'test_auth.db');

  // Setup valid dummy backup file for state validation
  const dummyBackupPath = path.join(tempTestDir, 'valid_preflight_backup.db');
  fs.writeFileSync(dummyBackupPath, 'DUMMY_SQLITE_BACKUP_CONTENT');

  // Point DATABASE_PATH to disposable database before importing database / auth routes
  process.env.DATABASE_PATH = disposableDbPath;
  process.env.JWT_SECRET = 'test_integration_jwt_secret_1234567890';
  process.env.JWT_REFRESH_SECRET = 'test_integration_refresh_secret_1234567890';
  process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'test_turnstile_secret_key_mock';
  process.env.NODE_ENV = 'production'; // ensure Turnstile is NOT bypassed by test mode!

  // Initialize schema and seed accounts
  const db = new Database(disposableDbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      profile_picture TEXT,
      two_factor_enabled INTEGER DEFAULT 0,
      two_factor_secret TEXT,
      last_totp_timestamp INTEGER,
      public_key TEXT,
      private_key TEXT,
      is_active INTEGER DEFAULT 1,
      is_super_admin INTEGER DEFAULT 0,
      token_version INTEGER DEFAULT 1,
      account_version INTEGER DEFAULT 1,
      archived_at DATETIME,
      password_reset_pending INTEGER DEFAULT 0,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_activity DATETIME,
      sudo_verified_at DATETIME
    );

    CREATE TABLE mfa_login_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_version INTEGER DEFAULT 1,
      expires_at DATETIME NOT NULL,
      consumed INTEGER DEFAULT 0,
      consumed_at DATETIME
    );

    CREATE TABLE admin_mfa_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at DATETIME
    );

    CREATE TABLE student_profiles (
      user_id INTEGER PRIMARY KEY,
      student_id TEXT,
      batch_number TEXT
    );

    CREATE TABLE admin_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL
    );
  `);

  // Seed User 1 (Super Admin, MFA enabled)
  const saHash = bcrypt.hashSync('SuperPass@123', 8);
  const totpModule = await import('../server/utils/totp.js');
  const base32TotpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const twoFactorSecret = totpModule.encryptSecret(base32TotpSecret);

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, two_factor_enabled, two_factor_secret, token_version)
    VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', ?, 'admin', 'Abir', 'Ahmad', 1, 1, ?, 1)
  `).run(saHash, twoFactorSecret);

  // Seed User 7 (Legacy Ordinary Admin, username: 'admin2', no 'admin@' prefix)
  const ordHash = bcrypt.hashSync('OrdPass@456', 8);
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, two_factor_enabled, token_version)
    VALUES (7, 'admin2', 'admin2@bfibd.org', ?, 'admin', 'Admin', 'Two', 0, 0, 1)
  `).run(ordHash);

  // Seed User 10 (Student)
  const stuHash = bcrypt.hashSync('StudentPass@789', 8);
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, two_factor_enabled, token_version)
    VALUES (10, 'student1', 'student1@bfi.com', ?, 'student', 'John', 'Student', 0, 0, 1)
  `).run(stuHash);
  db.close();

  // Setup maintenance authorization state files in tempTestDir
  const maintTokenPath = path.join(tempTestDir, '.maintenance_auth_token');
  const stateFilePath = path.join(tempTestDir, 'active_deployment_state.json');
  process.env.MAINTENANCE_TOKEN_PATH = maintTokenPath;
  process.env.DEPLOYMENT_STATE_PATH = stateFilePath;

  const validAttemptId = 'test_deploy_attempt_1';
  const defaultState = {
    attemptId: validAttemptId,
    backupValidated: true,
    backupFile: dummyBackupPath,
    trafficMayReopen: false,
    trafficReopened: false,
    rollbackCompleted: false
  };
  fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));

  // Dynamic import of real auth.js router
  const authModule = await import('../server/routes/auth.js');
  const authRouter = authModule.default;

  // Helper to configure capability file
  function setCapability(payload) {
    if (typeof authModule.resetMaintenanceCapabilityMemory === 'function') {
      authModule.resetMaintenanceCapabilityMemory();
    }
    if (typeof payload === 'string') {
      fs.writeFileSync(maintTokenPath, payload, { mode: 0o600 });
    } else {
      fs.writeFileSync(maintTokenPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    }
  }

  // Mount real auth router in minimal Express app
  const expressModule = await import('express');
  const express = expressModule.default;
  const cookieParserModule = await import('cookie-parser');
  const cookieParser = cookieParserModule.default;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ── TEST A: Turnstile Enforcement on External Proxy Path (HTTP 400) ───────
    await runTest('Turnstile enforced on external request with proxy headers (HTTP 400)', async () => {
      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.195'
        },
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
      assert(res.json?.error.includes('Security verification required'));
    });

    // ── TEST B: Turnstile Reject External Request even with Maintenance Token ──
    await runTest('Turnstile bypass strictly rejected when proxy headers present even with maintenance token', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.195',
          'x-bfi-maintenance-token': probeToken
        },
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST C: Loopback Request Rejected without Maintenance Token ───────────
    await runTest('Permanent loopback exemption is removed: Loopback rejected without maintenance token', async () => {
      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST D: Loopback Request Rejected with Invalid Maintenance Token ──────
    await runTest('Loopback rejected when maintenance token does not match disk', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'x-bfi-maintenance-token': 'wrong_invalid_maintenance_token_000000000000'
        },
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST E: Replay Defense: Single-Use Token Consumed Atomically ──────────
    await runTest('Replay defense: single-use token consumed atomically; repeat request returns HTTP 400', async () => {
      const replayToken = crypto.randomBytes(32).toString('hex');
      setCapability({
        attemptId: validAttemptId,
        token: replayToken,
        username: 'admin2'
      });

      // Request 1: Must succeed
      const res1 = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': replayToken },
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });
      assert.strictEqual(res1.status, 200, 'First use of single-use token must succeed');

      // Request 2 (Replay with same token): Must fail with HTTP 400
      const res2 = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': replayToken },
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });
      assert.strictEqual(res2.status, 400, 'Replayed single-use token must be rejected');
      assert.strictEqual(res2.json?.field, 'turnstile');
    });

    // ── TEST F: Concurrent Reuse Defense ──────────────────────────────────────
    await runTest('Concurrent reuse defense: simultaneous requests with same token allow exactly one to succeed', async () => {
      const concurrentToken = crypto.randomBytes(32).toString('hex');
      setCapability({
        attemptId: validAttemptId,
        token: concurrentToken,
        username: 'admin2'
      });

      // Fire two requests concurrently with the exact same maintenance token
      const [resA, resB] = await Promise.all([
        sendJsonRequest(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'x-bfi-maintenance-token': concurrentToken },
          body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
        }),
        sendJsonRequest(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'x-bfi-maintenance-token': concurrentToken },
          body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
        })
      ]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepStrictEqual(statuses, [200, 400], 'Exactly one concurrent request must succeed and the other must fail');
    });

    // ── TEST G: Missing Metadata Defense: State with Only {backupValidated:true}
    await runTest('Missing metadata defense: state with only {backupValidated:true} rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      // Simulate independent disposable probe's state
      fs.writeFileSync(stateFilePath, JSON.stringify({ backupValidated: true }));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    // ── TEST H: Missing Metadata Defense: Missing Explicit Boolean Exposure Flags
    await runTest('Missing metadata defense: state missing explicit boolean exposure flags rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      // State without trafficMayReopen or trafficReopened
      fs.writeFileSync(stateFilePath, JSON.stringify({
        attemptId: validAttemptId,
        backupValidated: true,
        backupFile: dummyBackupPath
      }));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    // ── TEST I: Missing Metadata Defense: Bare Token String without attemptId ──
    await runTest('Missing metadata defense: capability file missing attemptId (bare token) rejected (HTTP 400)', async () => {
      const bareToken = crypto.randomBytes(32).toString('hex');
      // Write bare token without attemptId binding
      setCapability(bareToken);

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': bareToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST J: Wrong Attempt Defense ─────────────────────────────────────────
    await runTest('Wrong attempt defense: capability bound to different attemptId rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({
        attemptId: 'wrong_attempt_id_999999',
        token: probeToken,
        username: 'admin2'
      });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST K: Terminal State Defense ────────────────────────────────────────
    await runTest('Terminal state defense: rollbackCompleted: true rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      fs.writeFileSync(stateFilePath, JSON.stringify({
        ...defaultState,
        rollbackCompleted: true
      }, null, 2));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    await runTest('Terminal state defense: rolledBackAt timestamp rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      fs.writeFileSync(stateFilePath, JSON.stringify({
        ...defaultState,
        rolledBackAt: new Date().toISOString()
      }, null, 2));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    await runTest('Terminal state defense: completed: true rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      fs.writeFileSync(stateFilePath, JSON.stringify({
        ...defaultState,
        completed: true
      }, null, 2));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    // ── TEST L: Expiration Defense ────────────────────────────────────────────
    await runTest('Expiration defense: capability with expired timestamp rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({
        attemptId: validAttemptId,
        token: probeToken,
        expiresAt: new Date(Date.now() - 60000).toISOString() // 1 minute in the past
      });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST M: Exposure Boundary Defense: trafficMayReopen: true ─────────────
    await runTest('Exposure boundary defense: trafficMayReopen: true rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      fs.writeFileSync(stateFilePath, JSON.stringify({
        ...defaultState,
        trafficMayReopen: true // exposure initiated!
      }, null, 2));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    await runTest('Exposure boundary defense: trafficReopened: true rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      fs.writeFileSync(stateFilePath, JSON.stringify({
        ...defaultState,
        trafficReopened: true // exposure completed!
      }, null, 2));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    // ── TEST N: Backup Association Mismatch Defense ───────────────────────────
    await runTest('Backup association mismatch defense: backup file missing on disk rejected (HTTP 400)', async () => {
      const probeToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: probeToken });

      fs.writeFileSync(stateFilePath, JSON.stringify({
        ...defaultState,
        backupFile: path.join(tempTestDir, 'non_existent_backup_file.db')
      }, null, 2));

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': probeToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');

      // Restore valid state
      fs.writeFileSync(stateFilePath, JSON.stringify(defaultState, null, 2));
    });

    // ── TEST O: Separate Capabilities for Multiple Accounts ───────────────────
    await runTest('Separate capabilities: distinct tokens for multiple accounts consumed independently', async () => {
      const saMaintToken = crypto.randomBytes(32).toString('hex');
      const oaMaintToken = crypto.randomBytes(32).toString('hex');

      setCapability({
        attemptId: validAttemptId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        tokens: [
          { token: saMaintToken, username: 'admin@abir', role: 'super_admin', consumed: false },
          { token: oaMaintToken, username: 'admin2', role: 'ordinary_admin', consumed: false }
        ]
      });

      // 1. Super Admin logs in using saMaintToken -> Succeeds (returns requireMfa)
      const resSA = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': saMaintToken },
        body: { username: 'admin@abir', password: 'SuperPass@123', type: 'admin' }
      });
      assert.strictEqual(resSA.status, 200);
      assert.strictEqual(resSA.json?.requireMfa, true);

      // 2. Ordinary Admin logs in using oaMaintToken -> Succeeds (returns token)
      const resOA = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': oaMaintToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });
      assert.strictEqual(resOA.status, 200);
      assert(resOA.json?.token);

      // 3. Replay saMaintToken -> Must fail with HTTP 400
      const resReplaySA = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': saMaintToken },
        body: { username: 'admin@abir', password: 'SuperPass@123', type: 'admin' }
      });
      assert.strictEqual(resReplaySA.status, 400);

      // 4. Replay oaMaintToken -> Must fail with HTTP 400
      const resReplayOA = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': oaMaintToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });
      assert.strictEqual(resReplayOA.status, 400);

      // 5. Verify token file unlinked after both consumed
      assert(!fs.existsSync(maintTokenPath), 'Capability file must be deleted when all tokens consumed');
    });

    // ── TEST P: Account Mismatch Defense on Separate Capabilities ─────────────
    await runTest('Account mismatch defense: token bound to admin@abir cannot be used by admin2', async () => {
      const saMaintToken = crypto.randomBytes(32).toString('hex');
      setCapability({
        attemptId: validAttemptId,
        tokens: [
          { token: saMaintToken, username: 'admin@abir', role: 'super_admin', consumed: false }
        ]
      });

      // admin2 attempts to use token bound to admin@abir
      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': saMaintToken },
        body: { username: 'admin2', password: 'OrdPass@456', type: 'admin' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json?.field, 'turnstile');
    });

    // ── TEST Q: Supported Legacy-Admin Login (admin2, User ID 7) via Real Route
    let ordAdminToken = null;
    await runTest('Supported legacy-admin login (admin2, ID 7) succeeds with valid maintenance token', async () => {
      const freshToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: freshToken, username: 'admin2' });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': freshToken },
        body: {
          username: 'admin2',
          password: 'OrdPass@456',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 200);
      assert(res.json?.token, 'Must return JWT token');
      assert.strictEqual(res.json?.user?.id, 7);
      assert.strictEqual(res.json?.user?.role, 'admin');
      assert.strictEqual(res.json?.user?.is_super_admin, 0);

      // Verify token payload claims: type: 'access', sessionId, token_version
      const decoded = jwt.decode(res.json.token);
      assert.strictEqual(decoded.type, 'access', 'Must contain type: access claim');
      assert.strictEqual(decoded.token_version, 1, 'Must contain token_version claim');
      assert(decoded.sessionId, 'Must contain sessionId claim');

      ordAdminToken = res.json.token;
    });

    // ── TEST R: Non-Admin Rejection (student1) via Real Route ─────────────────
    await runTest('Non-admin user (student1) attempting admin login is rejected (HTTP 400)', async () => {
      const freshToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: freshToken });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': freshToken },
        body: {
          username: 'student1',
          password: 'StudentPass@789',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 400);
      assert(res.json?.error.includes('Admin usernames must start with "admin@"'));
    });

    // ── TEST S: Wrong Password Rejection via Real Route ───────────────────────
    await runTest('Wrong password for valid admin account is rejected (HTTP 401)', async () => {
      const freshToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: freshToken, username: 'admin2' });

      const res = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': freshToken },
        body: {
          username: 'admin2',
          password: 'IncorrectPassword!@#',
          type: 'admin'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.json?.error, 'Invalid credentials');
    });

    // ── TEST T: MFA Challenge & Verification via Real Route (admin@abir, ID 1) ─
    let superAdminToken = null;
    await runTest('MFA challenge issuance and TOTP verification flow (admin@abir, ID 1)', async () => {
      const freshToken = crypto.randomBytes(32).toString('hex');
      setCapability({ attemptId: validAttemptId, token: freshToken, username: 'admin@abir' });

      // 1. Initial login returns requireMfa: true
      const loginRes = await sendJsonRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-bfi-maintenance-token': freshToken },
        body: {
          username: 'admin@abir',
          password: 'SuperPass@123',
          type: 'admin'
        }
      });

      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.json?.requireMfa, true);
      assert(loginRes.json?.mfaToken, 'Must issue single-use mfaToken challenge');
      const mfaToken = loginRes.json.mfaToken;

      // 2. Incorrect TOTP verification code fails (HTTP 400)
      const badMfaRes = await sendJsonRequest(`${baseUrl}/api/auth/mfa-verify`, {
        method: 'POST',
        body: {
          mfaToken,
          code: '000000'
        }
      });
      assert.strictEqual(badMfaRes.status, 400);
      assert.strictEqual(badMfaRes.json?.error, 'Invalid verification code.');

      // 3. Valid TOTP verification code succeeds
      const totpCode = totpModule.generateTotpCode(base32TotpSecret);

      const goodMfaRes = await sendJsonRequest(`${baseUrl}/api/auth/mfa-verify`, {
        method: 'POST',
        body: {
          mfaToken,
          code: totpCode
        }
      });

      assert.strictEqual(goodMfaRes.status, 200);
      assert(goodMfaRes.json?.token, 'Must return final access token');
      assert.strictEqual(goodMfaRes.json?.user?.id, 1);
      assert.strictEqual(goodMfaRes.json?.user?.is_super_admin, 1);

      const decoded = jwt.decode(goodMfaRes.json.token);
      assert.strictEqual(decoded.type, 'access');
      assert.strictEqual(decoded.token_version, 1);
      assert(decoded.sessionId);

      superAdminToken = goodMfaRes.json.token;
    });

    // ── TEST U: Profile Role Guards via Real GET /api/auth/me Route ───────────
    await runTest('Profile verification GET /api/auth/me confirms roles and super admin flags', async () => {
      // 1. Super Admin profile check
      const saProfile = await verifyAdminIdentity({
        baseUrl,
        token: superAdminToken,
        expectedId: 1,
        expectedRole: 'admin',
        expectedSuperAdmin: true
      });
      assert.strictEqual(saProfile.id, 1);
      assert.strictEqual(saProfile.role, 'admin');
      assert.strictEqual(saProfile.is_super_admin, 1);

      // 2. Ordinary Admin profile check
      const oaProfile = await verifyAdminIdentity({
        baseUrl,
        token: ordAdminToken,
        expectedId: 7,
        expectedRole: 'admin',
        expectedSuperAdmin: false
      });
      assert.strictEqual(oaProfile.id, 7);
      assert.strictEqual(oaProfile.role, 'admin');
      assert.strictEqual(oaProfile.is_super_admin, 0);
    });

  } finally {
    await new Promise(res => server.close(res));
    try { fs.rmSync(tempTestDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passedTests}/${totalTests} tests passed.`);
  console.log('================================================================\n');

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

module.exports = { main };
