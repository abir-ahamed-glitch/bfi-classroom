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
let studentToken;
let adminUser;
let testCourseDefId;
let testBatchId;

const VIEWPORTS = [
  { name: '320px-mobile-narrow', width: 320, height: 568 },
  { name: '375px-mobile-standard', width: 375, height: 812 },
  { name: '390px-mobile-modern', width: 390, height: 844 },
  { name: '844x390-mobile-landscape', width: 844, height: 390 },
  { name: '768px-tablet-portrait', width: 768, height: 1024 },
  { name: '1024px-tablet-landscape', width: 1024, height: 768 },
  { name: '1280px-laptop', width: 1280, height: 800 },
  { name: '1680px-desktop-wide', width: 1680, height: 1050 }
];

function cleanupResponsiveArtifacts(database) {
  try {
    database.prepare(`
      DELETE FROM student_phase_results 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments 
        WHERE course_name LIKE 'Resp Test%' OR course_name LIKE 'Lifecycle%' OR user_id = 99997
      )
    `).run();

    database.prepare(`
      DELETE FROM student_assignment_grades 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments 
        WHERE course_name LIKE 'Resp Test%' OR course_name LIKE 'Lifecycle%' OR user_id = 99997
      )
    `).run();

    database.prepare(`
      DELETE FROM student_course_enrollments 
      WHERE course_name LIKE 'Resp Test%' OR course_name LIKE 'Lifecycle%' OR user_id = 99997
    `).run();

    database.prepare(`
      DELETE FROM batch_students 
      WHERE student_id = 99997 
         OR batch_id IN (SELECT id FROM batches WHERE batch_name LIKE 'Resp Test%' OR batch_name LIKE 'Lifecycle%' OR slug LIKE 'resp-test%' OR slug LIKE 'lifecycle%')
    `).run();

    database.prepare(`
      DELETE FROM course_routine_audits 
      WHERE course_definition_id IN (
        SELECT id FROM course_definitions 
        WHERE slug LIKE 'resp-test%' OR slug LIKE 'lifecycle%' OR slug LIKE 'contrast-audit%'
           OR name LIKE 'Resp Test%' OR name LIKE 'Lifecycle%' OR name LIKE 'Contrast Audit%'
      )
    `).run();

    database.prepare(`
      DELETE FROM course_routine_overrides 
      WHERE course_definition_id IN (
        SELECT id FROM course_definitions 
        WHERE slug LIKE 'resp-test%' OR slug LIKE 'lifecycle%' OR slug LIKE 'contrast-audit%'
           OR name LIKE 'Resp Test%' OR name LIKE 'Lifecycle%' OR name LIKE 'Contrast Audit%'
      )
    `).run();

    database.prepare(`
      DELETE FROM batches 
      WHERE batch_name LIKE 'Resp Test%' OR batch_name LIKE 'Lifecycle%' OR batch_name LIKE 'Contrast Audit%'
         OR slug LIKE 'resp-test%' OR slug LIKE 'lifecycle%' OR slug LIKE 'contrast-audit%'
    `).run();

    database.prepare(`
      DELETE FROM course_definitions 
      WHERE slug LIKE 'resp-test%' OR slug LIKE 'lifecycle%' OR slug LIKE 'contrast-audit%'
         OR name LIKE 'Resp Test%' OR name LIKE 'Lifecycle%' OR name LIKE 'Contrast Audit%'
    `).run();

    database.prepare(`DELETE FROM users WHERE id = 99997`).run();
    database.prepare(`DELETE FROM student_profiles WHERE user_id = 99997`).run();
  } catch (err) {
    console.error('Cleanup warning:', err.message);
  }
}

async function assertNoHorizontalOverflow(page, contextDesc = '') {
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const winWidth = window.innerWidth;
    const bodyWidth = document.body.scrollWidth;
    const overflowingElements = [];

    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.right > winWidth + 2 && el.offsetWidth > 0 && el.offsetHeight > 0) {
        overflowingElements.push({
          tag: el.tagName,
          className: el.className ? String(el.className) : '',
          id: el.id || '',
          right: Math.round(rect.right),
          winWidth
        });
        if (overflowingElements.length >= 5) break;
      }
    }

    return {
      hasOverflow: docWidth > winWidth + 1 || bodyWidth > winWidth + 1,
      docWidth,
      winWidth,
      bodyWidth,
      overflowingElements
    };
  });

  if (overflow.hasOverflow) {
    console.error(`Horizontal overflow detected in [${contextDesc}]:`, JSON.stringify(overflow, null, 2));
  }
  expect(overflow.hasOverflow, `Page should not have horizontal overflow in [${contextDesc}]: docWidth=${overflow.docWidth}, winWidth=${overflow.winWidth}`).toBe(false);
}

