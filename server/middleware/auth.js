import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { getJwtSecret } from '../config/security.js';
import db from '../db/database.js';
import { recordAuditLog } from '../services/auditLedgerService.js';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Helper to safely extract client IP behind reverse proxies/Cloudflare
export function getClientIp(req) {
  const cfIp = req?.headers?.['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }
  const xForwarded = req?.headers?.['x-forwarded-for'];
  if (xForwarded && typeof xForwarded === 'string' && xForwarded.trim()) {
    return xForwarded.split(',')[0].trim();
  }
  if (typeof req?.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }
  return req?.socket?.remoteAddress || '127.0.0.1';
}

// Safely generate an IP key for express-rate-limit without risking runtime exceptions
export function safeIpKeyGenerator(ip) {
  try {
    if (typeof ip === 'string' && ip.trim()) {
      return ipKeyGenerator(ip.trim());
    }
  } catch {
    // Fallback if IP address format is unexpected or unsupported
  }
  return typeof ip === 'string' && ip.trim() ? ip.trim() : '127.0.0.1';
}

// JWT Authentication Middleware
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    // Token-purpose separation: Only accept completed-login access tokens
    if (decoded.type !== 'access') {
      return res.status(401).json({ 
        error: 'Access token required. Provided token cannot be used for resource access.', 
        code: 'INVALID_TOKEN_PURPOSE' 
      });
    }

    // Resolve current authorization state directly from database
    const user = db.prepare(`
      SELECT id, username, email, role, is_active, deleted_at, archived_at, password_reset_pending, is_super_admin, token_version 
      FROM users 
      WHERE id = ?
    `).get(decoded.id);

    if (!user || user.deleted_at !== null || user.archived_at !== null) {
      return res.status(401).json({ error: 'Account inactive, archived, or not found' });
    }

    if (user.password_reset_pending === 1) {
      return res.status(403).json({ 
        error: 'Password reset pending for this account. You must set a new password before accessing the system.', 
        code: 'PASSWORD_RESET_PENDING' 
      });
    }

    if (user.is_active !== 1) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }

    // Privileged administrators: strictly require valid session and token_version claims
    if (user.role === 'admin') {
      if (!decoded.sessionId || decoded.token_version === undefined) {
        return res.status(401).json({ 
          error: 'Session credentials required for administrator access. Please log in again.', 
          code: 'SESSION_REVOKED' 
        });
      }

      if (decoded.token_version !== (user.token_version || 1)) {
        return res.status(401).json({ 
          error: 'Session revoked or expired. Please log in again.', 
          code: 'SESSION_REVOKED' 
        });
      }

      const session = db.prepare(`
        SELECT id FROM sessions 
        WHERE id = ? AND user_id = ? AND datetime(expires_at) > datetime('now')
      `).get(decoded.sessionId, user.id);

      if (!session) {
        return res.status(401).json({ 
          error: 'Session has been revoked or expired.', 
          code: 'SESSION_REVOKED' 
        });
      }

      try {
        db.prepare("UPDATE sessions SET last_activity = datetime('now') WHERE id = ?").run(session.id);
      } catch {
        // Non-blocking
      }
    } else {
      // Non-admin users (students / instructors)
      if (decoded.token_version !== undefined && decoded.token_version !== (user.token_version || 1)) {
        return res.status(401).json({ 
          error: 'Session revoked or expired. Please log in again.', 
          code: 'SESSION_REVOKED' 
        });
      }

      if (decoded.sessionId) {
        const session = db.prepare(`
          SELECT id FROM sessions 
          WHERE id = ? AND user_id = ? AND datetime(expires_at) > datetime('now')
        `).get(decoded.sessionId, user.id);

        if (!session) {
          return res.status(401).json({ 
            error: 'Session has been revoked or expired.', 
            code: 'SESSION_REVOKED' 
          });
        }

        try {
          db.prepare("UPDATE sessions SET last_activity = datetime('now') WHERE id = ?").run(session.id);
        } catch {
          // Non-blocking
        }
      }
    }

    // Privilege is strictly bound to stable database ID 1, active admin role, and positive flag
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

    req.user = {
      ...decoded,
      sessionId: decoded.sessionId || null,
      token_version: user.token_version || 1,
      role: user.role, // Authoritative role from database
      is_active: user.is_active,
      is_super_admin: isSuper ? 1 : 0,
      isSuperAdmin: Boolean(isSuper),
      permissions
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Super Admin Privileges Helper
export function isSuperAdmin(user) {
  if (!user || !user.id) return false;
  // Privilege is strictly bound to stable database ID 1, admin role, and positive flag
  return Number(user.id) === 1 && user.role === 'admin' && (user.is_super_admin === 1 || user.is_super_admin === true || user.isSuperAdmin === true);
}

// Super Admin Access Control Middleware
export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Re-verify against real-time database state
  const currentUser = db.prepare(`
    SELECT id, role, is_active, deleted_at, is_super_admin 
    FROM users 
    WHERE id = ?
  `).get(req.user.id);

  if (!currentUser || currentUser.is_active !== 1 || currentUser.deleted_at !== null) {
    return res.status(401).json({ error: 'Account inactive or not found' });
  }

  if (Number(currentUser.id) !== 1 || currentUser.role !== 'admin' || !currentUser.is_super_admin) {
    try {
      recordAuditLog({
        actorId: currentUser.id,
        action: 'super_admin_access_denied',
        module: 'security',
        resource: req.originalUrl,
        outcome: 'denied',
        correlationId: req.correlationId,
        details: { attemptedUrl: req.originalUrl, method: req.method },
        ipAddress: getClientIp(req),
        throwOnError: false
      });
    } catch { /* non-blocking audit logging */ }
    return res.status(403).json({ error: 'Access denied: Super Administrator privilege required' });
  }

  next();
}

