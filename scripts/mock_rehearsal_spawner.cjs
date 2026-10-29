/**
 * scripts/mock_rehearsal_spawner.cjs
 *
 * Mock Service-Command Adapter for Local Lifecycle Rehearsals and Crash Recovery Testing.
 * Intercepts Linux-specific system commands (systemctl, ss, pgrep, pm2, git checkout, npm build)
 * while delegating real node and local fs/git execution to child_process.spawnSync.
 */

const child_process = require('child_process');

let nginxActive = true;
let pm2Status = 'online';

function spawner(cmd, args = [], spawnOpts = {}) {
  const cmdStr = `${cmd} ${args.join(' ')}`.trim();

  // Nginx systemctl commands
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
      if (nginxActive) {
        return { status: 0, stdout: 'active\n', stderr: '', error: null };
      } else {
        return { status: 3, stdout: 'inactive\n', stderr: '', error: null };
      }
    }
  }

  // Process checks
  if (cmd === 'pgrep') {
    if (args.includes('nginx')) {
      if (nginxActive) {
        return { status: 0, stdout: '830\n832\n', stderr: '', error: null };
      } else {
        return { status: 1, stdout: '', stderr: '', error: null };
      }
    }
  }

  // Socket inspections
  if (cmd === 'ss') {
    if (args.includes('( sport = :80 or sport = :443 )')) {
      if (nginxActive) {
        return { status: 0, stdout: 'tcp LISTEN 0 511 0.0.0.0:80 *:*\n', stderr: '', error: null };
      } else {
        return { status: 0, stdout: '', stderr: '', error: null };
      }
    }
    if (args.includes('state established')) {
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (args.includes('( sport = :3001 )')) {
      if (pm2Status === 'online') {
        return { status: 0, stdout: 'tcp LISTEN 0 511 *:3001 *:*\n', stderr: '', error: null };
      } else {
        return { status: 0, stdout: '', stderr: '', error: null };
      }
    }
  }

  // PM2 commands
  if (cmd === 'pm2') {
    if (args[0] === 'stop') {
      pm2Status = 'stopped';
      return { status: 0, stdout: '[PM2] Applying action stop on app [bfi-classroom]', stderr: '', error: null };
    }
    if (args[0] === 'start') {
      pm2Status = 'online';
      return { status: 0, stdout: '[PM2] Applying action start on app [bfi-classroom]', stderr: '', error: null };
    }
    if (args[0] === 'jlist') {
      const list = [{
        name: 'bfi-classroom',
        pid: 19613,
        pm2_env: {
          status: pm2Status,
          pm_uptime: Date.now() - 60000,
          restart_time: 1
        }
      }];
      return { status: 0, stdout: JSON.stringify(list), stderr: '', error: null };
    }
  }

  // Git checkout / rev-parse
  if (cmd === 'git') {
    if (args[0] === 'checkout') {
      return { status: 0, stdout: 'HEAD is now at ' + args[1], stderr: '', error: null };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { status: 0, stdout: '8a662ecfe56e6133362e177a96723b34e500c897\n', stderr: '', error: null };
    }
  }

  // npm ci / npm build / npm prune
  if (cmd === 'npm' && args[0] === 'ci') {
    return { status: 0, stdout: 'added 0 packages in 0.1s\n', stderr: '', error: null };
  }
  if (cmd === 'npm' && args[0] === 'run' && args[1] === 'build') {
    return { status: 0, stdout: 'vite build complete\n', stderr: '', error: null };
  }
  if (cmd === 'npm' && args[0] === 'prune') {
    return { status: 0, stdout: 'audited 0 packages in 0.1s\n', stderr: '', error: null };
  }

  // Smoke check & curl
  if (cmd === 'curl') {
    return { status: 0, stdout: 'HTTP 200 OK\n', stderr: '', error: null };
  }

  if (args[0] && typeof args[0] === 'string' && args[0].endsWith('production_smoke_check.cjs')) {
    return { status: 0, stdout: '✅ [PROD SMOKE CHECK] All smoke endpoints passed\n', stderr: '', error: null };
  }

  // Delegate other commands (e.g. node git show, migrations, etc.) to real spawnSync
  return child_process.spawnSync(cmd, args, { encoding: 'utf8', shell: false, ...spawnOpts });
}

module.exports = { spawner };
