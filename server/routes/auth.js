import { formatDhakaTimestamp, recordAuditLog } from '../services/auditLedgerService.js';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticateToken, authLimiter, sanitizeInput, sensitiveEndpointLimiter, generatePasswordResetToken, verifyPasswordResetToken, validatePassword, getClientIp } from '../middleware/auth.js';
import { getJwtRefreshSecret, getJwtSecret } from '../config/security.js';
import { sendPasswordResetEmail, sendEmailVerificationChallenge, sendPasswordChangeNotificationEmail } from '../utils/email.js';
import { verifyTotpCode, decryptSecret, generateTotpSecret, generateTotpUri, encryptSecret, generateRecoveryCodes } from '../utils/totp.js';
import { securityEvents } from '../utils/security-events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();
const REFRESH_COOKIE_NAME = 'bfi_refresh_token';

function buildUserPayload(user) {
  let profile = null;
  if (user.role === 'student') {
    profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
  } else if (user.role === 'instructor' || user.role === 'admin') {
    profile = { full_name: `${user.first_name} ${user.last_name}` };
  }

  const isSuper = user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);

  let permissions = [];
  if (isSuper) {
    permissions = ['*'];
  } else if (user.role === 'admin') {
    try {
      permissions = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(user.id).map(r => r.permission);
    } catch {
      permissions = [];
    }
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    profilePicture: user.profile_picture,
    publicKey: user.public_key,
    batch: profile?.batch_number,
    studentId: profile?.student_id,
    is_super_admin: isSuper ? 1 : 0,
    isSuperAdmin: isSuper,
    permissions
  };
}