// Fine-Grained Modular Permission Enforcement Middleware
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    // Super Admin has all permissions unconditionally
    if (isSuperAdmin(req.user)) {
      return next();
    }
    // Only administrators can possess modular admin permissions
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    // Real-time database check guarantees immediate permission revocation/grant effect
    const hasPerm = db.prepare(`
      SELECT 1 FROM admin_permissions 
      WHERE user_id = ? AND permission = ?
    `).get(req.user.id, permission);

    if (!hasPerm) {
      try {
        recordAuditLog({
          actorId: req.user.id,
          action: 'permission_denied',
          module: 'security',
          resource: req.originalUrl,
          outcome: 'denied',
          correlationId: req.correlationId,
          details: { requiredPermission: permission, attemptedUrl: req.originalUrl, method: req.method },
          ipAddress: getClientIp(req),
          throwOnError: false
        });
      } catch { /* non-blocking audit logging */ }
      return res.status(403).json({ 
        error: `Access denied: missing required permission '${permission}'`,

        requiredPermission: permission 
      });
    }
    next();
  };
}

// Any Permission Middleware (passes if user has any of the listed permissions)
export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (isSuperAdmin(req.user)) {
      return next();
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const placeholders = permissions.map(() => '?').join(',');
    const hasPerm = db.prepare(`
      SELECT 1 FROM admin_permissions 
      WHERE user_id = ? AND permission IN (${placeholders})
      LIMIT 1
    `).get(req.user.id, ...permissions);

    if (!hasPerm) {
      return res.status(403).json({ 
        error: `Access denied: missing at least one required permission from [${permissions.join(', ')}]`,
        requiredPermissions: permissions 
      });
    }
    next();
  };
}

// Permission checking utilities for synchronous/conditional checks
export function hasPermission(user, permission) {
  if (!user || user.role !== 'admin') return false;
  if (isSuperAdmin(user)) return true;
  const row = db.prepare('SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission = ?').get(user.id, permission);
  return Boolean(row);
}

export function hasAnyPermission(user, ...permissions) {
  if (!user || user.role !== 'admin') return false;
  if (isSuperAdmin(user)) return true;
  if (permissions.length === 0) return false;
  const placeholders = permissions.map(() => '?').join(',');
  const row = db.prepare(`SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission IN (${placeholders}) LIMIT 1`).get(user.id, ...permissions);
  return Boolean(row);
}


