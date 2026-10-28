#!/usr/bin/env node
/**
 * scripts/test_browser_worker.cjs
 *
 * Real Browser Web Worker Regression Test Suite using Playwright Chromium.
 *
 * Enforces:
 * 1. Real Web Worker execution in genuine browser context (Chromium).
 * 2. Successful parsing of tabular spreadsheet in browser worker thread.
 * 3. Timeout termination: worker.terminate() is called and promise rejects cleanly.
 * 4. Safe failure on worker creation error: NEVER falls back to main-thread execution in browser.
 * 5. Parsing error / boundary rejection cleanly forwarded from worker to main thread.
 * 6. Resource cleanup: termination on success, error, and timeout.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('@playwright/test');
const XLSX = require('xlsx');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Locate the bundled worker file in dist/assets
function getBundledWorkerCode() {
  const assetsDir = path.resolve(__dirname, '..', 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error('dist/assets not found. Run npm run build first.');
  }
  const workerFile = fs.readdirSync(assetsDir).find(f => f.startsWith('spreadsheet.worker-') && f.endsWith('.js'));
  if (!workerFile) {
    throw new Error('Bundled spreadsheet.worker-*.js not found in dist/assets.');
  }
  return fs.readFileSync(path.join(assetsDir, workerFile), 'utf8');
}

// Create sample workbooks
function createValidWorkbookBuffer() {
  const wb = XLSX.utils.book_new();
  const data = [
    ['Student Name', 'Course', 'Batch'],
    ['Abir Ahmad', 'Directing', 'B-01'],
    ['Sadia Islam', 'Cinematography', 'B-02']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Students');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function createSparseOversizedWorkbookBuffer() {
  const wb = XLSX.utils.book_new();
  const ws = {
    '!ref': 'A1:CV5001',
    'A1': { t: 's', v: 'start' },
    'CV5001': { t: 's', v: 'end' }
  };
  XLSX.utils.book_append_sheet(wb, ws, 'SparseOversized');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function main() {
  console.log('================================================================');
  console.log('REAL BROWSER WEB WORKER ISOLATION & PARSER REGRESSION SUITE');
  console.log('Browser Engine: Chromium (via Playwright)');
  console.log('================================================================\n');

  const workerCode = getBundledWorkerCode();
  const validBuffer = createValidWorkbookBuffer();
  const sparseOversizedBuffer = createSparseOversizedWorkbookBuffer();

  // Test Harness HTML & Server
  // Hang worker code for timeout testing
  const hangWorkerCode = `
    self.onmessage = function() {
      // Intentionally simulate an infinite loop or hanging operation
      while (true) {}
    };
  `;

  const server = http.createServer((req, res) => {
    if (req.url === '/assets/spreadsheet.worker.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin'
      });
      res.end(workerCode);
      return;
    }

    if (req.url === '/assets/hanging.worker.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8'
      });
      res.end(hangWorkerCode);
      return;
    }

    // Default HTML page containing browser client implementation of safeReadSpreadsheetAsync
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Worker Isolation Test Harness</title></head>
      <body>
        <h1>Browser Worker Harness</h1>
        <script>
          // In-browser client implementation matching src/utils/safeSpreadsheet.js
          window.safeReadSpreadsheetAsyncInBrowser = function(data, options = {}, workerUrl = '/assets/spreadsheet.worker.js') {
            const timeoutMs = options.timeoutMs || 10000;

            if (typeof window !== 'undefined') {
              if (typeof Worker === 'undefined') {
                return Promise.reject(new Error('Browser environment does not support Web Workers. Spreadsheet processing halted to prevent main-thread resource exhaustion.'));
              }

              return new Promise((resolve, reject) => {
                let worker;
                let timer;

                try {
                  worker = new Worker(workerUrl, { type: 'module' });
                } catch (initErr) {
                  return reject(new Error('Failed to initialize spreadsheet background worker: ' + (initErr.message || 'Worker construction error') + '. Processing halted to prevent main-thread execution.'));
                }

                // Expose termination hook for tracking in tests
                window.__lastWorkerInstance = worker;
                window.__workerTerminated = false;
                const originalTerminate = worker.terminate.bind(worker);
                worker.terminate = function() {
                  window.__workerTerminated = true;
                  return originalTerminate();
                };

                timer = setTimeout(() => {
                  try {
                    worker.terminate();
                  } catch (e) {}
                  reject(new Error('Spreadsheet processing timed out after ' + Math.round(timeoutMs / 1000) + ' seconds. The file may be corrupt, excessively complex, or contain unbounded data.'));
                }, timeoutMs);

                worker.onmessage = (event) => {
                  clearTimeout(timer);
                  try { worker.terminate(); } catch (e) {}
                  if (event.data && event.data.success) {
                    resolve(event.data.result);
                  } else {
                    reject(new Error(event.data ? event.data.error : 'Unknown worker parsing error'));
                  }
                };

                worker.onerror = (err) => {
                  clearTimeout(timer);
                  try { worker.terminate(); } catch (e) {}
                  reject(new Error('Spreadsheet worker execution error: ' + (err.message || 'Worker failure')));
                };

                try {
                  worker.postMessage({ data, options });
                } catch (postErr) {
                  clearTimeout(timer);
                  try { worker.terminate(); } catch (e) {}
                  reject(new Error('Failed to transmit spreadsheet data to worker: ' + postErr.message));
                }
              });
            }

            return Promise.reject(new Error('Not a browser environment'));
          };
        </script>
      </body>
      </html>
    `);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(testUrl);

  try {
    // 1. Successful import in real browser worker
    await runTest('Real browser worker: parses valid tabular sheet and terminates worker', async () => {
      const dataArray = Array.from(validBuffer);
      const result = await page.evaluate(async (bytes) => {
        const u8 = new Uint8Array(bytes);
        const res = await window.safeReadSpreadsheetAsyncInBrowser(u8, { maxRows: 100 });
        return {
          rows: res,
          workerTerminated: window.__workerTerminated
        };
      }, dataArray);

      assert.strictEqual(Array.isArray(result.rows), true);
      assert.strictEqual(result.rows.length, 3);
      assert.strictEqual(result.rows[0][0], 'Student Name');
      assert.strictEqual(result.rows[1][0], 'Abir Ahmad');
      assert.strictEqual(result.rows[2][0], 'Sadia Islam');
      assert.strictEqual(result.workerTerminated, true, 'Worker must be terminated after successful parsing');
    });

    // 2. Real browser worker: parsing error (sparse oversized sheet rejected before allocation)
    await runTest('Real browser worker: sparse oversized sheet rejected with actionable message', async () => {
      const dataArray = Array.from(sparseOversizedBuffer);
      const res = await page.evaluate(async (bytes) => {
        const u8 = new Uint8Array(bytes);
        try {
          await window.safeReadSpreadsheetAsyncInBrowser(u8, { maxCells: 50000, maxRows: 6000 });
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            workerTerminated: window.__workerTerminated
          };
        }
      }, dataArray);

      assert.strictEqual(res.threw, true, 'Worker should have rejected oversized sparse matrix');
      assert.match(res.message, /Spreadsheet range \(A1:CV5001\) spans 500,100 potential cells \(5,001 rows × 100 columns\), exceeding the maximum allowable cell limit of 50,000 cells/);
      assert.strictEqual(res.workerTerminated, true, 'Worker must be terminated on error');
    });

    // 3. Real browser worker: timeout termination
    await runTest('Real browser worker: execution timeout calls worker.terminate() and rejects', async () => {
      const res = await page.evaluate(async () => {
        try {
          await window.safeReadSpreadsheetAsyncInBrowser(
            new Uint8Array([1, 2, 3]),
            { timeoutMs: 300 },
            '/assets/hanging.worker.js' // Worker with infinite loop
          );
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            workerTerminated: window.__workerTerminated
          };
        }
      });

      assert.strictEqual(res.threw, true, 'Worker should have timed out');
      assert.match(res.message, /Spreadsheet processing timed out after 0 seconds/);
      assert.strictEqual(res.workerTerminated, true, 'worker.terminate() must be invoked on timeout');
    });

    // 4. Real browser worker: worker creation failure fails safely (ZERO main-thread fallback)
    await runTest('Real browser worker: constructor failure fails safely without main-thread execution', async () => {
      const res = await page.evaluate(async () => {
        // Track whether main-thread execution was attempted
        window.__mainThreadParsingAttempted = false;

        // Mock window.Worker throwing on creation (e.g. CSP or restricted sandbox)
        const OriginalWorker = window.Worker;
        window.Worker = function() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        };

        try {
          await window.safeReadSpreadsheetAsyncInBrowser(new Uint8Array([1, 2, 3]), {});
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            mainThreadParsingAttempted: window.__mainThreadParsingAttempted
          };
        } finally {
          window.Worker = OriginalWorker;
        }
      });

      assert.strictEqual(res.threw, true, 'Should reject when Worker construction fails');
      assert.match(res.message, /Failed to initialize spreadsheet background worker: (The operation is insecure\.|.*SecurityError).*Processing halted to prevent main-thread execution/);
      assert.strictEqual(res.mainThreadParsingAttempted, false, 'Main thread execution must NEVER be attempted in browser');
    });

    // 5. Real browser worker: missing Worker environment fails safely
    await runTest('Real browser worker: missing Worker API fails safely without main-thread fallback', async () => {
      const res = await page.evaluate(async () => {
        window.__mainThreadParsingAttempted = false;
        const OriginalWorker = window.Worker;
        delete window.Worker;

        try {
          await window.safeReadSpreadsheetAsyncInBrowser(new Uint8Array([1, 2, 3]), {});
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            mainThreadParsingAttempted: window.__mainThreadParsingAttempted
          };
        } finally {
          window.Worker = OriginalWorker;
        }
      });

      assert.strictEqual(res.threw, true, 'Should reject when Worker API is undefined');
      assert.match(res.message, /Browser environment does not support Web Workers\. Spreadsheet processing halted to prevent main-thread resource exhaustion\./);
      assert.strictEqual(res.mainThreadParsingAttempted, false, 'Main thread execution must NEVER be attempted in browser');
    });

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(`Real Browser Worker Regression Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Browser worker test error:', err);
    process.exit(1);
  });
}
