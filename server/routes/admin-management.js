import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import { 
  authenticateToken, 
  requireSuperAdmin,
  requireSuperAdminMfaEnrolled,
  isFoundingOwner, 
  requireRole, 
  requireRecentAuth, 
  sanitizeInput, 
  validateEmail, 
  validatePassword,
  sudoAuthLimiter,
  sanitizeCsvField
} from '../middleware/auth.js';
import { PERMISSION_MODULES, ALL_PERMISSIONS, PERMISSION_DEPENDENCY_MAP } from '../config/permissions.js';
import { 
  generateTotpSecret, 
  encryptSecret, 
  decryptSecret, 
  verifyTotpCode, 
  generateRecoveryCodes 
} from '../utils/totp.js';
import { getJwtSecret } from '../config/security.js';
import { securityEvents } from '../utils/security-events.js';
import { recordAuditLog, formatDhakaTimestamp, redactSensitiveData } from '../services/auditLedgerService.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { ALLOWED_CHALLENGE_ACTIONS, issueActionBoundChallenge, verifyAndConsumeActionBoundChallenge } from '../utils/action-challenges.js';

const router = express.Router();

function safeJsonParse(str) {
  if (!str || typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Record a failed privileged action without leaking sensitive payload data
 */
function recordFailedAuditLog(actorId, targetUserId, action, reason, ipAddress) {
  try {
    recordAuditLog({
      actorId: actorId || null,
      targetUserId: targetUserId || null,
      action: action.startsWith('failed_') ? action : `failed_${action}`,
      module: 'admin_management',
      outcome: 'failed',
      details: { reason: String(reason || '').slice(0, 500) },
      ipAddress: ipAddress || '',
      throwOnError: false
    });
  } catch (err) {
    console.error('Failed to write failure audit log:', err.message);
  }
}

/**
 * Validates permission arrays, ensures no unknown permissions exist,
 * validates prerequisites/dependencies, and deduplicates.
 */
function validatePermissionsInput(permissions) {
  if (!Array.isArray(permissions)) {
    return { error: 'Permissions must be provided as an array.' };
  }

  // Deduplicate
  const uniquePerms = [...new Set(permissions)];

  // Validate unknown permissions
  for (const p of uniquePerms) {
    if (!ALL_PERMISSIONS.includes(p)) {
      return { error: `Unknown permission: '${p}'.` };
    }
  }

  // Validate dependencies
  for (const p of uniquePerms) {
    const requiredPrereq = PERMISSION_DEPENDENCY_MAP[p];
    if (requiredPrereq && !uniquePerms.includes(requiredPrereq)) {
      return { error: `Invalid permission combination: '${p}' requires prerequisite '${requiredPrereq}'.` };
    }
  }

  return { permissions: uniquePerms };
}

// -----------------------------------------------------------------------------
// Sudo Mode / Sensitive-Action Verification
// -----------------------------------------------------------------------------

router.post('/auth/verify-password', sudoAuthLimiter, authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      recordFailedAuditLog(req.user.id, null, 'verify_password', 'Missing password', req.ip);
      return res.status(400).json({ error: 'Password is required' });
    }

    if (!req.user.sessionId) {
      recordFailedAuditLog(req.user.id, null, 'verify_password', 'Active session required', req.ip);
      return res.status(400).json({ error: 'An active session is required for privileged action verification' });
    }

    const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.user.sessionId, req.user.id);
    if (!session) {
      recordFailedAuditLog(req.user.id, null, 'verify_password', 'Session invalid or expired', req.ip);
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const user = db.prepare('SELECT id, password_hash, token_version FROM users WHERE id = ?').get(req.user.id);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordFailedAuditLog(req.user.id, null, 'verify_password', 'Incorrect password', req.ip);
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Set sudo verification timestamp on the active session
    try {
      db.prepare("UPDATE sessions SET sudo_verified_at = datetime('now'), last_activity = datetime('now') WHERE id = ?").run(req.user.sessionId);
    } catch (err) {
      console.error('Failed to update session sudo timestamp:', err.message);
    }

    // Issue a 15-minute sudo token bound strictly to the current session and token_version
    const sudoToken = jwt.sign(
      { 
        id: req.user.id, 
        sessionId: req.user.sessionId, 
        token_version: user.token_version || 1, 
        type: 'sudo' 
      },
      getJwtSecret(),
      { expiresIn: '15m' }
    );

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    res.json({ success: true, sudoToken, expiresAt });
  } catch (err) {
    console.error('Error in verify-password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// Privileged Session Management
// -----------------------------------------------------------------------------

// List active sessions for the current admin
router.get('/sessions', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT id, ip_address, user_agent, created_at, last_activity, expires_at
      FROM sessions
      WHERE user_id = ? AND datetime(expires_at) > datetime('now')
      ORDER BY datetime(COALESCE(last_activity, created_at)) DESC
    `).all(req.user.id);

    const result = sessions.map(s => ({
      id: s.id,
      ip_address: s.ip_address,
      user_agent: s.user_agent,
      created_at: s.created_at,
      last_activity: s.last_activity || s.created_at,
      expires_at: s.expires_at,
      is_current: req.user.sessionId ? s.id === req.user.sessionId : false
    }));

    res.json({ sessions: result });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Revoke a specific session
router.delete('/sessions/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

    // Notify connected sockets to disconnect
    securityEvents.emit('revoke_session', { userId: req.user.id, sessionId });

    recordAuditLog({
      actorId: req.user.id,
      targetUserId: req.user.id,
      action: 'admin.revoke_session',
      module: 'security',
      resource: `session:${sessionId}`,
      outcome: 'success',
      details: { revoked_session_id: sessionId },
      ipAddress: req.ip || '',
      throwOnError: true
    });

    res.json({ success: true, message: 'Session revoked successfully' });
  } catch (err) {
    console.error('Error revoking session:', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// Revoke all other sessions
router.post('/sessions/revoke-others', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    if (!req.user.sessionId) {
      return res.status(400).json({ error: 'Current session ID could not be identified' });
    }

    const deleteStmt = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?');
    const result = deleteStmt.run(req.user.id, req.user.sessionId);

    // Notify connected sockets to disconnect
    securityEvents.emit('revoke_other_sessions', { userId: req.user.id, currentSessionId: req.user.sessionId });

    // Record audit log
    db.prepare(`
      INSERT INTO admin_audit_logs (actor_id, target_user_id, action, details, ip_address)
      VALUES (?, ?, 'revoke_other_sessions', ?, ?)
    `).run(
      req.user.id,
      req.user.id,
      JSON.stringify({ revoked_count: result.changes, preserved_session_id: req.user.sessionId }),
      req.ip || ''
    );

    res.json({ success: true, message: `Revoked ${result.changes} other session(s)` });
  } catch (err) {
    console.error('Error revoking other sessions:', err);
    res.status(500).json({ error: 'Failed to revoke other sessions' });
  }
});

// -----------------------------------------------------------------------------
// Privileged Multi-Factor Authentication (TOTP RFC 6238)
// -----------------------------------------------------------------------------

// Get MFA status for current admin
router.get('/mfa/status', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const user = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(req.user.id);
    const countRow = db.prepare('SELECT COUNT(*) as remaining FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').get(req.user.id);

    res.json({
      mfaEnabled: Boolean(user?.two_factor_enabled),
      recoveryCodesRemaining: countRow?.remaining || 0
    });
  } catch (err) {
    console.error('Error fetching MFA status:', err);
    res.status(500).json({ error: 'Failed to fetch MFA status' });
  }
});

// Start MFA enrollment or re-enrollment (requires recent sudo auth + existing factor verification if already enrolled)
router.post('/mfa/setup', authenticateToken, requireRole('admin'), requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, email, two_factor_enabled, two_factor_secret, last_totp_timestamp FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isReplacement = user.two_factor_enabled === 1;

    let recoveryCodeIdToConsume = null;
    let totpStepToRecord = null;

    if (isReplacement) {
      const { currentCode, recoveryCode } = req.body || {};
      if (!currentCode && !recoveryCode) {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_replace_setup', 'Existing factor verification required', req.ip);
        return res.status(400).json({ 
          error: 'Existing factor verification required to replace two-factor authentication. Please provide a current verification code or recovery code.',
          code: 'EXISTING_FACTOR_REQUIRED'
        });
      }

      if (currentCode) {
        if (!user.two_factor_secret) {
          return res.status(400).json({ error: 'MFA is not properly configured on your account.' });
        }
        const plainSecret = decryptSecret(user.two_factor_secret);
        const verification = verifyTotpCode(plainSecret, currentCode, {
          lastTimestamp: user.last_totp_timestamp || 0
        });
        if (!verification.valid) {
          if (verification.reason === 'REPLAY_DETECTED') {
            recordFailedAuditLog(req.user.id, req.user.id, 'mfa_replace_setup', 'TOTP replay detected in authorization', req.ip);
            return res.status(400).json({ 
              error: 'This verification code was already used. Please wait for a new code.', 
              code: 'TOTP_REPLAY_DETECTED' 
            });
          }
          recordFailedAuditLog(req.user.id, req.user.id, 'mfa_replace_setup', 'Invalid existing verification code', req.ip);
          return res.status(400).json({ error: 'Invalid current verification code. Please check your existing authenticator app.' });
        }
        totpStepToRecord = verification.step;
      } else if (recoveryCode) {
        const cleanRecovery = String(recoveryCode).trim().toUpperCase();
        const unusedCodes = db.prepare('SELECT id, code_hash FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
        for (const item of unusedCodes) {
          if (bcrypt.compareSync(cleanRecovery, item.code_hash)) {
            recoveryCodeIdToConsume = item.id;
            break;
          }
        }
        if (!recoveryCodeIdToConsume) {
          recordFailedAuditLog(req.user.id, req.user.id, 'mfa_replace_setup', 'Invalid existing recovery code', req.ip);
          return res.status(400).json({ error: 'Invalid or already used recovery code.' });
        }
      }
    }

    // Generate fresh 160-bit Base32 secret
    const secretBase32 = generateTotpSecret(20);
    const encrypted = encryptSecret(secretBase32);

    // Generate 8 recovery codes
    const plainRecoveryCodes = generateRecoveryCodes(8);
    const recoveryHashes = plainRecoveryCodes.map(code => bcrypt.hashSync(code, 10));

    // Save pending secret, recovery hashes, and session authorization as JSON payload.
    // CRITICAL: Keep existing active credentials and remaining recovery codes intact until replacement enrollment is verified!
    const pendingPayload = JSON.stringify({
      secret: encrypted,
      recoveryHashes,
      authorizedSessionId: req.user.sessionId,
      authorizedUserId: user.id,
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      existingFactorVerified: isReplacement ? true : false,
      isReplacement,
      consumedFactorType: recoveryCodeIdToConsume ? 'recovery_code' : (totpStepToRecord ? 'totp' : null),
      consumedRecoveryCodeId: recoveryCodeIdToConsume || null
    });

    const authorizeReplacementTx = db.transaction(() => {
      if (isReplacement) {
        if (recoveryCodeIdToConsume) {
          // Atomically consume recovery code; ensure concurrency safety
          const consumeRes = db.prepare(`
            UPDATE admin_mfa_recovery_codes 
            SET used = 1, used_at = datetime('now')
            WHERE id = ? AND user_id = ? AND used = 0
          `).run(recoveryCodeIdToConsume, user.id);

          if (consumeRes.changes === 0) {
            throw new Error('FACTOR_ALREADY_USED');
          }
        } else if (totpStepToRecord) {
          // Record TOTP consumption; ensure timestamp hasn't advanced or been replayed
          const totpRes = db.prepare(`
            UPDATE users 
            SET last_totp_timestamp = ?
            WHERE id = ? AND (last_totp_timestamp IS NULL OR last_totp_timestamp < ?)
          `).run(totpStepToRecord, user.id, totpStepToRecord);

          if (totpRes.changes === 0) {
            throw new Error('TOTP_REPLAY_DETECTED');
          }
        }
      }

      // Persist pending authorization payload; if user row is missing, throw to rollback factor consumption
      const updateRes = db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = ?').run(pendingPayload, user.id);
      if (updateRes.changes === 0) {
        throw new Error('PERSIST_PENDING_FAILED');
      }

      if (isReplacement) {
        db.prepare(`
          INSERT INTO admin_audit_logs (actor_id, target_user_id, action, details, ip_address)
          VALUES (?, ?, 'mfa_replace_authorized', ?, ?)
        `).run(
          req.user.id,
          user.id,
          JSON.stringify({
            factor_type: recoveryCodeIdToConsume ? 'recovery_code' : 'totp',
            authorized_session_id: req.user.sessionId
          }),
          req.ip || ''
        );
      }
    });

    try {
      authorizeReplacementTx();
    } catch (txErr) {
      if (txErr.message === 'FACTOR_ALREADY_USED') {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_replace_setup', 'Recovery code already used (concurrency/replay)', req.ip);
        return res.status(400).json({ error: 'This recovery code has already been used.', code: 'FACTOR_ALREADY_USED' });
      }
      if (txErr.message === 'TOTP_REPLAY_DETECTED') {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_replace_setup', 'TOTP replay detected in authorization', req.ip);
        return res.status(400).json({ error: 'This verification code was already used. Please wait for a new code.', code: 'TOTP_REPLAY_DETECTED' });
      }
      throw txErr;
    }

    const otpauthUrl = `otpauth://totp/BFI%20Classroom:${encodeURIComponent(user.username)}?secret=${secretBase32}&issuer=BFI%20Classroom`;

    res.json({
      secret: secretBase32,
      otpauthUrl,
      recoveryCodes: plainRecoveryCodes,
      isReplacement
    });
  } catch (err) {
    console.error('Error initiating MFA setup:', err);
    res.status(500).json({ error: 'Failed to initiate MFA setup' });
  }
});

// Complete MFA enrollment by verifying the first code from the NEW secret
router.post('/mfa/verify-setup', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const user = db.prepare('SELECT id, two_factor_enabled, pending_two_factor_secret, last_totp_timestamp FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.pending_two_factor_secret) {
      return res.status(400).json({ error: 'No MFA enrollment in progress. Please start setup again.' });
    }

    let parsed = null;
    let pendingSecretEncrypted = user.pending_two_factor_secret;
    let pendingRecoveryHashes = [];

    try {
      parsed = JSON.parse(user.pending_two_factor_secret);
      if (parsed && parsed.secret) {
        pendingSecretEncrypted = parsed.secret;
        pendingRecoveryHashes = parsed.recoveryHashes || [];
      }
    } catch {
      // Fallback for legacy plain encrypted secret format
    }

    // Enforce replacement security constraints if user already has MFA enabled or payload is a replacement
    if (user.two_factor_enabled === 1 || parsed?.isReplacement) {
      if (!parsed || parsed.existingFactorVerified !== true) {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_verify_setup', 'Existing factor verification required for replacement', req.ip);
        return res.status(403).json({ 
          error: 'Existing factor verification required to replace two-factor authentication.', 
          code: 'EXISTING_FACTOR_NOT_VERIFIED' 
        });
      }

      if (parsed.authorizedSessionId && parsed.authorizedSessionId !== req.user.sessionId) {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_verify_setup', 'Session mismatch on MFA replacement', req.ip);
        return res.status(403).json({ 
          error: 'MFA replacement must be completed from the specific session where it was authorized.', 
          code: 'SESSION_MISMATCH' 
        });
      }

      if (parsed.expiresAt && new Date(parsed.expiresAt) <= new Date()) {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_verify_setup', 'MFA replacement authorization expired', req.ip);
        return res.status(400).json({ 
          error: 'MFA replacement authorization has expired. Please authorize again.', 
          code: 'REPLACEMENT_EXPIRED' 
        });
      }
    }

    // Verify code against the NEW secret (first code for this new secret enrollment)
    const plainSecret = decryptSecret(pendingSecretEncrypted);
    const verification = verifyTotpCode(plainSecret, code);

    if (!verification.valid) {
      recordFailedAuditLog(req.user.id, req.user.id, 'mfa_verify_setup', 'Invalid verification code', req.ip);
      return res.status(400).json({ error: 'Invalid verification code. Please check your authenticator app.' });
    }

    const isReplacement = Boolean(user.two_factor_enabled === 1 || parsed?.isReplacement);

    // Atomically commit MFA activation, replace recovery codes, revoke other sessions, and record audit log
    const activateTx = db.transaction(() => {
      db.prepare(`
        UPDATE users 
        SET two_factor_secret = ?,
            pending_two_factor_secret = NULL,
            two_factor_enabled = 1,
            last_totp_timestamp = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(pendingSecretEncrypted, verification.step, req.user.id);

      // Replace old recovery codes with the new ones atomically upon verified enrollment
      if (pendingRecoveryHashes.length > 0) {
        db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(req.user.id);
        const insertCode = db.prepare('INSERT INTO admin_mfa_recovery_codes (user_id, code_hash, used) VALUES (?, ?, 0)');
        for (const hash of pendingRecoveryHashes) {
          insertCode.run(req.user.id, hash);
        }
      }

      // If replacing an existing factor: Revoke all OTHER sessions for this user and invalidate outstanding challenges
      let revokedCount = 0;
      if (isReplacement) {
        if (req.user.sessionId) {
          const deleteSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.user.sessionId);
          revokedCount = deleteSessions.changes;
        }

        // Invalidate all outstanding login challenges for this user
        db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(req.user.id);
      }

      db.prepare(`
        INSERT INTO admin_audit_logs (actor_id, target_user_id, action, details, ip_address)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        req.user.id,
        isReplacement ? 'mfa_replaced' : 'mfa_enrolled',
        JSON.stringify({ 
          status: 'active', 
          step: verification.step, 
          is_replacement: isReplacement,
          other_sessions_revoked: revokedCount 
        }),
        req.ip || ''
      );

      return { isReplacement, revokedCount };
    });

    const result = activateTx();

    if (result.isReplacement && req.user.sessionId) {
      // Disconnect all other active WebSockets for this user
      securityEvents.emit('revoke_other_sessions', { userId: req.user.id, currentSessionId: req.user.sessionId });
    }

    res.json({ 
      success: true, 
      message: result.isReplacement 
        ? 'Two-factor authentication successfully replaced. All other active sessions have been terminated for security.' 
        : 'Two-factor authentication successfully enabled',
      isReplacement: result.isReplacement,
      otherSessionsRevoked: result.isReplacement
    });
  } catch (err) {
    console.error('Error verifying MFA setup:', err);
    res.status(500).json({ error: 'Failed to verify MFA setup' });
  }
});

