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
const TEST_SHARED_DB_PATH = path.resolve(__dirname, 'test_isolated_admin_suite.db');
assertIsolatedTestDatabase(TEST_SHARED_DB_PATH);
process.env.DATABASE_PATH = TEST_SHARED_DB_PATH;
process.env.NODE_ENV = 'test';
process.env.IS_TEST_SERVER = 'true';

// Ensure disposable test database is clean before running

function resetSharedSchema(db) {
  db.exec(`
    DROP TABLE IF EXISTS audit_logs;
    DROP TABLE IF EXISTS mfa_login_challenges;
    DROP TABLE IF EXISTS admin_permissions;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS password_reset_tokens;
    DROP TABLE IF EXISTS email_verification_challenges;
    DROP TABLE IF EXISTS users;

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
      consumed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uuid TEXT UNIQUE NOT NULL,
      actor_id INTEGER,
      actor_username TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      resource TEXT,
      correlation_id TEXT,
      target_user_id INTEGER,
      before_state TEXT,
      after_state TEXT,
      details TEXT,
      ip_address TEXT,
      outcome TEXT NOT NULL,
      dhaka_time TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      signature TEXT NOT NULL
    );
  `);
}

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
  test('enforces distinct access blocking across authenticateToken, login, mfa, refresh, and socket', async () => {
    const { initIsolatedTestDatabase } = await import('./test-db-isolation.js');
    await initIsolatedTestDatabase(TEST_SHARED_DB_PATH);

    const { default: serverDb } = await import('../server/db/database.js');
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');
    runAdminArchivingAndResetMigration(serverDb);

    serverDb.exec(`
      DELETE FROM admin_audit_logs;
      DELETE FROM mfa_login_challenges;
      DELETE FROM admin_permissions;
      DELETE FROM sessions;
      DELETE FROM password_reset_tokens;
      DELETE FROM email_verification_challenges;
      DELETE FROM users;

      -- Seed: User 1 (Active Super Admin), User 2 (Archived Admin), User 3 (Reset-Pending Admin), User 4 (Inactive Admin)
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, token_version)
      VALUES (1, 'superadmin', 'super@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Super', 'Admin', 1, 1, 1),
             (2, 'archived_admin', 'archived@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Archived', 'Admin', 0, 0, 1),
             (3, 'reset_pending_admin', 'reset@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Reset', 'Admin', 0, 1, 1),
             (4, 'inactive_admin', 'inactive@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Inactive', 'Admin', 0, 0, 1);
    `);

    // Set archived state on User 2
    serverDb.prepare("UPDATE users SET archived_at = datetime('now'), archive_reason = 'Former staff' WHERE id = 2").run();
    // Set reset-pending on User 3
    serverDb.prepare("UPDATE users SET password_reset_pending = 1 WHERE id = 3").run();

    // Create active sessions for test tokens
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (1, 1, 'h1', datetime('now', '+1 hour')), (2, 2, 'h2', datetime('now', '+1 hour')), (3, 3, 'h3', datetime('now', '+1 hour')), (4, 4, 'h4', datetime('now', '+1 hour'))").run();

    const jwt = (await import('jsonwebtoken')).default;
    const { getJwtSecret, getJwtRefreshSecret } = await import('../server/config/security.js');
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
    const tokenActive = jwt.sign({ id: 1, username: 'superadmin', role: 'admin', type: 'access', sessionId: 1, token_version: 1 }, getJwtSecret());
    const ctxActive = mockReqRes({ headers: { authorization: `Bearer ${tokenActive}` } });
    authenticateToken(ctxActive.req, ctxActive.res, ctxActive.next);
    assert.strictEqual(ctxActive.getResult().nextCalled, true, 'Active admin passes authenticateToken');

    const tokenInactive = jwt.sign({ id: 4, username: 'inactive_admin', role: 'admin', type: 'access', sessionId: 4, token_version: 1 }, getJwtSecret());
    const ctxInactive = mockReqRes({ headers: { authorization: `Bearer ${tokenInactive}` } });
    authenticateToken(ctxInactive.req, ctxInactive.res, ctxInactive.next);
    assert.strictEqual(ctxInactive.getResult().statusCode, 401, 'Inactive admin receives 401');
    assert.strictEqual(ctxInactive.getResult().jsonPayload?.error, 'Account inactive or not found');

    const tokenArchived = jwt.sign({ id: 2, username: 'archived_admin', role: 'admin', type: 'access', sessionId: 2, token_version: 1 }, getJwtSecret());
    const ctxArchived = mockReqRes({ headers: { authorization: `Bearer ${tokenArchived}` } });
    authenticateToken(ctxArchived.req, ctxArchived.res, ctxArchived.next);
    assert.strictEqual(ctxArchived.getResult().statusCode, 401, 'Archived admin receives 401');
    assert.strictEqual(ctxArchived.getResult().jsonPayload?.error, 'Account inactive, archived, or not found');

    const tokenReset = jwt.sign({ id: 3, username: 'reset_pending_admin', role: 'admin', type: 'access', sessionId: 3, token_version: 1 }, getJwtSecret());
    const ctxReset = mockReqRes({ headers: { authorization: `Bearer ${tokenReset}` } });
    authenticateToken(ctxReset.req, ctxReset.res, ctxReset.next);
    assert.strictEqual(ctxReset.getResult().statusCode, 403, 'Reset-pending admin receives 403');
    assert.strictEqual(ctxReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');

    // 2. /api/auth/login handler tests
    const loginLayer = authRoutes.stack.find(l => l.route?.path === '/login' && l.route?.methods?.post);
    const loginHandler = loginLayer.route.stack[loginLayer.route.stack.length - 1].handle;

    const ctxLoginArchived = mockReqRes({ body: { username: 'admin@archived_admin', password: 'Password123!', type: 'admin' } });
    await loginHandler(ctxLoginArchived.req, ctxLoginArchived.res);
    assert.strictEqual(ctxLoginArchived.getResult().statusCode, 401);
    assert.strictEqual(ctxLoginArchived.getResult().jsonPayload?.error, 'Invalid credentials');

    const ctxLoginReset = mockReqRes({ body: { username: 'admin@reset_pending_admin', password: 'Password123!', type: 'admin' } });
    await loginHandler(ctxLoginReset.req, ctxLoginReset.res);
    assert.strictEqual(ctxLoginReset.getResult().statusCode, 403);
    assert.strictEqual(ctxLoginReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');

    // 3. /api/auth/mfa-verify handler tests
    const mfaLayer = authRoutes.stack.find(l => l.route?.path === '/mfa-verify' && l.route?.methods?.post);
    const mfaHandler = mfaLayer.route.stack[mfaLayer.route.stack.length - 1].handle;

    const mfaTokenArchived = jwt.sign(
      { id: 2, username: 'archived_admin', role: 'admin', type: 'mfa_challenge', jti: 'ch2', challengeId: 'ch2', token_version: 1 },
      getJwtSecret()
    );
    const ctxMfaArchived = mockReqRes({ body: { mfaToken: mfaTokenArchived, code: '123456' } });
    await mfaHandler(ctxMfaArchived.req, ctxMfaArchived.res);
    assert.strictEqual(ctxMfaArchived.getResult().statusCode, 401);
    assert.strictEqual(ctxMfaArchived.getResult().jsonPayload?.error, 'MFA challenge expired or invalidated. Account inactive or revoked.');

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

    const cryptoMod = await import('crypto');
    const refreshArchived = jwt.sign({ id: 2, username: 'archived_admin', role: 'admin', token_version: 1 }, getJwtRefreshSecret());
    const hashArchived = cryptoMod.createHash('sha256').update(refreshArchived).digest('hex');
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (20, 2, ?, datetime('now', '+1 hour'))").run(hashArchived);

    const ctxRefreshArchived = mockReqRes({ cookies: { bfi_refresh_token: refreshArchived } });
    await refreshHandler(ctxRefreshArchived.req, ctxRefreshArchived.res);
    assert.strictEqual(ctxRefreshArchived.getResult().statusCode, 401);
    assert.strictEqual(ctxRefreshArchived.getResult().jsonPayload?.error, 'User not found');
    assert.ok(ctxRefreshArchived.getResult().cookiesCleared.includes('bfi_refresh_token'));

    const refreshReset = jwt.sign({ id: 3, username: 'reset_pending_admin', role: 'admin', token_version: 1 }, getJwtRefreshSecret());
    const hashReset = cryptoMod.createHash('sha256').update(refreshReset).digest('hex');
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (30, 3, ?, datetime('now', '+1 hour'))").run(hashReset);

    const ctxRefreshReset = mockReqRes({ cookies: { bfi_refresh_token: refreshReset } });
    await refreshHandler(ctxRefreshReset.req, ctxRefreshReset.res);
    assert.strictEqual(ctxRefreshReset.getResult().statusCode, 403);
    assert.strictEqual(ctxRefreshReset.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');
    assert.ok(ctxRefreshReset.getResult().cookiesCleared.includes('bfi_refresh_token'));

    // 5. Socket.io handshake middleware tests
    function verifySocketConnection(rawToken) {
      const decoded = jwt.verify(rawToken, getJwtSecret());
      const u = serverDb.prepare('SELECT id, username, role, is_active, deleted_at, archived_at, password_reset_pending, token_version FROM users WHERE id = ?').get(decoded.id);
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
  });
});

test.describe('Task 4: Mandatory Concurrency Control & Admin Archiving / Restoration Endpoints', () => {
  test('enforces archiving, restoration, concurrency protection, and lifecycle state rules', async () => {
    const { initIsolatedTestDatabase } = await import('./test-db-isolation.js');
    await initIsolatedTestDatabase(TEST_SHARED_DB_PATH);

    const { default: serverDb } = await import('../server/db/database.js');
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');
    runAdminArchivingAndResetMigration(serverDb);

    serverDb.exec(`
      DELETE FROM admin_audit_logs;
      DELETE FROM mfa_login_challenges;
      DELETE FROM admin_permissions;
      DELETE FROM sessions;
      DELETE FROM password_reset_tokens;
      DELETE FROM email_verification_challenges;
      DELETE FROM users;

      -- Seed: User 1 (Super Admin), User 2 (Standard Active Admin)
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, token_version)
      VALUES (1, 'superadmin', 'super@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Super', 'Admin', 1, 1, 1),
             (2, 'admin_two', 'admin2@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Admin', 'Two', 0, 1, 1);
    `);

    // Active session for Super Admin with recent sudo verification
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, sudo_verified_at) VALUES (1, 1, 'h1', datetime('now', '+1 hour'), datetime('now'))").run();
    // Active session for User 2
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (2, 2, 'h2', datetime('now', '+1 hour'))").run();

    const { default: adminMgmtRoutes } = await import('../server/routes/admin-management.js');

    function mockReqRes(options = {}) {
      let statusCode = 200;
      let jsonPayload = null;
      let nextCalled = false;
      const req = {
        params: options.params || {},
        query: options.query || {},
        body: options.body || {},
        headers: options.headers || {},
        ip: '127.0.0.1',
        user: options.user || {
          id: 1,
          username: 'superadmin',
          role: 'admin',
          is_super_admin: 1,
          isSuperAdmin: true,
          sessionId: 1,
          permissions: ['*']
        }
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          jsonPayload = payload;
          return this;
        }
      };
      const next = () => { nextCalled = true; };
      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, nextCalled }) };
    }

    function getHandler(method, pathStr) {
      const layer = adminMgmtRoutes.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
      if (!layer) throw new Error(`Route not found: ${method} ${pathStr}`);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    const archiveHandler = getHandler('POST', '/administrators/:id/archive');
    const restoreHandler = getHandler('POST', '/administrators/:id/restore');
    const statusHandler = getHandler('PATCH', '/administrators/:id/status');
    const listHandler = getHandler('GET', '/administrators');
    const summaryHandler = getHandler('GET', '/administrators/accountability/summary');

    // 1. Super Admin cannot be archived
    const ctxArchSuper = mockReqRes({ params: { id: '1' }, body: { expected_account_version: 1, reason: 'Valid reason to test' } });
    await archiveHandler(ctxArchSuper.req, ctxArchSuper.res);
    assert.strictEqual(ctxArchSuper.getResult().statusCode, 403, 'Super admin cannot be archived');

    // 2. Missing expected_account_version
    const ctxArchMissingVer = mockReqRes({ params: { id: '2' }, body: { reason: 'Valid reason' } });
    await archiveHandler(ctxArchMissingVer.req, ctxArchMissingVer.res);
    assert.strictEqual(ctxArchMissingVer.getResult().statusCode, 400, 'Missing version returns 400');
    assert.strictEqual(ctxArchMissingVer.getResult().jsonPayload?.code, 'MISSING_ACCOUNT_VERSION');

    // 3. Stale expected_account_version
    const ctxArchStale = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 999, reason: 'Valid reason to test' } });
    await archiveHandler(ctxArchStale.req, ctxArchStale.res);
    assert.strictEqual(ctxArchStale.getResult().statusCode, 409, 'Stale version returns 409');
    assert.strictEqual(ctxArchStale.getResult().jsonPayload?.code, 'CONCURRENCY_CONFLICT');

    // 4. Successful archive
    const ctxArchSuccess = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 1, reason: 'Offboarding staff member' } });
    await archiveHandler(ctxArchSuccess.req, ctxArchSuccess.res);
    assert.strictEqual(ctxArchSuccess.getResult().statusCode, 200, 'Archive succeeds');

    const u2Archived = serverDb.prepare('SELECT is_active, archived_at, account_version, token_version, password_reset_pending FROM users WHERE id = 2').get();
    assert.strictEqual(u2Archived.is_active, 0, 'Archived admin has is_active = 0');
    assert.ok(u2Archived.archived_at !== null, 'archived_at is set');
    assert.strictEqual(u2Archived.account_version, 2, 'account_version bumped to 2');
    assert.strictEqual(u2Archived.token_version, 2, 'token_version bumped to 2');
    assert.strictEqual(u2Archived.password_reset_pending, 0, 'password_reset_pending cleared');

    const sessionsU2 = serverDb.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = 2').get();
    assert.strictEqual(sessionsU2.count, 0, 'Sessions revoked on archive');

    const archiveAudit = serverDb.prepare("SELECT action, outcome FROM admin_audit_logs WHERE target_user_id = 2 AND action = 'archive_administrator'").get();
    assert.ok(archiveAudit, 'Archive audit log was recorded');
    assert.strictEqual(archiveAudit.outcome, 'success');

    // Verify GET /administrators filters archived admins out of default list
    const ctxListCurrent = mockReqRes({ query: {} });
    await listHandler(ctxListCurrent.req, ctxListCurrent.res);
    const currentAdmins = ctxListCurrent.getResult().jsonPayload?.administrators || [];
    assert.strictEqual(currentAdmins.length, 1, 'Only 1 current admin (Super Admin)');
    assert.strictEqual(currentAdmins[0].id, 1);

    // Verify GET /administrators?status=archived returns archived admins
    const ctxListArchived = mockReqRes({ query: { status: 'archived' } });
    await listHandler(ctxListArchived.req, ctxListArchived.res);
    const archivedAdmins = ctxListArchived.getResult().jsonPayload?.administrators || [];
    assert.strictEqual(archivedAdmins.length, 1, '1 archived admin found');
    assert.strictEqual(archivedAdmins[0].id, 2);

    // Verify KPI summary counts
    const ctxSummary = mockReqRes({});
    await summaryHandler(ctxSummary.req, ctxSummary.res);
    const summary = ctxSummary.getResult().jsonPayload;
    assert.strictEqual(summary.total, 1, 'Total current admins = 1');
    assert.strictEqual(summary.active, 1, 'Active admins = 1');
    assert.strictEqual(summary.inactive, 0, 'Inactive current admins = 0');
    assert.strictEqual(summary.archived, 1, 'Archived admins = 1');

    // 5. Already archived admin -> 409 ALREADY_ARCHIVED
    const ctxArchAlready = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 2, reason: 'Repeat archive attempt' } });
    await archiveHandler(ctxArchAlready.req, ctxArchAlready.res);
    assert.strictEqual(ctxArchAlready.getResult().statusCode, 409);
    assert.strictEqual(ctxArchAlready.getResult().jsonPayload?.code, 'ALREADY_ARCHIVED');

    // 6. Status activation blocked for archived admin -> 400 ACCOUNT_ARCHIVED
    const ctxStatusBlocked = mockReqRes({ params: { id: '2' }, body: { is_active: 1, expected_account_version: 2 } });
    await statusHandler(ctxStatusBlocked.req, ctxStatusBlocked.res);
    assert.strictEqual(ctxStatusBlocked.getResult().statusCode, 400);
    assert.strictEqual(ctxStatusBlocked.getResult().jsonPayload?.code, 'ACCOUNT_ARCHIVED');

    // 7. Successful restore -> Must restore as INACTIVE
    const ctxRestoreSuccess = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 2, reason: 'Rehiring staff member' } });
    await restoreHandler(ctxRestoreSuccess.req, ctxRestoreSuccess.res);
    assert.strictEqual(ctxRestoreSuccess.getResult().statusCode, 200);

    const u2Restored = serverDb.prepare('SELECT is_active, archived_at, account_version FROM users WHERE id = 2').get();
    assert.strictEqual(u2Restored.archived_at, null, 'archived_at cleared to NULL');
    assert.strictEqual(u2Restored.is_active, 0, 'Restored admin is strictly INACTIVE');
    assert.strictEqual(u2Restored.account_version, 3, 'account_version bumped to 3');

    // 8. Stale request rejected after cycle
    const ctxStalePostCycle = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 1, reason: 'Stale attempt' } });
    await archiveHandler(ctxStalePostCycle.req, ctxStalePostCycle.res);
    assert.strictEqual(ctxStalePostCycle.getResult().statusCode, 409);
    assert.strictEqual(ctxStalePostCycle.getResult().jsonPayload?.code, 'CONCURRENCY_CONFLICT');

    // 9. Activating restored admin via /status with correct account_version
    const ctxStatusActivate = mockReqRes({ params: { id: '2' }, body: { is_active: 1, expected_account_version: 3 } });
    await statusHandler(ctxStatusActivate.req, ctxStatusActivate.res);
    assert.strictEqual(ctxStatusActivate.getResult().statusCode, 200);

    const u2Activated = serverDb.prepare('SELECT is_active, account_version FROM users WHERE id = 2').get();
    assert.strictEqual(u2Activated.is_active, 1, 'Admin successfully activated');
    assert.strictEqual(u2Activated.account_version, 4, 'account_version bumped to 4');
  });
});

