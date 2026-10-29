/**
 * scripts/rotate_mfa_secrets.cjs
 * 
 * Safe MFA Authenticator Secret Rotation & Audit Utility.
 * 
 * Capabilities:
 * 1. Re-encrypts stored user two-factor secrets from a previous encryption key to a new encryption key.
 *    Runs atomically inside a database transaction and rolls back if any decryption or re-encryption fails.
 * 2. Audits database decryptability under the intended final key configuration.
 *    Supports requirePrimaryOnly to verify readiness for safe historical key retirement.
 * 3. Resolves effective active MFA encryption secret source from runtime environment or .env file,
 *    correctly implementing fallback semantics (empty/whitespace values fall back to JWT_SECRET).
 * 
 * Security Controls:
 * - Requires explicit target database path (--db=<path> or --db <path>). Never defaults to production.
 * - Reads keys strictly from environment variables or secure in-memory options.
 *   Never accepts secret keys via command-line arguments.
 * - Rotates both active secrets (two_factor_secret) and pending setup secrets (pending_two_factor_secret).
 * - Verifies every re-encrypted payload round-trip before committing.
 * - Zero Credential Disclosure: NEVER prints keys, decrypted secrets, or tokens.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

function deriveKey(secretSource) {
  if (!secretSource) {
    throw new Error('Cannot derive encryption key from empty or undefined secret source.');
  }
  return crypto.createHash('sha256').update(secretSource).digest();
}

function decrypt(encryptedSecret, key) {
  const parts = String(encryptedSecret || '').split(':');
  if (parts.length !== 3) {
    return encryptedSecret; // Unencrypted fallback (e.g. testing)
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

/**
 * Parses simple KEY=VALUE configuration from a .env file.
 */
function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * Determines the effective active MFA encryption secret source adhering to runtime code semantics:
 * MFA_ENCRYPTION_KEY if set and non-empty (after trim); otherwise fallback to JWT_SECRET.
 * Respects runtime environment precedence and fails closed if neither is non-empty.
 */
function determineActiveMfaSecretSource(envObj = process.env, dotEnvPath = null) {
  let fileConfig = {};
  if (dotEnvPath && fs.existsSync(dotEnvPath)) {
    fileConfig = parseDotEnvFile(dotEnvPath);
  }

  // Precedence: explicit process.env / envObj override if set, otherwise fileConfig
  let mfaVal = '';
  if (envObj && envObj.MFA_ENCRYPTION_KEY !== undefined) {
    mfaVal = String(envObj.MFA_ENCRYPTION_KEY).trim();
  } else if (fileConfig.MFA_ENCRYPTION_KEY !== undefined) {
    mfaVal = String(fileConfig.MFA_ENCRYPTION_KEY).trim();
  }

  if (mfaVal.length > 0) {
    return { sourceName: 'MFA_ENCRYPTION_KEY', value: mfaVal };
  }

  let jwtVal = '';
  if (envObj && envObj.JWT_SECRET !== undefined) {
    jwtVal = String(envObj.JWT_SECRET).trim();
  } else if (fileConfig.JWT_SECRET !== undefined) {
    jwtVal = String(fileConfig.JWT_SECRET).trim();
  }

  if (jwtVal.length > 0) {
    return { sourceName: 'JWT_SECRET', value: jwtVal };
  }

  throw new Error('Unable to determine active MFA encryption source: neither MFA_ENCRYPTION_KEY nor JWT_SECRET is set to a non-empty value.');
}

/**
 * Audits database decryptability under the intended final key configuration.
 */
