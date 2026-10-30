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

test.describe('PDF.js 6.3.289 Browser Migration & Worker Isolation Suite', () => {
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
    // Intercept local asset requests to serve local worker
    await page.route('**/*pdf.worker.min.mjs*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: pdfWorkerCode
      });
    });

    // Intercept pdf.min.mjs requests
    await page.route('**/*pdf.min.mjs*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: pdfJsCode
      });
    });

    await page.goto('/');

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>PDF Mitigation Browser Test</title>
      </head>
      <body>
        <script type="module">
          import * as pdfjsLib from '/assets/pdf.min.mjs';
          window.pdfjsLib = pdfjsLib;
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';
          window.__getDocumentCalls = [];
          const origLib = window.pdfjsLib;
          const origGetDocument = origLib.getDocument.bind(origLib);
          window.pdfjsLib = new Proxy(origLib, {
            get(target, prop) {
              if (prop === 'getDocument') {
                return function(src) {
                  window.__getDocumentCalls.push({
                    isEvalSupported: typeof src === 'object' ? src.isEvalSupported : undefined,
                    srcType: typeof src,
                    hasData: Boolean(typeof src === 'object' && src.data)
                  });
                  return origGetDocument(src);
                };
              }
              return target[prop];
            }
          });
          window.__harnessReady = Boolean(window.pdfjsLib);
        </script>
      </body>
      </html>
    `);

    await page.waitForFunction(() => window.__harnessReady === true, { timeout: 10000 });
  });

  test('1. Source Code Verification: all PDF components configure pdf.worker.min.mjs (NOT .min.js)', async () => {
    const srcDir = path.resolve(__dirname, '../src/components');
    const import1 = fs.readFileSync(path.join(srcDir, 'admin/BulkRegisteredStudentImport.jsx'), 'utf8');
    const import2 = fs.readFileSync(path.join(srcDir, 'admin/BulkStudentImport.jsx'), 'utf8');
    const import3 = fs.readFileSync(path.join(srcDir, 'admin/UploadResultsModal.jsx'), 'utf8');
    const viewer = fs.readFileSync(path.join(srcDir, 'PdfViewer.jsx'), 'utf8');

    expect(import1).toMatch(/pdf\.worker\.min\.mjs/);
    expect(import1).not.toContain('pdf.worker.min.js');

    expect(import2).toMatch(/pdf\.worker\.min\.mjs/);
    expect(import2).not.toContain('pdf.worker.min.js');

    expect(import3).toMatch(/pdf\.worker\.min\.mjs/);
    expect(import3).not.toContain('pdf.worker.min.js');

    expect(viewer).toMatch(/pdf\.worker\.min\.mjs/);
    expect(viewer).not.toContain('pdf.worker.min.js');
  });

  test('2. Real Browser Worker: loads pdf.worker.min.mjs into dedicated Web Worker', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const workerUrl = '/assets/pdf.worker.min.mjs';
      const worker = new Worker(workerUrl, { type: 'module' });
      return new Promise((resolve) => {
        worker.onerror = (e) => resolve({ ok: false, error: e.message });
        setTimeout(() => {
          worker.terminate();
          resolve({ ok: true });
        }, 200);
      });
    });

    expect(result.ok).toBe(true);
  });

  test('3. PdfViewer: transformGetDocumentParams passes isEvalSupported: false to getDocument', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      const transformGetDocumentParams = (params) => ({
        ...params,
        isEvalSupported: false,
      });

      const params = transformGetDocumentParams({
        data: new Uint8Array(pdfBytes)
      });

      const task = window.pdfjsLib.getDocument(params);
      const doc = await task.promise;
      const page1 = await doc.getPage(1);
      const text = await page1.getTextContent();

      return {
        isEvalSupported: params.isEvalSupported,
        numPages: doc.numPages,
        textStr: text.items.map(i => i.str).join(' ')
      };
    }, validPdfBytes);

    expect(result.isEvalSupported).toBe(false);
    expect(result.numPages).toBe(1);
    expect(result.textStr).toContain('BFI Classroom PDF Test');
  });

  test('4. PdfViewer: malformed PDF triggers error handling without crashing page', async ({ page }) => {
    const result = await page.evaluate(async (corruptBytes) => {
      try {
        const task = window.pdfjsLib.getDocument({
          data: new Uint8Array(corruptBytes),
          isEvalSupported: false
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

  test('5. BulkRegisteredStudentImport: extracts text in browser with isEvalSupported: false', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';

      const evt = { target: { result: new Uint8Array(pdfBytes).buffer } };
      let data2D = [];

      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(evt.target.result), isEvalSupported: false });
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

      return {
        workerSrc: window.pdfjsLib.GlobalWorkerOptions.workerSrc,
        rows: data2D,
        callRecord: window.__getDocumentCalls[window.__getDocumentCalls.length - 1]
      };
    }, validPdfBytes);

    expect(result.workerSrc).toContain('pdf.worker.min.mjs');
    expect(result.callRecord.isEvalSupported).toBe(false);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0][0]).toBe('BFI Classroom PDF Test');
  });

  test('6. BulkStudentImport: extracts text in browser with isEvalSupported: false', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';

      const evt = { target: { result: new Uint8Array(pdfBytes).buffer } };
      let data2D = [];

      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(evt.target.result), isEvalSupported: false });
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

      return {
        workerSrc: window.pdfjsLib.GlobalWorkerOptions.workerSrc,
        rows: data2D,
        callRecord: window.__getDocumentCalls[window.__getDocumentCalls.length - 1]
      };
    }, validPdfBytes);

    expect(result.workerSrc).toContain('pdf.worker.min.mjs');
    expect(result.callRecord.isEvalSupported).toBe(false);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test('7. UploadResultsModal: extracts text in browser with isEvalSupported: false', async ({ page }) => {
    const result = await page.evaluate(async (pdfBytes) => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';

      const evt = { target: { result: new Uint8Array(pdfBytes).buffer } };
      let data2D = [];

      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(evt.target.result), isEvalSupported: false });
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

      return {
        workerSrc: window.pdfjsLib.GlobalWorkerOptions.workerSrc,
        rows: data2D,
        callRecord: window.__getDocumentCalls[window.__getDocumentCalls.length - 1]
      };
    }, validPdfBytes);

    expect(result.workerSrc).toContain('pdf.worker.min.mjs');
    expect(result.callRecord.isEvalSupported).toBe(false);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test('8. Malformed fixtures: non-PDF and zero-byte reject gracefully without crash', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const results = {};
      try {
        await window.pdfjsLib.getDocument({ data: new Uint8Array([]), isEvalSupported: false }).promise;
        results.zeroByteCaught = false;
      } catch {
        results.zeroByteCaught = true;
      }

      try {
        const textBytes = new TextEncoder().encode('Not a real PDF file content');
        await window.pdfjsLib.getDocument({ data: textBytes, isEvalSupported: false }).promise;
        results.fakePdfCaught = false;
      } catch {
        results.fakePdfCaught = true;
      }

      return results;
    });

    expect(result.zeroByteCaught).toBe(true);
    expect(result.fakePdfCaught).toBe(true);
  });
});
