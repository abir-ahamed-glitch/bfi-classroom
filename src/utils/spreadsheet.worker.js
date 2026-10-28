/**
 * Dedicated Web Worker for Isolated Client-Side Spreadsheet Parsing.
 * 
 * Runs XLSX parsing off the browser main UI thread.
 * If processing hangs, takes too long, or encounters an unbounded calculation,
 * the main thread can cleanly terminate this worker via worker.terminate()
 * without freezing the browser interface or leaking memory.
 */

import { safeReadSpreadsheet } from './safeSpreadsheet.js';

self.onmessage = function (event) {
  const { data, options } = event.data || {};
  try {
    const result = safeReadSpreadsheet(data, options);
    self.postMessage({ success: true, result });
  } catch (err) {
    self.postMessage({ success: false, error: err.message || String(err) });
  }
};
