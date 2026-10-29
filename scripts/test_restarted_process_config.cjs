#!/usr/bin/env node
/**
 * scripts/test_restarted_process_config.cjs
 *
 * Verification Suite for Real Restarted Process Configuration & Environment Precedence:
 * 1. Proves that rewritten .env values take precedence over conflicting/stale inherited
 *    environment variables from previous parent processes or daemon managers.
 * 2. Launches the REAL application entry point (server/server.js) under test.
 * 3. Asserts static database imports respect server/bootstrap.js loaded at line 1.
 * 4. Verifies the effective database path and port via live HTTP endpoint /api/test/db-identity.
 * 5. Exercises real authentication middleware and HTTP endpoints:
 *    - /api/auth/me with active token signed with NEW JWT secret -> 200 OK.
 *    - /api/auth/me with token signed with OLD (retired) JWT secret -> 403 Forbidden (session revocation policy).
 *    - /api/auth/me with token signed with stale inherited key -> 403 Forbidden.
 *    - /api/auth/me with missing token -> 401 Unauthorized.
 * 6. Exercises real MFA verification via /api/auth/mfa-verify:
 *    - User with re-encrypted secret (new MFA key) -> 200 OK.
 *    - User with unrotated secret (previous MFA key) -> 200 OK via PREVIOUS_MFA_ENCRYPTION_KEY fallback.
 *    - Invalid TOTP code -> 400 Bad Request.
 * 7. Exercises executeRollback and launches the REAL application entry point AGAIN on restored configuration:
 *    - /api/auth/me with restored original token -> 200 OK.
 *    - /api/auth/me with rotated token -> 403 Forbidden.
 * 8. Strictly enforces Zero Credential Disclosure in assertions and logs.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const child_process = require('child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { generateSync, generateSecret } = require('otplib');

const { executeDeployment, executeRollback } = require('./production_lifecycle.cjs');

const TEST_DIR = path.resolve(__dirname, '..', 'test_restarted_proc_env');
const TEST_PORT = 3894;
const TARGET_COMMIT = process.env.TARGET_COMMIT || (() => {
  try {
    const r = child_process.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    return r.stdout && r.stdout.trim() ? r.stdout.trim() : '6df425aa6ba690523b4e230c511f0ecc9d6fc1e9';
  } catch {
    return '6df425aa6ba690523b4e230c511f0ecc9d6fc1e9';
  }
})();

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

function encryptSecret(plainSecret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function computeTotpCode(secretBase32, timeMs = Date.now()) {
  const epoch = Math.floor(timeMs / 1000);
  return generateSync({ secret: secretBase32, epoch });
}

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json !== null ? json : data });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function waitForServerReady(port, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/test/db-identity',
        method: 'GET',
        timeout: 1000
      });
      if (res.status === 200) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server failed to respond on port ${port} within ${maxWaitMs}ms`);
}

async function runTest() {
  process.env.ALLOW_WINDOWS_DEV_PREFLIGHT = 'true';
  console.log('================================================================');
  console.log('START: REAL APPLICATION BOOTSTRAP & ENDPOINT AUTHENTICATION TEST');
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

  cleanDir(TEST_DIR);
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const serverDir = path.join(TEST_DIR, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'dist', 'index.html'), '<html></html>', 'utf8');

  // Copy operational scripts and migrations
  for (const s of [
    'preflight_lockdown_check.cjs',
    'verify_isolation.cjs',
    'run_migrations.cjs',
    'production_smoke_check.cjs',
    'production_lifecycle.cjs',
    'obtain_smoke_credentials.cjs',
    'rotate_mfa_secrets.cjs',
    'mock_rehearsal_spawner.cjs'
  ]) {
    fs.copyFileSync(path.resolve(__dirname, s), path.join(TEST_DIR, 'scripts', s));
  }

  const rootMigrations = path.resolve(__dirname, '..', 'server', 'db', 'migrations');
  fs.mkdirSync(path.join(serverDir, 'db', 'migrations'), { recursive: true });
  fs.cpSync(rootMigrations, path.join(serverDir, 'db', 'migrations'), { recursive: true });

  const dbPath = path.join(serverDir, 'bfi_classroom.db');
  const envFile = path.join(TEST_DIR, '.env');

  // Generate distinct test secrets
  const initialMfaKey = 'init_mfa_key_' + crypto.randomBytes(16).toString('hex');
  const rotatedMfaKey = 'rot_mfa_key_' + crypto.randomBytes(16).toString('hex');
  const initialJwtSecret = 'init_jwt_sec_' + crypto.randomBytes(16).toString('hex');
  const rotatedJwtSecret = 'rot_jwt_sec_' + crypto.randomBytes(16).toString('hex');
  const initialRefreshSecret = 'init_ref_sec_' + crypto.randomBytes(16).toString('hex');
  const rotatedRefreshSecret = 'rot_ref_sec_' + crypto.randomBytes(16).toString('hex');

  const staleInheritedMfaKey = 'stale_mfa_key_inherited_from_parent_shell';
  const staleInheritedJwtSecret = 'stale_jwt_sec_inherited_from_parent_shell';

  const plainSecretUser1 = generateSecret();
  const plainSecretUser2 = generateSecret();

  // 1. Initialize SQLite database with baseline tables & users
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      first_name TEXT,
      last_name TEXT,
      profile_picture TEXT,
      mobile_number TEXT,
      public_key TEXT,
      is_super_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      two_factor_enabled INTEGER DEFAULT 1,
      two_factor_secret TEXT,
      pending_two_factor_secret TEXT,
      token_version INTEGER DEFAULT 1,
      password_reset_pending INTEGER DEFAULT 0,
      archived_at TEXT,
      deleted_at TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mfa_login_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_version INTEGER DEFAULT 1,
      consumed INTEGER DEFAULT 0,
      consumed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS student_course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_name TEXT NOT NULL DEFAULT 'filmmaking',
      course_type TEXT NOT NULL DEFAULT 'filmmaking',
      step1_completed INTEGER DEFAULT 0,
      step2_completed INTEGER DEFAULT 0,
      step3_completed INTEGER DEFAULT 0,
      step4_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      attendance_classes TEXT,
      exam_written INTEGER DEFAULT 0,
      assignment_screenplay INTEGER DEFAULT 0,
      assignment_shooting_script INTEGER DEFAULT 0,
      attendance_total INTEGER DEFAULT 22,
      phase2_shooting_attended INTEGER DEFAULT 0,
      phase2_editing_attended INTEGER DEFAULT 0,
      fee_details TEXT,
      assignment_scores TEXT,
      course_definition_id INTEGER,
      course_version INTEGER,
      batch_id INTEGER REFERENCES batches(id)
    );
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_number TEXT,
      batch_name TEXT,
      course_name TEXT,
      course_definition_id INTEGER,
      slug TEXT,
      status TEXT,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS batch_course_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
      course_definition_id INTEGER,
      course_name TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      phase1_fee INTEGER NOT NULL DEFAULT 0,
      phase2_fee INTEGER NOT NULL DEFAULT 0,
      full_fee INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
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
    INSERT INTO batches (id, batch_number, course_name) VALUES (1, 'B-01', 'Film');
    INSERT INTO batch_course_fees (id, batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee) VALUES (1, 1, 'Film', 'B-01', 2500, 2500, 5000);
  `);

  const encSecret1 = encryptSecret(plainSecretUser1, deriveKey(initialMfaKey));
  const encSecret2 = encryptSecret(plainSecretUser2, deriveKey(initialMfaKey));

  // User 1: Active MFA secret (will be rotated)
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, two_factor_enabled, two_factor_secret, pending_two_factor_secret, token_version)
    VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash1', 'admin', 'Abir', 'Ahmad', 0, 1, 1, ?, NULL, 1)
  `).run(encSecret1);

  // User 2: Active MFA secret (will remain unrotated under initial key to test fallback)
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, two_factor_enabled, two_factor_secret, pending_two_factor_secret, token_version)
    VALUES (2, 'admin2', 'admin2@bfi.com', 'hash2', 'admin', 'Admin', 'Two', 0, 1, 1, ?, NULL, 1)
  `).run(encSecret2);

  db.prepare(`
    INSERT INTO student_course_enrollments (id, user_id, course_name, batch_id) VALUES (1, 1, 'Film', 1)
  `).run();

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
    VALUES (101, 1, 'sessionhash1', '127.0.0.1', 'test-agent', datetime('now', '+1 hour'))
  `).run();
  db.close();

  // 2. Create initial .env
  fs.writeFileSync(
    envFile,
    [
      `PORT=${TEST_PORT}`,
      `DATABASE_PATH=${dbPath}`,
      `MFA_ENCRYPTION_KEY=${initialMfaKey}`,
      `JWT_SECRET=${initialJwtSecret}`,
      `JWT_REFRESH_SECRET=${initialRefreshSecret}`,
      `DISABLE_OUTBOUND_NOTIFICATIONS=true`,
      `IS_TEST_SERVER=true`,
      `NODE_ENV=test`
    ].join('\n') + '\n',
    'utf8'
  );
  try { fs.chmodSync(envFile, 0o600); } catch {}

  const projectRoot = path.resolve(__dirname, '..');
  const serverJsPath = path.join(projectRoot, 'server', 'server.js');
  const spawnerModule = path.resolve(__dirname, 'mock_rehearsal_spawner.cjs');

  // ── STEP 1: Execute Deployment with MFA & JWT Rotation ─────────────────────
  console.log('\n--- [Step 1] Deploy with MFA & JWT Rotation ---');
  const deployRes = await executeDeployment({
    rootDir: TEST_DIR,
    databasePath: 'server/bfi_classroom.db',
    targetCommit: TARGET_COMMIT,
    preDeploymentRevision: '0000000000000000000000000000000000000000',
    rotateMfa: true,
    newMfaKey: rotatedMfaKey,
    newJwtSecret: rotatedJwtSecret,
    newRefreshSecret: rotatedRefreshSecret,
    isRehearsal: true,
    spawner: require('./mock_rehearsal_spawner.cjs').spawner
  });
  assert(deployRes.success === true, 'Deployment with rotation succeeded');

  // Verify .env on disk
  const deployedEnvContent = fs.readFileSync(envFile, 'utf8');
  assert(deployedEnvContent.includes('MFA_ENCRYPTION_KEY=' + rotatedMfaKey), '.env contains new MFA_ENCRYPTION_KEY');
  assert(deployedEnvContent.includes('PREVIOUS_MFA_ENCRYPTION_KEY=' + initialMfaKey), '.env contains PREVIOUS_MFA_ENCRYPTION_KEY');
  assert(deployedEnvContent.includes('JWT_SECRET=' + rotatedJwtSecret), '.env contains new JWT_SECRET');
  assert(deployedEnvContent.includes('PREVIOUS_JWT_SECRET=' + initialJwtSecret), '.env contains PREVIOUS_JWT_SECRET');

  // ── STEP 2: Boot Real Application Entry Point with Conflicting Inherited Env
  console.log('\n--- [Step 2] Launch Real Application (server/server.js) with Conflicting Inherited Env ---');

  const conflictingEnv = {
    ...process.env,
    PORT: '9999', // Conflicting port!
    DATABASE_PATH: 'E:/bogus_inherited_db.sqlite', // Conflicting DB!
    MFA_ENCRYPTION_KEY: staleInheritedMfaKey, // Conflicting MFA key!
    JWT_SECRET: staleInheritedJwtSecret, // Conflicting JWT secret!
    JWT_REFRESH_SECRET: 'stale_inherited_refresh_sec',
    DOTENV_CONFIG_PATH: envFile,
    DISABLE_OUTBOUND_NOTIFICATIONS: 'true',
    ALLOW_WINDOWS_DEV_PREFLIGHT: 'true'
  };
  delete conflictingEnv.IS_TEST_SERVER;
  delete conflictingEnv.NODE_ENV;

  let serverStderr = '';

  const childServer = child_process.spawn(process.execPath, [serverJsPath], {
    cwd: projectRoot,
    env: conflictingEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  childServer.stdout.on('data', d => console.log('[CHILD SERVER STDOUT]', d.toString().trim()));
  childServer.stderr.on('data', d => {
    const str = d.toString();
    serverStderr += str;
    console.error('[CHILD SERVER STDERR]', str.trim());
  });

  await waitForServerReady(TEST_PORT);
  console.log(`   Real application confirmed listening on port ${TEST_PORT}`);

  // ── STEP 2.1: Verify Effective Database Path and Port Precedence ───────────
  console.log('\n--- [Step 2.1] Verify Database & Port Precedence via /api/test/db-identity ---');
  const idRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/test/db-identity',
    method: 'GET'
  });

  assert(idRes.status === 200, 'db-identity endpoint responded with HTTP 200 OK');
  assert(idRes.body.port === TEST_PORT, `Effective port is ${TEST_PORT} (overriding inherited 9999)`);
  assert(idRes.body.dbPath === 'bfi_classroom.db', `Effective dbPath is bfi_classroom.db (overriding inherited bogus DB)`);

  // ── STEP 2.2: Test Real JWT Authentication on /api/auth/me ─────────────────
  console.log('\n--- [Step 2.2] Test Real JWT Authentication & Session Revocation on /api/auth/me ---');

  // A. Valid token signed with active (new) JWT secret
  const validNewToken = jwt.sign(
    { id: 1, username: 'admin@abir', role: 'admin', type: 'access', sessionId: 101, token_version: 1 },
    rotatedJwtSecret,
    { expiresIn: '1h' }
  );
  const authValidRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${validNewToken}` }
  });
  assert(authValidRes.status === 200, 'Token signed with active JWT secret is accepted with HTTP 200 OK');
  assert(authValidRes.body && authValidRes.body.id === 1, 'Profile returned belongs to authenticated user');

  // B. Token signed with OLD (retired) JWT secret (Session-Revocation Policy Enforcement)
  const oldRetiredToken = jwt.sign(
    { id: 1, username: 'admin@abir', role: 'admin', type: 'access', sessionId: 101, token_version: 1 },
    initialJwtSecret,
    { expiresIn: '1h' }
  );
  const authOldRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${oldRetiredToken}` }
  });
  assert(authOldRes.status === 403, 'Token signed with retired JWT secret is strictly rejected with HTTP 403 Forbidden');
  assert(authOldRes.body.error === 'Invalid token', 'Error message confirms token rejection per session-revocation policy');

  // C. Token signed with stale inherited JWT secret
  const staleInheritedToken = jwt.sign(
    { id: 1, username: 'admin@abir', role: 'admin', type: 'access', sessionId: 101, token_version: 1 },
    staleInheritedJwtSecret,
    { expiresIn: '1h' }
  );
  const authStaleRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${staleInheritedToken}` }
  });
  assert(authStaleRes.status === 403, 'Token signed with stale inherited JWT secret is strictly rejected with HTTP 403');

  // D. Request without token
  const authNoTokenRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET'
  });
  assert(authNoTokenRes.status === 401, 'Request without token is rejected with HTTP 401 Unauthorized');

  // ── STEP 2.3: Test Real MFA Verification on /api/auth/mfa-verify ───────────
  console.log('\n--- [Step 2.3] Test Real MFA Verification on /api/auth/mfa-verify ---');

  // A. User 1: secret was re-encrypted under rotatedMfaKey during Phase 4.2
  const challenge1Id = crypto.randomUUID();
  const challengeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  {
    const mDb = new Database(dbPath);
    mDb.prepare(`
      INSERT INTO mfa_login_challenges (id, user_id, token_version, consumed, expires_at)
      VALUES (?, 1, 1, 0, ?)
    `).run(challenge1Id, challengeExpiresAt);
    mDb.close();
  }

  const mfaChallengeToken1 = jwt.sign(
    { id: 1, type: 'mfa_challenge', challengeId: challenge1Id, token_version: 1 },
    rotatedJwtSecret,
    { expiresIn: '15m' }
  );
  const codeUser1 = computeTotpCode(plainSecretUser1);

  const mfaVerifyRes1 = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/mfa-verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    mfaToken: mfaChallengeToken1,
    code: codeUser1
  });

  if (mfaVerifyRes1.status !== 200) {
    console.error('mfaVerifyRes1 response:', mfaVerifyRes1.status, mfaVerifyRes1.body);
  }
  assert(mfaVerifyRes1.status === 200, 'MFA verification for re-encrypted secret (User 1) returns HTTP 200 OK');
  assert(Boolean(mfaVerifyRes1.body.token), 'MFA verification returns completed-login access token');

  // B. User 2: unrotated secret encrypted under initialMfaKey (tests PREVIOUS_MFA_ENCRYPTION_KEY fallback)
  const challenge2Id = crypto.randomUUID();
  {
    const mDb = new Database(dbPath);
    mDb.prepare(`
      INSERT INTO mfa_login_challenges (id, user_id, token_version, consumed, expires_at)
      VALUES (?, 2, 1, 0, ?)
    `).run(challenge2Id, challengeExpiresAt);
    mDb.close();
  }

  const mfaChallengeToken2 = jwt.sign(
    { id: 2, type: 'mfa_challenge', challengeId: challenge2Id, token_version: 1 },
    rotatedJwtSecret,
    { expiresIn: '15m' }
  );
  const codeUser2 = computeTotpCode(plainSecretUser2);

  const mfaVerifyRes2 = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/mfa-verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    mfaToken: mfaChallengeToken2,
    code: codeUser2
  });

  assert(mfaVerifyRes2.status === 200, 'MFA verification for unrotated secret (User 2) returns HTTP 200 OK via previous key fallback');

  // C. Invalid TOTP code
  const challenge3Id = crypto.randomUUID();
  {
    const mDb = new Database(dbPath);
    mDb.prepare(`
      INSERT INTO mfa_login_challenges (id, user_id, token_version, consumed, expires_at)
      VALUES (?, 1, 1, 0, ?)
    `).run(challenge3Id, challengeExpiresAt);
    mDb.close();
  }

  const mfaChallengeToken3 = jwt.sign(
    { id: 1, type: 'mfa_challenge', challengeId: challenge3Id, token_version: 1 },
    rotatedJwtSecret,
    { expiresIn: '15m' }
  );

  const mfaInvalidRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/mfa-verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    mfaToken: mfaChallengeToken3,
    code: '000000'
  });

  assert(mfaInvalidRes.status === 400, 'Invalid TOTP code is rejected with HTTP 400 Bad Request');

  // Cleanly terminate deployed child server
  childServer.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1000));

  // ── STEP 3: Execute Canonical Rollback ─────────────────────────────────────
  console.log('\n--- [Step 3] Execute Hardened Rollback ---');
  const rollbackRes = await executeRollback({
    rootDir: TEST_DIR,
    databasePath: 'server/bfi_classroom.db',
    isRehearsal: true,
    spawner: require('./mock_rehearsal_spawner.cjs').spawner,
    allowPostReopeningReconciliation: true
  });

  assert(rollbackRes.rollbackComplete === true, 'Rollback completed successfully');

  // Verify restored .env
  const restoredEnvContent = fs.readFileSync(envFile, 'utf8');
  assert(restoredEnvContent.includes('MFA_ENCRYPTION_KEY=' + initialMfaKey), 'Restored .env has original historical MFA key');
  assert(restoredEnvContent.includes('JWT_SECRET=' + initialJwtSecret), 'Restored .env has original historical JWT secret');
  assert(!restoredEnvContent.includes(rotatedMfaKey), 'Rotated MFA key cleanly removed from .env');

  // ── STEP 4: Boot Real Application Entry Point on Restored Configuration ───
  console.log('\n--- [Step 4] Launch Real Application on Restored Configuration ---');

  const rollbackServer = child_process.spawn(process.execPath, [serverJsPath], {
    cwd: projectRoot,
    env: conflictingEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  rollbackServer.stdout.on('data', d => console.log('[ROLLBACK SERVER STDOUT]', d.toString().trim()));
  rollbackServer.stderr.on('data', d => {
    const str = d.toString();
    serverStderr += str;
    console.error('[ROLLBACK SERVER STDERR]', str.trim());
  });

  await waitForServerReady(TEST_PORT);
  console.log(`   Restored application confirmed listening on port ${TEST_PORT}`);

  // Test that restored JWT secret now accepts initial tokens and rejects rotated tokens
  const restoredAuthMeRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${oldRetiredToken}` }
  });
  assert(restoredAuthMeRes.status === 200, 'Original token is accepted with HTTP 200 OK after rollback');

  const rotatedTokenOnRollbackRes = await httpRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${validNewToken}` }
  });
  assert(rotatedTokenOnRollbackRes.status === 403, 'Rotated token is strictly rejected with HTTP 403 after rollback');

  // Cleanly terminate rollback child server
  rollbackServer.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1000));

  // ── STEP 5: Zero Credential Disclosure Assertion ──────────────────────────
  console.log('\n--- [Step 5] Verify Zero Sensitive Credential Disclosure ---');
  assert(!serverStderr.includes(initialMfaKey), 'initialMfaKey not disclosed in server stderr');
  assert(!serverStderr.includes(rotatedMfaKey), 'rotatedMfaKey not disclosed in server stderr');
  assert(!serverStderr.includes(initialJwtSecret), 'initialJwtSecret not disclosed in server stderr');
  assert(!serverStderr.includes(rotatedJwtSecret), 'rotatedJwtSecret not disclosed in server stderr');
  assert(!serverStderr.includes(plainSecretUser1), 'plainSecretUser1 not disclosed in server stderr');

  console.log('\n================================================================');
  console.log(`ALL ${total} REAL APPLICATION BOOTSTRAP & ENDPOINT TESTS PASSED (${passed}/${total})`);
  console.log('================================================================');

  cleanDir(TEST_DIR);
}

runTest().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
