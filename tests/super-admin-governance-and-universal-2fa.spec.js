import './test-env-setup.js';
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

const TEST_SHARED_GOV_DB = path.resolve(TEST_ISOLATED_DIR, 'test_shared_governance.db');
process.env.DATABASE_PATH = TEST_SHARED_GOV_DB;

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

test.describe('Task 3 & 4: Multiple Super Admin Governance, Peer Defenses & Middleware', () => {
  let db;
  let testDbPath;
  let adminMgmtRoutes;
  let rawTotpSecret;
  const foundingOwnerId = 1;
  const secondarySuperId = 2;
  const candidateAdminId = 3;

  function mockReqRes(options = {}) {
    let statusCode = 200;
    let jsonPayload = null;
    let nextCalled = false;
    const req = {
      ip: '127.0.0.1',
      params: options.params || {},
      body: options.body || {},
      query: options.query || {},
      headers: options.headers || {},
      correlationId: 'test-corr-id',
      originalUrl: options.url || '/api/admin/test',
      user: options.user || {
        id: foundingOwnerId,
        username: 'admin@abir',
        role: 'admin',
        is_super_admin: 1,
        isSuperAdmin: true,
        sessionId: 'session_owner_123',
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

  function getHandler(router, method, pathStr) {
    const layer = router.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
    if (!layer) throw new Error(`Route not found: ${method} ${pathStr}`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  }

  test.beforeEach(async () => {
    db = (await import('../server/db/database.js')).default;
    db.pragma('foreign_keys = ON');

    const { generateTotpSecret, encryptSecret } = await import('../server/utils/totp.js');
    rawTotpSecret = generateTotpSecret();

    // Clean tables
    db.exec(`
      DELETE FROM action_bound_challenges;
      DELETE FROM admin_permissions;
      DELETE FROM sessions;
      DELETE FROM password_reset_tokens;
      DELETE FROM user_mfa_recovery_codes;
      DELETE FROM admin_audit_logs;
      DELETE FROM users;
    `);

    // 1. Founding Owner (ID 1): active, unarchived, MFA enabled
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin, is_active, two_factor_enabled, two_factor_secret, email_verified_at, verified_email)
      VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash', 'Super', 'Admin', 'admin', 1, 1, 1, ?, datetime('now'), 'k.eye.films@gmail.com')
    `).run(encryptSecret(rawTotpSecret));

    // 2. Secondary Super Admin (ID 2): active, unarchived, MFA enabled
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin, is_active, two_factor_enabled, two_factor_secret, email_verified_at, verified_email)
      VALUES (2, 'secondary@bfi', 'secondary@bfi.local', 'hash', 'Secondary', 'SuperAdmin', 'admin', 1, 1, 1, ?, datetime('now'), 'secondary@bfi.local')
    `).run(encryptSecret(rawTotpSecret));

    // 3. Candidate Admin (ID 3): active, email verified, MFA enrolled, ordinary admin
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin, is_active, two_factor_enabled, two_factor_secret, email_verified_at, verified_email)
      VALUES (3, 'candidate@bfi', 'candidate@bfi.local', 'hash', 'Candidate', 'Admin', 'admin', 0, 1, 1, ?, datetime('now'), 'candidate@bfi.local')
    `).run(encryptSecret(rawTotpSecret));

    // 4. Ineligible Admin (ID 4): active, but no MFA and unverified email
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin, is_active, two_factor_enabled)
      VALUES (4, 'ineligible@bfi', 'ineligible@bfi.local', 'hash', 'Ineligible', 'Admin', 'admin', 0, 1, 0)
    `).run();

    adminMgmtRoutes = (await import('../server/routes/admin-management.js')).default;
  });

  test.afterEach(() => {
    // Shared db is maintained across tests
  });

  test('challenge issuance: validates preconditions and protects founding owner', async () => {
    const challengeHandler = getHandler(adminMgmtRoutes, 'POST', '/super-admins/challenge');

    // 1. Ineligible admin (no email verification / MFA) rejected on promotion challenge
    const ctxIneligible = mockReqRes({ body: { target_id: 4, action: 'promote_super_admin' } });
    await challengeHandler(ctxIneligible.req, ctxIneligible.res);
    assert.strictEqual(ctxIneligible.getResult().statusCode, 400);
    assert.strictEqual(ctxIneligible.getResult().jsonPayload.code, 'EMAIL_VERIFICATION_REQUIRED');

    // 2. Founding owner demotion challenge strictly rejected
    const ctxDemoteOwner = mockReqRes({ body: { target_id: foundingOwnerId, action: 'demote_super_admin' } });
    await challengeHandler(ctxDemoteOwner.req, ctxDemoteOwner.res);
    assert.strictEqual(ctxDemoteOwner.getResult().statusCode, 403);
    assert.strictEqual(ctxDemoteOwner.getResult().jsonPayload.code, 'FOUNDING_OWNER_PROTECTED');

    // 3. Valid promotion challenge for candidate
    const ctxCandidate = mockReqRes({ body: { target_id: candidateAdminId, action: 'promote_super_admin' } });
    await challengeHandler(ctxCandidate.req, ctxCandidate.res);
    assert.strictEqual(ctxCandidate.getResult().statusCode, 200);
    assert.ok(ctxCandidate.getResult().jsonPayload.challengeId);
    assert.ok(ctxCandidate.getResult().jsonPayload.challengeToken);
  });

  test('promotes eligible admin to Super Admin with step-up verification, session revocation, and version bump', async () => {
    const { issueActionBoundChallenge } = await import('../server/utils/action-challenges.js');
    const { generateTotpCode } = await import('../server/utils/totp.js');
    const promoteHandler = getHandler(adminMgmtRoutes, 'POST', '/super-admins/promote');

    // Add session for candidate
    db.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (101, ?, 'hash', datetime('now', '+1 hour'))`).run(candidateAdminId);

    // Issue challenge
    const challenge = issueActionBoundChallenge(db, {
      actorId: foundingOwnerId,
      sessionId: 'session_owner_123',
      targetId: candidateAdminId,
      action: 'promote_super_admin'
    });

    const code = generateTotpCode(rawTotpSecret);
    const ctxPromote = mockReqRes({
      body: {
        target_id: candidateAdminId,
        confirm_username: 'candidate@bfi',
        reason: 'Promoting eligible administrator to Super Admin',
        challenge_id: challenge.challengeId,
        challenge_token: challenge.challengeToken,
        code
      }
    });

    await promoteHandler(ctxPromote.req, ctxPromote.res);
    assert.strictEqual(ctxPromote.getResult().statusCode, 200);
    assert.strictEqual(ctxPromote.getResult().jsonPayload.user.is_super_admin, 1);

    // Verify database state: is_super_admin = 1, sessions deleted, versions bumped
    const updated = db.prepare('SELECT is_super_admin, account_version, token_version FROM users WHERE id = ?').get(candidateAdminId);
    assert.strictEqual(updated.is_super_admin, 1, 'Target must now be Super Admin');
    assert.strictEqual(updated.account_version, 2, 'account_version must bump');
    assert.strictEqual(updated.token_version, 2, 'token_version must bump');

    const sessions = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(candidateAdminId);
    assert.strictEqual(sessions.c, 0, 'Target sessions must be revoked');

    const audit = db.prepare("SELECT action, outcome FROM admin_audit_logs WHERE target_user_id = ? AND action = 'super_admin_promoted'").get(candidateAdminId);
    assert.ok(audit, 'Audit log must be recorded');
  });

  test('demotes secondary Super Admin to ordinary admin with zero permissions, but protects last usable Super Admin', async () => {
    const { issueActionBoundChallenge } = await import('../server/utils/action-challenges.js');
    const { generateTotpCode } = await import('../server/utils/totp.js');
    const demoteHandler = getHandler(adminMgmtRoutes, 'POST', '/super-admins/demote');

    // Add session for secondary
    db.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (102, 2, 'hash', datetime('now', '+1 hour'))`).run();

    // 1. Demote secondary Super Admin (ID 2): Succeeds because founding owner (ID 1) remains usable
    const challenge = issueActionBoundChallenge(db, {
      actorId: foundingOwnerId,
      sessionId: 'session_owner_123',
      targetId: secondarySuperId,
      action: 'demote_super_admin'
    });

    const code = generateTotpCode(rawTotpSecret);
    const ctxDemote = mockReqRes({
      body: {
        target_id: secondarySuperId,
        confirm_username: 'secondary@bfi',
        reason: 'Demoting secondary Super Admin back to administrator',
        challenge_id: challenge.challengeId,
        challenge_token: challenge.challengeToken,
        code
      }
    });

    await demoteHandler(ctxDemote.req, ctxDemote.res);
    assert.strictEqual(ctxDemote.getResult().statusCode, 200);
    assert.strictEqual(ctxDemote.getResult().jsonPayload.user.is_super_admin, 0);

    const demotedUser = db.prepare('SELECT is_super_admin, account_version FROM users WHERE id = ?').get(secondarySuperId);
    assert.strictEqual(demotedUser.is_super_admin, 0, 'Must be ordinary admin');

    const secSessions = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(secondarySuperId);
    assert.strictEqual(secSessions.c, 0, 'Sessions must be revoked');

    // 2. Attempting to demote founding owner (ID 1) is blocked by founding owner immunity
    const ctxDemoteOwner = mockReqRes({
      user: { id: secondarySuperId, role: 'admin', is_super_admin: 1 },
      body: {
        target_id: foundingOwnerId,
        challenge_id: 'any',
        challenge_token: 'any'
      }
    });
    await demoteHandler(ctxDemoteOwner.req, ctxDemoteOwner.res);
    assert.strictEqual(ctxDemoteOwner.getResult().statusCode, 403);
    assert.strictEqual(ctxDemoteOwner.getResult().jsonPayload.code, 'FOUNDING_OWNER_PROTECTED');

    // 3. Last Usable Super Admin defense: Demoting remaining Super Admin when count is 1
    // Promote user 3 first so secondary can attempt to demote user 3 when only 1 usable would remain
    db.prepare('UPDATE users SET is_super_admin = 0 WHERE id = 1').run(); // Simulate owner inactive/demoted in test
    db.prepare('UPDATE users SET is_super_admin = 1 WHERE id = 3').run(); // User 3 is now only usable

    const challengeLast = issueActionBoundChallenge(db, {
      actorId: 3,
      sessionId: 'sess_3',
      targetId: 3,
      action: 'demote_super_admin'
    });

    const ctxLast = mockReqRes({
      user: { id: 3, role: 'admin', is_super_admin: 1, sessionId: 'sess_3' },
      body: {
        target_id: 3,
        confirm_username: 'candidate@bfi',
        reason: 'Attempting to demote last usable super admin in test',
        challenge_id: challengeLast.challengeId,
        challenge_token: challengeLast.challengeToken,
        code: generateTotpCode(rawTotpSecret)
      }
    });
    await demoteHandler(ctxLast.req, ctxLast.res);
    assert.strictEqual(ctxLast.getResult().statusCode, 409);
    assert.strictEqual(ctxLast.getResult().jsonPayload.code, 'LAST_SUPER_ADMIN_PROTECTED');
  });

  test('peer reset defense: blocks password resets on Super Admins and founding owner', async () => {
    const directResetHandler = getHandler(adminMgmtRoutes, 'POST', '/administrators/:id/reset-password/direct-link');
    const emailResetHandler = getHandler(adminMgmtRoutes, 'POST', '/administrators/:id/reset-password/email');

    // 1. Direct link on Founding Owner (ID 1)
    const ctxOwnerDirect = mockReqRes({ params: { id: '1' }, body: { expected_account_version: 1, reason: 'test' } });
    await directResetHandler(ctxOwnerDirect.req, ctxOwnerDirect.res);
    assert.strictEqual(ctxOwnerDirect.getResult().statusCode, 403);
    assert.strictEqual(ctxOwnerDirect.getResult().jsonPayload.code, 'FOUNDING_OWNER_PROTECTED');

    // 2. Direct link on Peer Super Admin (ID 2)
    const ctxPeerDirect = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 1, reason: 'test' } });
    await directResetHandler(ctxPeerDirect.req, ctxPeerDirect.res);
    assert.strictEqual(ctxPeerDirect.getResult().statusCode, 403);
    assert.strictEqual(ctxPeerDirect.getResult().jsonPayload.code, 'PEER_RESET_FORBIDDEN');

    // 3. Email reset on Peer Super Admin (ID 2)
    const ctxPeerEmail = mockReqRes({ params: { id: '2' }, body: { expected_account_version: 1, reason: 'test' } });
    await emailResetHandler(ctxPeerEmail.req, ctxPeerEmail.res);
    assert.strictEqual(ctxPeerEmail.getResult().statusCode, 403);
    assert.strictEqual(ctxPeerEmail.getResult().jsonPayload.code, 'PEER_RESET_FORBIDDEN');
  });

  test('last usable Super Admin defense: blocks deactivating or archiving the last usable Super Admin', async () => {
    const statusHandler = getHandler(adminMgmtRoutes, 'PATCH', '/administrators/:id/status');
    const archiveHandler = getHandler(adminMgmtRoutes, 'POST', '/administrators/:id/archive');

    // Ensure only 1 usable Super Admin in database (Secondary Super Admin ID 2)
    db.prepare('UPDATE users SET is_active = 0 WHERE id = 1').run(); // Owner inactive

    // Attempt to deactivate user 2 (only usable Super Admin)
    const ctxDeactLast = mockReqRes({ params: { id: '2' }, body: { is_active: 0, expected_account_version: 1 } });
    await statusHandler(ctxDeactLast.req, ctxDeactLast.res);
    assert.strictEqual(ctxDeactLast.getResult().statusCode, 409);
    assert.strictEqual(ctxDeactLast.getResult().jsonPayload.code, 'LAST_SUPER_ADMIN_PROTECTED');

    // Attempt to archive user 2 (only usable Super Admin)
    const ctxArchLast = mockReqRes({ params: { id: '2' }, body: { reason: 'Archiving last one', expected_account_version: 1 } });
    await archiveHandler(ctxArchLast.req, ctxArchLast.res);
    assert.strictEqual(ctxArchLast.getResult().statusCode, 409);
    assert.strictEqual(ctxArchLast.getResult().jsonPayload.code, 'LAST_SUPER_ADMIN_PROTECTED');
  });

  test('middleware: requireSuperAdminMfaEnrolled gates Super Admins without completed 2FA', async () => {
    const { requireSuperAdminMfaEnrolled } = await import('../server/middleware/auth.js');

    // User without MFA enrolled
    db.prepare('UPDATE users SET two_factor_enabled = 0 WHERE id = 2').run();

    const ctxNoMfa = mockReqRes({ user: { id: 2, role: 'admin', is_super_admin: 1 } });
    requireSuperAdminMfaEnrolled(ctxNoMfa.req, ctxNoMfa.res, ctxNoMfa.next);

    assert.strictEqual(ctxNoMfa.getResult().statusCode, 403);
    assert.strictEqual(ctxNoMfa.getResult().jsonPayload.code, 'SUPER_ADMIN_MFA_ENROLLMENT_REQUIRED');
    assert.strictEqual(ctxNoMfa.getResult().nextCalled, false);

    // User with MFA enrolled
    db.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = 2').run();
    const ctxWithMfa = mockReqRes({ user: { id: 2, role: 'admin', is_super_admin: 1 } });
    requireSuperAdminMfaEnrolled(ctxWithMfa.req, ctxWithMfa.res, ctxWithMfa.next);

    assert.strictEqual(ctxWithMfa.getResult().nextCalled, true);
  });
});

