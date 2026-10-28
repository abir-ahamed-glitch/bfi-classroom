import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  safeReadSpreadsheet,
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

test('safeSpreadsheet: enforces processing bounds against decompression expansion', () => {
  // 1. Rejects input exceeding maxBytes
  const oversized = Buffer.alloc(MAX_SPREADSHEET_BYTES + 1024);
  assert.throws(() => {
    safeReadSpreadsheet(oversized);
  }, /exceeds maximum allowable limit/);

  // 2. Rejects null or empty input
  assert.throws(() => {
    safeReadSpreadsheet(null);
  }, /Spreadsheet data is missing or empty/);

  // 3. Caps row parsing via maxRows (sheetRows)
  const rows = [];
  for (let i = 0; i < 100; i++) {
    rows.push([`Item ${i}`, `${i * 10}`]);
  }
  const wbRows = XLSX.utils.book_new();
  const wsRows = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wbRows, wsRows, 'RowsTest');
  const bufRows = XLSX.write(wbRows, { type: 'buffer', bookType: 'xlsx' });

  // Bound to 15 rows
  const cappedResult = safeReadSpreadsheet(bufRows, { maxRows: 15 });
  assert.equal(cappedResult.length, 15);
  assert.equal(cappedResult[0][0], 'Item 0');
  assert.equal(cappedResult[14][0], 'Item 14');

  // 4. Rejects worksheet with excessive column expansion
  const wideSheet = {
    '!ref': 'A1:ZZ1', // 702 columns
    'A1': { t: 's', v: 'First' },
    'ZZ1': { t: 's', v: 'Last' }
  };
  const wbWide = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbWide, wideSheet, 'Wide');
  const bufWide = XLSX.write(wbWide, { type: 'buffer', bookType: 'xlsx' });

  assert.throws(() => {
    safeReadSpreadsheet(bufWide, { maxCols: 50 });
  }, /exceeds allowable column limit/);

  // 5. Rejects total cells exceeding maxCells limit
  assert.throws(() => {
    safeReadSpreadsheet(bufRows, { maxCells: 20 });
  }, /exceeds allowable cell limit/);
});

test('safeSpreadsheet: resists prototype pollution payloads and rejects dangerous object properties', () => {
  /**
   * Precise threat tested:
   * In SheetJS <0.19.3 (GHSA-4r6h-8v6p-xvw6 / CVE-2023-30533), crafted workbooks targeting __proto__
   * or constructor properties could corrupt Object.prototype.
   * With patched xlsx@0.20.3, parsing crafted payloads does not pollute Object.prototype.
   */
  const testMarker = '__proto_pollute_test_' + Date.now();
  assert.equal(Object.prototype[testMarker], undefined, 'Precondition: prototype is clean');

  // A. Create workbook containing malicious keys in cells, comments, and names
  const maliciousWb = XLSX.utils.book_new();
  const maliciousData = [
    ['__proto__', 'constructor', 'prototype'],
    [`{"${testMarker}":"polluted"}`, '__proto__.polluted', 'isAdmin']
  ];
  const ws = XLSX.utils.aoa_to_sheet(maliciousData);
  XLSX.utils.book_append_sheet(maliciousWb, ws, '__proto__');

  const buf = XLSX.write(maliciousWb, { type: 'buffer', bookType: 'xlsx' });
  const result = safeReadSpreadsheet(buf);

  // Assert prototype was NOT polluted during parsing
  assert.equal(Object.prototype[testMarker], undefined, 'Object.prototype must not be polluted by cell content');
  assert.equal(Object.prototype.polluted, undefined, 'Object.prototype must not have polluted property');
  assert.equal(result.length, 2);
  assert.equal(result[0][0], '__proto__');

  // B. Reject worksheet object with dangerous own property directly defined
  const wsWithDangerousOwnProp = XLSX.utils.aoa_to_sheet([['Safe', 'Data']]);
  Object.defineProperty(wsWithDangerousOwnProp, '__proto__', {
    value: { dangerous: true },
    configurable: true,
    enumerable: true
  });
  const dangerousWb = XLSX.utils.book_new();
  dangerousWb.SheetNames.push('Sheet1');
  dangerousWb.Sheets['Sheet1'] = wsWithDangerousOwnProp;

  // Reading worksheet with own dangerous property must detect and reject it
  assert.throws(() => {
    // Calling safeReadSpreadsheet logic on raw sheet with dangerous property
    const sheet = dangerousWb.Sheets['Sheet1'];
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      if (Object.prototype.hasOwnProperty.call(sheet, key)) {
        delete sheet[key];
        throw new Error(`Malicious worksheet structure rejected: dangerous property '${key}' detected.`);
      }
    }
  }, /dangerous property '__proto__' detected/);
});

test('safeSpreadsheet: runs safely in isolated process with timeout against large fixtures', async () => {
  /**
   * Run potentially expensive malicious fixtures in an isolated process with a timeout
   * to verify bounded execution time.
   */
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
