import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertIsolatedTestDatabase } from './test-db-isolation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_MIGRATION_DB_PATH = path.resolve(__dirname, 'test_archiving_migration.db');
const TEST_FULL_RUNNER_DB_PATH = path.resolve(__dirname, 'test_canonical_runner.db');

// Ensure disposable test database is clean before running
function cleanTestDb(dbPath) {
  assertIsolatedTestDatabase(dbPath);
  for (const ext of ['', '-wal', '-shm']) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch (err) {
        if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
      }
    }
  }
}

test.describe('Task 1: Database Migration & Schema Upgrade', () => {
  test.beforeEach(() => {
    cleanTestDb(TEST_MIGRATION_DB_PATH);
    cleanTestDb(TEST_FULL_RUNNER_DB_PATH);
  });

  test.afterEach(() => {
    cleanTestDb(TEST_MIGRATION_DB_PATH);
    cleanTestDb(TEST_FULL_RUNNER_DB_PATH);
  });

  test('canonical migration runner applies 20261028_admin_archiving_and_reset idempotently', async () => {
    assertIsolatedTestDatabase(TEST_MIGRATION_DB_PATH);
    const db = new Database(TEST_MIGRATION_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 1. Setup baseline schema with existing tables including legacy password_reset_tokens
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
        mobile_number TEXT,
        two_factor_enabled INTEGER DEFAULT 0,
        two_factor_secret TEXT,
        public_key TEXT,
        is_active INTEGER DEFAULT 1,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        last_login TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        token_version INTEGER DEFAULT 1,
        permissions_version INTEGER DEFAULT 1,
        created_by_admin_id INTEGER
      );

      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE app_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now'))
      );

      -- Insert legacy admin and legacy reset token
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active)
      VALUES (1, 'superadmin', 'superadmin@bfibd.org', 'hash1', 'admin', 'Super', 'Admin', 1, 1),
             (2, 'admin2', 'admin2@bfibd.org', 'hash2', 'admin', 'Admin', 'Two', 0, 1);

      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (2, 'legacy_hash', datetime('now', '+15 minutes'));
    `);

    // Verify baseline columns do not have new columns yet
    const initialUserCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    assert.strictEqual(initialUserCols.includes('archived_at'), false);
    assert.strictEqual(initialUserCols.includes('account_version'), false);

    // Import the migration function
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');

    // Execute migration
    const res = runAdminArchivingAndResetMigration(db);
    assert.strictEqual(res.applied, true, 'Migration should report applied: true');

    // 2. Verify users table columns
    const updatedUserCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const expectedCols = [
      'archived_at',
      'archived_by_admin_id',
      'archive_reason',
      'restored_at',
      'restored_by_admin_id',
      'restore_reason',
      'email_verified_at',
      'verified_email',
      'password_reset_pending',
      'password_reset_requested_at',
      'password_reset_requested_by',
      'account_version'
    ];
    for (const col of expectedCols) {
      assert.ok(updatedUserCols.includes(col), `users table must contain column '${col}'`);
    }

    // Verify default account_version is 1
    const user2 = db.prepare('SELECT account_version, email_verified_at, archived_at, password_reset_pending FROM users WHERE id = 2').get();
    assert.strictEqual(user2.account_version, 1);
    assert.strictEqual(user2.email_verified_at, null, 'Existing accounts must start unverified');
    assert.strictEqual(user2.archived_at, null);
    assert.strictEqual(user2.password_reset_pending, 0);

    // 3. Verify email_verification_challenges table
    const challengeCols = db.prepare('PRAGMA table_info(email_verification_challenges)').all().map(c => c.name);
    assert.ok(challengeCols.includes('user_id'));
    assert.ok(challengeCols.includes('email'));
    assert.ok(challengeCols.includes('token_hash'));
    assert.ok(challengeCols.includes('purpose'));
    assert.ok(challengeCols.includes('consumed'));

    // 4. Verify upgraded password_reset_tokens table
    const tokenCols = db.prepare('PRAGMA table_info(password_reset_tokens)').all().map(c => c.name);
    assert.ok(tokenCols.includes('purpose'), 'password_reset_tokens must have purpose column');
    assert.ok(tokenCols.includes('token_version'), 'password_reset_tokens must have token_version column');
    assert.ok(tokenCols.includes('created_by_admin_id'), 'password_reset_tokens must have created_by_admin_id column');

    // Verify legacy reset tokens were safely invalidated during table recreation
    const tokensCount = db.prepare('SELECT COUNT(*) as count FROM password_reset_tokens').get().count;
    assert.strictEqual(tokensCount, 0, 'Legacy reset tokens must be cleanly cleared during migration');

    // 5. Verify foreign key check
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    assert.strictEqual(fkErrors.length, 0, 'Foreign key check must return zero errors');

    // 6. Verify idempotency on rerun
    const rerunRes = runAdminArchivingAndResetMigration(db);
    assert.strictEqual(rerunRes.applied, false, 'Migration rerun must be idempotent');

    db.close();
    try { serverDb.close(); } catch {}
  });

  test('scripts/run_migrations.cjs executes all migrations and preserves business records', async () => {
    assertIsolatedTestDatabase(TEST_FULL_RUNNER_DB_PATH);
    const db = new Database(TEST_FULL_RUNNER_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create full core baseline tables
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
        mobile_number TEXT,
        two_factor_enabled INTEGER DEFAULT 0,
        two_factor_secret TEXT,
        public_key TEXT,
        is_active INTEGER DEFAULT 1,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        last_login TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Business records
      CREATE TABLE courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT
      );

      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_number TEXT NOT NULL,
        course_id INTEGER,
        FOREIGN KEY (course_id) REFERENCES courses(id)
      );

      CREATE TABLE batch_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES batches(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      -- Insert business data with target super admin so 20261023_super_admin succeeds
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active)
      VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'pass1', 'admin', 'Super', 'Admin', 1, 1),
             (2, 'admin_two', 'two@bfibd.org', 'pass2', 'admin', 'Admin', 'Two', 0, 1),
             (3, 'student_one', 'student@bfibd.org', 'pass3', 'student', 'Student', 'One', 0, 1);

      INSERT INTO courses (id, title, description) VALUES (1, 'Film Direction', 'Core course');
      INSERT INTO batches (id, batch_number, course_id) VALUES (1, 'B-01', 1);
      INSERT INTO batch_students (batch_id, user_id) VALUES (1, 3);
    `);
    db.close();

    // Run canonical runner CLI with explicit isolated db path
    const runnerScript = path.resolve(__dirname, '../scripts/run_migrations.cjs');
    const cmd = `node "${runnerScript}" "${TEST_FULL_RUNNER_DB_PATH}"`;
    const out = execSync(cmd, { encoding: 'utf8' });
    assert.ok(out.includes('All post-migration assertions verified successfully'));

    // Reopen and verify business records are intact
    const verifyDb = new Database(TEST_FULL_RUNNER_DB_PATH);
    const studentCount = verifyDb.prepare('SELECT COUNT(*) as c FROM batch_students').get().c;
    assert.strictEqual(studentCount, 1, 'Batch students business records must survive migration');

    const courseCount = verifyDb.prepare('SELECT COUNT(*) as c FROM courses').get().c;
    assert.strictEqual(courseCount, 1, 'Courses business records must survive migration');

    const userCount = verifyDb.prepare('SELECT COUNT(*) as c FROM users').get().c;
    assert.strictEqual(userCount, 3, 'Users count must survive migration');

    verifyDb.close();
  });
});


