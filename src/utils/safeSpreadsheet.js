/**
 * Safe Spreadsheet Parser Wrapper (Hardened Client-Side Parser)
 * 
 * Primary Mitigation:
 * - Upstream patched SheetJS release (>=0.19.3, currently 0.20.3 from https://cdn.sheetjs.com/)
 *   structurally fixes GHSA-4r6h-8v6p-xvw6 (CVE-2023-30533 prototype pollution) and
 *   GHSA-5pgg-2g8v-p4x9 (CVE-2024-22363 ReDoS).
 * 
 * Defense-in-Depth & Resource Protection:
 * 1. Compressed Input Size Bound: Rejects files > 10MB to prevent memory exhaustion from oversized payloads.
 * 2. Pre-Parse Archive Expansion Check: Scans ZIP central directory / local headers in binary buffer to calculate
 *    total uncompressed size and entry sizes BEFORE SheetJS decompressor or XML parser is invoked.
 * 3. Truncation Prevention: Configures sheetRows parser limit to (maxRows + 1) and validates both worksheet range
 *    (!ref, !fullref) and converted row counts to guarantee no records are ever silently omitted.
 * 4. Pre-Allocation Cell Limit: Scans worksheet cell keys BEFORE calling sheet_to_json to reject dense or
 *    oversized sheets before memory allocation.
 * 5. Feature Minimization: Sets `cellFormula: false`, `cellHTML: false`, `cellStyles: false`,
 *    `bookVBA: false`, and `bookDeps: false`. SheetJS does not evaluate formulas during read; setting
 *    `cellFormula: false` ensures formula AST expressions (`cell.f`) are neither parsed nor retained.
 * 6. Secondary Prototype Anomaly Guard: Compares Object.prototype property keys before and after parse.
 * 7. Off-Thread Parsing with Terminable Timeout: safeReadSpreadsheetAsync moves browser parsing to a dedicated
 *    Web Worker with a strict timeout; if parsing hangs, worker.terminate() aborts execution immediately.
 */

import * as XLSX from 'xlsx';

export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024; // 10MB compressed input limit
export const MAX_SPREADSHEET_ROWS = 5001;               // 1 header row + up to 5,000 data rows
export const MAX_SPREADSHEET_COLS = 100;                // Max columns parsed
export const MAX_SPREADSHEET_CELLS = 50000;             // Max total allowable extracted cells
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB uncompressed archive expansion limit
export const DEFAULT_TIMEOUT_MS = 10000;                // 10s parsing timeout

/**
 * Scans ZIP archive headers (for .xlsx files) to inspect declared uncompressed entry
 * and total sizes BEFORE invoking the full parser or decompressing XML.
 * 
 * Technical Scope & Accuracy Disclosure:
 * - This function inspects the *declared* uncompressed size fields recorded in the ZIP
 *   Central Directory and local file headers by the archive creator.
 * - This provides an efficient pre-check against standard archive inflation bombs whose headers
 *   declare excessive uncompressed sizes.
 * - However, header checks alone DO NOT establish absolute decompression bounds if an attacker
 *   crafts a malformed ZIP with spoofed or mismatched header records.
 * - Absolute runtime memory and execution protection is therefore enforced downstream via
 *   pre-allocation range and cell limits (maxCells, maxRows, maxCols) and Web Worker thread termination.
 * 
 * @param {Uint8Array} data - Binary file buffer
 * @param {Object} [options] - Options
 */
