import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ISOLATED_DIR = path.resolve(__dirname, '..', '.tmp_test_runs');
if (!fs.existsSync(TEST_ISOLATED_DIR)) {
  fs.mkdirSync(TEST_ISOLATED_DIR, { recursive: true });
}

const TEST_DB_PATH = path.join(TEST_ISOLATED_DIR, `test_super_admin_2fa_${Date.now()}.db`);

test.describe('Task 1: Migration & MFA Data Preservation (20261029_universal_mfa_and_super_admin)', () => {
  test('creates universal tables and preserves existing recovery codes and hashes intact', async () => {
    // 1. Initialize isolated database with legacy tables
    const db = new Database(TEST_DB_PATH);
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        two_factor_enabled INTEGER NOT NULL DEFAULT 0,
        two_factor_secret TEXT DEFAULT NULL,
        account_version INTEGER NOT NULL DEFAULT 1,
        token_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        used_at TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Seed test user and legacy recovery codes (one unused, one used)
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, is_super_admin, two_factor_enabled)
      VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash', 'admin', 1, 1)
    `).run();

    db.prepare(`
      INSERT INTO admin_mfa_recovery_codes (id, user_id, code_hash, used, used_at)
      VALUES 
        (101, 1, 'legacy_sha256_hash_unused', 0, NULL),
        (102, 1, 'legacy_sha256_hash_used', 1, '2026-10-28 12:00:00')
    `).run();

    // 2. Run migration
    const { runUniversalMfaAndSuperAdminMigration } = await import('../server/db/migrations/20261029_universal_mfa_and_super_admin.cjs');
    const firstResult = runUniversalMfaAndSuperAdminMigration(db);
    assert.strictEqual(firstResult.applied, true, 'Migration should apply on first run');

    // 3. Verify user_mfa_recovery_codes contains exact preserved rows
    const preservedRows = db.prepare('SELECT id, user_id, code_hash, used, used_at FROM user_mfa_recovery_codes ORDER BY id ASC').all();
    assert.strictEqual(preservedRows.length, 2, 'Must preserve both legacy recovery codes');

    assert.deepStrictEqual(preservedRows[0], {
      id: 101,
      user_id: 1,
      code_hash: 'legacy_sha256_hash_unused',
      used: 0,
      used_at: null
    }, 'Unused code must retain exact hash and unused status');

    assert.deepStrictEqual(preservedRows[1], {
      id: 102,
      user_id: 1,
      code_hash: 'legacy_sha256_hash_used',
      used: 1,
      used_at: '2026-10-28 12:00:00'
    }, 'Used code must remain permanently used with timestamp');

    // 4. Verify action_bound_challenges schema
    const challengeCols = db.prepare('PRAGMA table_info(action_bound_challenges)').all().map(c => c.name);
    assert.ok(challengeCols.includes('id'));
    assert.ok(challengeCols.includes('actor_id'));
    assert.ok(challengeCols.includes('session_id'));
    assert.ok(challengeCols.includes('target_id'));
    assert.ok(challengeCols.includes('action'));
    assert.ok(challengeCols.includes('challenge_token_hash'));
    assert.ok(challengeCols.includes('expires_at'));
    assert.ok(challengeCols.includes('consumed'));

    // 5. Verify pending_two_factor_secret column on users
    const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    assert.ok(userCols.includes('pending_two_factor_secret'), 'users table must have pending_two_factor_secret column');

    // 6. Verify idempotency
    const secondResult = runUniversalMfaAndSuperAdminMigration(db);
    assert.strictEqual(secondResult.applied, false, 'Second run must be idempotent');
    assert.strictEqual(secondResult.reason, 'Already applied');

    db.close();
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  });

  test('canonical migration runner applies all migrations cleanly with new assertions', async () => {
    const fullTestDb = path.join(TEST_ISOLATED_DIR, `test_full_runner_${Date.now()}.db`);
    const db = new Database(fullTestDb);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create minimal base tables for all previous migrations to run
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
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role)
      VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash', 'Super', 'Admin', 'admin');
    `);
    db.close();

    const { runMigrations } = await import('../scripts/run_migrations.cjs');
    assert.doesNotThrow(() => {
      runMigrations(fullTestDb);
    }, 'Full migration runner must execute without errors');

    const verifyDb = new Database(fullTestDb);
    const userCols = verifyDb.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    assert.ok(userCols.includes('pending_two_factor_secret'));
    assert.ok(userCols.includes('account_version'));

    const actionBoundExists = verifyDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='action_bound_challenges'`).get();
    assert.ok(actionBoundExists, 'action_bound_challenges table must exist');

    const userMfaExists = verifyDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_mfa_recovery_codes'`).get();
    assert.ok(userMfaExists, 'user_mfa_recovery_codes table must exist');

    verifyDb.close();
    try { fs.unlinkSync(fullTestDb); } catch {}
  });
});