// Cancel MFA setup / replacement without modifying existing settings
router.post('/mfa/cancel-setup', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    db.prepare('UPDATE users SET pending_two_factor_secret = NULL WHERE id = ?').run(req.user.id);
    res.json({ success: true, message: 'Two-factor setup has been cancelled. Existing settings remain unchanged.' });
  } catch (err) {
    console.error('Error cancelling MFA setup:', err);
    res.status(500).json({ error: 'Failed to cancel MFA setup' });
  }
});

// Disable MFA (requires recent sudo auth and factor verification if enrolled)
router.post('/mfa/disable', authenticateToken, requireRole('admin'), requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const user = db.prepare('SELECT id, two_factor_enabled, two_factor_secret, last_totp_timestamp FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If MFA is currently active, require factor verification (TOTP code or recovery code)
    if (user.two_factor_enabled === 1) {
      const { code, recoveryCode } = req.body || {};
      if (!code && !recoveryCode) {
        recordFailedAuditLog(req.user.id, req.user.id, 'mfa_disable', 'Missing MFA verification factor', req.ip);
        return res.status(400).json({ error: 'Verification code or recovery code is required to disable two-factor authentication.' });
      }

      if (code) {
        if (!user.two_factor_secret) {
          return res.status(400).json({ error: 'MFA is not properly configured.' });
        }
        const plainSecret = decryptSecret(user.two_factor_secret);
        const verification = verifyTotpCode(plainSecret, code, {
          lastTimestamp: user.last_totp_timestamp || 0
        });
        if (!verification.valid) {
          recordFailedAuditLog(req.user.id, req.user.id, 'mfa_disable', 'Invalid verification code', req.ip);
          return res.status(400).json({ error: 'Invalid verification code.' });
        }
      } else if (recoveryCode) {
        const cleanRecovery = String(recoveryCode).trim().toUpperCase();
        const unusedCodes = db.prepare('SELECT id, code_hash FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
        let matchedId = null;
        for (const item of unusedCodes) {
          if (bcrypt.compareSync(cleanRecovery, item.code_hash)) {
            matchedId = item.id;
            break;
          }
        }
        if (!matchedId) {
          recordFailedAuditLog(req.user.id, req.user.id, 'mfa_disable', 'Invalid recovery code', req.ip);
          return res.status(400).json({ error: 'Invalid or already used recovery code.' });
        }
        // Mark used recovery code
        db.prepare("UPDATE admin_mfa_recovery_codes SET used = 1, used_at = datetime('now') WHERE id = ?").run(matchedId);
      }
    }

    const disableTx = db.transaction(() => {
      db.prepare(`
        UPDATE users 
        SET two_factor_secret = NULL,
            pending_two_factor_secret = NULL,
            two_factor_enabled = 0,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(req.user.id);

      db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(req.user.id);

      db.prepare(`
        INSERT INTO admin_audit_logs (actor_id, target_user_id, action, details, ip_address)
        VALUES (?, ?, 'mfa_disabled', ?, ?)
      `).run(
        req.user.id,
        req.user.id,
        JSON.stringify({ status: 'disabled' }),
        req.ip || ''
      );
    });

    disableTx();
    res.json({ success: true, message: 'Two-factor authentication has been disabled' });
  } catch (err) {
    console.error('Error disabling MFA:', err);
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

// -----------------------------------------------------------------------------
// Administrator Accounts & Permissions Management
// -----------------------------------------------------------------------------

// 1. GET /api/admin/administrators - List all administrator accounts
router.get('/administrators', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = "u.role = 'admin' AND u.deleted_at IS NULL";
    if (status === 'archived') {
      whereClause += ' AND u.archived_at IS NOT NULL';
    } else if (status === 'all') {
      // Return all admins
    } else {
      // Default: current administrators only (Active and Inactive, excluding Archived)
      whereClause += ' AND u.archived_at IS NULL';
    }

    const admins = db.prepare(`
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.profile_picture, u.is_active,
             u.is_super_admin, u.permissions_version, u.account_version, u.token_version, u.last_login, u.created_at, u.created_by_admin_id,
             u.archived_at, u.archived_by_admin_id, u.archive_reason,
             u.restored_at, u.restored_by_admin_id, u.restore_reason,
             u.password_reset_pending, u.email_verified_at, u.verified_email, u.two_factor_enabled,
             c.username as creator_username, c.email as creator_email,
             ab.username as archiver_username, rb.username as restorer_username
      FROM users u
      LEFT JOIN users c ON c.id = u.created_by_admin_id
      LEFT JOIN users ab ON ab.id = u.archived_by_admin_id
      LEFT JOIN users rb ON rb.id = u.restored_by_admin_id
      WHERE ${whereClause}
      ORDER BY u.id ASC
    `).all();

    const getPerms = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?');

    const result = admins.map(a => {
      const isSuper = a.role === 'admin' && Boolean(a.is_super_admin);
      const permissions = isSuper ? ['*'] : getPerms.all(a.id).map(p => p.permission);
      const creatorName = a.created_by_admin_id ? (a.creator_username || a.creator_email || `Admin #${a.created_by_admin_id}`) : 'Unknown/Legacy';
      return {
        ...a,
        is_super_admin: isSuper ? 1 : 0,
        isSuperAdmin: isSuper,
        permissions_version: a.permissions_version || 1,
        account_version: a.account_version || 1,
        permissions,
        creatorName,
        creator: a.created_by_admin_id ? { id: a.created_by_admin_id, username: a.creator_username, email: a.creator_email } : { id: null, username: 'Unknown/Legacy', email: null },
        created_at_dhaka: formatDhakaTimestamp(a.created_at),
        last_login_dhaka: formatDhakaTimestamp(a.last_login),
        archived_at_dhaka: a.archived_at ? formatDhakaTimestamp(a.archived_at) : null,
        restored_at_dhaka: a.restored_at ? formatDhakaTimestamp(a.restored_at) : null
      };
    });

    res.json({ administrators: result });
  } catch (err) {
    console.error('Error fetching administrators:', err);
    res.status(500).json({ error: 'Failed to fetch administrators' });
  }
});


// 1B. GET /api/admin/administrators/accountability/summary - Server-derived KPI counts & creator attribution
router.get('/administrators/accountability/summary', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const { startDate, endDate, creatorId } = req.query;

    const totalRow = db.prepare("SELECT COUNT(*) as total FROM users WHERE role = 'admin' AND deleted_at IS NULL AND archived_at IS NULL").get();
    const activeRow = db.prepare("SELECT COUNT(*) as active FROM users WHERE role = 'admin' AND deleted_at IS NULL AND archived_at IS NULL AND is_active = 1").get();
    const inactiveRow = db.prepare("SELECT COUNT(*) as inactive FROM users WHERE role = 'admin' AND deleted_at IS NULL AND archived_at IS NULL AND is_active = 0").get();
    const archivedRow = db.prepare("SELECT COUNT(*) as archived FROM users WHERE role = 'admin' AND deleted_at IS NULL AND archived_at IS NOT NULL").get();

    const rangeConditions = ["role = 'admin'", "deleted_at IS NULL", "archived_at IS NULL"];
    const rangeParams = [];

    if (startDate) {
      rangeConditions.push("created_at >= ?");
      rangeParams.push(startDate);
    }
    if (endDate) {
      const endFormatted = endDate.length === 10 ? `${endDate} 23:59:59` : endDate;
      rangeConditions.push("created_at <= ?");
      rangeParams.push(endFormatted);
    }
    if (creatorId !== undefined && creatorId !== '') {
      if (creatorId === 'null' || creatorId === 'legacy') {
        rangeConditions.push("created_by_admin_id IS NULL");
      } else {
        rangeConditions.push("created_by_admin_id = ?");
        rangeParams.push(Number(creatorId));
      }
    }

    const rangeRow = db.prepare(`
      SELECT COUNT(*) as range_count 
      FROM users 
      WHERE ${rangeConditions.join(' AND ')}
    `).get(...rangeParams);

    const creatorRows = db.prepare(`
      SELECT 
        u.created_by_admin_id as creator_id,
        c.username as creator_username,
        c.first_name as creator_first_name,
        c.last_name as creator_last_name,
        c.email as creator_email,
        COUNT(u.id) as count
      FROM users u
      LEFT JOIN users c ON c.id = u.created_by_admin_id
      WHERE u.role = 'admin' AND u.deleted_at IS NULL AND u.archived_at IS NULL
      GROUP BY u.created_by_admin_id
      ORDER BY count DESC
    `).all();

    const creatorBreakdown = creatorRows.map(row => {
      if (!row.creator_id) {
        return {
          creatorId: null,
          creatorName: 'Unknown/Legacy',
          creatorEmail: null,
          count: row.count
        };
      }
      const fullName = `${row.creator_first_name || ''} ${row.creator_last_name || ''}`.trim();
      return {
        creatorId: row.creator_id,
        creatorName: fullName || row.creator_username || `Admin #${row.creator_id}`,
        creatorUsername: row.creator_username,
        creatorEmail: row.creator_email,
        count: row.count
      };
    });

    res.json({
      total: totalRow?.total || 0,
      active: activeRow?.active || 0,
      inactive: inactiveRow?.inactive || 0,
      archived: archivedRow?.archived || 0,
      rangeCount: rangeRow?.range_count || 0,
      creators: creatorBreakdown
    });
  } catch (err) {
    console.error('Error fetching accountability summary:', err);
    res.status(500).json({ error: 'Failed to fetch accountability summary' });
  }
});