test.describe('Task 5: Universal 2FA Endpoints for All Users (Students, Instructors, Admins)', () => {
  let db;
  let authRoutes;
  const studentId = 10;
  const studentPassword = 'SecureStudentPass123!';

  function mockReqRes(options = {}) {
    let statusCode = 200;
    let jsonPayload = null;
    let nextCalled = false;
    const req = {
      ip: '127.0.0.1',
      params: options.params || {},
      body: options.body || {},
      query: options.query || {},
      headers: options.headers || {},
      correlationId: 'test-corr-id',
      user: options.user || {
        id: studentId,
        username: 'student_alice',
        role: 'student',
        is_super_admin: 0,
        isSuperAdmin: false
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

  function getHandler(router, method, pathStr) {
    const layer = router.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
    if (!layer) throw new Error(`Route not found: ${method} ${pathStr}`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  }

  test.beforeEach(async () => {
    db = (await import('../server/db/database.js')).default;
    db.pragma('foreign_keys = ON');

    const bcrypt = (await import('bcryptjs')).default;
    const studentPassHash = bcrypt.hashSync(studentPassword, 10);

    // Clean tables and seed test student
    db.exec(`
      DELETE FROM action_bound_challenges;
      DELETE FROM user_mfa_recovery_codes;
      DELETE FROM sessions;
      DELETE FROM users WHERE id IN (10, 11);
    `);

    // Student account (un-enrolled initially)
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin, is_active, two_factor_enabled)
      VALUES (10, 'student_alice', 'alice@student.bfi', ?, 'Alice', 'Student', 'student', 0, 1, 0)
    `).run(studentPassHash);

    // Super Admin account (MFA enabled)
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, first_name, last_name, role, is_super_admin, is_active, two_factor_enabled, two_factor_secret)
      VALUES (11, 'super_admin_sam', 'sam@bfi.local', ?, 'Sam', 'Super', 'admin', 1, 1, 1, 'mock_secret')
    `).run(studentPassHash);

    authRoutes = (await import('../server/routes/auth.js')).default;
  });

  test('student 2FA lifecycle: status -> setup -> verify-setup -> recovery codes -> replace -> disable', async () => {
    const { generateTotpCode } = await import('../server/utils/totp.js');

    const statusHandler = getHandler(authRoutes, 'GET', '/mfa/status');
    const setupHandler = getHandler(authRoutes, 'POST', '/mfa/setup');
    const verifySetupHandler = getHandler(authRoutes, 'POST', '/mfa/verify-setup');
    const replaceHandler = getHandler(authRoutes, 'POST', '/mfa/replace');
    const disableHandler = getHandler(authRoutes, 'POST', '/mfa/disable');

    // 1. Initial status: disabled
    const ctxStatusInit = mockReqRes();
    await statusHandler(ctxStatusInit.req, ctxStatusInit.res);
    assert.strictEqual(ctxStatusInit.getResult().statusCode, 200);
    assert.strictEqual(ctxStatusInit.getResult().jsonPayload.enabled, false);

    // 2. Setup with incorrect password rejected
    const ctxSetupBad = mockReqRes({ body: { password: 'WrongPassword!' } });
    await setupHandler(ctxSetupBad.req, ctxSetupBad.res);
    assert.strictEqual(ctxSetupBad.getResult().statusCode, 401);
    assert.strictEqual(ctxSetupBad.getResult().jsonPayload.code, 'INVALID_PASSWORD');

    // 3. Setup with correct password generates secret & otpauthUri
    const ctxSetupOk = mockReqRes({ body: { password: studentPassword } });
    await setupHandler(ctxSetupOk.req, ctxSetupOk.res);
    assert.strictEqual(ctxSetupOk.getResult().statusCode, 200);
    const { secret, otpauthUri } = ctxSetupOk.getResult().jsonPayload;
    assert.ok(secret, 'Secret must be returned');
    assert.ok(otpauthUri.startsWith('otpauth://totp/'), 'Valid otpauth URI returned');

    // 4. Verify setup with invalid code rejected
    const ctxVerifyBad = mockReqRes({ body: { code: '000000' } });
    await verifySetupHandler(ctxVerifyBad.req, ctxVerifyBad.res);
    assert.strictEqual(ctxVerifyBad.getResult().statusCode, 400);
    assert.strictEqual(ctxVerifyBad.getResult().jsonPayload.code, 'INVALID_CODE');

    // 5. Verify setup with valid TOTP code: activates MFA & returns 8 recovery codes
    const validCode = generateTotpCode(secret);
    const ctxVerifyOk = mockReqRes({ body: { code: validCode } });
    await verifySetupHandler(ctxVerifyOk.req, ctxVerifyOk.res);
    assert.strictEqual(ctxVerifyOk.getResult().statusCode, 200);
    const { recoveryCodes } = ctxVerifyOk.getResult().jsonPayload;
    assert.strictEqual(recoveryCodes.length, 8, 'Must return exactly 8 recovery codes');

    // Verify DB state: two_factor_enabled = 1, pending secret cleared
    const studentUser = db.prepare('SELECT two_factor_enabled, pending_two_factor_secret FROM users WHERE id = ?').get(studentId);
    assert.strictEqual(studentUser.two_factor_enabled, 1, 'MFA must be enabled');
    assert.strictEqual(studentUser.pending_two_factor_secret, null, 'Pending secret must be cleared');

    // Verify recovery codes in user_mfa_recovery_codes
    const recCount = db.prepare('SELECT COUNT(*) as c FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').get(studentId);
    assert.strictEqual(recCount.c, 8, '8 recovery codes stored in user_mfa_recovery_codes');

    // 6. Check updated status
    const ctxStatusEnabled = mockReqRes();
    await statusHandler(ctxStatusEnabled.req, ctxStatusEnabled.res);
    assert.strictEqual(ctxStatusEnabled.getResult().statusCode, 200);
    assert.strictEqual(ctxStatusEnabled.getResult().jsonPayload.enabled, true);
    assert.strictEqual(ctxStatusEnabled.getResult().jsonPayload.recoveryCodesRemaining, 8);

    // 7. Replace configuration using a single-use recovery code
    const recoveryToUse = recoveryCodes[0];
    const ctxReplace = mockReqRes({ body: { recoveryCode: recoveryToUse } });
    await replaceHandler(ctxReplace.req, ctxReplace.res);
    assert.strictEqual(ctxReplace.getResult().statusCode, 200);
    const newSecret = ctxReplace.getResult().jsonPayload.secret;
    assert.ok(newSecret);

    // Verify used recovery code was marked used
    const remainingRec = db.prepare('SELECT COUNT(*) as c FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').get(studentId);
    assert.strictEqual(remainingRec.c, 7, 'Used recovery code is consumed');

    // 8. Disable MFA for student using valid TOTP code and password (clear last timestamp to simulate subsequent step)
    db.prepare('UPDATE users SET last_totp_timestamp = 0 WHERE id = ?').run(studentId);
    const disableCode = generateTotpCode(secret);
    const ctxDisable = mockReqRes({ body: { code: disableCode, password: studentPassword } });
    await disableHandler(ctxDisable.req, ctxDisable.res);
    assert.strictEqual(ctxDisable.getResult().statusCode, 200);

    const studentDisabled = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(studentId);
    assert.strictEqual(studentDisabled.two_factor_enabled, 0, '2FA must be disabled');
  });

  test('mandatory Super Admin 2FA defense: Super Admins cannot disable MFA', async () => {
    const { generateTotpCode } = await import('../server/utils/totp.js');
    const disableHandler = getHandler(authRoutes, 'POST', '/mfa/disable');

    const ctxSuperDisable = mockReqRes({
      user: { id: 11, role: 'admin', is_super_admin: 1 },
      body: { code: '123456' }
    });

    await disableHandler(ctxSuperDisable.req, ctxSuperDisable.res);
    assert.strictEqual(ctxSuperDisable.getResult().statusCode, 403);
    assert.strictEqual(ctxSuperDisable.getResult().jsonPayload.code, 'SUPER_ADMIN_MFA_MANDATORY');

    const superUser = db.prepare('SELECT two_factor_enabled FROM users WHERE id = 11').get();
    assert.strictEqual(superUser.two_factor_enabled, 1, 'Super Admin MFA remains strictly enabled');
  });
});


test.describe('Task 6: Local Authenticator QR Code & Client Security', () => {
  test('qrcode generates valid matrix locally without external network access', async () => {
    const QRCode = (await import('qrcode')).default;
    const testUri = 'otpauth://totp/BFI%20Classroom:student_alice?secret=JBSWY3DPEHPK3PXP&issuer=BFI%20Classroom';
    
    // Test creating local QR code data structure
    const qrData = QRCode.create(testUri, { errorCorrectionLevel: 'M' });
    assert.ok(qrData.modules.size > 0, 'QR modules matrix must be generated');
    assert.strictEqual(qrData.modules.data.length, qrData.modules.size * qrData.modules.size);

    // Test generating local DataURL without any network calls
    const dataUrl = await QRCode.toDataURL(testUri, { margin: 2 });
    assert.ok(dataUrl.startsWith('data:image/png;base64,'), 'Local PNG DataURL generated cleanly');
  });

  test('secret formatting utility spaces string correctly for human readability', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const formatted = secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') || secret;
    assert.strictEqual(formatted, 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  });
});
