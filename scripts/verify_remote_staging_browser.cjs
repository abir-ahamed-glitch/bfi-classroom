/**
 * Remote Staging Application-Level PDF Browser Verification Script
 *
 * Executes Chromium against the isolated Linux ARM64 staging server via local SSH tunnel (default: 127.0.0.1:3002),
 * or against a local production-built application server (`STAGING_TARGET_URL=http://127.0.0.1:3099/bfi-classroom`).
 *
 * Exercises actual compiled application pages and UI controls across all 4 client PDF consumers:
 *   - UI Authentication (/bfi-classroom/admin/login)
 *   - BulkStudentImport (/bfi-classroom/admin/studentsmanager -> "Smart Batch Import")
 *   - BulkRegisteredStudentImport (/bfi-classroom/admin/additional-options?view=bulk-register -> "Bulk Upload Registered Students")
 *   - UploadResultsModal (/bfi-classroom/admin/batches/1 -> "Upload Results")
 *   - PdfViewer (/bfi-classroom/notices -> Lightbox attachment viewer using direct pdfjs-dist@6.4.299 rendering)
 *
 * Verifies:
 *   1. Dedicated Web Worker instantiated from same-origin Vite hashed asset (`pdf.worker.min-*.mjs`)
 *      with valid JavaScript MIME type (`application/javascript` or `text/javascript`) and zero fake-worker warnings.
 *   2. Fresh successful document work (`GetDocRequest` sent + worker response messages received) for EACH
 *      of the 4 PDF consumers independently — a worker or request observed during an earlier operation
 *      NEVER satisfies a later consumer check.
 *   3. Engine version alignment (`apiVersion: '6.4.299'`) and defensive parser option (`enableXfa: false`)
 *      on every `GetDocRequest` payload, plus completed non-white canvas pixel painting and literal text layer
 *      rendering in `PdfViewer`.
 *   4. Real application error boundaries handle corrupted and zero-byte PDFs gracefully while blocking submission.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TUNNEL_URL = (process.env.STAGING_TARGET_URL || 'http://127.0.0.1:3002/bfi-classroom').replace(/\/+$/, '');
const TARGET_ORIGIN = new URL(TUNNEL_URL).origin;
const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/pdf');
const VALID_STUDENTS_PDF = path.join(FIXTURES_DIR, 'valid-students.pdf');
const VALID_RESULTS_PDF = path.join(FIXTURES_DIR, 'valid-results.pdf');
const VALID_SAMPLE_PDF = path.join(FIXTURES_DIR, 'valid-sample.pdf');
const CORRUPT_PDF = path.join(FIXTURES_DIR, 'corrupted-header.pdf');
const ZERO_BYTE_PDF = path.join(FIXTURES_DIR, 'zero-byte.pdf');

// Regex matching Vite's hashed ESM worker asset (e.g. /bfi-classroom/assets/pdf.worker.min-CjEcRF4W.mjs)
const WORKER_ASSET_REGEX = /\/assets\/pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs(?:\?.*)?$|pdf\.worker\.min\.mjs(?:\?.*)?$/;

// Resolve staging credentials safely without hardcoding or committing secrets
let STAGING_USER = process.env.STAGING_ADMIN_USER || 'admin@staging-admin';
let STAGING_PASS = process.env.STAGING_ADMIN_PASSWORD;

if (!STAGING_PASS) {
  const candidateCredFiles = [
    path.resolve(__dirname, '../.staging_admin_creds.json'),
    path.resolve(__dirname, '../server/.staging_admin_credentials.json')
  ];
  for (const credFile of candidateCredFiles) {
    if (fs.existsSync(credFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (parsed.password) STAGING_PASS = parsed.password;
        if (parsed.username) STAGING_USER = parsed.username;
        else if (parsed.email) STAGING_USER = parsed.email;
        if (STAGING_PASS) break;
      } catch (_) {}
    }
  }
}

if (!STAGING_PASS) {
  throw new Error('STAGING_ADMIN_PASSWORD is required via process.env or .staging_admin_creds.json');
}

function isSameOriginWorkerUrl(workerUrl, expectedOrigin) {
  try {
    const parsed = new URL(workerUrl, expectedOrigin);
    return parsed.origin === expectedOrigin && WORKER_ASSET_REGEX.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

function isValidWorkerMimeType(contentType) {
  if (!contentType || typeof contentType !== 'string') return false;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return normalized === 'application/javascript' || normalized === 'text/javascript';
}

async function runStagingBrowserVerification() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(' STAGING / PRODUCTION-BUILD BROWSER INTEGRATION SUITE (pdfjs-dist@6.4.299)');
  console.log(` Target URL: ${TUNNEL_URL}`);
  console.log(` Expected Origin: ${TARGET_ORIGIN}`);
  console.log('════════════════════════════════════════════════════════════════════════\n');

  // Verify fixtures exist
  for (const [name, p] of Object.entries({
    VALID_STUDENTS_PDF,
    VALID_RESULTS_PDF,
    VALID_SAMPLE_PDF,
    CORRUPT_PDF,
    ZERO_BYTE_PDF
  })) {
    if (!fs.existsSync(p)) {
      throw new Error(`Required test fixture missing: ${name} at ${p}`);
    }
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  page.setDefaultNavigationTimeout(180000);

  // Track console warnings (specifically fake worker warnings) and unexpected page/console errors
  const consoleWarnings = [];
  const consoleErrors = [];
  const pageErrors = [];
  const workerNetworkResponses = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.toLowerCase().includes('error') || text.toLowerCase().includes('worker')) {
      console.log(`  [BROWSER ${msg.type().toUpperCase()}]:`, text);
    }
    if (msg.type() === 'warning') {
      consoleWarnings.push(text);
      if (text.includes('Setting up fake worker')) {
        console.warn('  ⚠️ [FAKE WORKER WARNING DETECTED]:', text);
      }
    } else if (msg.type() === 'error') {
      if (
        !text.includes('Failed to load resource') &&
        !text.includes('corrupt.pdf') &&
        !text.includes('InvalidPDFException') &&
        !text.includes('Invalid PDF structure') &&
        !text.includes('The PDF file is empty')
      ) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', err => {
    console.error('  [PAGE ERROR EXCEPTION]:', err.message);
    pageErrors.push(err.message);
  });

  // Track HTTP responses for worker script assets to verify same-origin & MIME type
  page.on('response', res => {
    const url = res.url();
    if (WORKER_ASSET_REGEX.test(url)) {
      const contentType = res.headers()['content-type'] || '';
      workerNetworkResponses.push({
        url,
        status: res.status(),
        contentType,
        sameOrigin: isSameOriginWorkerUrl(url, TARGET_ORIGIN),
        validMime: isValidWorkerMimeType(contentType)
      });
    }
  });

  // Track Web Workers via Playwright's native worker event
  const createdWorkers = [];
  page.on('worker', worker => {
    createdWorkers.push(worker.url());
    console.log(`  🧵 [Web Worker Created]: ${worker.url()}`);
  });

  // Inject Worker constructor and message telemetry into page before any scripts execute
  await page.addInitScript(() => {
    // Mock Turnstile verification callback for isolated staging/local loopback test
    window.turnstile = {
      render: (container, options) => {
        if (options && options.callback) {
          setTimeout(() => options.callback('mock_test_turnstile_token'), 50);
        }
        return 'mock-widget-id';
      },
      getResponse: () => 'mock_test_turnstile_token',
      reset: () => {}
    };

    window.__createdWorkers = [];
    window.__workerGetDocRequests = [];
    window.__workerDocResponses = [];

    const NativeWorker = window.Worker;
    function InstrumentedStagingWorker(scriptURL, options) {
      const urlStr = String(scriptURL);
      const instance = new NativeWorker(scriptURL, options);
      const workerId = window.__createdWorkers.length + 1;
      const workerRecord = {
        workerId,
        url: urlStr,
        type: options ? options.type : undefined,
        createdAt: Date.now(),
        messagesSent: 0,
        messagesReceived: 0
      };
      window.__createdWorkers.push(workerRecord);

      const origPostMessage = instance.postMessage.bind(instance);
      instance.postMessage = function(msg) {
        workerRecord.messagesSent++;
        if (msg && msg.action === 'GetDocRequest' && msg.data) {
          window.__workerGetDocRequests.push({
            workerId,
            workerUrl: urlStr,
            action: msg.action,
            apiVersion: msg.data.apiVersion,
            hasEnableXfaKey: 'enableXfa' in msg.data,
            enableXfa: msg.data.enableXfa,
            evaluatorOptions: msg.data.evaluatorOptions,
            timestamp: Date.now()
          });
        }
        return origPostMessage.apply(instance, arguments);
      };

      instance.addEventListener('message', (event) => {
        workerRecord.messagesReceived++;
        window.__workerDocResponses.push({
          workerId,
          workerUrl: urlStr,
          action: event.data ? event.data.action : undefined,
          timestamp: Date.now()
        });
      });

      return instance;
    }
    InstrumentedStagingWorker.prototype = NativeWorker.prototype;
    window.Worker = InstrumentedStagingWorker;
  });

  /**
   * Captures a baseline snapshot of worker telemetry BEFORE a consumer action starts,
   * so we can strictly assert that the consumer performed fresh document work during its step.
   */
  async function captureWorkerBaseline() {
    const pageCounts = await page.evaluate(() => ({
      reqCount: window.__workerGetDocRequests ? window.__workerGetDocRequests.length : 0,
      respCount: window.__workerDocResponses ? window.__workerDocResponses.length : 0,
      workerCount: window.__createdWorkers ? window.__createdWorkers.length : 0
    }));
    return {
      ...pageCounts,
      playwrightWorkerCount: createdWorkers.length
    };
  }

  /**
   * Verifies that a consumer triggered fresh GetDocRequest(s) AND received fresh worker response
   * messages after `baseline` on a same-origin `pdf.worker.min-*.mjs` worker with version 6.4.299
   * and `enableXfa: false`. Never allows earlier worker activity to satisfy a later consumer check.
   */
  async function verifyFreshConsumerWorkerWork(consumerName, baseline) {
    await page.waitForFunction(
      ({ startReq, startResp }) =>
        window.__workerGetDocRequests &&
        window.__workerGetDocRequests.length > startReq &&
        window.__workerDocResponses &&
        window.__workerDocResponses.length > startResp,
      { startReq: baseline.reqCount, startResp: baseline.respCount },
      { timeout: 15000 }
    );

    const delta = await page.evaluate(({ startReq, startResp, startWorkers }) => {
      const freshReqs = (window.__workerGetDocRequests || []).slice(startReq);
      const freshResps = (window.__workerDocResponses || []).slice(startResp);
      const freshWorkers = (window.__createdWorkers || []).slice(startWorkers);
      return { freshReqs, freshResps, freshWorkers };
    }, {
      startReq: baseline.reqCount,
      startResp: baseline.respCount,
      startWorkers: baseline.workerCount
    });

    const freshReqs = delta.freshReqs;
    const freshResps = delta.freshResps;

    // Require at least 1 fresh GetDocRequest and at least 1 fresh worker response for the same workerId
    const activeWorkerIds = new Set(freshReqs.map(r => r.workerId));
    const matchingResps = freshResps.filter(r => activeWorkerIds.has(r.workerId));
    const allMjsWorker = freshReqs.length > 0 && freshReqs.every(r => isSameOriginWorkerUrl(r.workerUrl, TARGET_ORIGIN));
    const allVersionAligned = freshReqs.length > 0 && freshReqs.every(r => r.apiVersion === '6.4.299');
    const allXfaDisabled = freshReqs.length > 0 && freshReqs.every(r => r.hasEnableXfaKey === true && r.enableXfa === false);
    const hasCompletedWork = freshReqs.length > 0 && matchingResps.length > 0;

    const audit = {
      consumerName,
      freshWorkersSpawnedInStep: delta.freshWorkers.length,
      freshRequestsCount: freshReqs.length,
      freshResponsesCount: matchingResps.length,
      hasCompletedWork,
      allSameOriginMjsWorker: allMjsWorker,
      allVersion6_4_299: allVersionAligned,
      allEnableXfaFalse: allXfaDisabled,
      workerUrls: Array.from(new Set(freshReqs.map(r => r.workerUrl))),
      freshRequests: freshReqs
    };

    if (!hasCompletedWork) {
      throw new Error(`${consumerName}: did not observe fresh GetDocRequest + worker response completion in this step`);
    }
    if (!allMjsWorker) {
      throw new Error(`${consumerName}: worker URL did not match same-origin hashed .mjs asset (${JSON.stringify(audit.workerUrls)})`);
    }
    if (!allVersionAligned) {
      throw new Error(`${consumerName}: worker GetDocRequest apiVersion was not 6.4.299`);
    }
    if (!allXfaDisabled) {
      throw new Error(`${consumerName}: enableXfa:false was not enforced on all fresh GetDocRequest payloads`);
    }

    return audit;
  }

  const componentWorkerAudit = {
    BulkStudentImport: null,
    BulkRegisteredStudentImport: null,
    UploadResultsModal: null,
    PdfViewer: null
  };

  const results = [];
  function recordResult(step, name, passed, details = '') {
    results.push({ step, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${step}] ${mark}: ${name} ${details ? `(${details})` : ''}`);
  }

  try {
    // ── STEP 1: UI Authentication via Login Form ───────────────────────────────
    console.log('\n--- Step 1: UI Form Authentication ---');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  [Connection Attempt ${attempt}] Navigating to ${TUNNEL_URL}/admin/login...`);
        await page.goto(`${TUNNEL_URL}/admin/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        break;
      } catch (navErr) {
        if (attempt === 3) throw navErr;
        console.warn(`  [Warning Attempt ${attempt}]: ${navErr.message}. Retrying cold connection...`);
        await page.waitForTimeout(3000);
      }
    }

    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');
    const submitBtn = page.locator('button[type="submit"]');

    await usernameInput.fill(STAGING_USER);
    await passwordInput.fill(STAGING_PASS);

    await page.waitForTimeout(300);
    await submitBtn.click();

    try {
      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
    } catch (urlErr) {
      const alertMsg = await page.locator('.error-alert').textContent().catch(() => 'no alert');
      throw new Error(`Login navigation failed: ${urlErr.message}. Page alert: ${alertMsg}`);
    }
    const currentUrl = page.url();
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const isAuthSuccess = Boolean(token && token.length > 50);
    recordResult('1', 'UI Form Authentication', isAuthSuccess, `Redirected to ${currentUrl}`);

    // ── STEP 2: BulkStudentImport (Live UI Controls) ───────────────────────────
    console.log('\n--- Step 2: BulkStudentImport Component via Live UI ---');
    await page.goto(`${TUNNEL_URL}/admin/studentsmanager`, { waitUntil: 'domcontentloaded' });

    const smartImportBtn = page.locator('button:has-text("Smart Batch Import")');
    await smartImportBtn.waitFor({ state: 'visible', timeout: 10000 });
    await smartImportBtn.click();

    const importModalHeader = page.locator('text=Bulk Student Import');
    await importModalHeader.waitFor({ state: 'visible', timeout: 5000 });

    const studentFileInput = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await studentFileInput.waitFor({ state: 'attached', timeout: 5000 });

    // 2a. Valid fixture test with fresh worker work assertion
    const baseline2a = await captureWorkerBaseline();
    await studentFileInput.setInputFiles(VALID_STUDENTS_PDF);

    const studentValidPill = page.locator('text=/[1-9]\\d*\\s+valid students found/');
    await studentValidPill.waitFor({ state: 'visible', timeout: 15000 });
    const pillText = await studentValidPill.textContent();

    // Verify rendered preview table rows in BulkStudentImport
    const studentPreviewRows = await page.locator('[data-testid="bulk-student-preview-table"] tbody tr, .bulk-import-preview-table tbody tr').count();
    if (studentPreviewRows < 2) {
      throw new Error(`BulkStudentImport: expected >= 2 preview table rows, observed ${studentPreviewRows}`);
    }

    const audit2a = await verifyFreshConsumerWorkerWork('BulkStudentImport', baseline2a);
    componentWorkerAudit.BulkStudentImport = audit2a;

    recordResult(
      '2a',
      'BulkStudentImport Valid PDF Parsing',
      true,
      `${pillText.trim()} (${studentPreviewRows} preview rows), fresh worker reqs: ${audit2a.freshRequestsCount}, resps: ${audit2a.freshResponsesCount}, apiVersion: 6.4.299`
    );

    const closeBtn2a = page.locator('button[aria-label="Close"], .bulk-import-modal button:has-text("Close"), button:has-text("Cancel")');
    if (await closeBtn2a.count() > 0) await closeBtn2a.first().click();
    await page.waitForTimeout(500);

    // 2b. Corrupted fixture test
    await smartImportBtn.click();
    await importModalHeader.waitFor({ state: 'visible', timeout: 5000 });
    const studentFileInputCorrupt = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await studentFileInputCorrupt.setInputFiles(CORRUPT_PDF);

    const studentErrorBanner = page.locator('[data-testid="bulk-student-error-banner"], .bulk-import-error-banner, .bulk-import-modal .modern-modal-body div:has(svg.lucide-alert-circle) span');
    await studentErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const studentErrorText = await studentErrorBanner.first().textContent();

    if (studentErrorText.trim() === 'corrupted-header.pdf' || !studentErrorText.trim()) {
      throw new Error(`Step 2b captured filename instead of error banner: "${studentErrorText}"`);
    }

    const previewCount2b = await page.locator('.bulk-import-modal').locator('text=/[1-9]\\d*\\s+valid students found/').count();
    const enabledImportBtnCount2b = await page.locator('.bulk-import-modal button:has-text("Import"):not([disabled])').count();
    if (previewCount2b > 0) throw new Error('Step 2b: valid student preview is unexpectedly present for corrupted file');
    if (enabledImportBtnCount2b > 0) throw new Error('Step 2b: enabled import button is unexpectedly available for corrupted file');

    recordResult('2b', 'BulkStudentImport Corrupted PDF Boundary', true, studentErrorText.trim());

    const closeBtn2b = page.locator('button[aria-label="Close"], .bulk-import-modal button:has-text("Close"), button:has-text("Cancel")');
    if (await closeBtn2b.count() > 0) await closeBtn2b.first().click();
    await page.waitForTimeout(500);

    // ── STEP 3: BulkRegisteredStudentImport (Live UI Controls) ─────────────────
    console.log('\n--- Step 3: BulkRegisteredStudentImport Component via Live UI ---');
    await page.goto(`${TUNNEL_URL}/admin/additional-options?view=bulk-register`, { waitUntil: 'domcontentloaded' });

    const bulkRegTriggerBtn = page.locator('button:has-text("Bulk Upload Registered Students")');
    await bulkRegTriggerBtn.waitFor({ state: 'visible', timeout: 10000 });
    await bulkRegTriggerBtn.click();

    const bulkRegModalHeader = page.locator('text=Bulk Registered Student Import');
    await bulkRegModalHeader.waitFor({ state: 'visible', timeout: 5000 });

    const bulkRegFileInput = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await bulkRegFileInput.waitFor({ state: 'attached', timeout: 5000 });

    // 3a. Valid fixture test with fresh worker work assertion
    const baseline3a = await captureWorkerBaseline();
    await bulkRegFileInput.setInputFiles(VALID_STUDENTS_PDF);

    const regValidPill = page.locator('text=/[1-9]\\d*\\s+valid students found/');
    await regValidPill.waitFor({ state: 'visible', timeout: 15000 });
    const regPillText = await regValidPill.textContent();

    const regPreviewRows = await page.locator('[data-testid="bulk-reg-student-preview-table"] tbody tr, .bulk-import-preview-table tbody tr').count();
    if (regPreviewRows < 2) {
      throw new Error(`BulkRegisteredStudentImport: expected >= 2 preview table rows, observed ${regPreviewRows}`);
    }

    const audit3a = await verifyFreshConsumerWorkerWork('BulkRegisteredStudentImport', baseline3a);
    componentWorkerAudit.BulkRegisteredStudentImport = audit3a;

    recordResult(
      '3a',
      'BulkRegisteredStudentImport Valid PDF Parsing',
      true,
      `${regPillText.trim()} (${regPreviewRows} preview rows), fresh worker reqs: ${audit3a.freshRequestsCount}, resps: ${audit3a.freshResponsesCount}, apiVersion: 6.4.299`
    );

    // 3b. Zero-byte fixture test
    const closeBtn3a = page.locator('button[aria-label="Close"], .bulk-import-modal button:has-text("Close"), button:has-text("Cancel")');
    if (await closeBtn3a.count() > 0) await closeBtn3a.first().click();
    await page.waitForTimeout(500);

    await bulkRegTriggerBtn.click();
    await bulkRegModalHeader.waitFor({ state: 'visible', timeout: 5000 });
    const bulkRegFileInputZero = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await bulkRegFileInputZero.setInputFiles(ZERO_BYTE_PDF);

    const regZeroErrorBanner = page.locator('[data-testid="bulk-reg-student-error-banner"], .bulk-import-error-banner, .bulk-import-modal .modern-modal-body div:has(svg.lucide-alert-circle) span');
    await regZeroErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const zeroByteText = await regZeroErrorBanner.first().textContent();

    const previewCount3b = await page.locator('.bulk-import-modal').locator('text=/[1-9]\\d*\\s+valid students found/').count();
    const enabledRegisterBtnCount3b = await page.locator('.bulk-import-modal button:has-text("Register"):not([disabled]), .bulk-import-modal button:has-text("Import"):not([disabled])').count();
    if (previewCount3b > 0) throw new Error('Step 3b: valid student preview is unexpectedly present for zero-byte file');
    if (enabledRegisterBtnCount3b > 0) throw new Error('Step 3b: enabled register/import button is unexpectedly available for zero-byte file');

    recordResult('3b', 'BulkRegisteredStudentImport Zero-Byte PDF Boundary', true, zeroByteText.trim());

    const closeBtn3b = page.locator('button[aria-label="Close"], .bulk-import-modal button:has-text("Close"), button:has-text("Cancel")');
    if (await closeBtn3b.count() > 0) await closeBtn3b.first().click();
    await page.waitForTimeout(500);

    // ── STEP 4: UploadResultsModal (Live UI Controls) ──────────────────────────
    console.log('\n--- Step 4: UploadResultsModal Component via Live UI ---');
    await page.goto(`${TUNNEL_URL}/admin/batches/1`, { waitUntil: 'domcontentloaded' });

    const uploadResultsTriggerBtn = page.locator('button:has-text("Upload Results")');
    await uploadResultsTriggerBtn.waitFor({ state: 'visible', timeout: 10000 });
    await uploadResultsTriggerBtn.click();

    const resultsModalHeader = page.locator('text=Upload Exam Results');
    await resultsModalHeader.waitFor({ state: 'visible', timeout: 5000 });

    const resultsDropzone = page.locator('.modern-modal-body input[type="file"], input[type="file"]');
    await resultsDropzone.waitFor({ state: 'attached', timeout: 5000 });

    // 4a. Valid results fixture with fresh worker work assertion
    const baseline4a = await captureWorkerBaseline();
    await resultsDropzone.setInputFiles(VALID_RESULTS_PDF);

    const detectedResults = page.locator('text=/Detected Results|Abir Ahmad/i');
    await detectedResults.first().waitFor({ state: 'visible', timeout: 15000 });
    const detectedText = await detectedResults.first().textContent();

    const audit4a = await verifyFreshConsumerWorkerWork('UploadResultsModal', baseline4a);
    componentWorkerAudit.UploadResultsModal = audit4a;

    recordResult(
      '4a',
      'UploadResultsModal Valid PDF Parsing',
      true,
      `Detected: ${detectedText.trim()}, fresh worker reqs: ${audit4a.freshRequestsCount}, resps: ${audit4a.freshResponsesCount}, apiVersion: 6.4.299`
    );

    // 4b. Corrupted results fixture
    const closeBtn4a = page.locator('button[aria-label="Close"], button:has-text("Cancel")');
    if (await closeBtn4a.count() > 0) await closeBtn4a.first().click();
    await page.waitForTimeout(500);

    await uploadResultsTriggerBtn.click();
    await resultsModalHeader.waitFor({ state: 'visible', timeout: 5000 });
    const resultsDropzoneCorrupt = page.locator('.modal-container .modal-body input[type="file"], input[type="file"]');
    await resultsDropzoneCorrupt.setInputFiles(CORRUPT_PDF);

    const resultsErrorBanner = page.locator('[data-testid="upload-results-error-banner"], .results-upload-error-banner, .modal-container .modal-body div:has(strong:has-text("Upload Error")) p');
    await resultsErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const resultsErrorText = await resultsErrorBanner.first().textContent();

    if (resultsErrorText.trim().includes('Exam Failed') || resultsErrorText.trim() === 'corrupted-header.pdf' || !resultsErrorText.trim()) {
      throw new Error(`Step 4b captured unrelated background text instead of error banner: "${resultsErrorText}"`);
    }

    const detectedCount4b = await page.locator('.modal-container').locator('text=/Detected Results/i').count();
    if (detectedCount4b > 0) throw new Error('Step 4b: detected results preview unexpectedly present for corrupted file');

    const submitBtn4b = page.locator('.modal-footer button:has-text("Upload Results")');
    const isSubmitDisabled4b = (await submitBtn4b.getAttribute('disabled')) !== null;
    if (!isSubmitDisabled4b) throw new Error('Step 4b: upload results action is not disabled for corrupted file');

    recordResult('4b', 'UploadResultsModal Corrupted PDF Boundary', true, resultsErrorText.trim());

    const closeBtn4b = page.locator('button[aria-label="Close"], button:has-text("Cancel")');
    if (await closeBtn4b.count() > 0) await closeBtn4b.first().click();
    await page.waitForTimeout(500);

    // ── STEP 5: PdfViewer (Live UI Lightbox with Direct pdfjs-dist@6.4.299) ────
    console.log('\n--- Step 5: PdfViewer Component via Live Notice Board ---');
    await page.goto(`${TUNNEL_URL}/notices`, { waitUntil: 'domcontentloaded' });

    // 5a. Valid PDF Attachment Lightbox
    const validNoticeAttachment = page.locator('text=/valid-sample\\.pdf|notice_attachment\\.pdf/i');
    await validNoticeAttachment.first().waitFor({ state: 'visible', timeout: 10000 });

    const baseline5a = await captureWorkerBaseline();
    await validNoticeAttachment.first().click();

    // Verify modern direct PDF.js viewer container and toolbar mounted
    const viewerContainer = page.locator('.pdf-viewer-root');
    await viewerContainer.waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('.pdf-viewer-toolbar').waitFor({ state: 'visible', timeout: 10000 });

    // Wait for DirectPdfPage to complete rendering (data-rendered="true")
    const renderedPage = page.locator('.pdf-viewer-root .react-pdf__Page[data-rendered="true"]');
    await renderedPage.first().waitFor({ state: 'visible', timeout: 20000 });

    // Verify canvas non-zero dimensions, painted non-white pixels, and rendered text layer content
    const viewerRenderCheck = await page.evaluate(() => {
      const canvas = document.querySelector('.pdf-viewer-root .react-pdf__Page canvas');
      const textLayer = document.querySelector('.pdf-viewer-root .react-pdf__Page__textContent');
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        return { ok: false, reason: 'Canvas missing or zero dimensions' };
      }
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhitePixels = 0;
      for (let i = 0; i < img.length; i += 16) {
        if (img[i] < 250 || img[i + 1] < 250 || img[i + 2] < 250) {
          nonWhitePixels++;
        }
      }
      const textContent = textLayer ? textLayer.textContent.trim() : '';
      return {
        ok: nonWhitePixels > 50 && textContent.length > 0,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        nonWhitePixels,
        textSnippet: textContent.slice(0, 120)
      };
    });

    if (!viewerRenderCheck.ok) {
      throw new Error(`PdfViewer rendering check failed: ${JSON.stringify(viewerRenderCheck)}`);
    }

    const audit5a = await verifyFreshConsumerWorkerWork('PdfViewer', baseline5a);
    componentWorkerAudit.PdfViewer = audit5a;

    recordResult(
      '5a',
      'PdfViewer Valid PDF Rendering (Direct pdfjs-dist@6.4.299)',
      true,
      `Canvas ${viewerRenderCheck.canvasWidth}x${viewerRenderCheck.canvasHeight} (${viewerRenderCheck.nonWhitePixels} painted px), text="${viewerRenderCheck.textSnippet}", fresh worker reqs: ${audit5a.freshRequestsCount}`
    );

    // Close lightbox via Close button or Escape key, ensuring backdrop detaches
    const closeBtn5a = page.locator('button.lb-close[title="Close"], button[title="Close"]');
    if (await closeBtn5a.count() > 0) {
      await closeBtn5a.first().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.locator('.lb-backdrop').waitFor({ state: 'detached', timeout: 8000 });

    // 5b. Corrupted PDF Attachment Lightbox (Strict requirement: fixture MUST exist, no false-pass branch)
    const corruptNoticeAttachment = page.locator('text=/corrupt\\.pdf/i');
    await corruptNoticeAttachment.first().waitFor({ state: 'visible', timeout: 10000 });
    await corruptNoticeAttachment.first().click({ force: true });

    const viewerErrorBanner = page.locator('[data-testid="pdf-error-banner"], .pdf-error-banner');
    await viewerErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const viewerErrorHeading = viewerErrorBanner.first().locator('text=Failed to Load PDF');
    await viewerErrorHeading.waitFor({ state: 'visible', timeout: 10000 });
    recordResult('5b', 'PdfViewer Malformed Attachment Boundary', true, 'Handled by [data-testid="pdf-error-banner"] ("Failed to Load PDF")');

    // Close corrupted lightbox and require backdrop detachment
    const closeBtn5b = page.locator('button.lb-close[title="Close"], button[title="Close"]');
    if (await closeBtn5b.count() > 0) {
      await closeBtn5b.first().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.locator('.lb-backdrop').waitFor({ state: 'detached', timeout: 8000 });

    // ── STEP 6: Dedicated Worker, Same-Origin Asset, MIME Type & Per-Consumer Audit ──
    console.log('\n--- Step 6: Dedicated Worker, MIME Type & Per-Consumer Fresh Work Enforcement ---');
    const fakeWorkerDetected = consoleWarnings.some(w => w.includes('Setting up fake worker'));
    const hasUnexpectedPageErrors = pageErrors.length > 0;
    const workerNetOk =
      workerNetworkResponses.length > 0 &&
      workerNetworkResponses.every(r => r.status === 200 && r.sameOrigin && r.validMime);

    if (!workerNetOk) {
      throw new Error(`Worker network response validation failed: ${JSON.stringify(workerNetworkResponses)}`);
    }
    if (hasUnexpectedPageErrors) {
      throw new Error(`Unexpected page error exceptions occurred: ${JSON.stringify(pageErrors)}`);
    }

    const sampleWorkerNet = workerNetworkResponses[0];
    recordResult(
      '6a',
      'Same-Origin Hashed .mjs Worker, MIME Type & Zero Fake-Worker Fallbacks',
      !fakeWorkerDetected && !hasUnexpectedPageErrors && workerNetOk,
      `Worker: ${sampleWorkerNet.url} (status ${sampleWorkerNet.status}, MIME "${sampleWorkerNet.contentType}"), Fake workers: 0, Page errors: 0`
    );

    // Verify all 4 components independently satisfied fresh document work on pdfjs-dist@6.4.299
    const requiredConsumers = ['BulkStudentImport', 'BulkRegisteredStudentImport', 'UploadResultsModal', 'PdfViewer'];
    const allComponentsPassing = requiredConsumers.every(comp => {
      const audit = componentWorkerAudit[comp];
      return (
        audit &&
        audit.hasCompletedWork &&
        audit.freshRequestsCount >= 1 &&
        audit.freshResponsesCount >= 1 &&
        audit.allSameOriginMjsWorker &&
        audit.allVersion6_4_299 &&
        audit.allEnableXfaFalse
      );
    });

    recordResult(
      '6b',
      'Per-Consumer Fresh Worker Document Work & 6.4.299 Parameter Enforcement',
      allComponentsPassing,
      `Verified fresh work: BulkStudentImport (${componentWorkerAudit.BulkStudentImport.freshRequestsCount} req/${componentWorkerAudit.BulkStudentImport.freshResponsesCount} resp), ` +
        `BulkRegisteredStudentImport (${componentWorkerAudit.BulkRegisteredStudentImport.freshRequestsCount} req/${componentWorkerAudit.BulkRegisteredStudentImport.freshResponsesCount} resp), ` +
        `UploadResultsModal (${componentWorkerAudit.UploadResultsModal.freshRequestsCount} req/${componentWorkerAudit.UploadResultsModal.freshResponsesCount} resp), ` +
        `PdfViewer (${componentWorkerAudit.PdfViewer.freshRequestsCount} req/${componentWorkerAudit.PdfViewer.freshResponsesCount} resp)`
    );

    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log(` RESULTS: ${results.filter(r => r.passed).length}/${results.length} PASSED`);
    console.log('════════════════════════════════════════════════════════════════════════\n');

    const resultArtifactPath = process.env.STAGING_RESULTS_OUTPUT_PATH || null;
    const testSummary = {
      timestamp: new Date().toISOString(),
      tunnelUrl: TUNNEL_URL,
      targetOrigin: TARGET_ORIGIN,
      engineVersion: '6.4.299',
      overallSuccess: results.every(r => r.passed),
      exitCode: results.every(r => r.passed) ? 0 : 1,
      results,
      workerNetworkResponses,
      componentWorkerAudit,
      totalWorkersCreated: createdWorkers.length,
      totalConsoleWarnings: consoleWarnings.length,
      fakeWorkerWarningsDetected: consoleWarnings.filter(w => w.includes('Setting up fake worker')).length,
      unexpectedPageErrors: pageErrors.length
    };

    if (resultArtifactPath) {
      try {
        fs.writeFileSync(resultArtifactPath, JSON.stringify(testSummary, null, 2), 'utf8');
        console.log(`\n📄 Saved sanitized test result artifact to: ${resultArtifactPath}`);
      } catch (writeErr) {
        console.warn(`Could not write result artifact: ${writeErr.message}`);
      }
    }

    await browser.close();
    return {
      success: results.every(r => r.passed),
      results,
      workerNetworkResponses,
      componentWorkerAudit,
      workerRequests: Object.values(componentWorkerAudit).reduce((sum, a) => sum + (a ? a.freshRequestsCount : 0), 0),
      workersCreated: createdWorkers.length
    };
  } catch (err) {
    console.error('\n❌ TEST RUNNER EXCEPTION:', err);
    await browser.close();
    return {
      success: false,
      error: err.message,
      results
    };
  }
}

if (require.main === module) {
  runStagingBrowserVerification()
    .then(summary => {
      if (summary.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runStagingBrowserVerification };
