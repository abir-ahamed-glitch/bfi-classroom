#!/usr/bin/env node
/**
 * scripts/verify_isolation.cjs
 *
 * Strict, fail-closed isolation inspection verification script.
 * 
 * Verifies:
 * 1. Nginx service state is confirmed 'inactive' via systemctl.
 * 2. Zero running Nginx processes exist via pgrep.
 * 3. Public ports 80 and 443 have zero listening sockets via ss.
 * 4. Zero established proxy connections exist on ports 80 and 443 via ss.
 * 5. PM2 application 'bfi-classroom' exists and is in confirmed 'stopped' state (or 'online' if --allow-pm2).
 * 6. Port 3001 is closed when PM2 is stopped.
 * 
 * Fails closed: ANY command error, timeout, signal, non-zero return, unexpected status,
 * diagnostic error output, or missing expected application immediately throws and exits code 1.
 */

const child_process = require('child_process');

function logInfo(msg) {
  console.log(`[ISOLATION VERIFY] ${msg}`);
}

function logFatal(msg) {
  console.error(`❌ [ISOLATION GATE FATAL] ${msg}`);
}

function verifyIsolation(options = {}) {
  const spawner = options.spawner || child_process.spawnSync;
  const allowPm2Online = options.allowPm2Online !== undefined
    ? Boolean(options.allowPm2Online)
    : process.argv.includes('--allow-pm2');

  logInfo('Initiating fail-closed isolation inspection...');
  logInfo(`Mode: ${allowPm2Online ? 'POST-START SMOKE ISOLATION (--allow-pm2)' : 'FULL LOCKDOWN (WRITERS STOPPED)'}`);

  // 1. Inspect Nginx systemd service state
  logInfo('1. Inspecting Nginx systemd service status...');
  const sysCheck = spawner('systemctl', ['is-active', 'nginx'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (sysCheck.error) {
    logFatal(`systemctl execution failed: ${sysCheck.error.message || sysCheck.error.code}. Failing closed.`);
    throw new Error(`systemctl execution error: ${sysCheck.error.message || sysCheck.error.code}`);
  }
  if (sysCheck.signal) {
    logFatal(`systemctl terminated by signal: ${sysCheck.signal}. Failing closed.`);
    throw new Error(`systemctl terminated by signal: ${sysCheck.signal}`);
  }

  const sysOutput = (sysCheck.stdout || '').trim();
  if (sysCheck.status === 0 || sysOutput === 'active') {
    logFatal(`Nginx service is currently active (status=${sysCheck.status}, output="${sysOutput}"). Must run 'sudo systemctl stop nginx'.`);
    throw new Error('Nginx service is active.');
  }
  if (sysOutput !== 'inactive') {
    const errDiag = (sysCheck.stderr || '').trim();
    logFatal(`Nginx service in unexpected state: "${sysOutput}" (exit code ${sysCheck.status}${errDiag ? ', stderr: ' + errDiag : ''}). Expected 'inactive'.`);
    throw new Error(`Nginx service state unexpected: ${sysOutput}`);
  }
  logInfo('✅ Nginx service state: confirmed inactive.');

  // 2. Inspect running Nginx processes via pgrep
  logInfo('2. Inspecting running Nginx processes...');
  const pgrepCheck = spawner('pgrep', ['-x', 'nginx'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (pgrepCheck.error) {
    logFatal(`pgrep execution failed: ${pgrepCheck.error.message || pgrepCheck.error.code}. Failing closed.`);
    throw new Error(`pgrep execution error: ${pgrepCheck.error.message || pgrepCheck.error.code}`);
  }
  if (pgrepCheck.signal) {
    logFatal(`pgrep terminated by signal: ${pgrepCheck.signal}. Failing closed.`);
    throw new Error(`pgrep terminated by signal: ${pgrepCheck.signal}`);
  }

  // In POSIX pgrep: exit 0 means processes matched, exit 1 means no processes matched
  if (pgrepCheck.status === 0) {
    const pids = (pgrepCheck.stdout || '').trim();
    logFatal(`Nginx process(es) still alive (PIDs: ${pids}). Failing closed.`);
    throw new Error(`Nginx process(es) still alive: ${pids}`);
  }
  if (pgrepCheck.status !== 1) {
    const errText = ((pgrepCheck.stderr || '') + ' ' + (pgrepCheck.stdout || '')).trim();
    logFatal(`pgrep exited with unexpected error code (${pgrepCheck.status}): ${errText || 'Unknown error'}. Failing closed.`);
    throw new Error(`pgrep unexpected exit code: ${pgrepCheck.status}`);
  }
  logInfo('✅ Nginx processes: confirmed zero running instances.');

  // 3. Inspect public listener sockets on ports 80 and 443 via ss
  logInfo('3. Inspecting public listener sockets on ports 80 and 443...');
  const ssListenCheck = spawner('ss', ['-H', '-tulpn', '( sport = :80 or sport = :443 )'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (ssListenCheck.error) {
    logFatal(`ss listener check failed: ${ssListenCheck.error.message || ssListenCheck.error.code}. Failing closed.`);
    throw new Error(`ss listener check error: ${ssListenCheck.error.message || ssListenCheck.error.code}`);
  }
  if (ssListenCheck.signal) {
    logFatal(`ss listener check terminated by signal: ${ssListenCheck.signal}. Failing closed.`);
    throw new Error(`ss listener check terminated by signal: ${ssListenCheck.signal}`);
  }
  if (ssListenCheck.status !== 0) {
    logFatal(`ss listener check exited with non-zero status (${ssListenCheck.status}): ${ssListenCheck.stderr || ssListenCheck.stdout || ''}. Failing closed.`);
    throw new Error(`ss listener check non-zero: ${ssListenCheck.status}`);
  }
  if (ssListenCheck.stderr && ssListenCheck.stderr.trim().length > 0) {
    logFatal(`ss listener check reported diagnostic error: ${ssListenCheck.stderr.trim()}. Failing closed.`);
    throw new Error(`ss listener check diagnostic error: ${ssListenCheck.stderr.trim()}`);
  }
  const listenOut = (ssListenCheck.stdout || '').trim();
  if (listenOut.length > 0) {
    logFatal(`Active listener socket(s) detected on ports 80/443:\n${listenOut}`);
    throw new Error(`Public ports 80/443 still listening: ${listenOut}`);
  }
  logInfo('✅ Ports 80 & 443: confirmed zero listening sockets.');

  // 4. Inspect established proxy connections on ports 80 and 443
  logInfo('4. Inspecting connection drain status on ports 80 and 443...');
  const ssConnCheck = spawner('ss', ['-H', '-tan', 'state', 'established', '( sport = :80 or sport = :443 )'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (ssConnCheck.error) {
    logFatal(`ss connection check failed: ${ssConnCheck.error.message || ssConnCheck.error.code}. Failing closed.`);
    throw new Error(`ss connection check error: ${ssConnCheck.error.message || ssConnCheck.error.code}`);
  }
  if (ssConnCheck.signal) {
    logFatal(`ss connection check terminated by signal: ${ssConnCheck.signal}. Failing closed.`);
    throw new Error(`ss connection check terminated by signal: ${ssConnCheck.signal}`);
  }
  if (ssConnCheck.status !== 0) {
    logFatal(`ss connection check exited with non-zero status (${ssConnCheck.status}): ${ssConnCheck.stderr || ssConnCheck.stdout || ''}. Failing closed.`);
    throw new Error(`ss connection check non-zero: ${ssConnCheck.status}`);
  }
  if (ssConnCheck.stderr && ssConnCheck.stderr.trim().length > 0) {
    logFatal(`ss connection check reported diagnostic error: ${ssConnCheck.stderr.trim()}. Failing closed.`);
    throw new Error(`ss connection check diagnostic error: ${ssConnCheck.stderr.trim()}`);
  }
  const connOut = (ssConnCheck.stdout || '').trim();
  if (connOut.length > 0) {
    logFatal(`Established connections still open on ports 80/443:\n${connOut}`);
    throw new Error(`Connections still open: ${connOut}`);
  }
  logInfo('✅ Ports 80 & 443: confirmed zero established connections.');

  // 5. Inspect PM2 application machine-readable state
  logInfo('5. Inspecting PM2 machine-readable application state...');
  const pm2Check = spawner('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000, shell: false });
  if (pm2Check.error) {
    logFatal(`pm2 jlist execution failed: ${pm2Check.error.message || pm2Check.error.code}. Failing closed.`);
    throw new Error(`pm2 jlist execution error: ${pm2Check.error.message || pm2Check.error.code}`);
  }
  if (pm2Check.signal) {
    logFatal(`pm2 jlist terminated by signal: ${pm2Check.signal}. Failing closed.`);
    throw new Error(`pm2 jlist terminated by signal: ${pm2Check.signal}`);
  }
  if (pm2Check.status !== 0) {
    logFatal(`pm2 jlist exited with status ${pm2Check.status}: ${pm2Check.stderr || pm2Check.stdout || ''}. Failing closed.`);
    throw new Error(`pm2 jlist status: ${pm2Check.status}`);
  }
  if (!pm2Check.stdout || !pm2Check.stdout.trim()) {
    logFatal('pm2 jlist returned empty output. Failing closed.');
    throw new Error('pm2 jlist returned empty output');
  }

  let appList;
  try {
    appList = JSON.parse(pm2Check.stdout);
  } catch (parseErr) {
    logFatal(`Failed to parse PM2 JSON output: ${parseErr.message}`);
    throw new Error(`PM2 JSON parse error: ${parseErr.message}`);
  }
  if (!Array.isArray(appList)) {
    logFatal('PM2 output is not an array. Failing closed.');
    throw new Error('PM2 output not an array');
  }

  const targetApp = appList.find(a => a.name === 'bfi-classroom');
  if (!targetApp) {
    logFatal("Expected PM2 application 'bfi-classroom' not found in process list! Cannot verify isolation. Failing closed.");
    throw new Error("Target application 'bfi-classroom' not found in PM2 process list.");
  }

  const currentStatus = targetApp.pm2_env ? targetApp.pm2_env.status : 'unknown';
  if (!allowPm2Online) {
    if (currentStatus !== 'stopped' && currentStatus !== 'errored') {
      logFatal(`Application 'bfi-classroom' (PID: ${targetApp.pid}) is '${currentStatus}'. Expected 'stopped'.`);
      throw new Error(`PM2 application is ${currentStatus}`);
    }
    logInfo(`✅ PM2 application 'bfi-classroom': confirmed stopped.`);
  } else {
    if (currentStatus !== 'online') {
      logFatal(`Application 'bfi-classroom' is '${currentStatus}'. Expected 'online' for loopback verification.`);
      throw new Error(`PM2 application is not online: ${currentStatus}`);
    }
    logInfo(`✅ PM2 application 'bfi-classroom': confirmed online for loopback smoke check.`);
  }

  // 6. Inspect port 3001 listening state when PM2 is stopped
  if (!allowPm2Online) {
    logInfo('6. Inspecting port 3001 closure status...');
    const ss3001Check = spawner('ss', ['-H', '-tulpn', '( sport = :3001 )'], { encoding: 'utf8', timeout: 5000, shell: false });
    if (ss3001Check.error) {
      logFatal(`Port 3001 socket check execution failed: ${ss3001Check.error.message || ss3001Check.error.code}. Failing closed.`);
      throw new Error(`Port 3001 socket check execution error: ${ss3001Check.error.message || ss3001Check.error.code}`);
    }
    if (ss3001Check.signal) {
      logFatal(`Port 3001 socket check terminated by signal: ${ss3001Check.signal}. Failing closed.`);
      throw new Error(`Port 3001 socket check terminated by signal: ${ss3001Check.signal}`);
    }
    if (ss3001Check.status !== 0) {
      logFatal(`Port 3001 socket check exited with non-zero status (${ss3001Check.status}): ${ss3001Check.stderr || ss3001Check.stdout || ''}. Failing closed.`);
      throw new Error(`Port 3001 socket check non-zero exit status: ${ss3001Check.status}`);
    }
    if (ss3001Check.stderr && ss3001Check.stderr.trim().length > 0) {
      logFatal(`Port 3001 socket check reported diagnostic error: ${ss3001Check.stderr.trim()}. Failing closed.`);
      throw new Error(`Port 3001 socket check diagnostic error: ${ss3001Check.stderr.trim()}`);
    }
    const p3001Out = (ss3001Check.stdout || '').trim();
    if (p3001Out.length > 0) {
      logFatal(`Port 3001 is still listening while PM2 is stopped:\n${p3001Out}`);
      throw new Error(`Port 3001 still active: ${p3001Out}`);
    }
    logInfo('✅ Port 3001: confirmed closed.');
  }

  logInfo('================================================================');
  logInfo('VERDICT: ISOLATION GATE VERIFIED (ALL INVARIANTS PASS)');
  logInfo('================================================================');
  return true;
}

if (require.main === module) {
  try {
    verifyIsolation();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ [GATE REJECTED] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { verifyIsolation };