export function checkZipArchiveLimits(data, options = {}) {
  const maxUncompressed = options.maxUncompressedBytes || MAX_UNCOMPRESSED_BYTES;
  const maxEntryBytes = options.maxEntryBytes || (25 * 1024 * 1024); // 25MB per XML entry limit

  if (!data || data.length < 4) return;
  // ZIP signature check: 0x50, 0x4B (PK\x03\x04 or PK\x01\x02 or PK\x05\x06)
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    return; // Non-ZIP format (e.g. CSV or legacy XLS)
  }

  let totalUncompressed = 0;
  let ptr = 0;
  const len = data.length;

  // Scan Central Directory entries (Signature: 0x02014b50 -> 0x50, 0x4b, 0x01, 0x02)
  let foundCentralDir = false;
  while (ptr + 46 <= len) {
    if (data[ptr] === 0x50 && data[ptr + 1] === 0x4b && data[ptr + 2] === 0x01 && data[ptr + 3] === 0x02) {
      foundCentralDir = true;
      const uncompSize = (data[ptr + 24] | (data[ptr + 25] << 8) | (data[ptr + 26] << 16) | (data[ptr + 27] << 24)) >>> 0;
      const nameLen = data[ptr + 28] | (data[ptr + 29] << 8);
      const extraLen = data[ptr + 30] | (data[ptr + 31] << 8);
      const commentLen = data[ptr + 32] | (data[ptr + 33] << 8);

      if (uncompSize > maxEntryBytes) {
        throw new Error(`Archive entry exceeds maximum allowable uncompressed size (${(uncompSize / 1024 / 1024).toFixed(1)}MB > ${maxEntryBytes / 1024 / 1024}MB). Import rejected as potential decompression bomb.`);
      }

      totalUncompressed += uncompSize;
      if (totalUncompressed > maxUncompressed) {
        throw new Error(`Total uncompressed archive size (${(totalUncompressed / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowable limit (${maxUncompressed / 1024 / 1024}MB). Import rejected to prevent memory exhaustion.`);
      }

      ptr += 46 + nameLen + extraLen + commentLen;
    } else {
      ptr++;
    }
  }

  // Fallback: If Central Directory was not parsed (e.g. truncated or streaming), scan local file headers
  if (!foundCentralDir) {
    ptr = 0;
    while (ptr + 30 <= len) {
      if (data[ptr] === 0x50 && data[ptr + 1] === 0x4b && data[ptr + 2] === 0x03 && data[ptr + 3] === 0x04) {
        const compSize = (data[ptr + 18] | (data[ptr + 19] << 8) | (data[ptr + 20] << 16) | (data[ptr + 21] << 24)) >>> 0;
        const uncompSize = (data[ptr + 22] | (data[ptr + 23] << 8) | (data[ptr + 24] << 16) | (data[ptr + 25] << 24)) >>> 0;
        const nameLen = data[ptr + 26] | (data[ptr + 27] << 8);
        const extraLen = data[ptr + 28] | (data[ptr + 29] << 8);

        if (uncompSize > maxEntryBytes) {
          throw new Error(`Archive entry exceeds maximum allowable uncompressed size (${(uncompSize / 1024 / 1024).toFixed(1)}MB > ${maxEntryBytes / 1024 / 1024}MB). Import rejected as potential decompression bomb.`);
        }

        totalUncompressed += uncompSize;
        if (totalUncompressed > maxUncompressed) {
          throw new Error(`Total uncompressed archive size (${(totalUncompressed / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowable limit (${maxUncompressed / 1024 / 1024}MB). Import rejected to prevent memory exhaustion.`);
        }

        const skip = compSize > 0 ? (30 + nameLen + extraLen + compSize) : (30 + nameLen + extraLen);
        ptr += skip;
      } else {
        ptr++;
      }
    }
  }
}

/**
 * Validates worksheet object structure to ensure prototype integrity.
 * 
 * @param {Object} ws - Worksheet object from SheetJS
 */
export function validateWorksheetStructure(ws) {
  if (!ws || typeof ws !== 'object') {
    throw new Error('Worksheet structure is missing or invalid.');
  }

  for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(ws, dangerousKey)) {
      delete ws[dangerousKey];
      throw new Error(`Malicious worksheet structure rejected: dangerous property '${dangerousKey}' detected on worksheet object.`);
    }
  }
}

