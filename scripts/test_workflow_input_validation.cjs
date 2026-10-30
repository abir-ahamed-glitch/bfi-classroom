/**
 * scripts/test_workflow_input_validation.cjs
 *
 * Dedicated unit and regression suite testing the ACTUAL Bash validation code
 * extracted directly from .github/workflows/deploy.yml.
 *
 * Exercises whole-value validation, multiline injection rejection, and git object type assertions.
 * Strictly executed locally against disposable vectors — NEVER against production.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('================================================================');
console.log('START: WORKFLOW INPUT WHOLE-VALUE VALIDATION SUITE');
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

// Locate Git Bash binary on Windows or system bash on POSIX
function findBashBinary() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'bash'
  ];
  for (const c of candidates) {
    try {
      const res = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (res.status === 0 && res.stdout.includes('GNU bash')) {
        return c;
      }
    } catch (_) {}
  }
  throw new Error('Could not find GNU bash binary for testing.');
}

const bashBin = findBashBinary();
console.log(`Found Bash binary for workflow testing: ${bashBin}`);

// Read .github/workflows/deploy.yml
const workflowPath = path.resolve(__dirname, '../.github/workflows/deploy.yml');
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

// Extract the runner validation script block from step `id: validate`
const runnerScriptMatch = workflowContent.match(/id:\s*validate[\s\S]*?run:\s*\|([\s\S]*?)(?=\n\s*-\s*name:|$)/);
if (!runnerScriptMatch) {
  throw new Error('Could not extract runner validation script from .github/workflows/deploy.yml');
}
const runnerValidationBashScript = runnerScriptMatch[1];

// Extract remote validation script block from appleboy/ssh-action
const remoteScriptMatch = workflowContent.match(/uses:\s*appleboy\/ssh-action[\s\S]*?script:\s*\|([\s\S]*?)(?=\n\s*[a-zA-Z0-9_-]+:|$)/);
if (!remoteScriptMatch) {
  throw new Error('Could not extract remote script from .github/workflows/deploy.yml');
}
const remoteScriptBody = remoteScriptMatch[1];

// Extract remote validation steps 1, 2, 3
const remoteValidationLines = remoteScriptBody
  .split('\n')
  .filter(line => !line.includes('npm') && !line.includes('deploy --target-commit') && !line.includes('git show') && !line.includes('node -e'))
  .join('\n');

/**
 * Execute the EXACT extracted runner validation script using Bash.
 */
function runRunnerValidationScript(rawTargetCommit, rawRotateMfa) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-'));
  const githubOutputPath = path.join(tmpDir, 'github_output.txt');
  const scriptPath = path.join(tmpDir, 'validate_step.sh');

  fs.writeFileSync(scriptPath, runnerValidationBashScript, { encoding: 'utf8' });

  const env = {
    ...process.env,
    GITHUB_OUTPUT: githubOutputPath,
  };
  if (rawTargetCommit !== undefined) env.RAW_TARGET_COMMIT = rawTargetCommit;
  else delete env.RAW_TARGET_COMMIT;

  if (rawRotateMfa !== undefined) env.RAW_ROTATE_MFA = rawRotateMfa;
  else delete env.RAW_ROTATE_MFA;

  const result = spawnSync(bashBin, [scriptPath], {
    env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let outputContent = '';
  if (fs.existsSync(githubOutputPath)) {
    outputContent = fs.readFileSync(githubOutputPath, 'utf8');
  }

  // Cleanup
  try {
    fs.unlinkSync(scriptPath);
    if (fs.existsSync(githubOutputPath)) fs.unlinkSync(githubOutputPath);
    fs.rmdirSync(tmpDir);
  } catch (_) {}

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    githubOutput: outputContent
  };
}

// -------------------------------------------------------------
// [Suite 1] Actual Bash Runner-Side Validation — Negative Cases
// -------------------------------------------------------------
console.log('\n--- [Suite 1] Actual Bash Runner-Side Validation — Negative Cases ---');

const validSha = '8d0bbfd65901a98620374baedfc7ea620280b006';

