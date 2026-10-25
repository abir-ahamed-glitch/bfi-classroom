/**
 * scripts/preflight_lockdown_check.cjs
 *
 * Strict, fail-closed maintenance preflight verification gate.
 * Verifies writer lockdown, absence of open database handles,
 * reliable handle-inspection tooling, and complete WAL truncation
 * before final pre-deployment database backup.
 *
 * Exits with code 0 ONLY if all safety invariants pass.
 * Exits with code 1 immediately upon ANY anomaly, handle presence, missing tool,
 * unreadable file, busy checkpoint, permission denial, or unexpected error.
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const Database = require('better-sqlite3');

function logInfo(msg) {
  console.log(`[PREFLIGHT LOCKDOWN] ${msg}`);
}

function logError(msg) {
  console.error(`[PREFLIGHT GATE FATAL] ${msg}`);
}

// 1. Resolve configured database path
function resolveDatabasePath(options = {}) {
  const dbEnv = options.databasePath || process.env.DATABASE_PATH || 'server/bfi_classroom.db';
  const resolved = path.resolve(process.cwd(), dbEnv);
  logInfo(`Resolved target database path: ${resolved}`);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Target database file does not exist at "${resolved}".`);
  }
  return resolved;
}

// 2. Confirm application and background writers are stopped
function checkWritersStopped(options = {}) {
  const spawner = options.spawner || child_process.spawnSync;

  if (process.env.TEST_MOCK_WRITER_RUNNING === 'true') {
    throw new Error(`Active writer process detected: 'bfi-classroom' (PID: 9999) is in status 'online'. All application writers must be stopped.`);
  }

  // Inspect PM2 processes using explicit argument arrays and shell: false
  const pm2Check = spawner('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000, shell: false });

  if (pm2Check.error) {
    throw new Error(`PM2 process inspection failed with execution error: ${pm2Check.error.message || pm2Check.error.code}. Failing closed.`);
  }

  if (pm2Check.status !== 0) {
    const errDiag = ((pm2Check.stderr || '') + ' ' + (pm2Check.stdout || '')).trim();
    throw new Error(`PM2 process inspection exited with non-zero status (${pm2Check.status}): ${errDiag || 'Unknown error'}. Failing closed.`);
  }

  if (!pm2Check.stdout || !pm2Check.stdout.trim()) {
    throw new Error(`PM2 process inspection returned empty output. Failing closed.`);
  }

  let list;
  try {
    list = JSON.parse(pm2Check.stdout);
  } catch (parseErr) {
    throw new Error(`PM2 process inspection returned malformed JSON (${parseErr.message}). Failing closed.`);
  }

  if (!Array.isArray(list)) {
    throw new Error(`PM2 process inspection returned non-array payload. Failing closed.`);
  }

  for (const app of list) {
    const isTargetApp = app.name === 'bfi-classroom' ||
      (app.pm2_env && app.pm2_env.pm_exec_path && app.pm2_env.pm_exec_path.includes('server.js'));

    if (isTargetApp) {
      const status = app.pm2_env ? app.pm2_env.status : 'unknown';
      if (status !== 'stopped' && status !== 'errored') {
        throw new Error(`Active writer process detected: PM2 application '${app.name}' (PID: ${app.pid}) is still '${status}'. Must run 'pm2 stop bfi-classroom' before deployment.`);
      }
    }
  }

  logInfo('Application writers verification: PASS (Zero active PM2 instances running)');
}

// 3. Inspect database file handles with fail-closed semantics
function checkDatabaseHandles(dbPath, options = {}) {
  const spawner = options.spawner || child_process.spawnSync;

  // Test simulation hooks
  if (process.env.TEST_MOCK_MISSING_TOOL === 'true') {
    throw new Error(`Neither 'lsof' nor 'fuser' inspection tool is installed or available on this host. Maintenance gate cannot reliably verify absence of database writers. Failing closed.`);
  }
  if (process.env.TEST_MOCK_TOOL_ERROR === 'true') {
    throw new Error(`Handle inspection failed with unexpected tool error (EPERM / permission denied). Failing closed.`);
  }
  if (process.env.TEST_MOCK_ACTIVE_HANDLES === 'true') {
    throw new Error(`Active database handles detected on ${dbPath}! Writer process [PID: 1234 (node)] holds open file descriptor. Aborting deployment.`);
  }

  const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter(f => fs.existsSync(f));
  if (targets.length === 0) {
    throw new Error(`No database files found at ${dbPath} to inspect.`);
  }

  // 3A. Probe lsof availability strictly:
  // Must return status 0 without error. Exit codes other than 0 or any probe error indicate lsof is NOT available.
  // We NEVER match tool names in stderr, as "command not found" includes the tool name.
  let hasLsof = false;
  try {
    const lsofProbe = spawner('lsof', ['-v'], { encoding: 'utf8', timeout: 5000, shell: false });
    if (!lsofProbe.error && lsofProbe.status === 0) {
      hasLsof = true;
    }
  } catch {
    hasLsof = false;
  }

  if (hasLsof) {
    const lsofRun = spawner('lsof', targets, { encoding: 'utf8', timeout: 10000, shell: false });

    if (lsofRun.error) {
      throw new Error(`lsof inspection encountered execution error: ${lsofRun.error.message || lsofRun.error.code}. Failing closed.`);
    }

    // In lsof:
    // Exit code 0 = open files found (FATAL for deployment gate!)
    // Exit code 1 = no files open (PASS ONLY IF stderr is clean and free of permission denials)
    // Exit code > 1 = tool execution error / permission error (FATAL)
    if (lsofRun.status === 0) {
      const out = (lsofRun.stdout || lsofRun.stderr || '').trim();
      throw new Error(`Active database handles detected via lsof:\n${out}`);
    } else if (lsofRun.status === 1) {
      const errDiag = (lsofRun.stderr || '').trim();
      if (errDiag.length > 0) {
        throw new Error(`lsof reported warnings or permission diagnostics during execution (exit code 1 with stderr: "${errDiag}"). Insufficient host permissions to reliably verify database handles. Failing closed.`);
      }
      logInfo('Handle inspection via lsof: PASS (0 active file handles detected)');
      return;
    } else {
      const errDiag = (lsofRun.stderr || lsofRun.stdout || '').trim();
      throw new Error(`lsof inspection failed with error code ${lsofRun.status}: ${errDiag}. Failing closed.`);
    }
  }

  // 3B. Probe fuser availability strictly:
  let hasFuser = false;
  try {
    const fuserProbe = spawner('fuser', ['-V'], { encoding: 'utf8', timeout: 5000, shell: false });
    if (!fuserProbe.error && fuserProbe.status === 0) {
      hasFuser = true;
    }
  } catch {
    hasFuser = false;
  }

  if (hasFuser) {
    const fuserRun = spawner('fuser', targets, { encoding: 'utf8', timeout: 10000, shell: false });

    if (fuserRun.error) {
      throw new Error(`fuser inspection encountered execution error: ${fuserRun.error.message || fuserRun.error.code}. Failing closed.`);
    }

    // In fuser:
    // Exit code 0 = at least one process found holding handle (FATAL)
    // Exit code 1 = no processes found (PASS ONLY IF stderr is clean)
    // Exit code > 1 = tool error (FATAL)
    if (fuserRun.status === 0) {
      const out = (fuserRun.stdout || fuserRun.stderr || '').trim();
      throw new Error(`Active database handles detected via fuser:\n${out}`);
    } else if (fuserRun.status === 1) {
      const errDiag = (fuserRun.stderr || '').trim();
      if (errDiag.length > 0) {
        throw new Error(`fuser reported diagnostics or permission errors during execution (exit code 1 with stderr: "${errDiag}"). Failing closed.`);
      }
      logInfo('Handle inspection via fuser: PASS (0 active file handles detected)');
      return;
    } else {
      const errDiag = (fuserRun.stderr || fuserRun.stdout || '').trim();
      throw new Error(`fuser inspection failed with error code ${fuserRun.status}: ${errDiag}. Failing closed.`);
    }
  }

  // On non-Linux systems or where neither tool exists:
  if (process.platform === 'win32') {
    logInfo('Windows host detected; lsof/fuser not native. Handle check simulated or bypassed only when explicit flag is provided.');
    if (options.allowWindowsDevPreflight !== true && process.env.ALLOW_WINDOWS_DEV_PREFLIGHT !== 'true') {
      throw new Error(`Neither 'lsof' nor 'fuser' inspection tool is installed or available on this host. Maintenance gate cannot reliably verify absence of database writers. Failing closed.`);
    }
    logInfo('Windows handle verification allowed via ALLOW_WINDOWS_DEV_PREFLIGHT=true');
    return;
  }

  // If on Linux/Unix and neither tool is available, MUST FAIL CLOSED
  throw new Error(`Neither 'lsof' nor 'fuser' inspection tool is installed or available on this host. Maintenance gate cannot reliably verify absence of database writers. Failing closed.`);
}

// 4. Verify SQLite WAL checkpoint and integrity
function verifyAndCheckpointWal(dbPath) {
  if (process.env.TEST_MOCK_BUSY_CHECKPOINT === 'true') {
    throw new Error(`wal_checkpoint(TRUNCATE) returned busy=1, log=14. Database is locked or concurrent writer blocked checkpoint. Failing closed.`);
  }

  let db;
  try {
    db = new Database(dbPath, { timeout: 3000, readonly: false });
  } catch (err) {
    throw new Error(`Failed to open database connection for checkpoint verification: ${err.message}`);
  }

  try {
    const rawRes = db.pragma('wal_checkpoint(TRUNCATE)');
    const res = Array.isArray(rawRes) ? rawRes[0] : rawRes;
    logInfo(`wal_checkpoint(TRUNCATE) result: busy=${res?.busy}, log=${res?.log}, checkpointed=${res?.checkpointed}`);

    if (!res || res.busy !== 0) {
      throw new Error(`wal_checkpoint(TRUNCATE) returned busy=${res?.busy}. Concurrent transaction holds database lock.`);
    }
    if (res.log !== 0) {
      throw new Error(`wal_checkpoint(TRUNCATE) did not truncate log frames. Frames remaining: ${res?.log}.`);
    }

    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      const walSize = fs.statSync(walPath).size;
      if (walSize > 0) {
        throw new Error(`WAL file size on disk is ${walSize} bytes after TRUNCATE checkpoint. Expected 0 bytes.`);
      }
    }

    const rawQc = db.pragma('quick_check');
    const qc = Array.isArray(rawQc) ? rawQc[0] : rawQc;
    const qcStatus = qc?.quick_check || qc;
    if (qcStatus !== 'ok') {
      throw new Error(`Database quick_check returned non-ok result: ${JSON.stringify(rawQc)}`);
    }

    logInfo('WAL checkpoint and database integrity: PASS (busy=0, log=0, quick_check=ok)');
  } finally {
    db.close();
  }
}

// Main preflight orchestration
function runPreflightLockdown(options = {}) {
  logInfo('Starting strict fail-closed pre-deployment maintenance verification...');

  try {
    const dbPath = resolveDatabasePath(options);
    checkWritersStopped(options);
    checkDatabaseHandles(dbPath, options);
    verifyAndCheckpointWal(dbPath);

    logInfo('================================================================');
    logInfo('VERDICT: MAINTENANCE GATE OPEN');
    logInfo('All writer processes stopped, 0 active file handles, WAL truncated, integrity ok.');
    logInfo('Safe to proceed with final pre-deployment database backup.');
    logInfo('================================================================');
    if (options.doNotExit !== true) {
      process.exit(0);
    }
    return true;
  } catch (err) {
    logError('================================================================');
    logError('VERDICT: MAINTENANCE GATE CLOSED (DEPLOYMENT ABORTED)');
    logError(err.message);
    logError('================================================================');
    if (options.doNotExit !== true) {
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  runPreflightLockdown();
}

module.exports = {
  resolveDatabasePath,
  checkWritersStopped,
  checkDatabaseHandles,
  verifyAndCheckpointWal,
  runPreflightLockdown,
};