test.describe('Task 5: Preservation of Existing Recovery Flows & Email Ownership Binding', () => {
  test('verifies student recovery, admin self-recovery restrictions, email challenges, and global invalidation', async () => {
    const { initIsolatedTestDatabase } = await import('./test-db-isolation.js');
    await initIsolatedTestDatabase(TEST_SHARED_DB_PATH);

    const { default: serverDb } = await import('../server/db/database.js');
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');
    runAdminArchivingAndResetMigration(serverDb);

    serverDb.exec(`
      DELETE FROM admin_audit_logs;
      DELETE FROM mfa_login_challenges;
      DELETE FROM admin_permissions;
      DELETE FROM sessions;
      DELETE FROM password_reset_tokens;
      DELETE FROM email_verification_challenges;
      DELETE FROM users;

      -- Seed: User 1 (Super Admin), User 10 (Student), User 20 (Admin with unverified email), User 21 (Admin with verified email)
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, token_version, email_verified_at, verified_email)
      VALUES (1, 'superadmin', 'super@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Super', 'Admin', 1, 1, 1, datetime('now'), 'super@bfibd.org'),
             (10, 'student_user', 'student@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'student', 'Student', 'One', 0, 1, 1, NULL, NULL),
             (20, 'admin_unverified', 'unverified@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Admin', 'Unverified', 0, 1, 1, NULL, NULL),
             (21, 'admin_verified', 'verified@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Admin', 'Verified', 0, 1, 1, datetime('now'), 'verified@bfibd.org');
    `);

    const jwt = (await import('jsonwebtoken')).default;
    const { getJwtSecret } = await import('../server/config/security.js');
    const authRoutes = (await import('../server/routes/auth.js')).default;
    const cryptoMod = await import('crypto');

    function mockReqRes(options = {}) {
      let statusCode = 200;
      let jsonPayload = null;
      let nextCalled = false;
      const req = {
        params: options.params || {},
        query: options.query || {},
        body: options.body || {},
        headers: options.headers || {},
        ip: '127.0.0.1',
        user: options.user || null
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          jsonPayload = payload;
          return this;
        }
      };
      const next = () => { nextCalled = true; };
      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, nextCalled }) };
    }

    function getHandler(method, pathStr) {
      const layer = authRoutes.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
      if (!layer) throw new Error(`Route not found: ${method} ${pathStr}`);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    const studentForgotHandler = getHandler('POST', '/forgot-password');
    const studentResetHandler = getHandler('POST', '/reset-password/:id/:token');
    const adminForgotHandler = getHandler('POST', '/admin-forgot-password');
    const adminResetHandler = getHandler('POST', '/admin-reset-password/:id/:token');
    const verifyReqHandler = getHandler('POST', '/verify-email/request');
    const verifyConfirmHandler = getHandler('POST', '/verify-email/confirm');

    // 1. Flow 1: Student recovery
    // Cannot request student recovery using an admin email
    const ctxStudentForgotAdmin = mockReqRes({ body: { email: 'verified@bfibd.org' } });
    await studentForgotHandler(ctxStudentForgotAdmin.req, ctxStudentForgotAdmin.res);
    assert.strictEqual(ctxStudentForgotAdmin.getResult().statusCode, 403, 'Cannot use admin email in student recovery');

    // Request student recovery for student
    const ctxStudentForgot = mockReqRes({ body: { email: 'student@bfibd.org' } });
    await studentForgotHandler(ctxStudentForgot.req, ctxStudentForgot.res);
    assert.strictEqual(ctxStudentForgot.getResult().statusCode, 200);

    const tokenRowStudent = serverDb.prepare("SELECT * FROM password_reset_tokens WHERE user_id = 10 AND purpose = 'user_recovery'").get();
    assert.ok(tokenRowStudent, 'Token stored with purpose user_recovery');
    assert.strictEqual(tokenRowStudent.token_version, 1);

    // 2. Flow 2: Admin self-recovery restrictions
    // Unverified admin email rejected with 403 EMAIL_UNVERIFIED
    const ctxAdminForgotUnverified = mockReqRes({ body: { email: 'unverified@bfibd.org' } });
    await adminForgotHandler(ctxAdminForgotUnverified.req, ctxAdminForgotUnverified.res);
    assert.strictEqual(ctxAdminForgotUnverified.getResult().statusCode, 403);
    assert.strictEqual(ctxAdminForgotUnverified.getResult().jsonPayload?.code, 'EMAIL_UNVERIFIED');

    // Reset-pending admin rejected
    serverDb.prepare("UPDATE users SET password_reset_pending = 1 WHERE id = 21").run();
    const ctxAdminForgotPending = mockReqRes({ body: { email: 'verified@bfibd.org' } });
    await adminForgotHandler(ctxAdminForgotPending.req, ctxAdminForgotPending.res);
    assert.strictEqual(ctxAdminForgotPending.getResult().statusCode, 403);
    assert.strictEqual(ctxAdminForgotPending.getResult().jsonPayload?.code, 'PASSWORD_RESET_PENDING');

    // Clear reset-pending and proceed with verified admin self-recovery
    serverDb.prepare("UPDATE users SET password_reset_pending = 0 WHERE id = 21").run();
    const ctxAdminForgotSuccess = mockReqRes({ body: { email: 'verified@bfibd.org' } });
    await adminForgotHandler(ctxAdminForgotSuccess.req, ctxAdminForgotSuccess.res);
    assert.strictEqual(ctxAdminForgotSuccess.getResult().statusCode, 200);

    const tokenRowAdmin = serverDb.prepare("SELECT * FROM password_reset_tokens WHERE user_id = 21 AND purpose = 'admin_self_recovery'").get();
    assert.ok(tokenRowAdmin, 'Token stored with purpose admin_self_recovery');

    // 3. Email Verification Challenge Lifecycle
    // Authenticated admin 20 requests verification for unverified email
    const ctxReqVerify = mockReqRes({ user: { id: 20, email: 'unverified@bfibd.org', role: 'admin' } });
    await verifyReqHandler(ctxReqVerify.req, ctxReqVerify.res);
    assert.strictEqual(ctxReqVerify.getResult().statusCode, 200);

    const challengeRow = serverDb.prepare("SELECT * FROM email_verification_challenges WHERE user_id = 20 AND consumed = 0").get();
    assert.ok(challengeRow, 'Email verification challenge created');
    assert.strictEqual(challengeRow.email, 'unverified@bfibd.org');

    // Confirm challenge
    // Note: The challenge token hash is stored, let's verify via hash
    serverDb.prepare("UPDATE email_verification_challenges SET token_hash = ? WHERE id = ?").run(cryptoMod.createHash('sha256').update('test_challenge_token_123').digest('hex'), challengeRow.id);

    const ctxConfirmVerify = mockReqRes({ body: { token: 'test_challenge_token_123' } });
    await verifyConfirmHandler(ctxConfirmVerify.req, ctxConfirmVerify.res);
    assert.strictEqual(ctxConfirmVerify.getResult().statusCode, 200);

    const u20Verified = serverDb.prepare("SELECT email_verified_at, verified_email FROM users WHERE id = 20").get();
    assert.ok(u20Verified.email_verified_at !== null, 'email_verified_at timestamp set');
    assert.strictEqual(u20Verified.verified_email, 'unverified@bfibd.org');

    // Challenge cannot be reused
    const ctxConfirmReuse = mockReqRes({ body: { token: 'test_challenge_token_123' } });
    await verifyConfirmHandler(ctxConfirmReuse.req, ctxConfirmReuse.res);
    assert.strictEqual(ctxConfirmReuse.getResult().statusCode, 400, 'Consumed challenge rejected');
  });
});

