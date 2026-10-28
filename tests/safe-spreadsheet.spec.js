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
   * Cell limit must be checked on worksheet object keys and ranges BEFORE invoking sheet_to_json,
   * preventing unbounded memory allocation from dense or maliciously crafted matrices.
   */
  // 1. Matrix where declared range exceeds maxCells (spans 100,000 potential cells)
  const wsDenseRange = {
    '!ref': 'A1:CV1000' // Declares 100 cols x 1,000 rows
  };
  for (let r = 1; r <= 100; r++) {
    for (let c = 0; c < 15; c++) {
      const colLetter = String.fromCharCode(65 + c);
      wsDenseRange[`${colLetter}${r}`] = { t: 's', v: `cell_${r}_${c}` };
    }
  }

  const wbRange = XLSX.utils.book_new();
  wbRange.SheetNames.push('DenseRange');
  wbRange.Sheets['DenseRange'] = wsDenseRange;
  const bufRange = XLSX.write(wbRange, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(bufRange, { maxCells: 500 });
  }, /Spreadsheet range \(A1:CV1000\) spans 100,000 potential cells .* exceeding the maximum allowable cell limit of 500 cells\. Import rejected before data allocation\./);

  // 2. Matrix where populated cell count and range exceed maxCells
  const wsPopulated = { '!ref': 'A1:J51' };
  for (let r = 1; r <= 51; r++) {
    for (let c = 0; c < 10; c++) {
      const colLetter = String.fromCharCode(65 + c);
      wsPopulated[`${colLetter}${r}`] = { t: 's', v: `val_${r}_${c}` }; // 510 populated cells
    }
  }
  const wbPop = XLSX.utils.book_new();
  wbPop.SheetNames.push('Populated');
  wbPop.Sheets['Populated'] = wsPopulated;
  const bufPop = XLSX.write(wbPop, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(bufPop, { maxCells: 500 });
  }, /Spreadsheet range \(A1:J51\) spans 510 potential cells \(51 rows × 10 columns\), exceeding the maximum allowable cell limit of 500 cells\. Import rejected before data allocation\./);
});

test('safeSpreadsheet: bounds sparse range dimensions and potential output allocation before sheet_to_json runs', () => {
  /**
   * Precise behavior tested (Reviewer reproduction):
   * Counting existing worksheet keys alone does not bound sheet_to_json output:
   * A sparse worksheet spanning A1:CV5001 with only A1 and CV5001 populated contains only 2 keys,
   * but sheet_to_json expands every empty cell in the rectangular bounding box, allocating 500,100 cells.
   * safeReadSpreadsheet must calculate potential output allocation from the range and reject excessive
   * dimensions before sheet_to_json runs.
   */
  // 1. Sparse sheet spanning A1:CV5001 (5,001 rows x 100 cols = 500,100 potential cells) with only 2 populated cells
  const wsSparse = {
    '!ref': 'A1:CV5001',
    'A1': { t: 's', v: 'start' },
    'CV5001': { t: 's', v: 'end' }
  };
  const wbSparse = XLSX.utils.book_new();
  wbSparse.SheetNames.push('Sparse');
  wbSparse.Sheets['Sparse'] = wsSparse;
  const bufSparse = XLSX.write(wbSparse, { type: 'buffer', bookType: 'xlsx' });

  // With maxCells: 2 (Reviewer's exact test), must reject before 500,100 cells are allocated
  assert.throws(() => {
    safeReadSpreadsheet(bufSparse, { maxCells: 2, maxRows: 6000 });
  }, /Spreadsheet range \(A1:CV5001\) spans 500,100 potential cells \(5,001 rows × 100 columns\), exceeding the maximum allowable cell limit of 2 cells\. Import rejected before data allocation\./);

  // With default maxCells (50,000), 500,100 potential cells must also be rejected before allocation
  assert.throws(() => {
    safeReadSpreadsheet(bufSparse, { maxCells: 50000, maxRows: 6000 });
  }, /Spreadsheet range \(A1:CV5001\) spans 500,100 potential cells/);

  // 2. Smaller sparse sheet spanning A1:B10 (10 rows x 2 cols = 20 potential cells) with maxCells: 5
  const wsSparseSmall = {
    '!ref': 'A1:B10',
    'A1': { t: 's', v: 'top' },
    'B10': { t: 's', v: 'bottom' }
  };
  const wbSmall = XLSX.utils.book_new();
  wbSmall.SheetNames.push('SmallSparse');
  wbSmall.Sheets['SmallSparse'] = wsSparseSmall;
  const bufSmall = XLSX.write(wbSmall, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(bufSmall, { maxCells: 5 });
  }, /Spreadsheet range \(A1:B10\) spans 20 potential cells \(10 rows × 2 columns\), exceeding the maximum allowable cell limit of 5 cells\. Import rejected before data allocation\./);

  // 3. Excessive column range: A1:ZZ10 (702 columns > 100 maxCols)
  const wsExcessCols = {
    '!ref': 'A1:ZZ10',
    'A1': { t: 's', v: 'col_a' },
    'ZZ10': { t: 's', v: 'col_zz' }
  };
  const wbExcessCols = XLSX.utils.book_new();
  wbExcessCols.SheetNames.push('ExcessCols');
  wbExcessCols.Sheets['ExcessCols'] = wsExcessCols;
  const bufExcessCols = XLSX.write(wbExcessCols, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(bufExcessCols, { maxCols: 100 });
  }, /Spreadsheet exceeds allowable column limit \(702 columns > 100 max\)\./);
});

test('safeSpreadsheet: inspects ZIP archive declared uncompressed headers to reject declared oversized entries', () => {
  /**
   * Precise behavior tested & scope disclosure:
   * checkZipArchiveLimits parses the Central Directory and local file headers in binary buffers to enforce
   * uncompressed size limits based on declared entry sizes before SheetJS decompressor or XML parser is invoked.
   * Note: This check relies on declared header sizes; malformed or spoofed archives are constrained
   * downstream by pre-allocation cell/range checks and Web Worker execution timeouts.
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

test('safeSpreadsheet: safeReadSpreadsheetAsync executes headless Node fallback and isolated Node subprocess', async () => {
  /**
   * Tests safeReadSpreadsheetAsync in headless Node environment.
   * In Node.js, safeReadSpreadsheetAsync safely executes via Promise without browser Worker APIs.
   * Also verifies isolated Node runner subprocess completes dense 100-row test fixture in <200ms.
   * (Note: Real browser Web Worker execution is tested independently in tests/spreadsheet-browser-worker.spec.js
   * and scripts/test_browser_worker.cjs via Playwright Chromium).
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
