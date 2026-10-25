import db from '../db/database.js';
import crypto from 'crypto';

/**
 * Normalizes and checks if a key name represents a sensitive credential or secret.
 * Consistently handles camelCase, PascalCase, snake_case, kebab-case, and dot notation.
 */
export function isSensitiveKey(key) {
  if (!key || typeof key !== 'string') return false;

  // Convert camelCase / PascalCase to snake_case
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  // Strip all non-alphanumeric characters for root matching
  const stripped = snake.replace(/[^a-z0-9]/g, '');

  const sensitiveRoots = [
    'password', 'passwd', 'pwd', 'passphrase',
    'secret', 'token', 'hash', 'totp', 'mfa', 'recovery',
    'salt', 'creditcard', 'cardnumber', 'cvv', 'cvc',
    'authorization', 'auth', 'cookie', 'jwt',
    'credential', 'privatekey', 'apikey', 'bearer',
    'ssn', 'pin', 'signature'
  ];

  for (const root of sensitiveRoots) {
    if (stripped.includes(root)) return true;
  }

  const sensitiveRegex = /(password|passwd|pwd|passphrase|secret|token|hash|totp|recovery|salt|credit_?card|auth|cookie|jwt|credential|private_?key|api_?key|bearer|cvv|ssn)/i;
  return sensitiveRegex.test(snake);
}

// Regex patterns to detect and redact sensitive values embedded in strings
const SENSITIVE_KV_REGEX = /(?:["']?(?:password|passwd|pwd|passphrase|secret|token|hash|totp|recovery(?:[_-]?code)?|auth(?:orization)?|bearer|api[_-]?key|cookie|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)["']?([^"'&\s,;]+)["']?/gi;
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9_.\-=+]{8,}/gi;
const STANDALONE_JWT_REGEX = /\beyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]*\b/g;
const PROSE_PASSWORD_REGEX = /\b(password|secret|token|recovery[ _]code|totp[ _]secret)\s+(?:is|was|=)\s+([^\s,;]+)/gi;

/**
 * Sanitizes string values to ensure embedded JSON, key-values, Bearer headers,
 * or standalone JWTs are redacted without relying on test-specific sentinels.
 */
export function sanitizeStringPayload(str) {
  if (typeof str !== 'string') return str;
  if (!str.trim()) return str;

  const trimmed = str.trim();
  // 1. If string is valid JSON (object or array), parse, redact recursively, and re-serialize
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const redacted = redactSensitiveData(parsed);
      return JSON.stringify(redacted);
    } catch {
      // Continue with string sanitization
    }
  }

  // 2. Redact key-value assignments (e.g. password=xyz, "apiKey":"xyz")
  let sanitized = str.replace(SENSITIVE_KV_REGEX, (match) => {
    const separatorIdx = match.search(/[:=]/);
    if (separatorIdx !== -1) {
      const prefix = match.substring(0, separatorIdx + 1);
      return `${prefix}"[REDACTED]"`;
    }
    return '[REDACTED]';
  });

  // 3. Redact Bearer tokens
  sanitized = sanitized.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]');

  // 4. Redact standalone JWT tokens
  sanitized = sanitized.replace(STANDALONE_JWT_REGEX, '[REDACTED_JWT]');

  // 5. Redact prose statements (e.g. "password is mySecret")
  sanitized = sanitized.replace(PROSE_PASSWORD_REGEX, '$1 is [REDACTED]');

  return sanitized;
}

/**
 * Recursively redacts sensitive keys and values from any object, array, or error.
 * Normalizes key names across all casing styles.
 */
export function redactSensitiveData(data) {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return sanitizeStringPayload(data);
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: sanitizeStringPayload(data.message),
      code: data.code || null
    };
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  if (typeof data !== 'object') {
    return data;
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = redactSensitiveData(value);
    } else if (typeof value === 'string') {
      clean[key] = sanitizeStringPayload(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Allowlist filter helper: extracts only designated safe fields from a state snapshot.
 */
export function filterStateAllowlist(state, allowedFields = []) {
  if (!state || typeof state !== 'object') return null;
  const filtered = {};
  for (const field of allowedFields) {
    if (field in state) {
      filtered[field] = state[field];
    }
  }
  return redactSensitiveData(filtered);
}

/**
 * Validates and serializes state snapshots. Rejects unsupported payloads.
 */
function validateAndRedactPayload(val, fieldName) {
  if (val === null || val === undefined) return null;

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactSensitiveData(parsed));
      } catch {
        throw new TypeError(`Audit payload rejected: ${fieldName} string must be valid JSON object or array.`);
      }
    }
    throw new TypeError(`Audit payload rejected: unstructured free-text ${fieldName} is not permitted. Provide a validated, structured object or JSON string.`);
  }

  if (typeof val !== 'object') {
    throw new TypeError(`Audit payload rejected: ${fieldName} must be a structured object or array, received ${typeof val}.`);
  }

  return JSON.stringify(redactSensitiveData(val));
}