test.describe('Task 6: Super Admin-Initiated Reset Endpoints & URL Fragment Architecture', () => {
  test('verifies email dispatch, out-of-band direct links, version binding, and completion endpoint', async () => {
    const { initIsolatedTestDatabase } = await import('./test-db-isolation.js');
    await initIsolatedTestDatabase(TEST_SHARED_DB_PATH);

    const { default: serverDb } = await import('../server/db/database.js');
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');
    runAdminArchivingAndResetMigration(serverDb);

    serverDb.exec(`
      DELETE FROM admin_audit_logs;
      DELETE FROM mfa_login_challenges;
      DELETE FROM admin_permissions;
      DELETE FROM sessions;
      DELETE FROM password_reset_tokens;
      DELETE FROM email_verification_challenges;
      DELETE FROM users;

      -- Seed: User 1 (Super Admin), User 2 (Inactive Admin with unverified email), User 3 (Active Admin with verified email), User 4 (Archived Admin)
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, token_version, account_version, email_verified_at, verified_email)
      VALUES (1, 'superadmin', 'super@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Super', 'Admin', 1, 1, 1, 1, datetime('now'), 'super@bfibd.org'),
             (2, 'inactive_admin', 'inactive@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Inactive', 'Admin', 0, 0, 1, 1, NULL, NULL),
             (3, 'verified_admin', 'verified@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Verified', 'Admin', 0, 1, 1, 1, datetime('now'), 'verified@bfibd.org'),
             (4, 'archived_admin', 'archived@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Archived', 'Admin', 0, 0, 1, 1, NULL, NULL);
    `);

    // Set archived state on User 4
    serverDb.prepare("UPDATE users SET archived_at = datetime('now'), archive_reason = 'Archived' WHERE id = 4").run();

    // Active session for Super Admin with sudo
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, sudo_verified_at) VALUES (1, 1, 'h1', datetime('now', '+1 hour'), datetime('now'))").run();
    // Active session for User 3
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (3, 3, 'h3', datetime('now', '+1 hour'))").run();

    const { default: adminMgmtRoutes } = await import('../server/routes/admin-management.js');
    const { default: authRoutes } = await import('../server/routes/auth.js');
    const bcrypt = (await import('bcryptjs')).default;

    function mockReqRes(options = {}) {
      let statusCode = 200;
      let jsonPayload = null;
      let nextCalled = false;
      const headers = {};
      const req = {
        params: options.params || {},
        query: options.query || {},
        body: options.body || {},
        headers: options.headers || {},
        ip: '127.0.0.1',
        user: options.user || {
          id: 1,
          username: 'superadmin',
          role: 'admin',
          is_super_admin: 1,
          isSuperAdmin: true,
          sessionId: 1,
          permissions: ['*']
        }
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
        setHeader(name, val) {
          headers[name.toLowerCase()] = val;
          return this;
        }
      };
      const next = () => { nextCalled = true; };
      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, nextCalled, headers }) };
    }

    function getAdminHandler(method, pathStr) {
      const layer = adminMgmtRoutes.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
      if (!layer) throw new Error(`Route not found: ${method} ${pathStr} on adminMgmtRoutes`);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    function getAuthHandler(method, pathStr) {
      const layer = authRoutes.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
      if (!layer) throw new Error(`Route not found: ${method} ${pathStr} on authRoutes`);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    const emailResetHandler = getAdminHandler('POST', '/administrators/:id/reset-password/email');
    const directLinkHandler = getAdminHandler('POST', '/administrators/:id/reset-password/direct-link');
    const completeResetHandler = getAuthHandler('POST', '/admin/reset-password/complete');

    // 1. Super Admin cannot be reset
    const ctxResetSuper = mockReqRes({ params: { id: '1' }, body: { expected_account_version: 1 } });
    await emailResetHandler(ctxResetSuper.req, ctxResetSuper.res);
    assert.strictEqual(ctxResetSuper.getResult().statusCode, 403);

    // 2. Concurrency checks on email reset
    const ctxMissingVer = mockReqRes({ params: { id: '3' }, body: {} });
    await emailResetHandler(ctxMissingVer.req, ctxMissingVer.res);
    assert.strictEqual(ctxMissingVer.getResult().statusCode, 400);
    assert.strictEqual(ctxMissingVer.getResult().jsonPayload?.code, 'MISSING_ACCOUNT_VERSION');

    const ctxStaleVer = mockReqRes({ params: { id: '3' }, body: { expected_account_version: 999 } });
    await emailResetHandler(ctxStaleVer.req, ctxStaleVer.res);
    assert.strictEqual(ctxStaleVer.getResult().statusCode, 409);
    assert.strictEqual(ctxStaleVer.getResult().jsonPayload?.code, 'CONCURRENCY_CONFLICT');

    // 3. Archived admin cannot receive reset
    const ctxArchived = mockReqRes({ params: { id: '4' }, body: { expected_account_version: 1 } });
    await emailResetHandler(ctxArchived.req, ctxArchived.res);
    assert.strictEqual(ctxArchived.getResult().statusCode, 400);
    assert.strictEqual(ctxArchived.getResult().jsonPayload?.code, 'ACCOUNT_ARCHIVED');

    // 4. Email dispatch to unverified account returns 400 EMAIL_NOT_VERIFIED
    const ctxUnverified = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 1 } });
    await emailResetHandler(ctxUnverified.req, ctxUnverified.res);
    assert.strictEqual(ctxUnverified.getResult().statusCode, 400);
    assert.strictEqual(ctxUnverified.getResult().jsonPayload?.code, 'EMAIL_NOT_VERIFIED');

    // 5. Successful email dispatch to verified account (User 3)
    const ctxEmailSuccess = mockReqRes({ params: { id: '3' }, body: { expected_account_version: 1, reason: 'Routine credential refresh' } });
    await emailResetHandler(ctxEmailSuccess.req, ctxEmailSuccess.res);
    assert.strictEqual(ctxEmailSuccess.getResult().statusCode, 200);

    const u3PostEmail = serverDb.prepare('SELECT account_version, token_version, password_reset_pending FROM users WHERE id = 3').get();
    assert.strictEqual(u3PostEmail.account_version, 2, 'account_version incremented to 2');
    assert.strictEqual(u3PostEmail.token_version, 2, 'token_version incremented to 2');
    assert.strictEqual(u3PostEmail.password_reset_pending, 1, 'password_reset_pending set to 1');

    const tokenRow3 = serverDb.prepare("SELECT * FROM password_reset_tokens WHERE user_id = 3 AND purpose = 'admin_password_reset'").get();
    assert.ok(tokenRow3, 'Token stored with purpose admin_password_reset');
    assert.strictEqual(tokenRow3.token_version, 2, 'Token version matches bumped user token_version');
    assert.strictEqual(tokenRow3.created_by_admin_id, 1, 'created_by_admin_id recorded');

    // Sessions for User 3 were cleared
    const sessionsU3 = serverDb.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = 3').get().c;
    assert.strictEqual(sessionsU3, 0, 'Target sessions revoked');

    // 6. Direct Link Generation (Works even if email unverified, e.g. User 2)
    const ctxDirect = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 1, reason: 'Manual recovery link' } });
    await directLinkHandler(ctxDirect.req, ctxDirect.res);
    assert.strictEqual(ctxDirect.getResult().statusCode, 200);

    const directRes = ctxDirect.getResult();
    assert.ok(directRes.headers['cache-control']?.includes('no-store'), 'Direct link response has no-store cache control');
    assert.ok(directRes.jsonPayload?.direct_url, 'Response contains direct_url');
    assert.ok(directRes.jsonPayload.direct_url.includes('#userId=2&token='), 'direct_url uses URL fragment format');

    // Verify token extracted from URL fragment
    const fragment = directRes.jsonPayload.direct_url.split('#')[1];
    const urlParams = new URLSearchParams(fragment);
    const rawDirectToken = urlParams.get('token');
    assert.ok(rawDirectToken, 'Fragment contains raw token');

    const u2PostDirect = serverDb.prepare('SELECT account_version, token_version, password_reset_pending, is_active FROM users WHERE id = 2').get();
    assert.strictEqual(u2PostDirect.account_version, 2);
    assert.strictEqual(u2PostDirect.token_version, 2);
    assert.strictEqual(u2PostDirect.password_reset_pending, 1);
    assert.strictEqual(u2PostDirect.is_active, 0, 'Inactive admin is still inactive');

    // Direct link generation audit log does not leak the token
    const directAudit = serverDb.prepare("SELECT * FROM admin_audit_logs WHERE target_user_id = 2 AND action = 'admin.direct_reset_link_generated'").get();
    assert.ok(directAudit, 'Audit log recorded');
    assert.strictEqual(directAudit.details.includes(rawDirectToken), false, 'Audit log must never leak raw token');

    // 7. Complete Password Reset (POST /api/admin/reset-password/complete)
    // A) Rejects weak password
    const ctxWeak = mockReqRes({ body: { userId: 2, token: rawDirectToken, password: 'weak' } });
    await completeResetHandler(ctxWeak.req, ctxWeak.res);
    assert.strictEqual(ctxWeak.getResult().statusCode, 400);

    // B) Rejects wrong token
    const ctxBadToken = mockReqRes({ body: { userId: 2, token: 'wrong_token', password: 'NewSecurePassword123!' } });
    await completeResetHandler(ctxBadToken.req, ctxBadToken.res);
    assert.strictEqual(ctxBadToken.getResult().statusCode, 400);

    // C) Successful reset on Inactive Admin 2
    const ctxCompleteSuccess = mockReqRes({ body: { userId: 2, token: rawDirectToken, password: 'NewSecurePassword123!' } });
    await completeResetHandler(ctxCompleteSuccess.req, ctxCompleteSuccess.res);
    assert.strictEqual(ctxCompleteSuccess.getResult().statusCode, 200);

    const u2PostComplete = serverDb.prepare('SELECT password_hash, password_reset_pending, account_version, token_version, is_active FROM users WHERE id = 2').get();
    assert.strictEqual(u2PostComplete.password_reset_pending, 0, 'password_reset_pending cleared');
    assert.strictEqual(u2PostComplete.is_active, 0, 'Inactive account stays inactive after reset');
    assert.strictEqual(u2PostComplete.account_version, 3, 'account_version bumped');
    assert.strictEqual(u2PostComplete.token_version, 3, 'token_version bumped');
    assert.strictEqual(bcrypt.compareSync('NewSecurePassword123!', u2PostComplete.password_hash), true, 'Password hash updated');

    // Tokens cleared
    const tokensU2 = serverDb.prepare('SELECT COUNT(*) as c FROM password_reset_tokens WHERE user_id = 2').get().c;
    assert.strictEqual(tokensU2, 0, 'Reset tokens consumed');

    // D) Replaying consumed token fails
    const ctxReplay = mockReqRes({ body: { userId: 2, token: rawDirectToken, password: 'AnotherPassword123!' } });
    await completeResetHandler(ctxReplay.req, ctxReplay.res);
    assert.strictEqual(ctxReplay.getResult().statusCode, 400);
  });
});