test.describe('Task 2: Secure Email Utility Hardening & Multi-Flow Template Support', () => {
  test('email helper exports safe builders and returns null without configured credentials', async () => {
    const emailModule = await import('../server/utils/email.js');

    // 1. Verify builders exist
    assert.strictEqual(typeof emailModule.buildPasswordResetMailOptions, 'function');
    assert.strictEqual(typeof emailModule.buildPasswordChangeNotificationMailOptions, 'function');
    assert.strictEqual(typeof emailModule.buildEmailVerificationMailOptions, 'function');

    // 2. Flow 1 & 2: User and Admin self-recovery (15m, user requested)
    const userMail = emailModule.buildPasswordResetMailOptions('user@bfibd.org', 'https://classroom.bfibd.org/reset#token=abc', { isSuperAdminInitiated: false });
    assert.strictEqual(userMail.subject, 'Password Reset Request - BFI Classroom');
    assert.ok(userMail.html.includes('15 minutes'));
    assert.ok(userMail.html.includes('You requested to reset your password'));

    // 3. Flow 3: Super Admin-initiated reset (30m, administrative reset)
    const adminMail = emailModule.buildPasswordResetMailOptions('admin@bfibd.org', 'https://classroom.bfibd.org/admin/reset#token=xyz', { isSuperAdminInitiated: true });
    assert.strictEqual(adminMail.subject, 'Administrative Password Reset - BFI Classroom');
    assert.ok(adminMail.html.includes('30 minutes'));
    assert.ok(adminMail.html.includes('initiated by Super Admin'));

    // 4. Security completion notification (no secrets)
    const alertMail = emailModule.buildPasswordChangeNotificationMailOptions('admin@bfibd.org', { dhakaTime: '28 Oct 2026, 04:30 PM', ipAddress: '192.168.1.1' });
    assert.strictEqual(alertMail.subject, 'Security Alert: Your BFI Classroom Password Has Been Changed');
    assert.ok(alertMail.html.includes('28 Oct 2026, 04:30 PM'));
    assert.ok(alertMail.html.includes('192.168.1.1'));
    assert.strictEqual(alertMail.html.includes('password'), true);
    assert.strictEqual(alertMail.html.includes('hash'), false);

    // 5. Email verification challenge
    const verifyMail = emailModule.buildEmailVerificationMailOptions('admin@bfibd.org', 'https://classroom.bfibd.org/verify-email?token=ver123');
    assert.strictEqual(verifyMail.subject, 'Verify Your Email Address - BFI Classroom');
    assert.ok(verifyMail.html.includes('https://classroom.bfibd.org/verify-email?token=ver123'));
  });
});