// 1C. GET /api/admin/administrators/:id/accountability-profile - Deep accountability profile with dual timelines
router.get('/administrators/:id/accountability-profile', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const adminId = Number(req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ error: 'Invalid administrator ID' });
    }

    const admin = db.prepare(`
      SELECT 
        u.id, u.username, u.email, u.first_name, u.last_name, u.profile_picture,
        u.role, u.is_active, u.is_super_admin, u.permissions_version, u.last_login,
        u.created_at, u.updated_at, u.created_by_admin_id,
        u.archived_at, u.archived_by_admin_id, u.archive_reason,
        u.restored_at, u.restored_by_admin_id, u.restore_reason,
        u.email_verified_at, u.verified_email, u.two_factor_enabled, u.account_version,
        ap.whatsapp_number as phone_number, ap.full_name, ap.bio,
        c.username as creator_username, c.email as creator_email,
        c.first_name as creator_first_name, c.last_name as creator_last_name
      FROM users u
      LEFT JOIN admin_profiles ap ON ap.user_id = u.id
      LEFT JOIN users c ON c.id = u.created_by_admin_id
      WHERE u.id = ? AND u.role = 'admin' AND u.deleted_at IS NULL
    `).get(adminId);

    if (!admin) {
      return res.status(404).json({ error: 'Administrator not found' });
    }

    const isSuper = admin.role === 'admin' && Boolean(admin.is_super_admin);
    const getPerms = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?');
    const effectivePermissions = isSuper ? ['*'] : getPerms.all(adminId).map(p => p.permission);

    // Creator Attribution
    let creator = {
      id: null,
      name: 'Unknown/Legacy',
      username: null,
      email: null,
      isLegacy: true
    };
    if (admin.created_by_admin_id) {
      const creatorFullName = `${admin.creator_first_name || ''} ${admin.creator_last_name || ''}`.trim();
      creator = {
        id: admin.created_by_admin_id,
        name: creatorFullName || admin.creator_username || `Admin #${admin.created_by_admin_id}`,
        username: admin.creator_username,
        email: admin.creator_email,
        isLegacy: false
      };
    }

    // Permission change history
    const permissionHistory = db.prepare(`
      SELECT l.id, l.actor_id, l.action, l.details, l.created_at, l.outcome,
             u.username as actor_username, u.first_name as actor_first_name, u.last_name as actor_last_name
      FROM admin_audit_logs l
      LEFT JOIN users u ON u.id = l.actor_id
      WHERE l.target_user_id = ? AND (
        lower(l.action) LIKE '%perm%' OR lower(l.action) LIKE '%role%'
      )
      ORDER BY l.id DESC
      LIMIT 50
    `).all(adminId).map(row => ({
      ...row,
      dhaka_time: formatDhakaTimestamp(row.created_at),
      details: typeof row.details === 'string' ? safeJsonParse(row.details) : row.details
    }));

    // Timeline 1: Actions performed BY this admin
    // Archive and restore lifecycle timeline (Every past cycle)
    const archiveRestoreLifecycle = db.prepare(`
      SELECT l.id, l.actor_id, l.action, l.details, l.before_state, l.after_state, l.created_at,
             u.username as actor_username, u.first_name as actor_first_name, u.last_name as actor_last_name
      FROM admin_audit_logs l
      LEFT JOIN users u ON u.id = l.actor_id
      WHERE l.target_user_id = ? AND l.action IN ('archive_administrator', 'restore_administrator')
      ORDER BY l.id ASC
    `).all(adminId).map(row => {
      const parsedDetails = typeof row.details === 'string' ? safeJsonParse(row.details) : row.details;
      const actorName = `${row.actor_first_name || ''} ${row.actor_last_name || ''}`.trim() || row.actor_username || (row.actor_id ? `Admin #${row.actor_id}` : 'System');
      return {
        id: row.id,
        action: row.action,
        cycleType: row.action === 'archive_administrator' ? 'archive' : 'restore',
        actorId: row.actor_id,
        actorName,
        reason: parsedDetails?.reason || null,
        dhakaTime: formatDhakaTimestamp(row.created_at),
        createdAt: row.created_at,
        beforeState: typeof row.before_state === 'string' ? safeJsonParse(row.before_state) : row.before_state,
        afterState: typeof row.after_state === 'string' ? safeJsonParse(row.after_state) : row.after_state
      };
    });

    const actionsPerformed = db.prepare(`
      SELECT 
        l.id, l.action, l.module, l.resource, l.outcome, l.details, l.ip_address,
        l.correlation_id, l.created_at, l.before_state, l.after_state,
        t.username as target_username
      FROM admin_audit_logs l
      LEFT JOIN users t ON t.id = l.target_user_id
      WHERE l.actor_id = ?
      ORDER BY l.id DESC
      LIMIT 100
    `).all(adminId).map(row => ({
      ...row,
      dhaka_time: formatDhakaTimestamp(row.created_at),
      details: typeof row.details === 'string' ? safeJsonParse(row.details) : row.details,
      before_state: typeof row.before_state === 'string' ? safeJsonParse(row.before_state) : row.before_state,
      after_state: typeof row.after_state === 'string' ? safeJsonParse(row.after_state) : row.after_state
    }));

    // Timeline 2: Changes made TO this admin account
    const changesReceived = db.prepare(`
      SELECT 
        l.id, l.actor_id, l.action, l.module, l.resource, l.outcome, l.details,
        l.ip_address, l.correlation_id, l.created_at, l.before_state, l.after_state,
        a.username as actor_username, a.first_name as actor_first_name, a.last_name as actor_last_name
      FROM admin_audit_logs l
      LEFT JOIN users a ON a.id = l.actor_id
      WHERE l.target_user_id = ? AND (l.actor_id != ? OR l.actor_id IS NULL)
      ORDER BY l.id DESC
      LIMIT 100
    `).all(adminId, adminId).map(row => ({
      ...row,
      dhaka_time: formatDhakaTimestamp(row.created_at),
      details: typeof row.details === 'string' ? safeJsonParse(row.details) : row.details,
      before_state: typeof row.before_state === 'string' ? safeJsonParse(row.before_state) : row.before_state,
      after_state: typeof row.after_state === 'string' ? safeJsonParse(row.after_state) : row.after_state
    }));

    // Security history: Active sessions & security-related audit events
    const activeSessions = db.prepare(`
      SELECT id, ip_address, user_agent, created_at, expires_at
      FROM sessions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).all(adminId).map(s => ({
      ...s,
      created_at_dhaka: formatDhakaTimestamp(s.created_at),
      expires_at_dhaka: formatDhakaTimestamp(s.expires_at)
    }));

    const mfaRow = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(adminId);
    const recoveryCountRow = db.prepare('SELECT COUNT(*) as count FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').get(adminId);

    const securityAuditEvents = db.prepare(`
      SELECT l.id, l.actor_id, l.action, l.module, l.resource, l.outcome, l.details, l.ip_address, l.created_at
      FROM admin_audit_logs l
      WHERE (l.target_user_id = ? OR l.actor_id = ?)
        AND (
          l.module = 'security'
          OR lower(l.action) LIKE '%mfa%'
          OR lower(l.action) LIKE '%session%'
          OR lower(l.action) LIKE '%auth%'
          OR lower(l.action) LIKE '%login%'
          OR lower(l.action) LIKE '%password%'
          OR lower(l.action) LIKE '%sudo%'
          OR lower(l.action) LIKE '%token%'
        )
      ORDER BY l.id DESC
      LIMIT 50
    `).all(adminId, adminId).map(row => ({
      ...row,
      dhaka_time: formatDhakaTimestamp(row.created_at),
      details: typeof row.details === 'string' ? safeJsonParse(row.details) : row.details
    }));

    res.json({
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        fullName: admin.full_name || `${admin.first_name || ''} ${admin.last_name || ''}`.trim(),
        role: admin.role,
        isActive: Boolean(admin.is_active),
        isSuperAdmin: isSuper,
        createdAt: admin.created_at,
        createdAtDhaka: formatDhakaTimestamp(admin.created_at),
        lastLogin: admin.last_login,
        lastLoginDhaka: formatDhakaTimestamp(admin.last_login),
        creator
      },
      effectivePermissions,
      permissionHistory,
      archiveRestoreLifecycle,
      actionsPerformedTimeline: actionsPerformed,
      changesReceivedTimeline: changesReceived,
      security: {
        mfaEnabled: Boolean(mfaRow?.two_factor_enabled),
        remainingRecoveryCodes: recoveryCountRow?.count || 0,
        activeSessions,
        events: securityAuditEvents
      }
    });
  } catch (err) {
    console.error('Error fetching accountability profile:', err);
    res.status(500).json({ error: 'Failed to fetch administrator accountability profile' });
  }
});

// 2. GET /api/admin/administrators/audit-logs - Searchable, paginated audit trail across all modules
// Placed BEFORE /administrators/:id to prevent route shadowing
router.get('/administrators/audit-logs', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim().toLowerCase();
    const actionFilter = String(req.query.action || '').trim().toLowerCase();
    const moduleFilter = String(req.query.module || '').trim().toLowerCase();
    const outcomeFilter = String(req.query.outcome || '').trim().toLowerCase();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const correlationId = String(req.query.correlationId || '').trim();
    const actorId = parseInt(req.query.actorId, 10);
    const targetUserId = parseInt(req.query.targetUserId, 10);

    const conditions = [];
    const params = [];

    if (actionFilter && actionFilter !== 'all') {
      conditions.push('lower(l.action) = ?');
      params.push(actionFilter);
    }

    if (moduleFilter && moduleFilter !== 'all') {
      conditions.push('lower(l.module) = ?');
      params.push(moduleFilter);
    }

    if (outcomeFilter && outcomeFilter !== 'all') {
      conditions.push('lower(l.outcome) = ?');
      params.push(outcomeFilter);
    }

    if (startDate) {
      conditions.push('l.created_at >= ?');
      params.push(startDate);
    }

    if (endDate) {
      const endFormatted = endDate.length === 10 ? `${endDate} 23:59:59` : endDate;
      conditions.push('l.created_at <= ?');
      params.push(endFormatted);
    }

    if (correlationId) {
      conditions.push('l.correlation_id = ?');
      params.push(correlationId);
    }

    if (Number.isInteger(actorId) && actorId > 0) {
      conditions.push('l.actor_id = ?');
      params.push(actorId);
    }

    if (Number.isInteger(targetUserId) && targetUserId > 0) {
      conditions.push('l.target_user_id = ?');
      params.push(targetUserId);
    }

    if (search) {
      conditions.push(`(
        lower(COALESCE(l.action, '')) LIKE ?
        OR lower(COALESCE(l.details, '')) LIKE ?
        OR lower(COALESCE(l.module, '')) LIKE ?
        OR lower(COALESCE(l.resource, '')) LIKE ?
        OR lower(COALESCE(u_actor.username, '')) LIKE ?
        OR lower(COALESCE(u_actor.first_name || ' ' || u_actor.last_name, '')) LIKE ?
        OR lower(COALESCE(u_target.username, '')) LIKE ?
        OR lower(COALESCE(u_target.first_name || ' ' || u_target.last_name, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term, term, term);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM admin_audit_logs l
      LEFT JOIN users u_actor ON u_actor.id = l.actor_id
      LEFT JOIN users u_target ON u_target.id = l.target_user_id
      ${whereClause}
    `).get(...params);

    const total = countRow?.total || 0;

    const logs = db.prepare(`
      SELECT 
        l.id, l.actor_id, l.target_user_id, l.action, l.module, l.resource, l.outcome,
        l.correlation_id, l.details, l.ip_address, l.before_state, l.after_state, l.created_at,
        u_actor.username as actor_username, u_actor.first_name as actor_first_name, u_actor.last_name as actor_last_name,
        u_target.username as target_username, u_target.first_name as target_first_name, u_target.last_name as target_last_name
      FROM admin_audit_logs l
      LEFT JOIN users u_actor ON u_actor.id = l.actor_id
      LEFT JOIN users u_target ON u_target.id = l.target_user_id
      ${whereClause}
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const formatted = logs.map(row => {
      return {
        ...row,
        details: typeof row.details === 'string' ? safeJsonParse(row.details) : row.details,
        before_state: typeof row.before_state === 'string' ? safeJsonParse(row.before_state) : row.before_state,
        after_state: typeof row.after_state === 'string' ? safeJsonParse(row.after_state) : row.after_state,
        dhaka_time: formatDhakaTimestamp(row.created_at)
      };
    });

    res.json({
      auditLogs: formatted,
      logs: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});


// 3. POST /api/admin/administrators - Create a new ordinary administrator (Atomic & Sudo Protected)
router.post('/administrators', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const { username, email, password, firstName, lastName, permissions } = req.body;

    if (!username || !email || !password || !firstName) {
      recordFailedAuditLog(req.user.id, null, 'create_administrator', 'Missing required fields', req.ip);
      return res.status(400).json({ error: 'Username, email, password, and first name are required.' });
    }

    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    // Enforce administrative username convention
    if (!trimmedUsername.toLowerCase().startsWith('admin@')) {
      recordFailedAuditLog(req.user.id, null, 'create_administrator', 'Username must start with admin@', req.ip);
      return res.status(400).json({ error: 'Administrator usernames must start with "admin@" (e.g., admin@john).' });
    }

    if (!validateEmail(trimmedEmail)) {
      recordFailedAuditLog(req.user.id, null, 'create_administrator', 'Invalid email format', req.ip);
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!validatePassword(password)) {
      recordFailedAuditLog(req.user.id, null, 'create_administrator', 'Password policy violation', req.ip);
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.' 
      });
    }

    // Check duplicate username or email
    const existing = db.prepare(`
      SELECT id, username, email FROM users 
      WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
    `).get(trimmedUsername, trimmedEmail);

    if (existing) {
      recordFailedAuditLog(req.user.id, null, 'create_administrator', 'Duplicate username or email', req.ip);
      return res.status(409).json({ error: 'An account with this username or email already exists.' });
    }

    // Resolve permissions to assign
    let permsToAssign = [];
    if (permissions !== undefined) {
      const validation = validatePermissionsInput(permissions);
      if (validation.error) {
        recordFailedAuditLog(req.user.id, null, 'create_administrator', validation.error, req.ip);
        return res.status(400).json({ error: validation.error });
      }
      permsToAssign = validation.permissions;
    } else {
      const defs = db.prepare('SELECT permission FROM admin_default_permissions WHERE is_default = 1').all();
      permsToAssign = defs.map(d => d.permission);
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    // Atomic transaction: account creation and audit write rollback together if anything fails
    const createTx = db.transaction(() => {
      const insertUser = db.prepare(`
        INSERT INTO users (
          username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version, permissions_version, created_by_admin_id
        ) VALUES (
          ?, ?, ?, 'admin', ?, ?, 1, 0, 1, 1, ?
        )
      `).run(trimmedUsername, trimmedEmail, passwordHash, firstName.trim(), (lastName || '').trim(), req.user.id);

      const newUserId = insertUser.lastInsertRowid;

      // Create admin profile record
      db.prepare(`
        INSERT INTO admin_profiles (user_id, full_name)
        VALUES (?, ?)
      `).run(newUserId, `${firstName.trim()} ${(lastName || '').trim()}`.trim());

      // Assign modular permissions
      const insertPerm = db.prepare(`
        INSERT INTO admin_permissions (user_id, permission, granted_by)
        VALUES (?, ?, ?)
      `);
      for (const perm of permsToAssign) {
        insertPerm.run(newUserId, perm, req.user.id);
      }

      // Record audit log atomically via auditLedgerService
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: newUserId,
        action: 'create_administrator',
        module: 'admin_management',
        resource: `admin:${newUserId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        details: {
          username: trimmedUsername,
          email: trimmedEmail,
          firstName: firstName.trim(),
          lastName: (lastName || '').trim(),
          assigned_permissions: permsToAssign,
          creator_id: req.user.id
        },
        afterState: {
          id: newUserId,
          username: trimmedUsername,
          email: trimmedEmail,
          permissions: permsToAssign
        },
        ipAddress: req.ip || '',
        dbInstance: db
      });

      return {
        id: newUserId,
        username: trimmedUsername,
        email: trimmedEmail,
        firstName: firstName.trim(),
        lastName: (lastName || '').trim(),
        role: 'admin',
        is_active: 1,
        is_super_admin: 0,
        isSuperAdmin: false,
        permissions_version: 1,
        permissions: permsToAssign,
        created_by_admin_id: req.user.id,
        creatorName: req.user.username || 'Super Admin',
        creator: { id: req.user.id, username: req.user.username }
      };
    });

    const newAdmin = createTx();
    res.status(201).json({ success: true, message: 'Administrator created successfully', user: newAdmin, administrator: newAdmin });
  } catch (err) {
    console.error('Error creating administrator:', err);
    res.status(500).json({ error: 'Failed to create administrator' });
  }
});

// 4. GET /api/admin/administrators/:id - Fetch details and permissions of an administrator
router.get('/administrators/:id', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const adminId = Number(req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ error: 'Invalid administrator ID' });
    }

    const admin = db.prepare(`
      SELECT id, username, email, first_name, last_name, profile_picture, is_active, is_super_admin, permissions_version, last_login, created_at
      FROM users
      WHERE id = ? AND role = 'admin' AND deleted_at IS NULL
    `).get(adminId);

    if (!admin) {
      return res.status(404).json({ error: 'Administrator not found' });
    }

    const isSuper = admin.role === 'admin' && Boolean(admin.is_super_admin);
    const permissions = isSuper
      ? ['*']
      : db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(admin.id).map(p => p.permission);

    res.json({
      administrator: {
        ...admin,
        is_super_admin: isSuper ? 1 : 0,
        isSuperAdmin: isSuper,
        permissions_version: admin.permissions_version || 1,
        permissions
      }
    });
  } catch (err) {
    console.error('Error fetching administrator details:', err);
    res.status(500).json({ error: 'Failed to fetch administrator details' });
  }
});

// 5. PUT /api/admin/administrators/:id/permissions - Update permissions (Atomic, Sudo Protected, Optimistic Locking)
router.put('/administrators/:id/permissions', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { permissions, expected_version } = req.body;

    const validation = validatePermissionsInput(permissions);
    if (validation.error) {
      recordFailedAuditLog(req.user.id, targetId, 'update_permissions', validation.error, req.ip);
      return res.status(400).json({ error: validation.error });
    }
    const validPerms = validation.permissions;

    // Protection: Super Admin inherent permissions cannot be modified
    if (targetId === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'update_permissions', 'Attempted to modify Super Admin inherent permissions', req.ip);
      return res.status(403).json({ error: 'Cannot modify Super Administrator inherent permissions.' });
    }

    const targetUser = db.prepare('SELECT id, username, role, permissions_version FROM users WHERE id = ? AND deleted_at IS NULL').get(targetId);
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    // Optimistic Concurrency Control: detect stale form submissions
    if (expected_version !== undefined && expected_version !== null) {
      const currentVersion = Number(targetUser.permissions_version || 1);
      if (Number(expected_version) !== currentVersion) {
        recordFailedAuditLog(req.user.id, targetId, 'update_permissions', `Concurrency conflict: expected version ${expected_version} but found ${currentVersion}`, req.ip);
        return res.status(409).json({ 
          error: 'Conflict: Permissions were modified by another session. Please reload and review the current permissions before saving.',
          code: 'CONCURRENCY_CONFLICT',
          currentVersion
        });
      }
    }

    const updateTx = db.transaction(() => {
      const oldPerms = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(targetId).map(p => p.permission);

      // Replace permissions
      db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(targetId);

      const insertPerm = db.prepare(`
        INSERT INTO admin_permissions (user_id, permission, granted_by)
        VALUES (?, ?, ?)
      `);
      for (const p of validPerms) {
        insertPerm.run(targetId, p, req.user.id);
      }

      // Increment permissions_version
      db.prepare("UPDATE users SET permissions_version = permissions_version + 1, updated_at = datetime('now') WHERE id = ?").run(targetId);

      // Record audit log atomically
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'admin.update_permissions',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { permissions: oldPerms },
        afterState: { permissions: validPerms },
        details: {
          added: validPerms.filter(p => !oldPerms.includes(p)),
          removed: oldPerms.filter(p => !validPerms.includes(p))
        },
        ipAddress: req.ip || '',
        throwOnError: true
      });

      return validPerms;
    });

    const updatedPermissions = updateTx();
    res.json({ message: 'Permissions updated successfully', permissions: updatedPermissions });
  } catch (err) {
    console.error('Error updating permissions:', err);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// 6. PATCH /api/admin/administrators/:id/status - Activate or deactivate administrator (Atomic, Session Revoking & Sudo Protected)
router.patch('/administrators/:id/status', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { is_active, expected_account_version } = req.body;

    if (is_active !== 0 && is_active !== 1) {
      recordFailedAuditLog(req.user.id, targetId, 'update_status', 'Invalid is_active value', req.ip);
      return res.status(400).json({ error: 'is_active must be 0 or 1.' });
    }

    if (expected_account_version === undefined || expected_account_version === null || typeof expected_account_version !== 'number') {
      return res.status(400).json({ 
        error: 'Expected account version is required for concurrency control.', 
        code: 'MISSING_ACCOUNT_VERSION' 
      });
    }

    if (targetId === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'update_status', 'Attempted to deactivate Super Admin account', req.ip);
      return res.status(403).json({ error: 'Cannot deactivate the founding Super Administrator account.', code: 'FOUNDING_OWNER_PROTECTED' });
    }

    const targetUser = db.prepare('SELECT id, username, role, is_active, archived_at, account_version, is_super_admin FROM users WHERE id = ? AND deleted_at IS NULL').get(targetId);
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    if (is_active === 0 && targetUser.is_super_admin === 1) {
      const usableCount = db.prepare(`
        SELECT COUNT(*) as c FROM users
        WHERE role = 'admin' AND is_super_admin = 1
          AND is_active = 1 AND archived_at IS NULL AND deleted_at IS NULL
          AND password_reset_pending = 0 AND two_factor_enabled = 1
          AND id != ?
      `).get(targetId).c;
      if (usableCount === 0) {
        return res.status(409).json({
          error: 'Cannot deactivate the last usable Super Administrator. At least one active, unarchived, MFA-enrolled Super Administrator must remain.',
          code: 'LAST_SUPER_ADMIN_PROTECTED'
        });
      }
    }
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    if (targetUser.archived_at !== null) {
      return res.status(400).json({ 
        error: 'Cannot activate an archived administrator. The account must be restored by Super Admin first.', 
        code: 'ACCOUNT_ARCHIVED' 
      });
    }

    if (targetUser.account_version !== expected_account_version) {
      recordFailedAuditLog(req.user.id, targetId, 'update_status', "Concurrency conflict: expected version " + expected_account_version + " but found " + targetUser.account_version, req.ip);
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT',
        currentVersion: targetUser.account_version
      });
    }

    // Atomic transaction: Status change, token_version invalidation, session revocation, account_version bump, and audit log write
    const updateStatusTx = db.transaction(() => {
      const updateResult = db.prepare(`
        UPDATE users 
        SET is_active = ?, 
            token_version = token_version + 1, 
            account_version = account_version + 1, 
            updated_at = datetime('now') 
        WHERE id = ? AND account_version = ? AND archived_at IS NULL
      `).run(is_active, targetId, expected_account_version);

      if (updateResult.changes === 0) {
        throw new Error('CONCURRENCY_CONFLICT');
      }

      // Permanently revoke all active sessions on deactivation or reactivation
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(targetId);

      // Record audit log atomically
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: is_active === 1 ? 'activate_administrator' : 'deactivate_administrator',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { is_active: targetUser.is_active, account_version: expected_account_version },
        afterState: { is_active, account_version: expected_account_version + 1 },
        details: { previous_status: targetUser.is_active, new_status: is_active },
        ipAddress: req.ip || '',
        throwOnError: true
      });
    });

    updateStatusTx();

    // Disconnect active socket connections for the targeted user
    securityEvents.emit('revoke_user', { userId: targetId });

    res.json({
      message: is_active === 1 ? 'Administrator activated successfully' : 'Administrator deactivated successfully',
      is_active,
      account_version: expected_account_version + 1
    });
  } catch (err) {
    if (err.message === 'CONCURRENCY_CONFLICT') {
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT' 
      });
    }
    console.error('Error updating administrator status:', err);
    res.status(500).json({ error: 'Failed to update administrator status' });
  }
});

// POST /api/admin/administrators/:id/archive - Archive administrator account (Atomic, Concurrency-Protected, Sudo Protected)
router.post('/administrators/:id/archive', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { expected_account_version, reason } = req.body;

    if (targetId === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'archive_administrator', 'Cannot archive Super Admin', req.ip);
      return res.status(403).json({ error: 'Cannot archive the founding Super Administrator account.', code: 'FOUNDING_OWNER_PROTECTED' });
    }

    if (expected_account_version === undefined || expected_account_version === null || typeof expected_account_version !== 'number') {
      return res.status(400).json({ 
        error: 'Expected account version is required for concurrency control.', 
        code: 'MISSING_ACCOUNT_VERSION' 
      });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A valid archive reason (minimum 5 characters) is required.' });
    }

    const targetUser = db.prepare('SELECT id, username, role, is_active, archived_at, account_version, is_super_admin FROM users WHERE id = ? AND deleted_at IS NULL').get(targetId);
    if (targetUser && targetUser.is_super_admin === 1) {
      const usableCount = db.prepare(`
        SELECT COUNT(*) as c FROM users
        WHERE role = 'admin' AND is_super_admin = 1
          AND is_active = 1 AND archived_at IS NULL AND deleted_at IS NULL
          AND password_reset_pending = 0 AND two_factor_enabled = 1
          AND id != ?
      `).get(targetId).c;
      if (usableCount === 0) {
        return res.status(409).json({
          error: 'Cannot archive the last usable Super Administrator. At least one active, unarchived, MFA-enrolled Super Administrator must remain.',
          code: 'LAST_SUPER_ADMIN_PROTECTED'
        });
      }
    }
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    if (targetUser.archived_at !== null) {
      return res.status(409).json({ 
        error: 'Administrator is already archived.', 
        code: 'ALREADY_ARCHIVED' 
      });
    }

    if (targetUser.account_version !== expected_account_version) {
      recordFailedAuditLog(req.user.id, targetId, 'archive_administrator', "Concurrency conflict: expected version " + expected_account_version + " but found " + targetUser.account_version, req.ip);
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT',
        currentVersion: targetUser.account_version
      });
    }

    const archiveTx = db.transaction(() => {
      const updateResult = db.prepare(`
        UPDATE users 
        SET is_active = 0,
            archived_at = datetime('now'),
            archived_by_admin_id = ?,
            archive_reason = ?,
            token_version = token_version + 1,
            account_version = account_version + 1,
            password_reset_pending = 0,
            updated_at = datetime('now')
        WHERE id = ? AND account_version = ? AND archived_at IS NULL
      `).run(req.user.id, reason.trim(), targetId, expected_account_version);

      if (updateResult.changes === 0) {
        throw new Error('CONCURRENCY_CONFLICT');
      }

      // Invalidate outstanding reset tokens, sessions, MFA challenges
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(targetId);

      // Record audit log atomically
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'archive_administrator',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { is_active: targetUser.is_active, archived_at: null, account_version: expected_account_version },
        afterState: { is_active: 0, archived_at: 'now', account_version: expected_account_version + 1 },
        details: { reason: reason.trim() },
        ipAddress: req.ip || '',
        throwOnError: true
      });
    });

    archiveTx();

    // Terminate socket connections
    securityEvents.emit('revoke_user', { userId: targetId });

    res.json({
      message: 'Administrator archived successfully',
      is_active: 0,
      account_version: expected_account_version + 1
    });
  } catch (err) {
    if (err.message === 'CONCURRENCY_CONFLICT') {
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT' 
      });
    }
    console.error('Error archiving administrator:', err);
    res.status(500).json({ error: 'Failed to archive administrator' });
  }
});

// POST /api/admin/administrators/:id/restore - Restore an archived administrator account as INACTIVE (Atomic, Concurrency-Protected, Sudo Protected)
router.post('/administrators/:id/restore', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { expected_account_version, reason } = req.body;

    if (targetId === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'restore_administrator', 'Cannot restore Super Admin', req.ip);
      return res.status(403).json({ error: 'Super Administrator cannot be modified with restore.' });
    }

    if (expected_account_version === undefined || expected_account_version === null || typeof expected_account_version !== 'number') {
      return res.status(400).json({ 
        error: 'Expected account version is required for concurrency control.', 
        code: 'MISSING_ACCOUNT_VERSION' 
      });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A valid restore reason (minimum 5 characters) is required.' });
    }

    const targetUser = db.prepare('SELECT id, username, role, is_active, archived_at, account_version FROM users WHERE id = ? AND deleted_at IS NULL').get(targetId);
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    if (targetUser.archived_at === null) {
      return res.status(409).json({ 
        error: 'Administrator is not archived.', 
        code: 'NOT_ARCHIVED' 
      });
    }

    if (targetUser.account_version !== expected_account_version) {
      recordFailedAuditLog(req.user.id, targetId, 'restore_administrator', "Concurrency conflict: expected version " + expected_account_version + " but found " + targetUser.account_version, req.ip);
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT',
        currentVersion: targetUser.account_version
      });
    }

    const restoreTx = db.transaction(() => {
      const updateResult = db.prepare(`
        UPDATE users 
        SET archived_at = NULL,
            restored_at = datetime('now'),
            restored_by_admin_id = ?,
            restore_reason = ?,
            is_active = 0, -- CRITICAL: RESTORED AS INACTIVE
            account_version = account_version + 1,
            updated_at = datetime('now')
        WHERE id = ? AND account_version = ? AND archived_at IS NOT NULL
      `).run(req.user.id, reason.trim(), targetId, expected_account_version);

      if (updateResult.changes === 0) {
        throw new Error('CONCURRENCY_CONFLICT');
      }

      // Record audit log atomically
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'restore_administrator',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { is_active: targetUser.is_active, archived_at: targetUser.archived_at, account_version: expected_account_version },
        afterState: { is_active: 0, archived_at: null, account_version: expected_account_version + 1 },
        details: { reason: reason.trim(), restored_status: 'inactive' },
        ipAddress: req.ip || '',
        throwOnError: true
      });
    });

    restoreTx();

    res.json({
      message: 'Administrator restored successfully as inactive. Please review permissions and activate the account when ready.',
      is_active: 0,
      account_version: expected_account_version + 1
    });
  } catch (err) {
    if (err.message === 'CONCURRENCY_CONFLICT') {
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT' 
      });
    }
    console.error('Error restoring administrator:', err);
    res.status(500).json({ error: 'Failed to restore administrator' });
  }
});

// 7. GET /api/admin/permissions/catalog - Permission catalog and modules
router.get('/permissions/catalog', authenticateToken, requireRole('admin'), (req, res) => {
  res.json({
    modules: PERMISSION_MODULES,
    allPermissions: ALL_PERMISSIONS
  });
});

// 8. GET /api/admin/permissions/defaults - Get configured default permissions for new admins
router.get('/permissions/defaults', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT permission FROM admin_default_permissions WHERE is_default = 1').all();
    const defaults = rows.map(r => r.permission);
    // Provide both defaultPermissions and default_permissions for contract compatibility
    res.json({ defaultPermissions: defaults, default_permissions: defaults });
  } catch (err) {
    console.error('Error fetching default permissions:', err);
    res.status(500).json({ error: 'Failed to fetch default permissions' });
  }
});

// 9. PUT /api/admin/permissions/defaults - Update configured default permissions for future admins (Atomic & Sudo Protected)
router.put('/permissions/defaults', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const { permissions } = req.body;
    const validation = validatePermissionsInput(permissions);
    if (validation.error) {
      recordFailedAuditLog(req.user.id, null, 'update_default_permissions', validation.error, req.ip);
      return res.status(400).json({ error: validation.error });
    }
    const validPerms = validation.permissions;

    const updateDefaultsTx = db.transaction(() => {
      const oldDefaults = db.prepare('SELECT permission FROM admin_default_permissions WHERE is_default = 1').all().map(r => r.permission);

      db.prepare('UPDATE admin_default_permissions SET is_default = 0').run();

      const setDef = db.prepare(`
        UPDATE admin_default_permissions 
        SET is_default = 1, updated_by = ?, updated_at = datetime('now')
        WHERE permission = ?
      `);
      for (const p of validPerms) {
        setDef.run(req.user.id, p);
      }

      // Record audit log atomically
      recordAuditLog({
        actorId: req.user.id,
        action: 'admin.update_default_permissions',
        module: 'admin_management',
        resource: 'permissions:defaults',
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { default_permissions: oldDefaults },
        afterState: { default_permissions: validPerms },
        ipAddress: req.ip || '',
        throwOnError: true
      });

      return validPerms;
    });

    const newDefaults = updateDefaultsTx();
    // Provide both defaultPermissions and default_permissions for contract compatibility
    res.json({ 
      message: 'Default permissions updated successfully', 
      defaultPermissions: newDefaults,
      default_permissions: newDefaults
    });
  } catch (err) {
    console.error('Error updating default permissions:', err);
    res.status(500).json({ error: 'Failed to update default permissions' });
  }
});

/**
 * Resolves and validates the trusted application URL from environment configuration.
 * Never trusts request headers (Origin/Host) or hardcoded localhost fallbacks.
 * Enforces HTTPS in production and preserves the application base path.
 */
function getValidatedAppUrl() {
  const configured = process.env.APP_URL || process.env.CLIENT_URL || process.env.FRONTEND_URL;
  if (!configured || typeof configured !== 'string' || !configured.trim()) {
    const err = new Error('Application URL is not configured. Configure APP_URL or CLIENT_URL in the environment.');
    err.code = 'INVALID_URL_CONFIGURATION';
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(configured.trim());
  } catch {
    const err = new Error('Configured application URL is malformed.');
    err.code = 'INVALID_URL_CONFIGURATION';
    throw err;
  }

  if (process.env.NODE_ENV === 'production') {
    if (parsed.protocol !== 'https:') {
      const err = new Error('Application URL must use HTTPS in production.');
      err.code = 'INVALID_URL_CONFIGURATION';
      throw err;
    }
  } else {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      const err = new Error('Application URL must use HTTP or HTTPS.');
      err.code = 'INVALID_URL_CONFIGURATION';
      throw err;
    }
  }

  let basePath = parsed.pathname.replace(/\/+$/, '');
  if (!basePath) {
    const customBase = process.env.APP_BASE_PATH || process.env.VITE_BASE_PATH || '/bfi-classroom';
    basePath = '/' + customBase.replace(/^\/+|\/+$/g, '');
  }

  return `${parsed.origin}${basePath}`;
}

// POST /api/admin/administrators/:id/reset-password/email - Super Admin-initiated password reset via verified email
router.post('/administrators/:id/reset-password/email', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { expected_account_version, reason } = req.body;

    if (targetId === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', 'Cannot reset founding Super Admin password', req.ip);
      return res.status(403).json({ error: 'Cannot reset the founding Super Administrator password.', code: 'FOUNDING_OWNER_PROTECTED' });
    }

    if (expected_account_version === undefined || expected_account_version === null || typeof expected_account_version !== 'number') {
      return res.status(400).json({ 
        error: 'Expected account version is required for concurrency control.', 
        code: 'MISSING_ACCOUNT_VERSION' 
      });
    }

    const targetUser = db.prepare('SELECT id, username, email, role, is_active, archived_at, account_version, token_version, email_verified_at, verified_email, is_super_admin FROM users WHERE id = ? AND deleted_at IS NULL').get(targetId);
    if (targetUser && targetUser.is_super_admin === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', 'Cannot reset peer Super Admin password', req.ip);
      return res.status(403).json({ error: 'Super Administrators cannot reset passwords for other Super Administrators.', code: 'PEER_RESET_FORBIDDEN' });
    }
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    if (targetUser.archived_at !== null) {
      return res.status(400).json({ 
        error: 'Cannot reset password for an archived administrator. Restore the account first.', 
        code: 'ACCOUNT_ARCHIVED' 
      });
    }

    if (targetUser.account_version !== expected_account_version) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', "Concurrency conflict: expected version " + expected_account_version + " but found " + targetUser.account_version, req.ip);
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT',
        currentVersion: targetUser.account_version
      });
    }

    if (!targetUser.email || !targetUser.email_verified_at || targetUser.verified_email !== targetUser.email) {
      return res.status(400).json({ 
        error: 'Target administrator does not have a verified email address. Password reset link cannot be dispatched via email without email ownership confirmation.', 
        code: 'EMAIL_NOT_VERIFIED' 
      });
    }

    let baseUrl;
    try {
      baseUrl = getValidatedAppUrl();
    } catch (urlErr) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', `Invalid URL configuration: ${urlErr.message}`, req.ip);
      return res.status(500).json({ 
        error: 'Application URL configuration is invalid. Password reset cannot be initiated until APP_URL is correctly configured.',
        code: 'INVALID_URL_CONFIGURATION'
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const nextTokenVersion = (targetUser.token_version || 1) + 1;
    const nextAccountVersion = expected_account_version + 1;

    const resetTx = db.transaction(() => {
      const updateResult = db.prepare(`
        UPDATE users 
        SET account_version = ?,
            token_version = ?,
            password_reset_pending = 1,
            password_reset_requested_at = datetime('now'),
            password_reset_requested_by = ?,
            updated_at = datetime('now')
        WHERE id = ? AND account_version = ? AND archived_at IS NULL
      `).run(nextAccountVersion, nextTokenVersion, req.user.id, targetId, expected_account_version);

      if (updateResult.changes === 0) {
        throw new Error('CONCURRENCY_CONFLICT');
      }

      db.prepare(`
        INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, created_by_admin_id, expires_at)
        VALUES (?, ?, 'admin_password_reset', ?, ?, ?)
        ON CONFLICT(user_id, purpose) DO UPDATE SET 
          token_hash = excluded.token_hash, 
          token_version = excluded.token_version,
          created_by_admin_id = excluded.created_by_admin_id,
          expires_at = excluded.expires_at,
          created_at = datetime('now')
      `).run(targetId, tokenHash, nextTokenVersion, req.user.id, expiresAt);

      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(targetId);

      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'admin.mail_submitted',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { password_reset_pending: targetUser.password_reset_pending, account_version: expected_account_version },
        afterState: { password_reset_pending: 1, account_version: nextAccountVersion },
        details: { reason: reason ? reason.trim() : 'Super Admin-initiated password reset via email', expires_in: '30m' },
        ipAddress: req.ip || '',
        throwOnError: true
      });
    });

    resetTx();
    securityEvents.emit('revoke_user', { userId: targetId });

    const resetLink = `${baseUrl}/admin/reset-password#userId=${targetUser.id}&token=${rawToken}`;

    const emailSent = await sendPasswordResetEmail(targetUser.email, resetLink, { isSuperAdminInitiated: true });

    if (!emailSent && process.env.NODE_ENV !== 'test') {
      recordFailedAuditLog(req.user.id, targetId, 'admin.mail_submission_failed', 'SMTP transport dispatch failed', req.ip);
      return res.status(500).json({ error: 'Failed to send reset email. Please try generating an out-of-band recovery link.' });
    }

    res.json({
      message: 'Reset link dispatched to verified administrator email.',
      expires_in: '30m',
      account_version: nextAccountVersion
    });
  } catch (err) {
    if (err.message === 'CONCURRENCY_CONFLICT') {
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT' 
      });
    }
    console.error('Error initiating admin password reset by email:', err);
    res.status(500).json({ error: 'Failed to initiate password reset' });
  }
});

