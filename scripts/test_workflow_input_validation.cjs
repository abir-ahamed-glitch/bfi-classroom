/**
 * scripts/test_workflow_input_validation.cjs
 *
 * Dedicated unit and regression suite testing runner-side and remote-side
 * input validation, shell injection defenses, and git object type assertions
 * for .github/workflows/deploy.yml.
 *
 * Strictly executed locally against disposable vectors — NEVER against production.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('START: WORKFLOW INPUT VALIDATION & HARDENING TEST SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

/**
 * Runner-side input validation simulation.
 * Exact logic mirroring step `Validate Workflow Inputs` in deploy.yml.
 */
function validateRunnerInputs(rawCommit, rawMfa) {
  const defaultCommit = '8d0bbfd65901a98620374baedfc7ea620280b006';
  const commit = (rawCommit !== undefined && rawCommit !== null && rawCommit !== '') ? rawCommit : defaultCommit;

  // Strict regex: exactly 40 hexadecimal characters
  const commitRegex = /^[0-9a-fA-F]{40}$/;
  if (!commitRegex.test(commit)) {
    throw new Error(`target_commit must be exactly 40 hexadecimal characters. Received: '${commit}'`);
  }

  const normalizedCommit = commit.toLowerCase();

  const mfa = (rawMfa !== undefined && rawMfa !== null && rawMfa !== '') ? String(rawMfa) : 'true';
  if (mfa !== 'true' && mfa !== 'false') {
    throw new Error(`rotate_mfa must be 'true' or 'false'. Received: '${mfa}'`);
  }

  return { target_commit: normalizedCommit, rotate_mfa: mfa };
}

/**
 * Remote-side validation simulation.
 * Exact logic mirroring step `script` remote preflight in deploy.yml.
 */
