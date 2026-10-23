import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

dotenv.config();

import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  setupTestRouteProxy,
  verifyServerIsolation,
  getTestApiUrl,
  assertServerRejectionProof
} from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;
let testDraftCourseId;
let testPublishedCourseId;

test.beforeAll(async () => {
  await assertServerRejectionProof('http://127.0.0.1:3001');
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Clean any old test courses
  db.prepare("DELETE FROM course_definitions WHERE name LIKE 'Refresh Test %'").run();

  // Create a server draft course
  const draftJson = JSON.stringify({
    basics: {
      name: 'Refresh Test Saved Draft',
      type: 'workshop',
      description: 'Draft course on server for refresh test',
      duration: { value: 4, unit: 'weeks' }
    },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Draft Phase 1',
        classCount: 1,
        routine: [{ weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }],
        classes: [{ id: 'cls_draft_1', title: 'Draft Class 1', category: 'theory', mandatory: true }],
        assignments: [{ id: 'asg_draft_1', title: 'Draft Asg 1', subject: 'Directing', maxMarks: 50, passMarks: 25 }]
      }
    ],
    completionPolicy: {
      certificateEligibility: { allRequiredPhasesPassed: true, requireFeesPaid: true },
      reEnrollment: { discountEnabled: true, discountPercentage: 50 }
    }
  });

  const draftRes = db.prepare(`
    INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
    VALUES ('refresh-test-saved-draft', 'Refresh Test Saved Draft', 'workshop', 1, 'draft', 1, ?, ?, ?)
  `).run(draftJson, adminUser.id, adminUser.id);
  testDraftCourseId = draftRes.lastInsertRowid;

  // Create a server published course
  const pubJson = JSON.stringify({
    basics: {
      name: 'Refresh Test Published Course',
      type: 'filmmaking',
      description: 'Published locked course',
      duration: { value: 8, unit: 'weeks' }
    },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Published Phase 1',
        classCount: 1,
        routine: [{ weekday: 'Friday', startTime: '15:00', endTime: '17:00', timezone: 'Asia/Dhaka' }],
        classes: [{ id: 'cls_pub_1', title: 'Intro Class', category: 'theory', mandatory: true }]
      }
    ],
    completionPolicy: {
      certificateEligibility: { allRequiredPhasesPassed: true, requireFeesPaid: true }
    }
  });

  const pubRes = db.prepare(`
    INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
    VALUES ('refresh-test-published-course', 'Refresh Test Published Course', 'filmmaking', 1, 'published', 1, ?, ?, ?)
  `).run(pubJson, adminUser.id, adminUser.id);
  testPublishedCourseId = pubRes.lastInsertRowid;
});

test.afterAll(() => {
  if (db) {
    db.prepare("DELETE FROM course_definitions WHERE name LIKE 'Refresh Test %'").run();
    db.close();
  }
});

async function setupAdminAuth(page, { clearDraft = true } = {}) {
  await setupTestRouteProxy(page);
  const userPayload = {
    id: adminUser.id,
    username: adminUser.username,
    email: adminUser.email,
    role: 'admin',
    firstName: adminUser.first_name,
    lastName: adminUser.last_name
  };

  // Auto-accept any native beforeunload dialogs triggered during reload()
  page.on('dialog', dialog => dialog.accept());

  // Each call gets a unique sentinel so the clear only fires on the FIRST page load
  // within this test, not on subsequent reload() calls (addInitScript runs on each navigation).
  const sentinelVal = `${adminUser.id}_${Date.now()}_${Math.random()}`;

  return page.addInitScript(({ t, u, uid, clear, sentinel }) => {
    localStorage.setItem('token', t);
    localStorage.setItem('auth_user_cache', JSON.stringify(u));
    // Clear leftover unsaved draft ONCE per test using a unique sentinel flag.
    const sentinelKey = '__test_draft_clear_sentinel__';
    if (clear && sessionStorage.getItem(sentinelKey) !== sentinel) {
      sessionStorage.setItem(sentinelKey, sentinel);
      const key = `bfi_course_maker_unsaved_draft_${uid}`;
      localStorage.removeItem(key);
    }
  }, { t: adminToken, u: userPayload, uid: adminUser.id, clear: clearDraft, sentinel: sentinelVal });
}

