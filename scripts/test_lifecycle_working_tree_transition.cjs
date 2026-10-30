#!/usr/bin/env node
/**
 * scripts/test_lifecycle_working_tree_transition.cjs
 *
 * Comprehensive Real-Git Lifecycle Test Suite for Working-Tree Reconciliation,
 * Effective Configuration Preservation, and Emergency Rollback Protection.
 *
 * Directly executes the canonical `executeDeployment` and `executeRollback` functions
 * from `scripts/production_lifecycle.cjs` against disposable Git repositories using
 * REAL Git operations (`git status`, `git checkout`, `git rev-parse`, `git show`).
 *
 * Mocks ONLY external services (systemctl, pm2, ss, pgrep, lsof, curl, npm) while
 * preserving real file system, SQLite, and Git behavior.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');
const Database = require('better-sqlite3');
const { executeDeployment, executeRollback } = require('./production_lifecycle.cjs');

const TEST_BASE_DIR = path.resolve(__dirname, '..', 'test_git_lifecycle_env');

let passedAssertions = 0;
let totalAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedAssertions++;
  console.log(`✅ [PASS] ${message}`);
}

function cleanupTestDir() {
  if (fs.existsSync(TEST_BASE_DIR)) {
    try {
      fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Creates a disposable real Git repository with two distinct revisions:
 * - Commit 1 (c1Rev): Historical commit tracking .env and package-lock.json v1.0.0
 * - Commit 2 (c2Rev): Target release commit untracking .env (added to .gitignore) and package-lock.json v2.0.0
 */
