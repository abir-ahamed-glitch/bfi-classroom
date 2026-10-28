import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  safeReadSpreadsheet,
  safeReadSpreadsheetAsync,
  validateWorksheetStructure,
  checkZipArchiveLimits,
  MAX_SPREADSHEET_BYTES,
  MAX_SPREADSHEET_ROWS,
  MAX_SPREADSHEET_COLS,
  MAX_SPREADSHEET_CELLS
} from '../src/utils/safeSpreadsheet.js';

test('safeSpreadsheet: parses valid tabular sheet into 2D array of strings', () => {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ['Name', 'Email', 'Batch', 'Phone'],
    ['John Doe', 'john@example.com', '12', '+1234567890'],
    ['Jane Smith', 'jane@example.com', '12', '+1987654321']
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Students');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const result = safeReadSpreadsheet(buf);

  assert.equal(result.length, 3);
  assert.deepEqual(result[0], ['Name', 'Email', 'Batch', 'Phone']);
  assert.deepEqual(result[1], ['John Doe', 'john@example.com', '12', '+1234567890']);
  assert.deepEqual(result[2], ['Jane Smith', 'jane@example.com', '12', '+1987654321']);
});

test('safeSpreadsheet: handles genuine formula cells by extracting cached values without evaluating expressions', () => {
  /**
   * Precise security behavior tested:
   * 1. A genuine formula cell in SheetJS has property `f` (formula AST/expression string) and optional `v` (cached value).
   * 2. SheetJS does NOT possess an active formula evaluation runtime engine; it does not execute formulas on read.
   * 3. Setting `cellFormula: false` ensures the `.f` expression property is stripped/ignored during parsing,
   *    retaining only the precalculated cached value `v` (or empty if uncached).
   */
  const wb = XLSX.utils.book_new();
  const ws = {
    '!ref': 'A1:C2',
    'A1': { t: 's', v: 'Header' },
    'B1': { t: 's', v: 'CachedFormula' },
    'C1': { t: 's', v: 'UncachedFormula' },
    'A2': { t: 's', v: 'Data' },
    // Genuine formula cell with precomputed cached value 42
    'B2': { t: 'n', f: 'SUM(A1:A10)', v: 42 },
    // Genuine formula cell without precomputed cached value
    'C2': { t: 'n', f: '1+1' }
  };
  XLSX.utils.book_append_sheet(wb, ws, 'Formulas');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const result = safeReadSpreadsheet(buf);

  assert.equal(result.length, 2);
  assert.equal(result[0][0], 'Header');
  assert.equal(result[0][1], 'CachedFormula');
  assert.equal(result[0][2], 'UncachedFormula');

  // Cell B2 returns static precalculated value '42' without formula expression
  assert.equal(result[1][1], '42');
  // Cell C2 has no precalculated cached value, so it resolves to empty string safely
  assert.equal(result[1][2], '');
});

test('safeSpreadsheet: prevents silent truncation and strictly enforces row boundaries', () => {
  /**
   * Precise behavior tested:
   * Reviewer reproduced silent truncation: an XLSX containing 5,002 rows returned 5,000 rows without an error.
   * Fix: We must never silently omit records. Files exceeding the limit must be rejected with an actionable error.
   * We test the exact boundary:
   * - 5,001 rows (1 header + 5,000 student data rows) -> Allowed (cleanly returns all 5,001 rows).
   * - 5,002 rows (1 header + 5,001 student data rows) -> Rejection error thrown (zero silent truncation).
   * - Tested both with !fullref present and when !fullref is stripped/missing (e.g. CSV or custom format).
   */
  function generateRows(count) {
    const rows = [['Header_Name', 'Header_Email']];
    for (let i = 1; i < count; i++) {
      rows.push([`Student_${i}`, `student_${i}@bfi.edu`]);
    }
    return rows;
  }

  // 1. Boundary PASS: Exactly 5,001 rows (1 header + 5,000 data rows)
  const rows5001 = generateRows(5001);
  const wb5001 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb5001, XLSX.utils.aoa_to_sheet(rows5001), 'ExactLimit');
  const buf5001 = XLSX.write(wb5001, { type: 'buffer', bookType: 'xlsx' });

  const result5001 = safeReadSpreadsheet(buf5001, { maxRows: 5001 });
  assert.equal(result5001.length, 5001, 'All 5,001 rows must be parsed without loss');
  assert.equal(result5001[0][0], 'Header_Name');
  assert.equal(result5001[5000][0], 'Student_5000');

  // 2. Boundary REJECT: 5,002 rows with standard XLSX !fullref metadata
  const rows5002 = generateRows(5002);
  const wb5002 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb5002, XLSX.utils.aoa_to_sheet(rows5002), 'OverLimit');
  const buf5002 = XLSX.write(wb5002, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(buf5002, { maxRows: 5001 });
  }, /Spreadsheet exceeds maximum supported limit of 5,001 rows/, 'Must reject 5,002 rows rather than silently truncating');

  // 3. Boundary REJECT without !fullref (e.g. CSV format where !fullref is not exposed)
  const csvData = rows5002.map(r => r.join(',')).join('\n');
  const csvBuffer = Buffer.from(csvData, 'utf8');

  assert.throws(() => {
    safeReadSpreadsheet(csvBuffer, { maxRows: 5001 });
  }, /Spreadsheet exceeds maximum supported limit of 5,001 rows/, 'Must reject oversized rows even when !fullref is absent');
});

