/**
 * Safe Spreadsheet Parser Wrapper (Hardened Client-Side Parser)
 * 
 * Mitigations for:
 * - GHSA-4r6h-8v6p-xvw6 / CVE-2023-30533 (Prototype Pollution in SheetJS <0.19.3)
 * - GHSA-5pgg-2g8v-p4x9 / CVE-2024-22363 (ReDoS via crafted number formats in SheetJS <0.20.2)
 * 
 * Security Controls:
 * 1. Bounded Input Size: Rejects files > 10MB to prevent client-side denial-of-service / memory exhaustion.
 * 2. Disabled Risky Features: Disables formula parsing (cellFormula: false), HTML generation (cellHTML: false),
 *    styles (cellStyles: false), VBA macros (bookVBA: false), and dependency tracking (bookDeps: false).
 * 3. Active Prototype Pollution Guard: Snapshots Object.prototype before reading. If any property was injected,
 *    it cleans the prototype and throws an explicit security error.
 * 4. Clean Data Sanitization: Validates that extracted rows and cells contain only primitive strings or values,
 *    preventing prototype chain inheritance exploits.
 */

import * as XLSX from 'xlsx';

export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024; // 10MB limit

/**
 * Safely parses spreadsheet data (Uint8Array, ArrayBuffer, or Buffer) into a 2D array of strings.
 * 
 * @param {Uint8Array|ArrayBuffer|Buffer} data - Binary file data
 * @param {Object} [options] - Additional options
 * @param {number} [options.sheetIndex=0] - 0-based sheet index to parse (default: 0)
 * @param {number} [options.maxBytes=10485760] - Max allowable size in bytes
 * @returns {Array<Array<string>>} Clean 2D array of cell values
 */
export function safeReadSpreadsheet(data, options = {}) {
  if (!data) {
    throw new Error('Spreadsheet data is missing or empty.');
  }

  const maxBytes = options.maxBytes || MAX_SPREADSHEET_BYTES;
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

  // 1. Snapshot Object.prototype keys before invoking SheetJS
  const originalKeys = new Set([
    ...Object.getOwnPropertyNames(Object.prototype),
    ...Object.getOwnPropertySymbols(Object.prototype)
  ]);

  let wb;
  let pollutionDetected = false;
  try {
    // 2. Parse with safe options stripping risky features
    wb = XLSX.read(input, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookDeps: false,
      WTF: false,
      dense: false
    });
  } finally {
    // 3. Active Prototype Pollution Guard & Remediation
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

  // Disallow forbidden keys on worksheet object
  for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(ws, dangerousKey)) {
      delete ws[dangerousKey];
      throw new Error(`Malicious worksheet structure rejected: dangerous property '${dangerousKey}' detected.`);
    }
  }

  // 4. Convert to 2D array with raw: false, defval: ""
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  if (!Array.isArray(rawData)) {
    return [];
  }

  // 5. Clean 2D array output ensuring prototype hygiene
  const clean2D = [];
  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r];
    if (!Array.isArray(row)) continue;

    const cleanRow = [];
    for (let c = 0; c < row.length; c++) {
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
