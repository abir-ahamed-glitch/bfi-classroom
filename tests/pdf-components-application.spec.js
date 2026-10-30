import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { setupTestRouteProxy } from './test-db-isolation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/pdf');
const VALID_STUDENTS_PDF = path.join(FIXTURES_DIR, 'valid-students.pdf');
const VALID_RESULTS_PDF = path.join(FIXTURES_DIR, 'valid-results.pdf');
const CORRUPT_PDF = path.join(FIXTURES_DIR, 'corrupted-header.pdf');
const ZERO_BYTE_PDF = path.join(FIXTURES_DIR, 'zero-byte.pdf');
const MULTIPAGE_PDF = path.join(FIXTURES_DIR, 'multipage-sample.pdf');

const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_jwt_secret_key_for_testing_32chars';
const DB_PATH = path.resolve(__dirname, '../server/test_isolated_bfi.db');

function createAdminAuthSession() {
  const db = new Database(DB_PATH);
  db.prepare('UPDATE users SET is_super_admin = 1 WHERE role = ?').run('admin');
  const user = db.prepare('SELECT id, username, email, role, is_super_admin, token_version FROM users WHERE role = ? LIMIT 1').get('admin');
  if (!user) throw new Error('No admin user found in test DB');

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
    VALUES (?, 'test_session_hash', '127.0.0.1', 'playwright_test', ?, datetime('now'), datetime('now'), datetime('now'))
  `).run(user.id, expiresAt);
  const sessionId = insert.lastInsertRowid;

  const token = jwt.sign({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.username,
    is_super_admin: user.is_super_admin || 1,
    isSuperAdmin: true,
    permissions: ['*'],
    type: 'access',
    sessionId,
    token_version: user.token_version || 1
  }, JWT_SECRET, { expiresIn: '1d' });

  return { token, user: { ...user, isSuperAdmin: true, permissions: ['*'] } };
}

test.describe('Real Application PDF Components & Worker Verification Suite', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept console warnings to detect fake worker fallback explicitly
    page.on('console', msg => {
      if (msg.type() === 'warning' && msg.text().includes('Setting up fake worker')) {
        console.warn('[BROWSER WARNING DETECTED]:', msg.text());
      }
    });

    page.on('pageerror', err => {
      console.error('[BROWSER PAGE ERROR]:', err);
    });

    // Set up test proxy to route browser /api/ requests to test backend
    await setupTestRouteProxy(page);

    // Track Web Workers created by the page via Playwright's native worker listener
    page.__workers = [];
    page.on('worker', worker => {
      page.__workers.push(worker.url());
    });

    // Instrument window.Worker via addInitScript BEFORE any page module loads so every dedicated worker creation,
    // GetDocRequest message, and worker response is captured without any fallback or substitution
    await page.addInitScript(() => {
      window.__createdWorkers = [];
      window.__workerGetDocRequests = [];
      window.__workerMessagesReceived = [];

      const NativeWorker = window.Worker;
      function InstrumentedWorker(scriptURL, options) {
        const urlStr = String(scriptURL);
        const instance = new NativeWorker(scriptURL, options);
        const workerRecord = {
          url: urlStr,
          type: options ? options.type : undefined,
          createdAt: Date.now(),
          messagesSent: 0,
          messagesReceived: 0,
          docRequests: []
        };
        window.__createdWorkers.push(workerRecord);

        const origPostMessage = instance.postMessage.bind(instance);
        instance.postMessage = function(msg) {
          workerRecord.messagesSent++;
          if (msg && msg.action === 'GetDocRequest' && msg.data) {
            const reqRecord = {
              workerUrl: urlStr,
              action: msg.action,
              apiVersion: msg.data.apiVersion,
              hasEnableXfaKey: 'enableXfa' in msg.data,
              enableXfa: msg.data.enableXfa,
              dataKeys: Object.keys(msg.data),
              evaluatorOptions: msg.data.evaluatorOptions,
              timestamp: Date.now()
            };
            workerRecord.docRequests.push(reqRecord);
            window.__workerGetDocRequests.push(reqRecord);
          }
          return origPostMessage.apply(instance, arguments);
        };

        instance.addEventListener('message', (event) => {
          workerRecord.messagesReceived++;
          window.__workerMessagesReceived.push({
            workerUrl: urlStr,
            action: event.data ? event.data.action : undefined,
            callbackId: event.data ? event.data.callbackId : undefined
          });
        });

        return instance;
      }
      InstrumentedWorker.prototype = NativeWorker.prototype;
      window.Worker = InstrumentedWorker;
    });

    // Navigate to the test mount harness page with retry for Windows socket buffer
    let navigated = false;
    for (let attempt = 1; attempt <= 3 && !navigated; attempt++) {
      try {
        await page.goto('/bfi-classroom/test-pdf-mount.html');
        navigated = true;
      } catch (err) {
        if (attempt === 3) throw err;
        await page.waitForTimeout(500 * attempt);
      }
    }
    await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 15000 });
  });

  test('1. BulkStudentImport: real component mounts, parses valid PDF fixture, asserts exact preview data and enabled import action', async ({ page }) => {
    // Mount the ACTUAL BulkStudentImport component
    await page.evaluate(() => {
      window.__mountComponent('BulkStudentImport', {});
    });

    // Verify trigger button rendered by the component
    const triggerBtn = page.locator('button:has-text("Smart Batch Import")');
    await expect(triggerBtn).toBeVisible({ timeout: 5000 });

    // Click trigger to open real modal
    await triggerBtn.click();

    // Verify modal rendered into DOM
    const modalHeader = page.locator('text=Bulk Student Import');
    await expect(modalHeader).toBeVisible({ timeout: 5000 });

    // Locate the actual file input control inside the modal
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await expect(fileInput).toBeAttached();

    // Upload the valid PDF fixture through real control
    await fileInput.setInputFiles(VALID_STUDENTS_PDF);

    // Verify real parsing pipeline extracted exact 3 student records
    const validPill = page.locator('text=3 valid students found');
    await expect(validPill).toBeVisible({ timeout: 10000 });

    // Assert exact preview table rows (names, emails, mobile numbers, batch)
    const previewTable = page.locator('.bulk-import-preview-table');
    await expect(previewTable).toBeVisible();
    const row1 = previewTable.locator('tbody tr:has-text("Abir Ahmad")');
    await expect(row1).toContainText('k.eye.films@gmail.com');
    await expect(row1).toContainText('01711223344');
    await expect(row1).toContainText('10');

    const row2 = previewTable.locator('tbody tr:has-text("Sadia Islam")');
    await expect(row2).toContainText('sadia@example.com');
    await expect(row2).toContainText('01811223344');

    const row3 = previewTable.locator('tbody tr:has-text("Tanvir Hossain")');
    await expect(row3).toContainText('tanvir@example.com');
    await expect(row3).toContainText('01911223344');

    // Verify action button to import students is enabled and shows exact count (3)
    const importBtn = page.locator('.modern-modal-footer button:has-text("Import 3 Students")');
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toBeEnabled();

    // Verify real dedicated worker creation, GetDocRequest options, and successful worker responses
    const workerState = await page.evaluate(() => ({
      createdWorkers: window.__createdWorkers,
      docRequests: window.__workerGetDocRequests
    }));
    expect(page.__workers.length).toBeGreaterThan(0);
    expect(workerState.createdWorkers.length).toBeGreaterThan(0);
    const lastWorker = workerState.createdWorkers[workerState.createdWorkers.length - 1];
    expect(lastWorker.url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(lastWorker.type).toBe('module');
    expect(lastWorker.messagesSent).toBeGreaterThan(0);
    expect(lastWorker.messagesReceived).toBeGreaterThan(0);

    expect(workerState.docRequests.length).toBeGreaterThan(0);
    const lastReq = workerState.docRequests[workerState.docRequests.length - 1];
    expect(lastReq.action).toBe('GetDocRequest');
    expect(lastReq.apiVersion).toBe('6.4.299');
    expect(lastReq.hasEnableXfaKey).toBe(true);
    expect(lastReq.enableXfa).toBe(false);
    expect(typeof lastReq.evaluatorOptions).toBe('object');
    expect(lastReq.evaluatorOptions).not.toBeNull();
  });

  test('2. BulkStudentImport: malformed PDF fixture triggers scoped error banner and strictly prevents submission', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('BulkStudentImport', {});
    });

    const triggerBtn = page.locator('button:has-text("Smart Batch Import")');
    await triggerBtn.click();

    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.setInputFiles(CORRUPT_PDF);

    // Assert scoped error banner is displayed
    const errorBanner = page.locator('.bulk-import-modal .bulk-import-error-banner');
    await expect(errorBanner).toBeVisible({ timeout: 10000 });
    const bannerText = await errorBanner.textContent();
    expect(bannerText).toMatch(/Invalid|Failed|error|corrupt/i);

    // Assert that the Import action button is NOT attached in DOM (submission strictly blocked)
    const importBtn = page.locator('.modern-modal-footer button:has-text("Import")');
    await expect(importBtn).not.toBeAttached();

    // Verify modal is still interactive and can be closed cleanly
    const cancelBtn = page.locator('.modern-modal-footer button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();
  });

  test('3. BulkRegisteredStudentImport: real component mounts, parses valid PDF fixture, asserts exact preview data and enabled import', async ({ page }) => {
    // Mount the ACTUAL BulkRegisteredStudentImport component
    await page.evaluate(() => {
      window.__mountComponent('BulkRegisteredStudentImport', {});
    });

    // Verify trigger button rendered by the component
    const triggerBtn = page.locator('button:has-text("Bulk Upload Registered Students")');
    await expect(triggerBtn).toBeVisible({ timeout: 5000 });

    // Click trigger to open real modal
    await triggerBtn.click();

    // Verify modal header
    const modalHeader = page.locator('text=Bulk Registered Student Import');
    await expect(modalHeader).toBeVisible({ timeout: 5000 });

    // Locate the actual file input control inside the modal
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await expect(fileInput).toBeAttached();

    // Upload the valid PDF fixture through real control
    await fileInput.setInputFiles(VALID_STUDENTS_PDF);

    // Verify real component extracted exact 3 rows and rendered preview table data
    const validBadge = page.locator('text=3 valid students found');
    await expect(validBadge).toBeVisible({ timeout: 10000 });

    const previewTable = page.locator('.bulk-import-preview-table');
    await expect(previewTable).toBeVisible();
    const row1 = previewTable.locator('tbody tr:has-text("Abir Ahmad")');
    await expect(row1).toContainText('k.eye.films@gmail.com');
    await expect(row1).toContainText('01711223344');

    const row2 = previewTable.locator('tbody tr:has-text("Sadia Islam")');
    await expect(row2).toContainText('sadia@example.com');
    await expect(row2).toContainText('01811223344');

    const row3 = previewTable.locator('tbody tr:has-text("Tanvir Hossain")');
    await expect(row3).toContainText('tanvir@example.com');
    await expect(row3).toContainText('01911223344');

    const importBtn = page.locator('.modern-modal-footer button:has-text("Import 3 Students")');
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toBeEnabled();

    // Verify real dedicated worker creation, GetDocRequest options, and worker responses
    const workerState = await page.evaluate(() => ({
      createdWorkers: window.__createdWorkers,
      docRequests: window.__workerGetDocRequests
    }));
    expect(page.__workers.length).toBeGreaterThan(0);
    expect(workerState.createdWorkers.length).toBeGreaterThan(0);
    const lastWorker = workerState.createdWorkers[workerState.createdWorkers.length - 1];
    expect(lastWorker.url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(lastWorker.messagesSent).toBeGreaterThan(0);
    expect(lastWorker.messagesReceived).toBeGreaterThan(0);

    expect(workerState.docRequests.length).toBeGreaterThan(0);
    const lastReq = workerState.docRequests[workerState.docRequests.length - 1];
    expect(lastReq.apiVersion).toBe('6.4.299');
    expect(lastReq.hasEnableXfaKey).toBe(true);
    expect(lastReq.enableXfa).toBe(false);
  });

  test('4. BulkRegisteredStudentImport: zero-byte PDF triggers scoped error banner and strictly blocks submission', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('BulkRegisteredStudentImport', {});
    });

    const triggerBtn = page.locator('button:has-text("Bulk Upload Registered Students")');
    await triggerBtn.click();

    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.setInputFiles(ZERO_BYTE_PDF);

    // Verify scoped error message rendered into DOM
    const errorBanner = page.locator('.bulk-import-modal .bulk-import-error-banner');
    await expect(errorBanner).toBeVisible({ timeout: 10000 });
    const bannerText = await errorBanner.textContent();
    expect(bannerText).toMatch(/Invalid|Failed|error|corrupt|empty|zero bytes/i);

    // Verify that import button is NOT attached in DOM
    const importBtn = page.locator('.modern-modal-footer button:has-text("Import")');
    await expect(importBtn).not.toBeAttached();
  });

  test('5. UploadResultsModal: real component mounts, parses exam results PDF fixture, asserts exact preview table data', async ({ page }) => {
    // Mount the ACTUAL UploadResultsModal component
    await page.evaluate(() => {
      window.__mountComponent('UploadResultsModal', { isOpen: true, batchId: 10 });
    });

    // Verify modal rendered into DOM
    const modalHeader = page.locator('text=Upload Exam Results');
    await expect(modalHeader).toBeVisible({ timeout: 5000 });

    // Locate dropzone input control
    const dropzoneInput = page.locator('input[type="file"]');
    await expect(dropzoneInput).toBeAttached();

    // Upload valid exam results PDF fixture
    await dropzoneInput.setInputFiles(VALID_RESULTS_PDF);

    // Verify real component parsed marks and rendered preview table
    await expect(page.locator('text=/Detected Results/i')).toBeVisible({ timeout: 10000 });
    
    // Assert exact student names, marks, and remarks in the preview table across all 3 rows
    const row1 = page.locator('table tbody tr:has-text("Abir Ahmad")');
    await expect(row1).toBeVisible();
    await expect(row1).toContainText('88');
    await expect(row1).toContainText('Pass');

    const row2 = page.locator('table tbody tr:has-text("Sadia Islam")');
    await expect(row2).toBeVisible();
    await expect(row2).toContainText('94');
    await expect(row2).toContainText('Pass');

    const row3 = page.locator('table tbody tr:has-text("Tanvir Hossain")');
    await expect(row3).toBeVisible();
    await expect(row3).toContainText('76');
    await expect(row3).toContainText('Pass');

    // Verify submit button is enabled
    const submitBtn = page.locator('button:has-text("Upload Results")');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // Verify real dedicated worker creation, GetDocRequest options, and worker responses
    const workerState = await page.evaluate(() => ({
      createdWorkers: window.__createdWorkers,
      docRequests: window.__workerGetDocRequests
    }));
    expect(page.__workers.length).toBeGreaterThan(0);
    expect(workerState.createdWorkers.length).toBeGreaterThan(0);
    const lastWorker = workerState.createdWorkers[workerState.createdWorkers.length - 1];
    expect(lastWorker.url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(lastWorker.messagesSent).toBeGreaterThan(0);
    expect(lastWorker.messagesReceived).toBeGreaterThan(0);

    expect(workerState.docRequests.length).toBeGreaterThan(0);
    const lastReq = workerState.docRequests[workerState.docRequests.length - 1];
    expect(lastReq.apiVersion).toBe('6.4.299');
    expect(lastReq.hasEnableXfaKey).toBe(true);
    expect(lastReq.enableXfa).toBe(false);
  });

  test('6. UploadResultsModal: corrupted PDF fixture triggers scoped error banner and disables submission', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('UploadResultsModal', { isOpen: true, batchId: 10 });
    });

    const dropzoneInput = page.locator('input[type="file"]');
    await dropzoneInput.setInputFiles(CORRUPT_PDF);

    // Verify scoped error displayed
    const errorBanner = page.locator('.results-upload-error-banner');
    await expect(errorBanner).toBeVisible({ timeout: 10000 });
    const bannerText = await errorBanner.textContent();
    expect(bannerText).toMatch(/Upload Error|Invalid|Failed|error|corrupt/i);

    // Results table should NOT be rendered
    await expect(page.locator('table tbody tr')).not.toBeAttached();
    // Submit button must be disabled to prevent submission of invalid files
    await expect(page.locator('button:has-text("Upload Results")')).toBeDisabled();
  });

  test('7. PdfViewer: completed canvas rendering, non-zero dimensions, and expected text content layer verification', async ({ page }) => {
    // Mount the ACTUAL PdfViewer component pointing to the valid sample PDF
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/valid-sample.pdf',
        name: 'valid-sample.pdf'
      });
    });

    // 1. Assert Document container is rendered
    const viewerContainer = page.locator('.react-pdf__Document');
    await expect(viewerContainer).toBeVisible({ timeout: 20000 });

    // 2. Assert canvas element is rendered, has positive physical dimensions, and painted non-blank pixel data
    const canvas = page.locator('.react-pdf__Page canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(200);
    expect(box.height).toBeGreaterThan(200);

    const canvasPaintMetrics = await page.evaluate(() => {
      const c = document.querySelector('.react-pdf__Page canvas');
      if (!c || c.width === 0 || c.height === 0) return { painted: false };
      const ctx = c.getContext('2d');
      const imgData = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonZeroPixels = 0;
      let nonWhitePixels = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        if (imgData[i + 3] > 0) {
          nonZeroPixels++;
          if (imgData[i] < 250 || imgData[i + 1] < 250 || imgData[i + 2] < 250) {
            nonWhitePixels++;
          }
        }
      }
      return {
        painted: nonZeroPixels > 0 && nonWhitePixels > 0,
        width: c.width,
        height: c.height,
        nonWhitePixels
      };
    });
    expect(canvasPaintMetrics.painted).toBe(true);
    expect(canvasPaintMetrics.nonWhitePixels).toBeGreaterThan(50);

    // 3. Assert text layer rendered and contains expected document text
    const textLayer = page.locator('.react-pdf__Page__textContent');
    await expect(textLayer).toBeVisible();
    await expect(textLayer).toContainText('Bangladesh Film Institute');

    // 4. Verify text selection capability in the text layer
    const selectionResult = await page.evaluate(() => {
      const textSpan = document.querySelector('.react-pdf__Page__textContent span');
      if (!textSpan) return null;
      const range = document.createRange();
      range.selectNodeContents(textSpan);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString();
    });
    expect(selectionResult).toBeTruthy();
    expect(selectionResult).toContain('Bangladesh Film Institute');

    // 5. Verify PdfViewer dedicated worker creation and GetDocRequest security options
    const workerState = await page.evaluate(() => ({
      createdWorkers: window.__createdWorkers,
      docRequests: window.__workerGetDocRequests
    }));
    expect(workerState.createdWorkers.length).toBeGreaterThan(0);
    const lastWorker = workerState.createdWorkers[workerState.createdWorkers.length - 1];
    expect(lastWorker.url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(lastWorker.messagesReceived).toBeGreaterThan(0);
    const lastReq = workerState.docRequests[workerState.docRequests.length - 1];
    expect(lastReq.apiVersion).toBe('6.4.299');
    expect(lastReq.hasEnableXfaKey).toBe(true);
    expect(lastReq.enableXfa).toBe(false);
  });

  test('8. PdfViewer: multipage navigation, page jump input, and full toolbar verification', async ({ page }) => {
    // Mount PdfViewer with 3-page document fixture
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/multipage-sample.pdf',
        name: 'multipage-sample.pdf'
      });
    });

    // Wait for Document to mount and canvas to render
    const canvas = page.locator('.react-pdf__Page canvas');
    await expect(canvas).toBeVisible({ timeout: 20000 });

    // Page counter initially shows "1 / 3"
    const pageInput = page.locator('input[aria-label="Current page number"]');
    await expect(pageInput).toHaveValue('1');
    await expect(page.locator('.pdf-viewer-toolbar')).toContainText('/ 3');

    // Assert Page 1 text content
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Alpha');

    // Navigate to Page 2 using Next › button
    const nextBtn = page.locator('button[aria-label="Next page"]');
    await nextBtn.click();
    await expect(pageInput).toHaveValue('2');
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Beta');

    // Navigate to Page 3 using Next › button
    await nextBtn.click();
    await expect(pageInput).toHaveValue('3');
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Gamma');

    // Navigate back to Page 2 using ‹ Prev button
    const prevBtn = page.locator('button[aria-label="Previous page"]');
    await prevBtn.click();
    await expect(pageInput).toHaveValue('2');
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Beta');

    // Direct jump via input field: type '1' and press Enter
    await pageInput.fill('1');
    await pageInput.press('Enter');
    await expect(pageInput).toHaveValue('1');
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Alpha');
  });

  test('9. PdfViewer: thumbnails sidebar toggle, page thumbnail rendering, and thumbnail click navigation', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/multipage-sample.pdf',
        name: 'multipage-sample.pdf'
      });
    });

    await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible({ timeout: 20000 });

    // Thumbnails sidebar is initially hidden
    await expect(page.locator('.pdf-thumbnails-sidebar')).not.toBeAttached();

    // Toggle Thumbnails sidebar open
    const thumbToggle = page.locator('button[aria-label="Toggle thumbnails sidebar"]');
    await thumbToggle.click();

    // Verify sidebar attached and rendered with 3 page thumbnail cards
    const sidebar = page.locator('.pdf-thumbnails-sidebar');
    await expect(sidebar).toBeVisible();
    const thumbCards = sidebar.locator('.pdf-thumb-card');
    await expect(thumbCards).toHaveCount(3);

    // First thumbnail should be active
    await expect(thumbCards.nth(0)).toHaveClass(/active/);

    // Click thumbnail 3 to jump directly to Page 3
    await thumbCards.nth(2).click();

    // Assert active page is now 3
    const pageInput = page.locator('input[aria-label="Current page number"]');
    await expect(pageInput).toHaveValue('3');
    await expect(page.locator('.pdf-scrollable-viewport .react-pdf__Page__textContent')).toContainText('Gamma');
    await expect(thumbCards.nth(2)).toHaveClass(/active/);

    // Close thumbnails sidebar via close button
    const closeThumbBtn = page.locator('button[aria-label="Close thumbnails sidebar"]');
    await closeThumbBtn.click();
    await expect(page.locator('.pdf-thumbnails-sidebar')).not.toBeAttached();
  });

  test('10. PdfViewer: full-document search with match navigation and customTextRenderer highlighting', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/multipage-sample.pdf',
        name: 'multipage-sample.pdf'
      });
    });

    await expect(page.locator('.react-pdf__Page canvas')).toBeVisible({ timeout: 20000 });

    // Open Search bar
    const searchToggle = page.locator('button[aria-label="Toggle in-document search"]');
    await searchToggle.click();

    const searchInput = page.locator('input[aria-label="Search term input"]');
    await expect(searchInput).toBeVisible();

    // Search for word "Gamma" which is located on Page 3
    await searchInput.fill('Gamma');
    await page.locator('button[aria-label="Find search term"]').click();

    // Verify search count shows 1 of 1 matches
    const searchCount = page.locator('.pdf-search-count');
    await expect(searchCount).toContainText('1 of 1 matches');

    // Viewer should have automatically jumped to Page 3
    const pageInput = page.locator('input[aria-label="Current page number"]');
    await expect(pageInput).toHaveValue('3');

    // Text layer should highlight "Gamma" with a mark tag
    const markTag = page.locator('.react-pdf__Page__textContent mark');
    await expect(markTag).toBeVisible();
    await expect(markTag).toHaveText('Gamma');

    // Close search bar
    const closeSearchBtn = page.locator('button[aria-label="Close search bar"]');
    await closeSearchBtn.click();
    await expect(searchInput).not.toBeAttached();
  });

  test('11. PdfViewer: whole-document print waits for delayed (>700ms) page rendering completion, retains content until afterprint, and generates multipage print PDF artifact', async ({ page }, testInfo) => {
    // Wrap PdfViewer inside a realistic restricted modal shell (height: 320px, maxHeight: 320px, overflow: hidden)
    // to verify print CSS overcomes modal height and overflow clipping
    await page.evaluate(() => {
      const slot = document.getElementById('component-slot');
      if (slot) {
        slot.style.height = '320px';
        slot.style.maxHeight = '320px';
        slot.style.overflow = 'hidden';
      }
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/multipage-sample.pdf',
        name: 'multipage-sample.pdf',
        containerStyle: { height: '100%', maxHeight: '300px' }
      });
    });

    await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible({ timeout: 20000 });

    // Verify download button has correct attributes
    const downloadLink = page.locator('a[aria-label="Download PDF"]');
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute('download', 'multipage-sample.pdf');
    await expect(downloadLink).toHaveAttribute('href', /multipage-sample\.pdf/);

    // Deliberately delay printable page rendering by 950ms (> 700ms) and intercept window.print
    await page.evaluate(() => {
      window.__printPageRenderDelayMs = 950;
      window.__printClickTime = 0;
      window.__printCalledTime = 0;
      window.__printCalled = false;
      window.__printSnapshot = null;

      window.print = () => {
        window.__printCalled = true;
        window.__printCalledTime = performance.now();
        const pages = Array.from(document.querySelectorAll('.pdf-printable-area .pdf-printable-page'));
        const pageDetails = pages.map((p, idx) => {
          const c = p.querySelector('canvas');
          let nonWhitePixels = 0;
          if (c && c.width > 0 && c.height > 0) {
            const ctx = c.getContext('2d');
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < data.length; i += 16) {
              if (data[i + 3] > 0 && (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250)) {
                nonWhitePixels++;
              }
            }
          }
          return {
            pageNumber: idx + 1,
            renderedAttr: p.getAttribute('data-print-rendered'),
            canvasWidth: c ? c.width : 0,
            canvasHeight: c ? c.height : 0,
            nonWhitePixels
          };
        });
        window.__printSnapshot = {
          elapsedMs: window.__printCalledTime - window.__printClickTime,
          pageCount: pages.length,
          pageDetails
        };
      };
    });

    // Trigger Print and record start timestamp
    const printBtn = page.locator('button[aria-label="Print full document"]');
    await page.evaluate(() => { window.__printClickTime = performance.now(); });
    await printBtn.click();

    // At 750ms (past the old 700ms timer, but before the 950ms render delay finishes),
    // assert that window.print has NOT been called early
    await page.waitForTimeout(750);
    const calledEarly = await page.evaluate(() => window.__printCalled);
    expect(calledEarly).toBe(false);

    // Wait for actual rendering completion to invoke window.print()
    await page.waitForFunction(() => window.__printCalled === true, null, { timeout: 10000 });

    const snapshot = await page.evaluate(() => window.__printSnapshot);
    expect(snapshot).not.toBeNull();
    expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(900);
    expect(snapshot.pageCount).toBe(3);
    for (const detail of snapshot.pageDetails) {
      expect(detail.renderedAttr).toBe('true');
      expect(detail.canvasWidth).toBeGreaterThan(200);
      expect(detail.canvasHeight).toBeGreaterThan(200);
      expect(detail.nonWhitePixels).toBeGreaterThan(20);
    }

    // Verify printable content remains attached while printing is active (before afterprint)
    await expect(page.locator('.pdf-printable-area .pdf-printable-page')).toHaveCount(3);

    // Generate a real multipage print artifact via Chromium page.pdf() while printable content is active
    // and inspect its page count and text content using pdfjs
    const printPdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
    const printArtifactPath = testInfo.outputPath('multipage-print-output.pdf');
    const fsMod = await import('fs');
    fsMod.writeFileSync(printArtifactPath, printPdfBuffer);

    const parsedPrintArtifact = await page.evaluate(async (pdfBytes) => {
      const task = window.__pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes), enableXfa: false });
      const doc = await task.promise;
      const numPages = doc.numPages;
      const pageTexts = [];
      for (let i = 1; i <= numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        pageTexts.push(tc.items.map(item => item.str).join(' '));
      }
      await task.destroy();
      return { numPages, pageTexts, byteLength: pdfBytes.length };
    }, Array.from(printPdfBuffer));

    expect(parsedPrintArtifact.byteLength).toBeGreaterThan(1000);
    expect(parsedPrintArtifact.numPages).toBe(3);
    expect(parsedPrintArtifact.pageTexts[0]).toContain('Alpha');
    expect(parsedPrintArtifact.pageTexts[1]).toContain('Beta');
    expect(parsedPrintArtifact.pageTexts[2]).toContain('Gamma');

    // Dispatch afterprint event and verify printable area cleans up cleanly
    await page.evaluate(() => {
      window.__printPageRenderDelayMs = 0;
      window.dispatchEvent(new Event('afterprint'));
    });
    await expect(page.locator('.pdf-printable-area')).not.toBeAttached({ timeout: 5000 });

    // Also test print cancellation and render failure handling
    await page.evaluate(() => {
      window.__printCalled = false;
      window.__printPageRenderDelayMs = 2000;
    });
    await printBtn.click();
    const cancelPrintBtn = page.locator('button[aria-label="Cancel printing"]');
    await expect(cancelPrintBtn).toBeVisible({ timeout: 3000 });
    await cancelPrintBtn.click();
    await expect(page.locator('.pdf-printable-area')).not.toBeAttached();
    const printCalledAfterCancel = await page.evaluate(() => window.__printCalled);
    expect(printCalledAfterCancel).toBe(false);

    // Test print render failure handling (blocks window.print and surfaces print error)
    await page.evaluate(() => {
      window.__printCalled = false;
      window.__printPageRenderDelayMs = 50;
      window.__simulatePrintRenderErrorPage = 2;
    });
    await printBtn.click();
    await expect(page.locator('.pdf-print-status')).toContainText(/Print preparation failed/i, { timeout: 5000 });
    const printCalledOnFailure = await page.evaluate(() => window.__printCalled);
    expect(printCalledOnFailure).toBe(false);
    await page.evaluate(() => {
      window.__simulatePrintRenderErrorPage = null;
      window.__printPageRenderDelayMs = 0;
    });
  });

  test('12. PdfViewer: zoom controls, rotation, fit-to-width, and page edge access when zoomed', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/multipage-sample.pdf',
        name: 'multipage-sample.pdf'
      });
    });

    const canvas = page.locator('.react-pdf__Page canvas');
    await expect(canvas).toBeVisible({ timeout: 20000 });

    // Click Zoom In (+) button twice
    const zoomInBtn = page.locator('button[aria-label="Zoom in"]');
    await zoomInBtn.click();
    await zoomInBtn.click();

    // Verify zoom level text updated
    const toolbar = page.locator('.pdf-viewer-toolbar');
    await expect(toolbar).toContainText('150%');

    // Click Rotate button
    const rotateBtn = page.locator('button[aria-label="Rotate clockwise"]');
    await rotateBtn.click();

    // Test access to page edges when zoomed in
    const viewport = page.locator('.pdf-scrollable-viewport');
    await page.waitForFunction(() => {
      const el = document.querySelector('.pdf-scrollable-viewport');
      return el && el.scrollHeight > el.clientHeight && el.scrollWidth > el.clientWidth;
    }, null, { timeout: 5000 });

    await viewport.evaluate(el => {
      el.scrollTop = 250;
      el.scrollLeft = 150;
    });

    const scrollMetrics = await viewport.evaluate(el => ({
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
    expect(scrollMetrics.scrollTop).toBeGreaterThan(0);
    expect(scrollMetrics.scrollLeft).toBeGreaterThan(0);

    // Click Fit to Width button
    const fitWidthBtn = page.locator('button[aria-label="Fit to width"]');
    await fitWidthBtn.click();
    await expect(fitWidthBtn).toHaveClass(/active/);
  });

  test('13. PdfViewer: responsive behavior across narrow phones, landscape, large pages, and desktop viewports', async ({ page }) => {
    // 1. Ultra-narrow phone viewport (320x568)
    await page.setViewportSize({ width: 320, height: 568 });

    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/large-landscape-sample.pdf',
        name: 'large-landscape-sample.pdf'
      });
    });

    const canvas = page.locator('.react-pdf__Page canvas');
    await expect(canvas).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('BFI Large Landscape Blueprint');

    // Assert large landscape page (1224x792) automatically fits within narrow 320px phone viewport
    const narrowBox = await canvas.boundingBox();
    expect(narrowBox.width).toBeGreaterThan(150);
    expect(narrowBox.width).toBeLessThanOrEqual(320);

    // 2. Standard phone portrait viewport (375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    const mobilePortraitBox = await canvas.boundingBox();
    expect(mobilePortraitBox.width).toBeGreaterThan(narrowBox.width);
    expect(mobilePortraitBox.width).toBeLessThanOrEqual(375);

    // Assert toolbar controls remain visible and readable on mobile
    await expect(page.locator('button[aria-label="Previous page"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Next page"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Zoom in"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Fit to width"]')).toBeVisible();

    // Test zoom and edge access on phone viewport
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.locator('button[aria-label="Zoom in"]').click();
    const viewport = page.locator('.pdf-scrollable-viewport');
    await page.waitForFunction(() => {
      const el = document.querySelector('.pdf-scrollable-viewport');
      return el && el.scrollWidth > el.clientWidth;
    }, null, { timeout: 5000 });

    const mobileEdgeScroll = await viewport.evaluate(el => {
      el.scrollLeft = 0;
      const leftEdge = el.scrollLeft;
      el.scrollLeft = el.scrollWidth;
      const rightEdge = el.scrollLeft;
      return {
        leftEdge,
        rightEdge,
        maxScrollLeft: el.scrollWidth - el.clientWidth
      };
    });
    expect(mobileEdgeScroll.leftEdge).toBe(0);
    expect(mobileEdgeScroll.rightEdge).toBeGreaterThan(0);

    // Reset to Fit Width before testing landscape resize
    await page.locator('button[aria-label="Fit to width"]').click();

    // 3. Phone landscape viewport (667x375)
    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForTimeout(300);
    const mobileLandscapeBox = await canvas.boundingBox();
    expect(mobileLandscapeBox.width).toBeGreaterThan(mobilePortraitBox.width);
    expect(mobileLandscapeBox.width).toBeLessThanOrEqual(667);

    // 4. Desktop viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const desktopBox = await canvas.boundingBox();
    expect(desktopBox.width).toBeGreaterThan(mobileLandscapeBox.width);

    // Verify text selection remains intact after responsive resizes
    const selectedText = await page.evaluate(() => {
      const span = document.querySelector('.react-pdf__Page__textContent span');
      if (!span) return '';
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString();
    });
    expect(selectedText).toContain('BFI Large Landscape Blueprint');
  });

  test('14. PdfViewer: document switching, malformed error state, and clean unmount', async ({ page }) => {
    // 1. Mount with valid multipage document
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/multipage-sample.pdf',
        name: 'multipage-sample.pdf'
      });
    });

    await expect(page.locator('.react-pdf__Page canvas')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.pdf-viewer-toolbar')).toContainText('/ 3');

    // 2. Switch document prop to single-page valid-sample.pdf
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/valid-sample.pdf',
        name: 'valid-sample.pdf'
      });
    });

    // Page count resets to 1 and new text content appears
    await expect(page.locator('.pdf-viewer-toolbar')).toContainText('/ 1');
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Bangladesh Film Institute');

    // 3. Switch to malformed / non-existent base64 endpoint
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/api/admin/broadcast/file/base64?path=corrupted.pdf',
        name: 'corrupted.pdf'
      });
    });

    // Error banner renders with clear message
    const errorBanner = page.locator('.pdf-error-banner');
    await expect(errorBanner).toBeVisible({ timeout: 10000 });
    await expect(errorBanner).toContainText('Failed to Load PDF');

    // 4. Unmount component cleanly
    await page.evaluate(() => {
      window.__unmountComponent();
    });

    await expect(page.locator('.react-pdf__Document')).not.toBeAttached();
    await expect(page.locator('.pdf-error-banner')).not.toBeAttached();
  });

  test('15. Full Application Live Navigation: StudentManager page mounts BulkStudentImport and parses PDF through live UI controls', async ({ page }) => {
    // Create authentic admin session token and set in localStorage
    const { token, user } = createAdminAuthSession();
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('auth_user_cache', JSON.stringify(user));
    }, { token, user });

    // Navigate to live application route
    await page.goto('/bfi-classroom/admin/studentsmanager');
    await page.waitForLoadState('domcontentloaded');

    // Locate and click Smart Batch Import button on the live page
    const liveTriggerBtn = page.locator('button:has-text("Smart Batch Import")');
    await expect(liveTriggerBtn).toBeVisible({ timeout: 15000 });
    await liveTriggerBtn.click();

    // Upload PDF fixture through the live modal control
    const liveFileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await expect(liveFileInput).toBeAttached();
    await liveFileInput.setInputFiles(VALID_STUDENTS_PDF);

    // Verify live preview rendered in the real application page
    const validBadge = page.locator('text=/[1-9]\\d*\\s+valid students found/');
    await expect(validBadge).toBeVisible({ timeout: 10000 });
    const importBtn = page.locator('.modern-modal-footer button:has-text("Import")');
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toBeEnabled();
  });

  test('16. Worker Verification & Negative Controls: dedicated Web Worker creation, completed work across all 4 consumers, and security option negative controls', async ({ page }) => {
    const consoleWarnings = [];
    page.on('console', msg => {
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });

    // Verify both pdfjsLib (direct) and viewer engine are loaded and aligned at version 6.4.299
    const engineMeta = await page.evaluate(() => ({
      directVersion: window.__pdfjsLib.version,
      viewerVersion: window.__reactPdfjs.version,
      directWorkerSrc: window.__pdfjsLib.GlobalWorkerOptions.workerSrc,
      viewerWorkerSrc: window.__reactPdfjs.GlobalWorkerOptions.workerSrc
    }));
    expect(engineMeta.directVersion).toBe('6.4.299');
    expect(engineMeta.viewerVersion).toBe('6.4.299');
    expect(engineMeta.directWorkerSrc).toMatch(/pdf\.worker\.min\.mjs/);
    expect(engineMeta.viewerWorkerSrc).toMatch(/pdf\.worker\.min\.mjs/);

    // Consumer 1: BulkStudentImport
    await page.evaluate(() => {
      window.__createdWorkers = [];
      window.__workerGetDocRequests = [];
      window.__mountComponent('BulkStudentImport', {});
    });
    await page.locator('button:has-text("Smart Batch Import")').click();
    await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(VALID_STUDENTS_PDF);
    await expect(page.locator('text=3 valid students found')).toBeVisible({ timeout: 10000 });
    const c1State = await page.evaluate(() => ({
      workers: window.__createdWorkers,
      reqs: window.__workerGetDocRequests
    }));
    expect(c1State.workers.length).toBeGreaterThan(0);
    expect(c1State.workers[0].url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(c1State.workers[0].messagesReceived).toBeGreaterThan(0);
    expect(c1State.reqs.length).toBeGreaterThan(0);
    expect(c1State.reqs[0].apiVersion).toBe('6.4.299');
    expect(c1State.reqs[0].hasEnableXfaKey).toBe(true);
    expect(c1State.reqs[0].enableXfa).toBe(false);

    // Consumer 2: BulkRegisteredStudentImport
    await page.evaluate(() => {
      window.__createdWorkers = [];
      window.__workerGetDocRequests = [];
      window.__mountComponent('BulkRegisteredStudentImport', {});
    });
    await page.locator('button:has-text("Bulk Upload Registered Students")').click();
    await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(VALID_STUDENTS_PDF);
    await expect(page.locator('text=3 valid students found')).toBeVisible({ timeout: 10000 });
    const c2State = await page.evaluate(() => ({
      workers: window.__createdWorkers,
      reqs: window.__workerGetDocRequests
    }));
    expect(c2State.workers.length).toBeGreaterThan(0);
    expect(c2State.workers[0].url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(c2State.workers[0].messagesReceived).toBeGreaterThan(0);
    expect(c2State.reqs.length).toBeGreaterThan(0);
    expect(c2State.reqs[0].apiVersion).toBe('6.4.299');
    expect(c2State.reqs[0].hasEnableXfaKey).toBe(true);
    expect(c2State.reqs[0].enableXfa).toBe(false);

    // Consumer 3: UploadResultsModal
    await page.evaluate(() => {
      window.__createdWorkers = [];
      window.__workerGetDocRequests = [];
      window.__mountComponent('UploadResultsModal', { isOpen: true, batchId: 10 });
    });
    await page.locator('input[type="file"]').setInputFiles(VALID_RESULTS_PDF);
    await expect(page.locator('text=/Detected Results/i')).toBeVisible({ timeout: 10000 });
    const c3State = await page.evaluate(() => ({
      workers: window.__createdWorkers,
      reqs: window.__workerGetDocRequests
    }));
    expect(c3State.workers.length).toBeGreaterThan(0);
    expect(c3State.workers[0].url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(c3State.workers[0].messagesReceived).toBeGreaterThan(0);
    expect(c3State.reqs.length).toBeGreaterThan(0);
    expect(c3State.reqs[0].apiVersion).toBe('6.4.299');
    expect(c3State.reqs[0].hasEnableXfaKey).toBe(true);
    expect(c3State.reqs[0].enableXfa).toBe(false);

    // Consumer 4: PdfViewer
    await page.evaluate(() => {
      window.__createdWorkers = [];
      window.__workerGetDocRequests = [];
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/valid-sample.pdf',
        name: 'valid-sample.pdf'
      });
    });
    await expect(page.locator('.react-pdf__Page canvas')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Bangladesh Film Institute');
    const c4State = await page.evaluate(() => ({
      workers: window.__createdWorkers,
      reqs: window.__workerGetDocRequests
    }));
    expect(c4State.workers.length).toBeGreaterThan(0);
    expect(c4State.workers[0].url).toMatch(/pdf\.worker\.min\.mjs/);
    expect(c4State.workers[0].messagesReceived).toBeGreaterThan(0);
    expect(c4State.reqs.length).toBeGreaterThan(0);
    expect(c4State.reqs[0].apiVersion).toBe('6.4.299');
    expect(c4State.reqs[0].hasEnableXfaKey).toBe(true);
    expect(c4State.reqs[0].enableXfa).toBe(false);

    // Negative Control: Verify that when enableXfa: true is passed to getDocument,
    // our worker GetDocRequest instrumentation captures enableXfa === true rather than substituting false,
    // and that absent legacy options (such as v3/v4 isEvalSupported) are observed as undefined rather than substituted with false.
    const negativeControl = await page.evaluate(async () => {
      window.__workerGetDocRequests = [];
      const resp = await fetch('/bfi-classroom/test-fixtures/valid-sample.pdf');
      const buf = await resp.arrayBuffer();
      const taskXfaEnabled = window.__pdfjsLib.getDocument({ data: new Uint8Array(buf), enableXfa: true });
      await taskXfaEnabled.promise;
      await taskXfaEnabled.destroy();

      return window.__workerGetDocRequests;
    });
    expect(negativeControl.length).toBe(1);
    expect(negativeControl[0].hasEnableXfaKey).toBe(true);
    expect(negativeControl[0].enableXfa).toBe(true);
    expect('isEvalSupported' in negativeControl[0].evaluatorOptions).toBe(false);

    // No fake worker warnings logged across any consumer
    const fakeWorkerWarn = consoleWarnings.some(w => w.includes('Setting up fake worker'));
    expect(fakeWorkerWarn).toBe(false);
  });

  test('17. PdfViewer: literal PDF text preservation (<script>, &amp;, angle brackets), regex metacharacter search, and external/internal link annotations', async ({ page }) => {
    await page.evaluate(() => {
      window.__scriptExecutedFromPdfText = false;
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/special-chars-links.pdf',
        name: 'special-chars-links.pdf'
      });
    });

    await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible({ timeout: 20000 });
    const textLayer = page.locator('.react-pdf__Page__textContent');
    await expect(textLayer).toBeVisible();

    // 1. Verify literal angle brackets, HTML-looking tags, and ampersands are preserved as literal text
    // and never parsed into actual <script> or <b> DOM elements
    await expect(textLayer).toContainText('Literal Brackets: <script>alert(1)</script> & <b>BoldTag</b> & 100 > 50 < 200');
    await expect(textLayer).toContainText('Regex Metachars: C++ [v1.2] (beta) $100.00 ^start*end? {a|b} \\path\\file');

    const domSafetyCheck = await page.evaluate(() => {
      const tl = document.querySelector('.react-pdf__Page__textContent');
      return {
        scriptElementsCount: tl ? tl.querySelectorAll('script').length : -1,
        boldElementsCount: tl ? tl.querySelectorAll('b').length : -1,
        scriptExecuted: window.__scriptExecutedFromPdfText
      };
    });
    expect(domSafetyCheck.scriptElementsCount).toBe(0);
    expect(domSafetyCheck.boldElementsCount).toBe(0);
    expect(domSafetyCheck.scriptExecuted).toBe(false);

    // 2. Open Search bar and search for HTML-looking string "<script>alert(1)</script>"
    await page.locator('button[aria-label="Toggle in-document search"]').click();
    const searchInput = page.locator('input[aria-label="Search term input"]');
    await searchInput.fill('<script>alert(1)</script>');

    const searchCount = page.locator('.pdf-search-count');
    await expect(searchCount).toContainText('1 of 1 matches');

    // Verify <mark> contains the literal text "<script>alert(1)</script>" without executing or stripping it,
    // and that surrounding literal text (" & <b>BoldTag</b> & 100 > 50 < 200") remains intact in the span
    const markTag = textLayer.locator('mark');
    await expect(markTag).toHaveCount(1);
    await expect(markTag).toHaveText('<script>alert(1)</script>');
    await expect(textLayer).toContainText('Literal Brackets: <script>alert(1)</script> & <b>BoldTag</b> & 100 > 50 < 200');
    expect(await page.evaluate(() => document.querySelectorAll('.react-pdf__Page__textContent script, .react-pdf__Page__textContent b').length)).toBe(0);

    // 3. Search for regex special characters: "[v1.2]" (appears on both Page 1 and Page 2)
    await searchInput.fill('[v1.2]');
    await expect(searchCount).toContainText('1 of 2 matches');
    await expect(textLayer.locator('mark')).toHaveText('[v1.2]');

    // Test other regex metacharacters: "$100.00", "C++", "^start*end?", "{a|b}", "\\path\\file"
    for (const regexTerm of ['$100.00', 'C++', '(beta)', '^start*end?', '{a|b}', '\\path\\file']) {
      await searchInput.fill(regexTerm);
      await expect(textLayer.locator('mark').first()).toHaveText(regexTerm);
    }

    // 4. Verify AnnotationLayer rendered external link and internal destination link on Page 1
    const annotLayer = page.locator('.react-pdf__Page__annotations');
    await expect(annotLayer).toBeVisible();
    const externalLink = annotLayer.locator('a[href="https://example.com/bfi-docs"]');
    await expect(externalLink).toBeAttached();
    await expect(externalLink).toHaveAttribute('target', '_blank');
    await expect(externalLink).toHaveAttribute('rel', /noopener/);

    // Click internal link annotation to jump to Page 2
    const internalLink = annotLayer.locator('a[data-internal-link="true"], section.linkAnnotation a').nth(1);
    await expect(internalLink).toBeAttached();
    await internalLink.click();

    // Verify viewer jumped to Page 2 and preserved literal HTML-looking text on Page 2
    const pageInput = page.locator('input[aria-label="Current page number"]');
    await expect(pageInput).toHaveValue('2');
    await expect(textLayer).toContainText('Page Two Destination: <div>&amp; raw &lt;tag&gt;</div> [v1.2] $100.00 confirmed');
    expect(await page.evaluate(() => document.querySelectorAll('.react-pdf__Page__textContent div').length)).toBe(1); // Only endOfContent div
  });

});
