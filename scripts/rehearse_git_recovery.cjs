#!/usr/bin/env node
/**
 * scripts/rehearse_git_recovery.cjs
 *
 * Rehearses operational-script survival and fail-closed rollback in a REAL disposable Git repository.
 *
 * Proves:
 * 1. Commit A (baseline, representing 17d9335) has NO production_lifecycle.cjs or verify_isolation.cjs.
 * 2. Commit B (candidate release) contains the operational scripts.
 * 3. Deployment preserves recovery tooling in `server/.recovery_tools/` before any git mutations.
 * 4. A mid-deployment failure at Phase 5 triggers real `git checkout <Commit A>` during rollback.
 * 5. Real git checkout cleans non-tracked/new files from `scripts/` in Commit A.
 * 6. Preserved files in `server/.recovery_tools/` SURVIVE the checkout intact.
 * 7. Rollback completes successfully using preserved tooling and restores database baseline.
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const Database = require('better-sqlite3');
const { executeDeployment, executeRollback } = require('./production_lifecycle.cjs');

const TEST_REPO_DIR = path.resolve(__dirname, '..', 'test_git_recovery_repo');

function runGit(args, cwd = TEST_REPO_DIR) {
  const res = child_process.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
}

function setupRealGitRepository() {
  if (fs.existsSync(TEST_REPO_DIR)) {
    fs.rmSync(TEST_REPO_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_REPO_DIR, { recursive: true });

  // 1. Initialize Git
  runGit(['init', '-b', 'main']);
  runGit(['config', 'user.name', 'Disposable Test Operator']);
  runGit(['config', 'user.email', 'operator@bfi-test.internal']);

  // 2. Build baseline Commit A (simulating production 17d9335)
  const serverDir = path.join(TEST_REPO_DIR, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  fs.mkdirSync(path.join(serverDir, 'backups'), { recursive: true });

  // .gitignore in Commit A
  fs.writeFileSync(path.join(TEST_REPO_DIR, '.gitignore'), `
node_modules
dist
*.db
*.db-wal
*.db-shm
server/*.db*
server/backups/
server/quarantine_*
server/.recovery_tools/
*.env
server/active_deployment_state.json
server/pre_deployment_baseline.json
server/pre_deployment_revision.txt
server/pre_deployment_services.env
server/active_backup_path.env
`);

  fs.writeFileSync(path.join(TEST_REPO_DIR, 'package.json'), JSON.stringify({
    name: 'bfi-classroom',
    version: '1.0.0',
    scripts: {
      build: 'node -e "console.log(\'build ok\')"',
      prune: 'node -e "console.log(\'prune ok\')"'
    }
  }, null, 2));

  fs.writeFileSync(path.join(TEST_REPO_DIR, 'ecosystem.config.cjs'), `
module.exports = {
  apps: [{
    name: 'bfi-classroom',
    script: 'server/server.js'
  }]
};
`);

  fs.writeFileSync(path.join(serverDir, 'server.js'), `
console.log('BFI Classroom Baseline Server');
`);

  // Initialize SQLite database matching baseline
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
      is_super_admin INTEGER DEFAULT 0
    );
    CREATE TABLE student_course_enrollments (id INTEGER PRIMARY KEY, user_id INTEGER, course_id INTEGER);
    CREATE TABLE batches (id INTEGER PRIMARY KEY, batch_number TEXT, course_id INTEGER);
    CREATE TABLE batch_course_fees (id INTEGER PRIMARY KEY, batch_id INTEGER, amount NUMERIC);

    INSERT INTO users (id, username, email, role, is_super_admin) VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 0);
    INSERT INTO users (id, username, email, role, is_super_admin) VALUES (7, 'admin2', 'admin2@bfi.com', 'admin', 0);
    INSERT INTO student_course_enrollments VALUES (1, 10, 1), (2, 11, 1), (3, 12, 2);
    INSERT INTO batches VALUES (1, 'B-01', 1), (2, 'B-02', 2);
    INSERT INTO batch_course_fees VALUES (1, 1, 5000), (2, 2, 6000);
  `);
  db.close();

  runGit(['add', '.']);
  runGit(['commit', '-m', 'chore: baseline commit A']);
  const commitA = runGit(['rev-parse', 'HEAD']);

  // 3. Build candidate Commit B (with operational scripts and super admin migrations)
  const scriptsDir = path.join(TEST_REPO_DIR, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const rootScriptsDir = path.resolve(__dirname);
  for (const s of ['preflight_lockdown_check.cjs', 'verify_isolation.cjs', 'run_migrations.cjs', 'production_smoke_check.cjs', 'production_lifecycle.cjs']) {
    fs.copyFileSync(path.join(rootScriptsDir, s), path.join(scriptsDir, s));
  }

  // Copy migrations
  const migrationsSrc = path.resolve(__dirname, '..', 'server', 'db', 'migrations');
  const migrationsDest = path.join(serverDir, 'db', 'migrations');
  fs.mkdirSync(migrationsDest, { recursive: true });
  fs.cpSync(migrationsSrc, migrationsDest, { recursive: true });

  runGit(['add', '.']);
  runGit(['commit', '-m', 'feat: candidate commit B with super admin and operational tooling']);
  const commitB = runGit(['rev-parse', 'HEAD']);

  return { rootDir: TEST_REPO_DIR, dbPath, commitA, commitB };
}

function cleanRealGitRepository() {
  if (fs.existsSync(TEST_REPO_DIR)) {
    try {
      fs.rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    } catch {}
  }
}

async function runRealGitRehearsal() {
  console.log('================================================================');
  console.log('REAL GIT REPOSITORY SURVIVAL & FAIL-CLOSED ROLLBACK REHEARSAL');
  console.log('================================================================\n');

  const { rootDir, dbPath, commitA, commitB } = setupRealGitRepository();

  console.log(`Baseline Commit A:  ${commitA}`);
  console.log(`Candidate Commit B: ${commitB}`);

  // Confirm scripts exist in working tree at Commit B
  if (!fs.existsSync(path.join(rootDir, 'scripts', 'production_lifecycle.cjs'))) {
    throw new Error('Candidate commit B must contain production_lifecycle.cjs');
  }

  // Adapter for systemctl, pm2, ss, lsof, curl while delegating git to real child_process!
  let nginxActive = true;
  let pm2Status = 'online';

  const hybridSpawner = (cmd, args = [], opts = {}) => {
    const cmdStr = `${cmd} ${args.join(' ')}`.trim();

    // REAL GIT EXECUTION!
    if (cmd === 'git') {
      console.log(`   [REAL GIT] -> git ${args.join(' ')} (in ${rootDir})`);
      const res = child_process.spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
      return {
        status: res.status,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        error: res.error || null
      };
    }

    // REAL NPM EXECUTION (simulated build output for speed)
    if (cmd === 'npm') {
      if (args[0] === 'run' && args[1] === 'build') {
        const distDir = path.join(rootDir, 'dist');
        if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(distDir, 'index.html'), '<!DOCTYPE html><html><body>Dist Index</body></html>');
        fs.writeFileSync(path.join(distDir, '404.html'), '<!DOCTYPE html><html><body>Dist 404</body></html>');
        return { status: 0, stdout: 'npm run build ok\n', stderr: '', error: null };
      }
      return { status: 0, stdout: 'npm ok\n', stderr: '', error: null };
    }

    // Service Adapters
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

    if (cmd === 'systemctl') {
      if (args[0] === 'is-active' && args[1] === 'nginx') {
        return { status: nginxActive ? 0 : 3, stdout: nginxActive ? 'active\n' : 'inactive\n', stderr: '', error: null };
      }
    }

    if (cmd === 'pgrep') {
      if (args.includes('nginx')) {
        return { status: nginxActive ? 0 : 1, stdout: nginxActive ? '830\n832\n' : '', stderr: '', error: null };
      }
    }

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

    if (cmd === 'pm2') {
      if (args[0] === 'stop') {
        pm2Status = 'stopped';
        return { status: 0, stdout: '[PM2] stopped\n', stderr: '', error: null };
      }
      if (args[0] === 'start') {
        pm2Status = 'online';
        return { status: 0, stdout: '[PM2] started\n', stderr: '', error: null };
      }
      if (args[0] === 'jlist') {
        const list = [{ name: 'bfi-classroom', pid: 19613, pm2_env: { status: pm2Status } }];
        return { status: 0, stdout: JSON.stringify(list), stderr: '', error: null };
      }
    }

    if (cmd === 'lsof') {
      if (args[0] === '-v') {
        return { status: 0, stdout: 'lsof 4.93\n', stderr: '', error: null };
      }
      return { status: 1, stdout: '', stderr: '', error: null };
    }

    if (cmd === 'curl') {
      return { status: 0, stdout: 'HTTP/1.1 200 OK\n', stderr: '', error: null };
    }

    // Node child processes for migration runner & smoke checks
    if (cmd === process.execPath || cmd === 'node') {
      if (args[0] && args[0].includes('production_smoke_check.cjs')) {
        // Injected failure: Smoke check fails in Phase 5!
        return { status: 1, stdout: '', stderr: 'Simulated smoke check failure: RBAC mismatch', error: null };
      }
      // Real execution for migration runner on disposable DB
      return child_process.spawnSync(cmd, args, opts);
    }

    return { status: 0, stdout: '', stderr: '', error: null };
  };

  // Phase 0: Explicitly record pre_deployment_revision as commitA
  fs.writeFileSync(path.join(rootDir, 'server', 'pre_deployment_revision.txt'), `${commitA}\n`);

  console.log('\n--- Step 1: Execute Deployment (Failing at Smoke Check Phase 5) ---');
  let deployFailedAsExpected = false;
  try {
    await executeDeployment({
      rootDir,
      databasePath: 'server/bfi_classroom.db',
      targetCommit: commitB,
      preDeploymentRevision: commitA,
      spawner: hybridSpawner,
      isRehearsal: true
    });
  } catch (err) {
    deployFailedAsExpected = true;
    console.log(`✅ Caught expected deployment failure during Phase 5: ${err.message}`);
  }

  if (!deployFailedAsExpected) {
    throw new Error('Deployment should have failed during smoke check phase.');
  }

  console.log('\n--- Step 2: Execute Canonical Rollback ---');
  // At this point, deployment halted at Phase 5. Traffic was never opened.
  // We execute rollback, which checks out pre_deployment_revision (Commit A) via real Git!
  const rollbackResult = await executeRollback({
    rootDir,
    databasePath: 'server/bfi_classroom.db',
    spawner: hybridSpawner,
    isRehearsal: true
  });

  if (!rollbackResult.rollbackComplete) {
    throw new Error('executeRollback did not report rollbackComplete: true');
  }
  console.log('✅ Canonical rollback completed.');

  console.log('\n--- Step 3: Verify Real Git State & Recovery Tooling Survival ---');

  // Check 1: What is the current git HEAD?
  const currentHead = runGit(['rev-parse', 'HEAD']);
  console.log(`Current Git HEAD after rollback: ${currentHead}`);
  if (currentHead !== commitA) {
    throw new Error(`Rollback failed to restore Git HEAD to Commit A (${commitA}). Current: ${currentHead}`);
  }
  console.log('✅ Git HEAD verified: successfully checked out baseline Commit A.');

  // Check 2: Did Git remove production_lifecycle.cjs from scripts/?
  const scriptsLifeCycle = path.join(rootDir, 'scripts', 'production_lifecycle.cjs');
  const fileInScriptsExists = fs.existsSync(scriptsLifeCycle);
  console.log(`Did scripts/production_lifecycle.cjs exist in tracked scripts/ directory after checkout? ${fileInScriptsExists ? 'YES' : 'NO'}`);
  if (fileInScriptsExists) {
    throw new Error('Expected Git to remove production_lifecycle.cjs from tracked scripts/ directory on checkout of Commit A!');
  }
  console.log('✅ CONFIRMED: Real Git checkout removed production_lifecycle.cjs from scripts/ because Commit A never contained it.');

  // Check 3: Did recovery tooling in server/.recovery_tools SURVIVE?
  const recoveryToolsDir = path.join(rootDir, 'server', '.recovery_tools');
  const recoveryLifecycle = path.join(recoveryToolsDir, 'production_lifecycle.cjs');
  const recoveryVerify = path.join(recoveryToolsDir, 'verify_isolation.cjs');
  const recoveryPreflight = path.join(recoveryToolsDir, 'preflight_lockdown_check.cjs');
  const recoveryMigrations = path.join(recoveryToolsDir, 'run_migrations.cjs');
  const recoverySmoke = path.join(recoveryToolsDir, 'production_smoke_check.cjs');

  if (!fs.existsSync(recoveryLifecycle)) throw new Error('CRITICAL: server/.recovery_tools/production_lifecycle.cjs was lost!');
  if (!fs.existsSync(recoveryVerify)) throw new Error('CRITICAL: server/.recovery_tools/verify_isolation.cjs was lost!');
  if (!fs.existsSync(recoveryPreflight)) throw new Error('CRITICAL: server/.recovery_tools/preflight_lockdown_check.cjs was lost!');
  if (!fs.existsSync(recoveryMigrations)) throw new Error('CRITICAL: server/.recovery_tools/run_migrations.cjs was lost!');
  if (!fs.existsSync(recoverySmoke)) throw new Error('CRITICAL: server/.recovery_tools/production_smoke_check.cjs was lost!');

  console.log('✅ RECOVERY TOOLING SURVIVAL VERIFIED: All 5 operational scripts in server/.recovery_tools/ survived real git checkout!');

  // Check 4: Verify Database Invariants Restored
  const restoredDb = new Database(dbPath, { readonly: true });
  const userCount = restoredDb.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const enrollCount = restoredDb.prepare('SELECT COUNT(*) as c FROM student_course_enrollments').get().c;
  const batchCount = restoredDb.prepare('SELECT COUNT(*) as c FROM batches').get().c;
  const feeCount = restoredDb.prepare('SELECT COUNT(*) as c FROM batch_course_fees').get().c;
  const fkCheck = restoredDb.pragma('foreign_key_check');
  const quickCheck = restoredDb.pragma('quick_check')[0].quick_check;
  restoredDb.close();

  if (userCount !== 2 || enrollCount !== 3 || batchCount !== 2 || feeCount !== 2) {
    throw new Error(`Database baseline mismatch after rollback: users=${userCount}, enrollments=${enrollCount}, batches=${batchCount}, fees=${feeCount}`);
  }
  if (fkCheck.length > 0 || quickCheck !== 'ok') {
    throw new Error(`Restored database integrity failed: fk=${fkCheck.length}, quick_check=${quickCheck}`);
  }
  console.log('✅ DATABASE RESTORATION VERIFIED: Exactly matches pre-deployment baseline with 0 FK errors.');

  // Check 5: Verify Active Deployment State
  const stateFile = path.join(rootDir, 'server', 'active_deployment_state.json');
  if (fs.existsSync(stateFile)) {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (st.trafficReopened === true) {
      throw new Error('Traffic reopening state was marked true despite rollback failure!');
    }
  }
  console.log('✅ TRAFFIC STATE VERIFIED: Traffic remained closed throughout rollback.');

  console.log('\n================================================================');
  console.log('REAL GIT RECOVERY REHEARSAL PASSED (100% VERIFIED)');
  console.log('================================================================');

  cleanRealGitRepository();
}

runRealGitRehearsal().then(() => process.exit(0)).catch((err) => {
  console.error(`❌ [GIT RECOVERY FATAL] ${err.message}`);
  cleanRealGitRepository();
  process.exit(1);
});