// POST /api/admin/administrators/:id/reset-password/direct-link - Super Admin direct out-of-band fragment link
router.post('/administrators/:id/reset-password/direct-link', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { expected_account_version, reason } = req.body;

    if (targetId === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', 'Cannot reset founding Super Admin password', req.ip);
      return res.status(403).json({ error: 'Cannot reset the founding Super Administrator password.', code: 'FOUNDING_OWNER_PROTECTED' });
    }

    if (expected_account_version === undefined || expected_account_version === null || typeof expected_account_version !== 'number') {
      return res.status(400).json({ 
        error: 'Expected account version is required for concurrency control.', 
        code: 'MISSING_ACCOUNT_VERSION' 
      });
    }

    const targetUser = db.prepare('SELECT id, username, email, role, is_active, archived_at, account_version, token_version, is_super_admin FROM users WHERE id = ? AND deleted_at IS NULL').get(targetId);
    if (targetUser && targetUser.is_super_admin === 1) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', 'Cannot reset peer Super Admin password', req.ip);
      return res.status(403).json({ error: 'Super Administrators cannot reset passwords for other Super Administrators.', code: 'PEER_RESET_FORBIDDEN' });
    }
    if (!targetUser || targetUser.role !== 'admin') {
      return res.status(404).json({ error: 'Administrator not found.' });
    }

    if (targetUser.archived_at !== null) {
      return res.status(400).json({ 
        error: 'Cannot reset password for an archived administrator. Restore the account first.', 
        code: 'ACCOUNT_ARCHIVED' 
      });
    }

    if (targetUser.account_version !== expected_account_version) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', "Concurrency conflict: expected version " + expected_account_version + " but found " + targetUser.account_version, req.ip);
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT',
        currentVersion: targetUser.account_version
      });
    }

    let baseUrl;
    try {
      baseUrl = getValidatedAppUrl();
    } catch (urlErr) {
      recordFailedAuditLog(req.user.id, targetId, 'admin_password_reset', `Invalid URL configuration: ${urlErr.message}`, req.ip);
      return res.status(500).json({ 
        error: 'Application URL configuration is invalid. Password reset cannot be initiated until APP_URL is correctly configured.',
        code: 'INVALID_URL_CONFIGURATION'
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const nextTokenVersion = (targetUser.token_version || 1) + 1;
    const nextAccountVersion = expected_account_version + 1;

    const resetTx = db.transaction(() => {
      const updateResult = db.prepare(`
        UPDATE users 
        SET account_version = ?,
            token_version = ?,
            password_reset_pending = 1,
            password_reset_requested_at = datetime('now'),
            password_reset_requested_by = ?,
            updated_at = datetime('now')
        WHERE id = ? AND account_version = ? AND archived_at IS NULL
      `).run(nextAccountVersion, nextTokenVersion, req.user.id, targetId, expected_account_version);

      if (updateResult.changes === 0) {
        throw new Error('CONCURRENCY_CONFLICT');
      }

      db.prepare(`
        INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, created_by_admin_id, expires_at)
        VALUES (?, ?, 'admin_password_reset', ?, ?, ?)
        ON CONFLICT(user_id, purpose) DO UPDATE SET 
          token_hash = excluded.token_hash, 
          token_version = excluded.token_version,
          created_by_admin_id = excluded.created_by_admin_id,
          expires_at = excluded.expires_at,
          created_at = datetime('now')
      `).run(targetId, tokenHash, nextTokenVersion, req.user.id, expiresAt);

      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(targetId);

      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'admin.direct_reset_link_generated',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { password_reset_pending: targetUser.password_reset_pending, account_version: expected_account_version },
        afterState: { password_reset_pending: 1, account_version: nextAccountVersion },
        details: { reason: reason ? reason.trim() : 'Manual out-of-band delivery', delivery_mode: 'manual_out_of_band', expires_in: '30m' },
        ipAddress: req.ip || '',
        throwOnError: true
      });
    });

    resetTx();
    securityEvents.emit('revoke_user', { userId: targetId });

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const directUrl = `${baseUrl}/admin/reset-password#userId=${targetUser.id}&token=${rawToken}`;

    res.json({
      message: 'Direct recovery link generated.',
      direct_url: directUrl,
      expires_at: expiresAt,
      expires_in_seconds: 1800,
      account_version: nextAccountVersion,
      instructions: 'Share this link over a secure out-of-band channel. It expires in 30 minutes.'
    });
  } catch (err) {
    if (err.message === 'CONCURRENCY_CONFLICT') {
      return res.status(409).json({ 
        error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', 
        code: 'CONCURRENCY_CONFLICT' 
      });
    }
    console.error('Error generating direct reset link:', err);
    res.status(500).json({ error: 'Failed to generate direct reset link' });
  }
});