function signAccessToken(user, sessionId = null) {
  const isSuper = user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);
  // Privileged administrators use 15m short-lived tokens; non-privileged users use standard expiry
  const isPrivileged = user.role === 'admin';
  const expiresIn = isPrivileged ? '15m' : (process.env.JWT_EXPIRY || '365d');

  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: `${user.first_name} ${user.last_name}`,
    is_super_admin: isSuper ? 1 : 0,
    token_version: user.token_version || 1,
    type: 'access'
  };

  if (sessionId) {
    payload.sessionId = sessionId;
  }

  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setRefreshCookie(req, res, token) {
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function issueRefreshToken(req, res, user) {
  const isSuper = user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);
  const refreshToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role, is_super_admin: isSuper ? 1 : 0, token_version: user.token_version || 1 },
    getJwtRefreshSecret(),
    { expiresIn: '7d' }
  );
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const insert = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `).run(user.id, hashToken(refreshToken), req.ip || '', req.get('user-agent') || '', expiresAt);

  setRefreshCookie(req, res, refreshToken);
  return insert.lastInsertRowid;
}

// Cloudflare Turnstile token verifier
const TURNSTILE_DEFAULT_SECRET = '0x4AAAAAAFjcgxWdsFD76vYeWwOAe3VG7pI';

async function verifyTurnstileToken(token, ip) {
  if (process.env.IS_TEST_SERVER === 'true' || process.env.NODE_ENV === 'test') {
    if (token === 'mock_test_turnstile_token' || token === 'test-token-valid') {
      return true;
    }
  }
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET || TURNSTILE_DEFAULT_SECRET;
  if (!secretKey) {
    return true;
  }
  if (!token) {
    return false;
  }
  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (ip) {
      formData.append('remoteip', ip);
    }

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = await res.json();
    return Boolean(data && data.success);
  } catch (err) {
    console.error('[TURNSTILE] Verification request error:', err);
    return false;
  }
}

// Login route
// In-memory registry of consumed token hashes to guarantee atomic single-use semantics
const consumedMaintenanceTokenHashes = new Set();

/**
 * Resets in-memory consumed maintenance tokens (primarily for unit/integration testing).
 */
export function resetMaintenanceCapabilityMemory() {
  consumedMaintenanceTokenHashes.clear();
}

/**
 * Validates active deployment state and capability token under strict fail-closed rules.
 *
 * Requirements:
 * 1. Active deployment state must exist and be valid JSON.
 * 2. attemptId must be valid string (length >= 8).
 * 3. backupValidated must be strictly true.
 * 4. backupFile must be valid string and exist on disk.
 * 5. active_backup_path.env (if present) must match attemptId and backupFile without ROLLBACK_COMPLETED.
 * 6. trafficMayReopen must be strictly false (non-boolean, true, or missing rejected).
 * 7. trafficReopened must be strictly false (non-boolean, true, or missing rejected).
 * 8. rollbackCompleted must be strictly false (true or non-boolean rejected if present).
 * 9. rolledBackAt / completed / terminal must not be present.
 * 10. Capability token must match disk, be bound to attemptId, not be expired, and be consumed atomically.
 */
export function verifyAndConsumeMaintenanceCapability({ maintTokenPath, stateFilePath, reqMaintToken, username }) {
  if (!maintTokenPath || !stateFilePath || typeof reqMaintToken !== 'string' || reqMaintToken.length < 32) {
    return false;
  }

  // 1. Fast in-memory replay rejection (atomic within process)
  const tokenHash = crypto.createHash('sha256').update(reqMaintToken).digest('hex');
  if (consumedMaintenanceTokenHashes.has(tokenHash)) {
    return false;
  }

  // 2. State file inspection (Strict fail-closed)
  if (!fs.existsSync(stateFilePath)) {
    return false;
  }

  let deployState;
  try {
    deployState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch {
    return false;
  }

  if (!deployState || typeof deployState !== 'object') {
    return false;
  }

  // 2.1 Attempt ID verification (Must be explicit string >= 8 chars)
  if (typeof deployState.attemptId !== 'string' || deployState.attemptId.trim().length < 8) {
    return false;
  }
  const attemptId = deployState.attemptId.trim();

  // 2.2 Backup association verification
  if (deployState.backupValidated !== true) {
    return false;
  }
  if (typeof deployState.backupFile !== 'string' || deployState.backupFile.trim().length === 0) {
    return false;
  }
  if (!fs.existsSync(deployState.backupFile.trim())) {
    return false;
  }

  // 2.3 Verify against active_backup_path.env if present
  const serverDir = path.dirname(stateFilePath);
  const activeBackupEnvPath = path.join(serverDir, 'active_backup_path.env');
  if (fs.existsSync(activeBackupEnvPath)) {
    try {
      const envContent = fs.readFileSync(activeBackupEnvPath, 'utf8');
      const mAttempt = envContent.match(/ATTEMPT_ID=([^\r\n]+)/);
      const mFile = envContent.match(/BACKUP_FILE=([^\r\n]+)/);
      const mValidated = envContent.match(/BACKUP_VALIDATED=([^\r\n]+)/);
      const mRollback = envContent.match(/ROLLBACK_COMPLETED=([^\r\n]+)/);

      if (mAttempt && mAttempt[1].trim() !== attemptId) return false;
      if (mFile && path.resolve(serverDir, mFile[1].trim()) !== path.resolve(serverDir, deployState.backupFile.trim())) return false;
      if (mValidated && mValidated[1].trim() !== 'true') return false;
      if (mRollback && mRollback[1].trim() === 'true') return false;
    } catch {
      return false;
    }
  }

  // 2.4 Explicit boolean exposure flags (Must be strictly false!)
  if (deployState.trafficMayReopen !== false) {
    return false;
  }
  if (deployState.trafficReopened !== false) {
    return false;
  }

  // 2.5 Nonterminal deployment phase
  if (deployState.rollbackCompleted === true) {
    return false;
  }
  if (deployState.rollbackCompleted !== undefined && typeof deployState.rollbackCompleted !== 'boolean') {
    return false;
  }
  if (deployState.rolledBackAt || deployState.completed === true || deployState.terminal === true) {
    return false;
  }

  // 3. Capability file inspection
  if (!fs.existsSync(maintTokenPath)) {
    return false;
  }

  const stat = fs.statSync(maintTokenPath);
  const isFreshMtime = (Date.now() - stat.mtimeMs) < 15 * 60 * 1000;
  if (!isFreshMtime) {
    return false;
  }

  let rawContent;
  try {
    rawContent = fs.readFileSync(maintTokenPath, 'utf8').trim();
  } catch {
    return false;
  }

  if (!rawContent) return false;

  let capRecord;
  try {
    capRecord = JSON.parse(rawContent);
  } catch {
    // If not JSON, check for colon-delimited format: attemptId:token
    const colonIdx = rawContent.indexOf(':');
    if (colonIdx > 0) {
      const parsedAttempt = rawContent.slice(0, colonIdx).trim();
      const parsedToken = rawContent.slice(colonIdx + 1).trim();
      if (parsedAttempt.length >= 8 && parsedToken.length >= 32) {
        capRecord = {
          attemptId: parsedAttempt,
          token: parsedToken
        };
      } else {
        return false;
      }
    } else {
      // Raw string without attemptId binding -> missing metadata! Reject.
      return false;
    }
  }

  if (!capRecord || typeof capRecord !== 'object') {
    return false;
  }

  // 3.1 Attempt binding verification (Must match deployState.attemptId)
  if (typeof capRecord.attemptId !== 'string' || capRecord.attemptId.trim() !== attemptId) {
    return false;
  }

  // 3.2 Expiration verification
  if (capRecord.expiresAt) {
    const expTime = new Date(capRecord.expiresAt).getTime();
    if (isNaN(expTime) || expTime <= Date.now()) {
      return false;
    }
  }
  if (capRecord.createdAt) {
    const createTime = new Date(capRecord.createdAt).getTime();
    if (isNaN(createTime) || (Date.now() - createTime) > 15 * 60 * 1000) {
      return false;
    }
  }

  // 4. Token match & atomic consumption
  const reqBuf = Buffer.from(reqMaintToken);

  // Case A: Array of tokens (separate capabilities for multiple accounts)
  if (Array.isArray(capRecord.tokens)) {
    const matchIndex = capRecord.tokens.findIndex(entry => {
      if (!entry || typeof entry.token !== 'string' || entry.consumed === true) return false;
      if (entry.token.length !== reqMaintToken.length) return false;
      if (entry.username && username && entry.username.toLowerCase() !== username.toLowerCase()) return false;
      return crypto.timingSafeEqual(Buffer.from(entry.token), reqBuf);
    });

    if (matchIndex === -1) {
      return false;
    }

    // Atomic consumption: Add to in-memory set immediately
    consumedMaintenanceTokenHashes.add(tokenHash);

    // Mark consumed in record
    capRecord.tokens[matchIndex].consumed = true;
    capRecord.tokens[matchIndex].consumedAt = new Date().toISOString();

    const remainingUnconsumed = capRecord.tokens.filter(t => !t.consumed);
    if (remainingUnconsumed.length === 0) {
      // All tokens consumed -> unlink file
      try {
        const len = fs.statSync(maintTokenPath).size;
        fs.writeFileSync(maintTokenPath, Buffer.alloc(len, 0));
        fs.unlinkSync(maintTokenPath);
      } catch {
        // Best-effort cleanup
      }
    } else {
      // Write updated state atomically
      const tmpPath = `${maintTokenPath}.tmp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tmpPath, JSON.stringify(capRecord, null, 2), { mode: 0o600 });
      try {
        fs.renameSync(tmpPath, maintTokenPath);
      } catch {
        fs.copyFileSync(tmpPath, maintTokenPath);
        try { fs.unlinkSync(tmpPath); } catch { /* ignore tmp unlink failure */ }
      }
    }

    return true;
  }

  // Case B: Single token record
  if (typeof capRecord.token === 'string') {
    if (capRecord.consumed === true) {
      return false;
    }
    if (capRecord.username && username && capRecord.username.toLowerCase() !== username.toLowerCase()) {
      return false;
    }
    if (capRecord.token.length !== reqMaintToken.length) {
      return false;
    }
    if (!crypto.timingSafeEqual(Buffer.from(capRecord.token), reqBuf)) {
      return false;
    }

    // Atomic consumption: Add to in-memory set and unlink file
    consumedMaintenanceTokenHashes.add(tokenHash);

    try {
      const len = fs.statSync(maintTokenPath).size;
      fs.writeFileSync(maintTokenPath, Buffer.alloc(len, 0));
      fs.unlinkSync(maintTokenPath);
    } catch {
      // Best-effort cleanup
    }

    return true;
  }

  return false;
}