async function getLocatorContrast(locator, isPlaceholder = false) {
  return await locator.evaluate((node, placeholder) => {
    function parseRgb(colorStr) {
      if (!colorStr) return null;
      const m = colorStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
      if (!m) return null;
      return {
        r: parseFloat(m[1]),
        g: parseFloat(m[2]),
        b: parseFloat(m[3]),
        a: m[4] !== undefined ? parseFloat(m[4]) : 1
      };
    }

    function compositeColor(fg, bg) {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a === 0) return { r: 255, g: 255, b: 255, a: 0 };
      const r = Math.round((fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a);
      const g = Math.round((fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a);
      const b = Math.round((fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a);
      return { r, g, b, a };
    }

    function getLuminance({ r, g, b }) {
      const [R, G, B] = [r, g, b].map(v => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }

    function getContrastRatio(c1, c2) {
      const L1 = getLuminance(c1);
      const L2 = getLuminance(c2);
      const lighter = Math.max(L1, L2);
      const darker = Math.min(L1, L2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const isLightMode = document.documentElement.getAttribute('data-mode') === 'light';
    const defaultBg = isLightMode ? { r: 255, g: 255, b: 255, a: 1 } : { r: 15, g: 23, b: 42, a: 1 };

    let fgStr;
    if (placeholder) {
      try {
        fgStr = window.getComputedStyle(node, '::placeholder').color;
      } catch {
        fgStr = null;
      }
      if (!fgStr || fgStr === 'rgba(0, 0, 0, 0)') {
        fgStr = window.getComputedStyle(node).color;
      }
    } else {
      fgStr = window.getComputedStyle(node).color;
    }

    const fg = parseRgb(fgStr) || (isLightMode ? { r: 15, g: 23, b: 42, a: 1 } : { r: 248, g: 250, b: 252, a: 1 });

    let curr = node;
    const bgLayers = [];
    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
      const bgStyle = window.getComputedStyle(curr).backgroundColor;
      const parsedBg = parseRgb(bgStyle);
      if (parsedBg && parsedBg.a > 0) {
        bgLayers.unshift(parsedBg);
      }
      curr = curr.parentElement;
    }

    let effectiveBg = defaultBg;
    for (const layer of bgLayers) {
      effectiveBg = compositeColor(layer, effectiveBg);
    }

    const effectiveFg = compositeColor(fg, effectiveBg);
    const ratio = Math.round(getContrastRatio(effectiveFg, effectiveBg) * 100) / 100;
    return {
      ratio,
      fg: `rgb(${effectiveFg.r}, ${effectiveFg.g}, ${effectiveFg.b})`,
      bg: `rgb(${effectiveBg.r}, ${effectiveBg.g}, ${effectiveBg.b})`,
      fontSize: window.getComputedStyle(node).fontSize,
      fontWeight: window.getComputedStyle(node).fontWeight
    };
  }, isPlaceholder);
}

async function getElementContrast(page, target, isPlaceholder = false) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target.first();
  return await getLocatorContrast(loc, isPlaceholder);
}

test.beforeAll(async () => {
  await assertServerRejectionProof('http://127.0.0.1:3001');
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  cleanupResponsiveArtifacts(db);

  // 1. Seed student
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99997, 'resp_student', 'resp_student@bfibd.org', 'test_hash', 'student', 'Responsive', 'Student', 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO student_profiles (user_id, student_id, batch_number, full_name)
    VALUES (99997, 'BFI-RS-99997', 'RT-01', 'Responsive Student')
  `).run();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  studentToken = jwt.sign(
    { id: 99997, username: 'resp_student', role: 'student', name: 'Responsive Student' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // 2. Seed published course definition
  const courseDefJson = JSON.stringify({
    slug: 'resp-test-cinematography',
    name: 'Resp Test Cinematography Workshop',
    course_type: 'workshop',
    duration: { value: 6, unit: 'weeks' },
    phase_count: 2,
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Lighting & Framing',
        classCount: 2,
        requirements: { attendanceRequired: true, minAttendancePercent: 80, completionRequired: true },
        routine: [
          { weekday: 'Friday', startTime: '15:00', endTime: '17:00', timezone: 'Asia/Dhaka' },
          { weekday: 'Saturday', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Dhaka' }
        ],
        classes: [
          { id: 'c1', title: '3-Point Lighting Setup', deliveryMode: 'live', category: 'practical', durationMinutes: 120, mandatory: true },
          { id: 'c2', title: 'Lens Focal Lengths', deliveryMode: 'recorded', category: 'theory', durationMinutes: 90, mandatory: false }
        ],
        assignments: [
          {
            id: 'asg_1',
            title: 'Chiaroscuro Portrait',
            subject: 'Cinematography & Lighting',
            instructions: 'Light a subject using key and negative fill.',
            submissionRequired: true,
            maxMarks: 50,
            passMarks: 25
          }
        ],
        exam: {
          enabled: true,
          title: 'Lighting Practical Exam',
          type: 'practical',
          maxMarks: 100,
          passMarks: 50,
          phasePassThreshold: 60
        }
      },
      {
        id: 'phase_2',
        phaseIndex: 2,
        title: 'Color Grading & Delivery',
        classCount: 1,
        requirements: { attendanceRequired: true, minAttendancePercent: 75, completionRequired: true },
        routine: [
          { weekday: 'Sunday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }
        ],
        classes: [
          { id: 'c3', title: 'DaVinci Resolve Color Management', deliveryMode: 'live', category: 'editing', durationMinutes: 120, mandatory: true }
        ],
        assignments: [
          {
            id: 'asg_2',
            title: 'Showreel Grade',
            subject: 'Post-Production',
            instructions: 'Apply Rec.709 color transform and balanced contrast.',
            submissionRequired: true,
            maxMarks: 50,
            passMarks: 25
          }
        ],
        exam: { enabled: false }
      }
    ],
    completionPolicy: {
      certificateEligibility: {
        allRequiredPhasesPassed: true,
        requireAllMandatoryClasses: true,
        requireAllMandatoryAssignments: true
      },
      reEnrollment: {
        discountEnabled: true,
        discountPercentage: 50
      }
    }
  });

  const defInsert = db.prepare(`
    INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
    VALUES ('resp-test-cinematography', 'Resp Test Cinematography Workshop', 'workshop', 2, 'published', 1, ?, ?, ?)
  `).run(courseDefJson, adminUser.id, adminUser.id);
  testCourseDefId = defInsert.lastInsertRowid;

  // 3. Seed Batch and enrollment linked to course definition
  const batchInsert = db.prepare(`
    INSERT INTO batches (batch_name, batch_number, course_name, slug, course_definition_id, course_version, status, created_by)
    VALUES ('Resp Test Batch 01', 'RT-01', 'Resp Test Cinematography Workshop', 'resp-test-batch-01', ?, 1, 'active', ?)
  `).run(testCourseDefId, adminUser.id);
  testBatchId = batchInsert.lastInsertRowid;

  db.prepare(`
    INSERT INTO batch_students (batch_id, student_id, assigned_at, assigned_by)
    VALUES (?, 99997, datetime('now'), ?)
  `).run(testBatchId, adminUser.id);

  const enrInsert = db.prepare(`
    INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id)
    VALUES (99997, 'Resp Test Cinematography Workshop', 'workshop', ?, 1, ?)
  `).run(testCourseDefId, testBatchId);
  const enrollmentId = enrInsert.lastInsertRowid;

  // Seed sample assignment grade
  db.prepare(`
    INSERT INTO student_assignment_grades (enrollment_id, assignment_id, marks_obtained, submission_status)
    VALUES (?, 'asg_1', 42, 'submitted')
  `).run(enrollmentId);
});

test.afterAll(() => {
  if (db) {
    cleanupResponsiveArtifacts(db);
    db.close();
  }
});

test.beforeEach(async ({ page }) => {
  await setupTestRouteProxy(page);
});

test.describe('Course Maker Comprehensive Responsive Suite across 8 Viewports', () => {

  test('1. Catalog View: zero overflow across all 8 viewports, captures desktop and mobile screenshots', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

      // Verify header and catalog grid are visible
      await expect(page.locator('.cm-header')).toBeVisible();
      await expect(page.locator('.cm-catalog-grid')).toBeVisible();

      // Check overflow
      await assertNoHorizontalOverflow(page, `Catalog - ${vp.name}`);

      // Capture desktop and mobile screenshots
      if (vp.name === '1280px-laptop') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-desktop.png', fullPage: false });
      }
      if (vp.name === '375px-mobile-standard') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile.png', fullPage: false });
      }
    }
  });

  test('2. Builder Workflow: 1-5 phase tabs, routine slots, class & assignment editors, captures builder screenshots', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    // Open builder
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    const newBtn = page.locator('button', { hasText: 'Create New Course' });
    await expect(newBtn).toBeVisible();
    await newBtn.click();
    await page.waitForTimeout(400);

    // Verify Course Basics controls
    const courseTitleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await expect(courseTitleInput).toBeVisible();
    await courseTitleInput.fill('Responsive Test Masterclass');

    // Test 1-5 Phase Count selection (click 5 phases)
    const phase5Btn = page.locator('.cm-phase-count-btn', { hasText: '5' });
    await expect(phase5Btn).toBeVisible();
    await phase5Btn.click();
    await page.waitForTimeout(300);

    // Verify 5 phase tabs rendered
    const phaseTabs = page.locator('.cm-phase-tab');
    await expect(phaseTabs).toHaveCount(5);

    // Click Phase 2 tab
    await phaseTabs.nth(1).click();
    await page.waitForTimeout(200);

    // Add routine slot
    const addRoutineBtn = page.locator('button', { hasText: 'Add Day / Time' });
    await expect(addRoutineBtn).toBeVisible();
    await addRoutineBtn.click();
    await page.waitForTimeout(200);

    // Add class
    const addClassBtn = page.locator('button', { hasText: 'Add Class' });
    await expect(addClassBtn).toBeVisible();
    await addClassBtn.click();
    await page.waitForTimeout(200);

    // Add assignment
    const addAsgBtn = page.locator('button', { hasText: 'Add Assignment' });
    await expect(addAsgBtn).toBeVisible();
    await addAsgBtn.click();
    await page.waitForTimeout(200);

    // Fill assignment subject and title
    const asgTitleInput = page.locator('input[placeholder="e.g. 1-Minute Scene Exercise"]').last();
    if (await asgTitleInput.isVisible()) {
      await asgTitleInput.fill('Cinematic Framing Challenge');
    }
    const asgSubjInput = page.locator('input[placeholder="Select or enter subject"]').last();
    if (await asgSubjInput.isVisible()) {
      await asgSubjInput.fill('Visual Storytelling');
    }

    // Toggle Phase Exam
    const examCheckbox = page.locator('label').filter({ hasText: 'Enable Phase Final Exam' }).locator('input[type="checkbox"]');
    if (await examCheckbox.isVisible()) {
      await examCheckbox.check();
      await page.waitForTimeout(200);
    }

    // Now test across all 8 viewports in Builder state
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);

      // Verify no horizontal overflow
      await assertNoHorizontalOverflow(page, `Builder Form - ${vp.name}`);

      // Verify touch targets on mobile
      if (vp.width <= 390) {
        const primaryBtn = page.locator('.cm-btn-primary').first();
        const box = await primaryBtn.boundingBox();
        expect(box).not.toBeNull();
        expect(box.height).toBeGreaterThanOrEqual(44);
      }

      // Capture screenshots
      if (vp.name === '320px-mobile-narrow') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-320px.png', fullPage: false });
      }
      if (vp.name === '375px-mobile-standard') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-builder.png', fullPage: false });
      }
      if (vp.name === '768px-tablet-portrait') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-tablet.png', fullPage: false });
      }
      if (vp.name === '844x390-mobile-landscape') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-landscape.png', fullPage: false });
      }
    }
  });

  test('3. Review & Publish Mode: validation banners and summary cards wrap cleanly', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Click Create New Course
    await page.locator('button', { hasText: 'Create New Course' }).click();
    await page.waitForTimeout(300);

    // Directly click Review & Publish (triggering validation warnings)
    const reviewBtn = page.locator('button', { hasText: 'Review Rules Before Publishing' });
    await reviewBtn.click();
    await page.waitForTimeout(400);

    // Verify Review container is visible
    await expect(page.locator('.cm-review-container')).toBeVisible();

    // Check overflow across viewports in Review mode
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await assertNoHorizontalOverflow(page, `Review Mode - ${vp.name}`);

      if (vp.name === '375px-mobile-standard') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-review.png', fullPage: false });
      }
    }
  });

  test('4. Routine & Audit Modal: fits viewport without overflow', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Open Routine & Audits modal on published course
    const auditBtn = page.locator('button', { hasText: 'Routine & Audits' }).first();
    await expect(auditBtn).toBeVisible();
    await auditBtn.click();
    await page.waitForTimeout(400);

    // Verify modal dialog is visible
    const modalDialog = page.locator('.cm-modal-dialog');
    await expect(modalDialog).toBeVisible();

    // Check overflow and boundaries
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await assertNoHorizontalOverflow(page, `Audit Modal - ${vp.name}`);

      if (vp.name === '375px-mobile-standard') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-audit-modal.png', fullPage: false });
      }
    }

    // Close modal
    await page.locator('.cm-btn-secondary', { hasText: 'Cancel' }).click();
  });

  test('5. Connected View: Batch Detail responsive verification', async ({ page }) => {
    const adminPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
    }, { t: adminToken, u: adminPayload });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/batchmanager/resp-test-batch-01', { waitUntil: 'networkidle' });

    // Verify Defined Course Structure section
    const structHeading = page.locator('h3', { hasText: 'Resp Test Cinematography Workshop' });
    await expect(structHeading).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Batch Detail - 375px');
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-batch-detail.png', fullPage: false });
  });

  test('6. Connected View: Student Portal responsive verification', async ({ page }) => {
    const studentPayload = {
      id: 99997,
      username: 'resp_student',
      role: 'student',
      firstName: 'Responsive',
      lastName: 'Student'
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
    }, { t: studentToken, u: studentPayload });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/bfi-classroom/student-portal', { waitUntil: 'networkidle' });

    // Verify student portal displays enrolled course and admission
    await expect(page.locator('text=Resp Test Cinematography Workshop').first()).toBeVisible();

    await assertNoHorizontalOverflow(page, 'Student Portal - 375px');
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-student-portal.png', fullPage: false });
  });

  test('7. Automated WCAG AA Contrast Audit: verifies text, controls, pills, inputs, and validation in light and dark modes', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // --- Part A: Dark Mode Contrast Audit ---
    // 1. Enter Builder mode
    await page.locator('button', { hasText: 'Create New Course' }).click();
    await page.waitForTimeout(300);

    // Initial builder state: isDirty is false, Saved status pill is visible
    const savedPillDark = page.locator('.cm-status-pill--saved');
    await expect(savedPillDark).toBeVisible();
    const savedContrastDark = await getElementContrast(page, savedPillDark);
    expect(savedContrastDark.ratio, `Dark mode saved pill contrast (${savedContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Make an edit to trigger Unsaved state
    const titleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await titleInput.fill('Contrast Audit Course');
    await page.waitForTimeout(200);

    // Verify Dark Mode Unsaved Status Pill Contrast (>= 4.5:1)
    const unsavedPillDark = page.locator('.cm-status-pill--unsaved');
    await expect(unsavedPillDark).toBeVisible();
    const unsavedContrastDark = await getElementContrast(page, unsavedPillDark);
    expect(unsavedContrastDark.ratio, `Dark mode unsaved pill contrast (${unsavedContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Verify Discard Draft Button Contrast (>= 4.5:1)
    const discardBtnDark = page.locator('.cm-btn-discard').first();
    await expect(discardBtnDark).toBeVisible();
    const discardContrastDark = await getElementContrast(page, discardBtnDark);
    expect(discardContrastDark.ratio, `Dark mode discard button contrast (${discardContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Verify Input Placeholder Contrast in Dark Mode (>= 4.5:1)
    const overviewTextarea = page.locator('.cm-textarea');
    const placeholderContrastDark = await getElementContrast(page, overviewTextarea, true);
    expect(placeholderContrastDark.ratio, `Dark mode placeholder contrast (${placeholderContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Verify Active Phase Tab Contrast in Dark Mode (>= 4.5:1)
    const activeTabDark = page.locator('.cm-phase-tab.active');
    const activeTabContrastDark = await getElementContrast(page, activeTabDark);
    expect(activeTabContrastDark.ratio, `Dark mode active tab contrast (${activeTabContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Go to Review mode with empty title to trigger mandatory validation box and disabled publish action
    await titleInput.fill('');
    await page.waitForTimeout(100);
    await page.locator('button', { hasText: 'Review Rules Before Publishing' }).click();
    await page.waitForTimeout(300);

    // Validation Alert Box contrast in Dark Mode (mandatory assertion: must be visible and >= 4.5:1)
    const valBoxDark = page.locator('.cm-validation-box');
    await expect(valBoxDark).toBeVisible();
    const valContrastDark = await getElementContrast(page, valBoxDark);
    expect(valContrastDark.ratio, `Dark mode validation box contrast (${valContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Disabled Action Button in Dark Mode (mandatory assertion: must be visible and >= 3.0:1)
    const disabledPublishDark = page.locator('button:disabled', { hasText: 'Publish Course Definition' });
    await expect(disabledPublishDark).toBeVisible();
    const disabledContrastDark = await getElementContrast(page, disabledPublishDark);
    expect(disabledContrastDark.ratio, `Dark mode disabled publish button contrast (${disabledContrastDark.ratio}:1)`).toBeGreaterThanOrEqual(3.0);

    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-dark-mode-contrast.png', fullPage: false });

    // --- Part B: Light Mode Contrast Audit ---
    // Switch to Light Mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-mode', 'light');
    });
    await page.waitForTimeout(300);

    // In Review Mode (Light Mode), check Validation Box Contrast (mandatory assertion: must be visible and >= 4.5:1)
    const valBoxLight = page.locator('.cm-validation-box');
    await expect(valBoxLight).toBeVisible();
    const valContrastLight = await getElementContrast(page, valBoxLight);
    expect(valContrastLight.ratio, `Light mode validation box contrast (${valContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Disabled Action Button in Light Mode (mandatory assertion: must be visible and >= 3.0:1)
    const disabledPublishLight = page.locator('button:disabled', { hasText: 'Publish Course Definition' });
    await expect(disabledPublishLight).toBeVisible();
    const disabledContrastLight = await getElementContrast(page, disabledPublishLight);
    expect(disabledContrastLight.ratio, `Light mode disabled publish button contrast (${disabledContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(3.0);

    // Go Back to Edit to check Builder controls in Light Mode
    await page.getByRole('button', { name: 'Back to Edit', exact: true }).click();
    await page.waitForTimeout(300);

    // Check Active Phase Tab Contrast in Light Mode (>= 4.5:1)
    const activeTabLight = page.locator('.cm-phase-tab.active');
    await expect(activeTabLight).toBeVisible();
    const activeTabContrastLight = await getElementContrast(page, activeTabLight);
    expect(activeTabContrastLight.ratio, `Light mode active tab contrast (${activeTabContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Trigger Unsaved State in Light Mode
    await titleInput.fill('Contrast Audit Course - Modified');
    await page.waitForTimeout(200);

    // Verify Light Mode Unsaved Status Pill Contrast (>= 4.5:1)
    const unsavedPillLight = page.locator('.cm-status-pill--unsaved');
    await expect(unsavedPillLight).toBeVisible();
    const unsavedContrastLight = await getElementContrast(page, unsavedPillLight);
    expect(unsavedContrastLight.ratio, `Light mode unsaved pill contrast (${unsavedContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Verify Light Mode Discard Button Contrast (>= 4.5:1)
    const discardBtnLight = page.locator('.cm-btn-discard').first();
    await expect(discardBtnLight).toBeVisible();
    const discardContrastLight = await getElementContrast(page, discardBtnLight);
    expect(discardContrastLight.ratio, `Light mode discard button contrast (${discardContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Check Input and Placeholder Contrast in Light Mode
    const inputContrastLight = await getElementContrast(page, titleInput);
    expect(inputContrastLight.ratio, `Light mode input text contrast (${inputContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    const placeholderContrastLight = await getElementContrast(page, overviewTextarea, true);
    expect(placeholderContrastLight.ratio, `Light mode placeholder contrast (${placeholderContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Discard unsaved changes via modal confirm to return to saved clean state
    await discardBtnLight.click();
    await page.waitForTimeout(200);
    await page.locator('.cm-btn-confirm-discard').click();
    await page.waitForTimeout(300);

    // In catalog view, click Create New Course in Light Mode to verify Saved Status Pill
    await page.locator('button', { hasText: 'Create New Course' }).click();
    await page.waitForTimeout(300);

    const savedPillLight = page.locator('.cm-status-pill--saved');
    await expect(savedPillLight).toBeVisible();
    const savedContrastLight = await getElementContrast(page, savedPillLight);
    expect(savedContrastLight.ratio, `Light mode saved pill contrast (${savedContrastLight.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Return to Catalog View to check badge contrast in Light Mode
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-mode', 'light');
    });
    await page.waitForTimeout(300);

    // Published course badge (mandatory assertion: must be visible and >= 4.5:1)
    const pubBadge = page.locator('.cm-course-badge--published').first();
    await expect(pubBadge).toBeVisible();
    const pubBadgeContrast = await getElementContrast(page, pubBadge);
    expect(pubBadgeContrast.ratio, `Light mode published badge contrast (${pubBadgeContrast.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Active batch status badge (mandatory assertion: must be visible and >= 4.5:1)
    const batchActiveBadge = page.locator('.cm-batch-status--active').first();
    await expect(batchActiveBadge).toBeVisible();
    const batchBadgeContrast = await getElementContrast(page, batchActiveBadge);
    expect(batchBadgeContrast.ratio, `Light mode batch active badge contrast (${batchBadgeContrast.ratio}:1)`).toBeGreaterThanOrEqual(4.5);

    // Verify zero horizontal overflow in Light Mode
    await assertNoHorizontalOverflow(page, 'Course Maker - Light Mode 375px');
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-light-mode.png', fullPage: false });

    // Reset data-mode to dark for subsequent tests
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-mode');
    });
  });

  test('8. Mobile Touch Target Dimension Audit: every interactive control meets >= 44px on 320px and 375px', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    const auditViewports = [
      { name: '320px', width: 320, height: 568 },
      { name: '375px', width: 375, height: 812 }
    ];

    for (const vp of auditViewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

      // Enter Builder
      await page.locator('button', { hasText: 'Create New Course' }).click();
      await page.waitForTimeout(300);

      // Select 5 phases to render all phase tabs
      await page.locator('.cm-phase-count-btn', { hasText: '5' }).click();
      await page.waitForTimeout(200);

      // Add routine slot, class, assignment, and enable exam
      await page.locator('button', { hasText: 'Add Day / Time' }).click();
      await page.waitForTimeout(150);
      await page.locator('button', { hasText: 'Add Class' }).click();
      await page.waitForTimeout(150);
      await page.locator('button', { hasText: 'Add Assignment' }).click();
      await page.waitForTimeout(150);

      const examToggle = page.locator('label').filter({ hasText: 'Enable Phase Final Exam' }).locator('input[type="checkbox"]');
      await examToggle.check();
      await page.waitForTimeout(200);

      // 1. Audit Phase Count Buttons (1-5)
      const countBtns = page.locator('.cm-phase-count-btn');
      for (let i = 0; i < 5; i++) {
        const box = await countBtns.nth(i).boundingBox();
        expect(box, `Phase count button ${i + 1} bounding box (${vp.name})`).not.toBeNull();
        expect(box.height, `Phase count btn ${i + 1} height (${vp.name})`).toBeGreaterThanOrEqual(44);
      }

      // 2. Audit Phase Tabs (1-5)
      const phaseTabs = page.locator('.cm-phase-tab');
      for (let i = 0; i < 5; i++) {
        const box = await phaseTabs.nth(i).boundingBox();
        expect(box, `Phase tab ${i + 1} bounding box (${vp.name})`).not.toBeNull();
        expect(box.height, `Phase tab ${i + 1} height (${vp.name})`).toBeGreaterThanOrEqual(44);
      }

      // 3. Attendance Criteria Checkbox Label & Input
      const attLabel = page.locator('.cm-checkbox-label', { hasText: 'Require Min %:' });
      const attLabelBox = await attLabel.boundingBox();
      expect(attLabelBox, `Attendance checkbox label bounding box (${vp.name})`).not.toBeNull();
      expect(attLabelBox.height, `Attendance checkbox label height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const attInput = page.locator('input[type="number"][min="0"][max="100"]').first();
      const attInputBox = await attInput.boundingBox();
      expect(attInputBox, `Attendance input bounding box (${vp.name})`).not.toBeNull();
      expect(attInputBox.height, `Attendance input height (${vp.name})`).toBeGreaterThanOrEqual(44);

      // 4. Routine Controls: Add button, Weekday select, Time inputs, Delete icon
      const addRoutineBtn = page.locator('button', { hasText: 'Add Day / Time' });
      const addRoutineBox = await addRoutineBtn.boundingBox();
      expect(addRoutineBox.height, `Add Day/Time button height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const routineSlot = page.locator('.cm-routine-slot').first();
      const routineSelect = routineSlot.locator('select');
      const routineSelectBox = await routineSelect.boundingBox();
      expect(routineSelectBox.height, `Routine weekday select height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const routineTimeInputs = routineSlot.locator('.cm-routine-time-input');
      const startBox = await routineTimeInputs.nth(0).boundingBox();
      const endBox = await routineTimeInputs.nth(1).boundingBox();
      expect(startBox.height, `Routine start time input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect(endBox.height, `Routine end time input height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const routineDelBtn = routineSlot.locator('.cm-btn-danger-icon');
      const routineDelBox = await routineDelBtn.boundingBox();
      expect(routineDelBox.height, `Routine delete icon height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect(routineDelBox.width, `Routine delete icon width (${vp.name})`).toBeGreaterThanOrEqual(44);

      // 5. Class Controls: Add class button, Title, Subject, Teacher, Delivery Mode, Category, Mandatory Checkbox, Delete icon
      const addClassBtn = page.locator('button', { hasText: 'Add Class' });
      const addClassBox = await addClassBtn.boundingBox();
      expect(addClassBox.height, `Add Class button height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const classCard = page.locator('.cm-class-card').first();
      const classTitleInput = classCard.locator('input[placeholder="e.g. Master Shot & Reverse Angles"]');
      const classSubjInput = classCard.locator('input[placeholder="Select or enter subject"]');
      const classTeacherInput = classCard.locator('input[placeholder="Select or enter teacher"]');
      const classSelects = classCard.locator('select.cm-select');
      const classMandatoryLabel = classCard.locator('.cm-checkbox-label');
      const classDelBtn = classCard.locator('.cm-btn-danger-icon');

      expect((await classTitleInput.boundingBox()).height, `Class title input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await classSubjInput.boundingBox()).height, `Class subject input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await classTeacherInput.boundingBox()).height, `Class teacher input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await classSelects.nth(0).boundingBox()).height, `Class delivery mode select height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await classSelects.nth(1).boundingBox()).height, `Class category select height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await classMandatoryLabel.boundingBox()).height, `Class mandatory checkbox label height (${vp.name})`).toBeGreaterThanOrEqual(44);
      const classDelBox = await classDelBtn.boundingBox();
      expect(classDelBox.height, `Class delete icon height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect(classDelBox.width, `Class delete icon width (${vp.name})`).toBeGreaterThanOrEqual(44);

      // 6. Assignment Controls: Add button, Title, Subject, Instructions, Max, Pass, Required, Delete icon
      const addAsgBtn = page.locator('button', { hasText: 'Add Assignment' });
      const addAsgBox = await addAsgBtn.boundingBox();
      expect(addAsgBox.height, `Add Assignment button height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const asgCard = page.locator('.cm-assignment-card').first();
      const asgTitleInput = asgCard.locator('input[placeholder="e.g. 1-Minute Scene Exercise"]');
      const asgSubjInput = asgCard.locator('input[placeholder="Select or enter subject"]');
      const asgInstrInput = asgCard.locator('input[placeholder="Instructions for student"]');
      const asgMarksInputs = asgCard.locator('.cm-marks-group input');
      const asgReqLabel = asgCard.locator('.cm-checkbox-label');
      const asgDelBtn = asgCard.locator('.cm-btn-danger-icon');

      expect((await asgTitleInput.boundingBox()).height, `Assignment title input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await asgSubjInput.boundingBox()).height, `Assignment subject input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await asgInstrInput.boundingBox()).height, `Assignment instructions input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await asgMarksInputs.nth(0).boundingBox()).height, `Assignment max marks input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await asgMarksInputs.nth(1).boundingBox()).height, `Assignment pass marks input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await asgReqLabel.boundingBox()).height, `Assignment required checkbox label height (${vp.name})`).toBeGreaterThanOrEqual(44);
      const asgDelBox = await asgDelBtn.boundingBox();
      expect(asgDelBox.height, `Assignment delete icon height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect(asgDelBox.width, `Assignment delete icon width (${vp.name})`).toBeGreaterThanOrEqual(44);

      // 7. Exam Controls: Title, Type select, Max marks, Pass marks, Threshold
      const examTitleInput = page.locator('input[placeholder="e.g. Midterm Written Assessment"]');
      const examTypeSelect = page.locator('.cm-exam-grid select');
      const examMarksInputs = page.locator('.cm-exam-grid .cm-marks-group input');
      const examThresholdInput = page.locator('input[placeholder="Min total marks"]');

      expect((await examTitleInput.boundingBox()).height, `Exam title input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await examTypeSelect.boundingBox()).height, `Exam type select height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await examMarksInputs.nth(0).boundingBox()).height, `Exam max marks input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await examMarksInputs.nth(1).boundingBox()).height, `Exam pass marks input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await examThresholdInput.boundingBox()).height, `Exam threshold input height (${vp.name})`).toBeGreaterThanOrEqual(44);

      // 8. Policy Controls: Discount input, policy checkbox labels
      const policyLabels = page.locator('.cm-policy-grid .cm-checkbox-label');
      for (const pl of await policyLabels.all()) {
        const box = await pl.boundingBox();
        expect(box.height, `Policy checkbox label height (${vp.name})`).toBeGreaterThanOrEqual(44);
      }
      const discountInput = page.locator('.cm-discount-row input');
      if (await discountInput.isVisible()) {
        const discBox = await discountInput.boundingBox();
        expect(discBox.height, `Discount input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      }

      // 9. Builder Footer Action Buttons
      const saveDraftBtn = page.locator('button', { hasText: 'Save as Draft' });
      const reviewRulesBtn = page.locator('button', { hasText: 'Review Rules Before Publishing' });
      expect((await saveDraftBtn.boundingBox()).height, `Save Draft btn height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await reviewRulesBtn.boundingBox()).height, `Review Rules btn height (${vp.name})`).toBeGreaterThanOrEqual(44);

      // 10. Review Screen Controls
      await reviewRulesBtn.click();
      await page.waitForTimeout(300);

      const backToEditBtn = page.getByRole('button', { name: 'Back to Edit', exact: true });
      const publishBtn = page.locator('button', { hasText: 'Publish Course Definition' });
      expect((await backToEditBtn.boundingBox()).height, `Back to Edit btn height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await publishBtn.boundingBox()).height, `Publish btn height (${vp.name})`).toBeGreaterThanOrEqual(44);

      // Return to catalog and audit Routine & Audit Modal controls
      await page.goto('admin/course-maker', { waitUntil: 'networkidle' });
      await page.locator('button', { hasText: 'Routine & Audits' }).first().click();
      await page.waitForTimeout(300);

      const modalPhaseSelect = page.locator('.cm-modal-dialog select.cm-select').first();
      expect((await modalPhaseSelect.boundingBox()).height, `Modal phase select height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const modalAddSlotBtn = page.locator('.cm-modal-dialog button', { hasText: '+ Add Slot' });
      expect((await modalAddSlotBtn.boundingBox()).height, `Modal add slot btn height (${vp.name})`).toBeGreaterThanOrEqual(44);
      await modalAddSlotBtn.click();
      await page.waitForTimeout(200);

      const modalSlotSelect = page.locator('.cm-modal-routine-slot select').first();
      expect((await modalSlotSelect.boundingBox()).height, `Modal slot select height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const modalTimeInputs = page.locator('.cm-modal-routine-slot .cm-routine-time-input');
      expect((await modalTimeInputs.nth(0).boundingBox()).height, `Modal start time input height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await modalTimeInputs.nth(1).boundingBox()).height, `Modal end time input height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const modalDelSlotBtn = page.locator('.cm-modal-routine-slot .cm-btn-danger-icon').first();
      const modalDelBox = await modalDelSlotBtn.boundingBox();
      expect(modalDelBox.height, `Modal slot delete icon height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect(modalDelBox.width, `Modal slot delete icon width (${vp.name})`).toBeGreaterThanOrEqual(44);

      const modalCloseBtn = page.locator('.cm-modal-dialog button[aria-label="Close modal"]');
      const modalCloseBox = await modalCloseBtn.boundingBox();
      expect(modalCloseBox.height, `Modal close icon height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect(modalCloseBox.width, `Modal close icon width (${vp.name})`).toBeGreaterThanOrEqual(44);

      const modalReasonInput = page.locator('.cm-modal-dialog input.cm-input').first();
      expect((await modalReasonInput.boundingBox()).height, `Modal reason input height (${vp.name})`).toBeGreaterThanOrEqual(44);

      const modalCancelBtn = page.locator('.cm-modal-actions button', { hasText: 'Cancel' });
      const modalSaveBtn = page.locator('.cm-modal-actions button', { hasText: 'Save Routine & Record Audit' });
      expect((await modalCancelBtn.boundingBox()).height, `Modal cancel btn height (${vp.name})`).toBeGreaterThanOrEqual(44);
      expect((await modalSaveBtn.boundingBox()).height, `Modal save routine btn height (${vp.name})`).toBeGreaterThanOrEqual(44);

      await modalCancelBtn.click();
      await page.waitForTimeout(200);
    }

    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-audit-targets.png', fullPage: false });
  });

  test('9. Simulated On-Screen Virtual Keyboard & Clearance: header and bottom nav do not occlude inputs or actions', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    // Test both Portrait (375x420) and Landscape (844x210) simulating on-screen keyboard
    const keyboardViewports = [
      { name: 'portrait-keyboard', width: 375, height: 420, headerH: 64, navH: 60 },
      { name: 'landscape-keyboard', width: 844, height: 210, headerH: 64, navH: 60 }
    ];

    for (const kvp of keyboardViewports) {
      await page.setViewportSize({ width: kvp.width, height: kvp.height });
      await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

      // Click Create New Course
      await page.locator('button', { hasText: 'Create New Course' }).click();
      await page.waitForTimeout(300);

      // Helper to test focus, centering, and unoccluded bounding box
      const verifyInputClearance = async (locator, label) => {
        const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);

        // Adjust scroll position to ensure element is within visual viewport between header and bottom nav
        await el.evaluate((node, headerH) => {
          const rect = node.getBoundingClientRect();
          const navH = 60;
          if (rect.top < headerH || rect.bottom > window.innerHeight - navH) {
            const desiredY = headerH + Math.max(10, (window.innerHeight - headerH - navH - rect.height) / 2);
            window.scrollBy(0, rect.top - desiredY);
          }
        }, kvp.headerH);
        await page.waitForTimeout(100);

        try { await el.focus({ timeout: 500 }); } catch { /* non-focusable element */ }

        const box = await el.boundingBox();
        expect(box, `${label} bounding box in ${kvp.name}`).not.toBeNull();

        // Must be below fixed mobile header (64px)
        expect(box.y, `${label} top (${Math.round(box.y)}) must be >= header height (${kvp.headerH}) in ${kvp.name}`).toBeGreaterThanOrEqual(kvp.headerH - 2);

        // Must be above bottom nav (viewport.height - 60px)
        const maxBottom = kvp.height - kvp.navH;
        expect(box.y + box.height, `${label} bottom (${Math.round(box.y + box.height)}) must be <= bottom nav top (${maxBottom}) in ${kvp.name}`).toBeLessThanOrEqual(maxBottom + 4);

        // Hit test center of element
        const hitResult = await page.evaluate(({ cx, cy }) => {
          const topEl = document.elementFromPoint(cx, cy);
          if (!topEl) return { hit: false, tag: 'none' };
          const header = topEl.closest('.mobile-header-bar');
          const nav = topEl.closest('.mobile-bottom-nav');
          return {
            hit: !header && !nav,
            tag: topEl.tagName,
            cls: String(topEl.className || '')
          };
        }, { cx: box.x + box.width / 2, cy: box.y + box.height / 2 });

        expect(hitResult.hit, `${label} at (${Math.round(box.x + box.width/2)}, ${Math.round(box.y + box.height/2)}) was covered by ${hitResult.cls || hitResult.tag} in ${kvp.name}`).toBe(true);
      };

      // 1. Course Name Input
      await verifyInputClearance('input[placeholder="e.g. Masterclass in Directing & Acting"]', 'Course Title Input');

      // 2. Duration Value Input
      await verifyInputClearance('input[type="number"][min="1"]', 'Duration Input');

      // 3. Attendance Criteria Input
      await verifyInputClearance('input[type="number"][min="0"][max="100"]', 'Attendance % Input');

      // 4. Action Buttons at the bottom
      const saveDraftBtn = page.locator('button', { hasText: 'Save as Draft' });
      await verifyInputClearance(saveDraftBtn, 'Save as Draft Button');

      const reviewBtn = page.locator('button', { hasText: 'Review Rules Before Publishing' });
      await verifyInputClearance(reviewBtn, 'Review Rules Button');

      // 5. Review Mode & Validation Warning Clearance
      await reviewBtn.click();
      await page.waitForTimeout(300);

      // Validation box is present because required fields are empty
      const validationBox = page.locator('.cm-validation-box');
      await verifyInputClearance(validationBox, 'Validation Warning Box');

      // Review actions clearance
      const publishBtn = page.locator('button', { hasText: 'Publish Course Definition' });
      await verifyInputClearance(publishBtn, 'Publish Action Button');

      if (kvp.name === 'portrait-keyboard') {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-keyboard-portrait.png', fullPage: false });
      } else {
        await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-keyboard-landscape.png', fullPage: false });
      }
    }
  });

  test('10. Stress & Density Matrix: 5 phases, extreme long labels, multi-item density, validation errors, light & dark modes', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    // 1. Test extreme density on standard mobile (375x812)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    await page.locator('button', { hasText: 'Create New Course' }).click();
    await page.waitForTimeout(300);

    // Fill extreme long labels
    const courseTitleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await courseTitleInput.fill('Comprehensive Advanced Cinematic Directing, Producing, Post-Production Color Grading & Sound Masterclass for Independent Bangladeshi Filmmakers');

    // Select 5 phases
    await page.locator('.cm-phase-count-btn', { hasText: '5' }).click();
    await page.waitForTimeout(300);

    // Verify all 5 phase tabs
    const phaseTabs = page.locator('.cm-phase-tab');
    await expect(phaseTabs).toHaveCount(5);

    // Switch across each phase and add multiple classes and assignments
    for (let pIdx = 0; pIdx < 5; pIdx++) {
      await phaseTabs.nth(pIdx).click();
      await page.waitForTimeout(100);

      // Phase title input
      const phaseTitleInput = page.locator('.cm-phase-header-grid input[type="text"]').first();
      await phaseTitleInput.fill(`Phase ${pIdx + 1}: Deep Immersion into Pre-Visualization, Script Breakdown, Blocking, Lighting Architecture & Multi-Camera Setup`);

      // Add routine slot
      await page.locator('button', { hasText: 'Add Day / Time' }).click();
      await page.waitForTimeout(100);

      // Add 2 classes
      await page.locator('button', { hasText: 'Add Class' }).click();
      await page.waitForTimeout(100);
      await page.locator('button', { hasText: 'Add Class' }).click();
      await page.waitForTimeout(100);

      const classTitles = page.locator('.cm-class-card input[placeholder="e.g. Master Shot & Reverse Angles"]');
      if (await classTitles.count() >= 2) {
        await classTitles.nth(0).fill('Class A: Dynamic Camera Blocking and Spatial Continuity in Cinematic Mise-en-Scène');
        await classTitles.nth(1).fill('Class B: Chiaroscuro Naturalistic Key-to-Fill Ratio Control with High Dynamic Range Sensors');
      }

      // Add 2 assignments with subjects
      await page.locator('button', { hasText: 'Add Assignment' }).click();
      await page.waitForTimeout(100);
      await page.locator('button', { hasText: 'Add Assignment' }).click();
      await page.waitForTimeout(100);

      const asgTitles = page.locator('.cm-assignment-card input[placeholder="e.g. 1-Minute Scene Exercise"]');
      const asgSubjs = page.locator('.cm-assignment-card input[placeholder="Select or enter subject"]');
      if (await asgTitles.count() >= 2) {
        await asgTitles.nth(0).fill('Practical Dialogue Scene Shoot with Narrative Subtext and 180-Degree Line Integrity');
        await asgTitles.nth(1).fill('Complete 4K Color Transformation and ACEScg Linear Pipeline Grade');
      }
      if (await asgSubjs.count() >= 2) {
        await asgSubjs.nth(0).fill('Advanced Cinematography & Cinematic Direction');
        await asgSubjs.nth(1).fill('Post-Production Color Science');
      }
    }

    // Check zero horizontal overflow across 320px, 375px, and phone landscape (844x390)
    for (const testVp of [
      { width: 320, height: 568, name: '320px-narrow-stressed' },
      { width: 375, height: 812, name: '375px-standard-stressed' },
      { width: 844, height: 390, name: '844x390-landscape-stressed' }
    ]) {
      await page.setViewportSize({ width: testVp.width, height: testVp.height });
      await page.waitForTimeout(200);
      await assertNoHorizontalOverflow(page, `Dense 5-Phase Builder - ${testVp.name}`);
    }

    // Capture screenshot of dense 5-phase builder
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-5phases-longlabels.png', fullPage: false });

    // Review Mode: verify successful validation on completely filled dense form
    const reviewBtn = page.locator('button', { hasText: 'Review Rules Before Publishing' });
    await reviewBtn.click();
    await page.waitForTimeout(300);

    const successBox = page.locator('.cm-success-box');
    await expect(successBox).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Dense Review Mode Complete - Dark');

    // Also verify validation error banner by going back to edit, clearing course name, and reviewing again
    const backBtn = page.getByRole('button', { name: 'Back to Edit', exact: true });
    await backBtn.click();
    await page.waitForTimeout(200);

    const titleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await titleInput.fill(''); // Clear course name to trigger validation errors
    await reviewBtn.click();
    await page.waitForTimeout(200);

    const validationBox = page.locator('.cm-validation-box');
    await expect(validationBox).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Dense Review Mode Errors - Dark');
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-mobile-validation-errors.png', fullPage: false });

    // Toggle Light Mode on Review Screen
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-mode', 'light');
    });
    await page.waitForTimeout(200);

    await expect(validationBox).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Dense Review Mode Errors - Light');
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-light-mode-review.png', fullPage: false });

    // Reset data-mode
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-mode');
    });
  });

  test('11. Phase Navigation Usability: verifies visible hint, selected-state announcement, aria-selected, keyboard arrow navigation, and scrollIntoView on 320px and 375px', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    // 1. Narrow 320px Viewport Navigation Testing
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Click Create New Course to enter builder
    await page.locator('button', { hasText: 'Create New Course' }).click();
    await page.waitForTimeout(300);

    // Expand to 4 phases to test scrolling & overflow
    await page.locator('.cm-phase-count-btn', { hasText: '4' }).click();
    await page.waitForTimeout(200);

    // Verify visible mobile scroll hint exists and is visible on narrow viewport
    const scrollHint = page.locator('.cm-phase-nav-scroll-hint');
    await expect(scrollHint).toBeVisible();
    await expect(scrollHint).toHaveText('← Scroll for more phases →');

    // Verify phase nav counter label
    const navLabel = page.locator('.cm-phase-nav-label');
    await expect(navLabel).toBeVisible();
    await expect(navLabel).toHaveText('Phase 1 of 4');

    // Verify tablist role and accessibility
    const tablist = page.locator('.cm-phase-tabs[role="tablist"]');
    await expect(tablist).toBeVisible();
    await expect(tablist).toHaveAttribute('aria-label', 'Course phases');

    // Verify individual tabs have role="tab", aria-controls, aria-selected
    const phaseTabs = page.locator('.cm-phase-tab[role="tab"]');
    await expect(phaseTabs).toHaveCount(4);

    // Initial state: Tab 0 is selected
    await expect(phaseTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(phaseTabs.nth(0)).toHaveAttribute('aria-controls', 'phase-panel-0');
    await expect(phaseTabs.nth(0)).toHaveAttribute('tabindex', '0');

    await expect(phaseTabs.nth(1)).toHaveAttribute('aria-selected', 'false');
    await expect(phaseTabs.nth(1)).toHaveAttribute('tabindex', '-1');

    // Verify active tabpanel
    const tabPanel0 = page.locator('.cm-card[role="tabpanel"]');
    await expect(tabPanel0).toBeVisible();
    await expect(tabPanel0).toHaveAttribute('id', 'phase-panel-0');
    await expect(tabPanel0).toHaveAttribute('aria-labelledby', 'phase-tab-0');

    // Test Keyboard Navigation: ArrowRight moves focus and selects next tab
    await phaseTabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    await expect(phaseTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(navLabel).toHaveText('Phase 2 of 4');
    await expect(phaseTabs.nth(1)).toBeFocused();

    // ArrowLeft moves back to previous tab
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);

    await expect(phaseTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(navLabel).toHaveText('Phase 1 of 4');
    await expect(phaseTabs.nth(0)).toBeFocused();

    // End key moves directly to last tab (Phase 4)
    await page.keyboard.press('End');
    await page.waitForTimeout(150);

    await expect(phaseTabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    await expect(navLabel).toHaveText('Phase 4 of 4');
    await expect(phaseTabs.nth(3)).toBeFocused();

    // Home key moves back to first tab (Phase 1)
    await page.keyboard.press('Home');
    await page.waitForTimeout(150);

    await expect(phaseTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(navLabel).toHaveText('Phase 1 of 4');
    await expect(phaseTabs.nth(0)).toBeFocused();

    // Test automatic scrollIntoView when switching to last tab on narrow 320px
    await phaseTabs.nth(3).click();
    await page.waitForTimeout(300);

    // Verify that Tab 3 is horizontally visible within the tablist scroll container
    const tab3VisibleInContainer = await phaseTabs.nth(3).evaluate((el) => {
      const container = el.closest('.cm-phase-tabs');
      if (!container) return false;
      const cRect = container.getBoundingClientRect();
      const tRect = el.getBoundingClientRect();
      return tRect.left >= cRect.left - 5 && tRect.right <= cRect.right + 5;
    });
    expect(tab3VisibleInContainer, 'Phase 4 tab should be scrolled into view within tablist').toBe(true);

    // Verify no horizontal overflow of the page on 320px
    await assertNoHorizontalOverflow(page, 'Phase Nav - 320px');

    // 2. Test 375px standard phone viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);

    // Switch to tab 2 (Phase 3)
    await phaseTabs.nth(2).click();
    await page.waitForTimeout(200);

    await expect(phaseTabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(navLabel).toHaveText('Phase 3 of 4');

    const tab2VisibleInContainer = await phaseTabs.nth(2).evaluate((el) => {
      const container = el.closest('.cm-phase-tabs');
      if (!container) return false;
      const cRect = container.getBoundingClientRect();
      const tRect = el.getBoundingClientRect();
      return tRect.left >= cRect.left - 5 && tRect.right <= cRect.right + 5;
    });
    expect(tab2VisibleInContainer, 'Phase 3 tab should be scrolled into view on 375px').toBe(true);

    await assertNoHorizontalOverflow(page, 'Phase Nav - 375px');
    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-phase-nav-mobile.png', fullPage: false });
  });

  test('12. Complete Action & Lifecycle Audit: exercises Create, Resume, Save Draft, Discard/Cancel, Catalog, Phase switch, Routine, Class, Assignment, Exam toggle, Review, Publish, Create Batch, Manage Batch, and Routine Edit', async ({ page }) => {
    const userPayload = {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'admin',
      firstName: adminUser.first_name,
      lastName: adminUser.last_name
    };

    await page.addInitScript(({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('bfi_course_maker_unsaved_draft_')) localStorage.removeItem(k);
      });
    }, { t: adminToken, u: userPayload });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // 1. Action: Create New Course
    await page.locator('button', { hasText: 'Create New Course' }).click();
    await page.waitForTimeout(300);

    // Fill Course Basics
    const titleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await titleInput.fill('Lifecycle Audit Film Directing');

    // 2. Action: Select 2 Phases
    await page.locator('.cm-phase-count-btn', { hasText: '2' }).click();
    await page.waitForTimeout(200);

    const phaseTabs = page.locator('.cm-phase-tab');
    await expect(phaseTabs).toHaveCount(2);

    // 3. Action: Configure Phase 1 Routine (Add and Remove)
    await page.locator('button', { hasText: 'Add Day / Time' }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-routine-slot')).toHaveCount(2);

    const routineSlot2 = page.locator('.cm-routine-slot').nth(1);
    await routineSlot2.locator('select').selectOption('Friday');
    const routineTimes2 = routineSlot2.locator('.cm-routine-time-input');
    await routineTimes2.nth(0).fill('15:00');
    await routineTimes2.nth(1).fill('18:00');

    // Add 3rd temporary slot to test removal
    await page.locator('button', { hasText: 'Add Day / Time' }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-routine-slot')).toHaveCount(3);

    // Remove the 3rd temporary slot
    await page.locator('.cm-routine-slot').nth(2).locator('button[title="Remove Slot"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-routine-slot')).toHaveCount(2);

    // Remove the 1st default slot (Saturday) so only Friday remains
    await page.locator('.cm-routine-slot').first().locator('button[title="Remove Slot"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-routine-slot')).toHaveCount(1);

    // 4. Action: Add and Remove Class in Phase 1
    await page.locator('button', { hasText: 'Add Class' }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-class-card')).toHaveCount(2);

    const classCard2 = page.locator('.cm-class-card').nth(1);
    await classCard2.locator('input[placeholder="e.g. Master Shot & Reverse Angles"]').fill('Intro to Narrative Mise-en-Scène');
    await classCard2.locator('input[placeholder="Select or enter subject"]').fill('Cinematography');
    await classCard2.locator('input[placeholder="Select or enter teacher"]').fill('Director Kabir');

    // Add 3rd temporary class to test removal
    await page.locator('button', { hasText: 'Add Class' }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-class-card')).toHaveCount(3);

    // Remove the 3rd temporary class
    await page.locator('.cm-class-card').nth(2).locator('button[title="Delete Class"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-class-card')).toHaveCount(2);

    // Remove the 1st default class ("Introduction & Fundamentals")
    await page.locator('.cm-class-card').first().locator('button[title="Delete Class"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-class-card')).toHaveCount(1);
    await expect(page.locator('.cm-class-card input[placeholder="e.g. Master Shot & Reverse Angles"]')).toHaveValue('Intro to Narrative Mise-en-Scène');

    // 5. Action: Add and Remove Assignment in Phase 1
    await page.locator('button', { hasText: 'Add Assignment' }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-assignment-card')).toHaveCount(2);

    const asgCard2 = page.locator('.cm-assignment-card').nth(1);
    await asgCard2.locator('input[placeholder="e.g. 1-Minute Scene Exercise"]').fill('Visual Script Analysis');
    await asgCard2.locator('input[placeholder="Select or enter subject"]').fill('Cinematography');
    await asgCard2.locator('.cm-marks-group input').nth(0).fill('50');
    await asgCard2.locator('.cm-marks-group input').nth(1).fill('30');

    // Add 3rd temporary assignment to test removal
    await page.locator('button', { hasText: 'Add Assignment' }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-assignment-card')).toHaveCount(3);

    // Remove the 3rd temporary assignment
    await page.locator('.cm-assignment-card').nth(2).locator('button[title="Delete Assignment"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-assignment-card')).toHaveCount(2);

    // Remove the 1st default assignment ("Exercise 1")
    await page.locator('.cm-assignment-card').first().locator('button[title="Delete Assignment"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.cm-assignment-card')).toHaveCount(1);
    await expect(page.locator('.cm-assignment-card input[placeholder="e.g. 1-Minute Scene Exercise"]')).toHaveValue('Visual Script Analysis');

    // 6. Action: Toggle and Configure Exam in Phase 1
    const examToggle = page.locator('label').filter({ hasText: 'Enable Phase Final Exam' }).locator('input[type="checkbox"]');
    await examToggle.check();
    await page.waitForTimeout(150);

    await page.locator('input[placeholder="e.g. Midterm Written Assessment"]').fill('Phase 1 Comprehensive Theory Exam');
    const examMarks = page.locator('.cm-exam-grid .cm-marks-group input');
    await examMarks.nth(0).fill('100');
    await examMarks.nth(1).fill('40');
    await page.locator('input[placeholder="Min total marks"]').fill('60');

    // 7. Action: Switch to Phase 2 and Configure
    await phaseTabs.nth(1).click();
    await page.waitForTimeout(200);

    await page.locator('button', { hasText: 'Add Class' }).click();
    await page.waitForTimeout(150);
    const p2Class = page.locator('.cm-class-card').first();
    await p2Class.locator('input[placeholder="e.g. Master Shot & Reverse Angles"]').fill('Multi-Camera Production');
    await p2Class.locator('input[placeholder="Select or enter subject"]').fill('Direction');
    await p2Class.locator('input[placeholder="Select or enter teacher"]').fill('Director Kabir');

    await page.locator('button', { hasText: 'Add Assignment' }).click();
    await page.waitForTimeout(150);
    const p2Asg = page.locator('.cm-assignment-card').first();
    await p2Asg.locator('input[placeholder="e.g. 1-Minute Scene Exercise"]').fill('Short Scene Shoot');
    await p2Asg.locator('input[placeholder="Select or enter subject"]').fill('Direction');
    await p2Asg.locator('.cm-marks-group input').nth(0).fill('50');
    await p2Asg.locator('.cm-marks-group input').nth(1).fill('30');

    // 8. Action: Save as Draft
    await page.locator('button', { hasText: 'Save as Draft' }).click();
    await page.waitForTimeout(600);

    // Verify Draft in Database
    const draftInDb = db.prepare("SELECT * FROM course_definitions WHERE name = 'Lifecycle Audit Film Directing'").get();
    expect(draftInDb, 'Draft definition exists in database').toBeDefined();
    expect(draftInDb.status).toBe('draft');

    // Verify Phase 1 routine, class, and assignment removals persisted in definition JSON
    const draftJson = JSON.parse(draftInDb.definition_json);
    expect(draftJson.phases[0].routine).toHaveLength(1);
    expect(draftJson.phases[0].routine[0].weekday).toBe('Friday');
    expect(draftJson.phases[0].classes).toHaveLength(1);
    expect(draftJson.phases[0].classes[0].title).toBe('Intro to Narrative Mise-en-Scène');
    expect(draftJson.phases[0].assignments).toHaveLength(1);
    expect(draftJson.phases[0].assignments[0].title).toBe('Visual Script Analysis');

    // Verify in catalog list view
    const draftCard = page.locator('.cm-catalog-card', { hasText: 'Lifecycle Audit Film Directing' }).first();
    await expect(draftCard).toBeVisible();
    await expect(draftCard.locator('.cm-course-badge--draft')).toBeVisible();

    // 9. Action: Resume/Edit Draft & verify Saved status in Builder
    await draftCard.locator('button', { hasText: 'Edit' }).click();
    await page.waitForTimeout(400);

    // Verify Saved Status Pill is active in builder mode
    await expect(page.locator('.cm-status-pill--saved')).toBeVisible();

    const reloadedTitleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await expect(reloadedTitleInput).toHaveValue('Lifecycle Audit Film Directing');
    await expect(page.locator('.cm-phase-tab')).toHaveCount(2);

    // Verify Phase 1 retains removed/configured items
    await expect(page.locator('.cm-routine-slot')).toHaveCount(1);
    await expect(page.locator('.cm-class-card')).toHaveCount(1);
    await expect(page.locator('.cm-assignment-card')).toHaveCount(1);

    // 9b. Action: Persistence across Page Refresh
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const refreshedTitleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await expect(refreshedTitleInput).toHaveValue('Lifecycle Audit Film Directing');
    await expect(page.locator('.cm-phase-tab')).toHaveCount(2);

    // 10. Action: Discard / Cancel Confirmation Workflow (Both Choices Verified)
    await refreshedTitleInput.fill('Lifecycle Audit Film Directing - Unsaved Edit');
    await page.waitForTimeout(200);
    await expect(page.locator('.cm-status-pill--unsaved')).toBeVisible();

    // Choice A: Cancel Discard via "Keep Editing" preserves work in progress
    await page.locator('.cm-btn-discard').first().click();
    await page.waitForTimeout(200);

    const discardModal = page.locator('.cm-modal-dialog');
    await expect(discardModal).toBeVisible();
    await expect(discardModal).toContainText('Discard Course Draft?');

    await page.locator('.cm-modal-actions button', { hasText: 'Keep Editing' }).click();
    await page.waitForTimeout(200);
    await expect(discardModal).not.toBeVisible();
    await expect(refreshedTitleInput).toHaveValue('Lifecycle Audit Film Directing - Unsaved Edit');
    await expect(page.locator('.cm-status-pill--unsaved')).toBeVisible();

    // Choice B: Confirm Discard clears unsaved work and returns to catalog view
    await page.locator('.cm-btn-discard').first().click();
    await page.waitForTimeout(200);
    await expect(discardModal).toBeVisible();

    await page.locator('.cm-btn-confirm-discard').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.cm-catalog-grid')).toBeVisible();

    // Verify localStorage unsaved draft is cleared
    const storedDraft = await page.evaluate((uId) => localStorage.getItem(`bfi_course_maker_unsaved_draft_${uId}`), adminUser.id);
    expect(storedDraft).toBeNull();

    // Reopen draft from catalog to verify original saved draft is preserved intact
    const resumedDraftCard = page.locator('.cm-catalog-card', { hasText: 'Lifecycle Audit Film Directing' }).first();
    await resumedDraftCard.locator('button', { hasText: 'Edit' }).click();
    await page.waitForTimeout(400);

    const restoredTitleInput = page.locator('input[placeholder="e.g. Masterclass in Directing & Acting"]');
    await expect(restoredTitleInput).toHaveValue('Lifecycle Audit Film Directing');
    await expect(page.locator('.cm-status-pill--saved')).toBeVisible();

    // 11. Action: Review Rules Before Publishing
    await page.locator('button', { hasText: 'Review Rules Before Publishing' }).click();
    await page.waitForTimeout(400);

    // Verify Review Container renders
    const reviewContainer = page.locator('.cm-review-container');
    await expect(reviewContainer).toBeVisible();
    await expect(page.locator('.cm-success-box')).toBeVisible();

    // 12. Action: Publish Course Definition
    await page.locator('button', { hasText: 'Publish Course Definition' }).click();
    await page.waitForTimeout(800);

    // Verify in Database: status updated to 'published'
    const publishedInDb = db.prepare("SELECT * FROM course_definitions WHERE name = 'Lifecycle Audit Film Directing'").get();
    expect(publishedInDb, 'Published definition exists in database').toBeDefined();
    expect(publishedInDb.status).toBe('published');

    // Verify in UI Catalog
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });
    const catalogCard = page.locator('.cm-catalog-card', { hasText: 'Lifecycle Audit Film Directing' }).first();
    await expect(catalogCard).toBeVisible();
    await expect(catalogCard.locator('.cm-course-badge--published')).toBeVisible();

    // 13. Action: Create Batch (Complete Form Submission & DB Linking)
    await catalogCard.locator('button', { hasText: 'Create Batch' }).first().click();
    await page.waitForTimeout(300);

    const batchModal = page.locator('.batch-modal-overlay');
    await expect(batchModal).toBeVisible();
    await expect(batchModal).toContainText('Create New Batch');

    // Complete Create Batch form fields
    const batchNumInput = batchModal.locator('input[placeholder="e.g. 86"]');
    await batchNumInput.fill('01');
    await page.waitForTimeout(200);

    const batchNameInput = batchModal.locator('input[placeholder="e.g. 86th Batch"]');
    await batchNameInput.clear();
    await batchNameInput.fill('Lifecycle Directing Batch 01');

    await batchModal.locator('select.batch-status-select').selectOption('active');
    await batchModal.locator('input[type="date"]').nth(0).fill('2026-11-01');
    await batchModal.locator('input[type="date"]').nth(1).fill('2026-12-31');

    // Submit batch creation
    await batchModal.locator('button[type="submit"]').click();
    await page.waitForTimeout(600);
    await expect(batchModal).not.toBeVisible();

    // Verify Batch in Database: linked to exact course definition
    const createdBatch = db.prepare("SELECT * FROM batches WHERE batch_name = 'Lifecycle Directing Batch 01'").get();
    expect(createdBatch, 'Created batch exists in database').toBeDefined();
    expect(createdBatch.course_definition_id, 'Linked to published course definition').toBe(publishedInDb.id);
    expect(createdBatch.course_name).toBe('Lifecycle Audit Film Directing');
    expect(createdBatch.status).toBe('active');

    // Verify Batch Item rendered in UI Catalog card
    const catalogCardUpdated = page.locator('.cm-catalog-card', { hasText: 'Lifecycle Audit Film Directing' }).first();
    const batchItem = catalogCardUpdated.locator('.cm-catalog-batch-item', { hasText: 'Lifecycle Directing Batch 01' });
    await expect(batchItem).toBeVisible();
    await expect(batchItem.locator('.cm-batch-status--active')).toBeVisible();

    // 13b. Action: Manage Batch Navigation & Identity Verification
    await batchItem.locator('button', { hasText: 'Manage' }).click();
    await page.waitForTimeout(500);

    // Verify navigation to Batch Detail page and correct course identity
    await expect(page).toHaveURL(new RegExp(`/admin/(batchmanager|batches)/(${createdBatch.slug || createdBatch.id})`));
    const batchHeader = page.locator('.batch-detail-header');
    await expect(batchHeader).toBeVisible();
    await expect(batchHeader.locator('h1')).toContainText('Lifecycle Directing Batch 01');
    await expect(batchHeader).toContainText('Lifecycle Audit Film Directing');

    // Return to Course Maker for Routine & Audits Modal verification
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // 14. Action: Routine & Audits Modal on Published Course
    const catalogCardPublished = page.locator('.cm-catalog-card', { hasText: 'Lifecycle Audit Film Directing' }).first();
    await catalogCardPublished.locator('button', { hasText: 'Routine & Audits' }).click();
    await page.waitForTimeout(300);

    const auditModal = page.locator('.cm-modal-dialog');
    await expect(auditModal).toBeVisible();
    await expect(auditModal).toContainText('Manage Routine & Audit History');

    // Add new routine override slot
    await auditModal.locator('button', { hasText: '+ Add Slot' }).click();
    await page.waitForTimeout(150);

    const auditSlot = auditModal.locator('.cm-modal-routine-slot').last();
    await auditSlot.locator('select').selectOption('Saturday');
    const auditTimes = auditSlot.locator('.cm-routine-time-input');
    await auditTimes.nth(0).fill('10:00');
    await auditTimes.nth(1).fill('13:00');

    // Fill audit reason
    const auditReasonInput = auditModal.locator('input.cm-input').first();
    await auditReasonInput.fill('Studio maintenance rescheduled to Fridays');

    // Save Routine & Record Audit
    await auditModal.locator('button', { hasText: 'Save Routine & Record Audit' }).click();
    await page.waitForTimeout(600);

    // Verify Audit Record in Database
    const auditRecord = db.prepare("SELECT * FROM course_routine_audits WHERE course_definition_id = ?").get(publishedInDb.id);
    expect(auditRecord, 'Audit record persisted in database').toBeDefined();
    expect(auditRecord.reason).toBe('Studio maintenance rescheduled to Fridays');

    // Reopen Routine & Audits modal to verify UI audit history
    await catalogCardPublished.locator('button', { hasText: 'Routine & Audits' }).click();
    await page.waitForTimeout(300);

    const auditHistoryItem = page.locator('.cm-routine-audit-item').first();
    await expect(auditHistoryItem).toBeVisible();
    await expect(auditHistoryItem).toContainText('Studio maintenance rescheduled to Fridays');

    // Close modal
    await auditModal.locator('button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'docs/reports/screenshots/course-maker-lifecycle-audit.png', fullPage: false });
  });

});
