/**
 * scripts/audit_validator.cjs
 *
 * Fail-Closed Validator for `npm audit --json` outputs.
 * Enforces strict schema verification, captures execution status, and ensures that
 * missing output, service errors, malformed payloads, or unexpected exit codes
 * fail closed rather than silently defaulting to clean audits.
 */

'use strict';

/**
 * Validates and parses the result of an `npm audit --json` execution.
 *
 * @param {object} procResult Process execution result object
 * @param {Buffer|string} procResult.stdout Standard output
 * @param {Buffer|string} [procResult.stderr] Standard error
 * @param {number|null} procResult.status Process exit code
 * @param {Error} [procResult.error] Execution error (e.g. spawn failure)
 * @returns {{ completed: boolean, vulnerabilities: object, vulnKeys: string[], count: number, status: number, metadata: object }}
 */
function parseAndValidateAuditResult(procResult) {
  if (!procResult || typeof procResult !== 'object') {
    throw new Error('Audit validator requires a process result object.');
  }

  // 1. Check for spawn/execution failure before stdout could be produced
  if (procResult.error && !procResult.stdout) {
    throw new Error(`npm audit execution failed to start: ${procResult.error.message}`);
  }

  const stdoutStr = (procResult.stdout ? procResult.stdout.toString('utf8') : '').trim();
  const stderrStr = (procResult.stderr ? procResult.stderr.toString('utf8') : '').trim();
  const status = procResult.status;

  // 2. Reject missing output - an unavailable audit must NEVER be treated as clean
  if (!stdoutStr) {
    throw new Error(
      `npm audit produced no stdout (exit code: ${status}, stderr: ${stderrStr || 'none'}). Audit could not complete.`
    );
  }

  // 3. Parse JSON safely
  let data;
  try {
    data = JSON.parse(stdoutStr);
  } catch (err) {
    throw new Error(
      `npm audit produced invalid JSON: ${err.message}. Raw output snippet: ${stdoutStr.slice(0, 200)}...`
    );
  }

  // 4. Validate top-level payload schema
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('npm audit JSON payload is not a valid JSON object.');
  }

  // 5. Fail closed on npm registry or service errors
  if (data.error) {
    const code = data.error.code || 'ENOAUDIT';
    const summary = data.error.summary || data.error.detail || JSON.stringify(data.error);
    throw new Error(`npm audit service failed (${code}): ${summary}. Audit could not complete.`);
  }

  // 6. Validate required schema properties
  if (typeof data.vulnerabilities !== 'object' || data.vulnerabilities === null || Array.isArray(data.vulnerabilities)) {
    throw new Error('npm audit JSON payload missing required "vulnerabilities" dictionary.');
  }

  const vulnKeys = Object.keys(data.vulnerabilities);
  const count = vulnKeys.length;

  // 7. Validate exit status semantics
  // npm audit convention:
  // - Exit 0: Zero vulnerabilities found
  // - Exit 1 (or positive bitmask in older versions): Vulnerabilities found
  // Any other status (null, 2, 127, etc.) represents command failure or crash
  if (status !== 0 && status !== 1) {
    throw new Error(
      `npm audit exited with unexpected status code ${status} (stderr: ${stderrStr || 'none'}). Audit could not complete.`
    );
  }

  // Validate consistency between exit status and reported vulnerabilities
  if (status === 0 && count > 0) {
    throw new Error(
      `npm audit exited with status 0 but reported ${count} vulnerabilities in payload. Inconsistent exit status.`
    );
  }
  if (status === 1 && count === 0) {
    throw new Error(
      `npm audit exited with status 1 (vulnerabilities flagged) but vulnerabilities dictionary is empty. Inconsistent schema.`
    );
  }

  return {
    completed: true,
    vulnerabilities: data.vulnerabilities,
    vulnKeys,
    count,
    status,
    metadata: data.metadata || {}
  };
}

module.exports = {
  parseAndValidateAuditResult
};
