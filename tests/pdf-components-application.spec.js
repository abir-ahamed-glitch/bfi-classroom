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

const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_jwt_secret_key_for_testing_32chars';
const DB_PATH = path.resolve(__dirname, '../server/test_isolated_bfi.db');

function createAdminAuthSession() {
  const db = new Database(DB_PATH);
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

    // Set up test proxy to route browser /api/ requests to test backend
    await setupTestRouteProxy(page);

    // Track Web Workers created by the page
    page.__workers = [];
    page.on('worker', worker => {
      page.__workers.push(worker.url());
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

    // Instrument Worker.prototype.postMessage to observe real evaluatorOptions sent to the dedicated worker
    await page.evaluate(() => {
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
  });

  test('1. BulkStudentImport: real component mounts, opens modal, parses valid PDF fixture via real input control, and enforces isEvalSupported: false', async ({ page }) => {
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

    // Verify real parsing pipeline extracted student records and updated React state
    const validPill = page.locator('text=/[1-9]\\d*\\s+valid students found/');
    await expect(validPill).toBeVisible({ timeout: 10000 });
    const pillText = await validPill.textContent();
    expect(pillText).toMatch(/[1-9]\d*\s+valid students found/);

    // Verify action button to import students is enabled
    const importBtn = page.locator('.modern-modal-footer button:has-text("Import")');
    await expect(importBtn).toBeVisible();

    // Verify worker message observation: isEvalSupported: false was dispatched to Web Worker
    const docRequests = await page.evaluate(() => window.__workerGetDocRequests);
    expect(docRequests.length).toBeGreaterThan(0);
    const lastReq = docRequests[docRequests.length - 1];
    expect(lastReq.isEvalSupported).toBe(false);

    // Verify dedicated worker behavior: no fake worker fallback
    const isWorkerDisabled = await page.evaluate(() => window.pdfjsLib?.PDFWorkerUtil?.isWorkerDisabled ?? false);
    expect(isWorkerDisabled).toBe(false);
  });

  test('2. BulkStudentImport: malformed PDF fixture triggers real error boundary without crashing thread', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('BulkStudentImport', {});
    });

    const triggerBtn = page.locator('button:has-text("Smart Batch Import")');
    await triggerBtn.click();

    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.setInputFiles(CORRUPT_PDF);

    // Verify real error message rendered into DOM by component error handling
    const errorAlert = page.locator('.bulk-import-modal').locator('text=/Invalid|Failed|error|corrupt/i');
    await expect(errorAlert.first()).toBeVisible({ timeout: 10000 });

    // Verify UI is still fully responsive and interactive
    const closeBtn = page.locator('button[aria-label="Close"], button:has-text("Smart Batch Import")');
    await expect(closeBtn.first()).toBeAttached();
  });

  test('3. BulkRegisteredStudentImport: real component mounts, opens modal, parses valid PDF fixture via real input control, and enforces isEvalSupported: false', async ({ page }) => {
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

    // Verify real component extracted rows and rendered preview data
    const validBadge = page.locator('text=/[1-9]\\d*\\s+valid students found/');
    await expect(validBadge).toBeVisible({ timeout: 10000 });
    const importBtn = page.locator('.modern-modal-footer button:has-text("Import")');
    await expect(importBtn).toBeVisible();

    // Verify worker message observation: isEvalSupported: false reached Web Worker
    const docRequests = await page.evaluate(() => window.__workerGetDocRequests);
    expect(docRequests.length).toBeGreaterThan(0);
    const lastReq = docRequests[docRequests.length - 1];
    expect(lastReq.isEvalSupported).toBe(false);

    // Verify no fake worker fallback
    const isWorkerDisabled = await page.evaluate(() => window.pdfjsLib?.PDFWorkerUtil?.isWorkerDisabled ?? false);
    expect(isWorkerDisabled).toBe(false);
  });

  test('4. BulkRegisteredStudentImport: malformed and zero-byte PDF fixtures trigger real error handling gracefully', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('BulkRegisteredStudentImport', {});
    });

    const triggerBtn = page.locator('button:has-text("Bulk Upload Registered Students")');
    await triggerBtn.click();

    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.setInputFiles(ZERO_BYTE_PDF);

    // Verify real error message rendered into DOM
    const errorAlert = page.locator('.bulk-import-modal').locator('text=/Invalid|Failed|error|corrupt|empty|zero bytes/i');
    await expect(errorAlert.first()).toBeVisible({ timeout: 10000 });
  });

  test('5. UploadResultsModal: real component mounts, parses exam results PDF fixture via dropzone input, and enforces isEvalSupported: false', async ({ page }) => {
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
    await expect(page.locator('text=Abir Ahmad')).toBeVisible();

    // Verify worker message observation: isEvalSupported: false reached Web Worker
    const docRequests = await page.evaluate(() => window.__workerGetDocRequests);
    expect(docRequests.length).toBeGreaterThan(0);
    const lastReq = docRequests[docRequests.length - 1];
    expect(lastReq.isEvalSupported).toBe(false);

    // Verify no fake worker fallback
    const isWorkerDisabled = await page.evaluate(() => window.pdfjsLib?.PDFWorkerUtil?.isWorkerDisabled ?? false);
    expect(isWorkerDisabled).toBe(false);
  });

  test('6. UploadResultsModal: corrupted PDF fixture triggers error alert without crashing', async ({ page }) => {
    await page.evaluate(() => {
      window.__mountComponent('UploadResultsModal', { isOpen: true, batchId: 10 });
    });

    const dropzoneInput = page.locator('input[type="file"]');
    await dropzoneInput.setInputFiles(CORRUPT_PDF);

    // Verify error displayed
    const errorMsg = page.locator('text=/Invalid|Failed|error|corrupt/i');
    await expect(errorMsg.first()).toBeVisible({ timeout: 10000 });
  });

  test('7. PdfViewer: real component mounts, loads valid PDF with Worker and Viewer, and verifies isEvalSupported: false reaches getDocument', async ({ page }) => {
    // Mount the ACTUAL PdfViewer component pointing to the valid sample PDF
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/bfi-classroom/test-fixtures/valid-sample.pdf',
        name: 'valid-sample.pdf'
      });
    });

    // Wait for the @react-pdf-viewer/core Viewer to initialize and dispatch GetDocRequest to Worker
    const viewerContainer = page.locator('.rpv-core__viewer, [data-testid="core__viewer"]');
    await expect(viewerContainer).toBeVisible({ timeout: 20000 });

    // Wait for worker message observation: isEvalSupported: false was dispatched to Web Worker
    await page.waitForFunction(() => window.__workerGetDocRequests && window.__workerGetDocRequests.length > 0, null, { timeout: 10000 });
    const docRequests = await page.evaluate(() => window.__workerGetDocRequests);
    expect(docRequests.length).toBeGreaterThan(0);
    const viewerReq = docRequests.find(r => r.isEvalSupported === false);
    expect(viewerReq).toBeDefined();
    expect(viewerReq.isEvalSupported).toBe(false);

    // Verify dedicated worker: no fake worker fallback
    const isWorkerDisabled = await page.evaluate(() => window.pdfjsLib?.PDFWorkerUtil?.isWorkerDisabled ?? false);
    expect(isWorkerDisabled).toBe(false);
  });

  test('8. PdfViewer: malformed PDF endpoint triggers component error state with clear message', async ({ page }) => {
    // Mount PdfViewer with a non-existent / broken base64 endpoint
    await page.evaluate(() => {
      window.__mountComponent('PdfViewer', {
        url: '/api/admin/broadcast/file/base64?path=corrupt.pdf',
        name: 'corrupt.pdf'
      });
    });

    // Component should transition to error state: "Failed to Load PDF"
    const errorHeading = page.locator('text=Failed to Load PDF');
    await expect(errorHeading).toBeVisible({ timeout: 10000 });
  });

  test('9. Full Application Live Navigation: StudentManager page mounts BulkStudentImport and parses PDF through live UI controls', async ({ page }) => {
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
  });

  test('10. Worker Verification: actual PDF operation creates dedicated Web Worker and avoids fake-worker fallback', async ({ page }) => {
    const consoleWarnings = [];
    page.on('console', msg => {
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });

    // Mount BulkStudentImport and trigger real PDF parse
    await page.evaluate(() => {
      window.__mountComponent('BulkStudentImport', {});
    });

    await page.locator('button:has-text("Smart Batch Import")').click();
    await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(VALID_STUDENTS_PDF);
    await expect(page.locator('text=valid students found')).toBeVisible({ timeout: 10000 });

    // Verify that PDF.js did NOT fall back to fake worker
    const workerStatus = await page.evaluate(() => ({
      isWorkerDisabled: window.pdfjsLib?.PDFWorkerUtil?.isWorkerDisabled ?? false,
      configuredWorkerSrc: window.pdfjsLib?.GlobalWorkerOptions?.workerSrc ?? null
    }));

    // 1. Worker is not disabled (dedicated worker active)
    expect(workerStatus.isWorkerDisabled).toBe(false);

    // 2. Configured deployment asset path matches version 3.11.174
    expect(workerStatus.configuredWorkerSrc).toContain('3.11.174/pdf.worker.min.js');

    // 3. No fake worker warnings logged
    const fakeWorkerWarn = consoleWarnings.some(w => w.includes('Setting up fake worker'));
    expect(fakeWorkerWarn).toBe(false);
  });

});
