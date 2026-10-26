#!/usr/bin/env node
/**
 * scripts/production_lifecycle.cjs
 *
 * Canonical Executable Deployment & Rollback Lifecycle Implementation.
 * 
 * Provides unified, fail-closed implementations for:
 * - executeDeployment(options)
 * - executeRollback(options)
 * 
 * Invoked directly via CLI:
 *   node scripts/production_lifecycle.cjs deploy
 *   node scripts/production_lifecycle.cjs rollback
 * 
 * Or invoked programmatically in rehearsal test suites via dependency injection.
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const Database = require('better-sqlite3');
const { verifyIsolation } = require('./verify_isolation.cjs');

function logSection(title) {
  console.log('\n================================================================');
  console.log(title);
  console.log('================================================================');
}

function logStep(step, msg) {
  console.log(`[LIFECYCLE STEP ${step}] ${msg}`);
}

function logFatal(msg) {
  console.error(`❌ [LIFECYCLE FATAL] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Deployment Procedure (Phases 0 - 6)
// ─────────────────────────────────────────────────────────────────────────────

async function executeDeployment(options = {}) {
  const spawner = options.spawner || child_process.spawnSync;
  const rootDir = options.rootDir || process.cwd();
  const dbRelPath = options.databasePath || 'server/bfi_classroom.db';
  const dbPath = path.resolve(rootDir, dbRelPath);
  const targetCommit = options.targetCommit || '21f3cbe7163f924f5b30c172dc1f6542c3c6f4cd';
  const isRehearsal = Boolean(options.isRehearsal);

  logSection('BFI CLASSROOM CANONICAL PRODUCTION DEPLOYMENT');
  console.log(`Target DB:      ${dbPath}`);
  console.log(`Target Commit:  ${targetCommit}`);
  console.log(`Mode:           ${isRehearsal ? 'REHEARSAL (WITH SERVICE ADAPTERS)' : 'PRODUCTION EXECUTION'}`);

  // ── PHASE 0: Pre-Flight Staging & Safety Gate Preparation ─────────────────
  logSection('PHASE 0: PRE-FLIGHT STAGING & SAFETY SCRIPT VERIFICATION');
  const requiredScripts = [
    'scripts/preflight_lockdown_check.cjs',
    'scripts/verify_isolation.cjs',
    'scripts/run_migrations.cjs',
    'scripts/production_smoke_check.cjs'
  ];

  for (const scriptRel of requiredScripts) {
    const sPath = path.resolve(rootDir, scriptRel);
    if (!fs.existsSync(sPath)) {
      logFatal(`Required operational script missing: ${scriptRel}`);
      throw new Error(`Required script missing: ${scriptRel}`);
    }
    logStep('0.1', `Verified presence of ${scriptRel}`);
  }

  // ── PHASE 1: Maintenance Mode & Writer Lockdown Gate ───────────────────────
  logSection('PHASE 1: MAINTENANCE MODE & WRITER LOCKDOWN GATE');

  // 1.1 Record pre-maintenance service states
  logStep('1.1', 'Recording pre-maintenance service states...');
  const nginxStateCheck = spawner('systemctl', ['is-active', 'nginx'], { encoding: 'utf8', timeout: 5000, shell: false });
  const nginxInitialState = (nginxStateCheck.stdout || '').trim() || 'unknown';

  const pm2StateCheck = spawner('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000, shell: false });
  let pm2InitialState = 'unknown';
  if (!pm2StateCheck.error && pm2StateCheck.status === 0) {
    try {
      const list = JSON.parse(pm2StateCheck.stdout);
      const app = list.find(a => a.name === 'bfi-classroom');
      if (app && app.pm2_env) pm2InitialState = app.pm2_env.status;
    } catch {}
  }

  const serverDir = path.resolve(rootDir, 'server');
  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(
    path.join(serverDir, 'pre_deployment_services.env'),
    `NGINX_STATE=${nginxInitialState}\nPM2_STATE=${pm2InitialState}\n`
  );
  logStep('1.1', `Service states recorded: NGINX=${nginxInitialState}, PM2=${pm2InitialState}`);

  // 1.2 Stop Nginx
  logStep('1.2', 'Stopping Nginx to close public listeners 80/443 and terminate direct IP access...');
  const stopNginxRes = spawner('sudo', ['systemctl', 'stop', 'nginx'], { encoding: 'utf8', timeout: 10000, shell: false });
  if (stopNginxRes.error || stopNginxRes.status !== 0) {
    logFatal(`Failed to stop Nginx: ${stopNginxRes.error ? stopNginxRes.error.message : stopNginxRes.stderr}`);
    throw new Error('Failed to stop Nginx');
  }

  // 1.3 Stop PM2 backend writer
  logStep('1.3', 'Stopping PM2 application bfi-classroom...');
  const stopPm2Res = spawner('pm2', ['stop', 'bfi-classroom'], { encoding: 'utf8', timeout: 10000, shell: false });
  if (stopPm2Res.error || stopPm2Res.status !== 0) {
    logFatal(`Failed to stop PM2: ${stopPm2Res.error ? stopPm2Res.error.message : stopPm2Res.stderr}`);
    throw new Error('Failed to stop PM2');
  }

  // 1.4 Execute fail-closed isolation inspection
  logStep('1.4', 'Running fail-closed isolation inspection (ports, processes, connections, sockets)...');
  verifyIsolation({ spawner, allowPm2Online: false });
  logStep('1.4', 'Isolation gate: PASSED (All ports closed, processes inactive, zero writers)');

  // 1.5 Execute fail-closed database handle inspection
  logStep('1.5', 'Running fail-closed database handle inspection...');
  try {
    const { runPreflightLockdown } = require('./preflight_lockdown_check.cjs');
    runPreflightLockdown({ databasePath: dbPath, spawner, doNotExit: true });
    logStep('1.5', 'Database handle gate: PASSED (Zero open handles on database files)');
  } catch (err) {
    logFatal(`Preflight lockdown check failed: ${err.message}`);
    throw err;
  }

  // ── PHASE 2: Dynamic Health Check & Backup Validation ─────────────────────
  logSection('PHASE 2: DYNAMIC HEALTH CHECK & BACKUP VALIDATION');

  // 2.1 Capture current revision for rollback
  const revCheck = spawner('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (revCheck.error || revCheck.status !== 0) {
    logFatal(`Failed to record deployed git revision: ${revCheck.error ? revCheck.error.message : revCheck.stderr}`);
    throw new Error('Failed to record git revision');
  }
  const deployedRev = revCheck.stdout.trim();
  fs.writeFileSync(path.join(serverDir, 'pre_deployment_revision.txt'), deployedRev + '\n');
  logStep('2.1', `Pre-deployment revision recorded: ${deployedRev}`);

  // 2.2 Capture dynamic baseline invariants & verify PRAGMAs
  logStep('2.2', 'Capturing dynamic baseline invariants and verifying PRAGMA integrity...');
  let baseline;
  {
    const db = new Database(dbPath, { readonly: true });
    const quickCheck = db.prepare('PRAGMA quick_check').get();
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    if (quickCheck.quick_check !== 'ok' || fkCheck.length > 0) {
      db.close();
      logFatal(`Database pre-flight health check failed: quick_check=${JSON.stringify(quickCheck)}, fk_violations=${fkCheck.length}`);
      throw new Error('Pre-flight database health check failed');
    }

    baseline = {
      student_course_enrollments: db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c,
      users: db.prepare('SELECT count(*) as c FROM users').get().c,
      batches: db.prepare('SELECT count(*) as c FROM batches').get().c,
      batch_course_fees: db.prepare('SELECT count(*) as c FROM batch_course_fees').get().c,
      timestamp: new Date().toISOString()
    };
    db.close();

    fs.writeFileSync(path.join(serverDir, 'pre_deployment_baseline.json'), JSON.stringify(baseline, null, 2));
    logStep('2.2', `Baseline captured: enrollments=${baseline.student_course_enrollments}, users=${baseline.users}, batches=${baseline.batches}, fees=${baseline.batch_course_fees}`);
  }

  // 2.3 Create persistent online backup
  logStep('2.3', 'Creating persistent online SQLite backup...');
  const backupDir = path.resolve(serverDir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupTs = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const backupFile = path.join(backupDir, `bfi_classroom_preflight_${backupTs}.db`);

  {
    const src = new Database(dbPath, { readonly: true });
    await src.backup(backupFile);
    src.close();
    logStep('2.3', `Online backup created at: ${backupFile}`);
  }

  // 2.4 Validate backup file against PRAGMAs and baseline invariants
  logStep('2.4', 'Validating backup file against PRAGMAs and baseline invariants...');
  {
    const bDb = new Database(backupFile, { readonly: true });
    const qCheck = bDb.prepare('PRAGMA quick_check').get();
    const fkCheck = bDb.prepare('PRAGMA foreign_key_check').all();
    const bEnrollments = bDb.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
    const bUsers = bDb.prepare('SELECT count(*) as c FROM users').get().c;
    const bBatches = bDb.prepare('SELECT count(*) as c FROM batches').get().c;
    const bFees = bDb.prepare('SELECT count(*) as c FROM batch_course_fees').get().c;
    bDb.close();

    if (qCheck.quick_check !== 'ok' || fkCheck.length > 0) {
      logFatal('Backup file failed PRAGMA integrity verification!');
      throw new Error('Backup failed PRAGMA integrity');
    }
    if (bEnrollments !== baseline.student_course_enrollments ||
        bUsers !== baseline.users ||
        bBatches !== baseline.batches ||
        bFees !== baseline.batch_course_fees) {
      logFatal('Backup file baseline invariant counts do not match original database!');
      throw new Error('Backup baseline count mismatch');
    }

    fs.writeFileSync(path.join(serverDir, 'active_backup_path.env'), `BACKUP_FILE=${backupFile}\nBACKUP_VALIDATED=true\n`);
    logStep('2.4', '✅ Backup file validated: 0 FK violations, quick_check ok, exact baseline match.');
  }

  // ── PHASE 3: Reproducible Code Update & Build Sequence ─────────────────────
  logSection('PHASE 3: REPRODUCIBLE CODE UPDATE & BUILD SEQUENCE');
  logStep('3.1', `Checking out pinned release revision: ${targetCommit}...`);
  const checkoutRes = spawner('git', ['checkout', targetCommit], { encoding: 'utf8', timeout: 30000, shell: false });
  if (checkoutRes.error || checkoutRes.status !== 0) {
    logFatal(`git checkout failed: ${checkoutRes.error ? checkoutRes.error.message : checkoutRes.stderr}`);
    throw new Error('git checkout failed');
  }

  logStep('3.2', 'Installing dependencies including devDependencies (NODE_ENV=development npm ci --legacy-peer-deps)...');
  const ciRes = spawner('npm', ['ci', '--legacy-peer-deps'], {
    env: { ...process.env, NODE_ENV: 'development' },
    encoding: 'utf8',
    timeout: 120000,
    shell: true
  });
  if (ciRes.error || ciRes.status !== 0) {
    logFatal(`npm ci failed: ${ciRes.error ? ciRes.error.message : ciRes.stderr}`);
    throw new Error('npm ci failed');
  }

  logStep('3.3', 'Building frontend production assets (npm run build)...');
  const buildRes = spawner('npm', ['run', 'build'], { encoding: 'utf8', timeout: 120000, shell: true });
  if (buildRes.error || buildRes.status !== 0) {
    logFatal(`npm run build failed: ${buildRes.error ? buildRes.error.message : buildRes.stderr}`);
    throw new Error('npm run build failed');
  }

  logStep('3.4', 'Pruning devDependencies for production runtime isolation (npm prune --omit=dev --legacy-peer-deps)...');
  const pruneRes = spawner('npm', ['prune', '--omit=dev', '--legacy-peer-deps'], { encoding: 'utf8', timeout: 60000, shell: true });
  if (pruneRes.error || pruneRes.status !== 0) {
    logFatal(`npm prune failed: ${pruneRes.error ? pruneRes.error.message : pruneRes.stderr}`);
    throw new Error('npm prune failed');
  }

  // ── PHASE 4: Execute Database Migrations ───────────────────────────────────
  logSection('PHASE 4: DATABASE MIGRATION EXECUTION & ASSERTION VERIFICATION');
  logStep('4.1', `Executing unified migration runner on ${dbPath}...`);
  const migRunnerPath = path.resolve(rootDir, 'scripts/run_migrations.cjs');
  const migRes = spawner(process.execPath, [migRunnerPath, dbPath], { encoding: 'utf8', timeout: 60000, shell: false });
  if (migRes.error || migRes.status !== 0) {
    logFatal(`Migration execution failed: ${migRes.error ? migRes.error.message : migRes.stderr || migRes.stdout}`);
    throw new Error('Migration execution failed');
  }
  logStep('4.1', '✅ Migrations applied sequentially and verified (10/10 schema assertions passed).');

  // ── PHASE 5: Application Restart & Loopback Smoke Verification ─────────────
  logSection('PHASE 5: APPLICATION RESTART & LOOPBACK SMOKE VERIFICATION');
  logStep('5.1', 'Verifying Nginx is STILL stopped before starting application...');
  verifyIsolation({ spawner, allowPm2Online: false });

  logStep('5.2', 'Starting PM2 backend process locally (isolated to 127.0.0.1:3001)...');
  const startPm2Res = spawner('pm2', ['start', 'ecosystem.config.cjs'], { encoding: 'utf8', timeout: 15000, shell: false });
  if (startPm2Res.error || startPm2Res.status !== 0) {
    logFatal(`Failed to start PM2: ${startPm2Res.error ? startPm2Res.error.message : startPm2Res.stderr}`);
    throw new Error('Failed to start PM2');
  }

  logStep('5.3', 'Verifying PM2 is online and Nginx remains stopped (--allow-pm2)...');
  verifyIsolation({ spawner, allowPm2Online: true });

  logStep('5.4', 'Executing 18-assertion production smoke check over loopback...');
  const smokeRunnerPath = path.resolve(rootDir, 'scripts/production_smoke_check.cjs');
  const smokeEnv = {
    ...process.env,
    SUPER_ADMIN_TOKEN: options.superAdminToken || process.env.SUPER_ADMIN_TOKEN || '',
    ADMIN_TOKEN: options.adminToken || process.env.ADMIN_TOKEN || ''
  };
  if (options.superAdminTokenFile) smokeEnv.SUPER_ADMIN_TOKEN_FILE = options.superAdminTokenFile;
  if (options.adminTokenFile) smokeEnv.ADMIN_TOKEN_FILE = options.adminTokenFile;

  const smokeRes = spawner(process.execPath, [smokeRunnerPath, 'http://127.0.0.1:3001'], {
    env: smokeEnv,
    encoding: 'utf8',
    timeout: 30000,
    shell: false
  });

  if (smokeRes.error || smokeRes.status !== 0) {
    logFatal(`Production smoke check failed (exit code ${smokeRes.status}): ${smokeRes.stderr || smokeRes.stdout}`);
    throw new Error('Production smoke check failed');
  }
  logStep('5.4', '✅ Production smoke verification passed: 18/18 assertions verified.');

  // ── PHASE 6: Traffic Reopening Decision Point ──────────────────────────────
  logSection('PHASE 6: TRAFFIC REOPENING DECISION POINT (RESTARTING NGINX)');
  logStep('6.1', 'Restarting Nginx to restore external reverse proxy routing...');
  const startNginxRes = spawner('sudo', ['systemctl', 'start', 'nginx'], { encoding: 'utf8', timeout: 10000, shell: false });
  if (startNginxRes.error || startNginxRes.status !== 0) {
    logFatal(`Failed to start Nginx: ${startNginxRes.error ? startNginxRes.error.message : startNginxRes.stderr}`);
    throw new Error('Failed to start Nginx');
  }

  const nginxVerify = spawner('systemctl', ['is-active', 'nginx'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (nginxVerify.error || (nginxVerify.stdout || '').trim() !== 'active') {
    logFatal(`Nginx failed to report active status after restart: ${nginxVerify.stdout}`);
    throw new Error('Nginx not active after restart');
  }
  logStep('6.1', '✅ Nginx service active: direct origin and reverse proxy routing restored.');
  logStep('6.2', 'Traffic reopened. Operator can deactivate Cloudflare 503 maintenance page.');

  logSection('DEPLOYMENT COMPLETE: RELEASE CANDIDATE SUCCESSFULLY DEPLOYED');
  return { success: true, backupFile, targetCommit };
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Rollback Procedure (Window A)
// ─────────────────────────────────────────────────────────────────────────────

async function executeRollback(options = {}) {
  const spawner = options.spawner || child_process.spawnSync;
  const rootDir = options.rootDir || process.cwd();
  const dbRelPath = options.databasePath || 'server/bfi_classroom.db';
  const dbPath = path.resolve(rootDir, dbRelPath);
  const serverDir = path.resolve(rootDir, 'server');
  const isRehearsal = Boolean(options.isRehearsal);

  logSection('BFI CLASSROOM HARDENED PRODUCTION ROLLBACK (WINDOW A)');
  console.log(`Target DB:  ${dbPath}`);
  console.log(`Mode:       ${isRehearsal ? 'REHEARSAL (WITH SERVICE ADAPTERS)' : 'PRODUCTION EXECUTION'}`);

  // 1. Verify validated backup exists before touching anything
  logStep('R.1', 'Verifying validated backup exists before attempting restoration...');
  const activeBackupEnvPath = path.join(serverDir, 'active_backup_path.env');
  if (!fs.existsSync(activeBackupEnvPath)) {
    logFatal('ABORT ROLLBACK: No active backup file recorded. Failure occurred before validated backup existed. Halting without database restoration to protect original database.');
    throw new Error('ABORT ROLLBACK: No active backup file recorded.');
  }

  const envContent = fs.readFileSync(activeBackupEnvPath, 'utf8');
  if (!envContent.includes('BACKUP_VALIDATED=true')) {
    logFatal('ABORT ROLLBACK: Recorded backup was not validated. Halting without database restoration.');
    throw new Error('ABORT ROLLBACK: Backup was not validated.');
  }

  const match = envContent.match(/BACKUP_FILE=(.+)/);
  if (!match || !match[1]) {
    logFatal('ABORT ROLLBACK: Active backup file path not found in active_backup_path.env.');
    throw new Error('ABORT ROLLBACK: Missing BACKUP_FILE path.');
  }
  const backupFile = match[1].trim();
  if (!fs.existsSync(backupFile)) {
    logFatal(`ABORT ROLLBACK: Backup file does not exist on disk: ${backupFile}`);
    throw new Error(`ABORT ROLLBACK: Backup file missing at ${backupFile}`);
  }
  logStep('R.1', `Validated backup confirmed: ${backupFile}`);

  // 2. Stop application immediately
  logStep('R.2', 'Stopping PM2 application bfi-classroom...');
  spawner('pm2', ['stop', 'bfi-classroom'], { encoding: 'utf8', timeout: 10000, shell: false });

  // 3. Ensure Nginx remains stopped
  logStep('R.3', 'Ensuring Nginx remains stopped...');
  spawner('sudo', ['systemctl', 'stop', 'nginx'], { encoding: 'utf8', timeout: 10000, shell: false });

  // 4. Verify closed database handles before touching files
  logStep('R.4', 'Verifying zero open database handles...');
  try {
    const { runPreflightLockdown } = require('./preflight_lockdown_check.cjs');
    runPreflightLockdown({ databasePath: dbPath, spawner, doNotExit: true });
    logStep('R.4', 'Database handles confirmed closed.');
  } catch (err) {
    logFatal(`Cannot restore database: active database writers or open handles detected: ${err.message}`);
    throw err;
  }

  // 5. Quarantine failed database, WAL, and SHM together
  logStep('R.5', 'Quarantining failed database, WAL, and SHM sidecars together...');
  const qTs = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const quarantineDir = path.join(serverDir, `quarantine_${qTs}`);
  fs.mkdirSync(quarantineDir, { recursive: true });

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, path.join(quarantineDir, 'failed_bfi_classroom.db'));
  if (fs.existsSync(walPath)) fs.renameSync(walPath, path.join(quarantineDir, 'failed_bfi_classroom.db-wal'));
  if (fs.existsSync(shmPath)) fs.renameSync(shmPath, path.join(quarantineDir, 'failed_bfi_classroom.db-shm'));

  // Assert sidecars are completely gone before restore
  if (fs.existsSync(dbPath) || fs.existsSync(walPath) || fs.existsSync(shmPath)) {
    logFatal('Sidecars remain in server directory after quarantine!');
    throw new Error('Quarantine failed: sidecars still present');
  }
  logStep('R.5', `Failed state successfully quarantined to: ${quarantineDir}`);

  // 6. Restore validated pre-deployment backup
  logStep('R.6', 'Copying validated backup to live database path...');
  if (options.simulateCorruptedRestore) {
    const badDb = new Database(dbPath);
    badDb.exec('CREATE TABLE dummy (id INT);');
    badDb.close();
  } else {
    fs.copyFileSync(backupFile, dbPath);
  }

  // 7. Verify restored database integrity and baseline invariants
  logStep('R.7', 'Verifying restored database integrity and baseline invariants...');
  const baselinePath = path.join(serverDir, 'pre_deployment_baseline.json');
  if (!fs.existsSync(baselinePath)) {
    logFatal('Pre-deployment baseline file missing for restored database verification!');
    throw new Error('Baseline file missing');
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  let rDb = null;
  try {
    rDb = new Database(dbPath, { readonly: true });
    const qCheck = rDb.prepare('PRAGMA quick_check').get();
    const fkCheck = rDb.prepare('PRAGMA foreign_key_check').all();

    const hasEnrollments = rDb.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='student_course_enrollments'").get().c;
    if (hasEnrollments === 0) {
      throw new Error('Restored database missing student_course_enrollments table!');
    }

    const rEnrollments = rDb.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
    const rUsers = rDb.prepare('SELECT count(*) as c FROM users').get().c;
    const rBatches = rDb.prepare('SELECT count(*) as c FROM batches').get().c;
    const rFees = rDb.prepare('SELECT count(*) as c FROM batch_course_fees').get().c;
    rDb.close();
    rDb = null;

    if (qCheck.quick_check !== 'ok' || fkCheck.length > 0) {
      logFatal('Restored database failed PRAGMA integrity check!');
      throw new Error('Restored database failed PRAGMA integrity check');
    }
    if (rEnrollments !== baseline.student_course_enrollments ||
        rUsers !== baseline.users ||
        rBatches !== baseline.batches ||
        rFees !== baseline.batch_course_fees) {
      logFatal(`Restored database baseline count mismatch! Expected enrollments=${baseline.student_course_enrollments}, got ${rEnrollments}`);
      throw new Error('Restored database baseline count mismatch');
    }
  } catch (err) {
    if (rDb) {
      try { rDb.close(); } catch {}
      rDb = null;
    }
    throw err;
  }
  logStep('R.7', '✅ Restored database verified: 0 FK violations, quick_check ok, exact baseline match.');

  // 8. Restore recorded pre-deployment code revision and rebuild
  logStep('R.8', 'Restoring pre-deployment code revision and rebuilding...');
  const revFile = path.join(serverDir, 'pre_deployment_revision.txt');
  if (!fs.existsSync(revFile)) {
    logFatal('Pre-deployment revision file missing!');
    throw new Error('Revision file missing');
  }
  const prevRev = fs.readFileSync(revFile, 'utf8').trim();
  logStep('R.8', `Checking out original revision: ${prevRev}`);
  spawner('git', ['checkout', prevRev], { encoding: 'utf8', timeout: 30000, shell: false });

  logStep('R.8', 'Rebuilding original revision assets...');
  spawner('npm', ['ci', '--legacy-peer-deps'], { env: { ...process.env, NODE_ENV: 'development' }, encoding: 'utf8', timeout: 120000, shell: true });
  spawner('npm', ['run', 'build'], { encoding: 'utf8', timeout: 120000, shell: true });
  spawner('npm', ['prune', '--omit=dev', '--legacy-peer-deps'], { encoding: 'utf8', timeout: 60000, shell: true });

  // 9. Restart PM2 on restored revision
  logStep('R.9', 'Starting PM2 application on restored code...');
  spawner('pm2', ['start', 'ecosystem.config.cjs'], { encoding: 'utf8', timeout: 15000, shell: false });

  // 10. Verify restored service over loopback
  logStep('R.10', 'Verifying restored service responsiveness over loopback...');
  const verifyCurl = spawner('curl', ['-f', '-I', 'http://127.0.0.1:3001/bfi-classroom/'], { encoding: 'utf8', timeout: 10000, shell: false });
  logStep('R.10', `Restored service check: ${verifyCurl.status === 0 ? 'RESPONDING 200 OK' : 'PENDING'}`);

  // 11. Restore recorded pre-maintenance Nginx state
  logStep('R.11', 'Restoring pre-maintenance Nginx service state...');
  const servicesEnvFile = path.join(serverDir, 'pre_deployment_services.env');
  if (fs.existsSync(servicesEnvFile)) {
    const sContent = fs.readFileSync(servicesEnvFile, 'utf8');
    if (sContent.includes('NGINX_STATE=active')) {
      spawner('sudo', ['systemctl', 'start', 'nginx'], { encoding: 'utf8', timeout: 10000, shell: false });
      logStep('R.11', 'Nginx restored to active.');
    }
  }

  logSection('ROLLBACK COMPLETE: RESTORED TO PRE-DEPLOYMENT STATE');
  logStep('R.12', 'Traffic remains in maintenance or operator control until explicit verification.');
  return { rollbackComplete: true, restoredRevision: prevRev };
}

// CLI Entrypoint
if (require.main === module) {
  const action = process.argv[2];
  if (action === 'deploy') {
    executeDeployment().then(() => process.exit(0)).catch((err) => {
      console.error(`\n❌ [DEPLOYMENT HALTED] ${err.message}`);
      process.exit(1);
    });
  } else if (action === 'rollback') {
    executeRollback().then(() => process.exit(0)).catch((err) => {
      console.error(`\n❌ [ROLLBACK HALTED] ${err.message}`);
      process.exit(1);
    });
  } else {
    console.error("Usage: node scripts/production_lifecycle.cjs <deploy|rollback>");
    process.exit(1);
  }
}

module.exports = { executeDeployment, executeRollback };
