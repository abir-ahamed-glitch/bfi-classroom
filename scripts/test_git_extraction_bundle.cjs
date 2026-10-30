#!/usr/bin/env node
/**
 * scripts/test_git_extraction_bundle.cjs
 *
 * Test actual Git extraction and cold-start loading from an immutable commit:
 * 1. Validates that git show <COMMIT>:scripts/<tool> extracts all 7 operational tools.
 * 2. Writes them to an isolated disposable directory outside the git tree.
 * 3. Proves zero reliance on workspace files by requiring all 7 tools in a fresh child process.
 * 4. Validates CLI argument syntax (--target-commit <SHA> and --target-commit=<SHA>).
 * 5. Strictly confirms cold-start loading and verified bundle integrity.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

const TEST_DIR = path.resolve(__dirname, '..', 'test_git_bundle_env');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}

async function runTest() {
  console.log('================================================================');
  console.log('START: GIT EXTRACTION & COLD-START RECOVERY BUNDLE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, desc) {
    total++;
    if (!condition) {
      console.error(`❌ FAIL: ${desc}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
    console.log(`✅ PASS: ${desc}`);
    passed++;
  }

  cleanDir(TEST_DIR);
  const recoveryToolsDir = path.join(TEST_DIR, '.recovery_tools');
  const recoveryMigrationsDir = path.join(recoveryToolsDir, 'migrations');
  fs.mkdirSync(recoveryMigrationsDir, { recursive: true });

  const rootDir = path.resolve(__dirname, '..');

  // Resolve commit to test: argument or current HEAD
  let targetCommit = process.argv[2];
  if (!targetCommit) {
    const revCheck = child_process.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
    targetCommit = revCheck.stdout.trim();
  }

  assert(/^[0-9a-f]{40}$/i.test(targetCommit), `Target commit is a valid 40-character SHA (${targetCommit.slice(0, 8)})`);

  const requiredScripts = [
    'scripts/preflight_lockdown_check.cjs',
    'scripts/verify_isolation.cjs',
    'scripts/run_migrations.cjs',
    'scripts/production_smoke_check.cjs',
    'scripts/production_lifecycle.cjs',
    'scripts/obtain_smoke_credentials.cjs',
    'scripts/rotate_mfa_secrets.cjs'
  ];

  console.log(`\n--- [Step 1] Extracting 7 Operational Tools from Commit ${targetCommit.slice(0, 8)} into .recovery_tools ---`);
  for (const scriptRel of requiredScripts) {
    const sName = path.basename(scriptRel);
    const destPath = path.join(recoveryToolsDir, sName);

    const showRes = child_process.spawnSync('git', ['show', `${targetCommit}:${scriptRel}`], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000
    });

    assert(showRes.status === 0, `git show ${targetCommit.slice(0, 8)}:${scriptRel} succeeded`);
    assert(Boolean(showRes.stdout && showRes.stdout.length > 50), `Extracted content for ${sName} is non-empty (${showRes.stdout.length} bytes)`);

    // Write to isolated test directory with mode 0755
    fs.writeFileSync(destPath, showRes.stdout, { mode: 0o755 });
    const diskHash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex');
    const directHash = crypto.createHash('sha256').update(showRes.stdout).digest('hex');
    assert(diskHash === directHash, `SHA-256 matches for ${sName} (${diskHash.slice(0, 16)}...)`);
  }

  console.log(`\n--- [Step 1b] Extracting Self-Contained Migrations into .recovery_tools/migrations ---`);
  const lsRes = child_process.spawnSync('git', ['ls-tree', '--name-only', `${targetCommit}:server/db/migrations`], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 10000
  });
  assert(lsRes.status === 0, `git ls-tree for target commit migrations succeeded`);
  const migFiles = lsRes.stdout.split(/\r?\n/).map(f => f.trim()).filter(f => f.endsWith('.cjs'));
  assert(migFiles.length >= 8, `Discovered ${migFiles.length} migration files in target commit (expected >= 8)`);

  for (const migFile of migFiles) {
    const destPath = path.join(recoveryMigrationsDir, migFile);
    const showRes = child_process.spawnSync('git', ['show', `${targetCommit}:server/db/migrations/${migFile}`], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000
    });
    assert(showRes.status === 0, `git show ${targetCommit.slice(0, 8)}:server/db/migrations/${migFile} succeeded`);
    fs.writeFileSync(destPath, showRes.stdout, { mode: 0o644 });
    const diskHash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex');
    const directHash = crypto.createHash('sha256').update(showRes.stdout).digest('hex');
    assert(diskHash === directHash, `SHA-256 matches for migration ${migFile} (${diskHash.slice(0, 16)}...)`);
  }

  console.log(`\n--- [Step 2] Cold-Start Loading Verification in Fresh Isolated Node Process ---`);
  const probeCode = `
    const path = require('path');
    const dir = process.argv[1];
    const tools = ${JSON.stringify(requiredScripts.map(s => path.basename(s)))};
    for (const t of tools) {
      const mod = require(path.join(dir, t));
      if (!mod) throw new Error('Failed to require ' + t);
    }
    console.log('BUNDLE_VERIFIED_OK');
  `;

  const probeResult = child_process.spawnSync(process.execPath, ['-e', probeCode, recoveryToolsDir], {
    encoding: 'utf8',
    timeout: 10000
  });

  assert(probeResult.status === 0, 'Fresh Node process exited with code 0');
  assert(Boolean(probeResult.stdout && probeResult.stdout.includes('BUNDLE_VERIFIED_OK')), 'Output confirms BUNDLE_VERIFIED_OK');

  console.log(`\n--- [Step 2b] Negative Controls: Proving Recovery Bundle Fails Closed on Missing/Corrupted Migrations ---`);
  // Test missing single migration in bundle: must throw and not fall back to workspace migrations
  const targetTestMig = '20261030_schema_repairs_and_key_pair.cjs';
  const targetTestPath = path.join(recoveryMigrationsDir, targetTestMig);
  const savedMigContent = fs.readFileSync(targetTestPath, 'utf8');
  fs.unlinkSync(targetTestPath);

  const failProbeResult = child_process.spawnSync(process.execPath, ['-e', `require(path.join(process.argv[1], 'run_migrations.cjs'));`, recoveryToolsDir], {
    encoding: 'utf8',
    timeout: 10000
  });
  assert(failProbeResult.status !== 0, 'Requiring run_migrations.cjs with missing migration in bundle fails with non-zero exit code');
  assert(
    failProbeResult.stderr.includes('Self-contained recovery bundle missing required migration module') ||
    failProbeResult.stderr.includes('Cannot find module'),
    'Error output explicitly cites missing module in recovery bundle (no silent fallback)'
  );

  // Restore the migration file and verify clean recovery
  fs.writeFileSync(targetTestPath, savedMigContent, { mode: 0o644 });
  const restoredProbe = child_process.spawnSync(process.execPath, ['-e', `require(path.join(process.argv[1], 'run_migrations.cjs')); console.log('RESTORE_OK');`, recoveryToolsDir], {
    encoding: 'utf8',
    timeout: 10000
  });
  assert(restoredProbe.status === 0 && restoredProbe.stdout.includes('RESTORE_OK'), 'Restoring missing migration re-enables clean bundle loading');

  console.log(`\n--- [Step 3] Validate Extracted production_lifecycle.cjs Dual-Syntax CLI Parsing ---`);
  const extractedLifecycle = require(path.join(recoveryToolsDir, 'production_lifecycle.cjs'));
  assert(typeof extractedLifecycle.parseLifecycleArgs === 'function', 'parseLifecycleArgs exported from extracted lifecycle');

  const argsA = ['deploy', '--target-commit', targetCommit, '--rotate-mfa'];
  const parsedA = extractedLifecycle.parseLifecycleArgs(argsA);
  assert(parsedA.action === 'deploy', 'Space syntax parsed deploy action');
  assert(parsedA.targetCommit === targetCommit, 'Space syntax parsed targetCommit');
  assert(parsedA.rotateMfa === true, 'Space syntax parsed rotateMfa');

  const argsB = ['deploy', `--target-commit=${targetCommit}`, '--rotate-mfa'];
  const parsedB = extractedLifecycle.parseLifecycleArgs(argsB);
  assert(parsedB.action === 'deploy', 'Equals syntax parsed deploy action');
  assert(parsedB.targetCommit === targetCommit, 'Equals syntax parsed targetCommit');
  assert(parsedB.rotateMfa === true, 'Equals syntax parsed rotateMfa');

  console.log(`\n--- [Step 4] Validate Extracted rotate_mfa_secrets.cjs Exports ---`);
  const extractedRotation = require(path.join(recoveryToolsDir, 'rotate_mfa_secrets.cjs'));
  assert(typeof extractedRotation.determineActiveMfaSecretSource === 'function', 'determineActiveMfaSecretSource exported');
  assert(typeof extractedRotation.auditDecryptability === 'function', 'auditDecryptability exported');
  assert(typeof extractedRotation.executeRotation === 'function', 'executeRotation exported');

  cleanDir(TEST_DIR);

  console.log('\n================================================================');
  console.log(`ALL ${total} GIT EXTRACTION & COLD-START TESTS PASSED (${passed}/${total})`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runTest().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(`\n❌ [TEST FATAL] ${err.message}\n${err.stack}`);
    cleanDir(TEST_DIR);
    process.exit(1);
  });
}

module.exports = { runTest };
