/**
 * Safe Spreadsheet Parser Wrapper (Hardened Client-Side Parser)
 * 
 * Primary Mitigation:
 * - Upstream patched SheetJS release (>=0.19.3, currently 0.20.3 from https://cdn.sheetjs.com/)
 *   structurally fixes GHSA-4r6h-8v6p-xvw6 (CVE-2023-30533 prototype pollution) and
 *   GHSA-5pgg-2g8v-p4x9 (CVE-2024-22363 ReDoS).
 * 
 * Defense-in-Depth & Processing Bounds:
 * 1. Compressed Input Size Bound: Rejects files > 10MB to prevent memory exhaustion from oversized payloads.
 * 2. Expansion & Processing Bounds: Caps parsed rows via `sheetRows: 5000`, columns via range decode (max 100),
 *    and total extracted cells (max 50,000) to neutralize decompression/XML bomb amplification where a small
 *    compressed file expands into millions of virtual cells.
 * 3. Feature Minimization: Sets `cellFormula: false`, `cellHTML: false`, `cellStyles: false`,
 *    `bookVBA: false`, and `bookDeps: false`. Note: SheetJS does not evaluate formulas during read; setting
 *    `cellFormula: false` ensures formula AST expressions (`cell.f`) are neither parsed nor retained.
 * 4. Secondary Prototype Anomaly Guard: Compares Object.prototype property keys before and after parse.
 *    Note: Post-parse cleanup is an anomaly detection and defense-in-depth safety rail, NOT a substitute
 *    for the patched upstream library.
 * 5. Clean Tabular Output: Validates worksheet properties and transforms cell outputs into primitive strings,
 *    ensuring clean arrays without object-prototype inheritance hazards.
 */

import * as XLSX from 'xlsx';

export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024; // 10MB compressed limit
export const MAX_SPREADSHEET_ROWS = 5000;               // Max rows parsed
export const MAX_SPREADSHEET_COLS = 100;                // Max columns parsed
export const MAX_SPREADSHEET_CELLS = 50000;             // Max total extracted cells

/**
 * Safely parses spreadsheet data (Uint8Array, ArrayBuffer, or Buffer) into a 2D array of strings.
 * 
 * @param {Uint8Array|ArrayBuffer|Buffer} data - Binary file data
 * @param {Object} [options] - Parsing and bounding options
 * @param {number} [options.sheetIndex=0] - 0-based sheet index to parse (default: 0)
 * @param {number} [options.maxBytes=10485760] - Max allowable input size in bytes
 * @param {number} [options.maxRows=5000] - Max rows parsed (bounds parser expansion)
 * @param {number} [options.maxCols=100] - Max allowable columns
 * @param {number} [options.maxCells=50000] - Max total allowable extracted cells
 * @returns {Array<Array<string>>} Clean 2D array of cell values
 */
export function safeReadSpreadsheet(data, options = {}) {
  if (!data) {
    throw new Error('Spreadsheet data is missing or empty.');
  }

  const maxBytes = options.maxBytes || MAX_SPREADSHEET_BYTES;
  const maxRows = options.maxRows || MAX_SPREADSHEET_ROWS;
  const maxCols = options.maxCols || MAX_SPREADSHEET_COLS;
  const maxCells = options.maxCells || MAX_SPREADSHEET_CELLS;

  const byteLength = data.byteLength !== undefined ? data.byteLength : (data.length || 0);

  if (byteLength > maxBytes) {
    throw new Error(`Spreadsheet size (${(byteLength / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowable limit (${maxBytes / 1024 / 1024}MB).`);
  }

  // Convert ArrayBuffer or Buffer to Uint8Array if needed
  let input = data;
  if (data instanceof ArrayBuffer) {
    input = new Uint8Array(data);
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    input = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  // 1. Snapshot Object.prototype keys before invoking SheetJS (secondary anomaly guard)
  const originalKeys = new Set([
    ...Object.getOwnPropertyNames(Object.prototype),
    ...Object.getOwnPropertySymbols(Object.prototype)
  ]);

  let wb;
  let pollutionDetected = false;
  try {
    // 2. Parse with safe options stripping risky features and bounding row parsing
    wb = XLSX.read(input, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookDeps: false,
      WTF: false,
      dense: false,
      sheetRows: maxRows
    });
  } finally {
    // 3. Secondary Prototype Anomaly Guard
    const currentKeys = [
      ...Object.getOwnPropertyNames(Object.prototype),
      ...Object.getOwnPropertySymbols(Object.prototype)
    ];

    for (const key of currentKeys) {
      if (!originalKeys.has(key)) {
        pollutionDetected = true;
        try {
          delete Object.prototype[key];
        } catch {
          // Best effort delete
        }
      }
    }
  }

  if (pollutionDetected) {
    throw new Error('Malicious spreadsheet rejected: prototype pollution detected (CVE-2023-30533 / GHSA-4r6h-8v6p-xvw6).');
  }

  if (!wb || !Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    throw new Error('Spreadsheet contains no readable sheets.');
  }

  const sheetIndex = options.sheetIndex || 0;
  const sheetName = wb.SheetNames[sheetIndex];
  if (!sheetName || !wb.Sheets[sheetName]) {
    throw new Error(`Sheet at index ${sheetIndex} could not be found.`);
  }

  const ws = wb.Sheets[sheetName];

  // Disallow forbidden prototype keys directly on worksheet object
  for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(ws, dangerousKey)) {
      delete ws[dangerousKey];
      throw new Error(`Malicious worksheet structure rejected: dangerous property '${dangerousKey}' detected.`);
    }
  }

  // Validate column expansion bounds from sheet range if available
  if (ws['!ref']) {
    try {
      const range = XLSX.utils.decode_range(ws['!ref']);
      const colCount = (range.e.c - range.s.c) + 1;
      if (colCount > maxCols) {
        throw new Error(`Spreadsheet exceeds allowable column limit (${colCount} columns > ${maxCols} max).`);
      }
    } catch (err) {
      if (err.message && err.message.includes('column limit')) {
        throw err;
      }
      // If range decode fails, proceed to row-by-row validation
    }
  }

  // 4. Convert to 2D array with raw: false, defval: ""
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  if (!Array.isArray(rawData)) {
    return [];
  }

  // 5. Clean 2D array output ensuring prototype hygiene and total cell bounds
  const clean2D = [];
  let totalCellCount = 0;
  const rowLimit = Math.min(rawData.length, maxRows);

  for (let r = 0; r < rowLimit; r++) {
    const row = rawData[r];
    if (!Array.isArray(row)) continue;

    const colLimit = Math.min(row.length, maxCols);
    const cleanRow = [];

    for (let c = 0; c < colLimit; c++) {
      totalCellCount++;
      if (totalCellCount > maxCells) {
        throw new Error(`Spreadsheet exceeds allowable cell limit (${totalCellCount} cells > ${maxCells} max).`);
      }

      const cell = row[c];
      if (cell === null || cell === undefined) {
        cleanRow.push('');
      } else if (typeof cell === 'string') {
        cleanRow.push(cell.trim());
      } else if (typeof cell === 'number' || typeof cell === 'boolean') {
        cleanRow.push(String(cell));
      } else {
        // Any complex object is coerced to string safely
        cleanRow.push(String(cell || '').trim());
      }
    }
    clean2D.push(cleanRow);
  }

  return clean2D;
}