test.describe('Course Maker Persistence Across Refresh Suite', () => {

  test('1. Catalog View: refresh at catalog stays in catalog mode', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Verify catalog header
    await expect(page.locator('.cm-header-title')).toHaveText('Course Maker');
    await expect(page.getByRole('button', { name: /create new course/i })).toBeVisible();

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });

    // Verify still in catalog view mode
    await expect(page.locator('.cm-header-title')).toHaveText('Course Maker');
    await expect(page.getByRole('button', { name: /create new course/i })).toBeVisible();
    expect(page.url()).not.toContain('mode=builder');
  });

  test('2. Builder Partial Fill: refresh restores entered fields and stays in builder mode', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Click Create New Course
    await page.getByRole('button', { name: /create new course/i }).click();

    // Verify builder is open and URL updated
    await expect(page.locator('.cm-section-title', { hasText: 'Course Basics' })).toBeVisible();
    expect(page.url()).toContain('mode=builder');

    // Fill course name and overview
    const courseTitle = 'Refresh Test Narrative Screenwriting';
    const overview = 'In-depth screenwriting course with three-act structure and character arcs.';
    await page.locator('input[placeholder*="Masterclass in Directing"]').fill(courseTitle);
    await page.locator('textarea[placeholder*="Brief summary"]').fill(overview);

    // Verify status indicator shows Unsaved Changes
    await expect(page.locator('.cm-status-pill--unsaved')).toBeVisible();

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });

    // Verify page reopens in builder mode with fields restored!
    await expect(page.locator('.cm-section-title', { hasText: 'Course Basics' })).toBeVisible();
    await expect(page.locator('input[placeholder*="Masterclass in Directing"]')).toHaveValue(courseTitle);
    await expect(page.locator('textarea[placeholder*="Brief summary"]')).toHaveValue(overview);
    await expect(page.locator('.cm-status-pill--unsaved')).toBeVisible();
    expect(page.url()).toContain('mode=builder');
  });

  test('3. Multi-Phase Tab: refresh at Phase 2 restores Phase 2 tab and entered phase fields', async ({ page }) => {
    await setupAdminAuth(page); // clears stale draft from test 2 by default
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Start course (clean state, no resume banner)
    await page.getByRole('button', { name: /create new course/i }).click();
    await expect(page.locator('.cm-section-title', { hasText: 'Course Basics' })).toBeVisible();

    // Change phase count to 3
    await page.getByRole('button', { name: '3', exact: true }).click();
    await expect(page.locator('.cm-phase-tab')).toHaveCount(3);

    // Switch to Phase 2
    await page.locator('.cm-phase-tab').nth(1).click();
    await expect(page.locator('.cm-phase-tab').nth(1)).toHaveClass(/active/);
    expect(page.url()).toContain('phase=2');

    // Fill Phase 2 Title
    const phase2Title = 'Visual Grammar & Scene Construction';
    const phaseTitleInput = page.locator('.cm-phase-title-input');
    await phaseTitleInput.fill(phase2Title);

    // Edit the class title in Phase 2 using the actual placeholder text
    // The class card input has placeholder "e.g. Master Shot & Reverse Angles"
    const classTitleInput = page.locator('input[placeholder*="Master Shot"]').first();
    await classTitleInput.fill('Three-Point Lighting Setup');

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });

    // Verify Phase 2 tab is still active!
    await expect(page.locator('.cm-phase-tab').nth(1)).toHaveClass(/active/);
    expect(page.url()).toContain('phase=2');

    // Verify Phase 2 title and class title are restored!
    await expect(page.locator('.cm-phase-title-input')).toHaveValue(phase2Title);
    await expect(page.locator('input[placeholder*="Master Shot"]').first()).toHaveValue('Three-Point Lighting Setup');
  });

  test('4. Review Screen: refresh restores review mode, summary card, and validation status', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Start course
    await page.getByRole('button', { name: /create new course/i }).click();

    // Enter a valid title
    const reviewCourseTitle = 'Review Screen Refresh Course';
    await page.locator('input[placeholder*="Masterclass in Directing"]').fill(reviewCourseTitle);

    // Navigate to Review screen
    await page.getByRole('button', { name: /review rules before publishing/i }).click();

    // Verify on Review screen
    await expect(page.locator('h2', { hasText: 'Summary & Pre-Publish Review' })).toBeVisible();
    await expect(page.locator('.cm-card-subtle h3')).toHaveText(reviewCourseTitle);
    expect(page.url()).toContain('mode=review');

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });

    // Verify restored directly on Review screen!
    await expect(page.locator('h2', { hasText: 'Summary & Pre-Publish Review' })).toBeVisible();
    await expect(page.locator('.cm-card-subtle h3')).toHaveText(reviewCourseTitle);
    expect(page.url()).toContain('mode=review');
  });

  test('5. Saved Server Draft Edit: loads draft from server, restores modifications across refresh', async ({ page }) => {
    await setupAdminAuth(page);
    // Navigate directly to the saved server draft via URL
    await page.goto(`admin/course-maker?mode=builder&draftId=${testDraftCourseId}`, { waitUntil: 'networkidle' });

    // Verify loaded from server draft
    await expect(page.locator('input[placeholder*="Masterclass in Directing"]')).toHaveValue('Refresh Test Saved Draft');

    // Make an unsaved edit
    await page.locator('input[placeholder*="Masterclass in Directing"]').fill('Refresh Test Saved Draft - Modified');
    await expect(page.locator('.cm-status-pill--unsaved')).toBeVisible();

    // Refresh
    await page.reload({ waitUntil: 'networkidle' });

    // Verify restored with unsaved modification intact
    await expect(page.locator('input[placeholder*="Masterclass in Directing"]')).toHaveValue('Refresh Test Saved Draft - Modified');
    expect(page.url()).toContain(`draftId=${testDraftCourseId}`);
  });

  test('6. Discard Unsaved Draft: modal confirmation clears storage and resets form', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Create course and fill data
    await page.getByRole('button', { name: /create new course/i }).click();
    await page.locator('input[placeholder*="Masterclass in Directing"]').fill('Temporary Course to Discard');

    // Click Discard Draft in header
    await page.locator('.cm-btn-discard').first().click();

    // Verify Discard Modal is visible
    await expect(page.locator('h3', { hasText: 'Discard Course Draft?' })).toBeVisible();

    // Click "Keep Editing" -> cancels discard
    await page.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(page.locator('h3', { hasText: 'Discard Course Draft?' })).not.toBeVisible();
    await expect(page.locator('input[placeholder*="Masterclass in Directing"]')).toHaveValue('Temporary Course to Discard');

    // Click Discard again and confirm
    await page.locator('.cm-btn-discard').first().click();
    await page.locator('.cm-btn-confirm-discard').click();

    // Verify navigated to catalog view
    await expect(page.locator('.cm-header-title')).toHaveText('Course Maker');
    expect(page.url()).not.toContain('mode=builder');
  });

  test('7. Graceful Handling: invalid draftId falls back to catalog', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto('admin/course-maker?mode=builder&draftId=9999999', { waitUntil: 'networkidle' });

    // Verify toast error and redirected to catalog mode
    await expect(page.locator('.cm-header-title')).toHaveText('Course Maker');
    expect(page.url()).not.toContain('draftId=9999999');
  });

  test('8. Graceful Handling: published course draftId falls back to catalog', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto(`admin/course-maker?mode=builder&draftId=${testPublishedCourseId}`, { waitUntil: 'networkidle' });

    // Verify locked notice and returned to catalog
    await expect(page.locator('.cm-header-title')).toHaveText('Course Maker');
    expect(page.url()).not.toContain(`draftId=${testPublishedCourseId}`);
  });

  test('9. Mobile Viewport (375px): verify refresh persistence, status pill, and discard modal', async ({ page }) => {
    await setupAdminAuth(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Start course on mobile
    await page.getByRole('button', { name: /create new course/i }).click();

    const mobileTitle = 'Mobile Refresh Persistence Workshop';
    await page.locator('input[placeholder*="Masterclass in Directing"]').fill(mobileTitle);

    // Refresh on mobile
    await page.reload({ waitUntil: 'networkidle' });

    // Verify restored on mobile
    await expect(page.locator('input[placeholder*="Masterclass in Directing"]')).toHaveValue(mobileTitle);
    await expect(page.locator('.cm-status-pill--unsaved')).toBeVisible();

    // Test discard on mobile
    await page.locator('.cm-btn-discard').first().click();
    await expect(page.locator('h3', { hasText: 'Discard Course Draft?' })).toBeVisible();
    await page.locator('.cm-btn-confirm-discard').click();

    // Back in catalog on mobile
    await expect(page.locator('.cm-header-title')).toHaveText('Course Maker');
  });

  test('10. Browser Back & Forward: predictable navigation between builder, review, and tabs', async ({ page }) => {
    await setupAdminAuth(page);
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Start course -> URL has mode=builder&phase=1
    await page.getByRole('button', { name: /create new course/i }).click();
    await expect(page.locator('.cm-section-title', { hasText: 'Course Basics' })).toBeVisible();

    // Enter title
    await page.locator('input[placeholder*="Masterclass in Directing"]').fill('History Navigation Workshop');

    // Navigate to Review -> URL has mode=review
    await page.getByRole('button', { name: /review rules before publishing/i }).click();
    await expect(page.locator('h2', { hasText: 'Summary & Pre-Publish Review' })).toBeVisible();
    expect(page.url()).toContain('mode=review');

    // Click Browser Back button -> returns to Builder!
    await page.goBack();
    await expect(page.locator('.cm-section-title', { hasText: 'Course Basics' })).toBeVisible();
    await expect(page.locator('input[placeholder*="Masterclass in Directing"]')).toHaveValue('History Navigation Workshop');

    // Click Browser Forward button -> returns to Review!
    await page.goForward();
    await expect(page.locator('h2', { hasText: 'Summary & Pre-Publish Review' })).toBeVisible();
  });
});