function createDisposableGitRepo() {
  cleanupTestDir();
  fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_BASE_DIR, 'server'), { recursive: true });
  fs.mkdirSync(path.join(TEST_BASE_DIR, 'server', 'backups'), { recursive: true });
  fs.mkdirSync(path.join(TEST_BASE_DIR, 'server', 'db', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(TEST_BASE_DIR, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(TEST_BASE_DIR, 'dist'), { recursive: true });

  const runGit = (args) => {
    const res = child_process.spawnSync('git', args, { cwd: TEST_BASE_DIR, encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`Git command failed: git ${args.join(' ')}\n${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  };

  runGit(['init', '-b', 'main']);
  runGit(['config', 'user.name', 'Lifecycle Tester']);
  runGit(['config', 'user.email', 'tester@bfi.test']);

  // Copy canonical operational scripts into repo
  const rootScripts = path.resolve(__dirname, '..', 'scripts');
  const required = [
    'preflight_lockdown_check.cjs',
    'verify_isolation.cjs',
    'run_migrations.cjs',
    'production_smoke_check.cjs',
    'production_lifecycle.cjs',
    'obtain_smoke_credentials.cjs',
    'rotate_mfa_secrets.cjs'
  ];
  for (const s of required) {
    const src = path.join(rootScripts, s);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(TEST_BASE_DIR, 'scripts', s));
    }
  }

  // Copy migrations into repo
  const rootMigrations = path.resolve(__dirname, '..', 'server', 'db', 'migrations');
  if (fs.existsSync(rootMigrations)) {
    fs.cpSync(rootMigrations, path.join(TEST_BASE_DIR, 'server', 'db', 'migrations'), { recursive: true });
  }

  // Frontend build artifacts
  fs.writeFileSync(path.join(TEST_BASE_DIR, 'dist', 'index.html'), '<!DOCTYPE html><html><body>Root</body></html>');
  fs.writeFileSync(path.join(TEST_BASE_DIR, 'dist', '404.html'), '<!DOCTYPE html><html><body>404</body></html>');

  // Minimal package.json and ecosystem.config.cjs
  fs.writeFileSync(path.join(TEST_BASE_DIR, 'package.json'), JSON.stringify({ name: 'bfi-classroom', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(TEST_BASE_DIR, 'ecosystem.config.cjs'), 'module.exports = { apps: [{ name: "bfi-classroom" }] };');

  // Commit 1: Historical baseline tracking .env and package-lock.json
  fs.writeFileSync(path.join(TEST_BASE_DIR, '.env'), 'SECRET_TYPE=historical_tracked_template\nJWT_SECRET=old_historical_key\n');
  fs.writeFileSync(path.join(TEST_BASE_DIR, 'package-lock.json'), JSON.stringify({ name: 'bfi-classroom', lockfileVersion: 3, version: '1.0.0' }));
  runGit(['add', '.']);
  runGit(['commit', '-m', 'commit 1: historical baseline tracking .env']);
  const c1Rev = runGit(['rev-parse', 'HEAD']);

  // Commit 2: Release candidate untracking .env (added to .gitignore) and updated lockfile
  fs.unlinkSync(path.join(TEST_BASE_DIR, '.env'));
  fs.writeFileSync(path.join(TEST_BASE_DIR, '.gitignore'), ".env\n*.bak\n*.env.tmp\nnode_modules\n");
  fs.writeFileSync(path.join(TEST_BASE_DIR, 'package-lock.json'), JSON.stringify({ name: 'bfi-classroom', lockfileVersion: 3, version: '2.0.0' }));
  runGit(['add', '.']);
  runGit(['commit', '-m', 'commit 2: release candidate untracks .env and updates lockfile']);
  const c2Rev = runGit(['rev-parse', 'HEAD']);

  // Checkout back to c1Rev
  runGit(['checkout', c1Rev]);

  // Seed baseline SQLite database matching true pre-upgrade schema
  const dbPath = path.join(TEST_BASE_DIR, 'server', 'bfi_classroom.db');
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
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE student_course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      course_id INTEGER,
      enrolled_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_number TEXT,
      course_id INTEGER,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE batch_course_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER,
      amount NUMERIC
    );

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

    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin)
    VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash1', 'admin', 'Abir', 'Ahmad', 0),
           (7, 'admin2', 'admin2@bfi.com', 'hash2', 'admin', 'Admin', 'Two', 0);
    INSERT INTO student_course_enrollments (id, user_id, course_id) VALUES (1, 10, 1), (2, 11, 1), (3, 12, 2);
    INSERT INTO batches (id, batch_number, course_id) VALUES (1, 'B-01', 1), (2, 'B-02', 2);
    INSERT INTO batch_course_fees (id, batch_id, amount) VALUES (1, 1, 5000), (2, 2, 6000);
  `);
  db.close();

  return { rootDir: TEST_BASE_DIR, dbPath, c1Rev, c2Rev, runGit };
}

/**
 * Creates a spawner that executes REAL git commands while mocking external service operations.
 */
function createRealGitSpawner(options = {}) {
  const executedCommands = [];
  let nginxActive = options.initialNginxActive !== undefined ? options.initialNginxActive : true;
  let pm2Status = options.initialPm2Status || 'online';

  const spawner = (cmd, args = [], spawnOpts = {}) => {
    const cmdStr = `${cmd} ${args.join(' ')}`.trim();
    executedCommands.push({ cmd, args, cmdStr });

    // REAL GIT EXECUTION
    if (cmd === 'git') {
      if (options.failGitStatus && args[0] === 'status') {
        return { status: 1, stdout: '', stderr: 'fatal: git status internal failure: index locked', error: null };
      }
      return child_process.spawnSync('git', args, spawnOpts);
    }

    // SERVICE MOCK: sudo systemctl
    if (cmd === 'sudo' && args[0] === 'systemctl') {
      if (args[1] === 'stop' && args[2] === 'nginx') {
        nginxActive = false;
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (args[1] === 'start' && args[2] === 'nginx') {
        nginxActive = true;
        return { status: 0, stdout: '', stderr: '', error: null };
      }
    }

    // SERVICE MOCK: systemctl is-active
    if (cmd === 'systemctl') {
      if (args[0] === 'is-active' && args[1] === 'nginx') {
        return { status: nginxActive ? 0 : 3, stdout: nginxActive ? 'active\n' : 'inactive\n', stderr: '', error: null };
      }
    }

    // SERVICE MOCK: pgrep
    if (cmd === 'pgrep') {
      if (args.includes('nginx')) {
        return { status: nginxActive ? 0 : 1, stdout: nginxActive ? '1234\n' : '', stderr: '', error: null };
      }
    }

    // SERVICE MOCK: ss socket inspection
    if (cmd === 'ss') {
      if (args.includes('( sport = :80 or sport = :443 )')) {
        return { status: 0, stdout: nginxActive ? 'tcp LISTEN 0 511 0.0.0.0:80 *:*\n' : '', stderr: '', error: null };
      }
      if (args.includes('state established')) {
        return { status: 0, stdout: '', stderr: '', error: null };
      }
      if (args.includes('( sport = :3001 )')) {
        return { status: 0, stdout: pm2Status === 'online' ? 'tcp LISTEN 0 511 *:3001 *:*\n' : '', stderr: '', error: null };
      }
    }

    // SERVICE MOCK: pm2
    if (cmd === 'pm2') {
      if (args[0] === 'stop') {
        pm2Status = 'stopped';
        return { status: 0, stdout: '[PM2] Stopped bfi-classroom\n', stderr: '', error: null };
      }
      if (args[0] === 'start') {
        pm2Status = 'online';
        return { status: 0, stdout: '[PM2] Started bfi-classroom\n', stderr: '', error: null };
      }
      if (args[0] === 'jlist') {
        const list = [{ name: 'bfi-classroom', pid: 12345, pm2_env: { status: pm2Status } }];
        return { status: 0, stdout: JSON.stringify(list), stderr: '', error: null };
      }
    }

    // SERVICE MOCK: lsof
    if (cmd === 'lsof') {
      if (args[0] === '-v') return { status: 0, stdout: 'lsof version 4.93\n', stderr: '', error: null };
      return { status: 1, stdout: '', stderr: '', error: null };
    }

    // BUILD MOCK: npm
    if (cmd === 'npm') {
      return { status: 0, stdout: 'npm command completed successfully\n', stderr: '', error: null };
    }

    // NETWORK MOCK: curl
    if (cmd === 'curl') {
      return { status: 0, stdout: 'HTTP/1.1 200 OK\n', stderr: '', error: null };
    }

    // Pass through to Node child processes for migrations and smoke verification
    if (cmd === process.execPath || cmd === 'node') {
      if (options.failMigrations && args[0] && args[0].includes('run_migrations.cjs')) {
        return { status: 1, stdout: '', stderr: 'Simulated migration fatal error: column constraint failure', error: null };
      }
      if (options.failSmokeCheck && args[0] && args[0].includes('production_smoke_check.cjs')) {
        return { status: 1, stdout: '', stderr: 'Simulated smoke check fatal error: Tier 4b RBAC validation failure', error: null };
      }
      if (args[0] && args[0].includes('production_smoke_check.cjs')) {
        return {
          status: 0,
          stdout: '✅ PRODUCTION SMOKE VERIFICATION PASSED: 18/18 assertions verified.\n   All required tiers passed.\n   Deployment gate cleared.\n',
          stderr: '',
          error: null
        };
      }
      return child_process.spawnSync(cmd, args, spawnOpts);
    }

    return { status: 0, stdout: '', stderr: '', error: null };
  };

  return { spawner, executedCommands, getNginxActive: () => nginxActive, getPm2Status: () => pm2Status };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('REAL-GIT LIFECYCLE TEST SUITE: WORKING-TREE TRANSITION & ROLLBACK');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR 1: Happy Path Working-Tree Transition & Target Release Checkout
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- VECTOR 1: Happy Path Deployment with Modified .env and Lockfile Drift ---');
  {
    const env = createDisposableGitRepo();
    const liveEnvContent = 'NODE_ENV=production\nPORT=3001\nJWT_SECRET=super_secret_live_token_key_12345\nJWT_REFRESH_SECRET=refresh_live_token_key_67890\nMFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n';
    fs.writeFileSync(path.join(env.rootDir, '.env'), liveEnvContent);
    const preEnvHash = crypto.createHash('sha256').update(liveEnvContent).digest('hex');

    // Introduce dirty tracked package-lock.json drift
    const dirtyLockfile = JSON.stringify({ name: 'bfi-classroom', lockfileVersion: 3, version: '1.0.0-dirty-drift' });
    fs.writeFileSync(path.join(env.rootDir, 'package-lock.json'), dirtyLockfile);

    // Verify git status before deployment shows both modified
    const preStatus = env.runGit(['status', '--porcelain', '-uno']);
    assert(preStatus.includes('.env') && preStatus.includes('package-lock.json'), 'Vector 1: Pre-deployment working tree has modified .env and package-lock.json');

    const adapter = createRealGitSpawner();
    const deployRes = await executeDeployment({
      rootDir: env.rootDir,
      targetCommit: env.c2Rev,
      spawner: adapter.spawner,
      isRehearsal: true,
      skipGitInspection: false
    });

    assert(deployRes && deployRes.success === true, 'Vector 1: executeDeployment completes with success=true');

    // Verify target checkout reached c2Rev via real git
    const postHead = env.runGit(['rev-parse', 'HEAD']);
    assert(postHead.toLowerCase() === env.c2Rev.toLowerCase(), 'Vector 1: Real git HEAD successfully switched to target release revision');

    // Verify live .env was restored from attempt-bound backup
    assert(fs.existsSync(path.join(env.rootDir, '.env')), 'Vector 1: Live .env exists at target checkout');
    const postEnvContent = fs.readFileSync(path.join(env.rootDir, '.env'), 'utf8');
    const postEnvHash = crypto.createHash('sha256').update(postEnvContent).digest('hex');
    assert(postEnvHash === preEnvHash, 'Vector 1: Live .env matches pre-shutdown configuration bit-for-bit');

    // Verify working tree cleanliness on target commit
    const postStatus = env.runGit(['status', '--porcelain', '-uno']);
    assert(postStatus.trim() === '', 'Vector 1: Working tree is clean on target commit (0 modified tracked files)');

    // Verify lockfile on target commit matches target release commit (v2.0.0)
    const postLock = JSON.parse(fs.readFileSync(path.join(env.rootDir, 'package-lock.json'), 'utf8'));
    assert(postLock.version === '2.0.0', 'Vector 1: Target package-lock.json matches target committed revision (v2.0.0)');

    // Verify attempt-bound backup existence and hash
    const backupDir = path.join(env.rootDir, 'server', 'backups');
    const backupFiles = fs.readdirSync(backupDir);
    const envBackup = backupFiles.find(f => f.startsWith(`env_pre_reconciliation_${deployRes.attemptId}`));
    assert(Boolean(envBackup), `Vector 1: Attempt-bound backup exists in backups dir (${envBackup})`);
    const backupContent = fs.readFileSync(path.join(backupDir, envBackup), 'utf8');
    assert(crypto.createHash('sha256').update(backupContent).digest('hex') === preEnvHash, 'Vector 1: Attempt-bound backup SHA-256 matches pre-deployment hash');

    // Verify maintenance isolation order: Phase 0 inspection and backup occurred BEFORE stopping Nginx/PM2
    const stopNginxIdx = adapter.executedCommands.findIndex(c => c.cmdStr.includes('systemctl stop nginx'));
    const gitStatusIdx = adapter.executedCommands.findIndex(c => c.cmdStr.includes('git status --porcelain -uno'));
    assert(gitStatusIdx !== -1 && stopNginxIdx !== -1 && gitStatusIdx < stopNginxIdx, 'Vector 1: Working-tree inspection strictly precedes service shutdown');

    // Verify traffic reopened
    const state = JSON.parse(fs.readFileSync(path.join(env.rootDir, 'server', 'active_deployment_state.json'), 'utf8'));
    assert(state.trafficReopened === true && state.trafficMayReopen === true, 'Vector 1: Traffic reopening state recorded successfully');
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR 2: Fail Closed on Unapproved Tracked File Modifications Before Shutdown
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- VECTOR 2: Fail Closed on Unapproved Tracked File Modifications ---');
  {
    const env = createDisposableGitRepo();
    // Track an additional application file
    fs.writeFileSync(path.join(env.rootDir, 'server', 'server.js'), '// original server file\n');
    env.runGit(['add', 'server/server.js']);
    env.runGit(['commit', '-m', 'track server/server.js']);
    const c1Plus = env.runGit(['rev-parse', 'HEAD']);

    // Modify .env, package-lock.json, AND server/server.js
    fs.writeFileSync(path.join(env.rootDir, '.env'), 'SECRET=live\n');
    fs.writeFileSync(path.join(env.rootDir, 'package-lock.json'), '{"dirty":true}');
    fs.writeFileSync(path.join(env.rootDir, 'server', 'server.js'), '// unapproved dirty modification\n');

    const adapter = createRealGitSpawner();
    let caughtError = null;
    try {
      await executeDeployment({
        rootDir: env.rootDir,
        targetCommit: env.c2Rev,
        preDeploymentRevision: c1Plus,
        spawner: adapter.spawner,
        isRehearsal: true,
        skipGitInspection: false
      });
    } catch (err) {
      caughtError = err;
    }

    assert(Boolean(caughtError), 'Vector 2: executeDeployment throws on unapproved tracked file conflict');
    assert(caughtError.message.includes('server/server.js'), 'Vector 2: Error message explicitly identifies unapproved conflict');

    // Assert ZERO service disruption: systemctl stop nginx and pm2 stop were NEVER called!
    const stopNginx = adapter.executedCommands.find(c => c.cmdStr.includes('systemctl stop nginx'));
    const stopPm2 = adapter.executedCommands.find(c => c.cmdStr.includes('pm2 stop'));
    assert(!stopNginx && !stopPm2, 'Vector 2: ZERO service disruption: Nginx and PM2 were NEVER stopped');

    // Working tree remains untouched at c1Plus
    const currentHead = env.runGit(['rev-parse', 'HEAD']);
    assert(currentHead.toLowerCase() === c1Plus.toLowerCase(), 'Vector 2: Git checkout was not switched prematurely');
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR 3: Fail Closed on Git Status Inspection Failure Before Shutdown
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- VECTOR 3: Fail Closed on Git Status Inspection Failure ---');
  {
    const env = createDisposableGitRepo();
    fs.writeFileSync(path.join(env.rootDir, '.env'), 'SECRET=live\n');

    const adapter = createRealGitSpawner({ failGitStatus: true });
    let caughtError = null;
    try {
      await executeDeployment({
        rootDir: env.rootDir,
        targetCommit: env.c2Rev,
        spawner: adapter.spawner,
        isRehearsal: true,
        skipGitInspection: false
      });
    } catch (err) {
      caughtError = err;
    }

    assert(Boolean(caughtError), 'Vector 3: executeDeployment throws on git status failure');
    assert(caughtError.message.includes('Git status inspection failed'), 'Vector 3: Error indicates Git status inspection failure');

    // Assert ZERO service disruption
    const stopNginx = adapter.executedCommands.find(c => c.cmdStr.includes('systemctl stop nginx'));
    const stopPm2 = adapter.executedCommands.find(c => c.cmdStr.includes('pm2 stop'));
    assert(!stopNginx && !stopPm2, 'Vector 3: ZERO service disruption: Nginx and PM2 were NEVER stopped');
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR 4: Mid-Deployment Failure and Rollback with Working-Tree Protection
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- VECTOR 4: Mid-Deployment Failure and Emergency Rollback Protection ---');
  {
    const env = createDisposableGitRepo();
    const liveEnvContent = 'NODE_ENV=production\nPORT=3001\nJWT_SECRET=super_secret_live_token_key_12345\nJWT_REFRESH_SECRET=refresh_live_token_key_67890\nMFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n';
    fs.writeFileSync(path.join(env.rootDir, '.env'), liveEnvContent);
    const preEnvHash = crypto.createHash('sha256').update(liveEnvContent).digest('hex');

    // Fail deployment during Phase 5 smoke verification (after code checkout and migrations)
    const adapter = createRealGitSpawner({ failSmokeCheck: true });
    let deployError = null;
    try {
      await executeDeployment({
        rootDir: env.rootDir,
        targetCommit: env.c2Rev,
        spawner: adapter.spawner,
        isRehearsal: true,
        skipGitInspection: false
      });
    } catch (err) {
      deployError = err;
    }
    assert(Boolean(deployError), 'Vector 4: Deployment failed as expected during smoke check');

    // Confirm that at point of failure, checkout had reached c2Rev
    const failedHead = env.runGit(['rev-parse', 'HEAD']);
    assert(failedHead.toLowerCase() === env.c2Rev.toLowerCase(), 'Vector 4: Failure occurred while checked out to target revision');

    // Now execute canonical rollback
    const rollbackRes = await executeRollback({
      rootDir: env.rootDir,
      spawner: adapter.spawner,
      isRehearsal: true
    });

    assert(rollbackRes && rollbackRes.rollbackComplete === true, 'Vector 4: executeRollback completes with rollbackComplete=true');

    // Verify git restored HEAD to historical revision c1Rev
    const restoredHead = env.runGit(['rev-parse', 'HEAD']);
    assert(restoredHead.toLowerCase() === env.c1Rev.toLowerCase(), 'Vector 4: Rollback restored HEAD to historical revision c1Rev');

    // CRITICAL ASSERTION: In c1Rev, .env was tracked with template "SECRET_TYPE=historical_tracked_template".
    // If rollback did not safeguard .env before checkout, git would have clobbered .env with the template!
    // Assert that live .env was restored from the validated attempt backup and matches preEnvHash bit-for-bit!
    const restoredEnvContent = fs.readFileSync(path.join(env.rootDir, '.env'), 'utf8');
    const restoredEnvHash = crypto.createHash('sha256').update(restoredEnvContent).digest('hex');
    assert(restoredEnvHash === preEnvHash, 'Vector 4: Restored .env matches pre-deployment configuration bit-for-bit (not clobbered by git!)');
    assert(!restoredEnvContent.includes('SECRET_TYPE=historical_tracked_template'), 'Vector 4: Historical template was successfully prevented from clobbering runtime configuration');

    // Verify database was restored from validated backup
    assert(rollbackRes.databaseRestored === true, 'Vector 4: Database was restored from validated backup');
    const db = new Database(env.dbPath, { readonly: true });
    const qCheck = db.prepare('PRAGMA quick_check').get();
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    db.close();
    assert(qCheck.quick_check === 'ok' && fkCheck.length === 0, 'Vector 4: Restored database integrity verified (0 FK violations)');
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR 5: Post-Exposure Boundary Enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- VECTOR 5: Post-Exposure Boundary Enforcement ---');
  {
    const env = createDisposableGitRepo();
    // Simulate state where traffic has already been reopened
    const stateFilePath = path.join(env.rootDir, 'server', 'active_deployment_state.json');
    const state = {
      attemptId: 'deploy_test_exposed',
      backupFile: path.join(env.rootDir, 'server', 'backups', 'bfi_classroom_preflight_test.db'),
      backupValidated: true,
      envBackupFile: path.join(env.rootDir, 'server', 'backups', 'env_pre_reconciliation_deploy_test_exposed.env'),
      trafficMayReopen: true,
      trafficReopened: true,
      trafficReopenedAt: new Date().toISOString()
    };
    fs.writeFileSync(stateFilePath, JSON.stringify(state));
    fs.writeFileSync(path.join(env.rootDir, 'server', 'pre_deployment_revision.txt'), env.c1Rev + '\n');
    fs.writeFileSync(state.backupFile, 'dummy db');
    fs.writeFileSync(state.envBackupFile, 'dummy env');

    const adapter = createRealGitSpawner();
    let caughtExposedError = null;
    try {
      await executeRollback({
        rootDir: env.rootDir,
        spawner: adapter.spawner,
        isRehearsal: true,
        allowPostReopeningReconciliation: false
      });
    } catch (err) {
      caughtExposedError = err;
    }

    assert(Boolean(caughtExposedError), 'Vector 5: Automatic rollback rejected after traffic reopening');
    assert(caughtExposedError.message.includes('traffic reopening boundary crossed'), 'Vector 5: Error explicitly cites traffic reopening boundary');
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR 6: Stale Backup and Attempt ID Mismatch Rejection
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- VECTOR 6: Stale Backup and Attempt ID Mismatch Rejection ---');
  {
    const env = createDisposableGitRepo();
    const stateFilePath = path.join(env.rootDir, 'server', 'active_deployment_state.json');
    const state = {
      attemptId: 'deploy_attempt_A',
      backupFile: path.join(env.rootDir, 'server', 'backups', 'bfi_classroom_preflight_test.db'),
      backupValidated: true,
      // Stale envBackupFile belonging to attempt B
      envBackupFile: path.join(env.rootDir, 'server', 'backups', 'env_pre_reconciliation_deploy_attempt_B.env'),
      trafficMayReopen: false,
      trafficReopened: false
    };
    fs.writeFileSync(stateFilePath, JSON.stringify(state));
    fs.writeFileSync(path.join(env.rootDir, 'server', 'pre_deployment_revision.txt'), env.c1Rev + '\n');
    fs.writeFileSync(state.backupFile, 'dummy db');
    fs.writeFileSync(state.envBackupFile, 'dummy env');

    const adapter = createRealGitSpawner();
    let caughtStaleError = null;
    try {
      await executeRollback({
        rootDir: env.rootDir,
        spawner: adapter.spawner,
        isRehearsal: true
      });
    } catch (err) {
      caughtStaleError = err;
    }

    assert(Boolean(caughtStaleError), 'Vector 6: Rollback aborts when envBackupFile attemptId mismatches state attemptId');
    assert(caughtStaleError.message.includes('Stale configuration backup'), 'Vector 6: Error explicitly rejects stale configuration backup');
    console.log();
  }

  cleanupTestDir();

  console.log('================================================================');
  console.log(`REAL-GIT LIFECYCLE TEST SUITE COMPLETE: ${passedAssertions}/${totalAssertions} ASSERTIONS PASSED (100%)`);
  console.log('================================================================');
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE RUNNER FATAL ERROR:', err);
  process.exit(1);
});
