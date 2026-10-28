import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { verifyTotpCode, decryptSecret } from './totp.js';

export const ALLOWED_CHALLENGE_ACTIONS = [
  'promote_super_admin',
  'demote_super_admin'
];

/**
 * Issue an action-bound MFA step-up challenge for sensitive Super Admin governance operations.
 *
 * Cryptographically binds the challenge to:
 * - actorId: the Super Admin initiating the ceremony
 * - sessionId: the caller's active session
 * - targetId: the administrator being promoted or demoted
 * - action: 'promote_super_admin' | 'demote_super_admin'
 * - expiresAt: 5 minutes from issuance
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} params
 * @param {number} params.actorId
 * @param {string|number} params.sessionId
 * @param {number} params.targetId
 * @param {string} params.action
 * @returns {{ challengeId: string, challengeToken: string, expiresAt: string }}
 */
export function issueActionBoundChallenge(db, { actorId, sessionId, targetId, action }) {
  if (!actorId || !targetId || !action) {
    throw new Error('actorId, targetId, and action are required to issue an action-bound challenge.');
  }

  // SEC-13 DEFENSE: Strict session binding required
  if (!sessionId) {
    throw new Error('sessionId is required to issue an action-bound challenge.');
  }

  if (!ALLOWED_CHALLENGE_ACTIONS.includes(action)) {
    throw new Error(`Invalid challenge action: '${action}'. Allowed actions: ${ALLOWED_CHALLENGE_ACTIONS.join(', ')}`);
  }

  const challengeId = crypto.randomUUID();
  const challengeToken = crypto.randomBytes(32).toString('hex');
  const challengeTokenHash = crypto.createHash('sha256').update(challengeToken).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO action_bound_challenges (
      id, actor_id, session_id, target_id, action,
      challenge_token_hash, expires_at, consumed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `).run(
    challengeId,
    Number(actorId),
    String(sessionId),
    Number(targetId),
    String(action),
    challengeTokenHash,
    expiresAt
  );

  return {
    challengeId,
    challengeToken,
    expiresAt
  };
}

/**
 * Verify and atomically consume an action-bound MFA challenge along with TOTP or recovery code.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} params
 * @param {number} params.actorId
 * @param {string|number} params.sessionId
 * @param {number} params.targetId
 * @param {string} params.action
 * @param {string} params.challengeId
 * @param {string} params.challengeToken
 * @param {string} [params.code] - 6-digit TOTP code
 * @param {string} [params.recoveryCode] - 10-char recovery code
 * @returns {{ success: boolean, code?: string, error?: string }}
 */
export function verifyAndConsumeActionBoundChallenge(db, {
  actorId,
  sessionId,
  targetId,
  action,
  challengeId,
  challengeToken,
  code = null,
  recoveryCode = null
}) {
  if (!challengeId || !challengeToken) {
    return { success: false, code: 'CHALLENGE_TOKEN_REQUIRED', error: 'Challenge ID and challenge token are required.' };
  }

  // SEC-13 DEFENSE: Strict session binding required for verification
  if (!sessionId) {
    return { success: false, code: 'SESSION_REQUIRED', error: 'Active session ID is required for action verification.' };
  }

  // 1. Fetch challenge record
  const challenge = db.prepare('SELECT * FROM action_bound_challenges WHERE id = ?').get(challengeId);
  if (!challenge) {
    return { success: false, code: 'CHALLENGE_NOT_FOUND', error: 'Action verification challenge not found.' };
  }

  // 2. Validate actor binding
  if (Number(challenge.actor_id) !== Number(actorId)) {
    return { success: false, code: 'ACTOR_MISMATCH', error: 'Action verification challenge actor mismatch.' };
  }

  // 3. Validate action binding
  if (challenge.action !== action) {
    return { success: false, code: 'ACTION_MISMATCH', error: 'Action verification challenge action mismatch.' };
  }

  // 4. Validate target binding
  if (Number(challenge.target_id) !== Number(targetId)) {
    return { success: false, code: 'TARGET_MISMATCH', error: 'Action verification challenge target mismatch.' };
  }

  // 5. Validate session binding
  if (String(challenge.session_id) !== String(sessionId)) {
    return { success: false, code: 'SESSION_MISMATCH', error: 'Action verification challenge session mismatch.' };
  }

  // 6. Check consumed status
  if (challenge.consumed === 1) {
    return { success: false, code: 'CHALLENGE_ALREADY_USED', error: 'This action verification challenge has already been consumed.' };
  }

  // 7. Check expiration
  const expiryTime = new Date(challenge.expires_at).getTime();
  if (isNaN(expiryTime) || expiryTime <= Date.now()) {
    return { success: false, code: 'CHALLENGE_EXPIRED', error: 'Action verification challenge has expired.' };
  }

  // 8. Verify challenge token hash using constant-time comparison
  const calculatedHash = crypto.createHash('sha256').update(String(challengeToken)).digest('hex');
  const storedHash = challenge.challenge_token_hash;
  const bufA = Buffer.from(calculatedHash);
  const bufB = Buffer.from(storedHash);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return { success: false, code: 'CHALLENGE_TOKEN_INVALID', error: 'Invalid challenge token.' };
  }

  // 9. Fetch actor's MFA state
  const actor = db.prepare('SELECT id, two_factor_enabled, two_factor_secret, last_totp_timestamp FROM users WHERE id = ?').get(Number(actorId));
  if (!actor || actor.two_factor_enabled !== 1 || !actor.two_factor_secret) {
    return { success: false, code: 'ACTOR_MFA_NOT_ENROLLED', error: 'Actor must have two-factor authentication enabled to execute this action.' };
  }

  let totpStep = null;
  let matchedRecoveryId = null;
  let matchedCodeHash = null;
  let recoveryTable = 'user_mfa_recovery_codes';

  if (code) {
    const plainSecret = decryptSecret(actor.two_factor_secret);
    const totpResult = verifyTotpCode(plainSecret, code, {
      lastTimestamp: actor.last_totp_timestamp || 0
    });
    if (!totpResult.valid) {
      if (totpResult.reason === 'REPLAY_DETECTED') {
        return { success: false, code: 'TOTP_REPLAY_DETECTED', error: 'Authenticator code already used. Please wait for the next 30-second token.' };
      }
      return { success: false, code: 'INVALID_MFA_CODE', error: 'Invalid authenticator code.' };
    }
    totpStep = totpResult.step;
  } else if (recoveryCode) {
    const cleanRecovery = String(recoveryCode).trim().toUpperCase();
    
    // Check user_mfa_recovery_codes first
    let rows = [];
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(t => t.name);
    if (tables.includes('user_mfa_recovery_codes')) {
      rows = db.prepare('SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(actor.id);
      recoveryTable = 'user_mfa_recovery_codes';
    }
    
    if (rows.length === 0 && tables.includes('admin_mfa_recovery_codes')) {
      rows = db.prepare('SELECT id, code_hash FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(actor.id);
      recoveryTable = 'admin_mfa_recovery_codes';
    }

    for (const row of rows) {
      if (bcrypt.compareSync(cleanRecovery, row.code_hash)) {
        matchedRecoveryId = row.id;
        matchedCodeHash = row.code_hash;
        break;
      }
    }

    if (!matchedRecoveryId) {
      return { success: false, code: 'INVALID_RECOVERY_CODE', error: 'Invalid or already consumed recovery code.' };
    }
  } else {
    return { success: false, code: 'MFA_CODE_REQUIRED', error: 'Authenticator code or recovery code is required for action step-up verification.' };
  }

  // 10. Atomic consumption inside a transaction
  const consumeTx = db.transaction(() => {
    // Atomically consume challenge
    const challengeRes = db.prepare(`
      UPDATE action_bound_challenges
      SET consumed = 1, consumed_at = datetime('now')
      WHERE id = ? AND consumed = 0
    `).run(challengeId);

    if (challengeRes.changes === 0) {
      throw new Error('CHALLENGE_ALREADY_USED');
    }

    // Update TOTP timestamp if TOTP was used, enforcing replay/concurrency defense
    if (totpStep) {
      const totpRes = db.prepare(`UPDATE users SET last_totp_timestamp = ? WHERE id = ? AND (last_totp_timestamp IS NULL OR last_totp_timestamp < ?)`).run(totpStep, actor.id, totpStep);
      if (totpRes.changes === 0) {
        throw new Error('TOTP_REPLAY_DETECTED');
      }
    }

    // Mark recovery code used with concurrency check
    if (matchedRecoveryId) {
      const recRes = db.prepare(`UPDATE ${recoveryTable} SET used = 1, used_at = datetime('now') WHERE id = ? AND used = 0`).run(matchedRecoveryId);
      if (recRes.changes === 0) {
        throw new Error('RECOVERY_CODE_ALREADY_USED');
      }

      // Safely mirror into other table by code_hash, NOT numeric id!
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(t => t.name);
      const otherTable = recoveryTable === 'user_mfa_recovery_codes' ? 'admin_mfa_recovery_codes' : 'user_mfa_recovery_codes';
      if (tables.includes(otherTable)) {
        db.prepare(`UPDATE ${otherTable} SET used = 1, used_at = datetime('now') WHERE user_id = ? AND code_hash = ? AND used = 0`).run(actor.id, matchedCodeHash);
      }
    }
  });

  try {
    consumeTx();
    return { success: true };
  } catch (err) {
    if (err.message === 'CHALLENGE_ALREADY_USED') {
      return { success: false, code: 'CHALLENGE_ALREADY_USED', error: 'This action verification challenge has already been consumed.' };
    }
    if (err.message === 'TOTP_REPLAY_DETECTED') {
      return { success: false, code: 'TOTP_REPLAY_DETECTED', error: 'Authenticator code already used. Please wait for the next 30-second token.' };
    }
    if (err.message === 'RECOVERY_CODE_ALREADY_USED') {
      return { success: false, code: 'INVALID_RECOVERY_CODE', error: 'Recovery code already used.' };
    }
    throw err;
  }
}
