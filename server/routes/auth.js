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
import { sendPasswordResetEmail } from '../utils/email.js';
import { verifyTotpCode, decryptSecret } from '../utils/totp.js';
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

  const isSuper = Number(user.id) === 1 && user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);

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
  const isSuper = Number(user.id) === 1 && user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);
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
  const isSuper = Number(user.id) === 1 && user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);
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
    // with an ephemeral single-use maintenance token matching disk
    const remoteIp = req.socket?.remoteAddress || '';
    const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    const hasProxyHeaders = Boolean(req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip']);
    const reqMaintToken = req.headers['x-bfi-maintenance-token'];

    if (isLoopback && !hasProxyHeaders && typeof reqMaintToken === 'string' && reqMaintToken.length >= 32) {
      try {
        const maintTokenPath = process.env.MAINTENANCE_TOKEN_PATH || path.resolve(__dirname, '..', '.maintenance_auth_token');
        const stateFilePath = process.env.DEPLOYMENT_STATE_PATH || path.resolve(__dirname, '..', 'active_deployment_state.json');

        if (fs.existsSync(maintTokenPath) && fs.existsSync(stateFilePath)) {
          const stat = fs.statSync(maintTokenPath);
          const isFresh = (Date.now() - stat.mtimeMs) < 15 * 60 * 1000;
          const expectedToken = fs.readFileSync(maintTokenPath, 'utf8').trim();
          const deployState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));

          // Invariant: Pre-exposure maintenance window only (traffic must not have been exposed)
          const isUnexposed = deployState.backupValidated === true && deployState.trafficMayReopen !== true && deployState.trafficReopened !== true;
          if (isFresh && isUnexposed && expectedToken.length === reqMaintToken.length) {
            const expectedBuf = Buffer.from(expectedToken);
            const reqBuf = Buffer.from(reqMaintToken);
            if (crypto.timingSafeEqual(expectedBuf, reqBuf)) {
              isTurnstileVerified = true;
            }
          }
        }
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
      AND is_active = 1
      AND deleted_at IS NULL
    `;
      
    const user = db.prepare(query).get(username, username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
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

    if (user.is_active !== 1) {
      return res.status(401).json({ error: 'MFA challenge expired or invalidated. Account inactive or revoked.' });
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
      const rows = db.prepare('SELECT id, code_hash FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(user.id);
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
        const recovRes = db.prepare(`
          UPDATE admin_mfa_recovery_codes 
          SET used = 1, used_at = datetime('now') 
          WHERE id = ? AND user_id = ? AND used = 0
        `).run(matchedRecoveryId, user.id);

        if (recovRes.changes === 0) {
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

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(decoded.id);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'User not found' });
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

    const isSuper = Number(user.id) === 1 && user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true);

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
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, username = ?, email = ? WHERE id = ?')
        .run(first_name.trim(), (last_name || '').trim(), normalizedUsername, normalizedEmail || null, req.user.id);
    } else {
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, username = ? WHERE id = ?')
        .run(first_name.trim(), (last_name || '').trim(), normalizedUsername, req.user.id);
    }

    const updated = db.prepare('SELECT id, username, email, role, first_name, last_name, profile_picture, public_key, is_super_admin FROM users WHERE id = ?').get(req.user.id);
    const isSuper = Number(updated.id) === 1 && updated.role === 'admin' && (updated.is_super_admin === 1 || updated.is_super_admin === true);
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
router.post('/forgot-password', authLimiter, sanitizeInput, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1').get(email);

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

    // Store the token hash in database (never store plain tokens)
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash = ?, expires_at = ?
    `).run(user.id, tokenHash, expiresAt, tokenHash, expiresAt);

    // The frontend URL
    const baseUrl = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5174';
    const resetLink = `${baseUrl}/reset-password/${user.id}/${resetToken}`;

    const emailSent = await sendPasswordResetEmail(user.email, resetLink);

    if (emailSent) {
      res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    } else {
      res.status(500).json({ error: 'Failed to send reset email. Please try again later or contact support.' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Reset Password - Verify and Update
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
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Hash the token to compare with database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Verify token exists and hasn't expired
    const resetRecord = db.prepare(`
      SELECT id FROM password_reset_tokens
      WHERE user_id = ? AND token_hash = ? AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(id, tokenHash);

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Verify JWT structure (additional security layer)
    if (!verifyPasswordResetToken(token)) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Token is valid, hash new password
    const newPasswordHash = bcrypt.hashSync(password, 12);
    
    // Update password and invalidate all existing sessions
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

// Admin Forgot Password - Request Reset Link
router.post('/admin-forgot-password', authLimiter, sanitizeInput, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1').get(email);

    if (!user) {
      return res.status(404).json({ error: 'We could not find an active account associated with that email address. Please check for typos or contact administration.' });
    }

    if (user.role !== 'admin' && user.role !== 'instructor') {
       return res.status(403).json({ 
         error: 'This email is associated with a student account. Please use the student recovery panel.',
         role: 'student'
       });
    }

    // Generate a secure reset token (valid for 15 minutes)
    const resetToken = generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Store the token hash in database (never store plain tokens)
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash = ?, expires_at = ?
    `).run(user.id, tokenHash, expiresAt, tokenHash, expiresAt);

    // The frontend URL
    const baseUrl = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5174';
    const resetLink = `${baseUrl}/admin/reset-password/${user.id}/${resetToken}`;

    const emailSent = await sendPasswordResetEmail(user.email, resetLink);

    if (emailSent) {
      res.json({ message: 'A password recovery link has been dispatched to your administrative email address. Please check your inbox.' });
    } else {
      res.status(500).json({ error: 'Failed to send reset email. Please try again later or contact support.' });
    }
  } catch (error) {
    console.error('Admin forgot password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Admin Reset Password - Verify and Update
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
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    if (user.role !== 'admin' && user.role !== 'instructor') {
      return res.status(403).json({ error: 'Access denied. You do not have administrative privileges.' });
    }

    // Hash the token to compare with database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Verify token exists and hasn't expired
    const resetRecord = db.prepare(`
      SELECT id FROM password_reset_tokens
      WHERE user_id = ? AND token_hash = ? AND datetime(expires_at) > datetime('now')
      LIMIT 1
    `).get(id, tokenHash);

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Verify JWT structure (additional security layer)
    if (!verifyPasswordResetToken(token)) {
      return res.status(400).json({ error: 'Invalid or expired link.' });
    }

    // Token is valid, hash new password
    const newPasswordHash = bcrypt.hashSync(password, 12);
    
    // Update password and invalidate all existing sessions
    const transaction = db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?").run(newPasswordHash, user.id);
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

export default router;