/**
 * Safely parses spreadsheet data (Uint8Array, ArrayBuffer, or Buffer) into a 2D array of strings.
 * Enforces strict row bounds without silent truncation, pre-allocation cell limits, and archive expansion caps.
 * 
 * @param {Uint8Array|ArrayBuffer|Buffer} data - Binary file data
 * @param {Object} [options] - Parsing and bounding options
 * @param {number} [options.sheetIndex=0] - 0-based sheet index to parse (default: 0)
 * @param {number} [options.maxBytes=10485760] - Max allowable input size in bytes
 * @param {number} [options.maxRows=5001] - Max allowable rows (bounds parser and prevents truncation)
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

  // 1. Pre-parse archive expansion inspection for ZIP / XLSX containers
  checkZipArchiveLimits(input, options);

  // 2. Snapshot Object.prototype keys before invoking SheetJS (secondary anomaly guard)
  const originalKeys = new Set([
    ...Object.getOwnPropertyNames(Object.prototype),
    ...Object.getOwnPropertySymbols(Object.prototype)
  ]);

  let wb;
  let pollutionDetected = false;
  try {
    // 3. Parse with safe options stripping risky features.
    // Set sheetRows to (maxRows + 1) so that we cap parser memory while detecting if the file exceeds maxRows!
    wb = XLSX.read(input, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookDeps: false,
      WTF: false,
      dense: false,
      sheetRows: maxRows + 1
    });
  } finally {
    // 4. Secondary Prototype Anomaly Guard
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

  // 5. Validate worksheet structure and remove forbidden properties
  validateWorksheetStructure(ws);

  // 6. Check declared worksheet dimensions before conversion (inspect both !fullref and !ref)
  const refsToCheck = [ws['!fullref'], ws['!ref']].filter(Boolean);
  if (refsToCheck.length === 0) {
    let maxR = -1;
    let maxC = -1;
    let cellKeyCount = 0;
    for (const key of Object.keys(ws)) {
      if (key.charCodeAt(0) !== 33) {
        cellKeyCount++;
        try {
          const cell = XLSX.utils.decode_cell(key);
          if (cell.r > maxR) maxR = cell.r;
          if (cell.c > maxC) maxC = cell.c;
        } catch {
          /* ignore non-cell keys */
        }
      }
    }
    if (cellKeyCount > 0 && maxR >= 0 && maxC >= 0) {
      refsToCheck.push(XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } }));
    }
  }

  for (const ref of refsToCheck) {
    try {
      const range = XLSX.utils.decode_range(ref);
      const totalRows = (range.e.r - range.s.r) + 1;
      const maxEndRow = range.e.r + 1;
      const totalCols = (range.e.c - range.s.c) + 1;
      const maxEndCol = range.e.c + 1;

      if (totalRows > maxRows || maxEndRow > maxRows) {
        const offendingRows = Math.max(totalRows, maxEndRow);
        throw new Error(`Spreadsheet exceeds maximum supported limit of ${maxRows.toLocaleString()} rows (contains ${offendingRows.toLocaleString()} rows). Import rejected to prevent partial or incomplete data import.`);
      }

      if (totalCols > maxCols || maxEndCol > maxCols) {
        const offendingCols = Math.max(totalCols, maxEndCol);
        throw new Error(`Spreadsheet exceeds allowable column limit (${offendingCols} columns > ${maxCols} max).`);
      }

      const potentialCells = totalRows * totalCols;
      if (potentialCells > maxCells) {
        throw new Error(`Spreadsheet range (${ref}) spans ${potentialCells.toLocaleString()} potential cells (${totalRows.toLocaleString()} rows × ${totalCols.toLocaleString()} columns), exceeding the maximum allowable cell limit of ${maxCells.toLocaleString()} cells. Import rejected before data allocation.`);
      }
    } catch (err) {
      if (err.message && (err.message.includes('supported limit') || err.message.includes('column limit') || err.message.includes('allowable cell limit'))) {
        throw err;
      }
    }
  }

  // 7. PRE-ALLOCATION POPULATED CELL CHECK:
  // Count cell properties on ws BEFORE calling sheet_to_json to prevent memory exhaustion from dense matrices
  let populatedCells = 0;
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) !== 33) { // 33 is '!'
      populatedCells++;
      if (populatedCells > maxCells) {
        throw new Error(`Spreadsheet exceeds maximum allowable cell limit (${populatedCells} populated cells > ${maxCells.toLocaleString()} max). Import rejected before data allocation.`);
      }
    }
  }

  // 8. Convert to 2D array with raw: false, defval: ""
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  if (!Array.isArray(rawData)) {
    return [];
  }

  // 9. Strict truncation guard: If rawData exceeds maxRows, reject rather than silently dropping rows!
  if (rawData.length > maxRows) {
    throw new Error(`Spreadsheet exceeds maximum supported limit of ${maxRows.toLocaleString()} rows (contains at least ${rawData.length.toLocaleString()} rows). Import rejected to prevent silent truncation.`);
  }

  // 10. Clean 2D array output ensuring prototype hygiene
  const clean2D = [];
  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r];
    if (!Array.isArray(row)) continue;

    const colLimit = Math.min(row.length, maxCols);
    const cleanRow = [];

    for (let c = 0; c < colLimit; c++) {
      const cell = row[c];
      if (cell === null || cell === undefined) {
        cleanRow.push('');
      } else if (typeof cell === 'string') {
        cleanRow.push(cell.trim());
      } else if (typeof cell === 'number' || typeof cell === 'boolean') {
        cleanRow.push(String(cell));
      } else {
        cleanRow.push(String(cell || '').trim());
      }
    }
    clean2D.push(cleanRow);
  }

  return clean2D;
}

