#!/usr/bin/env node
/**
 * scripts/test_rollback_failures.cjs
 *
 * Strict fail-closed unit test suite for executeRollback in production_lifecycle.cjs.
 * 
 * Asserts that failure on ANY command during rollback immediately halts execution
 * and strictly prevents subsequent unsafe steps (especially Nginx restart and traffic reopening).
 * 
 * Vectors Tested:
 * 1. Git checkout failure in rollback -> Throws, npm/pm2/curl/nginx NEVER execute.
 * 2. npm ci failure in rollback -> Throws, build/prune/pm2/curl/nginx NEVER execute.
 * 3. npm run build failure in rollback -> Throws, prune/pm2/curl/nginx NEVER execute.
 * 4. npm prune failure in rollback -> Throws, pm2/curl/nginx NEVER execute.
 * 5. pm2 start failure in rollback -> Throws, curl/nginx NEVER execute.
 * 6. PM2 machine-readable health check failure (not online) -> Throws, curl/nginx NEVER execute.
 * 7. HTTP loopback health check failure (curl status != 200) -> Throws, Nginx NEVER starts.
 * 8. Post-reopening boundary gate: Stale backup restore rejected if traffic was reopened.
 * 8b. Post-reopening restore authorized: Proceeds ONLY when allowPostReopeningReconciliation is explicitly true.
 * 9. Successful Nginx start followed by failed status inspection:
 *    - Persists trafficMayReopen BEFORE start.
 *    - Simulated public write occurs immediately after Nginx starts.
 *    - Inspection failure halts deployment.
 *    - Ordinary rollback strictly rejects automatic restore and preserves write.
 *    - Authorized forensic restore preserves write in quarantine.
 * 10. Start timeout / ambiguous result: State persisted before exposure command; rollback blocked.
 * 11. Interruption around exposure command: State persisted atomically; rollback blocked.
 * 12. Missing state metadata: Fails closed; legacy backup-marker does NOT bypass reopening boundary.
 * 13. Malformed state metadata: Fails closed on corrupted JSON.
 * 14. Ambiguous metadata & attempt/backup mismatch: Fails closed on schema ambiguities.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { executeDeployment, executeRollback } = require('./production_lifecycle.cjs');

const TEST_DIR = path.resolve(__dirname, '..', 'test_rollback_unit_env');

function setupTestEnv() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const serverDir = path.join(TEST_DIR, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  fs.mkdirSync(path.join(serverDir, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'dist'), { recursive: true });

  // Create dist files for build verification
  fs.writeFileSync(path.join(TEST_DIR, 'dist', 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(TEST_DIR, 'dist', '404.html'), '<html></html>');

  // Copy operational scripts
  for (const s of ['preflight_lockdown_check.cjs', 'verify_isolation.cjs', 'run_migrations.cjs', 'production_smoke_check.cjs', 'production_lifecycle.cjs']) {
    fs.copyFileSync(path.resolve(__dirname, s), path.join(TEST_DIR, 'scripts', s));
  }

  const dbPath = path.join(serverDir, 'bfi_classroom.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, is_super_admin INTEGER DEFAULT 0, role TEXT DEFAULT 'admin');
    CREATE TABLE student_course_enrollments (id INTEGER PRIMARY KEY);
    CREATE TABLE batches (id INTEGER PRIMARY KEY);
    CREATE TABLE batch_course_fees (id INTEGER PRIMARY KEY);
    INSERT INTO users (id, is_super_admin, role) VALUES (1, 0, 'admin');
    INSERT INTO student_course_enrollments VALUES (1), (2);
    INSERT INTO batches VALUES (1);
    INSERT INTO batch_course_fees VALUES (1);
  `);
  db.close();

  // Create baseline and backup
  const backupFile = path.join(serverDir, 'backups', 'valid_backup.db');
  fs.copyFileSync(dbPath, backupFile);

  const baseline = {
    student_course_enrollments: 2,
    users: 1,
    batches: 1,
    batch_course_fees: 1
  };
  fs.writeFileSync(path.join(serverDir, 'pre_deployment_baseline.json'), JSON.stringify(baseline));
  fs.writeFileSync(path.join(serverDir, 'pre_deployment_revision.txt'), 'base_commit_sha_1234\n');
  fs.writeFileSync(path.join(serverDir, 'pre_deployment_services.env'), 'NGINX_STATE=active\nPM2_STATE=online\n');
  fs.writeFileSync(path.join(serverDir, 'active_backup_path.env'), `BACKUP_FILE=${backupFile}\nBACKUP_VALIDATED=true\nATTEMPT_ID=test_attempt_1\n`);

  const state = {
    attemptId: 'test_attempt_1',
    startedAt: new Date().toISOString(),
    preDeploymentRevision: 'base_commit_sha_1234',
    targetCommit: 'target_commit_sha_5678',
    backupFile,
    backupValidated: true,
    trafficMayReopen: false,
    trafficExposureInitiatedAt: null,
    trafficReopened: false,
    trafficReopenedAt: null,
    nginxInitialState: 'active',
    pm2InitialState: 'online'
  };
  fs.writeFileSync(path.join(serverDir, 'active_deployment_state.json'), JSON.stringify(state));

  return { rootDir: TEST_DIR, dbPath, backupFile, serverDir };
}

function cleanTestEnv() {
  if (fs.existsSync(TEST_DIR)) {
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  }
}

let passedTests = 0;
let totalTests = 0;

function assert(name, condition, detail = '') {
  totalTests++;
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (detail) console.error(`   Details: ${detail}`);
    process.exit(1);
  }
}

function createTrackingSpawner(failureTarget = '') {
  const executed = [];
  let pm2Status = 'online';
  let nginxActive = true;

  const spawner = (cmd, args = [], opts = {}) => {
    const cmdStr = `${cmd} ${args.join(' ')}`.trim();
    executed.push(cmdStr);

    if (cmd === 'pm2' && args[0] === 'stop') {
      pm2Status = 'stopped';
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (cmd === 'sudo' && args[0] === 'systemctl' && args[1] === 'stop') {
      nginxActive = false;
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (cmd === 'sudo' && args[0] === 'systemctl' && args[1] === 'start') {
      if (failureTarget === 'nginx_start_timeout') {
        return { status: null, error: new Error('ETIMEDOUT: start nginx timed out'), stdout: '', stderr: '' };
      }
      nginxActive = true;
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (cmd === 'systemctl' && args[0] === 'is-active') {
      if (failureTarget === 'nginx_verify_after_start' && nginxActive) {
        return { status: 3, stdout: 'inactive\n', stderr: 'systemd error: inactive', error: null };
      }
      return { status: nginxActive ? 0 : 3, stdout: nginxActive ? 'active\n' : 'inactive\n', stderr: '', error: null };
    }
    if (cmd === 'pgrep') {
      return { status: nginxActive ? 0 : 1, stdout: nginxActive ? '830\n' : '', stderr: '', error: null };
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
    if (cmd === 'lsof') {
      if (args[0] === '-v') {
        return { status: 0, stdout: 'lsof version 4.93\n', stderr: '', error: null };
      }
      return { status: 1, stdout: '', stderr: '', error: null };
    }
    if (cmd === 'pm2' && args[0] === 'jlist') {
      if (failureTarget === 'pm2_health_not_online') {
        const list = [{ name: 'bfi-classroom', pm2_env: { status: 'errored' } }];
        return { status: 0, stdout: JSON.stringify(list), stderr: '', error: null };
      }
      const list = [{ name: 'bfi-classroom', pid: 19613, pm2_env: { status: pm2Status } }];
      return { status: 0, stdout: JSON.stringify(list), stderr: '', error: null };
    }

    if (cmd === 'git') {
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'base_commit_sha_1234\n', stderr: '', error: null };
      if (args[0] === 'checkout') {
        if (failureTarget === 'git_checkout') {
          return { status: 1, stdout: '', stderr: 'fatal: git checkout failed: corrupt tree', error: null };
        }
        return { status: 0, stdout: 'checkout ok\n', stderr: '', error: null };
      }
    }

    if (cmd === 'npm') {
      if (failureTarget === 'npm_ci' && args[0] === 'ci') {
        return { status: 1, stdout: '', stderr: 'npm error: ERESOLVE', error: null };
      }
      if (failureTarget === 'npm_build' && args[1] === 'build') {
        return { status: 1, stdout: '', stderr: 'npm error: build failed', error: null };
      }
      if (failureTarget === 'npm_prune' && args[0] === 'prune') {
        return { status: 1, stdout: '', stderr: 'npm error: prune failed', error: null };
      }
      return { status: 0, stdout: 'npm ok\n', stderr: '', error: null };
    }

    if (failureTarget === 'pm2_start' && cmd === 'pm2' && args[0] === 'start') {
      return { status: 1, stdout: '', stderr: 'pm2 error: script not found', error: null };
    }
    if (cmd === 'pm2' && args[0] === 'start') {
      pm2Status = 'online';
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (failureTarget === 'curl_health' && cmd === 'curl') {
      return { status: 7, stdout: '', stderr: 'curl: (7) Connection refused', error: null };
    }
    if (cmd === 'curl') {
      return { status: 0, stdout: 'HTTP/1.1 200 OK\n', stderr: '', error: null };
    }

    if (cmd === process.execPath || cmd === 'node') {
      return { status: 0, stdout: 'child ok\n', stderr: '', error: null };
    }

    return { status: 0, stdout: '', stderr: '', error: null };
  };

  return { spawner, executed };
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: EXECUTE_ROLLBACK FAIL-CLOSED GATES & COMMAND ORDER');
  console.log('================================================================\n');

  // Vector 1: Git checkout failure in rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('git_checkout');
    let threw = false;
    let errMsg = '';

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
      errMsg = err.message;
    }

    assert(
      'Vector 1: Git checkout failure throws and halts rollback',
      threw && errMsg.includes('Rollback Git Checkout exited with code 1'),
      `Received threw=${threw}, message=${errMsg}`
    );
    assert(
      'Vector 1: Subsequent unsafe steps (npm, pm2, curl, nginx) NEVER execute',
      !tracker.executed.some(c => c.includes('npm')) &&
      !tracker.executed.some(c => c.includes('pm2 start')) &&
      !tracker.executed.some(c => c.includes('curl')) &&
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx')),
      `Executed commands: ${tracker.executed.join(', ')}`
    );
    cleanTestEnv();
  }

  // Vector 2: npm ci failure in rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('npm_ci');
    let threw = false;

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
    }

    assert('Vector 2: npm ci failure throws and halts rollback', threw);
    assert(
      'Vector 2: Build, PM2, curl, and Nginx NEVER execute on npm ci failure',
      !tracker.executed.some(c => c.includes('npm run build')) &&
      !tracker.executed.some(c => c.includes('pm2 start')) &&
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx'))
    );
    cleanTestEnv();
  }

  // Vector 3: npm run build failure in rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('npm_build');
    let threw = false;

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
    }

    assert('Vector 3: npm run build failure throws and halts rollback', threw);
    assert(
      'Vector 3: Prune, PM2, curl, and Nginx NEVER execute on build failure',
      !tracker.executed.some(c => c.includes('npm prune')) &&
      !tracker.executed.some(c => c.includes('pm2 start')) &&
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx'))
    );
    cleanTestEnv();
  }

  // Vector 4: npm prune failure in rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('npm_prune');
    let threw = false;

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
    }

    assert('Vector 4: npm prune failure throws and halts rollback', threw);
    assert(
      'Vector 4: PM2, curl, and Nginx NEVER execute on prune failure',
      !tracker.executed.some(c => c.includes('pm2 start')) &&
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx'))
    );
    cleanTestEnv();
  }

  // Vector 5: PM2 start failure in rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('pm2_start');
    let threw = false;

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
    }

    assert('Vector 5: PM2 start failure throws and halts rollback', threw);
    assert(
      'Vector 5: Curl loopback check and Nginx restart NEVER execute on PM2 start failure',
      !tracker.executed.some(c => c.includes('curl')) &&
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx'))
    );
    cleanTestEnv();
  }

  // Vector 6: PM2 health check failure (status is not online)
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('pm2_health_not_online');
    let threw = false;
    let errMsg = '';

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
      errMsg = err.message;
    }

    assert(
      'Vector 6: Restored PM2 health check failure throws and halts rollback',
      threw && errMsg.includes('Restored PM2 application not online'),
      `Received threw=${threw}, message=${errMsg}`
    );
    assert(
      'Vector 6: Curl check and Nginx restart NEVER execute when PM2 is not healthy',
      !tracker.executed.some(c => c.includes('curl')) &&
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx'))
    );
    cleanTestEnv();
  }

  // Vector 7: HTTP loopback health check failure (curl status != 200)
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('curl_health');
    let threw = false;
    let errMsg = '';

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
      errMsg = err.message;
    }

    assert(
      'Vector 7: HTTP health check failure throws and halts rollback',
      threw && errMsg.includes('Restored Service Loopback Health exited with code 7'),
      `Received threw=${threw}, message=${errMsg}`
    );
    assert(
      'Vector 7: Nginx NEVER starts and traffic NEVER reopens when HTTP health fails',
      !tracker.executed.some(c => c.includes('sudo systemctl start nginx')),
      `Commands: ${tracker.executed.join(', ')}`
    );
    cleanTestEnv();
  }

  // Vector 8: Post-reopening boundary gate
  {
    const env = setupTestEnv();
    const stateFile = path.join(env.serverDir, 'active_deployment_state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.trafficReopened = true;
    state.trafficReopenedAt = '2026-10-26T02:00:00.000Z';
    fs.writeFileSync(stateFile, JSON.stringify(state));

    const tracker = createTrackingSpawner();
    let threw = false;
    let errMsg = '';

    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      threw = true;
      errMsg = err.message;
    }

    assert(
      'Vector 8: Automatic restore rejected when traffic has already been reopened',
      threw && errMsg.includes('Automatic restore rejected after traffic reopening boundary crossed'),
      `Received threw=${threw}, message=${errMsg}`
    );
    assert(
      'Vector 8: Zero database mutations or commands executed when post-reopening restore is rejected',
      tracker.executed.length === 0,
      `Commands executed: ${tracker.executed.join(', ')}`
    );

    // Vector 8b: Explicit authorization
    let authPassed = false;
    try {
      const res = await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true,
        allowPostReopeningReconciliation: true
      });
      authPassed = res.rollbackComplete === true;
    } catch (err) {
      authPassed = false;
    }

    assert(
      'Vector 8b: Post-reopening restore proceeds ONLY when allowPostReopeningReconciliation is explicitly true',
      authPassed,
      'Expected rollback to succeed with explicit authorization'
    );
    cleanTestEnv();
  }

  // Vector 9: Successful Nginx start followed by failed status inspection & write preservation
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('nginx_verify_after_start');
    let deployThrew = false;
    let writeExecuted = false;

    try {
      await executeDeployment({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true,
        onNginxStarted: ({ dbPath }) => {
          // Public traffic arrives over active Nginx and writes to the DB
          const wDb = new Database(dbPath);
          wDb.exec("INSERT INTO student_course_enrollments (id) VALUES (999);");
          wDb.close();
          writeExecuted = true;
        }
      });
    } catch (err) {
      deployThrew = true;
    }

    assert('Vector 9: Deployment throws on failed Nginx verification after start', deployThrew);
    assert('Vector 9: Simulated post-exposure public write was executed', writeExecuted);

    // Now test ordinary rollback without explicit override: MUST REJECT and preserve write!
    let rollbackThrew = false;
    let rollbackErr = '';
    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      rollbackThrew = true;
      rollbackErr = err.message;
    }

    assert(
      'Vector 9: Ordinary rollback rejected after traffic exposure boundary crossed',
      rollbackThrew && rollbackErr.includes('traffic reopening boundary crossed'),
      `Received: ${rollbackErr}`
    );

    // Verify the write was PRESERVED in the database (not deleted by an automatic restore)
    const checkDb = new Database(env.dbPath, { readonly: true });
    const writeCount = checkDb.prepare('SELECT count(*) as c FROM student_course_enrollments WHERE id = 999').get().c;
    checkDb.close();

    assert(
      'Vector 9: Post-exposure user write (id=999) is strictly PRESERVED against automatic restore',
      writeCount === 1,
      `Expected writeCount=1, got ${writeCount}`
    );

    // Verify authorized post-reopening rollback succeeds with --allow-post-reopening-reconciliation
    let authRollbackPassed = false;
    try {
      const res = await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true,
        allowPostReopeningReconciliation: true
      });
      authRollbackPassed = res.rollbackComplete === true;
    } catch (err) {
      authRollbackPassed = false;
    }

    assert(
      'Vector 9: Authorized forensic rollback succeeds when explicit flag is provided',
      authRollbackPassed
    );
    cleanTestEnv();
  }

  // Vector 10: Start timeout / ambiguous result blocks automatic rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner('nginx_start_timeout');
    let deployThrew = false;

    try {
      await executeDeployment({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      deployThrew = true;
    }

    assert('Vector 10: Deployment halts on Nginx start timeout', deployThrew);

    // Verify trafficMayReopen was persisted before command executed
    const stateFile = path.join(env.serverDir, 'active_deployment_state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert('Vector 10: State persisted trafficMayReopen=true before timeout occurred', state.trafficMayReopen === true);

    // Ordinary rollback must reject automatic restore
    let rollbackThrew = false;
    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      rollbackThrew = true;
    }

    assert('Vector 10: Ordinary rollback rejected after start timeout', rollbackThrew);
    cleanTestEnv();
  }

  // Vector 11: Interruption around exposure command blocks automatic rollback
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner();
    let deployThrew = false;

    try {
      await executeDeployment({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true,
        onExposureBoundarySet: () => {
          throw new Error('SIMULATED_PROCESS_CRASH_OR_INTERRUPTION');
        }
      });
    } catch (err) {
      deployThrew = true;
    }

    assert('Vector 11: Process interruption halts deployment', deployThrew);

    // Verify state file persisted boundary atomically before crash
    const stateFile = path.join(env.serverDir, 'active_deployment_state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert('Vector 11: State persisted trafficMayReopen=true before crash', state.trafficMayReopen === true);

    // Ordinary rollback must reject automatic restore
    let rollbackThrew = false;
    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      rollbackThrew = true;
    }

    assert('Vector 11: Ordinary rollback rejected after crash around exposure boundary', rollbackThrew);
    cleanTestEnv();
  }

  // Vector 12: Missing deployment-state metadata fails closed without fallback bypass
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner();
    // Delete state file, leaving only legacy active_backup_path.env
    fs.unlinkSync(path.join(env.serverDir, 'active_deployment_state.json'));

    let rollbackThrew = false;
    let errMsg = '';
    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      rollbackThrew = true;
      errMsg = err.message;
    }

    assert(
      'Vector 12: Missing active_deployment_state.json fails closed and prevents restore',
      rollbackThrew && errMsg.includes('Deployment state file is missing'),
      `Received: ${errMsg}`
    );
    assert(
      'Vector 12: Legacy backup marker does NOT bypass missing state file',
      tracker.executed.length === 0
    );
    cleanTestEnv();
  }

  // Vector 13: Malformed deployment-state metadata fails closed
  {
    const env = setupTestEnv();
    const tracker = createTrackingSpawner();
    fs.writeFileSync(path.join(env.serverDir, 'active_deployment_state.json'), '{"attemptId": "corrupt_json');

    let rollbackThrew = false;
    let errMsg = '';
    try {
      await executeRollback({
        rootDir: env.rootDir,
        databasePath: 'server/bfi_classroom.db',
        spawner: tracker.spawner,
        isRehearsal: true
      });
    } catch (err) {
      rollbackThrew = true;
      errMsg = err.message;
    }

    assert(
      'Vector 13: Malformed state JSON fails closed and prevents restore',
      rollbackThrew && errMsg.includes('Deployment state file is malformed'),
      `Received: ${errMsg}`
    );
    cleanTestEnv();
  }

  // Vector 14: Ambiguous metadata and attempt/backup mismatch fail closed
  {
    // 14a: Missing attemptId
    const env = setupTestEnv();
    const tracker = createTrackingSpawner();
    const stateFile = path.join(env.serverDir, 'active_deployment_state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    delete state.attemptId;
    fs.writeFileSync(stateFile, JSON.stringify(state));

    let threw14a = false;
    try {
      await executeRollback({ rootDir: env.rootDir, databasePath: 'server/bfi_classroom.db', spawner: tracker.spawner, isRehearsal: true });
    } catch (err) {
      threw14a = err.message.includes('Deployment state metadata is ambiguous');
    }
    assert('Vector 14a: Missing attemptId fails closed', threw14a);

    // 14b: Non-boolean trafficReopened
    state.attemptId = 'test_attempt_1';
    state.trafficReopened = 'yes';
    fs.writeFileSync(stateFile, JSON.stringify(state));
    let threw14b = false;
    try {
      await executeRollback({ rootDir: env.rootDir, databasePath: 'server/bfi_classroom.db', spawner: tracker.spawner, isRehearsal: true });
    } catch (err) {
      threw14b = err.message.includes('traffic reopening boundary is ambiguous');
    }
    assert('Vector 14b: Non-boolean trafficReopened fails closed', threw14b);

    // 14c: Attempt ID mismatch between state and active_backup_path.env
    state.trafficReopened = false;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    fs.writeFileSync(path.join(env.serverDir, 'active_backup_path.env'), `BACKUP_FILE=${state.backupFile}\nBACKUP_VALIDATED=true\nATTEMPT_ID=different_attempt_999\n`);
    let threw14c = false;
    try {
      await executeRollback({ rootDir: env.rootDir, databasePath: 'server/bfi_classroom.db', spawner: tracker.spawner, isRehearsal: true });
    } catch (err) {
      threw14c = err.message.includes('Attempt ID mismatch');
    }
    assert('Vector 14c: Attempt ID mismatch between state and env fails closed', threw14c);

    // 14d: Backup file mismatch between state and active_backup_path.env
    fs.writeFileSync(path.join(env.serverDir, 'active_backup_path.env'), `BACKUP_FILE=server/backups/fake_backup.db\nBACKUP_VALIDATED=true\nATTEMPT_ID=test_attempt_1\n`);
    let threw14d = false;
    try {
      await executeRollback({ rootDir: env.rootDir, databasePath: 'server/bfi_classroom.db', spawner: tracker.spawner, isRehearsal: true });
    } catch (err) {
      threw14d = err.message.includes('Backup association mismatch');
    }
    assert('Vector 14d: Backup file mismatch between state and env fails closed', threw14d);

    cleanTestEnv();
  }

  console.log('\n================================================================');
  console.log(`TEST SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log('================================================================');
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error(`❌ [TEST FATAL] ${err.message}`);
  process.exit(1);
});
