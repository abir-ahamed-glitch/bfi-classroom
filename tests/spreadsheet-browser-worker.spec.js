import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getBundledWorkerCode() {
  const assetsDir = path.resolve(__dirname, '../dist/assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error('dist/assets not found. Run npm run build first.');
  }
  const workerFile = fs.readdirSync(assetsDir).find(f => f.startsWith('spreadsheet.worker-') && f.endsWith('.js'));
  if (!workerFile) {
    throw new Error('Bundled spreadsheet.worker-*.js not found in dist/assets.');
  }
  return fs.readFileSync(path.join(assetsDir, workerFile), 'utf8');
}

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

test.describe('Spreadsheet Browser Web Worker Isolation Suite', () => {
  let workerCode;
  let validBuffer;
  let sparseOversizedBuffer;

  test.beforeAll(() => {
    workerCode = getBundledWorkerCode();
    validBuffer = createValidWorkbookBuffer();
    sparseOversizedBuffer = createSparseOversizedWorkbookBuffer();
  });

  test.beforeEach(async ({ page }) => {
    // Intercept worker requests and serve the bundled worker
    await page.route('**/assets/spreadsheet.worker.js', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: workerCode
      });
    });

    // Intercept hanging worker for timeout testing
    await page.route('**/assets/hanging.worker.js', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: 'self.onmessage = function() { while(true){} };'
      });
    });

    await page.goto('/');

    // Load harness HTML
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Worker Harness</title></head>
      <body>
        <h1>Browser Worker Harness</h1>
        <script>
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

                window.__workerTerminated = false;
                const originalTerminate = worker.terminate.bind(worker);
                worker.terminate = function() {
                  window.__workerTerminated = true;
                  return originalTerminate();
                };

                timer = setTimeout(() => {
                  try { worker.terminate(); } catch (e) {}
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

  test('1. Successful tabular sheet import in real browser worker', async ({ page }) => {
    const dataArray = Array.from(validBuffer);
    const result = await page.evaluate(async (bytes) => {
      const u8 = new Uint8Array(bytes);
      const res = await window.safeReadSpreadsheetAsyncInBrowser(u8, { maxRows: 100 });
      return {
        rows: res,
        workerTerminated: window.__workerTerminated
      };
    }, dataArray);

    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0][0]).toBe('Student Name');
    expect(result.rows[1][0]).toBe('Abir Ahmad');
    expect(result.rows[2][0]).toBe('Sadia Islam');
    expect(result.workerTerminated).toBe(true);
  });

  test('2. Sparse oversized sheet rejected before allocation in browser worker', async ({ page }) => {
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

    expect(res.threw).toBe(true);
    expect(res.message).toContain('Spreadsheet range (A1:CV5001) spans 500,100 potential cells (5,001 rows × 100 columns), exceeding the maximum allowable cell limit of 50,000 cells');
    expect(res.workerTerminated).toBe(true);
  });

  test('3. Real browser worker timeout termination', async ({ page }) => {
    const res = await page.evaluate(async () => {
      try {
        await window.safeReadSpreadsheetAsyncInBrowser(
          new Uint8Array([1, 2, 3]),
          { timeoutMs: 300 },
          '/assets/hanging.worker.js'
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

    expect(res.threw).toBe(true);
    expect(res.message).toContain('Spreadsheet processing timed out after 0 seconds');
    expect(res.workerTerminated).toBe(true);
  });

  test('4. Browser worker constructor failure fails safely without main-thread parsing', async ({ page }) => {
    const res = await page.evaluate(async () => {
      window.__mainThreadParsingAttempted = false;
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

    expect(res.threw).toBe(true);
    expect(res.message).toMatch(/Failed to initialize spreadsheet background worker.*(The operation is insecure\.|SecurityError).*Processing halted to prevent main-thread execution/);
    expect(res.mainThreadParsingAttempted).toBe(false);
  });

  test('5. Missing Worker environment fails safely without main-thread fallback', async ({ page }) => {
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

    expect(res.threw).toBe(true);
    expect(res.message).toContain('Browser environment does not support Web Workers. Spreadsheet processing halted to prevent main-thread resource exhaustion.');
    expect(res.mainThreadParsingAttempted).toBe(false);
  });
});