// GET /api/admin/administrators/:id/export-history - Audited export of administrator accountability history
router.get('/administrators/:id/export-history', authenticateToken, requireSuperAdmin, requireRecentAuth, sanitizeInput, (req, res) => {
  try {
    const adminId = Number(req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ error: 'Invalid administrator ID' });
    }

    const admin = db.prepare('SELECT id, username, email FROM users WHERE id = ? AND deleted_at IS NULL').get(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'Administrator not found' });
    }

    const format = (req.query.format || 'csv').toLowerCase();
    const moduleFilter = String(req.query.module || '').trim().toLowerCase();
    const outcomeFilter = String(req.query.outcome || '').trim().toLowerCase();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    let querySql = `
      SELECT l.id, l.actor_id, l.target_user_id, l.action, l.module, l.resource, l.outcome, l.details, l.ip_address, l.created_at,
             a.username as actor_username, t.username as target_username
      FROM admin_audit_logs l
      LEFT JOIN users a ON a.id = l.actor_id
      LEFT JOIN users t ON t.id = l.target_user_id
      WHERE (l.target_user_id = ? OR l.actor_id = ?)
    `;
    const params = [adminId, adminId];

    if (moduleFilter) {
      querySql += ' AND lower(l.module) = ?';
      params.push(moduleFilter);
    }
    if (outcomeFilter) {
      querySql += ' AND lower(l.outcome) = ?';
      params.push(outcomeFilter);
    }
    if (startDate) {
      querySql += ' AND l.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      querySql += ' AND l.created_at <= ?';
      params.push(endDate);
    }

    querySql += ' ORDER BY l.id DESC LIMIT 5000';

    const rows = db.prepare(querySql).all(...params);

    const sanitizedRecords = rows.map(r => {
      let parsedDetails = typeof r.details === 'string' ? safeJsonParse(r.details) : r.details;
      if (parsedDetails && typeof parsedDetails === 'object') {
        parsedDetails = redactSensitiveData(parsedDetails);
      }
      return {
        id: r.id,
        dhakaTime: formatDhakaTimestamp(r.created_at),
        createdAt: r.created_at,
        actorId: r.actor_id,
        actorUsername: r.actor_username || (r.actor_id ? `Admin #${r.actor_id}` : 'System'),
        targetUserId: r.target_user_id,
        targetUsername: r.target_username || (r.target_user_id ? `User #${r.target_user_id}` : ''),
        action: r.action,
        module: r.module || '',
        outcome: r.outcome,
        ipAddress: r.ip_address || '',
        details: typeof parsedDetails === 'object' ? JSON.stringify(parsedDetails) : String(parsedDetails || '')
      };
    });

    // Record audit log of the export
    recordAuditLog({
      actorId: req.user.id,
      targetUserId: adminId,
      action: 'admin.export_accountability_history',
      module: 'admin_management',
      resource: `admin:${adminId}`,
      outcome: 'success',
      correlationId: req.correlationId,
      details: {
        format,
        row_count: sanitizedRecords.length,
        filters: { module: moduleFilter || null, outcome: outcomeFilter || null, startDate: startDate || null, endDate: endDate || null }
      },
      ipAddress: req.ip || '',
      throwOnError: false
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return res.json({
        targetUserId: adminId,
        count: sanitizedRecords.length,
        exportedAt: new Date().toISOString(),
        records: sanitizedRecords
      });
    }

    // CSV format
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="admin-${adminId}-accountability-history-${Date.now()}.csv"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const headers = ['Event ID', 'Timestamp (Dhaka)', 'Actor ID', 'Actor Username', 'Target ID', 'Target Username', 'Action', 'Module', 'Outcome', 'IP Address', 'Details'];
    const csvLines = [headers.join(',')];

    for (const r of sanitizedRecords) {
      const line = [
        r.id,
        r.dhakaTime,
        r.actorId || '',
        r.actorUsername,
        r.targetUserId || '',
        r.targetUsername,
        r.action,
        r.module,
        r.outcome,
        r.ipAddress,
        r.details
      ].map(val => {
        const sanitized = sanitizeCsvField(val);
        const escaped = sanitized.replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',');
      csvLines.push(line);
    }

    res.send(csvLines.join('\r\n'));
  } catch (err) {
    console.error('Error exporting accountability history:', err);
    res.status(500).json({ error: 'Failed to export administrator accountability history' });
  }
});

