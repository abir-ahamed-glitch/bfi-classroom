import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db/database.js';
import { authenticateToken, authLimiter, sanitizeInput, sensitiveEndpointLimiter, generatePasswordResetToken, verifyPasswordResetToken, validatePassword } from '../middleware/auth.js';
import { getJwtRefreshSecret, getJwtSecret } from '../config/security.js';
import { sendPasswordResetEmail } from '../utils/email.js';

const router = express.Router();
const REFRESH_COOKIE_NAME = 'bfi_refresh_token';

function buildUserPayload(user) {
  let profile = null;
  if (user.role === 'student') {
    profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
  } else if (user.role === 'instructor' || user.role === 'admin') {
    profile = { full_name: `${user.first_name} ${user.last_name}` };
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
    studentId: profile?.student_id
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: `${user.first_name} ${user.last_name}` },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRY || '365d' }
  );
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
  const refreshToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    getJwtRefreshSecret(),
    { expiresIn: '365d' }
  );
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, hashToken(refreshToken), req.ip, req.get('user-agent') || '', expiresAt);

  setRefreshCookie(req, res, refreshToken);
}

// Login route
router.post('/login', authLimiter, sanitizeInput, (req, res) => {
  const { username, password, type = 'student' } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required' });
  }

  // Universal rule: Admin usernames MUST start with 'admin@'
  // This is enforced at login when type is 'admin' to prevent any bypass.
  if (type === 'admin' && !username.toLowerCase().startsWith('admin@')) {
    return res.status(400).json({ error: 'Admin usernames must start with "admin@". Please enter your full admin username (e.g. admin@yourname).' });
  }

  try {
    const query = `
      SELECT * FROM users 
      WHERE (email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) 
      AND is_active = 1
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

    // Update last login
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    const accessToken = signAccessToken(user);
    issueRefreshToken(req, res, user);

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

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.id);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'User not found' });
    }

    return res.json({
      token: signAccessToken(user),
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
        sp.batch_number,
        sp.student_id
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.id = ?
    `).get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
      studentId: user.student_id
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

    const updated = db.prepare('SELECT id, username, email, role, first_name, last_name, profile_picture, public_key FROM users WHERE id = ?').get(req.user.id);
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
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
    });

    transaction();

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
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
    });

    transaction();

    res.json({ message: 'Admin password has been successfully reset. You can now log in.' });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