router.post('/login', authLimiter, sanitizeInput, async (req, res) => {
  const { username, password, type = 'student', turnstileToken } = req.body;

  if (!username || !password) {
    return res.status(400).json({ 
      error: 'Username/Email and password are required',
      field: !username ? 'username' : 'password'
    });
  }

  // Cloudflare Turnstile bot verification
  const isTestServer = process.env.NODE_ENV === 'test' || process.env.IS_TEST_SERVER === 'true';
  const turnstileSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET || (isTestServer ? null : TURNSTILE_DEFAULT_SECRET);

  let isTurnstileVerified = false;

  // 1. Supported browser flow: Verify submitted Turnstile response token
  const token = turnstileToken || req.body?.['cf-turnstile-response'];
  if (token) {
    const clientIp = getClientIp(req);
    const isBotCheckPassed = await verifyTurnstileToken(token, clientIp);
    if (!isBotCheckPassed) {
      return res.status(403).json({ 
        error: 'Security verification failed. Please complete the Cloudflare security check again.',
        field: 'turnstile'
      });
    }
    isTurnstileVerified = true;
  } else if (isTestServer) {
    isTurnstileVerified = true;
  } else {
        // 2. Separately reviewed, explicitly authorized maintenance-scoped verification
    // Permitted ONLY on direct loopback, WITHOUT proxy headers, during an active pre-exposure deployment window
    // with an unconsumed, unexpired capability bound to this exact deployment attempt
    const remoteIp = req.socket?.remoteAddress || '';
    const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    const hasProxyHeaders = Boolean(
      req.headers['x-forwarded-for'] ||
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['forwarded']
    );
    const reqMaintToken = req.headers['x-bfi-maintenance-token'];

    if (isLoopback && !hasProxyHeaders && typeof reqMaintToken === 'string' && reqMaintToken.length >= 32) {
      try {
        const maintTokenPath = process.env.MAINTENANCE_TOKEN_PATH || path.resolve(__dirname, '..', '.maintenance_auth_token');
        const stateFilePath = process.env.DEPLOYMENT_STATE_PATH || path.resolve(__dirname, '..', 'active_deployment_state.json');

        isTurnstileVerified = verifyAndConsumeMaintenanceCapability({
          maintTokenPath,
          stateFilePath,
          reqMaintToken,
          username
        });
      } catch {
        isTurnstileVerified = false;
      }
    }
  }

  if (turnstileSecret && !isTurnstileVerified) {
    return res.status(400).json({ 
      error: 'Security verification required. Please complete the Cloudflare security check.',
      field: 'turnstile'
    });
  }

  // Universal rule: Admin usernames MUST start with 'admin@' (or match an existing admin user)
  if (type === 'admin' && !username.toLowerCase().startsWith('admin@')) {
    const existingAdmin = db.prepare(`
      SELECT id FROM users 
      WHERE (email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) 
      AND role = 'admin' AND is_active = 1 AND deleted_at IS NULL
    `).get(username, username);
    if (!existingAdmin) {
      return res.status(400).json({ 
        error: 'Admin usernames must start with "admin@". Please enter your full admin username (e.g. admin@yourname).',
        field: 'username'
      });
    }
  }

  try {
    const query = `
      SELECT * FROM users 
      WHERE (email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) 
      AND deleted_at IS NULL
    `;
      
    const strippedUsername = username.toLowerCase().startsWith('admin@') ? username.slice(6) : username;
    const user = db.prepare(query.replace('username = ? COLLATE NOCASE', 'username = ? COLLATE NOCASE OR username = ? COLLATE NOCASE')).get(username, username, strippedUsername);

    if (!user || user.archived_at !== null || user.is_active !== 1) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.password_reset_pending === 1) {
      return res.status(403).json({ 
        error: 'A password reset has been initiated for this account. You must set a new password using your reset link before logging in.', 
        code: 'PASSWORD_RESET_PENDING' 
      });
    }

    const isValidPassword = bcrypt.compareSync(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Role Based Separation
    if (type === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: This portal is for Administrators only.' });
    }
    
    if (type === 'student' && user.role === 'admin') {
      return res.status(403).json({ error: 'Administrators must log in via the designated Admin Portal.' });
    }

    // MFA Check for Privileged Users
    if (user.two_factor_enabled === 1) {
      const challengeId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const tokenVersion = user.token_version || 1;

      // Track single-use challenge server-side
      db.prepare(`
        INSERT INTO mfa_login_challenges (id, user_id, token_version, expires_at, consumed)
        VALUES (?, ?, ?, ?, 0)
      `).run(challengeId, user.id, tokenVersion, expiresAt);

      const mfaToken = jwt.sign(
        { 
          id: user.id, 
          username: user.username,
          role: user.role, 
          type: 'mfa_challenge', 
          jti: challengeId,
          challengeId,
          token_version: tokenVersion 
        },
        getJwtSecret(),
        { expiresIn: '5m' }
      );
      return res.json({
        requireMfa: true,
        mfaToken,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role
        }
      });
    }

    // Update last login
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    const sessionId = issueRefreshToken(req, res, user);
    const accessToken = signAccessToken(user, sessionId);

    res.json({
      message: 'Login successful',
      token: accessToken,
      user: buildUserPayload(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// MFA Verification route
router.post('/mfa-verify', authLimiter, sanitizeInput, (req, res) => {
  try {
    const { mfaToken, code, recoveryCode } = req.body;
    if (!mfaToken) {
      return res.status(400).json({ error: 'MFA session token required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(mfaToken, getJwtSecret());
    } catch {
      return res.status(401).json({ error: 'MFA session expired. Please log in again.' });
    }

    if (!decoded || decoded.type !== 'mfa_challenge' || !decoded.id) {
      return res.status(401).json({ error: 'Invalid MFA challenge token.' });
    }

    // Require valid challenge identifier (jti / challengeId)
    const challengeId = decoded.challengeId || decoded.jti;
    if (!challengeId || typeof challengeId !== 'string' || !challengeId.trim()) {
      return res.status(401).json({ 
        error: 'MFA challenge identifier is missing. Please log in again.', 
        code: 'CHALLENGE_INVALID' 
      });
    }

    // If both jti and challengeId are present, require them to match exactly
    if (decoded.jti && decoded.challengeId && decoded.jti !== decoded.challengeId) {
      return res.status(401).json({ 
        error: 'MFA challenge identifier mismatch. Please log in again.', 
        code: 'CHALLENGE_INVALID' 
      });
    }

    // Require security version claim in token
    if (decoded.token_version === undefined || decoded.token_version === null || typeof decoded.token_version !== 'number') {
      return res.status(401).json({ 
        error: 'MFA challenge security version is missing. Please log in again.', 
        code: 'CHALLENGE_INVALID' 
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(decoded.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.is_active !== 1 || user.archived_at !== null) {
      return res.status(401).json({ error: 'MFA challenge expired or invalidated. Account inactive or revoked.' });
    }

    if (user.password_reset_pending === 1) {
      return res.status(403).json({ 
        error: 'Password reset pending for this account.', 
        code: 'PASSWORD_RESET_PENDING' 
      });
    }

    // Security version check on challenge: reject if user's token_version changed (e.g. deactivation, password reset, recovery)
    const expectedTokenVersion = user.token_version || 1;
    if (decoded.token_version !== expectedTokenVersion) {
      return res.status(401).json({ 
        error: 'MFA challenge expired or invalidated. Please log in again.', 
        code: 'CHALLENGE_INVALIDATED' 
      });
    }

    // Server-side single-use challenge tracking: Record MUST exist in mfa_login_challenges
    const challenge = db.prepare('SELECT * FROM mfa_login_challenges WHERE id = ? AND user_id = ?').get(challengeId, user.id);
    if (!challenge) {
      return res.status(401).json({ 
        error: 'Invalid or untracked MFA challenge. Please log in again.', 
        code: 'CHALLENGE_INVALID' 
      });
    }
    if (challenge.consumed === 1) {
      return res.status(401).json({ 
        error: 'This MFA challenge has already been consumed. Please log in again.', 
        code: 'CHALLENGE_ALREADY_USED' 
      });
    }
    if (new Date(challenge.expires_at) <= new Date()) {
      return res.status(401).json({ 
        error: 'MFA challenge has expired. Please log in again.', 
        code: 'CHALLENGE_EXPIRED' 
      });
    }
    if (challenge.token_version !== expectedTokenVersion || challenge.token_version !== decoded.token_version) {
      return res.status(401).json({ 
        error: 'MFA challenge expired or invalidated by security change. Please log in again.', 
        code: 'CHALLENGE_INVALIDATED' 
      });
    }

    let verificationStep = null;
    let matchedRecoveryId = null;

    if (code) {
      if (!user.two_factor_secret) {
        return res.status(400).json({ error: 'MFA is not configured for this account.' });
      }
      const plainSecret = decryptSecret(user.two_factor_secret);
      const verification = verifyTotpCode(plainSecret, code, {
        lastTimestamp: user.last_totp_timestamp || 0
      });

      if (!verification.valid) {
        if (verification.reason === 'REPLAY_DETECTED') {
          return res.status(400).json({ error: 'This verification code was already used. Please wait for a new code.' });
        }
        return res.status(400).json({ error: 'Invalid verification code.' });
      }

      verificationStep = verification.step;
    } else if (recoveryCode) {
      const cleanRecovery = String(recoveryCode).trim().toUpperCase();
      let rows = db.prepare('SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
      if (rows.length === 0) {
        rows = db.prepare('SELECT id, code_hash FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
      }
      for (const row of rows) {
        if (bcrypt.compareSync(cleanRecovery, row.code_hash)) {
          matchedRecoveryId = row.id;
          break;
        }
      }

      if (!matchedRecoveryId) {
        return res.status(400).json({ error: 'Invalid or already used recovery code.' });
      }
    } else {
      return res.status(400).json({ error: 'Verification code or recovery code is required.' });
    }

    // Atomically consume challenge, consume factor, and create authenticated session
    const commitMfaLoginTx = db.transaction(() => {
      // 1. Atomically consume the challenge (concurrency guard: changes === 0 means race lost)
      const consumeRes = db.prepare(`
        UPDATE mfa_login_challenges 
        SET consumed = 1, consumed_at = datetime('now')
        WHERE id = ? AND user_id = ? AND consumed = 0
      `).run(challengeId, user.id);

      if (consumeRes.changes === 0) {
        throw new Error('CHALLENGE_ALREADY_USED');
      }

      // 2. Consume factor atomically
      if (verificationStep !== null) {
        const totpRes = db.prepare(`
          UPDATE users 
          SET last_totp_timestamp = ?, last_login = datetime('now') 
          WHERE id = ? AND (last_totp_timestamp IS NULL OR last_totp_timestamp < ?)
        `).run(verificationStep, user.id, verificationStep);

        if (totpRes.changes === 0) {
          throw new Error('TOTP_REPLAY_DETECTED');
        }
      } else if (matchedRecoveryId !== null) {
        let recovChanges = 0;
        const uRes = db.prepare(`
          UPDATE user_mfa_recovery_codes
          SET used = 1, used_at = datetime('now')
          WHERE id = ? AND user_id = ? AND used = 0
        `).run(matchedRecoveryId, user.id);
        recovChanges += uRes.changes;

        const aRes = db.prepare(`
          UPDATE admin_mfa_recovery_codes
          SET used = 1, used_at = datetime('now')
          WHERE id = ? AND user_id = ? AND used = 0
        `).run(matchedRecoveryId, user.id);
        recovChanges += aRes.changes;

        if (recovChanges === 0) {
          throw new Error('RECOVERY_CODE_ALREADY_USED');
        }
        db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
      }

      // 3. Issue refresh & access token and insert session
      const sessionId = issueRefreshToken(req, res, user);
      const accessToken = signAccessToken(user, sessionId);

      return { sessionId, accessToken };
    });

    let loginResult;
    try {
      loginResult = commitMfaLoginTx();
    } catch (txErr) {
      if (txErr.message === 'CHALLENGE_ALREADY_USED') {
        return res.status(401).json({ 
          error: 'This MFA challenge has already been consumed. Please log in again.', 
          code: 'CHALLENGE_ALREADY_USED' 
        });
      }
      if (txErr.message === 'TOTP_REPLAY_DETECTED') {
        return res.status(400).json({ 
          error: 'This verification code was already used. Please wait for a new code.', 
          code: 'TOTP_REPLAY_DETECTED' 
        });
      }
      if (txErr.message === 'RECOVERY_CODE_ALREADY_USED') {
        return res.status(400).json({ 
          error: 'Invalid or already used recovery code.', 
          code: 'RECOVERY_CODE_ALREADY_USED' 
        });
      }
      throw txErr;
    }

    res.json({
      message: 'Login successful',
      token: loginResult.accessToken,
      user: buildUserPayload(user)
    });
  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(500).json({ error: 'Internal server error during MFA verification' });
  }
});

router.post('/refresh', (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, getJwtRefreshSecret());
    const tokenHash = hashToken(refreshToken);
    const session = db.prepare(`
      SELECT id
      FROM sessions
      WHERE user_id = ?
        AND token_hash = ?
        AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(decoded.id, tokenHash);

    if (!session) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'Invalid refresh session' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL AND archived_at IS NULL').get(decoded.id);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.password_reset_pending === 1) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      return res.status(403).json({ 
        error: 'Password reset pending for this account.', 
        code: 'PASSWORD_RESET_PENDING' 
      });
    }

    // Token version check on refresh
    if (decoded.token_version !== undefined && decoded.token_version !== (user.token_version || 1)) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'Session revoked' });
    }

    // Refresh token rotation
    const newRefreshToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role, is_super_admin: user.is_super_admin, token_version: user.token_version || 1 },
      getJwtRefreshSecret(),
      { expiresIn: '7d' }
    );
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE sessions 
      SET token_hash = ?, expires_at = ?, last_activity = datetime('now')
      WHERE id = ?
    `).run(hashToken(newRefreshToken), newExpiresAt, session.id);

    setRefreshCookie(req, res, newRefreshToken);

    return res.json({
      token: signAccessToken(user, session.id),
      user: buildUserPayload(user),
    });
  } catch {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Refresh failed' });
  }
});

router.post('/logout', (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (refreshToken) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(refreshToken));
  }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      if (decoded.sessionId) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(decoded.sessionId);
      }
      if (decoded.id) {
        db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(decoded.id);
        securityEvents.emit('revoke_session', { userId: decoded.id, sessionId: decoded.sessionId });
      }
    } catch {
      // Ignore token verification errors during logout
    }
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
  res.json({ message: 'Logged out' });
});

// Get current user details
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.role,
        u.first_name,
        u.last_name,
        u.profile_picture,
        u.public_key,
        u.is_super_admin,
        sp.batch_number,
        sp.student_id
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `).get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isSuper = user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true);

    let permissions = [];
    if (isSuper) {
      permissions = ['*'];
    } else if (user.role === 'admin') {
      try {
        permissions = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(user.id).map(r => r.permission);
      } catch {
        permissions = [];
      }
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      profilePicture: user.profile_picture,
      publicKey: user.public_key,
      batch: user.batch_number,
      studentId: user.student_id,
      is_super_admin: isSuper ? 1 : 0,
      isSuperAdmin: Boolean(isSuper),
      permissions
    });
  } catch (error) {
    console.error('Fetch me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/check-username', authenticateToken, sensitiveEndpointLimiter, (req, res) => {
  try {
    const rawUsername = req.query.username?.toString().trim() || '';

    if (!rawUsername) {
      return res.json({ available: false, valid: false, message: 'Username is required.' });
    }

    const isSpecialAdmin = rawUsername.toLowerCase().startsWith('admin@');
    
    // Check total length for sanity (max 500)
    if (rawUsername.length > 500) {
      return res.json({ available: false, valid: false, message: 'Username is way too long.' });
    }

    if (rawUsername.includes(' ')) {
      return res.json({ available: false, valid: false, message: 'Username cannot contain spaces.' });
    }

    if (req.user.role === 'admin' && !isSpecialAdmin) {
      return res.json({ 
        available: false, 
        valid: false, 
        message: 'Admin usernames must start with "admin@".' 
      });
    }

    const existingUser = db.prepare(`
      SELECT id
      FROM users
      WHERE lower(username) = lower(?)
        AND id != ?
      LIMIT 1
    `).get(rawUsername, req.user.id);

    if (existingUser) {
      return res.json({
        available: false,
        valid: true,
        message: 'Username is already taken.',
      });
    }

    return res.json({
      available: true,
      valid: true,
      message: 'Username is available.',
    });
  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update display name (works for admin and student)
router.put('/update-name', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { first_name, last_name, username, email } = req.body;
    if (!first_name?.trim()) {
      return res.status(400).json({ error: 'First name is required.' });
    }
    const normalizedEmail = email?.trim();
    let normalizedUsername = (username || '').trim();
    
    // For admins, username MUST start with 'admin@'
    if (req.user.role === 'admin') {
      if (!normalizedUsername.startsWith('admin@')) {
        // If they sent just "abir", make it "admin@abir"
        // If they sent "@abir", make it "admin@abir"
        const suffix = normalizedUsername.replace(/^admin@|^@/, '');
        normalizedUsername = 'admin@' + suffix;
      }
      
      if (normalizedUsername === 'admin@') {
        return res.status(400).json({ error: 'Username suffix is required after admin@' });
      }
    } else {
      if (!normalizedUsername) {
        return res.status(400).json({ error: 'Username is required.' });
      }
    }

    if (normalizedUsername.includes(' ')) {
      return res.status(400).json({ error: 'Username cannot contain spaces.' });
    }

    if (normalizedUsername.length > 500) {
      return res.status(400).json({ error: 'Username is way too long.' });
    }

    const existingUser = db.prepare(`
      SELECT id
      FROM users
      WHERE lower(username) = lower(?)
        AND id != ?
      LIMIT 1
    `).get(normalizedUsername, req.user.id);

    if (existingUser) {
      return res.status(400).json({ error: 'That username is already taken.' });
    }

    if (normalizedEmail) {
      const existingEmail = db.prepare(`
        SELECT id FROM users
        WHERE lower(email) = lower(?) AND id != ?
        LIMIT 1
      `).get(normalizedEmail, req.user.id);
      
      if (existingEmail) {
        return res.status(400).json({ error: 'That email is already registered to another account.' });
      }
    }

    if (req.user.role === 'admin') {
      const currentUser = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
      const isEmailChanging = normalizedEmail && currentUser?.email && normalizedEmail.toLowerCase() !== currentUser.email.toLowerCase();
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, username = ?, email = ? WHERE id = ?')
        .run(first_name.trim(), (last_name || '').trim(), normalizedUsername, normalizedEmail || null, req.user.id);

      if (isEmailChanging) {
        db.prepare('UPDATE users SET email_verified_at = NULL, verified_email = NULL WHERE id = ?').run(req.user.id);
        db.prepare('UPDATE email_verification_challenges SET consumed = 1 WHERE user_id = ?').run(req.user.id);
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(req.user.id);
      }
    } else {
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, username = ? WHERE id = ?')
        .run(first_name.trim(), (last_name || '').trim(), normalizedUsername, req.user.id);
    }

    const updated = db.prepare('SELECT id, username, email, role, first_name, last_name, profile_picture, public_key, is_super_admin FROM users WHERE id = ?').get(req.user.id);
    const isSuper = updated.role === 'admin' && (updated.is_super_admin === 1 || updated.is_super_admin === true);
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        role: updated.role,
        firstName: updated.first_name,
        lastName: updated.last_name,
        profilePicture: updated.profile_picture,
        publicKey: updated.public_key,
        is_super_admin: isSuper ? 1 : 0,
        isSuperAdmin: Boolean(isSuper)
      }
    });
  } catch (error) {
    console.error('Name update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update public key for E2E
router.put('/public-key', authenticateToken, (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    try {
      const parsed = typeof publicKey === 'string' ? JSON.parse(publicKey) : publicKey;
      if (parsed?.kty !== 'RSA' || !parsed?.n || !parsed?.e) {
        return res.status(400).json({ error: 'Invalid public key' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid public key' });
    }

    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user.id);

    res.json({ message: 'Public key updated successfully' });
  } catch (error) {
    console.error('Public key update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retrieve the backed-up key pair (used to restore keys in incognito / new devices)
router.get('/key-pair', authenticateToken, (req, res) => {
  try {
    const row = db.prepare('SELECT public_key, private_key FROM users WHERE id = ?').get(req.user.id);
    res.json({
      public_key: row?.public_key || null,
      private_key: row?.private_key || null,
    });
  } catch (error) {
    console.error('Key pair fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Store / update the full key pair on the server (called after key generation)
router.put('/key-pair', authenticateToken, (req, res) => {
  try {
    const { publicKey, privateKey } = req.body;

    if (!publicKey || !privateKey) {
      return res.status(400).json({ error: 'Both publicKey and privateKey are required.' });
    }

    // Basic validation — ensure it is RSA-OAEP JWK
    try {
      const parsed = typeof publicKey === 'string' ? JSON.parse(publicKey) : publicKey;
      if (parsed?.kty !== 'RSA' || !parsed?.n || !parsed?.e) {
        return res.status(400).json({ error: 'Invalid public key format.' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid key format.' });
    }

    db.prepare('UPDATE users SET public_key = ?, private_key = ? WHERE id = ?')
      .run(
        typeof publicKey === 'string' ? publicKey : JSON.stringify(publicKey),
        typeof privateKey === 'string' ? privateKey : JSON.stringify(privateKey),
        req.user.id,
      );

    res.json({ message: 'Key pair updated successfully' });
  } catch (error) {
    console.error('Key pair update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot Password - Request Reset Link
// Forgot Password - Request Reset Link (Student Recovery)
router.post('/forgot-password', authLimiter, sanitizeInput, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1 AND deleted_at IS NULL').get(email);

    if (!user) {
      return res.status(404).json({ error: 'We could not find an active account associated with that email address. Please check for typos or contact administration.' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ 
        error: 'This email is associated with an administrative account. Please use the admin recovery panel.',
        role: 'admin'
      });
    }

    // Generate a secure reset token (valid for 15 minutes)
    const resetToken = generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const tokenVersion = user.token_version || 1;

    // Store the token hash in database with purpose 'user_recovery' and token_version
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, expires_at)
      VALUES (?, ?, 'user_recovery', ?, ?)
      ON CONFLICT(user_id, purpose) DO UPDATE SET 
        token_hash = excluded.token_hash, 
        token_version = excluded.token_version,
        expires_at = excluded.expires_at,
        created_at = datetime('now')
    `).run(user.id, tokenHash, tokenVersion, expiresAt);

    // The frontend URL
    const baseUrl = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5174';
    const resetLink = `${baseUrl}/reset-password/${user.id}/${resetToken}`;

    const emailSent = await sendPasswordResetEmail(user.email, resetLink, { isSuperAdminInitiated: false });

    if (emailSent || process.env.NODE_ENV === 'test') {
      res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    } else {
      res.status(500).json({ error: 'Failed to send reset email. Please try again later or contact support.' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Reset Password - Verify and Update (Student Recovery)
router.post('/reset-password/:id/:token', sanitizeInput, (req, res) => {
  const { id, token } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'New password is required.' });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(id);

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Hash the token to compare with database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Verify token exists, matches purpose 'user_recovery', token_version, and hasn't expired
    const resetRecord = db.prepare(`
      SELECT id, token_version FROM password_reset_tokens
      WHERE user_id = ? AND token_hash = ? AND purpose = 'user_recovery' AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(id, tokenHash);

    if (!resetRecord || resetRecord.token_version !== (user.token_version || 1)) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Verify JWT structure (additional security layer)
    if (!verifyPasswordResetToken(token)) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    const newPasswordHash = bcrypt.hashSync(password, 12);
    
    // Update password and invalidate all existing sessions and all reset tokens
    const transaction = db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?").run(newPasswordHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(user.id);
    });

    transaction();
    securityEvents.emit('revoke_user', { userId: user.id });

    res.json({ message: 'Password has been successfully reset. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Admin Forgot Password - Request Reset Link (Admin Self-Recovery)
router.post('/admin-forgot-password', authLimiter, sanitizeInput, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND deleted_at IS NULL').get(email);

    if (!user || user.is_active !== 1 || user.archived_at !== null) {
      return res.status(404).json({ error: 'We could not find an active account associated with that email address. Please check for typos or contact administration.' });
    }

    if (user.role !== 'admin' && user.role !== 'instructor') {
       return res.status(403).json({ 
         error: 'This email is associated with a student account. Please use the student recovery panel.',
         role: 'student'
       });
    }

    if (user.password_reset_pending === 1) {
      return res.status(403).json({ 
        error: 'A password reset is currently pending for this administrative account. You must complete the pending reset using your existing link or contact the Super Administrator.', 
        code: 'PASSWORD_RESET_PENDING' 
      });
    }

    if (!user.email_verified_at || user.verified_email !== user.email) {
      return res.status(403).json({ 
        error: 'Your email address is unverified. For security, administrative self-service password recovery requires a verified recovery email. Please contact the Super Administrator.', 
        code: 'EMAIL_UNVERIFIED' 
      });
    }

    // Generate a secure reset token (valid for 15 minutes)
    const resetToken = generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const tokenVersion = user.token_version || 1;

    // Store the token hash in database with purpose 'admin_self_recovery' and token_version
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, expires_at)
      VALUES (?, ?, 'admin_self_recovery', ?, ?)
      ON CONFLICT(user_id, purpose) DO UPDATE SET 
        token_hash = excluded.token_hash, 
        token_version = excluded.token_version,
        expires_at = excluded.expires_at,
        created_at = datetime('now')
    `).run(user.id, tokenHash, tokenVersion, expiresAt);

    // The frontend URL
    const baseUrl = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5174';
    const resetLink = `${baseUrl}/admin/reset-password/${user.id}/${resetToken}`;

    const emailSent = await sendPasswordResetEmail(user.email, resetLink, { isSuperAdminInitiated: false });

    if (emailSent || process.env.NODE_ENV === 'test') {
      res.json({ message: 'A password recovery link has been dispatched to your administrative email address. Please check your inbox.' });
    } else {
      res.status(500).json({ error: 'Failed to send reset email. Please try again later or contact support.' });
    }
  } catch (error) {
    console.error('Admin forgot password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Admin Reset Password - Verify and Update (Admin Self-Recovery)
router.post('/admin-reset-password/:id/:token', sanitizeInput, (req, res) => {
  const { id, token } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'New password is required.' });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);

    if (!user || user.is_active !== 1 || user.archived_at !== null) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    if (user.role !== 'admin' && user.role !== 'instructor') {
      return res.status(403).json({ error: 'Access denied. You do not have administrative privileges.' });
    }

    // Hash the token to compare with database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Verify token exists, purpose 'admin_self_recovery', token_version, and hasn't expired
    const resetRecord = db.prepare(`
      SELECT id, token_version FROM password_reset_tokens
      WHERE user_id = ? AND token_hash = ? AND purpose = 'admin_self_recovery' AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(id, tokenHash);

    if (!resetRecord || resetRecord.token_version !== (user.token_version || 1)) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Verify JWT structure (additional security layer)
    if (!verifyPasswordResetToken(token)) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    const newPasswordHash = bcrypt.hashSync(password, 12);
    
    // Update password and invalidate all existing sessions and all reset tokens
    const transaction = db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, account_version = account_version + 1, updated_at = datetime('now') WHERE id = ?").run(newPasswordHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(user.id);
    });

    transaction();
    securityEvents.emit('revoke_user', { userId: user.id });

    res.json({ message: 'Admin password has been successfully reset. You can now log in.' });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Request Email Verification Challenge (Authenticated Admin)
router.post('/verify-email/request', authenticateToken, sanitizeInput, async (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, is_active, archived_at FROM users WHERE id = ? AND deleted_at IS NULL').get(req.user.id);
    if (!user || user.is_active !== 1 || user.archived_at !== null) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }

    if (!user.email) {
      return res.status(400).json({ error: 'No email address registered for this account.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO email_verification_challenges (user_id, email, token_hash, purpose, expires_at)
      VALUES (?, ?, ?, 'email_verification', ?)
    `).run(user.id, user.email, tokenHash, expiresAt);

    const baseUrl = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5174';
    const verifyLink = `${baseUrl}/verify-email?token=${rawToken}`;

    await sendEmailVerificationChallenge(user.email, verifyLink);

    res.json({ message: 'A verification link has been sent to your email address.' });
  } catch (error) {
    console.error('Verify email request error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Confirm Email Verification Challenge
router.post('/verify-email/confirm', sanitizeInput, (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Verification token is required.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const challenge = db.prepare(`
      SELECT id, user_id, email FROM email_verification_challenges
      WHERE token_hash = ? AND consumed = 0 AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(tokenHash);

    if (!challenge) {
      return res.status(400).json({ error: 'Invalid or expired verification challenge.' });
    }

    const tx = db.transaction(() => {
      db.prepare("UPDATE email_verification_challenges SET consumed = 1, consumed_at = datetime('now') WHERE id = ?").run(challenge.id);
      const updateResult = db.prepare(`
        UPDATE users 
        SET email_verified_at = datetime('now'), verified_email = ? 
        WHERE id = ? AND email = ?
      `).run(challenge.email, challenge.user_id, challenge.email);

      if (updateResult.changes === 0) {
        throw new Error('EMAIL_CHANGED');
      }
    });

    tx();
    res.json({ message: 'Email address verified successfully.' });
  } catch (error) {
    if (error.message === 'EMAIL_CHANGED') {
      return res.status(400).json({ error: 'Email address has changed since challenge was issued.' });
    }
    console.error('Verify email confirm error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /admin/reset-password/complete - Complete Super Admin-initiated password reset
router.post('/admin/reset-password/complete', sanitizeInput, async (req, res) => {
  const { userId, token, password } = req.body;

  if (!userId || !token || !password) {
    return res.status(400).json({ error: 'User ID, token, and new password are required.' });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    });
  }

  try {
    const user = db.prepare('SELECT id, email, role, is_active, archived_at, token_version, account_version, password_reset_pending FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    if (user.archived_at !== null) {
      return res.status(400).json({ error: 'Account is archived. Please contact administration.', code: 'ACCOUNT_ARCHIVED' });
    }

    if (user.role !== 'admin' && user.role !== 'instructor') {
      return res.status(403).json({ error: 'Access denied. You do not have administrative privileges.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const resetRecord = db.prepare(`
      SELECT id, token_version FROM password_reset_tokens
      WHERE user_id = ? AND token_hash = ? AND purpose = 'admin_password_reset' AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(user.id, tokenHash);

    if (!resetRecord || resetRecord.token_version !== (user.token_version || 1)) {
      return res.status(400).json({ error: 'Invalid or expired reset link.' });
    }

    const newPasswordHash = bcrypt.hashSync(password, 12);

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE users 
        SET password_hash = ?, 
            token_version = token_version + 1, 
            account_version = account_version + 1, 
            password_reset_pending = 0, 
            password_reset_requested_at = NULL, 
            password_reset_requested_by = NULL, 
            updated_at = datetime('now') 
        WHERE id = ?
      `).run(newPasswordHash, user.id);

      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = ? AND consumed = 0").run(user.id);

      try {
        recordAuditLog({
          actorId: user.id,
          targetUserId: user.id,
          action: 'admin.password_reset_completed',
          module: 'admin_management',
          resource: `admin:${user.id}`,
          outcome: 'success',
          details: { method: 'super_admin_reset_token' },
          ipAddress: req.ip || '',
          throwOnError: false
        });
      } catch {}
    });

    transaction();
    securityEvents.emit('revoke_user', { userId: user.id });

    if (user.email) {
      try {
        const dhakaTime = formatDhakaTimestamp(new Date());
        await sendPasswordChangeNotificationEmail(user.email, { dhakaTime, ipAddress: req.ip || 'Unknown' });
      } catch (emailErr) {
        console.error('Failed to dispatch password change alert email:', emailErr);
      }
    }

    res.json({ message: 'Administrator password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Admin reset password complete error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


// ==========================================
// UNIVERSAL 2FA ENDPOINTS FOR ALL USERS
// ==========================================

// GET /api/auth/mfa/status - Get MFA status and remaining recovery codes count
router.get('/mfa/status', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT two_factor_enabled, last_totp_timestamp FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const recCount = db.prepare('SELECT COUNT(*) as c FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').get(req.user.id)?.c || 0;

    res.json({
      enabled: Boolean(user.two_factor_enabled),
      recoveryCodesRemaining: recCount,
      lastTotpTimestamp: user.last_totp_timestamp || null
    });
  } catch (err) {
    console.error('Error fetching MFA status:', err);
    res.status(500).json({ error: 'Failed to fetch MFA status' });
  }
});

// POST /api/auth/mfa/setup - Initiate MFA enrollment with password verification
router.post('/mfa/setup', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Current password is required to set up two-factor authentication.', code: 'PASSWORD_REQUIRED' });
    }

    const user = db.prepare('SELECT id, username, email, password_hash, two_factor_enabled FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect password. Verification failed.', code: 'INVALID_PASSWORD' });
    }

    const secret = generateTotpSecret();
    const encryptedSecret = encryptSecret(secret);
    const otpauthUri = generateTotpUri({ secret, username: user.username || user.email, issuer: 'BFI Classroom' });

    // Store in pending_two_factor_secret
    db.prepare(`UPDATE users SET pending_two_factor_secret = ? WHERE id = ?`).run(encryptedSecret, user.id);

    res.json({
      secret,
      otpauthUri
    });
  } catch (err) {
    console.error('Error initiating MFA setup:', err);
    res.status(500).json({ error: 'Failed to initiate MFA setup' });
  }
});

// POST /api/auth/mfa/verify-setup - Confirm enrollment with TOTP code, activate MFA, and issue recovery codes
router.post('/mfa/verify-setup', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required.', code: 'CODE_REQUIRED' });
    }

    const user = db.prepare('SELECT id, pending_two_factor_secret, account_version, token_version FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.pending_two_factor_secret) {
      return res.status(400).json({ error: 'No pending two-factor setup found. Please initiate setup first.', code: 'NO_PENDING_SETUP' });
    }

    const plainSecret = decryptSecret(user.pending_two_factor_secret);
    const verifyResult = verifyTotpCode(plainSecret, code);
    if (!verifyResult.valid) {
      return res.status(400).json({ error: 'Invalid verification code. Please check your authenticator app and try again.', code: 'INVALID_CODE' });
    }

    const recoveryCodes = generateRecoveryCodes(8);

    const activateTx = db.transaction(() => {
      // 1. Activate MFA
      db.prepare(`
        UPDATE users 
        SET two_factor_enabled = 1,
            two_factor_secret = pending_two_factor_secret,
            pending_two_factor_secret = NULL,
            last_totp_timestamp = ?,
            account_version = account_version + 1,
            token_version = token_version + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(verifyResult.step, user.id);

      // 2. Clear existing recovery codes
      db.prepare('DELETE FROM user_mfa_recovery_codes WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(user.id);

      // 3. Store fresh recovery codes
      const insertRec = db.prepare(`
        INSERT INTO user_mfa_recovery_codes (user_id, code_hash, used, created_at)
        VALUES (?, ?, 0, datetime('now'))
      `);
      const insertAdminRec = db.prepare(`
        INSERT INTO admin_mfa_recovery_codes (user_id, code_hash, used, created_at)
        VALUES (?, ?, 0, datetime('now'))
      `);

      for (const rawCode of recoveryCodes) {
        const hash = bcrypt.hashSync(rawCode.trim().toUpperCase(), 10);
        insertRec.run(user.id, hash);
        insertAdminRec.run(user.id, hash);
      }

      // Record audit log
      recordAuditLog({
        actorId: user.id,
        targetUserId: user.id,
        action: 'user_mfa_enabled',
        module: 'auth',
        resource: `user:${user.id}`,
        outcome: 'success',
        details: { recovery_codes_issued: recoveryCodes.length },
        throwOnError: false
      });
    });

    activateTx();

    res.json({
      message: 'Two-factor authentication successfully enabled.',
      recoveryCodes
    });
  } catch (err) {
    console.error('Error verifying MFA setup:', err);
    res.status(500).json({ error: 'Failed to verify MFA setup' });
  }
});

// POST /api/auth/mfa/replace - Generate new secret / re-enroll (Step-up required)
router.post('/mfa/replace', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { code, recoveryCode } = req.body;
    const user = db.prepare('SELECT id, username, email, two_factor_enabled, two_factor_secret, last_totp_timestamp FROM users WHERE id = ?').get(req.user.id);
    if (!user || user.two_factor_enabled !== 1 || !user.two_factor_secret) {
      return res.status(400).json({ error: 'Two-factor authentication is not currently enabled.', code: 'MFA_NOT_ENABLED' });
    }

    // Step-up verification: check TOTP or recovery code
    let verified = false;
    if (code) {
      const plainSecret = decryptSecret(user.two_factor_secret);
      const verifyRes = verifyTotpCode(plainSecret, code, { lastTimestamp: user.last_totp_timestamp || 0 });
      if (verifyRes.valid) verified = true;
    } else if (recoveryCode) {
      const cleanRec = String(recoveryCode).trim().toUpperCase();
      const rows = db.prepare('SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
      for (const row of rows) {
        if (bcrypt.compareSync(cleanRec, row.code_hash)) {
          db.prepare("UPDATE user_mfa_recovery_codes SET used = 1, used_at = datetime('now') WHERE id = ?").run(row.id);
          db.prepare("UPDATE admin_mfa_recovery_codes SET used = 1, used_at = datetime('now') WHERE id = ?").run(row.id);
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      return res.status(401).json({ error: 'Valid authenticator code or unused recovery code required to replace configuration.', code: 'INVALID_FACTOR' });
    }

    const secret = generateTotpSecret();
    const encryptedSecret = encryptSecret(secret);
    const otpauthUri = generateTotpUri({ secret, username: user.username || user.email, issuer: 'BFI Classroom' });

    db.prepare(`UPDATE users SET pending_two_factor_secret = ? WHERE id = ?`).run(encryptedSecret, user.id);

    res.json({
      secret,
      otpauthUri
    });
  } catch (err) {
    console.error('Error replacing MFA secret:', err);
    res.status(500).json({ error: 'Failed to initiate MFA replacement' });
  }
});

// POST /api/auth/mfa/disable - Disable MFA (Step-up required; Super Admins blocked)
router.post('/mfa/disable', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { code, recoveryCode } = req.body;
    const user = db.prepare('SELECT id, username, role, is_super_admin, two_factor_enabled, two_factor_secret, last_totp_timestamp FROM users WHERE id = ?').get(req.user.id);
    if (!user || user.two_factor_enabled !== 1) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled.', code: 'MFA_NOT_ENABLED' });
    }

    // MANDATORY SUPER ADMIN MFA DEFENSE: Super Admins cannot disable MFA!
    if (user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true)) {
      return res.status(403).json({
        error: 'Super Administrators cannot disable two-factor authentication. Universal 2FA is mandatory for privileged accounts.',
        code: 'SUPER_ADMIN_MFA_MANDATORY'
      });
    }

    // Step-up verification
    let verified = false;
    if (code) {
      const plainSecret = decryptSecret(user.two_factor_secret);
      const verifyRes = verifyTotpCode(plainSecret, code, { lastTimestamp: user.last_totp_timestamp || 0 });
      if (verifyRes.valid) verified = true;
    } else if (recoveryCode) {
      const cleanRec = String(recoveryCode).trim().toUpperCase();
      const rows = db.prepare('SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
      for (const row of rows) {
        if (bcrypt.compareSync(cleanRec, row.code_hash)) {
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      return res.status(401).json({ error: 'Valid authenticator code or unused recovery code required to disable two-factor authentication.', code: 'INVALID_FACTOR' });
    }

    const disableTx = db.transaction(() => {
      db.prepare(`
        UPDATE users 
        SET two_factor_enabled = 0,
            two_factor_secret = NULL,
            pending_two_factor_secret = NULL,
            account_version = account_version + 1,
            token_version = token_version + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(user.id);

      db.prepare('DELETE FROM user_mfa_recovery_codes WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(user.id);

      recordAuditLog({
        actorId: user.id,
        targetUserId: user.id,
        action: 'user_mfa_disabled',
        module: 'auth',
        resource: `user:${user.id}`,
        outcome: 'success',
        throwOnError: false
      });
    });

    disableTx();

    res.json({
      message: 'Two-factor authentication has been disabled.'
    });
  } catch (err) {
    console.error('Error disabling MFA:', err);
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

export default router;
