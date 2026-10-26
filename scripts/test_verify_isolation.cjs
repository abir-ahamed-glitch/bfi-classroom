#!/usr/bin/env node
/**
 * scripts/test_verify_isolation.cjs
 *
 * Strict unit test suite for scripts/verify_isolation.cjs.
 * Tests command result handling and error paths using injected spawner adapters.
 * 
 * Specifically exercises:
 * 1. Port 3001 inspection returning error object (reproduces & verifies probe fix).
 * 2. Port 3001 inspection returning non-zero status.
 * 3. Port 3001 inspection returning termination signal.
 * 4. Port 3001 inspection returning diagnostic stderr.
 * 5. Port 3001 inspection returning active listener output.
 * 6. PM2 missing 'bfi-classroom' in process list.
 * 7. PM2 returning malformed JSON.
 * 8. PM2 application in 'online' status when lockdown expected.
 * 9. PM2 application in 'stopped' status when --allow-pm2 expected.
 * 10. systemctl reporting 'active' (status 0).
 * 11. systemctl reporting unexpected state or error.
 * 12. pgrep reporting running processes (status 0).
 * 13. pgrep exiting with tool error (status 2).
 * 14. ss ports 80/443 reporting active listeners.
 * 15. ss ports 80/443 reporting established connections.
 * 16. Happy path: All inspections passing -> returns true.
 */

const { verifyIsolation } = require('./verify_isolation.cjs');

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

// Standard mock responses for passing checks
function getStandardMock(cmd, args) {
  if (cmd === 'systemctl') {
    return { status: 3, stdout: 'inactive\n', stderr: '', error: null, signal: null };
  }
  if (cmd === 'pgrep') {
    return { status: 1, stdout: '', stderr: '', error: null, signal: null };
  }
  if (cmd === 'ss') {
    return { status: 0, stdout: '', stderr: '', error: null, signal: null };
  }
  if (cmd === 'pm2') {
    const list = [{
      name: 'bfi-classroom',
      pid: 19613,
      pm2_env: { status: 'stopped' }
    }];
    return { status: 0, stdout: JSON.stringify(list), stderr: '', error: null, signal: null };
  }
  return { status: 0, stdout: '', stderr: '', error: null, signal: null };
}

console.log('================================================================');
console.log('TEST SUITE: VERIFY_ISOLATION.CJS FAIL-CLOSED COMMAND HANDLING');
console.log('================================================================\n');

// 1. Port 3001 command error (Probe Reproduction & Resolution Test)
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :3001 )')) {
      return { status: null, stdout: '', stderr: '', error: new Error('Command failed: ss -H -tulpn ( sport = :3001 )') };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 1: Port 3001 inspection returning error object throws and fails gate',
    threw && errMsg.includes('Port 3001 socket check execution error'),
    `Expected throw with error detail, received threw=${threw}, message=${errMsg}`
  );
}

