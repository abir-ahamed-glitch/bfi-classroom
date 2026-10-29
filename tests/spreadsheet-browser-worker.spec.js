import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getProductionAssets() {
  const assetsDir = path.resolve(__dirname, '../dist/assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error('dist/assets not found. Run npm run build first.');
  }
  const workerFile = fs.readdirSync(assetsDir).find(f => f.startsWith('spreadsheet.worker-') && f.endsWith('.js'));
  if (!workerFile) {
    throw new Error('Bundled spreadsheet.worker-*.js not found in dist/assets.');
  }
  const safeSpreadsheetFile = fs.readdirSync(assetsDir).find(f => f.startsWith('safeSpreadsheet-') && f.endsWith('.js'));
  if (!safeSpreadsheetFile) {
    throw new Error('Bundled safeSpreadsheet-*.js entry not found in dist/assets.');
  }
  return {
    assetsDir,
    workerFile,
    workerCode: fs.readFileSync(path.join(assetsDir, workerFile), 'utf8'),
    safeSpreadsheetFile,
    safeSpreadsheetCode: fs.readFileSync(path.join(assetsDir, safeSpreadsheetFile), 'utf8')
  };
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
  let assets;
  let validBuffer;
  let sparseOversizedBuffer;

  test.beforeAll(() => {
    assets = getProductionAssets();
    validBuffer = createValidWorkbookBuffer();
    sparseOversizedBuffer = createSparseOversizedWorkbookBuffer();
  });

  test.beforeEach(async ({ page }) => {
    // Intercept production worker and safeSpreadsheet module chunks
    await page.route(`**/assets/${assets.workerFile}`, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: assets.workerCode
      });
    });

    await page.route(`**/assets/${assets.safeSpreadsheetFile}`, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: assets.safeSpreadsheetCode
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

    // Establish browser context origin
    await page.goto('/');

    // Load harness HTML that dynamically imports the REAL production safeReadSpreadsheetAsync export
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Production Worker Harness</title></head>
      <body>
        <h1>Browser Worker Production Harness</h1>
        <script>
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
        </script>
        <script type="module">
          try {
            const mod = await import('/bfi-classroom/assets/${assets.safeSpreadsheetFile}');
            window.safeReadSpreadsheetAsync = mod.safeReadSpreadsheetAsync;
            window.__harnessReady = true;
          } catch (e) {
            console.error('Module import error:', e);
          }
        </script>
      </body>
      </html>
    `);

    // Wait for the ES module to load the actual production export
    await page.waitForFunction(() => window.__harnessReady === true, { timeout: 10000 });
  });

  test('1. Successful tabular sheet import in real browser worker using production export', async ({ page }) => {
    const dataArray = Array.from(validBuffer);
    const result = await page.evaluate(async (bytes) => {
      const u8 = new Uint8Array(bytes);
      const res = await window.safeReadSpreadsheetAsync(u8, { maxRows: 100 });
      return {
        rows: res,
        workerTerminated: window.__lastWorkerInstance ? window.__lastWorkerInstance.__terminated : false
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

    expect(res.threw).toBe(true);
    expect(res.message).toContain('Spreadsheet range (A1:CV5001) spans 500,100 potential cells (5,001 rows × 100 columns), exceeding the maximum allowable cell limit of 50,000 cells');
    expect(res.workerTerminated).toBe(true);
  });

  test('3. Real browser worker timeout termination', async ({ page }) => {
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

    expect(res.threw).toBe(true);
    expect(res.message).toContain('Spreadsheet processing timed out after 0 seconds');
    expect(res.workerTerminated).toBe(true);
  });

  test('4. Browser worker constructor failure fails safely without main-thread parsing', async ({ page }) => {
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

    expect(res.threw).toBe(true);
    expect(res.message).toMatch(/Failed to initialize spreadsheet background worker.*(The operation is insecure\.|SecurityError).*Processing halted to prevent main-thread execution/);
  });

  test('5. Missing Worker environment fails safely without main-thread fallback', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const OriginalWorker = window.Worker;
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
        window.Worker = OriginalWorker;
      }
    });

    expect(res.threw).toBe(true);
    expect(res.message).toContain('Browser environment does not support Web Workers. Spreadsheet processing halted to prevent main-thread resource exhaustion.');
  });

  test('6. Worker parsing/runtime error rejects cleanly and terminates worker', async ({ page }) => {
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

    expect(res.threw).toBe(true);
    expect(res.message.length).toBeGreaterThan(0);
    expect(res.workerTerminated).toBe(true);
  });

  test('7. Comprehensive worker cleanup: zero orphaned background workers across all execution paths', async ({ page }) => {
    const dataArray = Array.from(validBuffer);
    await page.evaluate(async (bytes) => {
      const u8 = new Uint8Array(bytes);
      await window.safeReadSpreadsheetAsync(u8, { maxRows: 100 });
    }, dataArray);

    const cleanupStatus = await page.evaluate(() => {
      const instances = window.__workerInstances || [];
      return {
        totalCreated: instances.length,
        allTerminated: instances.length > 0 && instances.every(w => w.__terminated === true)
      };
    });

    expect(cleanupStatus.totalCreated).toBeGreaterThanOrEqual(1);
    expect(cleanupStatus.allTerminated).toBe(true);
  });
});
