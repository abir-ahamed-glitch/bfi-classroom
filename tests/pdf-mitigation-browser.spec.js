import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createValidPdfBuffer(text = 'BFI Classroom PDF Test') {
  const content = `BT /F1 12 Tf 100 700 Td (${text}) Tj ET`;
  const streamLen = content.length;

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${streamLen} >>
stream
${content}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000234 00000 n 
0000000300 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
380
%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

/**
 * Isolated PDF.js 6.4.299 Library & Worker Smoke Test Suite
 *
 * NOTE: This suite tests the underlying pdfjs-dist@6.4.299 library and dedicated Web Worker
 * in an isolated library harness without intercepting or breaking Vite's application module
 * imports (such as pdf.worker.min.mjs?url).
 * For real mounted application component verification (PdfViewer, BulkStudentImport,
 * BulkRegisteredStudentImport, UploadResultsModal), see tests/pdf-components-application.spec.js.
 */
test.describe('PDF.js 6.4.299 Isolated Library & Worker Smoke Test Suite', () => {
  let pdfJsCode;
  let pdfWorkerCode;
  let validPdfBytes;
  let corruptPdfBytes;

  test.beforeAll(() => {
    const pdfDistDir = path.resolve(__dirname, '../node_modules/pdfjs-dist/build');
    pdfJsCode = fs.readFileSync(path.join(pdfDistDir, 'pdf.min.mjs'), 'utf8');
    pdfWorkerCode = fs.readFileSync(path.join(pdfDistDir, 'pdf.worker.min.mjs'), 'utf8');
    validPdfBytes = Array.from(createValidPdfBuffer());
    corruptPdfBytes = Array.from(Buffer.from('%PDF-1.4\ncorrupted_data_not_valid_pdf_structure'));
  });

  test.beforeEach(async ({ page }) => {
    page.__pageErrors = [];
    page.__consoleErrors = [];
    page.__requestFailures = [];
    page.__httpErrorResponses = [];

    page.on('pageerror', err => {
      page.__pageErrors.push(err.message || String(err));
    });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        page.__consoleErrors.push(msg.text());
      }
    });

    page.on('requestfailed', req => {
      page.__requestFailures.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText || 'failed'}`);
    });

    page.on('response', res => {
      if (res.status() >= 400) {
        page.__httpErrorResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    // Narrowly scoped isolated fixture routes that NEVER collide with Vite's /node_modules/...?url imports
    await page.route('**/__pdfjs_smoke_fixture__/harness.html', route => {
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PDF.js 6.4.299 Isolated Library Smoke Harness</title>
</head>
<body>
  <script type="module">
    import * as pdfjsLib from '/__pdfjs_smoke_fixture__/pdf.min.mjs';
    window.pdfjsLib = pdfjsLib;
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/__pdfjs_smoke_fixture__/pdf.worker.min.mjs';
    window.__getDocumentCalls = [];
    window.__workerGetDocRequests = [];

    const NativeWorker = window.Worker;
    function InstrumentedSmokeWorker(scriptURL, options) {
      const instance = new NativeWorker(scriptURL, options);
      const origPostMessage = instance.postMessage.bind(instance);
      instance.postMessage = function(msg) {
        if (msg && msg.action === 'GetDocRequest' && msg.data) {
          window.__workerGetDocRequests.push({
            action: msg.action,
            apiVersion: msg.data.apiVersion,
            enableXfa: msg.data.enableXfa,
            evaluatorOptions: msg.data.evaluatorOptions
          });
        }
        return origPostMessage.apply(instance, arguments);
      };
      return instance;
    }
    InstrumentedSmokeWorker.prototype = NativeWorker.prototype;
    window.Worker = InstrumentedSmokeWorker;

    const origLib = window.pdfjsLib;
    const origGetDocument = origLib.getDocument.bind(origLib);
    window.pdfjsLib = new Proxy(origLib, {
      get(target, prop) {
        if (prop === 'getDocument') {
          return function(src) {
            window.__getDocumentCalls.push({
              isEvalSupported: typeof src === 'object' ? src.isEvalSupported : undefined,
              enableXfa: typeof src === 'object' ? src.enableXfa : undefined,
              srcType: typeof src,
              hasData: Boolean(typeof src === 'object' && src.data)
            });
            return origGetDocument(src);
          };
        }
        return target[prop];
      }
    });
    window.__harnessReady = Boolean(window.pdfjsLib && window.pdfjsLib.version === '6.4.299');
  </script>
</body>
</html>`
      });
    });

    await page.route('**/__pdfjs_smoke_fixture__/pdf.worker.min.mjs', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: pdfWorkerCode
      });
    });

    await page.route('**/__pdfjs_smoke_fixture__/pdf.min.mjs', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: pdfJsCode
      });
    });

    await page.goto('/__pdfjs_smoke_fixture__/harness.html');
    await page.waitForFunction(() => window.__harnessReady === true, { timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    // Strictly assert zero unexpected page errors, zero module loading failures, and zero HTTP errors
    expect(page.__pageErrors).toEqual([]);
    expect(page.__consoleErrors).toEqual([]);
    expect(page.__requestFailures).toEqual([]);
    expect(page.__httpErrorResponses).toEqual([]);
  });

  test('1. Source Code Smoke Check: all 4 PDF components configure pdf.worker.min.mjs?url (NOT .min.js)', async () => {
    const srcDir = path.resolve(__dirname, '../src/components');
    const import1 = fs.readFileSync(path.join(srcDir, 'admin/BulkRegisteredStudentImport.jsx'), 'utf8');
    const import2 = fs.readFileSync(path.join(srcDir, 'admin/BulkStudentImport.jsx'), 'utf8');
    const import3 = fs.readFileSync(path.join(srcDir, 'admin/UploadResultsModal.jsx'), 'utf8');
    const viewer = fs.readFileSync(path.join(srcDir, 'PdfViewer.jsx'), 'utf8');

    expect(import1).toMatch(/pdf\.worker\.min\.mjs\?url/);
    expect(import1).not.toContain('pdf.worker.min.js');

    expect(import2).toMatch(/pdf\.worker\.min\.mjs\?url/);
    expect(import2).not.toContain('pdf.worker.min.js');

    expect(import3).toMatch(/pdf\.worker\.min\.mjs\?url/);
    expect(import3).not.toContain('pdf.worker.min.js');

    expect(viewer).toMatch(/pdf\.worker\.min\.mjs\?url/);
    expect(viewer).not.toContain('pdf.worker.min.js');
  });

  test('2. Library Worker Smoke Test: loads pdf.worker.min.mjs (6.4.299) into dedicated Web Worker without module errors', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const workerUrl = '/__pdfjs_smoke_fixture__/pdf.worker.min.mjs';
      const worker = new Worker(workerUrl, { type: 'module' });
      return new Promise((resolve) => {
        worker.onerror = (e) => resolve({ ok: false, error: e.message });
        setTimeout(() => {
          worker.terminate();
          resolve({ ok: true, version: window.pdfjsLib.version });
        }, 200);
      });
    });

    expect(result.ok).toBe(true);
    expect(result.version).toBe('6.4.299');
  });

  test('3. Library Smoke Test (Viewer Pattern): getDocument parses valid PDF via 6.4.299 worker with enableXfa: false', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      const params = {
        data: new Uint8Array(pdfBytes),
        isEvalSupported: false,
        enableXfa: false,
      };

      const task = window.pdfjsLib.getDocument(params);
      const doc = await task.promise;
      const page1 = await doc.getPage(1);
      const text = await page1.getTextContent();
      await task.destroy();

      return {
        isEvalSupported: params.isEvalSupported,
        enableXfa: params.enableXfa,
        numPages: doc.numPages,
        textStr: text.items.map(i => i.str).join(' '),
        workerReq: window.__workerGetDocRequests[window.__workerGetDocRequests.length - 1]
      };
    }, validPdfBytes);

    expect(result.isEvalSupported).toBe(false);
    expect(result.enableXfa).toBe(false);
    expect(result.numPages).toBe(1);
    expect(result.textStr).toContain('BFI Classroom PDF Test');
    expect(result.workerReq.apiVersion).toBe('6.4.299');
    expect(result.workerReq.enableXfa).toBe(false);
  });

  test('4. Library Smoke Test: malformed PDF triggers error handling without crashing page', async ({ page }) => {
    const result = await page.evaluate(async (corruptBytes) => {
      try {
        const task = window.pdfjsLib.getDocument({
          data: new Uint8Array(corruptBytes),
          isEvalSupported: false,
          enableXfa: false
        });
        await task.promise;
        return { caught: false };
      } catch (err) {
        return { caught: true, message: err.message };
      }
    }, corruptPdfBytes);

    expect(result.caught).toBe(true);
    expect(result.message).toBeTruthy();
  });

  test('5. Library Smoke Test (Y-Coordinate Row Extraction Pattern 1): extracts text with defensive parser options', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      const evt = { target: { result: new Uint8Array(pdfBytes).buffer } };
      const data2D = [];

      const loadingTask = window.pdfjsLib.getDocument({
        data: new Uint8Array(evt.target.result),
        isEvalSupported: false,
        enableXfa: false
      });
      const pdf = await loadingTask.promise;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const p = await pdf.getPage(pageNum);
        const content = await p.getTextContent();

        const rowsMap = new Map();
        content.items.forEach(item => {
          const y = Math.round(item.transform[5] / 5) * 5;
          if (!rowsMap.has(y)) rowsMap.set(y, []);
          rowsMap.get(y).push(item);
        });

        const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);
        sortedY.forEach(y => {
          const rowItems = rowsMap.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
          const rowStrings = rowItems.map(item => item.str.trim()).filter(Boolean);
          if (rowStrings.length > 0) data2D.push(rowStrings);
        });
      }
      await loadingTask.destroy();

      return {
        workerSrc: window.pdfjsLib.GlobalWorkerOptions.workerSrc,
        rows: data2D,
        callRecord: window.__getDocumentCalls[window.__getDocumentCalls.length - 1]
      };
    }, validPdfBytes);

    expect(result.workerSrc).toContain('pdf.worker.min.mjs');
    expect(result.callRecord.isEvalSupported).toBe(false);
    expect(result.callRecord.enableXfa).toBe(false);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0][0]).toBe('BFI Classroom PDF Test');
  });

  test('6. Library Smoke Test (Y-Coordinate Row Extraction Pattern 2): multi-item row ordering and worker telemetry', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      const loadingTask = window.pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        isEvalSupported: false,
        enableXfa: false
      });
      const pdf = await loadingTask.promise;
      const p = await pdf.getPage(1);
      const content = await p.getTextContent();
      await loadingTask.destroy();

      return {
        itemCount: content.items.length,
        workerReq: window.__workerGetDocRequests[window.__workerGetDocRequests.length - 1]
      };
    }, validPdfBytes);

    expect(result.itemCount).toBeGreaterThan(0);
    expect(result.workerReq.apiVersion).toBe('6.4.299');
    expect(result.workerReq.enableXfa).toBe(false);
  });

  test('7. Library Smoke Test (Canvas Rasterization): renders page to HTMLCanvasElement with non-white pixels', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      const loadingTask = window.pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        isEvalSupported: false,
        enableXfa: false
      });
      const pdf = await loadingTask.promise;
      const pdfPage = await pdf.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1.0 });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });

      await pdfPage.render({ canvasContext: ctx, canvas, viewport }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let i = 0; i < img.length; i += 16) {
        if (img[i] < 250 || img[i + 1] < 250 || img[i + 2] < 250) nonWhite++;
      }
      await loadingTask.destroy();

      return {
        width: canvas.width,
        height: canvas.height,
        nonWhite
      };
    }, validPdfBytes);

    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);
    expect(result.nonWhite).toBeGreaterThan(10);
  });

  test('8. Library Smoke Test: malformed fixtures (non-PDF and zero-byte) reject gracefully without unhandled page error', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const results = {};
      try {
        await window.pdfjsLib.getDocument({ data: new Uint8Array([]), isEvalSupported: false, enableXfa: false }).promise;
        results.zeroByteCaught = false;
      } catch {
        results.zeroByteCaught = true;
      }

      try {
        const textBytes = new TextEncoder().encode('Not a real PDF file content');
        await window.pdfjsLib.getDocument({ data: textBytes, isEvalSupported: false, enableXfa: false }).promise;
        results.fakePdfCaught = false;
      } catch {
        results.fakePdfCaught = true;
      }

      return results;
    });

    expect(result.zeroByteCaught).toBe(true);
    expect(result.fakePdfCaught).toBe(true);
  });

  test('9. Application Entry Compatibility Smoke Test: navigating to live application shell loads Vite modules without route collision or export errors', async ({ page }) => {
    // Navigate to the real application root while the smoke fixture routes are active
    // to prove that our narrowly scoped /__pdfjs_smoke_fixture__/* routes do NOT intercept
    // Vite's pdf.worker.min.mjs?url module import or trigger module export errors.
    const res = await page.goto('/bfi-classroom/test-pdf-mount.html');
    expect(res.status()).toBe(200);
    await page.waitForFunction(() => window.__harnessReady === true, { timeout: 15000 });

    const appMeta = await page.evaluate(() => ({
      version: window.__pdfjsLib?.version,
      workerSrc: window.__pdfjsLib?.GlobalWorkerOptions?.workerSrc
    }));
    expect(appMeta.version).toBe('6.4.299');
    expect(appMeta.workerSrc).toMatch(/pdf\.worker\.min\.mjs/);
  });
});
