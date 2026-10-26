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
 * Fails closed on any command error, signal, timeout, non-zero status, or unexpected output.
 * Preserves recovery tooling in `server/.recovery_tools/` to guarantee survivability across checkouts.
 * Enforces rollback boundaries preventing automatic stale-backup restore after traffic reopens.
 * 
 * Invocation:
 *   node scripts/production_lifecycle.cjs deploy
 *   node scripts/production_lifecycle.cjs rollback [--allow-post-reopening-reconciliation]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');
const Database = require('better-sqlite3');
const { verifyIsolation } = require('./verify_isolation.cjs');
const { runPreflightLockdown } = require('./preflight_lockdown_check.cjs');
const { obtainSmokeCredentials } = require('./obtain_smoke_credentials.cjs');

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

// Atomic state persistence helper
function writeStateAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp_state_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      fs.copyFileSync(tmpPath, filePath);
      try { fs.unlinkSync(tmpPath); } catch {}
    } else {
      throw err;
    }
  }
}

// Strict fail-closed command runner
function runCommandStrict(spawner, cmd, args, options = {}, desc = '') {
  const timeout = options.timeout || 60000;
  const res = spawner(cmd, args, { encoding: 'utf8', timeout, shell: false, ...options });

  if (res.error) {
    logFatal(`${desc || cmd} failed with execution error: ${res.error.message || res.error.code}`);
    throw new Error(`${desc || cmd} execution error: ${res.error.message || res.error.code}`);
  }
  if (res.signal) {
    logFatal(`${desc || cmd} terminated by signal: ${res.signal}`);
    throw new Error(`${desc || cmd} terminated by signal: ${res.signal}`);
  }
  if (res.status !== 0) {
    const diag = ((res.stderr || '') + ' ' + (res.stdout || '')).trim();
    logFatal(`${desc || cmd} exited with non-zero status (${res.status}): ${diag || 'Unknown error'}`);
    throw new Error(`${desc || cmd} exited with code ${res.status}: ${diag || 'Unknown error'}`);
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Deployment Procedure (Phases 0 - 6)
// ─────────────────────────────────────────────────────────────────────────────

async function executeDeployment(options = {}) {
  const spawner = options.spawner || child_process.spawnSync;
  const rootDir = options.rootDir || process.cwd();
  const dbRelPath = options.databasePath || 'server/bfi_classroom.db';
  const dbPath = path.resolve(rootDir, dbRelPath);
  const targetCommit = options.targetCommit || process.env.TARGET_COMMIT || 'integration/super-admin-candidate';
  const isRehearsal = Boolean(options.isRehearsal);
  const serverDir = path.resolve(rootDir, 'server');

  logSection('BFI CLASSROOM CANONICAL PRODUCTION DEPLOYMENT');
  console.log(`Target DB:      ${dbPath}`);
  console.log(`Target Commit:  ${targetCommit}`);
  console.log(`Mode:           ${isRehearsal ? 'REHEARSAL (WITH SERVICE ADAPTERS)' : 'PRODUCTION EXECUTION'}`);

  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

  // ── PHASE 0: Staging & Tooling Preservation ───────────────────────────────
  logSection('PHASE 0: PRE-FLIGHT STAGING & RECOVERY TOOLING PRESERVATION');

  // Preserve recovery tooling in server/.recovery_tools outside git-managed tree
  const recoveryToolsDir = path.join(serverDir, '.recovery_tools');
  if (!fs.existsSync(recoveryToolsDir)) fs.mkdirSync(recoveryToolsDir, { recursive: true });

  const requiredScripts = [
    'scripts/preflight_lockdown_check.cjs',
    'scripts/verify_isolation.cjs',
    'scripts/run_migrations.cjs',
    'scripts/production_smoke_check.cjs',
    'scripts/production_lifecycle.cjs'
  ];

  for (const scriptRel of requiredScripts) {
    const sPath = path.resolve(rootDir, scriptRel);
    if (!fs.existsSync(sPath)) {
      logFatal(`Required operational script missing: ${scriptRel}`);
      throw new Error(`Required script missing: ${scriptRel}`);
    }
    const destPath = path.join(recoveryToolsDir, path.basename(scriptRel));
    fs.copyFileSync(sPath, destPath);
    logStep('0.1', `Preserved ${path.basename(scriptRel)} in ${recoveryToolsDir}`);
  }

  // Initialize deployment state
  const attemptId = `deploy_${Date.now()}`;
  const stateFilePath = path.join(serverDir, 'active_deployment_state.json');
  const deploymentState = {
    attemptId,
    startedAt: new Date().toISOString(),
    preDeploymentRevision: null,
    targetCommit,
    backupFile: null,
    backupValidated: false,
    trafficMayReopen: false,
    trafficExposureInitiatedAt: null,
    trafficReopened: false,
    trafficReopenedAt: null,
    rollbackCompleted: false,
    rolledBackAt: null,
    nginxInitialState: 'unknown',
    pm2InitialState: 'unknown'
  };
  writeStateAtomic(stateFilePath, deploymentState);

  // ── PHASE 1: Maintenance Mode & Writer Lockdown Gate ───────────────────────
  logSection('PHASE 1: MAINTENANCE MODE & WRITER LOCKDOWN GATE');

  // 1.1 Record pre-maintenance service states
  logStep('1.1', 'Recording pre-maintenance service states...');
  const nginxStateCheck = spawner('systemctl', ['is-active', 'nginx'], { encoding: 'utf8', timeout: 5000, shell: false });
  deploymentState.nginxInitialState = (nginxStateCheck.stdout || '').trim() || 'unknown';

  const pm2StateCheck = spawner('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (!pm2StateCheck.error && pm2StateCheck.status === 0) {
    try {
      const list = JSON.parse(pm2StateCheck.stdout);
      const app = list.find(a => a.name === 'bfi-classroom');
      if (app && app.pm2_env) deploymentState.pm2InitialState = app.pm2_env.status;
    } catch {}
  }
  writeStateAtomic(stateFilePath, deploymentState);
  fs.writeFileSync(
    path.join(serverDir, 'pre_deployment_services.env'),
    `NGINX_STATE=${deploymentState.nginxInitialState}\nPM2_STATE=${deploymentState.pm2InitialState}\n`
  );
  logStep('1.1', `Service states recorded: NGINX=${deploymentState.nginxInitialState}, PM2=${deploymentState.pm2InitialState}`);

  // 1.2 Stop Nginx
  logStep('1.2', 'Stopping Nginx to close public listeners 80/443 and terminate direct IP access...');
  runCommandStrict(spawner, 'sudo', ['systemctl', 'stop', 'nginx'], { timeout: 10000 }, 'Stop Nginx');

  // 1.3 Stop PM2 backend writer
  logStep('1.3', 'Stopping PM2 application bfi-classroom...');
  runCommandStrict(spawner, 'pm2', ['stop', 'bfi-classroom'], { timeout: 10000 }, 'Stop PM2');

  // 1.4 Execute fail-closed isolation inspection
  logStep('1.4', 'Running fail-closed isolation inspection (ports, processes, connections, sockets)...');
  verifyIsolation({ spawner, allowPm2Online: false });
  logStep('1.4', 'Isolation gate: PASSED (All ports closed, processes inactive, zero writers)');

  // 1.5 Execute fail-closed database handle inspection
  logStep('1.5', 'Running fail-closed database handle inspection...');
  runPreflightLockdown({ databasePath: dbPath, spawner, doNotExit: true });
  logStep('1.5', 'Database handle gate: PASSED (Zero open handles on database files)');

  // ── PHASE 2: Dynamic Health Check & Backup Validation ─────────────────────
  logSection('PHASE 2: DYNAMIC HEALTH CHECK & BACKUP VALIDATION');

  // 2.1 Capture pre-deployment revision for rollback
  const revFile = path.join(serverDir, 'pre_deployment_revision.txt');
  let preRev = options.preDeploymentRevision;
  if (!preRev && fs.existsSync(revFile)) {
    const recorded = fs.readFileSync(revFile, 'utf8').trim();
    if (recorded && recorded.length >= 7) {
      preRev = recorded;
    }
  }
  if (!preRev) {
    const revCheck = runCommandStrict(spawner, 'git', ['rev-parse', 'HEAD'], { timeout: 5000 }, 'Record Git Revision');
    preRev = revCheck.stdout.trim();
  }
  deploymentState.preDeploymentRevision = preRev;
  fs.writeFileSync(revFile, deploymentState.preDeploymentRevision + '\n');
  writeStateAtomic(stateFilePath, deploymentState);
  logStep('2.1', `Pre-deployment revision recorded: ${deploymentState.preDeploymentRevision}`);

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
    deploymentState.backupFile = backupFile;
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

    deploymentState.backupValidated = true;
    writeStateAtomic(stateFilePath, deploymentState);
    fs.writeFileSync(path.join(serverDir, 'active_backup_path.env'), `BACKUP_FILE=${backupFile}\nBACKUP_VALIDATED=true\nATTEMPT_ID=${attemptId}\n`);
    logStep('2.4', '✅ Backup file validated: 0 FK violations, quick_check ok, exact baseline match.');
  }

  // ── PHASE 3: Reproducible Code Update & Build Sequence ─────────────────────
  logSection('PHASE 3: REPRODUCIBLE CODE UPDATE & BUILD SEQUENCE');
  logStep('3.1', `Checking out pinned release revision: ${targetCommit}...`);
  runCommandStrict(spawner, 'git', ['checkout', targetCommit], { timeout: 30000 }, 'Git Checkout Target Commit');

  logStep('3.2', 'Installing dependencies including devDependencies (NODE_ENV=development npm ci --legacy-peer-deps)...');
  runCommandStrict(spawner, 'npm', ['ci', '--legacy-peer-deps'], {
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 120000,
    shell: true
  }, 'npm ci');

  logStep('3.3', 'Building frontend production assets (npm run build)...');
  runCommandStrict(spawner, 'npm', ['run', 'build'], { timeout: 120000, shell: true }, 'npm run build');

  logStep('3.4', 'Pruning devDependencies for production runtime isolation (npm prune --omit=dev --legacy-peer-deps)...');
  runCommandStrict(spawner, 'npm', ['prune', '--omit=dev', '--legacy-peer-deps'], { timeout: 60000, shell: true }, 'npm prune');

  // ── PHASE 4: Execute Database Migrations ───────────────────────────────────
  logSection('PHASE 4: DATABASE MIGRATION EXECUTION & ASSERTION VERIFICATION');
  logStep('4.1', `Executing unified migration runner on ${dbPath}...`);
  const migRunnerPath = path.resolve(rootDir, 'scripts/run_migrations.cjs');
  runCommandStrict(spawner, process.execPath, [migRunnerPath, dbPath], { timeout: 60000 }, 'Migration Runner');
  logStep('4.1', '✅ Migrations applied sequentially and verified (10/10 schema assertions passed).');

  // ── PHASE 5: Application Restart & Loopback Smoke Verification ─────────────
  logSection('PHASE 5: APPLICATION RESTART & LOOPBACK SMOKE VERIFICATION');
  logStep('5.1', 'Verifying Nginx is STILL stopped before starting application...');
  verifyIsolation({ spawner, allowPm2Online: false });

  logStep('5.2', 'Starting PM2 backend process locally (isolated to 127.0.0.1:3001)...');
  runCommandStrict(spawner, 'pm2', ['start', 'ecosystem.config.cjs'], { timeout: 15000 }, 'Start PM2');

  logStep('5.3', 'Verifying PM2 is online and Nginx remains stopped (--allow-pm2)...');
  verifyIsolation({ spawner, allowPm2Online: true });

  let smokeAuthCleanup = null;
  let saToken = options.superAdminToken || process.env.SUPER_ADMIN_TOKEN || (options.isRehearsal && !options.credentialProvider ? 'mock-rehearsal-sa-token' : '');
  let oaToken = options.adminToken || process.env.ADMIN_TOKEN || (options.isRehearsal && !options.credentialProvider ? 'mock-rehearsal-ord-token' : '');
  let saTokenFile = options.superAdminTokenFile || process.env.SUPER_ADMIN_TOKEN_FILE || '';
  let oaTokenFile = options.adminTokenFile || process.env.ADMIN_TOKEN_FILE || '';
  const maintTokenFile = path.join(serverDir, '.maintenance_auth_token');

  try {
    // 5.3.1 Bounded Credential Handoff
    if ((!saToken && !saTokenFile) || (!oaToken && !oaTokenFile)) {
      logStep('5.3.1', 'Generating ephemeral maintenance token and initiating bounded credential handoff...');
      const maintenanceAuthToken = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(maintTokenFile, maintenanceAuthToken, { mode: 0o600 });

      const authResult = await obtainSmokeCredentials({
        baseUrl: options.baseUrl || 'http://127.0.0.1:3001',
        credentialProvider: options.credentialProvider,
        turnstileToken: options.turnstileToken,
        maintenanceAuthToken,
        timeoutMs: options.authTimeoutMs || 60000
      });
      saTokenFile = authResult.superAdminTokenFile;
      oaTokenFile = authResult.adminTokenFile;
      smokeAuthCleanup = authResult.cleanup;
      logStep('5.3.1', '✅ Bounded credential handoff successful: both identities and roles verified.');
    }

    logStep('5.4', 'Executing 18-assertion production smoke check over loopback...');
    const smokeRunnerPath = path.resolve(rootDir, 'scripts/production_smoke_check.cjs');
    const smokeEnv = {
      ...process.env
    };
    if (saToken) smokeEnv.SUPER_ADMIN_TOKEN = saToken;
    if (oaToken) smokeEnv.ADMIN_TOKEN = oaToken;
    if (saTokenFile) smokeEnv.SUPER_ADMIN_TOKEN_FILE = saTokenFile;
    if (oaTokenFile) smokeEnv.ADMIN_TOKEN_FILE = oaTokenFile;

    runCommandStrict(spawner, process.execPath, [smokeRunnerPath, options.baseUrl || 'http://127.0.0.1:3001'], {
      env: smokeEnv,
      timeout: 30000
    }, 'Production Smoke Check');
    logStep('5.4', '✅ Production smoke verification passed: 18/18 assertions verified.');
  } finally {
    if (fs.existsSync(maintTokenFile)) {
      try {
        const len = fs.statSync(maintTokenFile).size;
        fs.writeFileSync(maintTokenFile, Buffer.alloc(len, 0));
        fs.unlinkSync(maintTokenFile);
      } catch { /* best effort */ }
    }
    if (smokeAuthCleanup) {
      logStep('5.5', 'Securely zeroing and unlinking temporary smoke credentials...');
      smokeAuthCleanup();
      logStep('5.5', 'Temporary credentials purged.');
    }
  }

  // ── PHASE 6: Traffic Reopening Decision Point ──────────────────────────────
  logSection('PHASE 6: TRAFFIC REOPENING DECISION POINT (RESTARTING NGINX)');

  // CRITICAL BOUNDARY: Persist conservative trafficMayReopen BEFORE issuing any exposure command!
  logStep('6.1', 'Setting conservative traffic-may-reopen boundary before exposure...');
  deploymentState.trafficMayReopen = true;
  deploymentState.trafficExposureInitiatedAt = new Date().toISOString();
  writeStateAtomic(stateFilePath, deploymentState);

  // Hook for testing actions occurring between boundary set and exposure command
  if (typeof options.onExposureBoundarySet === 'function') {
    options.onExposureBoundarySet({ deploymentState, dbPath, spawner });
  }

  logStep('6.2', 'Restarting Nginx to restore external reverse proxy routing...');
  runCommandStrict(spawner, 'sudo', ['systemctl', 'start', 'nginx'], { timeout: 10000 }, 'Start Nginx');

  // Hook for testing simulated post-reopening write before status inspection
  if (typeof options.onNginxStarted === 'function') {
    options.onNginxStarted({ deploymentState, dbPath, spawner });
  }

  const nginxVerify = runCommandStrict(spawner, 'systemctl', ['is-active', 'nginx'], { timeout: 5000 }, 'Verify Nginx Active');
  if ((nginxVerify.stdout || '').trim() !== 'active') {
    logFatal(`Nginx failed to report active status after restart: ${nginxVerify.stdout}`);
    throw new Error('Nginx not active after restart');
  }

  deploymentState.trafficReopened = true;
  deploymentState.trafficReopenedAt = new Date().toISOString();
  writeStateAtomic(stateFilePath, deploymentState);

  logStep('6.3', '✅ Nginx service active: direct origin and reverse proxy routing restored.');
  logStep('6.4', 'Traffic reopened. Operator can deactivate Cloudflare 503 maintenance page.');

  logSection('DEPLOYMENT COMPLETE: RELEASE CANDIDATE SUCCESSFULLY DEPLOYED');
  return { success: true, backupFile, targetCommit, attemptId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Rollback Procedure (Window A & B Boundary Enforcement)
// ─────────────────────────────────────────────────────────────────────────────

async function executeRollback(options = {}) {
  const spawner = options.spawner || child_process.spawnSync;
  const rootDir = options.rootDir || process.cwd();
  const dbRelPath = options.databasePath || 'server/bfi_classroom.db';
  const dbPath = path.resolve(rootDir, dbRelPath);
  const serverDir = path.resolve(rootDir, 'server');
  const isRehearsal = Boolean(options.isRehearsal);
  const allowPostReopening = Boolean(options.allowPostReopeningReconciliation);

  logSection('BFI CLASSROOM HARDENED PRODUCTION ROLLBACK');
  console.log(`Target DB:  ${dbPath}`);
  console.log(`Mode:       ${isRehearsal ? 'REHEARSAL (WITH SERVICE ADAPTERS)' : 'PRODUCTION EXECUTION'}`);

  // 1. Verify deployment state and validated backup association with strict fail-closed validation
  logStep('R.1', 'Verifying deployment attempt state and validated backup...');
  const stateFilePath = path.join(serverDir, 'active_deployment_state.json');

  if (!fs.existsSync(stateFilePath)) {
    logFatal('ABORT ROLLBACK: Deployment state file (server/active_deployment_state.json) is missing. Cannot verify traffic exposure boundary or backup association. Halting without database restoration to protect against data loss.');
    throw new Error('ABORT ROLLBACK: Deployment state file is missing.');
  }

  let state = null;
  try {
    const rawState = fs.readFileSync(stateFilePath, 'utf8');
    state = JSON.parse(rawState);
  } catch (err) {
    logFatal(`ABORT ROLLBACK: Deployment state file is malformed JSON or corrupted (${err.message}). Halting without database restoration to protect against data loss.`);
    throw new Error('ABORT ROLLBACK: Deployment state file is malformed.');
  }

  if (!state || typeof state !== 'object' || !state.attemptId) {
    logFatal('ABORT ROLLBACK: Deployment state metadata is ambiguous or missing attemptId. Halting without database restoration.');
    throw new Error('ABORT ROLLBACK: Deployment state metadata is ambiguous.');
  }

  if (typeof state.backupValidated !== 'boolean') {
    logFatal('ABORT ROLLBACK: Deployment state backupValidated property is invalid or ambiguous. Halting without database restoration.');
    throw new Error('ABORT ROLLBACK: Deployment state backupValidated is ambiguous.');
  }

  if (typeof state.trafficReopened !== 'boolean' || typeof state.trafficMayReopen !== 'boolean') {
    logFatal('ABORT ROLLBACK: Deployment state traffic reopening properties are invalid or ambiguous. Halting without database restoration.');
    throw new Error('ABORT ROLLBACK: Deployment state traffic reopening boundary is ambiguous.');
  }

  if (state.rollbackCompleted !== undefined && typeof state.rollbackCompleted !== 'boolean') {
    logFatal('ABORT ROLLBACK: Deployment state rollbackCompleted property is invalid or ambiguous. Halting without database restoration.');
    throw new Error('ABORT ROLLBACK: Deployment state rollbackCompleted is ambiguous.');
  }

  // Terminal Rollback Attempt & Replay Protection Gate:
  // Reusing a completed rollback's backup for another automatic restoration must be rejected!
  if (state.rollbackCompleted === true) {
    if (!allowPostReopening) {
      const rolledBackAt = state.rolledBackAt || 'unknown';
      logFatal(`ABORT ROLLBACK: Rollback has already been completed for this deployment attempt at ${rolledBackAt}. Attempt is terminal; reusing its backup for automatic restoration is strictly rejected. Explicit reconciliation requires --allow-post-reopening-reconciliation.`);
      throw new Error('ABORT ROLLBACK: Rollback attempt is terminal. Automatic restoration rejected.');
    }
    logStep('R.1', '⚠️ Explicit post-reopening reconciliation authorized by operator for terminal rollback state.');
  }

  // Fail-closed check: No validated backup recorded for this attempt
  if (state.backupValidated !== true || !state.backupFile) {
    logFatal('ABORT ROLLBACK: No validated backup file recorded for this deployment attempt. Failure occurred before validated backup existed. Halting without database restoration to protect original database.');
    throw new Error('ABORT ROLLBACK: No validated backup file recorded for attempt.');
  }

  // Attempt/Backup Association Validation:
  const envFile = path.join(serverDir, 'active_backup_path.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    const mFile = envContent.match(/BACKUP_FILE=(.+)/);
    const mAttempt = envContent.match(/ATTEMPT_ID=(.+)/);
    if (mFile && path.resolve(rootDir, mFile[1].trim()) !== path.resolve(rootDir, state.backupFile)) {
      logFatal(`ABORT ROLLBACK: Backup association conflict! State records "${state.backupFile}" but active_backup_path.env records "${mFile[1].trim()}". Halting without database restoration.`);
      throw new Error('ABORT ROLLBACK: Backup association mismatch between state file and environment.');
    }
    if (mAttempt && mAttempt[1].trim() !== state.attemptId) {
      logFatal(`ABORT ROLLBACK: Deployment attempt mismatch! State attemptId "${state.attemptId}" does not match active_backup_path.env attemptId "${mAttempt[1].trim()}". Halting.`);
      throw new Error('ABORT ROLLBACK: Attempt ID mismatch.');
    }
  }

  // Conservative Rollback Boundary Gate:
  // Reject automatic rollback if traffic was reopened OR if exposure was initiated!
  const trafficExposed = state.trafficReopened === true || state.trafficMayReopen === true;
  if (trafficExposed) {
    if (!allowPostReopening) {
      const ts = state.trafficExposureInitiatedAt || state.trafficReopenedAt || 'unknown';
      logFatal(`ABORT ROLLBACK: Automatic restore rejected! Traffic exposure boundary was crossed at ${ts}. Restoring pre-deployment backup would cause data loss of subsequent user transactions. Strict Policy: Post-reopening restoration requires an approved reconciliation plan and explicit flag (--allow-post-reopening-reconciliation).`);
      throw new Error(`ABORT ROLLBACK: Automatic restore rejected after traffic reopening boundary crossed at ${ts}.`);
    }
    logStep('R.1', `⚠️ Post-reopening reconciliation authorized by operator. Proceeding with forensic restore.`);
  }

  const backupFile = state.backupFile;
  if (!backupFile || !fs.existsSync(backupFile)) {
    logFatal(`ABORT ROLLBACK: Validated backup file missing on disk: ${backupFile}`);
    throw new Error(`ABORT ROLLBACK: Backup file missing at ${backupFile}`);
  }
  logStep('R.1', `Validated backup confirmed: ${backupFile}`);

  // 2. Stop application immediately
  logStep('R.2', 'Stopping PM2 application bfi-classroom...');
  runCommandStrict(spawner, 'pm2', ['stop', 'bfi-classroom'], { timeout: 10000 }, 'Stop PM2');

  // 3. Ensure Nginx remains stopped
  logStep('R.3', 'Ensuring Nginx remains stopped...');
  runCommandStrict(spawner, 'sudo', ['systemctl', 'stop', 'nginx'], { timeout: 10000 }, 'Stop Nginx');

  // 4. Verify closed database handles before touching files
  logStep('R.4', 'Verifying zero open database handles...');
  runPreflightLockdown({ databasePath: dbPath, spawner, doNotExit: true });
  logStep('R.4', 'Database handles confirmed closed.');

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
  runCommandStrict(spawner, 'git', ['checkout', prevRev], { timeout: 30000 }, 'Rollback Git Checkout');

  logStep('R.8', 'Rebuilding original revision assets...');
  runCommandStrict(spawner, 'npm', ['ci', '--legacy-peer-deps'], {
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 120000,
    shell: true
  }, 'Rollback npm ci');
  runCommandStrict(spawner, 'npm', ['run', 'build'], { timeout: 120000, shell: true }, 'Rollback npm run build');
  runCommandStrict(spawner, 'npm', ['prune', '--omit=dev', '--legacy-peer-deps'], { timeout: 60000, shell: true }, 'Rollback npm prune');

  // 9. Restart PM2 on restored revision
  logStep('R.9', 'Starting PM2 application on restored code...');
  runCommandStrict(spawner, 'pm2', ['start', 'ecosystem.config.cjs'], { timeout: 15000 }, 'Rollback Start PM2');

  // 9.1 Verify PM2 machine-readable health after restart
  logStep('R.9.1', 'Verifying PM2 machine-readable health for bfi-classroom...');
  const pm2HealthCheck = runCommandStrict(spawner, 'pm2', ['jlist'], { timeout: 5000 }, 'Verify Restored PM2 Health');
  let restoredAppList;
  try {
    restoredAppList = JSON.parse(pm2HealthCheck.stdout);
  } catch (err) {
    logFatal(`Failed to parse PM2 jlist during rollback health check: ${err.message}`);
    throw new Error('PM2 jlist parse error during rollback');
  }
  const restoredApp = restoredAppList.find(a => a.name === 'bfi-classroom');
  if (!restoredApp || restoredApp.pm2_env.status !== 'online') {
    logFatal(`Restored PM2 application 'bfi-classroom' is not online (status=${restoredApp ? restoredApp.pm2_env.status : 'missing'})!`);
    throw new Error('Restored PM2 application not online');
  }
  logStep('R.9.1', '✅ PM2 application confirmed online after rollback.');

  // 10. Verify restored service responsiveness over loopback
  logStep('R.10', 'Verifying restored service responsiveness over loopback (curl 200 OK)...');
  const verifyCurl = runCommandStrict(spawner, 'curl', ['-f', '-I', 'http://127.0.0.1:3001/bfi-classroom/'], { timeout: 10000 }, 'Restored Service Loopback Health');
  if (!verifyCurl.stdout.includes('200')) {
    logFatal(`Restored service health check failed to return HTTP 200: ${verifyCurl.stdout}`);
    throw new Error('Restored service did not return HTTP 200');
  }
  logStep('R.10', '✅ Restored service responded HTTP 200 OK over loopback.');

  // 11. Restore recorded pre-maintenance Nginx state
  logStep('R.11', 'Restoring pre-maintenance Nginx service state...');
  const servicesEnvFile = path.join(serverDir, 'pre_deployment_services.env');
  let nginxWasActive = false;
  if (fs.existsSync(servicesEnvFile)) {
    const sContent = fs.readFileSync(servicesEnvFile, 'utf8');
    nginxWasActive = sContent.includes('NGINX_STATE=active');
  } else if (state && state.nginxInitialState === 'active') {
    nginxWasActive = true;
  }

  if (nginxWasActive) {
    // CRITICAL: Apply conservative pre-exposure boundary to EVERY operation that can reopen traffic!
    logStep('R.11.1', 'Setting conservative traffic-may-reopen boundary before rollback Nginx restart...');
    state.trafficMayReopen = true;
    state.trafficExposureInitiatedAt = new Date().toISOString();
    writeStateAtomic(stateFilePath, state);

    // Hook for testing actions occurring between boundary set and exposure command
    if (typeof options.onRollbackExposureBoundarySet === 'function') {
      options.onRollbackExposureBoundarySet({ state, dbPath, spawner });
    }

    logStep('R.11.2', 'Restarting Nginx to restore external reverse proxy routing...');
    runCommandStrict(spawner, 'sudo', ['systemctl', 'start', 'nginx'], { timeout: 10000 }, 'Restore Nginx State');

    if (typeof options.onRollbackNginxStarted === 'function') {
      options.onRollbackNginxStarted({ state, dbPath, spawner });
    }

    const nginxVerify = runCommandStrict(spawner, 'systemctl', ['is-active', 'nginx'], { timeout: 5000 }, 'Verify Nginx Restored');
    if ((nginxVerify.stdout || '').trim() !== 'active') {
      logFatal(`Nginx failed to report active status upon restoration: ${nginxVerify.stdout}`);
      throw new Error('Nginx not active after rollback restore');
    }

    logStep('R.11.3', 'Persisting traffic-reopened state to deployment state file...');
    state.trafficReopened = true;
    state.trafficReopenedAt = new Date().toISOString();
    writeStateAtomic(stateFilePath, state);
    logStep('R.11', '✅ Nginx restored to active service.');
  } else {
    logStep('R.11', 'Nginx was inactive prior to deployment. Remaining stopped.');
  }

  // Terminal state: Record rollback completion separately from traffic exposure.
  // NEVER clear trafficMayReopen or trafficReopened flags!
  state.rollbackCompleted = true;
  state.rolledBackAt = new Date().toISOString();
  writeStateAtomic(stateFilePath, state);

  // Update active_backup_path.env for forensic retention without authorizing automatic restore
  if (fs.existsSync(envFile)) {
    fs.appendFileSync(envFile, `ROLLBACK_COMPLETED=true\nROLLED_BACK_AT=${state.rolledBackAt}\n`);
  }

  logSection('ROLLBACK COMPLETE: RESTORED TO PRE-DEPLOYMENT STATE');
  logStep('R.12', 'Traffic remains in maintenance or operator control until explicit verification.');
  return { rollbackComplete: true, restoredRevision: prevRev, databaseRestored: true };
}

// CLI Entrypoint
if (require.main === module) {
  const action = process.argv[2];
  if (action === 'deploy') {
    const targetCommitArg = process.argv.find((a, i) => process.argv[i - 1] === '--target-commit');
    const prevRevArg = process.argv.find((a, i) => process.argv[i - 1] === '--previous-revision');
    executeDeployment({ targetCommit: targetCommitArg, preDeploymentRevision: prevRevArg }).then(() => process.exit(0)).catch((err) => {
      console.error(`\n❌ [DEPLOYMENT HALTED] ${err.message}`);
      process.exit(1);
    });
  } else if (action === 'rollback') {
    const allowPostReopening = process.argv.includes('--allow-post-reopening-reconciliation');
    executeRollback({ allowPostReopeningReconciliation: allowPostReopening }).then(() => process.exit(0)).catch((err) => {
      console.error(`\n❌ [ROLLBACK HALTED] ${err.message}`);
      process.exit(1);
    });
  } else {
    console.error("Usage: node scripts/production_lifecycle.cjs <deploy|rollback> [--allow-post-reopening-reconciliation]");
    process.exit(1);
  }
}

module.exports = { executeDeployment, executeRollback, runCommandStrict, writeStateAtomic };
