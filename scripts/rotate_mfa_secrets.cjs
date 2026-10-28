/**
 * Safe MFA Authenticator Secret Rotation Utility
 * 
 * Re-encrypts all stored user two-factor secrets from an old encryption key to a new encryption key.
 * Runs atomically inside a database transaction and rolls back if any decryption or re-encryption fails.
 * 
 * Zero Credential Disclosure: NEVER prints keys, decrypted secrets, or tokens.
 * 
 * Usage:
 *   node scripts/rotate_mfa_secrets.cjs --db=path/to/database.db --old-key=<oldKey> --new-key=<newKey>
 * Or with environment variables:
 *   PREVIOUS_JWT_SECRET=<old> JWT_SECRET=<new> node scripts/rotate_mfa_secrets.cjs --db=path/to/database.db
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--db=')) {
      options.db = arg.slice(5);
    } else if (arg.startsWith('--old-key=')) {
      options.oldKey = arg.slice(10);
    } else if (arg.startsWith('--new-key=')) {
      options.newKey = arg.slice(10);
    }
  }
  return options;
}

const opts = parseArgs();
const dbPath = opts.db || process.env.DATABASE_PATH || path.join(__dirname, '../server/bfi_classroom.db');
const oldKeySource = opts.oldKey || process.env.PREVIOUS_MFA_ENCRYPTION_KEY || process.env.PREVIOUS_JWT_SECRET;
const newKeySource = opts.newKey || process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Target database file does not exist: ${dbPath}`);
  process.exit(1);
}

if (!oldKeySource || !newKeySource) {
  console.error('❌ Both old-key and new-key sources are required.');
  console.error('Provide --old-key and --new-key flags or set PREVIOUS_JWT_SECRET and JWT_SECRET in environment.');
  process.exit(1);
}

if (oldKeySource === newKeySource) {
  console.error('❌ Old key and new key are identical. Nothing to rotate.');
  process.exit(1);
}

function deriveKey(secretSource) {
  return crypto.createHash('sha256').update(secretSource).digest();
}

function decrypt(encryptedSecret, key) {
  const parts = encryptedSecret.split(':');
  if (parts.length !== 3) {
    // Plaintext / unencrypted
    return encryptedSecret;
  }
  const [ivHex, authTagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(dataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function encrypt(plainSecret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

const oldKey = deriveKey(oldKeySource);
const newKey = deriveKey(newKeySource);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`=======================================================`);
console.log(`BFI Classroom Safe MFA Secret Rotation Utility`);
console.log(`Target Database: ${dbPath}`);
console.log(`=======================================================`);

try {
  const usersWithMfa = db.prepare('SELECT id, username, two_factor_secret FROM users WHERE two_factor_secret IS NOT NULL').all();
  console.log(`Found ${usersWithMfa.length} accounts with encrypted MFA secrets.`);

  if (usersWithMfa.length === 0) {
    console.log('✅ No MFA secrets to rotate.');
    process.exit(0);
  }

  const rotateTransaction = db.transaction(() => {
    let count = 0;
    for (const u of usersWithMfa) {
      const plaintext = decrypt(u.two_factor_secret, oldKey);
      if (!plaintext) {
        throw new Error(`Failed to decrypt MFA secret for user ID ${u.id} (${u.username}) with provided old key.`);
      }
      const reencrypted = encrypt(plaintext, newKey);
      
      // Verification check: ensure re-encrypted payload decrypts with new key
      const testDecrypt = decrypt(reencrypted, newKey);
      if (testDecrypt !== plaintext) {
        throw new Error(`Integrity verification failed during re-encryption for user ID ${u.id}.`);
      }

      db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(reencrypted, u.id);
      count++;
    }
    return count;
  });

  const updatedCount = rotateTransaction();
  console.log(`✅ Successfully re-encrypted and verified ${updatedCount} MFA secret(s) atomically.`);
  console.log(`Database is now aligned with new key configuration.`);
} catch (err) {
  console.error(`❌ Rotation aborted and rolled back: ${err.message}`);
  process.exit(1);
} finally {
  db.close();
}
