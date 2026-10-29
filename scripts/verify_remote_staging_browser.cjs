/**
 * Remote Staging Application-Level PDF Browser Verification Script
 * 
 * Executes local Chromium against the isolated Linux ARM64 staging server via local SSH tunnel (127.0.0.1:3002).
 * Exercises actual compiled application pages and UI controls:
 *   - UI Authentication (/bfi-classroom/admin/login)
 *   - BulkStudentImport (/bfi-classroom/admin/studentsmanager -> "Smart Batch Import")
 *   - BulkRegisteredStudentImport (/bfi-classroom/admin/additional-options?view=bulk-register -> "Bulk Upload Registered Students")
 *   - UploadResultsModal (/bfi-classroom/admin/batches/1 -> "Upload Results")
 *   - PdfViewer (/bfi-classroom/notices -> Lightbox attachment viewer)
 * 
 * Verifies:
 *   1. Dedicated Web Worker instantiated (zero fake worker warnings)
 *   2. isEvalSupported: false parameter reaches Web Worker on every getDocument call
 *   3. Real application error boundaries handle corrupted and empty files gracefully
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TUNNEL_URL = 'http://127.0.0.1:3002/bfi-classroom';
const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/pdf');
const VALID_STUDENTS_PDF = path.join(FIXTURES_DIR, 'valid-students.pdf');
const VALID_RESULTS_PDF = path.join(FIXTURES_DIR, 'valid-results.pdf');
const VALID_SAMPLE_PDF = path.join(FIXTURES_DIR, 'valid-sample.pdf');
const CORRUPT_PDF = path.join(FIXTURES_DIR, 'corrupted-header.pdf');
const ZERO_BYTE_PDF = path.join(FIXTURES_DIR, 'zero-byte.pdf');

// Resolve staging credentials safely without hardcoding or committing secrets
let STAGING_USER = process.env.STAGING_ADMIN_USER || 'admin@staging-admin';
let STAGING_PASS = process.env.STAGING_ADMIN_PASSWORD;

if (!STAGING_PASS) {
  const localCredFile = path.resolve(__dirname, '../.staging_admin_creds.json');
  if (fs.existsSync(localCredFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(localCredFile, 'utf8'));
      if (parsed.password) STAGING_PASS = parsed.password;
      if (parsed.username) STAGING_USER = parsed.username;
    } catch (_) {}
  }
}

if (!STAGING_PASS) {
  throw new Error('STAGING_ADMIN_PASSWORD is required via process.env or .staging_admin_creds.json');
}

async function runStagingBrowserVerification() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(' REMOTE STAGING BROWSER INTEGRATION SUITE');
  console.log(` Target URL: ${TUNNEL_URL}`);
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

  // Track console warnings (specifically fake worker warnings)
  const consoleWarnings = [];
  const consoleErrors = [];
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
      if (!text.includes('Failed to load resource') && !text.includes('corrupt.pdf')) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', err => {
    console.error('  [PAGE ERROR EXCEPTION]:', err.message);
  });

  // Track Web Workers
  const createdWorkers = [];
  page.on('worker', worker => {
    createdWorkers.push(worker.url());
    console.log(`  🧵 [Web Worker Created]: ${worker.url()}`);
  });

  // Inject worker message instrumentation into page before scripts execute
  await page.addInitScript(() => {
    // Mock Turnstile verification callback for isolated staging loopback test
    window.turnstile = {
      render: (container, options) => {
        if (options && options.callback) {
          setTimeout(() => options.callback('staging-turnstile-token'), 50);
        }
        return 'mock-widget-id';
      },
      getResponse: () => 'staging-turnstile-token',
      reset: () => {}
    };

    // Instrument Worker.prototype.postMessage to observe real evaluatorOptions sent to the dedicated worker
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

  const componentWorkerAudit = {
    BulkStudentImport: { dedicatedWorkerCreated: false, requestsCount: 0, allEvalFalse: false, freshRequests: [] },
    BulkRegisteredStudentImport: { dedicatedWorkerCreated: false, requestsCount: 0, allEvalFalse: false, freshRequests: [] },
    UploadResultsModal: { dedicatedWorkerCreated: false, requestsCount: 0, allEvalFalse: false, freshRequests: [] },
    PdfViewer: { dedicatedWorkerCreated: false, requestsCount: 0, allEvalFalse: false, freshRequests: [] }
  };

  const results = [];
  function recordResult(step, name, passed, details = '') {
    results.push({ step, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${step}] ${mark}: ${name} ${details ? `(${details})` : ''}`);
  }

  try {
    // ── STEP 1: UI Authentication via Remote Staging Login Form ───────────────
    console.log('\n--- Step 1: Remote Staging UI Authentication ---');
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

    // Ensure login inputs are present
    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');
    const submitBtn = page.locator('button[type="submit"]');

    await usernameInput.fill(STAGING_USER);
    await passwordInput.fill(STAGING_PASS);

    // Wait a brief tick for Turnstile token to attach
    await page.waitForTimeout(300);
    await submitBtn.click();

    // Verify successful login navigation to admin area
    try {
      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
    } catch (urlErr) {
      const alertMsg = await page.locator('.error-alert').textContent().catch(() => 'no alert');
      throw new Error(`Login navigation failed: ${urlErr.message}. Page alert: ${alertMsg}`);
    }
    const currentUrl = page.url();
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const isAuthSuccess = Boolean(token && token.length > 50);
    recordResult('1', 'Remote Staging Form Authentication', isAuthSuccess, `Redirected to ${currentUrl}`);

    // ── STEP 2: BulkStudentImport (Live UI Controls) ───────────────────────────
    console.log('\n--- Step 2: BulkStudentImport Component via Live UI ---');
    await page.goto(`${TUNNEL_URL}/admin/studentsmanager`, { waitUntil: 'domcontentloaded' });

    // Open modal via real UI button
    const smartImportBtn = page.locator('button:has-text("Smart Batch Import")');
    await smartImportBtn.waitFor({ state: 'visible', timeout: 10000 });
    await smartImportBtn.click();

    const importModalHeader = page.locator('text=Bulk Student Import');
    await importModalHeader.waitFor({ state: 'visible', timeout: 5000 });

    // Locate real file input
    const studentFileInput = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await studentFileInput.waitFor({ state: 'attached', timeout: 5000 });

    // 2a. Valid fixture test
    const workerReqCountBefore2a = await page.evaluate(() => window.__workerGetDocRequests ? window.__workerGetDocRequests.length : 0);
    const workerCountBefore2a = createdWorkers.length;
    await studentFileInput.setInputFiles(VALID_STUDENTS_PDF);

    // Wait for student preview with diagnostics
    let pillText = '';
    try {
      const studentValidPill = page.locator('text=/[1-9]\\d*\\s+valid students found/');
      await studentValidPill.waitFor({ state: 'visible', timeout: 15000 });
      pillText = await studentValidPill.textContent();
    } catch (waitErr) {
      const modalText = await page.locator('.bulk-import-modal').innerText().catch(() => 'no modal text');
      console.log('  🔍 [DIAGNOSTIC] Modal text on timeout:', modalText);
      console.log('  🔍 [DIAGNOSTIC] Worker getDoc requests so far:', await page.evaluate(() => window.__workerGetDocRequests));
      throw waitErr;
    }

    // Require fresh worker getDocument requests
    await page.waitForFunction((start) => window.__workerGetDocRequests && window.__workerGetDocRequests.length > start, workerReqCountBefore2a, { timeout: 10000 });
    const workerReqs2a = await page.evaluate(() => window.__workerGetDocRequests);
    const freshReqs2a = workerReqs2a.slice(workerReqCountBefore2a);
    const hasEvalFalse2a = freshReqs2a.length > 0 && freshReqs2a.every(r => r.isEvalSupported === false);
    const dedicatedWorker2a = createdWorkers.slice(workerCountBefore2a).some(u => u.includes('pdf.worker.min.js')) || createdWorkers.some(u => u.includes('pdf.worker.min.js'));

    componentWorkerAudit.BulkStudentImport = {
      dedicatedWorkerCreated: dedicatedWorker2a,
      requestsCount: freshReqs2a.length,
      allEvalFalse: hasEvalFalse2a,
      freshRequests: freshReqs2a
    };

    if (!dedicatedWorker2a) throw new Error('BulkStudentImport: dedicated worker not instantiated');
    if (freshReqs2a.length === 0) throw new Error('BulkStudentImport: no fresh worker getDocument requests observed');
    if (!hasEvalFalse2a) throw new Error('BulkStudentImport: isEvalSupported:false was not enforced on worker requests');

    recordResult('2a', 'BulkStudentImport Valid PDF Parsing', true, `${pillText}, worker: ${freshReqs2a.length} reqs (all isEvalSupported:false)`);

    // Close modal
    const closeBtn2a = page.locator('button[aria-label="Close"], .bulk-import-modal button:has-text("Close"), button:has-text("Cancel")');
    if (await closeBtn2a.count() > 0) await closeBtn2a.first().click();
    await page.waitForTimeout(500);

    // 2b. Corrupted fixture test
    await smartImportBtn.click();
    await importModalHeader.waitFor({ state: 'visible', timeout: 5000 });
    const studentFileInputCorrupt = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await studentFileInputCorrupt.setInputFiles(CORRUPT_PDF);

    // Scoped selector strictly targeting BulkStudentImport's authentic errorMsg banner
    const studentErrorBanner = page.locator('.bulk-import-modal .modern-modal-body div:has(svg.lucide-alert-circle) span, .bulk-import-modal div[style*="borderLeft: 4px solid"] span, .bulk-import-modal div[style*="border-left: 4px solid"] span');
    await studentErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const studentErrorText = await studentErrorBanner.first().textContent();

    // Verify it captures actual parser error text, not merely the uploaded filename
    if (studentErrorText.trim() === 'corrupted-header.pdf' || !studentErrorText.trim()) {
      throw new Error(`Step 2b captured filename instead of error banner: "${studentErrorText}"`);
    }

    // Confirm no successful preview or import action remains available
    const previewCount2b = await page.locator('.bulk-import-modal').locator('text=/[1-9]\\d*\\s+valid students found/').count();
    const importBtnCount2b = await page.locator('.bulk-import-modal button:has-text("Import")').count();
    if (previewCount2b > 0) throw new Error('Step 2b: valid student preview is unexpectedly present for corrupted file');
    if (importBtnCount2b > 0) throw new Error('Step 2b: import button is unexpectedly available for corrupted file');

    recordResult('2b', 'BulkStudentImport Corrupted PDF Boundary', true, studentErrorText.trim());

    // Close modal
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

    // 3a. Valid fixture test
    const workerReqCountBefore3a = await page.evaluate(() => window.__workerGetDocRequests ? window.__workerGetDocRequests.length : 0);
    const workerCountBefore3a = createdWorkers.length;
    await bulkRegFileInput.setInputFiles(VALID_STUDENTS_PDF);

    const regValidPill = page.locator('text=/[1-9]\\d*\\s+valid students found/');
    await regValidPill.waitFor({ state: 'visible', timeout: 15000 });
    const regPillText = await regValidPill.textContent();

    // Require fresh worker getDocument requests
    await page.waitForFunction((start) => window.__workerGetDocRequests && window.__workerGetDocRequests.length > start, workerReqCountBefore3a, { timeout: 10000 });
    const workerReqs3a = await page.evaluate(() => window.__workerGetDocRequests);
    const freshReqs3a = workerReqs3a.slice(workerReqCountBefore3a);
    const hasEvalFalse3a = freshReqs3a.length > 0 && freshReqs3a.every(r => r.isEvalSupported === false);
    const dedicatedWorker3a = createdWorkers.slice(workerCountBefore3a).some(u => u.includes('pdf.worker.min.js')) || createdWorkers.some(u => u.includes('pdf.worker.min.js'));

    componentWorkerAudit.BulkRegisteredStudentImport = {
      dedicatedWorkerCreated: dedicatedWorker3a,
      requestsCount: freshReqs3a.length,
      allEvalFalse: hasEvalFalse3a,
      freshRequests: freshReqs3a
    };

    if (!dedicatedWorker3a) throw new Error('BulkRegisteredStudentImport: dedicated worker not instantiated');
    if (freshReqs3a.length === 0) throw new Error('BulkRegisteredStudentImport: no fresh worker getDocument requests observed');
    if (!hasEvalFalse3a) throw new Error('BulkRegisteredStudentImport: isEvalSupported:false was not enforced on worker requests');

    recordResult('3a', 'BulkRegisteredStudentImport Valid PDF Parsing', true, `${regPillText}, worker: ${freshReqs3a.length} reqs (all isEvalSupported:false)`);

    // 3b. Zero-byte fixture test
    const closeBtn3a = page.locator('button[aria-label="Close"], .bulk-import-modal button:has-text("Close"), button:has-text("Cancel")');
    if (await closeBtn3a.count() > 0) await closeBtn3a.first().click();
    await page.waitForTimeout(500);

    await bulkRegTriggerBtn.click();
    await bulkRegModalHeader.waitFor({ state: 'visible', timeout: 5000 });
    const bulkRegFileInputZero = page.locator('.bulk-import-modal input[type="file"], input[type="file"][accept*=".pdf"]');
    await bulkRegFileInputZero.setInputFiles(ZERO_BYTE_PDF);

    // Scoped selector strictly targeting BulkRegisteredStudentImport's authentic errorMsg banner
    const regZeroErrorBanner = page.locator('.bulk-import-modal .modern-modal-body div:has(svg.lucide-alert-circle) span, .bulk-import-modal div[style*="borderLeft: 4px solid"] span, .bulk-import-modal div[style*="border-left: 4px solid"] span');
    await regZeroErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const zeroByteText = await regZeroErrorBanner.first().textContent();

    // Confirm no successful preview or register action remains available
    const previewCount3b = await page.locator('.bulk-import-modal').locator('text=/[1-9]\\d*\\s+valid students found/').count();
    const registerBtnCount3b = await page.locator('.bulk-import-modal button:has-text("Register")').count();
    if (previewCount3b > 0) throw new Error('Step 3b: valid student preview is unexpectedly present for zero-byte file');
    if (registerBtnCount3b > 0) throw new Error('Step 3b: register button is unexpectedly available for zero-byte file');

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

    // 4a. Valid results fixture
    const workerReqCountBefore4a = await page.evaluate(() => window.__workerGetDocRequests ? window.__workerGetDocRequests.length : 0);
    const workerCountBefore4a = createdWorkers.length;
    await resultsDropzone.setInputFiles(VALID_RESULTS_PDF);

    const detectedResults = page.locator('text=/Detected Results|Abir Ahmad/i');
    await detectedResults.first().waitFor({ state: 'visible', timeout: 15000 });
    const detectedText = await detectedResults.first().textContent();

    // Require fresh worker getDocument requests
    await page.waitForFunction((start) => window.__workerGetDocRequests && window.__workerGetDocRequests.length > start, workerReqCountBefore4a, { timeout: 10000 });
    const workerReqs4a = await page.evaluate(() => window.__workerGetDocRequests);
    const freshReqs4a = workerReqs4a.slice(workerReqCountBefore4a);
    const hasEvalFalse4a = freshReqs4a.length > 0 && freshReqs4a.every(r => r.isEvalSupported === false);
    const dedicatedWorker4a = createdWorkers.slice(workerCountBefore4a).some(u => u.includes('pdf.worker.min.js')) || createdWorkers.some(u => u.includes('pdf.worker.min.js'));

    componentWorkerAudit.UploadResultsModal = {
      dedicatedWorkerCreated: dedicatedWorker4a,
      requestsCount: freshReqs4a.length,
      allEvalFalse: hasEvalFalse4a,
      freshRequests: freshReqs4a
    };

    if (!dedicatedWorker4a) throw new Error('UploadResultsModal: dedicated worker not instantiated');
    if (freshReqs4a.length === 0) throw new Error('UploadResultsModal: no fresh worker getDocument requests observed');
    if (!hasEvalFalse4a) throw new Error('UploadResultsModal: isEvalSupported:false was not enforced on worker requests');

    recordResult('4a', 'UploadResultsModal Valid PDF Parsing', true, `Detected: ${detectedText}, worker: ${freshReqs4a.length} reqs (all isEvalSupported:false)`);

    // 4b. Corrupted results fixture
    const closeBtn4a = page.locator('button[aria-label="Close"], button:has-text("Cancel")');
    if (await closeBtn4a.count() > 0) await closeBtn4a.first().click();
    await page.waitForTimeout(500);

    await uploadResultsTriggerBtn.click();
    await resultsModalHeader.waitFor({ state: 'visible', timeout: 5000 });
    const resultsDropzoneCorrupt = page.locator('.modal-container .modal-body input[type="file"], input[type="file"]');
    await resultsDropzoneCorrupt.setInputFiles(CORRUPT_PDF);

    // Scoped selector strictly targeting UploadResultsModal's authentic errorMsg banner
    const resultsErrorBanner = page.locator('.modal-container .modal-body div:has(strong:has-text("Upload Error")) p');
    await resultsErrorBanner.first().waitFor({ state: 'visible', timeout: 15000 });
    const resultsErrorText = await resultsErrorBanner.first().textContent();

    // Verify it captures actual parser error text, not unrelated background text or filename
    if (resultsErrorText.trim().includes('Exam Failed') || resultsErrorText.trim() === 'corrupted-header.pdf' || !resultsErrorText.trim()) {
      throw new Error(`Step 4b captured unrelated background text instead of error banner: "${resultsErrorText}"`);
    }

    // Confirm no detected results table is shown and upload action is disabled
    const detectedCount4b = await page.locator('.modal-container').locator('text=/Detected Results/i').count();
    if (detectedCount4b > 0) throw new Error('Step 4b: detected results preview unexpectedly present for corrupted file');

    const submitBtn4b = page.locator('.modal-footer button:has-text("Upload Results")');
    const isSubmitDisabled4b = (await submitBtn4b.getAttribute('disabled')) !== null;
    if (!isSubmitDisabled4b) throw new Error('Step 4b: upload results action is not disabled for corrupted file');

    recordResult('4b', 'UploadResultsModal Corrupted PDF Boundary', true, resultsErrorText.trim());

    const closeBtn4b = page.locator('button[aria-label="Close"], button:has-text("Cancel")');
    if (await closeBtn4b.count() > 0) await closeBtn4b.first().click();
    await page.waitForTimeout(500);

    // ── STEP 5: PdfViewer (Live UI Lightbox) ───────────────────────────────────
    console.log('\n--- Step 5: PdfViewer Component via Live Notice Board ---');
    await page.goto(`${TUNNEL_URL}/notices`, { waitUntil: 'domcontentloaded' });

    // 5a. Valid PDF Attachment Lightbox
    const validNoticeAttachment = page.locator('text=/valid-sample\\.pdf|notice_attachment\\.pdf/i');
    await validNoticeAttachment.first().waitFor({ state: 'visible', timeout: 10000 });

    const workerReqCountBefore5a = await page.evaluate(() => window.__workerGetDocRequests ? window.__workerGetDocRequests.length : 0);
    const workerCountBefore5a = createdWorkers.length;
    await validNoticeAttachment.first().click();

    // Verify PdfViewer mounted and rendered @react-pdf-viewer/core
    const viewerContainer = page.locator('.rpv-core__viewer, [data-testid="core__viewer"]');
    await viewerContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Verify canvas rendered
    const pdfCanvas = page.locator('.rpv-core__viewer canvas');
    await pdfCanvas.first().waitFor({ state: 'visible', timeout: 15000 });

    // Require fresh worker getDocument requests
    await page.waitForFunction((start) => window.__workerGetDocRequests && window.__workerGetDocRequests.length > start, workerReqCountBefore5a, { timeout: 10000 });
    const workerReqs5a = await page.evaluate(() => window.__workerGetDocRequests);
    const freshReqs5a = workerReqs5a.slice(workerReqCountBefore5a);
    const hasEvalFalse5a = freshReqs5a.length > 0 && freshReqs5a.every(r => r.isEvalSupported === false);
    const dedicatedWorker5a = createdWorkers.slice(workerCountBefore5a).some(u => u.includes('pdf.worker.min.js')) || createdWorkers.some(u => u.includes('pdf.worker.min.js'));

    componentWorkerAudit.PdfViewer = {
      dedicatedWorkerCreated: dedicatedWorker5a,
      requestsCount: freshReqs5a.length,
      allEvalFalse: hasEvalFalse5a,
      freshRequests: freshReqs5a
    };

    if (!dedicatedWorker5a) throw new Error('PdfViewer: dedicated worker not instantiated');
    if (freshReqs5a.length === 0) throw new Error('PdfViewer: no fresh worker getDocument requests observed');
    if (!hasEvalFalse5a) throw new Error('PdfViewer: isEvalSupported:false was not enforced on worker requests');

    recordResult('5a', 'PdfViewer Valid PDF Rendering', true, 'Canvas rendered, dedicated worker confirmed with isEvalSupported:false');

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

    const viewerErrorHeading = page.locator('text=Failed to Load PDF');
    await viewerErrorHeading.waitFor({ state: 'visible', timeout: 15000 });
    recordResult('5b', 'PdfViewer Malformed Attachment Boundary', true, 'Handled by "Failed to Load PDF" boundary');

    // Close corrupted lightbox and require backdrop detachment
    const closeBtn5b = page.locator('button.lb-close[title="Close"], button[title="Close"]');
    if (await closeBtn5b.count() > 0) {
      await closeBtn5b.first().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.locator('.lb-backdrop').waitFor({ state: 'detached', timeout: 8000 });

    // ── STEP 6: Dedicated Worker & Fake-Worker Verification ────────────────────
    console.log('\n--- Step 6: Dedicated Worker & Mitigation Enforcement ---');
    const fakeWorkerDetected = consoleWarnings.some(w => w.includes('Setting up fake worker'));
    recordResult('6a', 'Zero Fake-Worker Fallbacks', !fakeWorkerDetected, `Warnings caught: ${consoleWarnings.length}, Fake workers: 0`);

    // Verify all 4 components independently satisfied dedicated-worker & isEvalSupported:false enforcement
    const allComponentsPassing = Object.entries(componentWorkerAudit).every(([comp, audit]) => {
      return audit.dedicatedWorkerCreated && audit.requestsCount >= 1 && audit.allEvalFalse;
    });
    recordResult('6b', 'Per-Component Dedicated Worker & Parameter Enforcement', allComponentsPassing,
      `Verified BulkStudentImport (${componentWorkerAudit.BulkStudentImport.requestsCount} reqs), ` +
      `BulkRegisteredStudentImport (${componentWorkerAudit.BulkRegisteredStudentImport.requestsCount} reqs), ` +
      `UploadResultsModal (${componentWorkerAudit.UploadResultsModal.requestsCount} reqs), ` +
      `PdfViewer (${componentWorkerAudit.PdfViewer.requestsCount} reqs)`
    );

    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log(` RESULTS: ${results.filter(r => r.passed).length}/${results.length} PASSED`);
    console.log('════════════════════════════════════════════════════════════════════════\n');

    // Save sanitized per-test result artifact
    const artifactDir = process.env.ARTIFACT_DIR || 'C:/Users/shahi/.gemini/antigravity/brain/8a2c550d-de2b-4cee-a467-088c18dbcc23';
    const resultArtifactPath = path.join(artifactDir, 'staging-browser-verification-results.json');
    const testSummary = {
      timestamp: new Date().toISOString(),
      tunnelUrl: TUNNEL_URL,
      overallSuccess: results.every(r => r.passed),
      exitCode: results.every(r => r.passed) ? 0 : 1,
      results,
      componentWorkerAudit,
      totalWorkersCreated: createdWorkers.length,
      totalConsoleWarnings: consoleWarnings.length,
      fakeWorkerWarningsDetected: consoleWarnings.filter(w => w.includes('Setting up fake worker')).length
    };

    try {
      if (fs.existsSync(artifactDir)) {
        fs.writeFileSync(resultArtifactPath, JSON.stringify(testSummary, null, 2), 'utf8');
        console.log(`\n📄 Saved sanitized test result artifact to: ${resultArtifactPath}`);
      }
    } catch (writeErr) {
      console.warn(`Could not write result artifact: ${writeErr.message}`);
    }

    await browser.close();
    return {
      success: results.every(r => r.passed),
      results,
      componentWorkerAudit,
      workerRequests: Object.values(componentWorkerAudit).reduce((sum, a) => sum + a.requestsCount, 0),
      workersCreated: createdWorkers.length
    };

  } catch (err) {
    console.error('\n❌ TEST RUNNER EXCEPTION:', err);
    const artifactDir = process.env.ARTIFACT_DIR || 'C:/Users/shahi/.gemini/antigravity/brain/8a2c550d-de2b-4cee-a467-088c18dbcc23';
    const resultArtifactPath = path.join(artifactDir, 'staging-browser-verification-results.json');
    try {
      if (fs.existsSync(artifactDir)) {
        fs.writeFileSync(resultArtifactPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          tunnelUrl: TUNNEL_URL,
          overallSuccess: false,
          exitCode: 1,
          error: err.message,
          results,
          componentWorkerAudit
        }, null, 2), 'utf8');
      }
    } catch (_) {}

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
