import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-testing-32-chars';

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

test.describe('Task 2: Action-Bound Step-Up Verification Helper (server/utils/action-challenges.js)', () => {
  let db;
  let testDbPath;
  let rawTotpSecret;
  const actorId = 1;
  const targetId = 2;
  const sessionId = 'session_test_abc123';

  test.beforeEach(async () => {
    testDbPath = path.join(TEST_ISOLATED_DIR, `test_challenges_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
    db = new Database(testDbPath);
    db.pragma('foreign_keys = ON');

    const { generateTotpSecret, encryptSecret } = await import('../server/utils/totp.js');
    rawTotpSecret = generateTotpSecret();

    // Run migrations
    const { runMigrations } = await import('../scripts/run_migrations.cjs');
    // Minimal tables first
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
        id TEXT PRIMARY KEY,
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

    runMigrations(testDbPath);
    db = new Database(testDbPath);
    db.pragma('foreign_keys = ON');

    const bcrypt = (await import('bcryptjs')).default;

    // Seed actor (Super Admin with MFA) and target (Admin)
    db.prepare(`
      UPDATE users 
      SET two_factor_enabled = 1, two_factor_secret = ?
      WHERE id = ?
    `).run(encryptSecret(rawTotpSecret), actorId);

    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin)
      VALUES (?, 'target@bfi', 'target@bfi.local', 'hash', 'Target', 'Admin', 'admin', 0)
    `).run(targetId);

    // Seed recovery code for actor
    const recHash = bcrypt.hashSync('REC-12345-67890', 10);
    db.prepare(`
      INSERT INTO user_mfa_recovery_codes (id, user_id, code_hash, used)
      VALUES (999, ?, ?, 0)
    `).run(actorId, recHash);
  });

  test.afterEach(() => {
    try { db.close(); } catch {}
    try { fs.unlinkSync(testDbPath); } catch {}
  });

  test('issues action-bound challenge and verifies with valid TOTP code', async () => {
    const { issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } = await import('../server/utils/action-challenges.js');
    const { generateTotpCode } = await import('../server/utils/totp.js');

    const challenge = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin'
    });

    assert.ok(challenge.challengeId, 'Must return challengeId');
    assert.ok(challenge.challengeToken, 'Must return challengeToken');
    assert.ok(challenge.expiresAt, 'Must return expiresAt');

    const code = generateTotpCode(rawTotpSecret);
    const result = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });

    assert.strictEqual(result.success, true, 'Verification must succeed with valid TOTP code');

    // Verify challenge record is now consumed in DB
    const row = db.prepare('SELECT consumed, consumed_at FROM action_bound_challenges WHERE id = ?').get(challenge.challengeId);
    assert.strictEqual(row.consumed, 1, 'Challenge must be marked consumed');
    assert.ok(row.consumed_at, 'consumed_at timestamp must be recorded');
  });

  test('prevents replay attack on consumed challenge', async () => {
    const { issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } = await import('../server/utils/action-challenges.js');
    const { generateTotpCode } = await import('../server/utils/totp.js');

    const challenge = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin'
    });

    const code = generateTotpCode(rawTotpSecret);
    const firstAttempt = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(firstAttempt.success, true);

    const secondAttempt = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(secondAttempt.success, false);
    assert.strictEqual(secondAttempt.code, 'CHALLENGE_ALREADY_USED');
  });

  test('rejects actor mismatch, action mismatch, target mismatch, and session mismatch', async () => {
    const { issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } = await import('../server/utils/action-challenges.js');
    const { generateTotpCode } = await import('../server/utils/totp.js');
    const code = generateTotpCode(rawTotpSecret);

    const challenge = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin'
    });

    // 1. Actor mismatch
    const badActor = verifyAndConsumeActionBoundChallenge(db, {
      actorId: 999,
      sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(badActor.success, false);
    assert.strictEqual(badActor.code, 'ACTOR_MISMATCH');

    // 2. Action mismatch
    const badAction = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'demote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(badAction.success, false);
    assert.strictEqual(badAction.code, 'ACTION_MISMATCH');

    // 3. Target mismatch
    const badTarget = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId: 999,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(badTarget.success, false);
    assert.strictEqual(badTarget.code, 'TARGET_MISMATCH');

    // 4. Session mismatch
    const badSession = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId: 'different_session_999',
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(badSession.success, false);
    assert.strictEqual(badSession.code, 'SESSION_MISMATCH');
  });

  test('rejects expired challenge and invalid token', async () => {
    const { issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } = await import('../server/utils/action-challenges.js');
    const { generateTotpCode } = await import('../server/utils/totp.js');
    const code = generateTotpCode(rawTotpSecret);

    // Expired challenge
    const challenge = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin'
    });

    db.prepare(`UPDATE action_bound_challenges SET expires_at = datetime('now', '-1 minute') WHERE id = ?`).run(challenge.challengeId);

    const expiredResult = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code
    });
    assert.strictEqual(expiredResult.success, false);
    assert.strictEqual(expiredResult.code, 'CHALLENGE_EXPIRED');

    // Invalid challenge token
    const challenge2 = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin'
    });

    const badTokenResult = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge2.challengeId,
      challengeToken: 'wrong_secret_token_1234567890abcdef1234567890abcdef',
      code
    });
    assert.strictEqual(badTokenResult.success, false);
    assert.strictEqual(badTokenResult.code, 'CHALLENGE_TOKEN_INVALID');
  });

  test('verifies and consumes challenge with single-use recovery code', async () => {
    const { issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } = await import('../server/utils/action-challenges.js');

    const challenge = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'demote_super_admin'
    });

    const recoveryResult = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'demote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      recoveryCode: 'REC-12345-67890'
    });
    assert.strictEqual(recoveryResult.success, true, 'Must verify successfully with valid recovery code');

    // Verify recovery code was marked used in DB
    const recRow = db.prepare('SELECT used, used_at FROM user_mfa_recovery_codes WHERE id = 999').get();
    assert.strictEqual(recRow.used, 1, 'Recovery code must be marked used');
    assert.ok(recRow.used_at, 'used_at timestamp must be set');

    // Try replaying same recovery code on a new challenge
    const challenge2 = issueActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'demote_super_admin'
    });

    const replayRec = verifyAndConsumeActionBoundChallenge(db, {
      actorId,
      sessionId,
      targetId,
      action: 'demote_super_admin',
      challengeId: challenge2.challengeId,
      challengeToken: challenge2.challengeToken,
      recoveryCode: 'REC-12345-67890'
    });
    assert.strictEqual(replayRec.success, false);
    assert.strictEqual(replayRec.code, 'INVALID_RECOVERY_CODE');
  });
});