// Role-Based Access Control
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Rate Limiters
export const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 25,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test' || process.env.IS_TEST_SERVER === 'true',
  keyGenerator: (req) => {
    const identifier = String(req.body?.username || '').trim().toLowerCase() || 'anonymous';
    return `${ipKeyGenerator(req.ip)}:${identifier}`;
  },
  message: { error: 'Too many login attempts. Please try again after 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for sensitive endpoints
export const sensitiveEndpointLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Stricter limit
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many requests. Please try again later.' }
});

// Dedicated strict rate limiter for password verification (Sudo mode)
export const sudoAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}_${req.user?.id || 'anon'}`,
  message: { error: 'Too many password verification attempts. Please wait 15 minutes before trying again.' }
});

// Input Sanitization
export function sanitizeInput(req, res, next) {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        // Skip sanitization for base64 images, files, and complex URLs
        if (key === 'profile_picture' || key === 'media_url' || key === 'image_url') continue;
        req.body[key] = purify.sanitize(req.body[key]);
      }
    }
  }
  next();
}

// Request validation helpers
export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export function validatePassword(password) {
  // Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
  const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return re.test(password);
}

// Password reset token generator
export function generatePasswordResetToken() {
  return jwt.sign(
    { type: 'password_reset', nonce: Math.random().toString(36).slice(2) },
    getJwtSecret(),
    { expiresIn: '15m' }
  );
}

export function verifyPasswordResetToken(token) {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded.type !== 'password_reset') return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseSqliteDate(val) {
  if (!val) return null;
  const str = String(val).trim().replace(' ', 'T');
  return new Date(str.endsWith('Z') ? str : str + 'Z');
}

/**
 * Sensitive-Action Verification (Sudo Mode)
 * Requires recent server-verified authentication within 15 minutes bound strictly to the active session.
 */
export function requireRecentAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // 1. Check if client provided X-Sudo-Token header
  const sudoHeader = req.headers['x-sudo-token'];
  if (sudoHeader) {
    try {
      const sudoDecoded = jwt.verify(sudoHeader, getJwtSecret());
      if (
        sudoDecoded &&
        sudoDecoded.type === 'sudo' &&
        sudoDecoded.id === req.user.id &&
        (!req.user.sessionId || sudoDecoded.sessionId === req.user.sessionId) &&
        sudoDecoded.token_version === (req.user.token_version || 1)
      ) {
        return next();
      }
    } catch {
      // Expired or invalid sudo token, continue to other checks
    }
  }

  // 2. Check if client provided inline sudo password
  const inlinePassword = req.headers['x-sudo-password'] || req.body?.sudo_password;
  if (inlinePassword) {
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (u && bcrypt.compareSync(inlinePassword, u.password_hash)) {
      if (req.user.sessionId) {
        try {
          db.prepare("UPDATE sessions SET sudo_verified_at = datetime('now') WHERE id = ?").run(req.user.sessionId);
        } catch {
          // Non-blocking
        }
      }
      return next();
    }
  }

  // 3. Check if current active session has recent sudo_verified_at (within 15 minutes)
  if (req.user.sessionId) {
    const session = db.prepare(`
      SELECT sudo_verified_at FROM sessions WHERE id = ? AND user_id = ?
    `).get(req.user.sessionId, req.user.id);

    const verifiedDate = parseSqliteDate(session?.sudo_verified_at);
    if (verifiedDate) {
      const verifiedTime = verifiedDate.getTime();
      const fifteenMinutes = 15 * 60 * 1000;
      if (Date.now() - verifiedTime <= fifteenMinutes) {
        return next();
      }
    }
  }

  // NOTE: Account-wide last_login fallback has been REMOVED per security requirements.
  // Sensitive action verification is strictly bound to the active session.

  return res.status(428).json({
    error: 'Recent password verification required to perform this sensitive action.',
    code: 'SUDO_REQUIRED',
    requireSudo: true
  });
}
