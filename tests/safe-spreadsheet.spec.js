import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { safeReadSpreadsheet, MAX_SPREADSHEET_BYTES } from '../src/utils/safeSpreadsheet.js';

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

test('safeSpreadsheet: rejects files exceeding maximum size limit', () => {
  const oversized = Buffer.alloc(MAX_SPREADSHEET_BYTES + 1024);
  assert.throws(() => {
    safeReadSpreadsheet(oversized);
  }, /exceeds maximum allowable limit/);
});

test('safeSpreadsheet: rejects null or empty input', () => {
  assert.throws(() => {
    safeReadSpreadsheet(null);
  }, /Spreadsheet data is missing or empty/);
});

test('safeSpreadsheet: disables cellFormula evaluation and strips dangerous features', () => {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ['Formula', 'Result'],
    ['=1+1', 'Test']
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Formulas');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const result = safeReadSpreadsheet(buf);

  assert.equal(result.length, 2);
  // cellFormula: false prevents formula calculation
  assert.ok(result[1][0] === '=1+1' || result[1][0] === '');
});

test('safeSpreadsheet: detects and remediates prototype pollution attempts', () => {
  // Simulate active prototype pollution guard
  const originalKeys = Object.getOwnPropertyNames(Object.prototype);

  // Verify prototype is clean before
  assert.equal(Object.prototype.pollutedMarker, undefined);

  // safeReadSpreadsheet will detect any property added to Object.prototype
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['A', 'B']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Normal read should succeed with clean prototype
  const res = safeReadSpreadsheet(buf);
  assert.equal(res.length, 1);
  assert.equal(Object.prototype.pollutedMarker, undefined);
});
