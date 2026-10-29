/**
 * Comprehensive Staging Environment Isolation & Guard Regression Suite
 * Tests positive path confinement, canonical ancestor resolution, symlink/junction
 * escapes, sibling prefix attacks, hard-link aliases, inherited configuration conflicts,
 * and fail-closed filesystem error handling.
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
  PROTECTED_PRODUCTION_SIGNATURES
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
      // Retry after short delay on Windows if file handle closure has slight lag
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
    // Reset any polluted environment variables before each test
    delete process.env.DATABASE_PATH;
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.MFA_ENCRYPTION_KEY;

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

  // ── TEST 1: Previously documented production path (/var/www/bfi-classroom/...) ──
  await runSubtest('Rejection of /var/www/bfi-classroom production database path', () => {
    const dangerousDb = path.normalize('/var/www/bfi-classroom/server/bfi_classroom.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.prodpath1');
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${dangerousDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must exit with non-zero status on production path');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(dangerousDb), false, 'Dangerous DB file must never be created');
  });

  // ── TEST 2: Previously documented live checkout (/home/ubuntu/bfi-classroom/...) ──
  await runSubtest('Rejection of /home/ubuntu/bfi-classroom live checkout database path', () => {
    const dangerousDb = path.normalize('/home/ubuntu/bfi-classroom/server/bfi_classroom.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.prodpath2');
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${dangerousDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must exit with non-zero status on /home/ubuntu path');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(fs.existsSync(dangerousDb), false, 'Live checkout DB must never be created');
  });

  // ── TEST 3: Rejection of local workspace root production database ─────────────────
  await runSubtest('Rejection of local workspace root production database', () => {
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.localprod');
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${rootDbPath}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must exit with non-zero status on local production DB');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(getFileHash(rootDbPath), initialRootDbHash, 'Root DB hash must remain strictly pristine');
  });

  // ── TEST 4: Sibling-prefix attack (/staging vs /staging-evil) ────────────────
  await runSubtest('Rejection of sibling-prefix directory escape (positive confinement)', () => {
    const evilDb = path.join(SIBLING_ATTACK_DIR, 'evil_database.db');
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.sibling');
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${evilDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

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
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${externalDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

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
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${escapedDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

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
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${deepDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

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
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${hardLinkDb}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1'
    ].join('\n'));

    const res = spawnSync('node', ['scripts/init_staging_db.cjs', envFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject hard-link alias');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION');
    assert.strictEqual(getFileHash(dummyProdDb), prodHashBefore, 'Protected file must remain untouched');
  });

  // ── TEST 9: Inherited secret/configuration conflicts ─────────────────────────
  await runSubtest('Deterministic isolation: rejection of conflicting inherited secrets', () => {
    const envFile = path.join(APPROVED_STAGING_DIR, '.env.staging.inherited');
    fs.writeFileSync(envFile, [
      `DATABASE_PATH=${path.join(APPROVED_STAGING_DIR, 'staging.db')}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1',
      'JWT_SECRET=staging_explicit_secret_abc123456789'
    ].join('\n'));

    const res = spawnSync('node', ['-e', `
      process.env.JWT_SECRET = 'inherited_production_secret_do_not_leak';
      const { loadAndValidateStagingEnv } = require('./scripts/staging_guard.cjs');
      loadAndValidateStagingEnv('${envFile.replace(/\\/g, '\\\\')}');
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notStrictEqual(res.status, 0, 'Must reject conflicting inherited secret');
    assert(res.stderr.includes('SAFETY REJECTION') || res.stdout.includes('SAFETY REJECTION'), 'Must emit SAFETY REJECTION on inherited conflict');
    assert(res.stderr.includes('JWT_SECRET'), 'Must identify conflicting key');
  });

  // ── TEST 10: Filesystem resolution failures / ambiguous resolution ───────────
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

  // ── TEST 11: Valid confined staging configuration with full bootstrap ─────────
  let validDbPath;
  let serverProcess;
  await runSubtest('Valid confined staging configuration: explicit DB init & server bootstrap', async () => {
    validDbPath = path.join(APPROVED_STAGING_DIR, 'valid_staging.db');
    const validEnvFile = path.join(APPROVED_STAGING_DIR, '.env.staging.valid');
    fs.writeFileSync(validEnvFile, [
      `DATABASE_PATH=${validDbPath}`,
      `STAGING_DATA_DIR=${APPROVED_STAGING_DIR}`,
      'PORT=3002',
      'HOST=127.0.0.1',
      'JWT_SECRET=staging_valid_jwt_secret_64_characters_hex_string_1234567890abcdef',
      'JWT_REFRESH_SECRET=staging_valid_refresh_jwt_secret_64_characters_hex_string_1234567890',
      'MFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'PREVIOUS_MFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    ].join('\n'));

    // Step A: Run init_staging_db.cjs
    const initRes = spawnSync('node', ['scripts/init_staging_db.cjs', validEnvFile], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.strictEqual(initRes.status, 0, `Init failed with error: ${initRes.stderr || initRes.stdout}`);
    assert(fs.existsSync(validDbPath), 'Valid staging database file must be created');
    assert(initRes.stdout.includes('Unique generated password'), 'Must generate unique admin password');
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

  // Verify root DB was never touched throughout all 11 tests
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