export { getValidatedAppUrl };

// ==========================================
// MULTIPLE SUPER ADMIN GOVERNANCE ENDPOINTS
// ==========================================

// POST /api/admin/super-admins/challenge - Issue action-bound challenge for Super Admin ceremonies
router.post('/super-admins/challenge', authenticateToken, requireSuperAdmin, requireRecentAuth, requireSuperAdminMfaEnrolled, sanitizeInput, (req, res) => {
  try {
    const { target_id, action } = req.body;
    const targetId = Number(target_id);

    if (!targetId || !action) {
      return res.status(400).json({ error: 'target_id and action are required.', code: 'INVALID_INPUT' });
    }

    if (!ALLOWED_CHALLENGE_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action: ${action}. Allowed actions: ${ALLOWED_CHALLENGE_ACTIONS.join(', ')}`, code: 'INVALID_ACTION' });
    }

    const targetUser = db.prepare('SELECT id, username, role, is_active, archived_at, deleted_at, is_super_admin, email_verified_at, verified_email, email, two_factor_enabled FROM users WHERE id = ?').get(targetId);
    if (!targetUser || targetUser.role !== 'admin' || targetUser.deleted_at !== null) {
      return res.status(404).json({ error: 'Target administrator not found.', code: 'ADMIN_NOT_FOUND' });
    }

    if (action === 'demote_super_admin') {
      if (Number(targetId) === 1) {
        return res.status(403).json({
          error: 'The founding Super Administrator cannot be demoted, deleted, archived, or reset.',
          code: 'FOUNDING_OWNER_PROTECTED'
        });
      }
      if (targetUser.is_super_admin !== 1) {
        return res.status(400).json({
          error: 'Target administrator is not a Super Administrator.',
          code: 'NOT_SUPER_ADMIN'
        });
      }
    } else if (action === 'promote_super_admin') {
      if (targetUser.is_super_admin === 1) {
        return res.status(400).json({
          error: 'Administrator is already a Super Administrator.',
          code: 'ALREADY_SUPER_ADMIN'
        });
      }
      if (targetUser.archived_at !== null) {
        return res.status(400).json({
          error: 'Cannot promote an archived administrator. Restore the account first.',
          code: 'ACCOUNT_ARCHIVED'
        });
      }
      if (targetUser.is_active !== 1) {
        return res.status(400).json({
          error: 'Cannot promote an inactive administrator.',
          code: 'ACCOUNT_INACTIVE'
        });
      }
      if (!targetUser.email || !targetUser.email_verified_at || targetUser.verified_email !== targetUser.email) {
        return res.status(400).json({
          error: 'Administrator email must be verified prior to Super Administrator promotion.',
          code: 'EMAIL_VERIFICATION_REQUIRED'
        });
      }
      if (targetUser.two_factor_enabled !== 1) {
        return res.status(400).json({
          error: 'Administrator must have two-factor authentication enabled prior to Super Administrator promotion.',
          code: 'MFA_ENROLLMENT_REQUIRED'
        });
      }
    }

    const challenge = issueActionBoundChallenge(db, {
      actorId: req.user.id,
      sessionId: req.user.sessionId,
      targetId,
      action
    });

    res.json(challenge);
  } catch (err) {
    console.error('Error issuing action bound challenge:', err);
    res.status(500).json({ error: 'Failed to issue action challenge' });
  }
});

// POST /api/admin/super-admins/promote - Promote an admin to Super Administrator
router.post('/super-admins/promote', authenticateToken, requireSuperAdmin, requireRecentAuth, requireSuperAdminMfaEnrolled, sanitizeInput, (req, res) => {
  try {
    const { target_id, challenge_id, challenge_token, code, recovery_code } = req.body;
    const targetId = Number(target_id);

    if (!targetId || !challenge_id || !challenge_token) {
      return res.status(400).json({ error: 'target_id, challenge_id, and challenge_token are required.', code: 'INVALID_INPUT' });
    }

    // Step-up verification
    const verifyRes = verifyAndConsumeActionBoundChallenge(db, {
      actorId: req.user.id,
      sessionId: req.user.sessionId,
      targetId,
      action: 'promote_super_admin',
      challengeId: challenge_id,
      challengeToken: challenge_token,
      code,
      recoveryCode: recovery_code
    });

    if (!verifyRes.success) {
      return res.status(401).json({ error: verifyRes.error, code: verifyRes.code });
    }

    // Atomic transaction for promotion
    const promoteTx = db.transaction(() => {
      const target = db.prepare(`
        SELECT id, username, email, role, is_active, archived_at, deleted_at, is_super_admin, email_verified_at, verified_email, two_factor_enabled, account_version, token_version
        FROM users WHERE id = ?
      `).get(targetId);

      if (!target || target.role !== 'admin' || target.deleted_at !== null) {
        const err = new Error('Target administrator not found.');
        err.code = 'ADMIN_NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (target.is_super_admin === 1) {
        const err = new Error('Administrator is already a Super Administrator.');
        err.code = 'ALREADY_SUPER_ADMIN';
        err.status = 400;
        throw err;
      }

      if (target.archived_at !== null) {
        const err = new Error('Cannot promote an archived administrator.');
        err.code = 'ACCOUNT_ARCHIVED';
        err.status = 400;
        throw err;
      }

      if (target.is_active !== 1) {
        const err = new Error('Cannot promote an inactive administrator.');
        err.code = 'ACCOUNT_INACTIVE';
        err.status = 400;
        throw err;
      }

      if (!target.email || !target.email_verified_at || target.verified_email !== target.email) {
        const err = new Error('Administrator email must be verified prior to Super Administrator promotion.');
        err.code = 'EMAIL_VERIFICATION_REQUIRED';
        err.status = 400;
        throw err;
      }

      if (target.two_factor_enabled !== 1) {
        const err = new Error('Administrator must have two-factor authentication enabled prior to Super Administrator promotion.');
        err.code = 'MFA_ENROLLMENT_REQUIRED';
        err.status = 400;
        throw err;
      }

      // Promote target
      db.prepare(`
        UPDATE users
        SET is_super_admin = 1,
            account_version = account_version + 1,
            token_version = token_version + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(targetId);

      // Super Admins have universal implicit permissions; clean up granular rows
      db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(targetId);

      // Revoke all existing sessions so target must sign in fresh
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);

      // Record audit log
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'super_admin_promoted',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { is_super_admin: 0, account_version: target.account_version },
        afterState: { is_super_admin: 1, account_version: target.account_version + 1 },
        details: { username: target.username, email: target.email },
        ipAddress: req.ip || '',
        throwOnError: true
      });

      return {
        id: target.id,
        username: target.username,
        is_super_admin: 1,
        isSuperAdmin: true,
        account_version: target.account_version + 1
      };
    });

    const resultUser = promoteTx();

    // Terminate socket connections to force refresh
    securityEvents.emit('revoke_user', { userId: targetId });

    res.json({
      message: 'Administrator successfully promoted to Super Administrator.',
      user: resultUser
    });
  } catch (err) {
    if (err.status && err.code) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error promoting administrator to Super Admin:', err);
    res.status(500).json({ error: 'Failed to promote administrator to Super Administrator' });
  }
});