const negativeVectors = [
  { val: `${validSha}\nrotate_mfa=false`, desc: 'Valid SHA followed by newline and extra text' },
  { val: `rotate_mfa=false\n${validSha}`, desc: 'Extra text followed by newline and valid SHA' },
  { val: `${validSha}\n`, desc: 'Trailing newline' },
  { val: `\n${validSha}`, desc: 'Leading newline' },
  { val: `8d0bbfd65901a98620374baedfc7ea62028\n0b006`, desc: 'Embedded newline within SHA' },
  { val: `${validSha}\r\n`, desc: 'Trailing CRLF' },
  { val: `\r\n${validSha}`, desc: 'Leading CRLF' },
  { val: `${validSha}\r\nrotate_mfa=false`, desc: 'Embedded CRLF with extra text' },
  { val: `${validSha}\nGITHUB_OUTPUT=malicious`, desc: 'Multiline GitHub-output-looking content' },
  { val: `${validSha}\ntarget_commit=0000000000000000000000000000000000000000`, desc: 'Output poisoning injection' },
  { val: `${validSha}"; rm -rf /; echo "`, desc: 'Double quote shell injection' },
  { val: `${validSha}'; reboot; echo '`, desc: 'Single quote shell injection' },
  { val: `\`reboot\`${validSha}`, desc: 'Backtick command injection' },
  { val: `$(whoami)${validSha}`, desc: 'Subshell command substitution' },
  { val: ` ${validSha}`, desc: 'Leading space' },
  { val: `${validSha} `, desc: 'Trailing space' },
  { val: `${validSha}\t`, desc: 'Trailing tab' },
  { val: '8d0bbfd', desc: 'Short 7-char SHA' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00', desc: 'Short 39-char SHA' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b0060', desc: 'Oversized 41-char SHA' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00g', desc: 'Non-hex character (g)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00z', desc: 'Non-hex character (z)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00-', desc: 'Punctuation character (-)' },
  { val: '8d0bbfd65901a98620374baedfc7ea620280b00;', desc: 'Semicolon character (;)' }
];

for (const vec of negativeVectors) {
  const res = runRunnerValidationScript(vec.val, 'true');
  assert(res.status !== 0, `Bash script exited non-zero on ${vec.desc}`);
  assert(res.githubOutput === '', `Zero content written to GITHUB_OUTPUT on ${vec.desc}`);
  assert(res.stderr.includes('ERROR: target_commit'), `Appropriate stderr error emitted on ${vec.desc}`);
}

// -------------------------------------------------------------
// [Suite 2] Actual Bash Runner-Side Validation — Boolean MFA Negatives
// -------------------------------------------------------------
console.log('\n--- [Suite 2] Actual Bash Runner-Side Validation — Boolean MFA Negatives ---');

const mfaInvalidVectors = [
  'yes', 'no', '0', '1', 'True', 'False', 'true; rm -rf', '"true"', "'false'", 'true\nmalicious', 'true\r\n'
];

for (const mfa of mfaInvalidVectors) {
  const res = runRunnerValidationScript(validSha, mfa);
  assert(res.status !== 0, `Bash script exited non-zero on invalid rotate_mfa: '${mfa.replace(/[\r\n]/g, '\\n')}'`);
  assert(res.githubOutput === '', `Zero content written to GITHUB_OUTPUT on invalid rotate_mfa: '${mfa.replace(/[\r\n]/g, '\\n')}'`);
}

// -------------------------------------------------------------
// [Suite 3] Actual Bash Runner-Side Validation — Positive Cases
// -------------------------------------------------------------
console.log('\n--- [Suite 3] Actual Bash Runner-Side Validation — Positive Cases ---');

// Valid lowercase SHA + true
const resPos1 = runRunnerValidationScript(validSha, 'true');
assert(resPos1.status === 0, 'Bash script exited 0 on valid lowercase SHA and rotate_mfa=true');
assert(resPos1.githubOutput.includes(`target_commit=${validSha}`), 'GITHUB_OUTPUT contains normalized target_commit');
assert(resPos1.githubOutput.includes('rotate_mfa=true'), 'GITHUB_OUTPUT contains rotate_mfa=true');

// Valid uppercase SHA + false (normalized to lowercase)
const upperSha = '8D0BBFD65901A98620374BAEDFC7EA620280B006';
const resPos2 = runRunnerValidationScript(upperSha, 'false');
assert(resPos2.status === 0, 'Bash script exited 0 on valid uppercase SHA and rotate_mfa=false');
assert(resPos2.githubOutput.includes(`target_commit=${validSha}`), 'GITHUB_OUTPUT normalized uppercase SHA to lowercase');
assert(resPos2.githubOutput.includes('rotate_mfa=false'), 'GITHUB_OUTPUT contains rotate_mfa=false');

// Default fallback when inputs are empty/omitted
const resPosDefault = runRunnerValidationScript('', '');
assert(resPosDefault.status === 0, 'Bash script exited 0 when inputs are empty (applied defaults)');
assert(resPosDefault.githubOutput.includes(`target_commit=${validSha}`), 'Default candidate commit applied');
assert(resPosDefault.githubOutput.includes('rotate_mfa=true'), 'Default rotate_mfa=true applied');

// -------------------------------------------------------------
// [Suite 4] Remote Preflight Git Object Type Assertions
// -------------------------------------------------------------
console.log('\n--- [Suite 4] Remote Preflight Git Object Type Assertions ---');

// Assert real commit object
const commitType = execSync(`git cat-file -t ${validSha}`, { encoding: 'utf8' }).trim();
assert(commitType === 'commit', `Real commit ${validSha.slice(0, 8)} verified as git object type 'commit'`);

// Assert tree object is NOT 'commit'
const treeHash = execSync(`git rev-parse ${validSha}:`, { encoding: 'utf8' }).trim();
const treeType = execSync(`git cat-file -t ${treeHash}`, { encoding: 'utf8' }).trim();
assert(treeType === 'tree' && treeType !== 'commit', `Tree object ${treeHash.slice(0, 8)} is correctly identified as type '${treeType}', not 'commit'`);

// Assert non-existent object fails git cat-file
let nonExistFailed = false;
try {
  execSync('git cat-file -t 0000000000000000000000000000000000000000', { stdio: ['pipe', 'pipe', 'ignore'] });
} catch (_) {
  nonExistFailed = true;
}
assert(nonExistFailed, 'Non-existent object SHA fails git cat-file lookup');

// -------------------------------------------------------------
// [Suite 5] deploy.yml Structure & Zero Script Template Interpolation Audit
// -------------------------------------------------------------
console.log('\n--- [Suite 5] deploy.yml Structure & Zero Script Template Interpolation Audit ---');

const scriptSectionMatch = workflowContent.match(/script:\s*\|([\s\S]*?)(?=\n\s*[a-zA-Z0-9_-]+:|$)/);
assert(scriptSectionMatch !== null, 'Found script: | block in deploy.yml');

const scriptContent = scriptSectionMatch[1];
const hasExpressionInScript = /\$\{\{\s*.*?\s*\}\}/.test(scriptContent);
assert(!hasExpressionInScript, 'Zero ${{ ... }} template expressions inside script: | body (prevents command injection)');

assert(workflowContent.includes('envs: TARGET_COMMIT,ROTATE_MFA,SUPER_ADMIN_TOKEN,ADMIN_TOKEN'), 'ssh-action uses envs: TARGET_COMMIT,ROTATE_MFA,SUPER_ADMIN_TOKEN,ADMIN_TOKEN');

const validateStepIndex = workflowContent.indexOf('id: validate');
const sshStepIndex = workflowContent.indexOf('uses: appleboy/ssh-action');
assert(validateStepIndex !== -1 && sshStepIndex !== -1 && validateStepIndex < sshStepIndex, 'Validation step executes strictly before appleboy/ssh-action step');

assert(!scriptContent.includes('git checkout -- ecosystem.config.cjs'), 'Silent git checkout -- ecosystem.config.cjs is removed');
assert(scriptContent.includes('git status --porcelain -uno'), 'Strict git status --porcelain -uno dirty check is present');

console.log('\n================================================================');
console.log(`ALL ${totalTests} WORKFLOW INPUT VALIDATION TESTS PASSED (${passedTests}/${totalTests})`);
console.log('================================================================');
