#!/usr/bin/env node
/**
 * scripts/test_audit_validator.cjs
 *
 * Regression Suite for Fail-Closed npm Audit Validation.
 * Proves that:
 * 1. Missing output, crashes, registry errors, and malformed schemas NEVER default to clean.
 * 2. Exit codes and vulnerability dictionaries must be consistent.
 * 3. Legitimate clean and finding-bearing audits are parsed accurately.
 */

'use strict';

const assert = require('assert');
const { parseAndValidateAuditResult } = require('./audit_validator.cjs');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    fn();
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('================================================================');
console.log('NPM AUDIT FAIL-CLOSED VALIDATOR REGRESSION SUITE');
console.log('================================================================\n');

// 1. Valid clean audit (exit 0, 0 vulnerabilities)
runTest('Valid clean audit: parses exit 0 with empty vulnerabilities dictionary', () => {
  const result = parseAndValidateAuditResult({
    status: 0,
    stdout: JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { totalDependencies: 1200 }
    }),
    stderr: ''
  });
  assert.strictEqual(result.completed, true);
  assert.strictEqual(result.count, 0);
  assert.deepStrictEqual(result.vulnKeys, []);
  assert.strictEqual(result.status, 0);
});

// 2. Valid audit with known findings (exit 1, populated vulnerabilities)
runTest('Valid audit with findings: parses exit 1 with reported packages', () => {
  const result = parseAndValidateAuditResult({
    status: 1,
    stdout: JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        'pdfjs-dist': { name: 'pdfjs-dist', severity: 'high' },
        '@react-pdf-viewer/core': { name: '@react-pdf-viewer/core', severity: 'high' }
      },
      metadata: { vulnerabilities: { high: 2 } }
    }),
    stderr: ''
  });
  assert.strictEqual(result.completed, true);
  assert.strictEqual(result.count, 2);
  assert.deepStrictEqual(result.vulnKeys, ['pdfjs-dist', '@react-pdf-viewer/core']);
  assert.strictEqual(result.status, 1);
});

// 3. Missing stdout with exit 0 (must NOT default to clean audit)
runTest('Missing output on exit 0: throws and fails closed instead of reporting clean', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 0,
        stdout: '',
        stderr: ''
      });
    },
    /npm audit produced no stdout/
  );
});

// 4. Missing stdout with exit 1
runTest('Missing output on exit 1: throws and fails closed', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 1,
        stdout: '',
        stderr: 'npm ERR! code ECONNRESET'
      });
    },
    /npm audit produced no stdout/
  );
});

// 5. Malformed JSON payload
runTest('Malformed JSON output: rejects unparseable stdout', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 1,
        stdout: '<html>502 Bad Gateway</html>',
        stderr: ''
      });
    },
    /npm audit produced invalid JSON/
  );
});

// 6. npm service/registry error response object
runTest('npm service error: rejects registry error object with code ENOAUDIT', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 1,
        stdout: JSON.stringify({
          error: {
            code: 'ENOAUDIT',
            summary: 'Your configured registry does not support audit requests.',
            detail: 'Check your .npmrc configuration.'
          }
        }),
        stderr: ''
      });
    },
    /npm audit service failed \(ENOAUDIT\)/
  );
});

// 7. Schema error: missing "vulnerabilities" dictionary
runTest('Schema error: rejects payload missing vulnerabilities dictionary', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 0,
        stdout: JSON.stringify({
          auditReportVersion: 2,
          metadata: { totalDependencies: 1200 }
        }),
        stderr: ''
      });
    },
    /missing required "vulnerabilities" dictionary/
  );
});

// 8. Unexpected exit code (e.g. exit 2 or 127)
runTest('Unexpected exit code: rejects exit status 2 as command failure', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 2,
        stdout: JSON.stringify({
          auditReportVersion: 2,
          vulnerabilities: {}
        }),
        stderr: 'npm command syntax error'
      });
    },
    /unexpected status code 2/
  );
});

// 9. Inconsistent exit code: exit 0 with non-empty vulnerabilities
runTest('Inconsistent status: rejects exit 0 when vulnerabilities are present', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 0,
        stdout: JSON.stringify({
          auditReportVersion: 2,
          vulnerabilities: {
            'vulnerable-pkg': { severity: 'critical' }
          }
        }),
        stderr: ''
      });
    },
    /exited with status 0 but reported 1 vulnerabilities/
  );
});

// 10. Inconsistent exit code: exit 1 with empty vulnerabilities dictionary
runTest('Inconsistent status: rejects exit 1 when vulnerabilities dictionary is empty', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 1,
        stdout: JSON.stringify({
          auditReportVersion: 2,
          vulnerabilities: {}
        }),
        stderr: ''
      });
    },
    /exited with status 1 \(vulnerabilities flagged\) but vulnerabilities dictionary is empty/
  );
});

// 11. Process spawn error
runTest('Process spawn failure: rejects when spawn throws before producing stdout', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: null,
        error: new Error('spawn npm ENOENT'),
        stdout: null,
        stderr: null
      });
    },
    /npm audit execution failed to start: spawn npm ENOENT/
  );
});

// 12. Non-object JSON payload (array or primitive)
runTest('Non-object JSON payload: rejects top-level array', () => {
  assert.throws(
    () => {
      parseAndValidateAuditResult({
        status: 0,
        stdout: JSON.stringify(['not', 'an', 'object']),
        stderr: ''
      });
    },
    /not a valid JSON object/
  );
});

console.log('\n================================================================');
console.log(`Audit Validator Regression Results: ${passedTests}/${totalTests} Passed`);
console.log('================================================================');

if (passedTests !== totalTests) {
  process.exit(1);
}
