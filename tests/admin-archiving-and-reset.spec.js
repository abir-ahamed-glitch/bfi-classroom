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
      fs.unlinkSync(f);
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