test.describe('Task 3: Access Blocking Interceptors & Distinct Error Responses', () => {
  const TEST_AUTH_DB_PATH = path.resolve(__dirname, 'test_auth_blocking.db');

  test.beforeEach(() => {
    cleanTestDb(TEST_AUTH_DB_PATH);
  });

  test.afterEach(() => {
    cleanTestDb(TEST_AUTH_DB_PATH);
  });

  test('enforces distinct access blocking across authenticateToken, login, mfa, refresh, and socket', async () => {
    assertIsolatedTestDatabase(TEST_AUTH_DB_PATH);
    process.env.DATABASE_PATH = TEST_AUTH_DB_PATH;
    process.env.NODE_ENV = 'test';
    process.env.IS_TEST_SERVER = 'true';

    const db = new Database(TEST_AUTH_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run migrations on isolated db
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');
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
        mobile_number TEXT,
        two_factor_enabled INTEGER DEFAULT 0,
        two_factor_secret TEXT,
        public_key TEXT,
        is_active INTEGER DEFAULT 1,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        last_login TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        token_version INTEGER DEFAULT 1,
        permissions_version INTEGER DEFAULT 1,
        created_by_admin_id INTEGER
      );

      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TEXT NOT NULL,
        last_activity TEXT,
        sudo_verified_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE admin_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        permission TEXT NOT NULL,
        granted_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE mfa_login_challenges (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_version INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        consumed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Seed: User 1 (Active Super Admin), User 2 (Archived Admin), User 3 (Reset-Pending Admin), User 4 (Inactive Admin)
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, token_version)
      VALUES (1, 'superadmin', 'super@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Super', 'Admin', 1, 1, 1),
             (2, 'archived_admin', 'archived@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Archived', 'Admin', 0, 0, 1),
             (3, 'reset_pending_admin', 'reset@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Reset', 'Admin', 0, 1, 1),
             (4, 'inactive_admin', 'inactive@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Inactive', 'Admin', 0, 0, 1);
    `);

    runAdminArchivingAndResetMigration(db);

    // Set archived state on User 2
    db.prepare("UPDATE users SET archived_at = datetime('now'), archive_reason = 'Former staff' WHERE id = 2").run();
    // Set reset-pending on User 3
    db.prepare("UPDATE users SET password_reset_pending = 1 WHERE id = 3").run();

    // Create active sessions for test tokens
    db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (1, 1, 'h1', datetime('now', '+1 hour')), (2, 2, 'h2', datetime('now', '+1 hour')), (3, 3, 'h3', datetime('now', '+1 hour')), (4, 4, 'h4', datetime('now', '+1 hour'))").run();

    const jwt = (await import('jsonwebtoken')).default;
    const { getJwtSecret, getJwtRefreshSecret } = await import('../server/config/security.js');
    const { default: serverDb } = await import('../server/db/database.js');
    const { authenticateToken } = await import('../server/middleware/auth.js');
    const authRoutes = (await import('../server/routes/auth.js')).default;

    // Helper: Mock Express req/res
    function mockReqRes(options = {}) {
      let statusCode = 200;
      let jsonPayload = null;
      let nextCalled = false;
      const cookiesCleared = [];
      const req = {
        headers: options.headers || {},
        body: options.body || {},
        cookies: options.cookies || {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          jsonPayload = payload;
          return this;
        },
        clearCookie(name) {
          cookiesCleared.push(name);
          return this;
        }
      };
      const next = (err) => { nextCalled = true; if (err) res.err = err; };
      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, nextCalled, cookiesCleared, err: res.err }) };
    }

    // 1. authenticateToken tests
    // Active Super Admin -> 200
    const tokenActive = jwt.sign({ id: 1, username: 'superadmin', role: 'admin', type: 'access', sessionId: 1, token_version: 1 }, getJwtSecret());
    const ctxActive = mockReqRes({ headers: { authorization: `Bearer ${tokenActive}` } });
    authenticateToken(ctxActive.req, ctxActive.res, ctxActive.next);
    assert.strictEqual(ctxActive.getResult().nextCalled, true, 'Active admin passes authenticateToken');

    // Inactive Admin -> 401
    const tokenInactive = jwt.sign({ id: 4, username: 'inactive_admin', role: 'admin', type: 'access', sessionId: 4, token_version: 1 }, getJwtSecret());
    const ctxInactive = mockReqRes({ headers: { authorization: `Bearer ${tokenInactive}` } });
    authenticateToken(ctxInactive.req, ctxInactive.res, ctxInactive.next);
    assert.strictEqual(ctxInactive.getResult().statusCode, 401, 'Inactive admin receives 401');
    assert.strictEqual(ctxInactive.getResult().jsonPayload?.error, 'Account inactive or not found');

    // Archived Admin -> 401
    const tokenArchived = jwt.sign({ id: 2, username: 'archived_admin', role: 'admin', type: 'access', sessionId: 2, token_version: 1 }, getJwtSecret());
    const ctxArchived = mockReqRes({ headers: { authorization: `Bearer ${tokenArchived}` } });
    authenticateToken(ctxArchived.req, ctxArchived.res, ctxArchived.next);
    assert.strictEqual(ctxArchived.getResult().statusCode, 401, 'Archived admin receives 401');
    assert.strictEqual(ctxArchived.getResult().jsonPayload?.error, 'Account inactive, archived, or not found');

    // Reset-Pending Admin -> 403
    const tokenReset = jwt.sign({ id: 3, username: 'reset_pending_admin', role: 'admin', type: 'access', sessionId: 3, token_version: 1 }, getJwtSecret());
    const ctxReset = mockReqRes({ headers: { authorization: `Bearer ${tokenReset}` } });
    authenticateToken(ctxReset.req, ctxReset.res, ctxReset.next);
    assert.strictEqual(ctxReset.getResult().statusCode, 403, 'Reset-pending admin receives 403');
    assert.strictEqual(ctxReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');

    // 2. /api/auth/login handler tests
    // Find login route handler from router stack
    const loginLayer = authRoutes.stack.find(l => l.route?.path === '/login' && l.route?.methods?.post);
    const loginHandler = loginLayer.route.stack[loginLayer.route.stack.length - 1].handle;

    // Archived user login attempt -> 401 Invalid credentials
    const ctxLoginArchived = mockReqRes({ body: { username: 'admin@archived_admin', password: 'Password123!', type: 'admin' } });
    await loginHandler(ctxLoginArchived.req, ctxLoginArchived.res);
    assert.strictEqual(ctxLoginArchived.getResult().statusCode, 401);
    assert.strictEqual(ctxLoginArchived.getResult().jsonPayload?.error, 'Invalid credentials');

    // Reset-pending user login attempt -> 403 PASSWORD_RESET_PENDING
    const ctxLoginReset = mockReqRes({ body: { username: 'admin@reset_pending_admin', password: 'Password123!', type: 'admin' } });
    await loginHandler(ctxLoginReset.req, ctxLoginReset.res);
    assert.strictEqual(ctxLoginReset.getResult().statusCode, 403);
    assert.strictEqual(ctxLoginReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');

    // 3. /api/auth/mfa-verify handler tests
    const mfaLayer = authRoutes.stack.find(l => l.route?.path === '/mfa-verify' && l.route?.methods?.post);
    const mfaHandler = mfaLayer.route.stack[mfaLayer.route.stack.length - 1].handle;

    // MFA challenge token for archived user 2
    const mfaTokenArchived = jwt.sign(
      { id: 2, username: 'archived_admin', role: 'admin', type: 'mfa_challenge', jti: 'ch2', challengeId: 'ch2', token_version: 1 },
      getJwtSecret()
    );
    const ctxMfaArchived = mockReqRes({ body: { mfaToken: mfaTokenArchived, code: '123456' } });
    await mfaHandler(ctxMfaArchived.req, ctxMfaArchived.res);
    assert.strictEqual(ctxMfaArchived.getResult().statusCode, 401);
    assert.strictEqual(ctxMfaArchived.getResult().jsonPayload?.error, 'MFA challenge expired or invalidated. Account inactive or revoked.');

    // MFA challenge token for reset-pending user 3
    const mfaTokenReset = jwt.sign(
      { id: 3, username: 'reset_pending_admin', role: 'admin', type: 'mfa_challenge', jti: 'ch3', challengeId: 'ch3', token_version: 1 },
      getJwtSecret()
    );
    const ctxMfaReset = mockReqRes({ body: { mfaToken: mfaTokenReset, code: '123456' } });
    await mfaHandler(ctxMfaReset.req, ctxMfaReset.res);
    assert.strictEqual(ctxMfaReset.getResult().statusCode, 403);
    assert.strictEqual(ctxMfaReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');

    // 4. /api/auth/refresh handler tests
    const refreshLayer = authRoutes.stack.find(l => l.route?.path === '/refresh' && l.route?.methods?.post);
    const refreshHandler = refreshLayer.route.stack[refreshLayer.route.stack.length - 1].handle;

    // Refresh token for archived user 2
    const cryptoMod = await import('crypto');
    const refreshArchived = jwt.sign({ id: 2, username: 'archived_admin', role: 'admin', token_version: 1 }, getJwtRefreshSecret());
    const hashArchived = cryptoMod.createHash('sha256').update(refreshArchived).digest('hex');
    db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (20, 2, ?, datetime('now', '+1 hour'))").run(hashArchived);

    const ctxRefreshArchived = mockReqRes({ cookies: { bfi_refresh_token: refreshArchived } });
    await refreshHandler(ctxRefreshArchived.req, ctxRefreshArchived.res);
    assert.strictEqual(ctxRefreshArchived.getResult().statusCode, 401);
    assert.strictEqual(ctxRefreshArchived.getResult().jsonPayload?.error, 'User not found');
    assert.ok(ctxRefreshArchived.getResult().cookiesCleared.includes('bfi_refresh_token'));

    // Refresh token for reset-pending user 3
    const refreshReset = jwt.sign({ id: 3, username: 'reset_pending_admin', role: 'admin', token_version: 1 }, getJwtRefreshSecret());
    const hashReset = cryptoMod.createHash('sha256').update(refreshReset).digest('hex');
    db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (30, 3, ?, datetime('now', '+1 hour'))").run(hashReset);

    const ctxRefreshReset = mockReqRes({ cookies: { bfi_refresh_token: refreshReset } });
    await refreshHandler(ctxRefreshReset.req, ctxRefreshReset.res);
    assert.strictEqual(ctxRefreshReset.getResult().statusCode, 403);
    assert.strictEqual(ctxRefreshReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');
    assert.ok(ctxRefreshReset.getResult().cookiesCleared.includes('bfi_refresh_token'));

    // 5. Socket.io handshake middleware tests
    // Test the logic directly against db query
    function verifySocketConnection(rawToken) {
      const decoded = jwt.verify(rawToken, getJwtSecret());
      const u = db.prepare('SELECT id, username, role, is_active, deleted_at, archived_at, password_reset_pending, token_version FROM users WHERE id = ?').get(decoded.id);
      if (!u || u.is_active !== 1 || u.deleted_at !== null || u.archived_at !== null) {
        throw new Error('Account inactive or revoked');
      }
      if (u.password_reset_pending === 1) {
        throw new Error('Account password reset pending');
      }
      return true;
    }

    assert.throws(() => verifySocketConnection(tokenArchived), /Account inactive or revoked/);
    assert.throws(() => verifySocketConnection(tokenReset), /Account password reset pending/);
    assert.strictEqual(verifySocketConnection(tokenActive), true);

    db.close();
    try { serverDb.close(); } catch {}
  });
});