function auditDecryptability(dbOrPath, options = {}) {
  const db = (typeof dbOrPath === 'string') ? new Database(dbOrPath, { readonly: true }) : dbOrPath;
  const shouldClose = typeof dbOrPath === 'string';

  try {
    const primaryKeySource = options.primaryKeySource || process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;
    const previousKeySource = options.previousKeySource || process.env.PREVIOUS_MFA_ENCRYPTION_KEY || process.env.PREVIOUS_JWT_SECRET;
    const requirePrimaryOnly = Boolean(options.requirePrimaryOnly);

    if (!primaryKeySource || !primaryKeySource.trim()) {
      throw new Error('Audit requires a primaryKeySource (or MFA_ENCRYPTION_KEY / JWT_SECRET in environment).');
    }

    const primaryKey = deriveKey(primaryKeySource.trim());
    const previousKey = (previousKeySource && previousKeySource.trim() && !requirePrimaryOnly)
      ? deriveKey(previousKeySource.trim())
      : null;

    const users = db.prepare(`
      SELECT id, username, two_factor_secret, pending_two_factor_secret 
      FROM users 
      WHERE two_factor_secret IS NOT NULL OR pending_two_factor_secret IS NOT NULL
    `).all();

    let activeVerified = 0;
    let pendingVerified = 0;

    for (const u of users) {
      if (u.two_factor_secret) {
        let decrypted = null;
        try {
          decrypted = decrypt(u.two_factor_secret, primaryKey);
        } catch (e1) {
          if (previousKey) {
            try {
              decrypted = decrypt(u.two_factor_secret, previousKey);
            } catch (e2) {}
          }
        }
        if (!decrypted) {
          throw new Error(`Audit failure: active secret for user ID ${u.id} could not be decrypted under ${requirePrimaryOnly ? 'primary key' : 'primary or fallback key'}.`);
        }
        activeVerified++;
      }

      if (u.pending_two_factor_secret) {
        let rawPending = u.pending_two_factor_secret;
        try {
          const parsed = JSON.parse(rawPending);
          if (parsed && parsed.secret) rawPending = parsed.secret;
        } catch {}

        let decryptedPending = null;
        try {
          decryptedPending = decrypt(rawPending, primaryKey);
        } catch (e1) {
          if (previousKey) {
            try {
              decryptedPending = decrypt(rawPending, previousKey);
            } catch (e2) {}
          }
        }
        if (!decryptedPending) {
          throw new Error(`Audit failure: pending secret for user ID ${u.id} could not be decrypted under ${requirePrimaryOnly ? 'primary key' : 'primary or fallback key'}.`);
        }
        pendingVerified++;
      }
    }

    return {
      auditPassed: true,
      totalAccounts: users.length,
      activeSecretsVerified: activeVerified,
      pendingSecretsVerified: pendingVerified,
      requirePrimaryOnly
    };
  } finally {
    if (shouldClose) {
      try { db.close(); } catch {}
    }
  }
}

/**
 * Executes atomic rotation transaction on target SQLite database.
 */
