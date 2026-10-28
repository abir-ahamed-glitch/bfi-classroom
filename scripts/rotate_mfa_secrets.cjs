/**
 * Safe MFA Authenticator Secret Rotation Utility
 * 
 * Re-encrypts all stored user two-factor secrets from a previous encryption key to a new encryption key.
 * Runs atomically inside a database transaction and rolls back if any decryption or re-encryption fails.
 * 
 * Security Controls:
 * - Requires explicit target database path (--db=<path>). Never defaults to production database.
 * - Reads keys ONLY from environment variables (PREVIOUS_MFA_ENCRYPTION_KEY / MFA_ENCRYPTION_KEY or PREVIOUS_JWT_SECRET / JWT_SECRET).
 *   Never accepts secret keys via command-line arguments.
 * - Rotates both active secrets (two_factor_secret) and pending setup secrets (pending_two_factor_secret).
 * - Verifies every re-encrypted payload before committing.
 * - Zero Credential Disclosure: NEVER prints keys, decrypted secrets, or tokens.
 * 
 * Usage:
 *   PREVIOUS_MFA_ENCRYPTION_KEY=<old> MFA_ENCRYPTION_KEY=<new> node scripts/rotate_mfa_secrets.cjs --db=path/to/test.db
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
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--old-key=') || arg.startsWith('--new-key=')) {
      console.error('❌ FATAL SECURITY VIOLATION: Secret keys must NOT be passed via command-line arguments.');
      console.error('Use PREVIOUS_MFA_ENCRYPTION_KEY and MFA_ENCRYPTION_KEY environment variables instead.');
      process.exit(1);
    }
  }
  return options;
}

const opts = parseArgs();

if (!opts.db) {
  console.error('❌ FATAL ERROR: An explicit target database must be specified via --db=<path>.');
  console.error('Refusing to guess or default to any database path.');
  process.exit(1);
}

const dbPath = path.resolve(opts.db);
if (!fs.existsSync(dbPath)) {
  console.error(`❌ Target database file does not exist: ${dbPath}`);
  process.exit(1);
}

// Read secrets strictly from environment variables
const oldKeySource = process.env.PREVIOUS_MFA_ENCRYPTION_KEY || process.env.PREVIOUS_JWT_SECRET;
const newKeySource = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;

if (!oldKeySource || !newKeySource) {
  console.error('❌ Both previous and new encryption keys are required.');
  console.error('Set PREVIOUS_MFA_ENCRYPTION_KEY (or PREVIOUS_JWT_SECRET) and MFA_ENCRYPTION_KEY (or JWT_SECRET) in environment.');
  process.exit(1);
}

if (oldKeySource === newKeySource) {
  console.error('❌ Previous key and new key are identical. Nothing to rotate.');
  process.exit(1);
}

function deriveKey(secretSource) {
  return crypto.createHash('sha256').update(secretSource).digest();
}

function decrypt(encryptedSecret, key) {
  const parts = String(encryptedSecret).split(':');
  if (parts.length !== 3) {
    return encryptedSecret; // Unencrypted fallback
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
console.log(`BFI Classroom Hardened MFA Secret Rotation Utility`);
console.log(`Target Database: ${dbPath}`);
console.log(`Dry Run Mode:    ${opts.dryRun ? 'YES (No changes will be written)' : 'NO'}`);
console.log(`=======================================================`);

try {
  const usersWithMfa = db.prepare(`
    SELECT id, username, two_factor_secret, pending_two_factor_secret 
    FROM users 
    WHERE two_factor_secret IS NOT NULL OR pending_two_factor_secret IS NOT NULL
  `).all();

  console.log(`Found ${usersWithMfa.length} account(s) with active or pending MFA secrets.`);

  if (usersWithMfa.length === 0) {
    console.log('✅ No MFA secrets found to rotate.');
    process.exit(0);
  }

  const rotateTransaction = db.transaction(() => {
    let activeRotated = 0;
    let pendingRotated = 0;

    for (const u of usersWithMfa) {
      // 1. Rotate active secret
      if (u.two_factor_secret) {
        let plaintext;
        try {
          plaintext = decrypt(u.two_factor_secret, oldKey);
        } catch (e) {
          // Check if already encrypted with new key (mixed-key state)
          try {
            const alreadyNew = decrypt(u.two_factor_secret, newKey);
            if (alreadyNew) {
              console.log(`[User ${u.id}] Active secret already encrypted with new key; skipping.`);
              plaintext = null;
            }
          } catch {
            throw new Error(`Failed to decrypt active MFA secret for user ID ${u.id} (${u.username}). Key mismatch or corrupted data.`);
          }
        }

        if (plaintext) {
          const reencrypted = encrypt(plaintext, newKey);
          // Verify round-trip integrity
          if (decrypt(reencrypted, newKey) !== plaintext) {
            throw new Error(`Integrity verification failed for user ID ${u.id} during active secret re-encryption.`);
          }
          if (!opts.dryRun) {
            db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(reencrypted, u.id);
          }
          activeRotated++;
        }
      }

      // 2. Rotate pending setup secret (handles both raw string and JSON envelope)
      if (u.pending_two_factor_secret) {
        let pendingRaw = u.pending_two_factor_secret;
        let isJson = false;
        let parsedEnvelope = null;

        try {
          parsedEnvelope = JSON.parse(pendingRaw);
          if (parsedEnvelope && parsedEnvelope.secret) {
            isJson = true;
            pendingRaw = parsedEnvelope.secret;
          }
        } catch {
          isJson = false;
        }

        let pendingPlaintext;
        try {
          pendingPlaintext = decrypt(pendingRaw, oldKey);
        } catch (e) {
          try {
            const alreadyNew = decrypt(pendingRaw, newKey);
            if (alreadyNew) {
              console.log(`[User ${u.id}] Pending secret already encrypted with new key; skipping.`);
              pendingPlaintext = null;
            }
          } catch {
            throw new Error(`Failed to decrypt pending MFA secret for user ID ${u.id} (${u.username}).`);
          }
        }

        if (pendingPlaintext) {
          const reencryptedPending = encrypt(pendingPlaintext, newKey);
          if (decrypt(reencryptedPending, newKey) !== pendingPlaintext) {
            throw new Error(`Integrity verification failed for user ID ${u.id} during pending secret re-encryption.`);
          }

          let finalPendingValue = reencryptedPending;
          if (isJson && parsedEnvelope) {
            parsedEnvelope.secret = reencryptedPending;
            finalPendingValue = JSON.stringify(parsedEnvelope);
          }

          if (!opts.dryRun) {
            db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = ?').run(finalPendingValue, u.id);
          }
          pendingRotated++;
        }
      }
    }

    if (opts.dryRun) {
      throw new Error('DRY_RUN_ROLLBACK');
    }

    return { activeRotated, pendingRotated };
  });

  try {
    const counts = rotateTransaction();
    console.log(`✅ Rotation completed successfully!`);
    console.log(`   Active secrets re-encrypted:  ${counts.activeRotated}`);
    console.log(`   Pending secrets re-encrypted: ${counts.pendingRotated}`);
    console.log(`Database is now aligned with new key configuration.`);
  } catch (txErr) {
    if (txErr.message === 'DRY_RUN_ROLLBACK') {
      console.log('✅ Dry run completed successfully. All secrets decrypted and verified with zero database mutations.');
      process.exit(0);
    }
    throw txErr;
  }
} catch (err) {
  console.error(`❌ Rotation aborted and rolled back: ${err.message}`);
  process.exit(1);
} finally {
  db.close();
}