function validateRemotePreflight(targetCommit, rotateMfa, cwd = process.cwd()) {
  const commitRegex = /^[0-9a-f]{40}$/;
  if (!commitRegex.test(targetCommit)) {
    throw new Error(`Remote validation error: TARGET_COMMIT is not a valid 40-character hex SHA. Received: '${targetCommit}'`);
  }

  if (rotateMfa !== 'true' && rotateMfa !== 'false') {
    throw new Error(`Remote validation error: ROTATE_MFA must be 'true' or 'false'. Received: '${rotateMfa}'`);
  }

  // Object verification: must exist and be of type 'commit'
  try {
    const type = execSync(`git cat-file -t ${targetCommit}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (type !== 'commit') {
      throw new Error(`Remote validation error: Object ${targetCommit} is not a valid git commit object (type: '${type}').`);
    }
  } catch (err) {
    if (err.message.includes('Remote validation error')) throw err;
    throw new Error(`Remote validation error: Object ${targetCommit} does not exist in git.`);
  }

  return true;
}

// -------------------------------------------------------------
// [Suite 1] Runner-Side Negative & Shell Injection Tests
// -------------------------------------------------------------
console.log('--- [Suite 1] Runner-Side Target Commit Validation ---');

const injectionVectors = [
  { val: '8d0bbfd65901a98620374baedfc7ea620280b006"; rm -rf /; echo "', desc: 'Double quote command injection' },
  { val: "8d0bbfd65901a98620374baedfc7ea620280b006'; reboot; echo '", desc: 'Single quote command injection' },
  { val: '`reboot`8d0bbfd65901a98620374baedfc7ea620280b006', desc: 'Backtick command injection' },
  { val: '$(whoami)8d0bbfd65901a98620374baedfc7ea620280b006', desc: 'Subshell command substitution' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b006\nrm -rf /', desc: 'Newline command separation' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b006\r\nreboot', desc: 'CRLF command separation' },
  { val: ' 8d0bbfd65901a98620374baedfc7ea620280b006', desc: 'Leading whitespace' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b006 ', desc: 'Trailing whitespace' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00\t', desc: 'Tab whitespace' },
  { val: '8d0bbfd', desc: 'Short 7-char abbreviated SHA' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00', desc: 'Short 39-char hex string' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b0060', desc: 'Oversized 41-char hex string' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00g', desc: 'Non-hex character (g)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00z', desc: 'Non-hex character (z)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00-', desc: 'Punctuation character (-)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00;', desc: 'Semicolon character (;)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00|', desc: 'Pipe character (|)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00&', desc: 'Ampersand character (&)' }
];

for (const vec of injectionVectors) {
  let threw = false;
  try {
    validateRunnerInputs(vec.val, 'true');
  } catch (err) {
    threw = true;
  }
  assert(threw, `Rejected ${vec.desc}: '${vec.val.replace(/[\r\n]/g, '\\n')}'`);
}

// Positive tests for commit input
const validCommit = '8d0bbfd65901a98620374baedfc7ea620280b006';
const upperCommit = '8D0BBFD65901A98620374BAEDFC7EA620280B006';

const res1 = validateRunnerInputs(validCommit, 'true');
assert(res1.target_commit === validCommit && res1.rotate_mfa === 'true', 'Valid 40-char lowercase hex accepted');

const res2 = validateRunnerInputs(upperCommit, 'false');
assert(res2.target_commit === validCommit && res2.rotate_mfa === 'false', 'Valid 40-char uppercase hex normalized to lowercase');

const resDefault = validateRunnerInputs('', 'true');
assert(resDefault.target_commit === validCommit, 'Empty input defaults to approved candidate commit');

// -------------------------------------------------------------
// [Suite 2] Runner-Side Rotate MFA Boolean Validation
// -------------------------------------------------------------
console.log('\n--- [Suite 2] Runner-Side Rotate MFA Boolean Validation ---');

const mfaInvalidVectors = [
  'yes', 'no', '0', '1', 'True', 'False', 'true; rm -rf', '"true"', "'false'", 'true\nmalicious'
];

for (const mfa of mfaInvalidVectors) {
  let threw = false;
  try {
    validateRunnerInputs(validCommit, mfa);
  } catch (err) {
    threw = true;
  }
  assert(threw, `Rejected invalid rotate_mfa vector: '${mfa}'`);
}

const resMfaTrue = validateRunnerInputs(validCommit, 'true');
assert(resMfaTrue.rotate_mfa === 'true', 'Accepted rotate_mfa: true');

const resMfaFalse = validateRunnerInputs(validCommit, 'false');
assert(resMfaFalse.rotate_mfa === 'false', 'Accepted rotate_mfa: false');

// -------------------------------------------------------------
// [Suite 3] Remote Preflight Git Object Type Assertions
// -------------------------------------------------------------
console.log('\n--- [Suite 3] Remote Preflight Git Object Type Assertions ---');

// Test 1: Real commit object
const remoteRes1 = validateRemotePreflight(validCommit, 'true');
assert(remoteRes1 === true, 'Real commit object (8d0bbfd6...) verified as type commit');

// Test 2: Tree object (should be rejected because type is 'tree', not 'commit')
const treeHash = execSync(`git rev-parse ${validCommit}:`, { encoding: 'utf8' }).trim();
let treeThrew = false;
try {
  validateRemotePreflight(treeHash, 'true');
} catch (err) {
  treeThrew = err.message.includes("is not a valid git commit object (type: 'tree')");
}
assert(treeThrew, `Non-commit tree object (${treeHash.slice(0, 8)}) rejected cleanly`);

// Test 3: Non-existent 40-char hex SHA
const nonExistentCommit = '0000000000000000000000000000000000000000';
let nonExistThrew = false;
try {
  validateRemotePreflight(nonExistentCommit, 'true');
} catch (err) {
  nonExistThrew = err.message.includes('does not exist in git');
}
assert(nonExistThrew, `Non-existent commit SHA (${nonExistentCommit.slice(0, 8)}) rejected cleanly`);

// -------------------------------------------------------------
// [Suite 4] Clean Tracked Working Tree Assertion Test
// -------------------------------------------------------------
console.log('\n--- [Suite 4] Clean Tracked Working Tree Assertion ---');

function checkDirtyTracked(statusOutput) {
  const dirty = statusOutput.trim();
  if (dirty.length > 0) {
    throw new Error(`Dirty tracked files detected:\n${dirty}`);
  }
  return true;
}

// Negative test: dirty tracked files detected
let dirtyThrew = false;
try {
  checkDirtyTracked(' M ecosystem.config.cjs\n M server/server.js');
} catch (err) {
  dirtyThrew = err.message.includes('Dirty tracked files detected');
}
assert(dirtyThrew, 'Preflight check halts closed when dirty tracked files are present');

// Positive test: clean working tree
assert(checkDirtyTracked('') === true, 'Preflight check passes when zero tracked changes exist');
assert(checkDirtyTracked('   \n  \n') === true, 'Preflight check passes on whitespace-only status output');

// -------------------------------------------------------------
// [Suite 5] deploy.yml Template Structure & Zero Injection Audit
// -------------------------------------------------------------
console.log('\n--- [Suite 5] deploy.yml Zero Script Template Interpolation Audit ---');

const workflowPath = path.resolve(__dirname, '../.github/workflows/deploy.yml');
const workflowYaml = fs.readFileSync(workflowPath, 'utf8');

// Assert no ${{ ... }} inside the `script: |` section
const scriptSectionMatch = workflowYaml.match(/script:\s*\|([\s\S]*?)(?=\n\s*[a-zA-Z0-9_-]+:|$)/);
assert(scriptSectionMatch !== null, 'Found script: | block in deploy.yml');

const scriptContent = scriptSectionMatch[1];
const hasExpressionInScript = /\$\{\{\s*.*?\s*\}\}/.test(scriptContent);
assert(!hasExpressionInScript, 'Zero ${{ ... }} template expressions inside script: | body (prevents command injection)');

// Assert envs mapping in ssh-action
assert(workflowYaml.includes('envs: TARGET_COMMIT,ROTATE_MFA,SUPER_ADMIN_TOKEN,ADMIN_TOKEN'), 'ssh-action uses envs: TARGET_COMMIT,ROTATE_MFA,SUPER_ADMIN_TOKEN,ADMIN_TOKEN');

// Assert validate step exists and runs before ssh step
const validateStepIndex = workflowYaml.indexOf('id: validate');
const sshStepIndex = workflowYaml.indexOf('uses: appleboy/ssh-action');
assert(validateStepIndex !== -1 && sshStepIndex !== -1 && validateStepIndex < sshStepIndex, 'Validation step executes strictly before appleboy/ssh-action step');

// Assert dirty tracked files check is present and git checkout is removed
assert(!scriptContent.includes('git checkout -- ecosystem.config.cjs'), 'Silent git checkout -- ecosystem.config.cjs is removed');
assert(scriptContent.includes('git status --porcelain -uno'), 'Strict git status --porcelain -uno dirty check is present');

console.log('\n================================================================');
console.log(`ALL ${totalTests} WORKFLOW INPUT VALIDATION TESTS PASSED (${passedTests}/${totalTests})`);
console.log('================================================================');