function executeRotation(options = {}) {
  const dbPath = path.resolve(options.dbPath || options.db);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Target database file does not exist: ${dbPath}`);
  }

  const oldKeySource = (options.oldKeySource || process.env.PREVIOUS_MFA_ENCRYPTION_KEY || process.env.PREVIOUS_JWT_SECRET || '').trim();
  const newKeySource = (options.newKeySource || process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
  const dryRun = Boolean(options.dryRun);

  if (!oldKeySource || !newKeySource) {
    throw new Error('Both previous and new encryption keys are required for rotation.');
  }

  if (oldKeySource === newKeySource) {
    throw new Error('Previous key and new key are identical. Nothing to rotate.');
  }

  const oldKey = deriveKey(oldKeySource);
  const newKey = deriveKey(newKeySource);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    const usersWithMfa = db.prepare(`
      SELECT id, username, two_factor_secret, pending_two_factor_secret 
      FROM users 
      WHERE two_factor_secret IS NOT NULL OR pending_two_factor_secret IS NOT NULL
    `).all();

    if (usersWithMfa.length === 0) {
      return { success: true, activeRotated: 0, pendingRotated: 0, totalAccounts: 0, dryRun };
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
            try {
              const alreadyNew = decrypt(u.two_factor_secret, newKey);
              if (alreadyNew) {
                plaintext = null;
              }
            } catch {
              throw new Error(`Failed to decrypt active MFA secret for user ID ${u.id}. Key mismatch or corrupted data.`);
            }
          }

          if (plaintext) {
            const reencrypted = encrypt(plaintext, newKey);
            if (decrypt(reencrypted, newKey) !== plaintext) {
              throw new Error(`Integrity verification failed for user ID ${u.id} during active secret re-encryption.`);
            }
            if (!dryRun) {
              db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(reencrypted, u.id);
            }
            activeRotated++;
          }
        }

        // 2. Rotate pending secret
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
                pendingPlaintext = null;
              }
            } catch {
              throw new Error(`Failed to decrypt pending MFA secret for user ID ${u.id}.`);
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

            if (!dryRun) {
              db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = ?').run(finalPendingValue, u.id);
            }
            pendingRotated++;
          }
        }
      }

      if (dryRun) {
        throw new Error('DRY_RUN_ROLLBACK');
      }

      return { activeRotated, pendingRotated };
    });

    try {
      const counts = rotateTransaction();
      return {
        success: true,
        activeRotated: counts.activeRotated,
        pendingRotated: counts.pendingRotated,
        totalAccounts: usersWithMfa.length,
        dryRun: false
      };
    } catch (txErr) {
      if (txErr.message === 'DRY_RUN_ROLLBACK') {
        return {
          success: true,
          activeRotated: 0,
          pendingRotated: 0,
          totalAccounts: usersWithMfa.length,
          dryRun: true
        };
      }
      throw txErr;
    }
  } finally {
    db.close();
  }
}

function parseArgs(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--db=')) {
      options.db = arg.slice(5);
    } else if (arg === '--db' && i + 1 < args.length) {
      options.db = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--audit') {
      options.audit = true;
    } else if (arg === '--require-primary-only') {
      options.requirePrimaryOnly = true;
    } else if (arg.startsWith('--old-key=') || arg.startsWith('--new-key=') || arg === '--old-key' || arg === '--new-key') {
      console.error('❌ FATAL SECURITY VIOLATION: Secret keys must NOT be passed via command-line arguments.');
      console.error('Use PREVIOUS_MFA_ENCRYPTION_KEY and MFA_ENCRYPTION_KEY environment variables instead.');
      process.exit(1);
    }
  }
  return options;
}

// CLI Execution Entrypoint
if (require.main === module) {
  const opts = parseArgs();

  if (!opts.db) {
    console.error('❌ FATAL ERROR: An explicit target database must be specified via --db=<path> or --db <path>.');
    console.error('Refusing to guess or default to any database path.');
    process.exit(1);
  }

  const dbPath = path.resolve(opts.db);
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Target database file does not exist: ${dbPath}`);
    process.exit(1);
  }

  if (opts.audit) {
    try {
      const result = auditDecryptability(dbPath, {
        requirePrimaryOnly: opts.requirePrimaryOnly
      });
      console.log(`✅ Decryptability audit PASSED:`);
      console.log(`   Total accounts with MFA: ${result.totalAccounts}`);
      console.log(`   Active secrets verified:  ${result.activeSecretsVerified}`);
      console.log(`   Pending secrets verified: ${result.pendingSecretsVerified}`);
      if (result.requirePrimaryOnly) {
        console.log(`   Primary-only mode: PASSED (Zero accounts depend on previous key. Safe to retire.)`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`❌ Decryptability audit FAILED: ${err.message}`);
      process.exit(1);
    }
  }

  try {
    const result = executeRotation({
      dbPath,
      dryRun: opts.dryRun
    });

    if (result.dryRun) {
      console.log('✅ Dry run completed successfully. All secrets decrypted and verified with zero database mutations.');
      process.exit(0);
    }

    console.log(`✅ Rotation completed successfully!`);
    console.log(`   Active secrets re-encrypted:  ${result.activeRotated}`);
    console.log(`   Pending secrets re-encrypted: ${result.pendingRotated}`);
    console.log(`Database is now aligned with new key configuration.`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Rotation aborted and rolled back: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  deriveKey,
  encrypt,
  decrypt,
  parseDotEnvFile,
  determineActiveMfaSecretSource,
  auditDecryptability,
  executeRotation,
  parseArgs
};
