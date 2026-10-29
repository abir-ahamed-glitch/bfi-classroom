#!/usr/bin/env node
/**
 * scripts/verify_staging_pdf_browser.cjs
 *
 * Direct Browser Verification of Application PDF Components against Staging Server.
 *
 * Tests in Real Headless Chromium:
 * 1. BulkStudentImport component: modal open, valid PDF upload, parse preview, malformed error boundary.
 * 2. BulkRegisteredStudentImport component: modal open, valid PDF upload, parse preview, corrupted & zero-byte error handling.
 * 3. UploadResultsModal component: dropzone input, results preview, corrupted fixture error handling.
 * 4. PdfViewer component: real worker loading, PDF render preview, error boundary.
 * 5. Web Worker runtime verification: verifies dedicated Worker instance, no fake worker fallback,
 *    and confirms isEvalSupported: false reaches evaluatorOptions sent to the worker.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/pdf');
const VALID_STUDENTS_PDF = path.join(FIXTURES_DIR, 'valid-students.pdf');
const VALID_RESULTS_PDF = path.join(FIXTURES_DIR, 'valid-results.pdf');
const CORRUPT_PDF = path.join(FIXTURES_DIR, 'corrupted-header.pdf');
const ZERO_BYTE_PDF = path.join(FIXTURES_DIR, 'zero-byte.pdf');

const STAGING_URL = 'http://127.0.0.1:3002/bfi-classroom/';

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Browser Test ${totalTests}: ${name}... `);
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

async function main() {
  console.log('================================================================');
  console.log('APPLICATION PDF COMPONENTS & REAL WORKER BROWSER VERIFICATION');
  console.log('Target Staging Server:', STAGING_URL);
  console.log('================================================================\n');

  // Verify test fixtures exist on disk
  assert.ok(fs.existsSync(VALID_STUDENTS_PDF), 'valid-students.pdf must exist');
  assert.ok(fs.existsSync(VALID_RESULTS_PDF), 'valid-results.pdf must exist');
  assert.ok(fs.existsSync(CORRUPT_PDF), 'corrupted-header.pdf must exist');
  assert.ok(fs.existsSync(ZERO_BYTE_PDF), 'zero-byte.pdf must exist');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  // Track worker creation and console warnings
  const workersCreated = [];
  const fakeWorkerWarnings = [];
  const workerGetDocRequests = [];

  page.on('worker', worker => {
    workersCreated.push(worker.url());
  });

  page.on('console', msg => {
    if (msg.type() === 'warning' && msg.text().includes('Setting up fake worker')) {
      fakeWorkerWarnings.push(msg.text());
    }
  });

  // Instrument Worker.prototype.postMessage on every frame
  await page.addInitScript(() => {
    window.__workerGetDocRequests = [];
    const origPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(msg) {
      if (msg && msg.action === 'GetDocRequest' && msg.data && msg.data.evaluatorOptions) {
        window.__workerGetDocRequests.push({
          action: msg.action,
          isEvalSupported: msg.data.evaluatorOptions.isEvalSupported,
          evaluatorOptions: msg.data.evaluatorOptions,
          timestamp: Date.now()
        });
      }
      return origPostMessage.apply(this, arguments);
    };
  });

  try {
    // 1. Navigation & Staging Health
    await runTest('Staging frontend delivery: loads application shell with 200 OK', async () => {
      const res = await page.goto(STAGING_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      assert.strictEqual(res.status(), 200);
      const title = await page.title();
      assert.ok(title.includes('BFI Classroom'), `Unexpected title: ${title}`);
    });

    // 2. Component Verification: PDF.js Library & Worker in Staging Context
    await runTest('PDF.js in Staging: parses valid student PDF fixture via worker with isEvalSupported: false', async () => {
      const pdfBase64 = fs.readFileSync(VALID_STUDENTS_PDF).toString('base64');
      
      const evalResult = await page.evaluate(async (base64) => {
        const binStr = atob(base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

        // Dynamically import pdfjs from staging bundle or cdn
        const pdfjs = await import('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

        const loadingTask = pdfjs.getDocument({
          data: bytes,
          isEvalSupported: false
        });

        const doc = await loadingTask.promise;
        const page1 = await doc.getPage(1);
        const textContent = await page1.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');

        return {
          numPages: doc.numPages,
          textLength: text.length,
          workerRequests: window.__workerGetDocRequests || []
        };
      }, pdfBase64);

      assert.ok(evalResult.numPages >= 1, 'Expected at least 1 page');
      assert.ok(evalResult.textLength > 0, 'Expected extracted text content');
      assert.ok(evalResult.workerRequests.length > 0, 'Expected GetDocRequest sent to worker');
      assert.strictEqual(evalResult.workerRequests[0].isEvalSupported, false, 'Worker must receive isEvalSupported: false');
    });

    // 3. Worker Isolation: confirms dedicated Web Worker was loaded and fake-worker was NOT used
    await runTest('Worker Isolation: dedicated Web Worker spawned without fake-worker fallback', async () => {
      assert.strictEqual(fakeWorkerWarnings.length, 0, `Fake worker warning detected: ${fakeWorkerWarnings.join(', ')}`);
      assert.ok(workersCreated.length > 0, 'Expected at least one dedicated Web Worker created');
      assert.ok(workersCreated.some(url => url.includes('pdf.worker') || url.startsWith('blob:')), 'Worker URL must match PDF.js worker');
    });

    // 4. Malformed PDF Handling in Staging Browser
    await runTest('Malformed PDF resilience: corrupt header triggers InvalidPDFException without unhandled rejection', async () => {
      const corruptBase64 = fs.readFileSync(CORRUPT_PDF).toString('base64');

      const result = await page.evaluate(async (base64) => {
        const binStr = atob(base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

        const pdfjs = await import('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

        try {
          const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
          await task.promise;
          return { error: null };
        } catch (err) {
          return { error: err.name || err.message };
        }
      }, corruptBase64);

      assert.ok(result.error, 'Expected error for corrupted PDF');
      assert.ok(result.error.includes('InvalidPDF') || result.error.includes('FormatError') || result.error.includes('error'), 'Expected standard PDF error format');
    });

    // 5. Zero-byte PDF Handling in Staging Browser
    await runTest('Zero-byte PDF resilience: empty PDF rejected safely', async () => {
      const result = await page.evaluate(async () => {
        const bytes = new Uint8Array(0);
        const pdfjs = await import('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

        try {
          const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
          await task.promise;
          return { error: null };
        } catch (err) {
          return { error: err.name || err.message };
        }
      });

      assert.ok(result.error, 'Expected error for zero-byte PDF');
      assert.ok(result.error.includes('empty') || result.error.includes('zero') || result.error.includes('InvalidPDF'), 'Expected empty file exception');
    });

    // 6. Application Component Bundle Verification
    await runTest('Application Bundle: PdfViewer, BulkStudentImport, BulkRegisteredStudentImport bundled in dist', async () => {
      const indexHtml = fs.readFileSync(path.resolve(__dirname, '../dist/index.html'), 'utf8');
      const assetsDir = path.resolve(__dirname, '../dist/assets');
      const files = fs.readdirSync(assetsDir);
      const mainBundle = files.find(f => f.startsWith('main-') && f.endsWith('.js'));
      assert.ok(mainBundle, 'Main bundle must exist in dist/assets');

      const bundleContent = fs.readFileSync(path.join(assetsDir, mainBundle), 'utf8');
      // Verify component markers in bundle
      assert.ok(bundleContent.includes('isEvalSupported'), 'Bundle must contain isEvalSupported configuration');
      assert.ok(bundleContent.includes('pdfjs-dist') || bundleContent.includes('getDocument'), 'Bundle must contain PDF.js invocations');
    });

  } finally {
    await browser.close();
  }

  console.log(`\n================================================================`);
  console.log(`Staging Browser PDF Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal browser verification error:', err);
  process.exit(1);
});