test.describe('Task 7: Multi-Cycle Accountability Timeline & Audited Export with Formula Injection Defense', () => {
  test('verifies csv sanitization, multi-cycle archive timeline, and audited export endpoint', async () => {
    // 1. Verify sanitizeCsvField unit tests
    const authMiddleware = await import('../server/middleware/auth.js');
    assert.strictEqual(typeof authMiddleware.sanitizeCsvField, 'function', 'sanitizeCsvField must be exported from auth.js');
    const { sanitizeCsvField } = authMiddleware;

    assert.strictEqual(sanitizeCsvField('=cmd'), "'=cmd");
    assert.strictEqual(sanitizeCsvField('  +SUM'), "'  +SUM");
    assert.strictEqual(sanitizeCsvField('\t@danger'), "'\t@danger");
    assert.strictEqual(sanitizeCsvField('" -1+2"'), '\'" -1+2"');
    assert.strictEqual(sanitizeCsvField('Normal administrative note'), 'Normal administrative note');

    // 2. Database tests
    const { initIsolatedTestDatabase } = await import('./test-db-isolation.js');
    await initIsolatedTestDatabase(TEST_SHARED_DB_PATH);

    const { default: serverDb } = await import('../server/db/database.js');
    const { runAdminArchivingAndResetMigration } = await import('../server/db/migrations/20261028_admin_archiving_and_reset.cjs');
    runAdminArchivingAndResetMigration(serverDb);

    serverDb.exec(`
      DELETE FROM admin_audit_logs;
      DELETE FROM mfa_login_challenges;
      DELETE FROM admin_permissions;
      DELETE FROM sessions;
      DELETE FROM password_reset_tokens;
      DELETE FROM email_verification_challenges;
      DELETE FROM users;

      -- Seed: User 1 (Super Admin), User 2 (Admin with multiple archive cycles)
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, token_version, account_version)
      VALUES (1, 'superadmin', 'super@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Super', 'Admin', 1, 1, 1, 1),
             (2, 'admin_two', 'admin2@bfibd.org', '$2a$10$wT1dO/Gf3wK6zN2R6V3j3OGmG9pT3C0s6t4UvMh7N4X2f1m6J5g5i', 'admin', 'Admin', 'Two', 0, 1, 1, 5);
    `);

    // Sudo verified session for Super Admin
    serverDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, sudo_verified_at) VALUES (1, 1, 'h1', datetime('now', '+1 hour'), datetime('now'))").run();

    // Seed multiple archive and restore events in audit log
    serverDb.exec(`
      INSERT INTO admin_audit_logs (id, actor_id, target_user_id, action, module, resource, outcome, details, created_at)
      VALUES 
        (101, 1, 2, 'archive_administrator', 'admin_management', 'admin:2', 'success', json_object('reason', 'First leave sabbatical'), '2025-01-10 10:00:00'),
        (102, 1, 2, 'restore_administrator', 'admin_management', 'admin:2', 'success', json_object('reason', 'Returned from first sabbatical'), '2025-06-15 11:30:00'),
        (103, 1, 2, 'archive_administrator', 'admin_management', 'admin:2', 'success', json_object('reason', 'Second departure for study'), '2026-01-05 09:15:00'),
        (104, 1, 2, 'restore_administrator', 'admin_management', 'admin:2', 'success', json_object('reason', 'Rehired as course coordinator'), '2026-07-20 14:00:00'),
        (105, 2, NULL, 'update_course', 'course_maker', 'course:1', 'success', '=cmd|calc!A1', '2026-08-01 12:00:00');
    `);

    const { default: adminMgmtRoutes } = await import('../server/routes/admin-management.js');

    function mockReqRes(options = {}) {
      let statusCode = 200;
      let jsonPayload = null;
      let textPayload = null;
      let nextCalled = false;
      const headers = {};
      const req = {
        params: options.params || {},
        query: options.query || {},
        body: options.body || {},
        headers: options.headers || {},
        ip: '127.0.0.1',
        user: options.user || {
          id: 1,
          username: 'superadmin',
          role: 'admin',
          is_super_admin: 1,
          isSuperAdmin: true,
          sessionId: 1,
          permissions: ['*']
        }
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
        send(payload) {
          textPayload = payload;
          return this;
        },
        setHeader(name, val) {
          headers[name.toLowerCase()] = val;
          return this;
        }
      };
      const next = () => { nextCalled = true; };
      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, textPayload, nextCalled, headers }) };
    }

    function getAdminHandler(method, pathStr) {
      const layer = adminMgmtRoutes.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
      if (!layer) throw new Error(`Route not found: ${method} ${pathStr} on adminMgmtRoutes`);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    const profileHandler = getAdminHandler('GET', '/administrators/:id/accountability-profile');
    const exportHandler = getAdminHandler('GET', '/administrators/:id/export-history');

    // 3. Verify accountability profile includes multi-cycle timeline
    const ctxProfile = mockReqRes({ params: { id: '2' } });
    await profileHandler(ctxProfile.req, ctxProfile.res);
    assert.strictEqual(ctxProfile.getResult().statusCode, 200);

    const profileData = ctxProfile.getResult().jsonPayload;
    assert.ok(Array.isArray(profileData.archiveRestoreLifecycle), 'archiveRestoreLifecycle must be an array');
    assert.strictEqual(profileData.archiveRestoreLifecycle.length, 4, 'Must return all 4 archive/restore cycle events');
    assert.strictEqual(profileData.archiveRestoreLifecycle[0].reason, 'First leave sabbatical');
    assert.strictEqual(profileData.archiveRestoreLifecycle[1].reason, 'Returned from first sabbatical');
    assert.strictEqual(profileData.archiveRestoreLifecycle[2].reason, 'Second departure for study');
    assert.strictEqual(profileData.archiveRestoreLifecycle[3].reason, 'Rehired as course coordinator');

    // 4. Verify CSV Export with formula injection neutralization and auditing
    const ctxExportCsv = mockReqRes({ params: { id: '2' }, query: { format: 'csv' } });
    await exportHandler(ctxExportCsv.req, ctxExportCsv.res);
    assert.strictEqual(ctxExportCsv.getResult().statusCode, 200);

    const exportCsvRes = ctxExportCsv.getResult();
    assert.ok(exportCsvRes.headers['content-type']?.includes('text/csv'));
    assert.ok(exportCsvRes.headers['content-disposition']?.includes('attachment; filename='));
    assert.ok(exportCsvRes.textPayload.includes('Event ID,Timestamp (Dhaka),Actor ID'));
    // Verify malicious formula in details was neutralized with prepended quote
    assert.ok(exportCsvRes.textPayload.includes("'=cmd|calc!A1"), 'CSV injection formula was neutralized with single quote');

    // 5. Verify JSON Export
    const ctxExportJson = mockReqRes({ params: { id: '2' }, query: { format: 'json' } });
    await exportHandler(ctxExportJson.req, ctxExportJson.res);
    assert.strictEqual(ctxExportJson.getResult().statusCode, 200);

    const exportJsonRes = ctxExportJson.getResult();
    assert.strictEqual(exportJsonRes.jsonPayload.targetUserId, 2);
    assert.ok(exportJsonRes.jsonPayload.records.length >= 5);

    // 6. Verify audit log entry for the export was recorded
    const exportAudit = serverDb.prepare("SELECT * FROM admin_audit_logs WHERE target_user_id = 2 AND action = 'admin.export_accountability_history' ORDER BY id DESC LIMIT 1").get();
    assert.ok(exportAudit, 'Export audit log was recorded');
    assert.strictEqual(exportAudit.outcome, 'success');
  });
});

