#!/usr/bin/env node
/**
 * scripts/rehearse_clean_install.cjs
 *
 * Rehearsal Suite for Clean Dependency Installation in Disposable Isolation.
 * Executes the exact canonical deployment installation command:
 *   npm ci --legacy-peer-deps
 * in a temporary directory, verifying zero installation errors, clean exit status,
 * and exact package fidelity.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

async function main() {
  console.log('================================================================');
  console.log('CLEAN DEPENDENCY INSTALLATION REHEARSAL (DISPOSABLE ENVIRONMENT)');
  console.log('Command Sequence: npm ci --legacy-peer-deps');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const tempInstallDir = path.resolve(rootDir, '.tmp_rehearse_install_' + Date.now());

  fs.mkdirSync(tempInstallDir, { recursive: true });

  try {
    console.log(`[Step 1] Creating isolated test directory: ${tempInstallDir}`);
    fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(tempInstallDir, 'package.json'));
    fs.copyFileSync(path.join(rootDir, 'package-lock.json'), path.join(tempInstallDir, 'package-lock.json'));

    console.log('[Step 2] Executing canonical deployment install: npm ci --legacy-peer-deps...');
    const startTime = Date.now();
    const result = cp.spawnSync('npm', ['ci', '--legacy-peer-deps'], {
      cwd: tempInstallDir,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, NODE_ENV: 'development' }
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Step 2] Execution completed in ${duration}s with exit code: ${result.status}`);

    if (result.status !== 0) {
      console.error('STDERR:', result.stderr.toString('utf8'));
      console.error('STDOUT:', result.stdout.toString('utf8'));
      throw new Error(`npm ci failed with exit code ${result.status}`);
    }

    console.log('[Step 3] Verifying installed package integrity in isolated environment...');
    const installedSharp = require(path.join(tempInstallDir, 'node_modules', 'sharp', 'package.json'));
    const installedNodemailer = require(path.join(tempInstallDir, 'node_modules', 'nodemailer', 'package.json'));
    const installedUuid = require(path.join(tempInstallDir, 'node_modules', 'uuid', 'package.json'));

    assert.strictEqual(installedSharp.version, '0.35.5', 'Sharp must be 0.35.5');
    assert.strictEqual(installedNodemailer.version, '10.3.0', 'Nodemailer must be 10.3.0');
    assert.ok(parseInt(installedUuid.version.split('.')[0], 10) >= 11, 'Uuid must be >= 11');

    console.log(`         ✅ Sharp version: ${installedSharp.version}`);
    console.log(`         ✅ Nodemailer version: ${installedNodemailer.version}`);
    console.log(`         ✅ Uuid version: ${installedUuid.version}`);

    console.log('[Step 4] Running npm audit --omit=dev --json in clean installation...');
    let auditStdout;
    try {
      cp.execSync('npm audit --omit=dev --json', { cwd: tempInstallDir, stdio: 'pipe' });
    } catch (e) {
      auditStdout = e.stdout ? e.stdout.toString('utf8') : '';
    }

    const auditData = JSON.parse(auditStdout || '{}');
    const vulns = Object.keys(auditData.vulnerabilities || {});
    console.log(`[Step 4] Total remaining production vulnerabilities: ${vulns.length}`);

    // Verify all remaining vulnerabilities belong exclusively to pdfjs-dist and its plugins
    const nonPdfVulns = vulns.filter(v => v !== 'pdfjs-dist' && !v.startsWith('@react-pdf-viewer/'));
    assert.strictEqual(nonPdfVulns.length, 0, `Expected 0 non-PDF vulnerabilities, found: ${nonPdfVulns.join(', ')}`);
    console.log('         ✅ Verified: 100% of non-PDF production vulnerabilities eliminated.');

    console.log('\n================================================================');
    console.log('REHEARSAL RESULT: CLEAN INSTALLATION REHEARSAL PASSED (100%)');
    console.log('================================================================');

  } finally {
    try {
      fs.rmSync(tempInstallDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Clean install rehearsal error:', err);
    process.exit(1);
  });
}
