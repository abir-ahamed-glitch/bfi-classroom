#!/usr/bin/env node
/**
 * scripts/test_mfa_rotation_lifecycle.cjs
 *
 * Comprehensive TDD Verification Suite for:
 * 1. CLI argument parsing (--target-commit <SHA> and --target-commit=<SHA>, etc.)
 * 2. Effective active MFA key resolution (empty string handling, precedence, fallback)
 * 3. Verified database decryptability audit under final key configuration
 * 4. Full lifecycle deployment with atomic MFA secret rotation and protected .env updates
 * 5. Rollback under 4 distinct failure points:
 *    - Failure before rotation
 *    - Failure during rotation
 *    - Failure after configuration update (before restart)
 *    - Failure after restart (during smoke verification)
 * 6. Rollback compatibility assertion: restored code, database ciphertext, and configuration
 * 7. Post-exposure reconciliation safeguard enforcement
 *
 * Runs strictly on isolated disposable fixtures. NEVER touches live production or credentials.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  determineActiveMfaSecretSource,
  auditDecryptability,
  executeRotation
} = require('./rotate_mfa_secrets.cjs');
const {
  parseLifecycleArgs,
  executeDeployment,
  executeRollback
} = require('./production_lifecycle.cjs');

const TEST_BASE_DIR = path.resolve(__dirname, '..', 'test_mfa_lifecycle_env');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

async function runAllTests() {
  process.env.ALLOW_WINDOWS_DEV_PREFLIGHT = 'true';
  console.log('================================================================');
  console.log('START: MFA ROTATION & LIFECYCLE INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, desc) {
    total++;
    if (!condition) {
      console.error(`❌ FAIL: ${desc}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
    console.log(`✅ PASS: ${desc}`);
    passed++;
  }

  // ── TEST 1: CLI Argument Parsing ──────────────────────────────────────────
  console.log('\n--- [Test 1] CLI Argument Parsing Compatibility ---');
  {
    // Test space-separated flags
    const argsSpace = ['deploy', '--target-commit', '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3', '--database-path', 'server/test.db', '--rotate-mfa'];
    const parsedSpace = parseLifecycleArgs(argsSpace);
    assert(parsedSpace.action === 'deploy', 'Space-separated deploy action identified');
    assert(parsedSpace.targetCommit === '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3', 'Space-separated --target-commit parsed');
    assert(parsedSpace.databasePath === 'server/test.db', 'Space-separated --database-path parsed');
    assert(parsedSpace.rotateMfa === true, 'Space-separated --rotate-mfa parsed');

    // Test equals-separated flags
    const argsEq = ['deploy', '--target-commit=0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3', '--database-path=server/test.db', '--rotate-mfa'];
    const parsedEq = parseLifecycleArgs(argsEq);
    assert(parsedEq.action === 'deploy', 'Equals-separated deploy action identified');
    assert(parsedEq.targetCommit === '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3', 'Equals-separated --target-commit parsed');
    assert(parsedEq.databasePath === 'server/test.db', 'Equals-separated --database-path parsed');
    assert(parsedEq.rotateMfa === true, 'Equals-separated --rotate-mfa parsed');

    // Test rollback flags
    const argsRollback = ['rollback', '--allow-post-reopening-reconciliation'];
    const parsedRollback = parseLifecycleArgs(argsRollback);
    assert(parsedRollback.action === 'rollback', 'Rollback action identified');
    assert(parsedRollback.allowPostReopening === true, '--allow-post-reopening-reconciliation flag identified');
  }

  // ── TEST 2: Effective Active Key Determination ────────────────────────────
  console.log('\n--- [Test 2] Active Historical Key Determination Semantics ---');
  {
    // Case 2a: MFA_ENCRYPTION_KEY set and non-empty
    const envA = { MFA_ENCRYPTION_KEY: 'active_mfa_key_123', JWT_SECRET: 'jwt_secret_456' };
    const resA = determineActiveMfaSecretSource(envA);
    assert(resA.sourceName === 'MFA_ENCRYPTION_KEY' && resA.value === 'active_mfa_key_123', 'MFA_ENCRYPTION_KEY takes precedence when non-empty');

    // Case 2b: MFA_ENCRYPTION_KEY is empty string (should fall back to JWT_SECRET)
    const envB = { MFA_ENCRYPTION_KEY: '   ', JWT_SECRET: 'jwt_secret_456' };
    const resB = determineActiveMfaSecretSource(envB);
    assert(resB.sourceName === 'JWT_SECRET' && resB.value === 'jwt_secret_456', 'Empty MFA_ENCRYPTION_KEY correctly falls back to JWT_SECRET');

    // Case 2c: MFA_ENCRYPTION_KEY is undefined (should fall back to JWT_SECRET)
    const envC = { JWT_SECRET: 'jwt_secret_789' };
    const resC = determineActiveMfaSecretSource(envC);
    assert(resC.sourceName === 'JWT_SECRET' && resC.value === 'jwt_secret_789', 'Undefined MFA_ENCRYPTION_KEY falls back to JWT_SECRET');

    // Case 2d: Both empty/missing -> throws fail-closed error
    let threwD = false;
    try {
      determineActiveMfaSecretSource({ MFA_ENCRYPTION_KEY: '', JWT_SECRET: '  ' });
    } catch {
      threwD = true;
    }
    assert(threwD, 'Throws fail-closed error when both sources are empty');

    // Case 2e: Reading from disposable .env file
    cleanDir(TEST_BASE_DIR);
    fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
    const dummyEnvFile = path.join(TEST_BASE_DIR, '.env');
    fs.writeFileSync(dummyEnvFile, 'PORT=3001\n# Comment\nMFA_ENCRYPTION_KEY=  \nJWT_SECRET=file_jwt_secret_abc\n');
    const resE = determineActiveMfaSecretSource({}, dummyEnvFile);
    assert(resE.sourceName === 'JWT_SECRET' && resE.value === 'file_jwt_secret_abc', 'Correctly parses and trims .env file with empty MFA key falling back to JWT_SECRET');
  }

  // ── TEST 3: Verified Decryptability Audit ──────────────────────────────────
  console.log('\n--- [Test 3] Decryptability Audit Under Final Key Configuration ---');
  {
    const dbPath = path.join(TEST_BASE_DIR, 'audit_test.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        two_factor_secret TEXT,
        pending_two_factor_secret TEXT
      );
    `);

    const keyOld = deriveKey('historical_secret_1');
    const keyNew = deriveKey('target_secret_2');

    const encOld1 = encrypt('PLAIN_ACTIVE_1', keyOld);
    const encNew1 = encrypt('PLAIN_ACTIVE_1', keyNew);

    const pendingEnvelopeOld = JSON.stringify({ secret: encrypt('PLAIN_PENDING_2', keyOld) });
    const pendingEnvelopeNew = JSON.stringify({ secret: encrypt('PLAIN_PENDING_2', keyNew) });

    // Insert user with old ciphertext
    db.prepare("INSERT INTO users VALUES (1, 'u1', ?, ?)").run(encOld1, pendingEnvelopeOld);

    // Audit with keyNew alone -> must FAIL because secret is still encrypted with keyOld
    let audit1Failed = false;
    try {
      auditDecryptability(db, { primaryKeySource: 'target_secret_2', requirePrimaryOnly: true });
    } catch {
      audit1Failed = true;
    }
    assert(audit1Failed, 'Audit strictly fails when database secrets cannot be decrypted with primary key');

    // Audit with keyOld as fallback -> must PASS
    const auditFallback = auditDecryptability(db, {
      primaryKeySource: 'target_secret_2',
      previousKeySource: 'historical_secret_1',
      requirePrimaryOnly: false
    });
    assert(auditFallback.auditPassed === true && auditFallback.activeSecretsVerified === 1, 'Audit passes when fallback key can decrypt secrets');

    // Update user to new ciphertext
    db.prepare('UPDATE users SET two_factor_secret = ?, pending_two_factor_secret = ? WHERE id = 1').run(encNew1, pendingEnvelopeNew);

    // Audit with keyNew requiring primary only -> must PASS
    const auditPrimary = auditDecryptability(db, { primaryKeySource: 'target_secret_2', requirePrimaryOnly: true });
    assert(auditPrimary.auditPassed === true && auditPrimary.activeSecretsVerified === 1 && auditPrimary.pendingSecretsVerified === 1,
      'Audit passes with requirePrimaryOnly=true once all records are re-encrypted under target primary key');

    db.close();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper for creating full lifecycle mock environment
  // ─────────────────────────────────────────────────────────────────────────
  function setupLifecycleEnv(dirName, initialKeySource = 'JWT_SECRET') {
    const envDir = path.join(TEST_BASE_DIR, dirName);
    cleanDir(envDir);
    fs.mkdirSync(envDir, { recursive: true });
    const serverDir = path.join(envDir, 'server');
    fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(path.join(serverDir, 'backups'), { recursive: true });
    fs.mkdirSync(path.join(envDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(envDir, 'dist'), { recursive: true });

    // Dist files
    fs.writeFileSync(path.join(envDir, 'dist', 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(envDir, 'dist', '404.html'), '<html></html>');

    // Operational scripts
    for (const s of [
      'preflight_lockdown_check.cjs',
      'verify_isolation.cjs',
      'run_migrations.cjs',
      'production_smoke_check.cjs',
      'production_lifecycle.cjs',
      'obtain_smoke_credentials.cjs',
      'rotate_mfa_secrets.cjs'
    ]) {
      fs.copyFileSync(path.resolve(__dirname, s), path.join(envDir, 'scripts', s));
    }

    // Migrations
    const rootMigrations = path.resolve(__dirname, '..', 'server', 'db', 'migrations');
    fs.mkdirSync(path.join(serverDir, 'db', 'migrations'), { recursive: true });
    fs.cpSync(rootMigrations, path.join(serverDir, 'db', 'migrations'), { recursive: true });

    // Database
    const dbPath = path.join(serverDir, 'bfi_classroom.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT,
        password_hash TEXT,
        role TEXT,
        first_name TEXT,
        last_name TEXT,
        is_active INTEGER DEFAULT 1,
        deleted_at TEXT,
        is_super_admin INTEGER DEFAULT 0,
        token_version INTEGER DEFAULT 1,
        two_factor_enabled INTEGER DEFAULT 0,
        two_factor_secret TEXT,
        pending_two_factor_secret TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE student_course_enrollments (id INTEGER PRIMARY KEY);
      CREATE TABLE batches (id INTEGER PRIMARY KEY);
      CREATE TABLE batch_course_fees (id INTEGER PRIMARY KEY);
      CREATE TABLE student_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        full_name TEXT
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        token_hash TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_activity TEXT DEFAULT (datetime('now')),
        expires_at TEXT,
        sudo_verified_at TEXT
      );
      INSERT INTO student_course_enrollments VALUES (1);
      INSERT INTO batches VALUES (1);
      INSERT INTO batch_course_fees VALUES (1);
    `);

    const historicalKeyStr = 'historical_initial_secret_key_1111';
    const histKey = deriveKey(historicalKeyStr);
    const encActive = encrypt('PLAIN_ACTIVE_SECRET', histKey);
    const encPending = encrypt('PLAIN_PENDING_SECRET', histKey);
    const pendingJson = JSON.stringify({ secret: encPending, createdAt: new Date().toISOString() });

    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, two_factor_enabled, two_factor_secret, pending_two_factor_secret)
      VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash1', 'admin', 'Abir', 'Ahmad', 0, 1, ?, ?)
    `).run(encActive, pendingJson);
    db.close();

    // .env file
    const envFile = path.join(envDir, '.env');
    let envContent = '';
    if (initialKeySource === 'MFA_ENCRYPTION_KEY') {
      envContent = `PORT=3001\nMFA_ENCRYPTION_KEY=${historicalKeyStr}\nJWT_SECRET=dummy_jwt_2222\n`;
    } else {
      envContent = `PORT=3001\nJWT_SECRET=${historicalKeyStr}\n`;
    }
    fs.writeFileSync(envFile, envContent, 'utf8');
    try { fs.chmodSync(envFile, 0o600); } catch {}

    // Mock spawner that tracks service states realistically and executes node scripts
    let nginxActive = true;
    let pm2Online = true;
    let failSmokeCheck = false;
    const executedCommands = [];

    const mockSpawner = (cmd, args, opts) => {
      executedCommands.push({ cmd, args });

      if (cmd === 'sudo' && args[0] === 'systemctl' && args[1] === 'stop') {
        nginxActive = false;
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'sudo' && args[0] === 'systemctl' && args[1] === 'start') {
        nginxActive = true;
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'systemctl' && args[0] === 'is-active') {
        return { status: nginxActive ? 0 : 3, stdout: nginxActive ? 'active\n' : 'inactive\n', stderr: '', error: null };
      }
      if (cmd === 'pm2' && args[0] === 'stop') {
        pm2Online = false;
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'pm2' && args[0] === 'start') {
        pm2Online = true;
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'pm2' && args[0] === 'jlist') {
        return {
          status: 0,
          stdout: JSON.stringify([{ name: 'bfi-classroom', pm2_env: { status: pm2Online ? 'online' : 'stopped' } }])
        };
      }
      if (cmd === 'pgrep') {
        return { status: nginxActive ? 0 : 1, stdout: nginxActive ? '830\n' : '', stderr: '', error: null };
      }
      if (cmd === 'ss') {
        const fullArgs = args.join(' ');
        if (fullArgs.includes(':80') || fullArgs.includes(':443')) {
          return { status: 0, stdout: nginxActive ? 'tcp LISTEN 0 511 0.0.0.0:80 *:*\n' : '', stderr: '', error: null };
        }
        if (fullArgs.includes('established')) {
          return { status: 0, stdout: '', stderr: '', error: null };
        }
        if (fullArgs.includes(':3001')) {
          return { status: 0, stdout: pm2Online ? 'tcp LISTEN 0 511 127.0.0.1:3001 *:*\n' : '', stderr: '', error: null };
        }
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'lsof') {
        if (args[0] === '-v') return { status: 0, stdout: 'lsof version 4.93\n', stderr: '', error: null };
        return { status: 1, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'fuser') {
        return { status: 1, stdout: '', stderr: '', error: null };
      }
      if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3\n' };
      if (cmd === 'git' && args[0] === 'checkout') return { status: 0 };
      if (cmd === 'git' && args[0] === 'show') {
        const scriptPath = path.resolve(__dirname, '..', args[1].split(':')[1]);
        if (fs.existsSync(scriptPath)) return { status: 0, stdout: fs.readFileSync(scriptPath, 'utf8') };
        return { status: 1, stderr: 'File not found' };
      }
      if (cmd === 'npm') return { status: 0, stdout: 'ok\n' };
      if (cmd === 'curl') return { status: 0, stdout: 'HTTP/1.1 200 OK\n' };

      // Pass through node execution for scripts
      if (cmd === process.execPath || cmd === 'node') {
        if (args[0] && args[0].includes('production_smoke_check.cjs')) {
          if (failSmokeCheck) {
            return { status: 1, stdout: '', stderr: 'Simulated smoke check fatal failure', error: null };
          }
          return {
            status: 0,
            stdout: '✅ PRODUCTION SMOKE VERIFICATION PASSED: 18/18 assertions verified.\n   All required tiers passed.\n   Deployment gate cleared.\n',
            stderr: '',
            error: null
          };
        }
        const { spawnSync } = require('child_process');
        return spawnSync(cmd, args, { ...opts, shell: false });
      }

      return { status: 0, stdout: '' };
    };

    return {
      envDir,
      serverDir,
      dbPath,
      envFile,
      historicalKeyStr,
      mockSpawner,
      executedCommands,
      setFailSmokeCheck: (val) => { failSmokeCheck = val; }
    };
  }

  // ── TEST 4: Full Deployment with MFA Rotation (Happy Path) ────────────────
  console.log('\n--- [Test 4] Full Lifecycle Deployment with MFA Rotation ---');
  {
    const fixture = setupLifecycleEnv('happy_path', 'JWT_SECRET');
    const newMfaKey = 'target_new_mfa_key_9999';

    const deployRes = await executeDeployment({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      targetCommit: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3',
      preDeploymentRevision: '0000000000000000000000000000000000000000',
      rotateMfa: true,
      newMfaKey,
      isRehearsal: true,
      spawner: fixture.mockSpawner
    });

    assert(deployRes.success === true, 'Deployment reported success');

    // Verify .env update
    const updatedEnv = fs.readFileSync(fixture.envFile, 'utf8');
    assert(updatedEnv.includes(`MFA_ENCRYPTION_KEY=${newMfaKey}`), '.env updated with MFA_ENCRYPTION_KEY');
    assert(updatedEnv.includes(`PREVIOUS_MFA_ENCRYPTION_KEY=${fixture.historicalKeyStr}`), '.env updated with PREVIOUS_MFA_ENCRYPTION_KEY matching historical source');

    // Verify database ciphertext re-encrypted with new key
    const db = new Database(fixture.dbPath, { readonly: true });
    const user = db.prepare('SELECT two_factor_secret, pending_two_factor_secret FROM users WHERE id = 1').get();
    db.close();

    const nKey = deriveKey(newMfaKey);
    const oKey = deriveKey(fixture.historicalKeyStr);

    const decryptedActive = decrypt(user.two_factor_secret, nKey);
    assert(decryptedActive === 'PLAIN_ACTIVE_SECRET', 'Active secret decrypts cleanly with new key');

    let oldDecryptFailed = false;
    try { decrypt(user.two_factor_secret, oKey); } catch { oldDecryptFailed = true; }
    assert(oldDecryptFailed, 'Active secret fails decryption with old key');

    const pendingEnv = JSON.parse(user.pending_two_factor_secret);
    const decryptedPending = decrypt(pendingEnv.secret, nKey);
    assert(decryptedPending === 'PLAIN_PENDING_SECRET', 'Pending envelope secret decrypts cleanly with new key');

    // Verify state file
    const state = JSON.parse(fs.readFileSync(path.join(fixture.serverDir, 'active_deployment_state.json'), 'utf8'));
    assert(state.mfaRotated === true, 'State file records mfaRotated: true');
    assert(state.configUpdated === true, 'State file records configUpdated: true');
    assert(state.trafficReopened === true, 'State file records trafficReopened: true');
  }

  // ── TEST 5: Rollback on Failure Before Rotation ───────────────────────────
  console.log('\n--- [Test 5] Rollback on Failure Before Rotation ---');
  {
    const fixture = setupLifecycleEnv('fail_before_rotation', 'JWT_SECRET');

    let deployFailed = false;
    try {
      await executeDeployment({
        rootDir: fixture.envDir,
        databasePath: 'server/bfi_classroom.db',
        targetCommit: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3',
        preDeploymentRevision: '0000000000000000000000000000000000000000',
        rotateMfa: true,
        newMfaKey: 'new_key_fail_before',
        isRehearsal: true,
        spawner: fixture.mockSpawner,
        onBeforeMfaRotation: () => {
          throw new Error('Simulated failure before rotation');
        }
      });
    } catch {
      deployFailed = true;
    }
    assert(deployFailed, 'Deployment safely halted before rotation');

    // Execute rollback
    const rbRes = await executeRollback({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      isRehearsal: true,
      spawner: fixture.mockSpawner
    });
    assert(rbRes.rollbackComplete === true, 'Rollback completed successfully');

    // Verify .env was never modified
    const envAfter = fs.readFileSync(fixture.envFile, 'utf8');
    assert(!envAfter.includes('MFA_ENCRYPTION_KEY=new_key_fail_before'), '.env was NOT modified');
    assert(envAfter.includes(`JWT_SECRET=${fixture.historicalKeyStr}`), '.env preserved original configuration');

    // Verify DB still decrypts with original key
    const db = new Database(fixture.dbPath, { readonly: true });
    const user = db.prepare('SELECT two_factor_secret FROM users WHERE id = 1').get();
    db.close();
    assert(decrypt(user.two_factor_secret, deriveKey(fixture.historicalKeyStr)) === 'PLAIN_ACTIVE_SECRET',
      'Restored database ciphertext matches original historical key');
  }

  // ── TEST 6: Rollback on Failure During Rotation ───────────────────────────
  console.log('\n--- [Test 6] Rollback on Failure During Rotation (Transaction Abort) ---');
  {
    const fixture = setupLifecycleEnv('fail_during_rotation', 'JWT_SECRET');

    // Insert corrupt record into DB that cannot be decrypted
    const db = new Database(fixture.dbPath);
    db.prepare("INSERT INTO users (id, username, two_factor_secret) VALUES (2, 'corrupt_user', 'bad:iv:data')").run();
    db.close();

    let deployFailed = false;
    try {
      await executeDeployment({
        rootDir: fixture.envDir,
        databasePath: 'server/bfi_classroom.db',
        targetCommit: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3',
        preDeploymentRevision: '0000000000000000000000000000000000000000',
        rotateMfa: true,
        newMfaKey: 'new_key_fail_during',
        isRehearsal: true,
        spawner: fixture.mockSpawner
      });
    } catch {
      deployFailed = true;
    }
    assert(deployFailed, 'Deployment safely halted during rotation error');

    // Execute rollback
    const rbRes = await executeRollback({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      isRehearsal: true,
      spawner: fixture.mockSpawner
    });
    assert(rbRes.rollbackComplete === true, 'Rollback completed');

    // Verify .env was NOT modified
    const envAfter = fs.readFileSync(fixture.envFile, 'utf8');
    assert(!envAfter.includes('new_key_fail_during'), '.env never updated with new key');
  }

  // ── TEST 7: Rollback on Failure After Config Update (Before Restart) ───────
  console.log('\n--- [Test 7] Rollback on Failure After Configuration Update ---');
  {
    const fixture = setupLifecycleEnv('fail_after_config', 'JWT_SECRET');

    let deployFailed = false;
    try {
      await executeDeployment({
        rootDir: fixture.envDir,
        databasePath: 'server/bfi_classroom.db',
        targetCommit: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3',
        preDeploymentRevision: '0000000000000000000000000000000000000000',
        rotateMfa: true,
        newMfaKey: 'new_key_after_cfg_fail',
        isRehearsal: true,
        spawner: fixture.mockSpawner,
        onAfterConfigUpdate: () => {
          throw new Error('Simulated failure after config update before restart');
        }
      });
    } catch {
      deployFailed = true;
    }
    assert(deployFailed, 'Deployment halted after config update');

    // Confirm .env WAS updated before failure
    const envMid = fs.readFileSync(fixture.envFile, 'utf8');
    assert(envMid.includes('MFA_ENCRYPTION_KEY=new_key_after_cfg_fail'), 'Confirmed .env had been updated before failure');

    // Execute rollback
    const rbRes = await executeRollback({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      isRehearsal: true,
      spawner: fixture.mockSpawner
    });
    assert(rbRes.rollbackComplete === true, 'Rollback completed');

    // Verify .env WAS RESTORED from backup!
    const envRestored = fs.readFileSync(fixture.envFile, 'utf8');
    assert(!envRestored.includes('new_key_after_cfg_fail'), '.env was restored: does NOT contain new key');
    assert(envRestored.includes(`JWT_SECRET=${fixture.historicalKeyStr}`), '.env restored historical configuration');

    // Verify database was restored and matches restored .env
    const db = new Database(fixture.dbPath, { readonly: true });
    const user = db.prepare('SELECT two_factor_secret FROM users WHERE id = 1').get();
    db.close();
    assert(decrypt(user.two_factor_secret, deriveKey(fixture.historicalKeyStr)) === 'PLAIN_ACTIVE_SECRET',
      'Restored database ciphertext matches restored historical .env');
  }

  // ── TEST 8: Rollback on Failure After Restart (Smoke Verification Failure) ──
  console.log('\n--- [Test 8] Rollback on Failure After Restart (Smoke Check Failure) ---');
  {
    const fixture = setupLifecycleEnv('fail_after_restart', 'JWT_SECRET');
    fixture.setFailSmokeCheck(true);

    let deployFailed = false;
    try {
      await executeDeployment({
        rootDir: fixture.envDir,
        databasePath: 'server/bfi_classroom.db',
        targetCommit: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3',
        preDeploymentRevision: '0000000000000000000000000000000000000000',
        rotateMfa: true,
        newMfaKey: 'new_key_smoke_fail',
        isRehearsal: true,
        spawner: fixture.mockSpawner
      });
    } catch {
      deployFailed = true;
    }
    assert(deployFailed, 'Deployment halted when smoke check failed on loopback');

    // Execute rollback
    const rbRes = await executeRollback({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      isRehearsal: true,
      spawner: fixture.mockSpawner
    });
    assert(rbRes.rollbackComplete === true, 'Rollback completed after smoke check failure');

    // Verify .env was restored from backup
    const envRestored = fs.readFileSync(fixture.envFile, 'utf8');
    assert(!envRestored.includes('new_key_smoke_fail'), '.env was restored: does NOT contain new key');
    assert(envRestored.includes(`JWT_SECRET=${fixture.historicalKeyStr}`), '.env restored historical configuration');

    // Verify database was restored and ciphertext matches restored .env
    const db = new Database(fixture.dbPath, { readonly: true });
    const user = db.prepare('SELECT two_factor_secret FROM users WHERE id = 1').get();
    db.close();
    assert(decrypt(user.two_factor_secret, deriveKey(fixture.historicalKeyStr)) === 'PLAIN_ACTIVE_SECRET',
      'Restored database ciphertext matches restored historical .env');
  }

  // ── TEST 9: Post-Exposure Safeguard Enforcement ────────────────────────────
  console.log('\n--- [Test 9] Post-Exposure Reconciliation Safeguard ---');
  {
    const fixture = setupLifecycleEnv('post_exposure_test', 'JWT_SECRET');

    // Happy deployment
    await executeDeployment({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      targetCommit: '0dd12d6938fde3cefdbb84bd327a1b88ce7f86e3',
      preDeploymentRevision: '0000000000000000000000000000000000000000',
      rotateMfa: true,
      newMfaKey: 'post_exposure_key',
      isRehearsal: true,
      spawner: fixture.mockSpawner
    });

    // Attempt automatic rollback after traffic reopened -> MUST FAIL CLOSED!
    let automaticRbFailed = false;
    try {
      await executeRollback({
        rootDir: fixture.envDir,
        databasePath: 'server/bfi_classroom.db',
        isRehearsal: true,
        spawner: fixture.mockSpawner,
        allowPostReopeningReconciliation: false
      });
    } catch (rbErr) {
      automaticRbFailed = true;
      assert(rbErr.message.includes('Automatic restore rejected after traffic reopening boundary crossed'),
        'Fail-closed error mentions traffic reopening boundary');
    }
    assert(automaticRbFailed, 'Automatic rollback strictly rejected when traffic was exposed');

    // Rollback with explicit --allow-post-reopening-reconciliation -> MUST PROCEED!
    const recRes = await executeRollback({
      rootDir: fixture.envDir,
      databasePath: 'server/bfi_classroom.db',
      isRehearsal: true,
      spawner: fixture.mockSpawner,
      allowPostReopeningReconciliation: true
    });
    assert(recRes.rollbackComplete === true, 'Forensic rollback succeeded with explicit operator reconciliation authorization');
  }

  cleanDir(TEST_BASE_DIR);

  console.log('\n================================================================');
  console.log(`ALL ${total} TESTS PASSED CLEANLY (${passed}/${total})`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runAllTests().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(`\n❌ [TEST FATAL] ${err.message}\n${err.stack}`);
    cleanDir(TEST_BASE_DIR);
    process.exit(1);
  });
}

module.exports = { runAllTests };