// POST /api/admin/super-admins/demote - Demote a Super Administrator to ordinary administrator
router.post('/super-admins/demote', authenticateToken, requireSuperAdmin, requireRecentAuth, requireSuperAdminMfaEnrolled, sanitizeInput, (req, res) => {
  try {
    const { target_id, challenge_id, challenge_token, code, recovery_code } = req.body;
    const targetId = Number(target_id);

    if (!targetId || !challenge_id || !challenge_token) {
      return res.status(400).json({ error: 'target_id, challenge_id, and challenge_token are required.', code: 'INVALID_INPUT' });
    }

    // Policy 1: Founding owner protection
    if (Number(targetId) === 1) {
      return res.status(403).json({
        error: 'The founding Super Administrator cannot be demoted, deleted, archived, or reset.',
        code: 'FOUNDING_OWNER_PROTECTED'
      });
    }

    // Step-up verification
    const verifyRes = verifyAndConsumeActionBoundChallenge(db, {
      actorId: req.user.id,
      sessionId: req.user.sessionId,
      targetId,
      action: 'demote_super_admin',
      challengeId: challenge_id,
      challengeToken: challenge_token,
      code,
      recoveryCode: recovery_code
    });

    if (!verifyRes.success) {
      return res.status(401).json({ error: verifyRes.error, code: verifyRes.code });
    }

    // Atomic transaction for demotion
    const demoteTx = db.transaction(() => {
      const target = db.prepare(`
        SELECT id, username, email, role, is_active, archived_at, deleted_at, is_super_admin, account_version, token_version
        FROM users WHERE id = ?
      `).get(targetId);

      if (!target || target.role !== 'admin' || target.deleted_at !== null) {
        const err = new Error('Target administrator not found.');
        err.code = 'ADMIN_NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (target.is_super_admin !== 1) {
        const err = new Error('Target administrator is not a Super Administrator.');
        err.code = 'NOT_SUPER_ADMIN';
        err.status = 400;
        throw err;
      }

      // Policy 2: Last usable Super Admin defense
      const usableSuperAdminCount = db.prepare(`
        SELECT COUNT(*) as c FROM users
        WHERE role = 'admin' AND is_super_admin = 1
          AND is_active = 1 AND archived_at IS NULL AND deleted_at IS NULL
          AND password_reset_pending = 0 AND two_factor_enabled = 1
          AND id != ?
      `).get(targetId).c;

      if (usableSuperAdminCount === 0) {
        const err = new Error('Cannot demote the last usable Super Administrator. At least one active, unarchived, MFA-enrolled Super Administrator must remain.');
        err.code = 'LAST_SUPER_ADMIN_PROTECTED';
        err.status = 409;
        throw err;
      }

      // Demote target: becomes ordinary admin with ZERO permissions
      db.prepare(`
        UPDATE users
        SET is_super_admin = 0,
            account_version = account_version + 1,
            token_version = token_version + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(targetId);

      // Ensure zero permissions: delete all rows in admin_permissions
      db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(targetId);

      // Invalidate all active sessions so target must log in again as ordinary admin
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);

      // Record audit log
      recordAuditLog({
        actorId: req.user.id,
        targetUserId: targetId,
        action: 'super_admin_demoted',
        module: 'admin_management',
        resource: `admin:${targetId}`,
        outcome: 'success',
        correlationId: req.correlationId,
        beforeState: { is_super_admin: 1, account_version: target.account_version },
        afterState: { is_super_admin: 0, account_version: target.account_version + 1, permissions: [] },
        details: { username: target.username, email: target.email },
        ipAddress: req.ip || '',
        throwOnError: true
      });

      return {
        id: target.id,
        username: target.username,
        is_super_admin: 0,
        isSuperAdmin: false,
        account_version: target.account_version + 1,
        permissions: []
      };
    });

    const resultUser = demoteTx();

    // Terminate socket connections
    securityEvents.emit('revoke_user', { userId: targetId });

    res.json({
      message: 'Super Administrator demoted to ordinary administrator with zero permissions.',
      user: resultUser
    });
  } catch (err) {
    if (err.status && err.code) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error demoting Super Administrator:', err);
    res.status(500).json({ error: 'Failed to demote Super Administrator' });
  }
});

export default router;
