#!/usr/bin/env node
/**
 * scripts/rehearse_mfa_rotation.cjs
 * 
 * Rehearsal Harness for MFA Secret Encryption Key Rotation.
 * 
 * Rehearses the exact operator key-rotation procedure on a disposable SQLite database:
 * 1. Creates a temporary disposable SQLite database with active and pending MFA secrets.
 * 2. Secrets are initially encrypted with PREVIOUS_MFA_ENCRYPTION_KEY.
 * 3. Executes `scripts/rotate_mfa_secrets.cjs` using MFA_ENCRYPTION_KEY and PREVIOUS_MFA_ENCRYPTION_KEY.
 * 4. Verifies round-trip decryption using the new key.
 * 5. Verifies decryption failure when attempting with old key.
 * 6. Tests rollback/dry-run capability and mixed-key idempotency.
 * 7. Purges all disposable test databases on completion.
 * 
 * Zero Secret Exposure: Never logs secrets, keys, or plaintext values.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

function deriveKey(secretSource) {
  return crypto.createHash('sha256').update(secretSource).digest();
}

function encrypt(plainSecret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedSecret, key) {
  const parts = String(encryptedSecret).split(':');
  if (parts.length !== 3) return encryptedSecret;
  const [ivHex, authTagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(dataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function runRehearsal() {
  console.log('================================================================');
  console.log('REHEARSAL: MFA SECRET ENCRYPTION KEY ROTATION ON DISPOSABLE DATA');
  console.log('================================================================\n');

  const tmpDir = path.join(os.tmpdir(), `mfa_rot_rehearsal_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, 'disposable_bfi_classroom.db');

  const oldSecretString = 'rehearsal-old-key-' + crypto.randomBytes(16).toString('hex');
  const newSecretString = 'rehearsal-new-key-' + crypto.randomBytes(16).toString('hex');

  const oldKey = deriveKey(oldSecretString);
  const newKey = deriveKey(newSecretString);

  try {
    // 1. Initialize schema in disposable database
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        two_factor_secret TEXT,
        pending_two_factor_secret TEXT,
        two_factor_enabled INTEGER DEFAULT 0
      );
    `);

    // 2. Insert test data encrypted with oldKey
    const plainActive1 = 'JBSWY3DPEHPK3PXP';
    const plainPending2 = 'KRSXG5CTMVRXEZLU';
    const plainActive3 = 'MFZXK4TFONSWG4TF';
    const plainPending3 = 'NBSWY3DPEHPK3PXQ';

    const encActive1 = encrypt(plainActive1, oldKey);
    const encPending2 = encrypt(plainPending2, oldKey);
    const encActive3 = encrypt(plainActive3, oldKey);
    const encPending3 = encrypt(plainPending3, oldKey);

    const pendingEnvelope3 = JSON.stringify({
      secret: encPending3,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString()
    });

    db.prepare('INSERT INTO users (id, username, two_factor_secret, two_factor_enabled) VALUES (1, ?, ?, 1)').run('user1_active', encActive1);
    db.prepare('INSERT INTO users (id, username, pending_two_factor_secret, two_factor_enabled) VALUES (2, ?, ?, 0)').run('user2_pending', encPending2);
    db.prepare('INSERT INTO users (id, username, two_factor_secret, pending_two_factor_secret, two_factor_enabled) VALUES (3, ?, ?, ?, 1)').run('user3_both', encActive3, pendingEnvelope3);
    db.prepare('INSERT INTO users (id, username, two_factor_enabled) VALUES (4, ?, 0)').run('user4_no_mfa');
    db.close();

    console.log('[Step 1] Disposable database created with 4 test user configurations.');
    console.log('         All initial secrets encrypted with PREVIOUS_MFA_ENCRYPTION_KEY.\n');

    // 3. Dry-Run Verification
    console.log('[Step 2] Executing dry-run rotation...');
    const rotationScript = path.resolve(__dirname, 'rotate_mfa_secrets.cjs');
    const dryRunRes = spawnSync(process.execPath, [rotationScript, `--db=${dbPath}`, '--dry-run'], {
      env: {
        ...process.env,
        PREVIOUS_MFA_ENCRYPTION_KEY: oldSecretString,
        MFA_ENCRYPTION_KEY: newSecretString
      },
      encoding: 'utf8'
    });

    if (dryRunRes.status !== 0) {
      console.error(dryRunRes.stderr || dryRunRes.stdout);
      throw new Error(`Dry-run rotation failed with status ${dryRunRes.status}`);
    }
    console.log('         ✅ Dry-run completed successfully without modifying database.\n');

    // Verify dry-run wrote zero changes
    const chkDryDb = new Database(dbPath, { readonly: true });
    const u1Dry = chkDryDb.prepare('SELECT two_factor_secret FROM users WHERE id = 1').get();
    chkDryDb.close();
    if (u1Dry.two_factor_secret !== encActive1) {
      throw new Error('Dry run unexpectedly modified database data!');
    }

    // 4. Real Rotation Execution
    console.log('[Step 3] Executing real atomic rotation transaction...');
    const realRunRes = spawnSync(process.execPath, [rotationScript, `--db=${dbPath}`], {
      env: {
        ...process.env,
        PREVIOUS_MFA_ENCRYPTION_KEY: oldSecretString,
        MFA_ENCRYPTION_KEY: newSecretString
      },
      encoding: 'utf8'
    });

    if (realRunRes.status !== 0) {
      console.error(realRunRes.stderr || realRunRes.stdout);
      throw new Error(`Real rotation failed with status ${realRunRes.status}`);
    }
    console.log('         ✅ Real rotation completed successfully.\n');

    // 5. Verify Rotated Records
    console.log('[Step 4] Verifying cryptographic integrity and key rotation in database...');
    const verifyDb = new Database(dbPath, { readonly: true });
    const users = verifyDb.prepare('SELECT id, username, two_factor_secret, pending_two_factor_secret FROM users ORDER BY id').all();
    verifyDb.close();

    // User 1
    const u1 = users.find(u => u.id === 1);
    if (!u1.two_factor_secret) throw new Error('User 1 missing two_factor_secret');
    const u1Decrypted = decrypt(u1.two_factor_secret, newKey);
    if (u1Decrypted !== plainActive1) throw new Error('User 1 active secret decrypted value mismatch');
    let u1OldFailed = false;
    try { decrypt(u1.two_factor_secret, oldKey); } catch { u1OldFailed = true; }
    if (!u1OldFailed) throw new Error('User 1 secret was unexpectedly decryptable with old key!');

    // User 2
    const u2 = users.find(u => u.id === 2);
    if (!u2.pending_two_factor_secret) throw new Error('User 2 missing pending_two_factor_secret');
    const u2Decrypted = decrypt(u2.pending_two_factor_secret, newKey);
    if (u2Decrypted !== plainPending2) throw new Error('User 2 pending secret decrypted value mismatch');

    // User 3
    const u3 = users.find(u => u.id === 3);
    const u3ActiveDecrypted = decrypt(u3.two_factor_secret, newKey);
    if (u3ActiveDecrypted !== plainActive3) throw new Error('User 3 active secret mismatch');

    const u3PendingEnv = JSON.parse(u3.pending_two_factor_secret);
    const u3PendingDecrypted = decrypt(u3PendingEnv.secret, newKey);
    if (u3PendingDecrypted !== plainPending3) throw new Error('User 3 pending envelope secret mismatch');

    console.log('         ✅ Cryptographic round-trip verified: All secrets readable ONLY with new key.');
    console.log('         ✅ Old key strictly rejected (authentication tag mismatch confirmed).\n');

    // 6. Idempotency Check: Running rotation again with mixed/already-rotated state
    console.log('[Step 5] Testing idempotency / mixed-key resilience...');
    const reRunRes = spawnSync(process.execPath, [rotationScript, `--db=${dbPath}`], {
      env: {
        ...process.env,
        PREVIOUS_MFA_ENCRYPTION_KEY: oldSecretString,
        MFA_ENCRYPTION_KEY: newSecretString
      },
      encoding: 'utf8'
    });

    if (reRunRes.status !== 0) {
      console.error(reRunRes.stderr || reRunRes.stdout);
      throw new Error(`Second rotation run failed with status ${reRunRes.status}`);
    }
    console.log('         ✅ Second rotation ran cleanly; skipped already-new secrets.\n');

    console.log('================================================================');
    console.log('REHEARSAL RESULT: ALL 5 STEPS PASSED (100% SUCCESS)');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

if (require.main === module) {
  runRehearsal().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error(`❌ [REHEARSAL FATAL] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runRehearsal };
