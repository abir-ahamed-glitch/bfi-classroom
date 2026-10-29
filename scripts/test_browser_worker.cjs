#!/usr/bin/env node
/**
 * scripts/test_browser_worker.cjs
 *
 * Real Browser Web Worker Regression Test Suite using Playwright Chromium.
 *
 * Tests the ACTUAL production safeReadSpreadsheetAsync export from dist/assets/,
 * exercising its real Vite-generated worker URL without duplicating application logic.
 *
 * Enforces:
 * 1. Real Web Worker execution in genuine browser context (Chromium) using production bundle.
 * 2. Successful parsing of tabular spreadsheet in browser worker thread with complete cleanup.
 * 3. Oversized sparse-sheet rejection before allocation with actionable message and cleanup.
 * 4. Timeout termination: worker.terminate() is called and promise rejects cleanly.
 * 5. Worker constructor failure: NEVER falls back to main-thread execution in browser.
 * 6. Missing Worker API: NEVER falls back to main-thread execution in browser.
 * 7. Worker parsing/runtime error: cleanly forwarded to main thread and worker terminated.
 * 8. Comprehensive worker cleanup: zero orphaned background workers across all execution paths.
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

// Locate freshly built production assets in dist/assets
function getProductionAssets() {
  const assetsDir = path.resolve(__dirname, '..', 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error('dist/assets not found. Run npm run build first.');
  }

  const workerFile = fs.readdirSync(assetsDir).find(f => f.startsWith('spreadsheet.worker-') && f.endsWith('.js'));
  if (!workerFile) {
    throw new Error('Bundled spreadsheet.worker-*.js not found in dist/assets. Run npm run build first.');
  }

  const safeSpreadsheetFile = fs.readdirSync(assetsDir).find(f => f.startsWith('safeSpreadsheet-') && f.endsWith('.js'));
  if (!safeSpreadsheetFile) {
    throw new Error('Bundled safeSpreadsheet-*.js entry not found in dist/assets. Run npm run build first.');
  }

  return {
    assetsDir,
    workerFile,
    workerCode: fs.readFileSync(path.join(assetsDir, workerFile), 'utf8'),
    safeSpreadsheetFile,
    safeSpreadsheetCode: fs.readFileSync(path.join(assetsDir, safeSpreadsheetFile), 'utf8')
  };
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
  console.log('Testing Actual Production safeReadSpreadsheetAsync Export');
  console.log('Browser Engine: Chromium (via Playwright)');
  console.log('================================================================\n');

  const { assetsDir, workerFile, workerCode, safeSpreadsheetFile, safeSpreadsheetCode } = getProductionAssets();
  const validBuffer = createValidWorkbookBuffer();
  const sparseOversizedBuffer = createSparseOversizedWorkbookBuffer();

  console.log(`Using built production worker: dist/assets/${workerFile}`);
  console.log(`Using built production export: dist/assets/${safeSpreadsheetFile}\n`);

  // Hanging worker code for timeout testing
  const hangWorkerCode = `
    self.onmessage = function() {
      while (true) {}
    };
  `;

  // HTTP server serving production assets and test harness
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    if (pathname === `/bfi-classroom/assets/${workerFile}`) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin'
      });
      res.end(workerCode);
      return;
    }

    if (pathname === `/bfi-classroom/assets/${safeSpreadsheetFile}`) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8'
      });
      res.end(safeSpreadsheetCode);
      return;
    }

    if (pathname === '/assets/hanging.worker.js' || pathname === '/bfi-classroom/assets/hanging.worker.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8'
      });
      res.end(hangWorkerCode);
      return;
    }

    // Serve any additional JS chunk from dist/assets if requested
    if (pathname.startsWith('/bfi-classroom/assets/')) {
      const chunkName = path.basename(pathname);
      const chunkPath = path.join(assetsDir, chunkName);
      if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).isFile()) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        fs.createReadStream(chunkPath).pipe(res);
        return;
      }
    }

    // Serve HTML harness that dynamically imports the REAL production safeReadSpreadsheetAsync export
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Real Browser Worker Test Harness</title>
      </head>
      <body>
        <h1>Browser Worker Production Harness</h1>
        <script>
          // Instrument window.Worker for lifecycle tracking WITHOUT replacing application control logic
          const OriginalWorker = window.Worker;
          window.__workerInstances = [];
          window.__workerConstructorFail = false;
          window.__useHangingWorker = false;

          window.Worker = function(url, options) {
            if (window.__workerConstructorFail) {
              throw new DOMException('The operation is insecure.', 'SecurityError');
            }
            const targetUrl = window.__useHangingWorker ? '/assets/hanging.worker.js' : url;
            const w = new OriginalWorker(targetUrl, options);
            w.__terminated = false;
            const origTerminate = w.terminate.bind(w);
            w.terminate = function() {
              w.__terminated = true;
              return origTerminate();
            };
            window.__workerInstances.push(w);
            window.__lastWorkerInstance = w;
            return w;
          };
          window.Worker.prototype = OriginalWorker.prototype;
          window.OriginalWorker = OriginalWorker;
        </script>
        <script type="module">
          try {
            const mod = await import('/bfi-classroom/assets/${safeSpreadsheetFile}');
            window.safeReadSpreadsheetAsync = mod.safeReadSpreadsheetAsync;
            window.__harnessReady = true;
          } catch (e) {
            console.error('Failed to import safeSpreadsheet module:', e.message);
          }
        </script>
      </body>
      </html>
    `);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/bfi-classroom/`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  await page.goto(testUrl);

  // Wait for the ES module to load the actual production export
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 10000 });

  try {
    // 1. Successful import in real browser worker
    await runTest('Real browser worker: parses valid tabular sheet and terminates worker', async () => {
      const dataArray = Array.from(validBuffer);
      const result = await page.evaluate(async (bytes) => {
        const u8 = new Uint8Array(bytes);
        const res = await window.safeReadSpreadsheetAsync(u8, { maxRows: 100 });
        return {
          rows: res,
          workerTerminated: window.__lastWorkerInstance ? window.__lastWorkerInstance.__terminated : false
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
    await runTest('Real browser worker: sparse oversized sheet rejected with actionable message and terminated', async () => {
      const dataArray = Array.from(sparseOversizedBuffer);
      const res = await page.evaluate(async (bytes) => {
        const u8 = new Uint8Array(bytes);
        try {
          await window.safeReadSpreadsheetAsync(u8, { maxCells: 50000, maxRows: 6000 });
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            workerTerminated: window.__lastWorkerInstance ? window.__lastWorkerInstance.__terminated : false
          };
        }
      }, dataArray);

      assert.strictEqual(res.threw, true, 'Worker should have rejected oversized sparse matrix');
      assert.match(res.message, /Spreadsheet range \(A1:CV5001\) spans 500,100 potential cells \(5,001 rows × 100 columns\), exceeding the maximum allowable cell limit of 50,000 cells/);
      assert.strictEqual(res.workerTerminated, true, 'Worker must be terminated on rejection');
    });

    // 3. Real browser worker: timeout termination
    await runTest('Real browser worker: execution timeout calls worker.terminate() and rejects', async () => {
      const res = await page.evaluate(async () => {
        window.__useHangingWorker = true;
        try {
          await window.safeReadSpreadsheetAsync(
            new Uint8Array([1, 2, 3]),
            { timeoutMs: 300 }
          );
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            workerTerminated: window.__lastWorkerInstance ? window.__lastWorkerInstance.__terminated : false
          };
        } finally {
          window.__useHangingWorker = false;
        }
      });

      assert.strictEqual(res.threw, true, 'Worker should have timed out');
      assert.match(res.message, /Spreadsheet processing timed out after 0 seconds/);
      assert.strictEqual(res.workerTerminated, true, 'worker.terminate() must be invoked on timeout');
    });

    // 4. Real browser worker: worker creation failure fails safely (ZERO main-thread fallback)
    await runTest('Real browser worker: constructor failure fails safely without main-thread execution', async () => {
      const res = await page.evaluate(async () => {
        window.__workerConstructorFail = true;

        try {
          await window.safeReadSpreadsheetAsync(new Uint8Array([1, 2, 3]), {});
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message
          };
        } finally {
          window.__workerConstructorFail = false;
        }
      });

      assert.strictEqual(res.threw, true, 'Should reject when Worker construction fails');
      assert.match(res.message, /Failed to initialize spreadsheet background worker: (The operation is insecure\.|.*SecurityError).*Processing halted to prevent main-thread execution/);
    });

    // 5. Real browser worker: missing Worker environment fails safely
    await runTest('Real browser worker: missing Worker API fails safely without main-thread fallback', async () => {
      const res = await page.evaluate(async () => {
        const savedWorker = window.Worker;
        delete window.Worker;

        try {
          await window.safeReadSpreadsheetAsync(new Uint8Array([1, 2, 3]), {});
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message
          };
        } finally {
          window.Worker = savedWorker;
        }
      });

      assert.strictEqual(res.threw, true, 'Should reject when Worker API is undefined');
      assert.match(res.message, /Browser environment does not support Web Workers\. Spreadsheet processing halted to prevent main-thread resource exhaustion\./);
    });

    // 6. Real browser worker: worker parsing/runtime error rejects cleanly and terminates worker
    await runTest('Real browser worker: worker parsing error rejects cleanly and terminates worker', async () => {
      // Pass corrupted binary payload to real worker
      const corruptBytes = Array.from(new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0xFF, 0xFF]));
      const res = await page.evaluate(async (bytes) => {
        const u8 = new Uint8Array(bytes);
        try {
          await window.safeReadSpreadsheetAsync(u8, {});
          return { threw: false };
        } catch (err) {
          return {
            threw: true,
            message: err.message,
            workerTerminated: window.__lastWorkerInstance ? window.__lastWorkerInstance.__terminated : false
          };
        }
      }, corruptBytes);

      assert.strictEqual(res.threw, true, 'Worker should reject invalid spreadsheet binary');
      assert.ok(res.message.length > 0, 'Error message should not be empty');
      assert.strictEqual(res.workerTerminated, true, 'Worker must be terminated after parsing failure');
    });

    // 7. Real browser worker: verified complete resource cleanup across all execution paths
    await runTest('Real browser worker: verified all worker instances terminated (no orphaned threads)', async () => {
      const cleanupStatus = await page.evaluate(() => {
        const instances = window.__workerInstances || [];
        return {
          totalCreated: instances.length,
          allTerminated: instances.length > 0 && instances.every(w => w.__terminated === true)
        };
      });

      assert.ok(cleanupStatus.totalCreated >= 4, `Expected at least 4 worker instances created, got ${cleanupStatus.totalCreated}`);
      assert.strictEqual(cleanupStatus.allTerminated, true, 'All created Worker instances must be terminated');
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