/**
 * Asynchronously parses spreadsheet data using an isolated terminable Web Worker in browser environments,
 * enforcing a strict execution timeout.
 * 
 * Security Guard: In browser environments, this function NEVER falls back to synchronous main-thread parsing.
 * If Web Workers are unavailable or initialization fails, the operation fails safely with an explicit error.
 * 
 * @param {Uint8Array|ArrayBuffer|Buffer} data - Binary file data
 * @param {Object} [options] - Parsing options
 * @param {number} [options.timeoutMs=10000] - Hard execution timeout in milliseconds
 * @returns {Promise<Array<Array<string>>>} Clean 2D array of cell values
 */
export function safeReadSpreadsheetAsync(data, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  // Browser Execution: Strictly enforce Web Worker isolation; NEVER execute untrusted parsing on the main UI thread!
  if (typeof window !== 'undefined') {
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('Browser environment does not support Web Workers. Spreadsheet processing halted to prevent main-thread resource exhaustion.'));
    }

    return new Promise((resolve, reject) => {
      let worker;
      let timer;

      try {
        worker = new Worker(new URL('./spreadsheet.worker.js', import.meta.url), { type: 'module' });
      } catch (initErr) {
        return reject(new Error(`Failed to initialize spreadsheet background worker: ${initErr.message || 'Worker construction error'}. Processing halted to prevent main-thread execution.`));
      }

      timer = setTimeout(() => {
        try {
          worker.terminate();
        } catch {
          /* ignore termination error */
        }
        reject(new Error(`Spreadsheet processing timed out after ${Math.round(timeoutMs / 1000)} seconds. The file may be corrupt, excessively complex, or contain unbounded data.`));
      }, timeoutMs);

      worker.onmessage = (event) => {
        clearTimeout(timer);
        try {
          worker.terminate();
        } catch {
          /* ignore termination error */
        }
        if (event.data && event.data.success) {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data ? event.data.error : 'Unknown worker parsing error'));
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timer);
        try {
          worker.terminate();
        } catch {
          /* ignore termination error */
        }
        reject(new Error(`Spreadsheet worker execution error: ${err.message || 'Worker failure'}`));
      };

      try {
        worker.postMessage({ data, options });
      } catch (postErr) {
        clearTimeout(timer);
        try {
          worker.terminate();
        } catch {
          /* ignore termination error */
        }
        reject(new Error(`Failed to transmit spreadsheet data to worker: ${postErr.message}`));
      }
    });
  }

  // Node.js Execution Path: Strictly separate headless fallback for CLI/Node test runners
  return Promise.resolve().then(() => safeReadSpreadsheet(data, options));
}
