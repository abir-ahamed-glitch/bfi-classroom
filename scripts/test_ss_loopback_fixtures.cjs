#!/usr/bin/env node
/**
 * scripts/test_ss_loopback_fixtures.cjs
 *
 * Real disposable loopback fixture tests for Linux iproute2 `ss` connection inspection.
 * Tests empty state and real established connection detection for IPv4 and IPv6.
 *
 * When executed on Linux, spawns real `ss` binary with exact arguments and shell:false.
 */

const net = require('net');
const cp = require('child_process');

let totalTests = 0;
let passedTests = 0;

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

async function runLoopbackTests() {
  console.log('================================================================');
  console.log('TEST SUITE: REAL SS LOOPBACK FIXTURES (IPV4 & IPV6)');
  console.log('================================================================\n');

  if (process.platform !== 'linux') {
    console.log(`⚠️ Current platform is '${process.platform}'. Native 'ss' requires Linux.`);
    console.log('Skipping live ss execution on a non-Linux host — 0 assertions executed.');
    return;
  }

  // 1. Check ss version
  const ver = cp.spawnSync('ss', ['-V'], { encoding: 'utf8', shell: false });
  assert('ss binary is installed and executable', ver.status === 0, ver.stderr);
  console.log(`   ss Version: ${(ver.stdout || '').trim().split('\n')[0]}`);

  const port1 = 49152 + Math.floor(Math.random() * 1000);
  const port2 = port1 + 1;

  // 2. Empty Results Test (no listeners, no established connections on ports)
  const emptyRes = cp.spawnSync('ss', [
    '-H', '-tan', 'state', 'established',
    `( sport = :${port1} or sport = :${port2} )`
  ], { encoding: 'utf8', shell: false });

  assert(
    'Empty test: ss returns exit code 0 with zero matching connections',
    emptyRes.status === 0 && emptyRes.stdout.trim().length === 0 && (emptyRes.stderr || '').trim().length === 0,
    `status=${emptyRes.status}, stdout=${JSON.stringify(emptyRes.stdout)}, stderr=${JSON.stringify(emptyRes.stderr)}`
  );

  // 3. IPv4 Established Connection Detection
  const server4 = net.createServer((sock) => {});
  await new Promise((resolve) => server4.listen(port1, '127.0.0.1', resolve));

  const client4 = net.createConnection({ host: '127.0.0.1', port: port1 });
  await new Promise((resolve) => client4.on('connect', resolve));

  const ipv4Res = cp.spawnSync('ss', [
    '-H', '-tan', 'state', 'established',
    `( sport = :${port1} or sport = :${port2} )`
  ], { encoding: 'utf8', shell: false });

  const ipv4Detected = ipv4Res.status === 0 &&
    (ipv4Res.stderr || '').trim().length === 0 &&
    ipv4Res.stdout.includes(String(port1));

  assert(
    `IPv4 test: ss detects real established connection on 127.0.0.1:${port1}`,
    ipv4Detected,
    `status=${ipv4Res.status}, stdout=${JSON.stringify(ipv4Res.stdout.trim())}, stderr=${JSON.stringify(ipv4Res.stderr)}`
  );

  client4.destroy();
  await new Promise((resolve) => server4.close(resolve));

  // Verify drain after IPv4 close
  // Give socket 100ms for TCP teardown
  await new Promise(r => setTimeout(r, 100));
  const drainedRes4 = cp.spawnSync('ss', [
    '-H', '-tan', 'state', 'established',
    `( sport = :${port1} or sport = :${port2} )`
  ], { encoding: 'utf8', shell: false });
  assert(
    'IPv4 drain: ss reports empty after connection closed',
    drainedRes4.status === 0 && drainedRes4.stdout.trim().length === 0,
    `stdout=${drainedRes4.stdout}`
  );

  // 4. IPv6 Established Connection Detection
  let ipv6Supported = false;
  try {
    const server6 = net.createServer((sock) => {});
    await new Promise((resolve, reject) => {
      server6.once('error', reject);
      server6.listen(port2, '::1', resolve);
    });
    ipv6Supported = true;

    const client6 = net.createConnection({ host: '::1', port: port2 });
    await new Promise((resolve) => client6.on('connect', resolve));

    const ipv6Res = cp.spawnSync('ss', [
      '-H', '-tan', 'state', 'established',
      `( sport = :${port1} or sport = :${port2} )`
    ], { encoding: 'utf8', shell: false });

    const ipv6Detected = ipv6Res.status === 0 &&
      (ipv6Res.stderr || '').trim().length === 0 &&
      ipv6Res.stdout.includes(String(port2));

    assert(
      `IPv6 test: ss detects real established connection on [::1]:${port2}`,
      ipv6Detected,
      `status=${ipv6Res.status}, stdout=${JSON.stringify(ipv6Res.stdout.trim())}, stderr=${JSON.stringify(ipv6Res.stderr)}`
    );

    client6.destroy();
    await new Promise((resolve) => server6.close(resolve));

    await new Promise(r => setTimeout(r, 100));
    const drainedRes6 = cp.spawnSync('ss', [
      '-H', '-tan', 'state', 'established',
      `( sport = :${port1} or sport = :${port2} )`
    ], { encoding: 'utf8', shell: false });
    assert(
      'IPv6 drain: ss reports empty after connection closed',
      drainedRes6.status === 0 && drainedRes6.stdout.trim().length === 0,
      `stdout=${drainedRes6.stdout}`
    );
  } catch (err) {
    console.log(`ℹ️ IPv6 loopback not supported on this host (${err.message}). Skipped.`);
  }

  console.log('\n================================================================');
  console.log(`TEST SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log('================================================================\n');
}

runLoopbackTests().catch((err) => {
  console.error(`Fatal fixture test error: ${err.message}`);
  process.exit(1);
});
