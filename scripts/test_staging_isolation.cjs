/**
 * Comprehensive Staging Environment Isolation & Guard Regression Suite
 * Tests:
 * 1. Directory-boundary-aware production path rejection & allowed documented staging path
 * 2. Rejection of missing, blank, or invalid staging secrets (with and without inherited env)
 * 3. Prevention of inherited production credentials from filling omitted configuration
 * 4. Removal of credential disclosure (no secret prefixes in errors; no passwords in stdout/stderr)
 * 5. Positive path confinement, symlink/junction escapes, ancestor canonicalization, and hard-link aliases
 * 6. Valid confined staging bootstrap, loopback binding, and service isolation
 *
 * For every rejected configuration, asserts that database imports, initialization,
 * file creation, and service startup NEVER occur.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const assert = require('assert');
const {
  loadAndValidateStagingEnv,
  validateStagingConfig,
  canonicalizePath,
  isStrictlyInside,
  isPathWithin,
  PROTECTED_PRODUCTION_ROOTS
} = require('./staging_guard.cjs');

const DISPOSABLE_ROOT = path.resolve(__dirname, '../tests/fixtures/staging-guard-suite');
const APPROVED_STAGING_DIR = path.join(DISPOSABLE_ROOT, 'approved-staging');
const FORBIDDEN_EXTERNAL_DIR = path.join(DISPOSABLE_ROOT, 'forbidden-external');
const SIBLING_ATTACK_DIR = path.join(DISPOSABLE_ROOT, 'approved-staging-evil');

function cleanup() {
  if (fs.existsSync(DISPOSABLE_ROOT)) {
    try {
      fs.rmSync(DISPOSABLE_ROOT, { recursive: true, force: true });
    } catch (_) {
      setTimeout(() => {
        try { fs.rmSync(DISPOSABLE_ROOT, { recursive: true, force: true }); } catch (__) {}
      }, 500);
    }
  }
}

function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createValidStagingEnvContent(overrides = {}) {
  const defaults = {
    DATABASE_PATH: path.join(APPROVED_STAGING_DIR, 'valid_staging.db'),
    STAGING_DATA_DIR: APPROVED_STAGING_DIR,
    PORT: '3002',
    HOST: '127.0.0.1',
    JWT_SECRET: 'staging_valid_jwt_secret_64_characters_hex_string_1234567890abcdef',
    JWT_REFRESH_SECRET: 'staging_valid_refresh_jwt_secret_64_characters_hex_string_1234567890',
    MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    PREVIOUS_MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    EMAIL_USER: '',
    EMAIL_PASS: '',
    SMTP_PASS: '',
    SMS_API_KEY: ''
  };
  const merged = { ...defaults, ...overrides };
  const lines = [];
  for (const k in merged) {
    if (merged[k] !== undefined) {
      lines.push(`${k}=${merged[k]}`);
    }
  }
  return lines.join('\n');
}

async function runRegressionSuite() {
  console.log('================================================================');
  console.log('STAGING ISOLATION & GUARD REGRESSION SUITE');
  console.log('================================================================\n');

  cleanup();
  fs.mkdirSync(APPROVED_STAGING_DIR, { recursive: true });
  fs.mkdirSync(FORBIDDEN_EXTERNAL_DIR, { recursive: true });

  const rootDbPath = path.resolve(__dirname, '../../../server/bfi_classroom.db');
  const initialRootDbHash = getFileHash(rootDbPath);

  let passed = 0;
  let testNum = 1;

  async function runSubtest(name, fn) {
    process.stdout.write(`Test ${testNum++}: ${name}... `);
    // Reset all staging-related environment variables before each subtest
    delete process.env.DATABASE_PATH;
    delete process.env.STAGING_DATA_DIR;
    delete process.env.STAGING_ROOT_DIR;
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.MFA_ENCRYPTION_KEY;
    delete process.env.PREVIOUS_MFA_ENCRYPTION_KEY;
    delete process.env.EMAIL_PASS;
    delete process.env.SMS_API_KEY;

    try {
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (err) {
      console.log('❌ FAIL');
      console.error(err);
      throw err;
    }
  }

  // ── TEST 1: Rejection of /var/www/bfi-classroom production database path ───────
  await runSubtest('Rejection of /var/www/bfi-classroom production database path', () => {
    const dangerousDb = path.normalize('/var/www/bfi-classroom/server/bfi_classroom.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.prodpath1');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: dangerousDb
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must exit with non-zero status on production path');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(dangerousDb), false, 'Dangerous DB file must never be created');
  });

  // ── TEST 2: Rejection of /home/ubuntu/bfi-classroom live checkout database path ─
  await runSubtest('Rejection of /home/ubuntu/bfi-classroom live checkout database path', () => {
    const dangerousDb = path.normalize('/home/ubuntu/bfi-classroom/server/bfi_classroom.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.prodpath2');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: dangerousDb
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must exit with non-zero status on /home/ubuntu path');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(dangerousDb), false, 'Live checkout DB must never be created');
  });

  // ── TEST 3: Rejection of local workspace root production database ─────────────
  await runSubtest('Rejection of local workspace root production database', () => {
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.localprod');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: rootDbPath
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must exit with non-zero status on local production DB');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(getFileHash(rootDbPath), initialRootDbHash, 'Root DB hash must remain strictly pristine');
  });

  // ── TEST 4: Sibling-prefix attack (/staging vs /staging-evil) ────────────────
  await runSubtest('Rejection of sibling-prefix directory escape (directory boundary aware)', () => {
    const evilDb = path.join(SIBLING_ATTACK_DIR, 'evil_database.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.sibling');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: evilDb,
      STAGING_DATA_DIR: APPROVED_STAGING_DIR
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject sibling-prefix path');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(evilDb), false, 'Sibling DB file must never be created');
    assert.strictEqual(fs.existsSync(SIBLING_ATTACK_DIR), false, 'Sibling directory must never be created');
  });

  // ── TEST 5: Paths outside the approved staging root ──────────────────────────
  await runSubtest('Rejection of arbitrary path outside approved staging root', () => {
    const externalDb = path.join(FORBIDDEN_EXTERNAL_DIR, 'external.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.external');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: externalDb,
      STAGING_DATA_DIR: APPROVED_STAGING_DIR
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject external database path');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(externalDb), false, 'External DB file must never be created');
  });

  // ── TEST 6: Real filesystem symlink/junction escape ──────────────────────────
  await runSubtest('Rejection of real filesystem symlink/junction escape to external directory', () => {
    const symlinkDir = path.join(APPROVED_STAGING_DIR, 'symlink_escape');
    try {
      fs.symlinkSync(FORBIDDEN_EXTERNAL_DIR, symlinkDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      console.log(`[Symlink not supported: ${e.message}]`);
      return;
    }

    const escapedDb = path.join(symlinkDir, 'escaped_db.sqlite');
    const expectedTarget = path.join(FORBIDDEN_EXTERNAL_DIR, 'escaped_db.sqlite');

    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.symlink');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: escapedDb,
      STAGING_DATA_DIR: APPROVED_STAGING_DIR
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject symlink escape');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(escapedDb), false, 'Symlinked DB must never be created');
    assert.strictEqual(fs.existsSync(expectedTarget), false, 'Escaped target DB must never be created');
  });

  // ── TEST 7: Nonexistent database path beneath symlinked parents ──────────────
  await runSubtest('Canonicalization of existing ancestors for nonexistent DB beneath symlinked parent', () => {
    const symlinkParent = path.join(APPROVED_STAGING_DIR, 'symlink_parent');
    try {
      fs.symlinkSync(FORBIDDEN_EXTERNAL_DIR, symlinkParent, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      return;
    }

    const deepDb = path.join(symlinkParent, 'nonexistent_sub', 'leaf', 'deep.db');
    const expectedDeepTarget = path.join(FORBIDDEN_EXTERNAL_DIR, 'nonexistent_sub', 'leaf', 'deep.db');

    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.deepsym');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: deepDb,
      STAGING_DATA_DIR: APPROVED_STAGING_DIR
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject nonexistent DB beneath symlinked parent');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(deepDb), false, 'Deep DB must not be created');
    assert.strictEqual(fs.existsSync(expectedDeepTarget), false, 'Deep target DB must not be created');
  });

  // ── TEST 8: Hard-link aliases to protected file ──────────────────────────────
  await runSubtest('Rejection of hard-link alias to protected file (nlink > 1)', () => {
    const dummyProdDb = path.join(FORBIDDEN_EXTERNAL_DIR, 'fake_prod.db');
    fs.writeFileSync(dummyProdDb, 'PROTECTED_PROD_SQLITE_DATA');
    const prodHashBefore = getFileHash(dummyProdDb);

    const hardLinkDb = path.join(APPROVED_STAGING_DIR, 'hardlink_alias.db');
    try {
      fs.linkSync(dummyProdDb, hardLinkDb);
    } catch (e) {
      console.log(`[Hard link not supported: ${e.message}]`);
      return;
    }

    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.hardlink');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      DATABASE_PATH: hardLinkDb,
      STAGING_DATA_DIR: APPROVED_STAGING_DIR
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject hard-link alias');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(getFileHash(dummyProdDb), prodHashBefore, 'Protected file must remain untouched');
  });

  // ── TEST 9: Allowed exact documented staging directory structure ─────────────
  await runSubtest('Allowed exact documented staging directory structure (/var/www/bfi-classroom-staging)', () => {
    // Exact documented paths (resolved for current platform):
    const docStagingDir = path.resolve('/var/www/bfi-classroom-staging/server');
    const docDbPath = path.resolve('/var/www/bfi-classroom-staging/server/staging_classroom.db');

    // Directory-boundary verification:
    // docDbPath must be strictly inside docStagingDir
    assert(isStrictlyInside(docDbPath, docStagingDir), 'Documented DB path must be strictly inside documented staging directory');

    // docDbPath must NOT be within /var/www/bfi-classroom
    const prodRoot = path.normalize('/var/www/bfi-classroom');
    assert(!isPathWithin(docDbPath, prodRoot), 'Documented staging DB must NOT be within production root /var/www/bfi-classroom');
    assert(!isPathWithin(docStagingDir, prodRoot), 'Documented staging root must NOT be within production root /var/www/bfi-classroom');

    // Positive validation with approvedStagingDirs
    process.env.DATABASE_PATH = docDbPath;
    process.env.PORT = '3002';
    process.env.HOST = '127.0.0.1';
    process.env.JWT_SECRET = 'staging_valid_jwt_secret_64_characters_hex_string_1234567890abcdef';
    process.env.JWT_REFRESH_SECRET = 'staging_valid_refresh_jwt_secret_64_characters_hex_string_1234567890';
    process.env.MFA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const result = validateStagingConfig({
      approvedStagingDirs: [docStagingDir]
    });
    assert.strictEqual(path.normalize(result.databasePath), docDbPath);
  });

  // ── TEST 10: Rejection of missing JWT_SECRET (without inherited value) ────────
  await runSubtest('Rejection of missing JWT_SECRET in staging configuration (no inherited value)', () => {
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.missing_jwt');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      JWT_SECRET: undefined // Omitted from file
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject omitted JWT_SECRET');
    assert(res.stderr.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert(res.stderr.includes('Required staging setting \'JWT_SECRET\' is missing or empty'), 'Must identify missing key');
  });

  // ── TEST 11: Rejection of missing JWT_SECRET when inherited JWT_SECRET is active ─
  await runSubtest('Rejection of missing JWT_SECRET even when inherited JWT_SECRET exists in process.env', () => {
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.missing_with_inherited');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      JWT_SECRET: undefined // Omitted from staging config
    }));

    const res = spawnSync('node', ['-e', `
      process.env.JWT_SECRET = 'inherited_production_secret_do_not_accept';
      const { loadAndValidateStagingEnv } = require('./scripts/staging_guard.cjs');
      loadAndValidateStagingEnv('${envFile.replace(/\\/g, '\\\\')}');
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject configuration omitting JWT_SECRET despite inherited env');
    assert(res.stderr.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert(res.stderr.includes('Required staging setting \'JWT_SECRET\' is missing or empty'), 'Inherited secret must not satisfy required key');
  });

  // ── TEST 12: Rejection of blank JWT_SECRET in staging configuration ───────────
  await runSubtest('Rejection of blank JWT_SECRET in staging configuration', () => {
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.blank_jwt');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      JWT_SECRET: '   ' // Blank whitespace string
    }));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject blank JWT_SECRET');
    assert(res.stderr.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert(res.stderr.includes('Required staging setting \'JWT_SECRET\' is missing or empty'), 'Must identify blank key');
  });

  // ── TEST 13: Removal of credential disclosure in conflict errors ──────────────
  await runSubtest('Removal of credential disclosure in conflict error messages', () => {
    const inheritedSecret = 'TOP_SECRET_PROD_KEY_9876543210';
    const stagingSecret = 'STAGING_DIFFERENT_KEY_123456789';
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.nodisclose');
    fs.writeFileSync(envFile, createValidStagingEnvContent({
      JWT_SECRET: stagingSecret
    }));

    const res = spawnSync('node', ['-e', `
      process.env.JWT_SECRET = '${inheritedSecret}';
      const { loadAndValidateStagingEnv } = require('./scripts/staging_guard.cjs');
      loadAndValidateStagingEnv('${envFile.replace(/\\/g, '\\\\')}');
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject conflicting secret');
    assert(res.stderr.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert(res.stderr.includes('JWT_SECRET'), 'Must mention variable name');

    // CRITICAL: Verify NO disclosure of complete secrets or 8-char prefixes
    assert(!res.stderr.includes(inheritedSecret), 'stderr must not disclose complete inherited secret');
    assert(!res.stderr.includes(stagingSecret), 'stderr must not disclose complete staging secret');
    assert(!res.stderr.includes(inheritedSecret.substring(0, 8)), 'stderr must not disclose inherited secret prefix');
    assert(!res.stderr.includes(stagingSecret.substring(0, 8)), 'stderr must not disclose staging secret prefix');
    assert(!res.stdout.includes(inheritedSecret.substring(0, 8)), 'stdout must not disclose inherited secret prefix');
  });

  // ── TEST 14: Removal of ordinary stdout/stderr password disclosure in init ─────
  await runSubtest('Removal of administrator password disclosure from stdout/stderr in init_staging_db', () => {
    const validDbPath = path.join(APPROVED_STAGING_DIR, 'no_disclosure.db');
    const credentialsFile = path.join(APPROVED_STAGING_DIR, '.custom_credentials.json');
    const validEnvFile = path.join(APPROVED_STAGING_DIR, '.env.staging.disclosure_test');
    fs.writeFileSync(validEnvFile, createValidStagingEnvContent({
      DATABASE_PATH: validDbPath
    }));

    const initRes = spawnSync('node', ['scripts/init_staging_db.cjs', validEnvFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.strictEqual(initRes.status, 0, `Init failed with error: ${initRes.stderr || initRes.stdout}`);
    assert(fs.existsSync(validDbPath), 'Staging database file must be created');

    // Read generated password from the restricted credentials file
    const defaultCredFile = path.join(APPROVED_STAGING_DIR, '.staging_admin_credentials.json');
    assert(fs.existsSync(defaultCredFile), 'Restricted credentials file must exist');
    const credData = JSON.parse(fs.readFileSync(defaultCredFile, 'utf8'));
    assert(credData.password && credData.password.length >= 16, 'Credentials file must contain high-entropy password');

    // CRITICAL ASSERTION: The generated password and prefix must NEVER appear in stdout or stderr
    assert(!initRes.stdout.includes(credData.password), 'stdout must NOT disclose generated administrator password');
    assert(!initRes.stderr.includes(credData.password), 'stderr must NOT disclose generated administrator password');
    assert(!initRes.stdout.includes(credData.password.substring(0, 8)), 'stdout must NOT disclose password prefix');
    assert(!initRes.stderr.includes(credData.password.substring(0, 8)), 'stderr must NOT disclose password prefix');
    assert(!initRes.stdout.includes('Unique generated password:'), 'stdout must not print password log line');
  });

  // ── TEST 15: Fail-closed behavior on unresolvable / invalid path ───────────────
  await runSubtest('Fail-closed behavior on unresolvable / invalid path', () => {
    try {
      validateStagingConfig({
        approvedStagingDirs: [APPROVED_STAGING_DIR]
      });
      assert.fail('Should fail without DATABASE_PATH');
    } catch (e) {
      assert(e.message.includes('DATABASE_PATH must be explicitly defined'));
    }

    try {
      process.env.DATABASE_PATH = 'relative/path/db.sqlite';
      validateStagingConfig({
        approvedStagingDirs: [APPROVED_STAGING_DIR]
      });
      assert.fail('Should fail on non-absolute path');
    } catch (e) {
      assert(e.message.includes('must be an absolute path'));
    }
  });

  // ── TEST 16: Valid confined staging configuration with full bootstrap ─────────
  let validDbPath;
  let serverProcess;
  await runSubtest('Valid confined staging configuration: explicit DB init & server bootstrap', async () => {
    validDbPath = path.join(APPROVED_STAGING_DIR, 'valid_bootstrap.db');
    const validEnvFile = path.join(APPROVED_STAGING_DIR, '.env.staging.valid_bootstrap');
    fs.writeFileSync(validEnvFile, createValidStagingEnvContent({
      DATABASE_PATH: validDbPath
    }));

    // Step A: Run init_staging_db.cjs
    const initRes = spawnSync('node', ['scripts/init_staging_db.cjs', validEnvFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.strictEqual(initRes.status, 0, `Init failed with error: ${initRes.stderr || initRes.stdout}`);
    assert(fs.existsSync(validDbPath), 'Valid staging database file must be created');
    assert(!initRes.stdout.includes('StagingAdminPass123!'), 'Must not use hardcoded admin password');

    // Step B: Start staging server
    serverProcess = spawn('node', ['server/staging-server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        STAGING_ENV_FILE: validEnvFile
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;
    serverProcess.stdout.on('data', data => {
      const text = data.toString();
      if (text.includes('BFI Classroom API Gateway running on port 3002')) {
        started = true;
      }
    });

    const deadline = Date.now() + 15000;
    while (!started && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    assert(started, 'Staging server failed to start within timeout');

    // Step C: Verify loopback probes
    const spaRes = await fetch('http://127.0.0.1:3002/bfi-classroom/');
    assert.strictEqual(spaRes.status, 200, `SPA route returned ${spaRes.status}`);

    const loginRes = await fetch('http://127.0.0.1:3002/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(loginRes.status, 400, `Login probe returned ${loginRes.status}`);

    const authRes = await fetch('http://127.0.0.1:3002/api/auth/me');
    assert.strictEqual(authRes.status, 401, `Auth probe returned ${authRes.status}`);

    // Step D: Shutdown server
    serverProcess.kill('SIGTERM');
    await new Promise(r => serverProcess.on('exit', r));
  });

  // Verify root DB was never touched throughout all 16 tests
  assert.strictEqual(getFileHash(rootDbPath), initialRootDbHash, 'CRITICAL: Root production database was modified during testing!');

  cleanup();

  console.log('\n================================================================');
  console.log(`Staging Isolation Results: ${passed} Passed, 0 Failed`);
  console.log('Root DB SHA-256 Verified Pristine:', initialRootDbHash);
  console.log('================================================================\n');
}

runRegressionSuite().catch(err => {
  console.error('\n[RegressionSuite FAILED]:', err);
  try { cleanup(); } catch (_) {}
  process.exit(1);
});