// 2. Port 3001 non-zero status
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :3001 )')) {
      return { status: 2, stdout: '', stderr: 'ss: permission denied' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 2: Port 3001 non-zero status throws and fails gate',
    threw && errMsg.includes('Port 3001 socket check non-zero exit status: 2'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 3. Port 3001 termination signal
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :3001 )')) {
      return { status: null, stdout: '', stderr: '', signal: 'SIGKILL' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 3: Port 3001 signal termination throws and fails gate',
    threw && errMsg.includes('Port 3001 socket check terminated by signal: SIGKILL'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 4. Port 3001 diagnostic stderr
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :3001 )')) {
      return { status: 0, stdout: '', stderr: 'ss: warning filter syntax degraded' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 4: Port 3001 diagnostic stderr throws and fails gate',
    threw && errMsg.includes('Port 3001 socket check diagnostic error'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 5. Port 3001 active listener output
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :3001 )')) {
      return { status: 0, stdout: 'tcp LISTEN 0 511 *:3001 *:*', stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 5: Port 3001 active listener output throws and fails gate',
    threw && errMsg.includes('Port 3001 still active'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 6. PM2 missing 'bfi-classroom' application
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'pm2') {
      return { status: 0, stdout: JSON.stringify([{ name: 'other-app', pm2_env: { status: 'stopped' } }]), stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    "Test 6: Missing expected 'bfi-classroom' in PM2 throws and fails gate",
    threw && errMsg.includes("Target application 'bfi-classroom' not found in PM2 process list"),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 7. PM2 malformed JSON
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'pm2') {
      return { status: 0, stdout: '{ malformed json }', stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 7: PM2 malformed JSON throws and fails gate',
    threw && errMsg.includes('PM2 JSON parse error'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 8. PM2 still 'online' when stopped expected
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'pm2') {
      const list = [{ name: 'bfi-classroom', pid: 1234, pm2_env: { status: 'online' } }];
      return { status: 0, stdout: JSON.stringify(list), stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner, allowPm2Online: false });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    "Test 8: PM2 application 'online' during lockdown throws and fails gate",
    threw && errMsg.includes('PM2 application is online'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 9. PM2 'stopped' when allowPm2Online=true
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'pm2') {
      const list = [{ name: 'bfi-classroom', pid: 1234, pm2_env: { status: 'stopped' } }];
      return { status: 0, stdout: JSON.stringify(list), stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner, allowPm2Online: true });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    "Test 9: PM2 application 'stopped' when --allow-pm2 expected throws and fails gate",
    threw && errMsg.includes('PM2 application is not online: stopped'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 10. systemctl reporting active (status 0)
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'systemctl') {
      return { status: 0, stdout: 'active\n', stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 10: systemctl reporting active throws and fails gate',
    threw && errMsg.includes('Nginx service is active'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 11. systemctl reporting unexpected state
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'systemctl') {
      return { status: 3, stdout: 'failed\n', stderr: 'Job failed' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 11: systemctl unexpected state throws and fails gate',
    threw && errMsg.includes('Nginx service state unexpected: failed'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 12. pgrep reporting active process
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'pgrep') {
      return { status: 0, stdout: '830\n832\n', stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 12: pgrep reporting active processes throws and fails gate',
    threw && errMsg.includes('Nginx process(es) still alive: 830'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 13. pgrep error status (status 2)
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'pgrep') {
      return { status: 2, stdout: '', stderr: 'pgrep: syntax error' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 13: pgrep unexpected status throws and fails gate',
    threw && errMsg.includes('pgrep unexpected exit code: 2'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 14. ss ports 80/443 listener active
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :80 or sport = :443 )')) {
      return { status: 0, stdout: 'tcp LISTEN 0 511 0.0.0.0:80 *:*', stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 14: ss ports 80/443 listener active throws and fails gate',
    threw && errMsg.includes('Public ports 80/443 still listening'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 15. ss ports 80/443 established connections active
{
  const mockSpawner = (cmd, args) => {
    if (cmd === 'ss' && args.includes('( sport = :80 or sport = :443 ) state established')) {
      return { status: 0, stdout: 'tcp ESTAB 0 0 10.0.0.82:443 1.2.3.4:54321', stderr: '' };
    }
    return getStandardMock(cmd, args);
  };

  let threw = false;
  let errMsg = '';
  try {
    verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    threw = true;
    errMsg = err.message;
  }
  assert(
    'Test 15: ss established connections active throws and fails gate',
    threw && errMsg.includes('Connections still open'),
    `Received threw=${threw}, message=${errMsg}`
  );
}

// 16. Happy Path: All inspections passing
{
  const mockSpawner = (cmd, args) => getStandardMock(cmd, args);
  let res = false;
  try {
    res = verifyIsolation({ spawner: mockSpawner });
  } catch (err) {
    res = false;
  }
  assert(
    'Test 16: Happy path returns true when all inspections pass',
    res === true,
    'Expected true return'
  );
}

console.log('\n================================================================');
console.log(`TEST SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
console.log('================================================================');