/**
 * Formats a UTC or SQLite date string into Asia/Dhaka format:
 * 'DD MMM YYYY, hh:mm A BST' (e.g. '25 Oct 2026, 02:45 PM BST')
 */
export function formatDhakaTimestamp(dateInput) {
  if (!dateInput) return '';
  let dt;
  if (dateInput instanceof Date) {
    dt = dateInput;
  } else if (typeof dateInput === 'string') {
    let s = dateInput.trim();
    if (!s.includes('T') && s.includes(' ')) {
      s = s.replace(' ', 'T') + 'Z';
    } else if (!s.endsWith('Z') && !s.includes('+')) {
      s = s + 'Z';
    }
    dt = new Date(s);
  } else if (typeof dateInput === 'number') {
    dt = new Date(dateInput);
  }
  if (!dt || isNaN(dt.getTime())) return String(dateInput);

  const opts = {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(dt);
  const p = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod || '').toUpperCase()} BST`;
}

/**
 * Core audit logging function. Inserts structured operational event into admin_audit_logs.
 * Enforces structured allowlisted payloads and rejects arbitrary free text.
 * 
 * By default (throwOnError = true), persistence failures throw to allow atomic rollback
 * of enclosing business transactions. For non-blocking security denial logging, callers
 * pass throwOnError = false.
 */
export function recordAuditLog({
  actorId = null,
  targetUserId = null,
  action,
  module = 'admin_management',
  resource = null,
  outcome = 'success',
  correlationId = null,
  details = null,
  ipAddress = null,
  beforeState = null,
  afterState = null,
  dbInstance = db,
  throwOnError = true
}) {
  try {
    const safeBefore = validateAndRedactPayload(beforeState, 'beforeState');
    const safeAfter = validateAndRedactPayload(afterState, 'afterState');
    const safeDetails = validateAndRedactPayload(details, 'details');

    const corrId = correlationId || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

    const stmt = dbInstance.prepare(`
      INSERT INTO admin_audit_logs (
        actor_id, target_user_id, action, module, resource, outcome,
        correlation_id, details, ip_address, before_state, after_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      actorId || null,
      targetUserId || null,
      action,
      module || 'admin_management',
      resource || null,
      outcome || 'success',
      corrId,
      safeDetails,
      ipAddress || null,
      safeBefore,
      safeAfter
    );

    return { id: result.lastInsertRowid, correlationId: corrId };
  } catch (err) {
    console.error(`[AUDIT LEDGER ERROR] Failed to record audit log for action "${action}":`, err.message);
    if (throwOnError) {
      throw new Error(`Audit ledger persistence failure: ${err.message}`);
    }
    return null;
  }
}

/**
 * Express request helper for business mutations: extracts actor, IP, correlation ID,
 * and delegates to recordAuditLog with throwOnError = true by default.
 */
export function recordAuditEventFromReq(req, {
  action,
  module = 'admin_management',
  resource = null,
  outcome = 'success',
  targetUserId = null,
  correlationId = null,
  details = null,
  beforeState = null,
  afterState = null,
  dbInstance = db,
  throwOnError = true
}) {
  const actorId = req.user ? req.user.id : null;
  const ipAddress = req.ip || (req.socket && req.socket.remoteAddress) || null;
  const corrId = correlationId || req.correlationId || req.headers?.['x-correlation-id'] || null;

  // Include snapshot of actor identity in details to preserve historical attribution
  let enrichedDetails = details;
  if (req.user && typeof details === 'object' && details !== null) {
    enrichedDetails = {
      ...details,
      _actor: {
        id: req.user.id,
        username: req.user.username || null,
        role: req.user.role || null
      }
    };
  }

  return recordAuditLog({
    actorId,
    targetUserId,
    action,
    module,
    resource,
    outcome,
    correlationId: corrId,
    details: enrichedDetails,
    ipAddress,
    beforeState,
    afterState,
    dbInstance,
    throwOnError
  });
}

/**
 * Non-blocking helper for security denials and failed authentication attempts.
 * Guaranteed never to throw, never to mask a 403/401 response, and never to crash middleware.
 */
export function recordSecurityDenial(req, {
  action = 'access_denied',
  module = 'security',
  resource = null,
  reason = 'Unauthorized access attempt',
  targetUserId = null,
  details = null,
  dbInstance = db
}) {
  return recordAuditEventFromReq(req, {
    action,
    module,
    resource,
    outcome: 'denied',
    targetUserId,
    details: { reason, ...(typeof details === 'object' && details !== null ? details : { message: String(details || '') }) },
    dbInstance,
    throwOnError: false
  });
}
