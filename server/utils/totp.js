import crypto from 'crypto';
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib';
import { getJwtSecret } from '../config/security.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a Buffer to an RFC 4648 Base32 string (unpadded).
 */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
export function base32Decode(str) {
  const cleaned = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${cleaned[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates an RFC 6238 Base32 secret using the maintained otplib library.
 */
export function generateTotpSecret() {
  return generateSecret();
}

/**
 * Builds an otpauth:// URI for authenticator applications.
 */
export function generateTotpUri({ secret, username, issuer = 'BFI Classroom' }) {
  return generateURI({ secret, label: username, issuer });
}

/**
 * Derives a 32-byte AES key from a secret string.
 * Uses dedicated MFA_ENCRYPTION_KEY if provided, falling back to JWT_SECRET.
 */
function getEncryptionKey(overrideKey) {
  const secretSource = overrideKey || process.env.MFA_ENCRYPTION_KEY || getJwtSecret();
  return crypto.createHash('sha256').update(secretSource).digest();
}

/**
 * Returns previous encryption key if configured during key rotation.
 */
function getPreviousEncryptionKey() {
  const prevSource = process.env.PREVIOUS_MFA_ENCRYPTION_KEY || process.env.PREVIOUS_JWT_SECRET;
  if (!prevSource) return null;
  return crypto.createHash('sha256').update(prevSource).digest();
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 */
export function encryptSecret(plainSecret, keyOverride) {
  if (!plainSecret) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(keyOverride), iv);
  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted secret.
 * Supports seamless key transition: if decryption with the primary key fails,
 * attempts fallback with the configured previous key.
 */
export function decryptSecret(encryptedSecret, keyOverride) {
  if (!encryptedSecret) return null;
  const parts = encryptedSecret.split(':');
  if (parts.length !== 3) {
    // Plaintext fallback (e.g. testing)
    return encryptedSecret;
  }
  const [ivHex, authTagHex, dataHex] = parts;

  // 1. Attempt decryption with primary key
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(keyOverride), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(dataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (primaryErr) {
    // 2. If primary fails and no override was specified, attempt fallback with previous key
    if (!keyOverride) {
      const prevKey = getPreviousEncryptionKey();
      if (prevKey) {
        try {
          const decipherFallback = crypto.createDecipheriv('aes-256-gcm', prevKey, Buffer.from(ivHex, 'hex'));
          decipherFallback.setAuthTag(Buffer.from(authTagHex, 'hex'));
          let decryptedFallback = decipherFallback.update(dataHex, 'hex', 'utf8');
          decryptedFallback += decipherFallback.final('utf8');
          return decryptedFallback;
        } catch (_fallbackErr) {
          // Ignore fallback decryption failure and throw unified error below
        }
      }
    }
    throw new Error('Failed to decrypt authenticator secret: authentication tag mismatch or invalid encryption key');
  }
}

/**
 * Re-encrypts an encrypted secret from old key to new key.
 */
export function reencryptSecret(encryptedSecret, oldKeySource, newKeySource) {
  const plain = decryptSecret(encryptedSecret, oldKeySource);
  return encryptSecret(plain, newKeySource);
}

/**
 * Generates a 6-digit TOTP code for a given timestamp adhering to RFC 6238 via otplib.
 */
export function generateTotpCode(secretBase32, timeMs = Date.now()) {
  const epoch = Math.floor(timeMs / 1000);
  return generateSync({ secret: secretBase32, epoch });
}

/**
 * Verifies a TOTP code against a secret within a drift window (default +/- 1 step).
 * Enforces replay attack protection by ensuring step > lastTimestamp.
 */
export function verifyTotpCode(secretBase32, code, options = {}) {
  const {
    window = 1,
    timeMs = Date.now(),
    digits = 6,
    lastTimestamp = 0
  } = options;

  const trimmed = String(code || '').trim();
  if (trimmed.length !== digits || !/^\d+$/.test(trimmed)) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }

  const epoch = Math.floor(timeMs / 1000);
  const epochTolerance = Math.max(35, (typeof window === 'number' ? window * 30 : 35));

  let result;
  try {
    result = verifySync({
      token: trimmed,
      secret: secretBase32,
      epoch,
      epochTolerance,
      digits
    });
  } catch {
    return { valid: false, reason: 'VERIFICATION_ERROR' };
  }

  if (!result || !result.valid) {
    return { valid: false, reason: 'CODE_MISMATCH' };
  }

  const step = result.timeStep;
  if (lastTimestamp && step <= lastTimestamp) {
    return { valid: false, reason: 'REPLAY_DETECTED' };
  }

  return { valid: true, step };
}

/**
 * Generates an array of secure single-use recovery codes (formatted e.g. "A1B2C-D3E4F").
 */
export function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const p1 = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
    const p2 = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
    codes.push(`${p1}-${p2}`);
  }
  return codes;
}
