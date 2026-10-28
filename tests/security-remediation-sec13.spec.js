import './test-env-setup.js';
import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-testing-32-chars';

import { initIsolatedTestDatabase } from './test-db-isolation.js';

test.describe('SEC-13 & Universal MFA Security Hardening Suite', () => {
  let db;
  let authRoutes;
  let adminMgmtRoutes;
  const userPassword = 'CorrectPassword123!';
  const pwHash = bcrypt.hashSync(userPassword, 10);

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
      correlationId: 'sec13-corr-id',
      user: options.user || {
        id: 20,
        username: 'victim_user',
        role: 'student',
        is_super_admin: 0,
        isSuperAdmin: false,
        sessionId: 'session_victim_123'
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

  test.before(async () => {
    const testDbPath = path.resolve(__dirname, '..', '.tmp_test_runs', `test_sec13_${Date.now()}.db`);
    db = await initIsolatedTestDatabase(testDbPath);

    // Ensure user 1 exists for 20261023_super_admin migration check
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin)
      VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash', 'admin', 'Abir', 'Ahmad', 1)
    `).run();

    // Run migrations on isolated DB to ensure universal mfa tables exist
    const migrationModule = await import('../scripts/run_migrations.cjs');
    const runMigrations = migrationModule.runMigrations || migrationModule.default?.runMigrations;
    runMigrations(testDbPath);

    authRoutes = (await import('../server/routes/auth.js')).default;
    adminMgmtRoutes = (await import('../server/routes/admin-management.js')).default;
  });

  test.beforeEach(async () => {
    // Clean and set up seed users
    db.prepare('DELETE FROM action_bound_challenges').run();
    db.prepare('DELETE FROM user_mfa_recovery_codes').run();
    db.prepare('DELETE FROM admin_mfa_recovery_codes').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM users WHERE id IN (20, 21, 22)').run();

    const { encryptSecret, generateTotpSecret } = await import('../server/utils/totp.js');
    const existingSecret = generateTotpSecret(20);
    const encryptedExisting = encryptSecret(existingSecret);

    // User 20: MFA already enabled
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, two_factor_enabled, two_factor_secret, account_version, token_version)
      VALUES (20, 'victim_user', 'victim@bfibd.org', ?, 'student', 'Victim', 'User', 1, 0, 1, ?, 1, 1)
    `).run(pwHash, encryptedExisting);

    // User 21: Unenrolled Super Admin (for transition checks)
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, two_factor_enabled, two_factor_secret, account_version, token_version, email_verified_at, verified_email)
      VALUES (21, 'unenrolled_super', 'super_unenrolled@bfibd.org', ?, 'admin', 'Super', 'Unenrolled', 1, 1, 0, NULL, 1, 1, datetime('now'), 'super_unenrolled@bfibd.org')
    `).run(pwHash);

    // User 22: Ordinary admin eligible for promotion
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, two_factor_enabled, two_factor_secret, account_version, token_version, email_verified_at, verified_email)
      VALUES (22, 'candidate_admin', 'candidate@bfibd.org', ?, 'admin', 'Candidate', 'Admin', 1, 0, 1, ?, 1, 1, datetime('now'), 'candidate@bfibd.org')
    `).run(pwHash, encryptedExisting);
  });

  test('SEC-13.1: POST /api/auth/mfa/setup rejects initial enrollment if account is already enrolled', async () => {
    const setupHandler = getHandler(authRoutes, 'POST', '/mfa/setup');
    const ctx = mockReqRes({
      user: { id: 20, username: 'victim_user', role: 'student', sessionId: 'sess_1' },
      body: { password: userPassword }
    });

    await setupHandler(ctx.req, ctx.res);
    const result = ctx.getResult();

    // MUST be rejected with 400 MFA_ALREADY_ENABLED
    assert.strictEqual(result.statusCode, 400, 'Already enrolled account must be rejected with 400');
    assert.strictEqual(result.jsonPayload?.code, 'MFA_ALREADY_ENABLED');
  });

  test('SEC-13.2: POST /api/auth/mfa/verify-setup rejects activation if user is already enrolled and setup was not authorized replacement', async () => {
    const verifySetupHandler = getHandler(authRoutes, 'POST', '/mfa/verify-setup');
    const { encryptSecret, generateTotpSecret, generateTotpCode } = await import('../server/utils/totp.js');

    const rogueSecret = generateTotpSecret(20);
    const encryptedRogue = encryptSecret(rogueSecret);

    // Simulate an unauthorized or stale pending secret stored directly
    db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = 20').run(encryptedRogue);

    const rogueCode = generateTotpCode(rogueSecret);
    const ctx = mockReqRes({
      user: { id: 20, username: 'victim_user', role: 'student', sessionId: 'sess_1' },
      body: { code: rogueCode }
    });

    await verifySetupHandler(ctx.req, ctx.res);
    const result = ctx.getResult();

    // MUST be rejected
    assert.ok(result.statusCode === 400 || result.statusCode === 403, `Must reject with 400 or 403, got ${result.statusCode}`);
    assert.notStrictEqual(result.statusCode, 200, 'Must NOT return 200 for unauthorized factor replacement');

    // Verify original factor was NOT overwritten
    const user = db.prepare('SELECT two_factor_secret FROM users WHERE id = 20').get();
    const plainCurrent = (await import('../server/utils/totp.js')).decryptSecret(user.two_factor_secret);
    assert.notStrictEqual(plainCurrent, rogueSecret, 'Original factor must remain intact');
  });

  test('SEC-13.3: POST /api/auth/mfa/verify-setup rejects expired or session-mismatched pending setup', async () => {
    const verifySetupHandler = getHandler(authRoutes, 'POST', '/mfa/verify-setup');
    const { encryptSecret, generateTotpSecret, generateTotpCode } = await import('../server/utils/totp.js');

    const newSecret = generateTotpSecret(20);
    const code = generateTotpCode(newSecret);

    // 1. Session mismatch
    const payloadMismatch = JSON.stringify({
      secret: encryptSecret(newSecret),
      authorizedUserId: 20,
      authorizedSessionId: 'original_session_abc',
      authorizedAccountVersion: 1,
      purpose: 'replacement',
      existingFactorVerified: true,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = 20').run(payloadMismatch);

    const ctxMismatch = mockReqRes({
      user: { id: 20, username: 'victim_user', role: 'student', sessionId: 'different_session_xyz' },
      body: { code }
    });
    await verifySetupHandler(ctxMismatch.req, ctxMismatch.res);
    assert.strictEqual(ctxMismatch.getResult().statusCode, 403, 'Session mismatch must return 403');
    assert.strictEqual(ctxMismatch.getResult().jsonPayload?.code, 'SESSION_MISMATCH');

    // 2. Expired pending setup
    const payloadExpired = JSON.stringify({
      secret: encryptSecret(newSecret),
      authorizedUserId: 20,
      authorizedSessionId: 'sess_valid',
      authorizedAccountVersion: 1,
      purpose: 'replacement',
      existingFactorVerified: true,
      expiresAt: new Date(Date.now() - 5000).toISOString() // expired 5 seconds ago
    });
    db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = 20').run(payloadExpired);

    const ctxExpired = mockReqRes({
      user: { id: 20, username: 'victim_user', role: 'student', sessionId: 'sess_valid' },
      body: { code }
    });
    await verifySetupHandler(ctxExpired.req, ctxExpired.res);
    assert.strictEqual(ctxExpired.getResult().statusCode, 400, 'Expired setup must return 400');
    assert.strictEqual(ctxExpired.getResult().jsonPayload?.code, 'REPLACEMENT_EXPIRED');
  });

  test('SEC-13.4: POST /api/auth/mfa/disable requires password verification in addition to factor', async () => {
    const disableHandler = getHandler(authRoutes, 'POST', '/mfa/disable');
    const { decryptSecret, generateTotpCode } = await import('../server/utils/totp.js');

    const user = db.prepare('SELECT two_factor_secret FROM users WHERE id = 20').get();
    const plainSecret = decryptSecret(user.two_factor_secret);
    const validTotp = generateTotpCode(plainSecret);

    // 1. Missing password rejected
    const ctxNoPw = mockReqRes({
      user: { id: 20, username: 'victim_user', role: 'student', sessionId: 'sess_1' },
      body: { code: validTotp }
    });
    await disableHandler(ctxNoPw.req, ctxNoPw.res);
    assert.strictEqual(ctxNoPw.getResult().statusCode, 400, 'Missing password must be rejected');
    assert.strictEqual(ctxNoPw.getResult().jsonPayload?.code, 'PASSWORD_REQUIRED');

    // 2. Incorrect password rejected
    const ctxBadPw = mockReqRes({
      user: { id: 20, username: 'victim_user', role: 'student', sessionId: 'sess_1' },
      body: { code: validTotp, password: 'WrongPassword!' }
    });
    await disableHandler(ctxBadPw.req, ctxBadPw.res);
    assert.strictEqual(ctxBadPw.getResult().statusCode, 401, 'Incorrect password must be rejected');
    assert.strictEqual(ctxBadPw.getResult().jsonPayload?.code, 'INVALID_PASSWORD');
  });

  test('SEC-13.5: Action challenge issuance and verification enforce active session binding', async () => {
    const { issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } = await import('../server/utils/action-challenges.js');

    // 1. Missing sessionId at issuance throws
    assert.throws(() => {
      issueActionBoundChallenge(db, {
        actorId: 21,
        targetId: 22,
        action: 'promote_super_admin'
      });
    }, /sessionId is required/i);

    // 2. Valid issuance with sessionId
    const challenge = issueActionBoundChallenge(db, {
      actorId: 21,
      sessionId: 'sess_super_admin',
      targetId: 22,
      action: 'promote_super_admin'
    });
    assert.ok(challenge.challengeId);

    // 3. Verification with missing sessionId rejected
    const verifyMissing = verifyAndConsumeActionBoundChallenge(db, {
      actorId: 21,
      sessionId: null,
      targetId: 22,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code: '123456'
    });
    assert.strictEqual(verifyMissing.success, false);
    assert.strictEqual(verifyMissing.code, 'SESSION_REQUIRED');

    // 4. Verification with mismatched sessionId rejected
    const verifyMismatch = verifyAndConsumeActionBoundChallenge(db, {
      actorId: 21,
      sessionId: 'wrong_session_id',
      targetId: 22,
      action: 'promote_super_admin',
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code: '123456'
    });
    assert.strictEqual(verifyMismatch.success, false);
    assert.strictEqual(verifyMismatch.code, 'SESSION_MISMATCH');
  });

  test('SEC-13.6: Promotion and demotion require explicit target confirmation and audited reason', async () => {
    const promoteHandler = getHandler(adminMgmtRoutes, 'POST', '/super-admins/promote');
    const demoteHandler = getHandler(adminMgmtRoutes, 'POST', '/super-admins/demote');

    // 1. Promote without confirm_username rejected
    const ctxNoConfirm = mockReqRes({
      user: { id: 1, role: 'admin', is_super_admin: 1, sessionId: 'sess_1' },
      body: {
        target_id: 22,
        challenge_id: 'c1',
        challenge_token: 't1',
        reason: 'Legitimate business reason'
      }
    });
    await promoteHandler(ctxNoConfirm.req, ctxNoConfirm.res);
    assert.strictEqual(ctxNoConfirm.getResult().statusCode, 400);
    assert.strictEqual(ctxNoConfirm.getResult().jsonPayload?.code, 'CONFIRMATION_REQUIRED');

    // 2. Promote without reason rejected
    const ctxNoReason = mockReqRes({
      user: { id: 1, role: 'admin', is_super_admin: 1, sessionId: 'sess_1' },
      body: {
        target_id: 22,
        challenge_id: 'c1',
        challenge_token: 't1',
        confirm_username: 'candidate_admin'
      }
    });
    await promoteHandler(ctxNoReason.req, ctxNoReason.res);
    assert.strictEqual(ctxNoReason.getResult().statusCode, 400);
    assert.strictEqual(ctxNoReason.getResult().jsonPayload?.code, 'REASON_REQUIRED');
  });

  test('SEC-13.7: requireSuperAdminMfaEnrolled gates sensitive admin governance actions for unenrolled Super Admin', async () => {
    const createAdminHandler = getHandler(adminMgmtRoutes, 'POST', '/administrators');
    const archiveHandler = getHandler(adminMgmtRoutes, 'POST', '/administrators/:id/archive');

    // User 21 is a Super Admin without MFA enrolled
    const ctxCreate = mockReqRes({
      user: { id: 21, username: 'unenrolled_super', role: 'admin', is_super_admin: 1, sessionId: 'sess_21' },
      body: { username: 'newbie', email: 'newbie@bfi.local', password: 'Password123!', role: 'admin' }
    });

    // Directly test the route middleware stack or handler
    // In express, the route stack includes requireSuperAdminMfaEnrolled
    const route = adminMgmtRoutes.stack.find(l => l.route?.path === '/administrators' && l.route?.methods?.post);
    const middlewares = route.route.stack.map(s => s.handle);
    const mfaMiddleware = middlewares.find(fn => fn.name === 'requireSuperAdminMfaEnrolled');

    assert.ok(mfaMiddleware, 'POST /administrators route must include requireSuperAdminMfaEnrolled middleware');
  });
});