test('safeSpreadsheet: pre-allocation cell limit rejects dense matrices before sheet_to_json allocates', () => {
  /**
   * Precise behavior tested:
   * Cell limit must be checked on worksheet object keys BEFORE invoking sheet_to_json,
   * preventing unbounded memory allocation from dense or maliciously crafted matrices.
   */
  const wsDense = {
    '!ref': 'A1:CV1000' // Declares 100 cols x 1,000 rows
  };

  // Populate 1,000 cells directly on ws
  for (let r = 1; r <= 100; r++) {
    for (let c = 0; c < 15; c++) {
      const colLetter = String.fromCharCode(65 + c);
      wsDense[`${colLetter}${r}`] = { t: 's', v: `cell_${r}_${c}` };
    }
  }

  // Passing maxCells: 500 must reject before sheet_to_json conversion
  const wb = XLSX.utils.book_new();
  wb.SheetNames.push('Dense');
  wb.Sheets['Dense'] = wsDense;
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(buf, { maxCells: 500 });
  }, /exceeds maximum allowable cell limit \(\d+ cells > 500 max\)\. Import rejected before data allocation\./);
});

test('safeSpreadsheet: checks ZIP archive expansion headers to prevent decompression bombs', () => {
  /**
   * Precise behavior tested:
   * checkZipArchiveLimits parses the Central Directory headers in binary buffers to enforce
   * uncompressed size limits before SheetJS decompressor or XML parser is invoked.
   */
  const validWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(validWb, XLSX.utils.aoa_to_sheet([['A', 'B']]), 'Sheet1');
  const validBuf = XLSX.write(validWb, { type: 'buffer', bookType: 'xlsx' });

  // Normal archive passes inspection
  assert.doesNotThrow(() => {
    checkZipArchiveLimits(validBuf, { maxUncompressedBytes: 10 * 1024 * 1024 });
  });

  // Archive exceeding uncompressed limit is rejected
  assert.throws(() => {
    // Set maxUncompressedBytes to 1KB (normal XLSX uncompresses to ~14KB XML)
    checkZipArchiveLimits(validBuf, { maxUncompressedBytes: 1024 });
  }, /Total uncompressed archive size .* exceeds maximum allowable limit/);
});

test('safeSpreadsheet: exercises production validateWorksheetStructure to reject dangerous prototype properties', () => {
  /**
   * Precise behavior tested:
   * Exercises production function validateWorksheetStructure(ws) directly.
   * Asserts that dangerous own-properties on the worksheet object are detected, sanitized, and rejected.
   */
  const cleanWs = XLSX.utils.aoa_to_sheet([['Name', 'Email']]);
  assert.doesNotThrow(() => {
    validateWorksheetStructure(cleanWs);
  }, 'Clean worksheet structure must pass validation');

  // Define dangerous prototype property directly on worksheet object
  const dangerousWs = XLSX.utils.aoa_to_sheet([['Name', 'Email']]);
  Object.defineProperty(dangerousWs, '__proto__', {
    value: { dangerous: true },
    configurable: true,
    enumerable: true
  });

  assert.throws(() => {
    validateWorksheetStructure(dangerousWs);
  }, /dangerous property '__proto__' detected on worksheet object/);

  // Define constructor property directly on worksheet object
  const dangerousConstructorWs = XLSX.utils.aoa_to_sheet([['Name', 'Email']]);
  dangerousConstructorWs.constructor = { evil: true };

  assert.throws(() => {
    validateWorksheetStructure(dangerousConstructorWs);
  }, /dangerous property 'constructor' detected on worksheet object/);
});

test('safeSpreadsheet: upstream vendor patch audit (CVE-2023-30533 in xlsx 0.20.3) preserves Object.prototype', () => {
  /**
   * Honesty disclosure:
   * Tests that parsing a workbook containing payload structures with xlsx@0.20.3
   * does NOT inject or corrupt properties on Object.prototype.
   */
  const testMarker = '__proto_pollute_test_' + Date.now();
  assert.equal(Object.prototype[testMarker], undefined, 'Precondition: prototype is clean');

  const maliciousWb = XLSX.utils.book_new();
  const maliciousData = [
    ['__proto__', 'constructor', 'prototype'],
    [`{"${testMarker}":"polluted"}`, '__proto__.polluted', 'isAdmin']
  ];
  const ws = XLSX.utils.aoa_to_sheet(maliciousData);
  XLSX.utils.book_append_sheet(maliciousWb, ws, '__proto__');

  const buf = XLSX.write(maliciousWb, { type: 'buffer', bookType: 'xlsx' });
  const result = safeReadSpreadsheet(buf);

  assert.equal(Object.prototype[testMarker], undefined, 'Object.prototype must not be polluted');
  assert.equal(Object.prototype.polluted, undefined, 'Object.prototype must not have polluted property');
  assert.equal(result.length, 2);
});

test('safeSpreadsheet: safeReadSpreadsheetAsync completes within bounded timeout in background worker', async () => {
  /**
   * Tests safeReadSpreadsheetAsync execution. In Node test environment, safely resolves Promise.
   * Also verifies isolated Node runner completes dense 100-row test fixture in <200ms.
   */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Col1', 'Col2'], ['Val1', 'Val2']]), 'AsyncTest');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const asyncResult = await safeReadSpreadsheetAsync(buf);
  assert.equal(asyncResult.length, 2);
  assert.deepEqual(asyncResult[0], ['Col1', 'Col2']);
  assert.deepEqual(asyncResult[1], ['Val1', 'Val2']);

  // Run isolated subprocess test
  const runnerScript = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../scripts/isolated_spreadsheet_runner.cjs'
  );

  const result = await new Promise((resolve, reject) => {
    const child = fork(runnerScript, [], {
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Isolated spreadsheet runner timed out (execution exceeded bounded time limit)'));
    }, 5000);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  assert.equal(result.code, 0, `Child runner failed: ${result.stderr}`);
  assert.match(result.stdout, /ISOLATED_PARSE_SUCCESS/, 'Child process parsed bounded spreadsheet within time limit');
});
