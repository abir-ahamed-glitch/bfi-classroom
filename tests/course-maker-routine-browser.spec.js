import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation, 
  assertServerRejectionProof, 
  setupTestRouteProxy 
} from './test-db-isolation.js';

dotenv.config();

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;
let testCourseDefId;
const testBatchId = 100082;

function issueAdminSessionToken(userId, extraClaims = {}) {
  const user = db.prepare('SELECT id, username, email, role, is_super_admin, token_version FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
    VALUES (?, 'test_session_hash', '127.0.0.1', 'playwright_test', ?, datetime('now'), datetime('now'), datetime('now'))
  `).run(userId, expiresAt);

  const sessionId = insert.lastInsertRowid;
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.username,
    is_super_admin: user.is_super_admin || 0,
    type: 'access',
    sessionId,
    token_version: user.token_version || 1,
    ...extraClaims
  };

  return {
    token: jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' }),
    sessionId
  };
}

test.beforeAll(async () => {
  await assertServerRejectionProof('http://127.0.0.1:3001');
  const serverIdentity = await verifyServerIsolation(getTestApiUrl());
  console.log(`[RoutineBrowserTest] Connected to isolated test server: port=${serverIdentity.port} db=${serverIdentity.dbPath}`);

  await initIsolatedTestDatabase(DB_PATH);
  db = new Database(DB_PATH);
  assertIsolatedTestDatabase(db.name || DB_PATH);

  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminUser) {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, first_name, last_name, email, role, is_active, is_super_admin, token_version)
      VALUES (1, 'admin@abir', 'hash', 'Abir', 'Ahmad', 'k.eye.films@gmail.com', 'admin', 1, 1, 1)
    `).run();
    adminUser = db.prepare("SELECT * FROM users WHERE id = 1").get();
  }

  // Ensure admin user is super admin and active
  db.prepare("UPDATE users SET is_super_admin = 1, is_active = 1 WHERE id = ?").run(adminUser.id);
  try {
    db.prepare("INSERT OR IGNORE INTO super_admin_users (user_id, granted_by) VALUES (?, ?)").run(adminUser.id, adminUser.id);
  } catch { /* empty */ }

  // Grant required permissions
  db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, 'batches:edit')").run(adminUser.id);
  db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, 'batches:view')").run(adminUser.id);
  db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, 'courses:edit')").run(adminUser.id);
  db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, 'students:edit')").run(adminUser.id);
  db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, 'students:view')").run(adminUser.id);
  db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, 'students:academic_records')").run(adminUser.id);

  const sessionData = issueAdminSessionToken(adminUser.id, { is_super_admin: 1 });
  adminToken = sessionData.token;

  // Clean up existing test data safely across all dependent tables
  db.prepare("DELETE FROM course_routine_audits WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug = 'script-writing-workshop-2026')").run();
  db.prepare("DELETE FROM course_routine_overrides WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug = 'script-writing-workshop-2026')").run();
  db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug = 'script-writing-workshop-2026'))").run();
  db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug = 'script-writing-workshop-2026'))").run();
  db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug = 'script-writing-workshop-2026'))").run();
  db.prepare("DELETE FROM student_course_enrollments WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug = 'script-writing-workshop-2026')").run();
  db.prepare("DELETE FROM batch_students WHERE batch_id = ?").run(testBatchId);
  db.prepare("DELETE FROM batches WHERE id = ?").run(testBatchId);
  db.prepare("DELETE FROM course_definitions WHERE slug = 'script-writing-workshop-2026'").run();

  const defJson = {
    basics: { name: 'Script Writing Workshop-2026', type: 'workshop', phaseCount: 1 },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Phase 1: Story Structure',
        classCount: 1,
        routine: [
          { weekday: 'Saturday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }
        ],
        classes: [
          { id: 'cls_1', title: 'Part 01: Character Archetypes', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }
        ],
        assignments: [
          { id: 'asg_1', title: 'Character Archetype Analysis', maxMarks: 20, passMarks: 10 }
        ],
        exam: { enabled: true, title: 'Screenplay Structure Exam', maxMarks: 100, passMarks: 50 }
      }
    ]
  };

  const defRes = db.prepare(`
    INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
    VALUES ('script-writing-workshop-2026', 1, 'Script Writing Workshop-2026', 'workshop', 'published', 1, ?, ?, ?)
  `).run(JSON.stringify(defJson), adminUser.id, adminUser.id);
  testCourseDefId = defRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
    VALUES (?, 'batch-01-sww', '1st Batch', '01', 'Script Writing Workshop-2026', ?, ?)
  `).run(testBatchId, testCourseDefId, adminUser.id);

  // Seed test student Rahim Chowdhury
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
    VALUES (10, 'rahim', 'rahim@bfi.edu', 'hash', 'student', 'Rahim', 'Chowdhury', 1, 0, 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number)
    VALUES (10, 'Rahim Chowdhury', 'BFI01012026', '01')
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO batch_students (batch_id, student_id)
    VALUES (?, 10)
  `).run(testBatchId);

  db.prepare(`
    INSERT OR REPLACE INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id)
    VALUES (10, 'Script Writing Workshop-2026', 'workshop', ?, 1, ?)
  `).run(testCourseDefId, testBatchId);

  const screenshotDir = path.resolve('test-results/routine-evidence');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
});

async function injectAdminAuth(page) {
  await setupTestRouteProxy(page);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('auth_user_cache', JSON.stringify(user));
  }, {
    token: adminToken,
    user: { 
      id: adminUser.id, 
      username: adminUser.username, 
      role: 'admin', 
      first_name: adminUser.first_name || 'Abir', 
      last_name: adminUser.last_name || 'Ahmad',
      is_super_admin: 1,
      isSuperAdmin: true,
      permissions: ['*']
    }
  });
}

test.describe('Course Maker Batch Routine End-to-End Browser Verification', () => {

  test('Complete Routine Workflow: Defaults, Dual Add Slot, Validation, Persistence & Revert', async ({ page }) => {
    await injectAdminAuth(page);

    // 1. Navigate to Batch Manager for the batch (relative to baseURL)
    await page.goto(`admin/batchmanager/${testBatchId}`);
    await page.waitForLoadState('networkidle');

    // Verify page header displays "1st Batch"
    await expect(page.locator('h1, h2, h3, div').filter({ hasText: '1st Batch' }).first()).toBeVisible({ timeout: 15000 });

    // 2. Click "Adjust Routine" button
    const adjustRoutineBtn = page.locator('button').filter({ hasText: 'Adjust Routine' }).first();
    await expect(adjustRoutineBtn).toBeVisible({ timeout: 10000 });
    await adjustRoutineBtn.click();

    // 3. Modal opens with correct title
    const modalTitle = page.locator('h3').filter({ hasText: 'Adjust Batch Routine — Phase 1: Story Structure' });
    await expect(modalTitle).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/01_routine_modal_opened.png' });

    // Verify existing Slot #1 matches baseline
    await expect(page.locator('text=Slot #1')).toBeVisible();

    // 4. Test TOP "+ Add Slot" button
    const topAddSlotBtn = page.locator('button').filter({ hasText: '+ Add Slot' }).first();
    await expect(topAddSlotBtn).toBeVisible();
    await topAddSlotBtn.click();

    // Slot #2 should now appear
    await expect(page.locator('text=Slot #2')).toBeVisible();

    // Verify NEW slot defaults
    const slot2 = page.locator('text=Slot #2').locator('xpath=../..');
    
    // Check start time and end time defaults (19:00 and 21:00)
    const startTimeInput = slot2.locator('input[type="time"]').first();
    await expect(startTimeInput).toHaveValue('19:00');
    const endTimeInput = slot2.locator('input[type="time"]').nth(1);
    await expect(endTimeInput).toHaveValue('21:00');

    // Check Mode default: 'recorded'
    const modeSelect = slot2.locator('select[title="Delivery Mode"]');
    await expect(modeSelect).toHaveValue('recorded');

    // Check Category default: 'theory'
    const categorySelect = slot2.locator('select[title="Class Category"]');
    await expect(categorySelect).toHaveValue('theory');

    // Check Medium default: Zoom
    const platformTrigger = slot2.locator('button[aria-haspopup="listbox"]');
    await expect(platformTrigger).toContainText('Zoom');

    // 5. Test BOTTOM "+ Add Slot" button
    const bottomAddSlotBtn = page.locator('button').filter({ hasText: '+ Add Slot' }).last();
    await expect(bottomAddSlotBtn).toBeVisible();
    await bottomAddSlotBtn.click();

    // Slot #3 should now appear
    await expect(page.locator('text=Slot #3')).toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/02_three_slots_dual_buttons.png' });

    // 6. Test Short Reason Validation (< 3 characters)
    const reasonInput = page.locator('input[placeholder*="Adjusted shooting schedule"]');
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill('ok'); // 2 characters

    const saveBtn = page.locator('button[type="submit"]').filter({ hasText: 'Save Batch Schedule' });
    await saveBtn.click();

    // Error banner must appear and remain visible
    const errorBanner = page.locator('text=/at least 3 characters/i');
    await expect(errorBanner).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/routine-evidence/03_visible_error_banner.png' });

    // Slots must not be lost after failed validation
    await expect(page.locator('text=Slot #1')).toBeVisible();
    await expect(page.locator('text=Slot #2')).toBeVisible();
    await expect(page.locator('text=Slot #3')).toBeVisible();

    // 7. Test Overlap Schedule Conflict Rejection
    await reasonInput.fill('Updated schedule with additional weekend discussion slots');
    await saveBtn.click();

    // Overlap error banner must appear because Slot #1 and Slot #2 both defaulted to Saturday 19:00-21:00
    const overlapBanner = page.locator('text=/Overlapping routine schedule detected/i');
    await expect(overlapBanner).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/routine-evidence/04_overlap_conflict_detected.png' });

    // 8. Resolve overlap: Configure distinct weekdays for Slot #2 and Slot #3
    const slot2Weekday = slot2.locator('select').filter({ hasText: 'Saturday' }).first();
    await slot2Weekday.selectOption('Sunday');

    const slot3 = page.locator('text=Slot #3').locator('xpath=../..');
    const slot3Weekday = slot3.locator('select').filter({ hasText: 'Saturday' }).first();
    await slot3Weekday.selectOption('Tuesday');

    // Save successfully with non-conflicting schedules
    await saveBtn.click();

    // Modal should close upon successful save
    await expect(modalTitle).not.toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/05_saved_modal_closed.png' });

    // 9. Reopen modal: verify persistence
    await adjustRoutineBtn.click();
    await expect(modalTitle).toBeVisible();
    await expect(page.locator('text=Slot #1')).toBeVisible();
    await expect(page.locator('text=Slot #2')).toBeVisible();
    await expect(page.locator('text=Slot #3')).toBeVisible();

    // Close modal via Close button
    const closeBtn = page.locator('button[aria-label="Close"]');
    await closeBtn.click();
    await expect(modalTitle).not.toBeVisible();

    // 10. Page reload: verify persistence from server
    await page.reload();
    await page.waitForLoadState('networkidle');

    const adjustBtnAfterReload = page.locator('button').filter({ hasText: 'Adjust Routine' }).first();
    await expect(adjustBtnAfterReload).toBeVisible({ timeout: 10000 });
    await adjustBtnAfterReload.click();

    await expect(modalTitle).toBeVisible();
    await expect(page.locator('text=Slot #1')).toBeVisible();
    await expect(page.locator('text=Slot #2')).toBeVisible();
    await expect(page.locator('text=Slot #3')).toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/06_reloaded_persistence_verified.png' });

    // 11. Test Revert to Course Default
    const revertBtn = page.locator('button').filter({ hasText: 'Revert to Course Default' });
    await expect(revertBtn).toBeVisible();

    // Set dialog handler to accept browser confirm
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Are you sure you want to revert this batch routine');
      await dialog.accept();
    });

    await revertBtn.click();

    // Modal closes after revert
    await expect(modalTitle).not.toBeVisible({ timeout: 10000 });

    // Reopen and verify restored back to 1 baseline slot
    await adjustBtnAfterReload.click();
    await expect(modalTitle).toBeVisible();
    await expect(page.locator('text=Slot #1')).toBeVisible();
    await expect(page.locator('text=Slot #2')).not.toBeVisible();
    await expect(page.locator('text=Slot #3')).not.toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/07_reverted_to_course_default.png' });

    console.log('🎉 ALL 11 STEPS OF ROUTINE BROWSER VERIFICATION PASSED!');
  });

  test('Complete Academic Progress Workflow: Attendance, Assignment Marks, Exam Marks, Save & Reopen Persistence', async ({ page }) => {
    await injectAdminAuth(page);

    // 1. Navigate to Batch Manager for the batch
    await page.goto(`admin/batchmanager/${testBatchId}`);
    await page.waitForLoadState('networkidle');

    // Verify student "Rahim Chowdhury" is listed in the batch
    await expect(page.locator('text=Rahim Chowdhury')).toBeVisible({ timeout: 15000 });

    // 2. Click "Manage Defined Course Progress" button
    const progressBtn = page.locator('button[title*="Manage Defined Course Progress"]').first();
    await expect(progressBtn).toBeVisible({ timeout: 10000 });
    await progressBtn.click();

    // 3. Modal opens: verify header and sections
    const modalHeader = page.locator('text=Story Structure');
    await expect(modalHeader.first()).toBeVisible({ timeout: 10000 });

    // 4. Toggle Attendance for Class 1 (from Absent to Attended)
    const attBtn = page.locator('button[aria-label^="Mark class"]').first();
    await expect(attBtn).toBeVisible();
    await attBtn.click();
    await expect(attBtn).toContainText('Attended');

    // 5. Enter Assignment Marks (18 out of 20)
    const asgMarksInput = page.locator('input[type="number"][max="20"]').first();
    await expect(asgMarksInput).toBeVisible();
    await asgMarksInput.fill('18');

    // 6. Enter Exam Marks (75 out of 100)
    const examMarksInput = page.locator('input[placeholder="Enter marks"]').first();
    await expect(examMarksInput).toBeVisible();
    await examMarksInput.fill('75');

    // 7. Save Progress
    const saveBtn = page.locator('button').filter({ hasText: 'Save Progress' }).first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify success feedback
    await expect(page.locator('text=Progress updated successfully!')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/08_academic_progress_saved.png' });

    // 8. Close Modal
    const closeBtn = page.locator('button').filter({ hasText: 'Close' }).first();
    await closeBtn.click();
    await expect(page.locator('text=Progress updated successfully!')).not.toBeVisible();

    // 9. Reopen Modal to verify persistence from the database
    await progressBtn.click();
    await expect(modalHeader.first()).toBeVisible({ timeout: 10000 });

    // Verify Attendance remained Attended
    const attBtnAfterReopen = page.locator('button[aria-label^="Mark class"]').first();
    await expect(attBtnAfterReopen).toContainText('Attended');

    // Verify Assignment Marks persisted as 18
    const asgMarksAfterReopen = page.locator('input[type="number"][max="20"]').first();
    await expect(asgMarksAfterReopen).toHaveValue('18');

    // Verify Exam Marks persisted as 75
    const examMarksAfterReopen = page.locator('input[placeholder="Enter marks"]').first();
    await expect(examMarksAfterReopen).toHaveValue('75');

    await page.screenshot({ path: 'test-results/routine-evidence/09_academic_progress_persisted.png' });

    // Close modal
    await closeBtn.click();

    console.log('🎉 ACADEMIC PROGRESS MODAL BROWSER VERIFICATION PASSED WITH 100% SUCCESS!');
  });

  test('Security & Serving Parity: Synthetic hidden files in build directory are not served (404), while ordinary assets and SPA routes resolve cleanly', async ({ request }) => {
    const distPath = path.resolve(__dirname, '../dist');
    const secretPath = path.join(distPath, '.hidden-secret-token');
    fs.writeFileSync(secretPath, 'CONFIDENTIAL_STAGING_KEY_999888');

    try {
      // 1. Synthetic hidden file requested directly under /bfi-classroom/ -> 404 Not Found
      const resHiddenPrefix = await request.get('http://127.0.0.1:3098/bfi-classroom/.hidden-secret-token');
      expect(resHiddenPrefix.status()).toBe(404);
      const textHiddenPrefix = await resHiddenPrefix.text();
      expect(textHiddenPrefix.includes('CONFIDENTIAL_STAGING_KEY_999888')).toBe(false);

      // 2. Synthetic hidden file requested at root -> 404 Not Found
      const resHiddenRoot = await request.get('http://127.0.0.1:3098/.hidden-secret-token');
      expect(resHiddenRoot.status()).toBe(404);
      const textHiddenRoot = await resHiddenRoot.text();
      expect(textHiddenRoot.includes('CONFIDENTIAL_STAGING_KEY_999888')).toBe(false);

      // 3. Dotfile like .env -> 404 Not Found
      const resEnv = await request.get('http://127.0.0.1:3098/bfi-classroom/.env');
      expect(resEnv.status()).toBe(404);

      // 4. Ordinary asset resolves cleanly with 200 OK
      const resAsset = await request.get('http://127.0.0.1:3098/bfi-classroom/index.html');
      expect(resAsset.status()).toBe(200);
      const textAsset = await resAsset.text();
      expect(textAsset).toContain('<!DOCTYPE html>');

      // 5. Production bundle asset verification: Ensure browser loads candidate dist bundle, not Vite dev
      expect(textAsset).not.toContain('/@vite/client');
      expect(textAsset).toContain('/bfi-classroom/assets/main-');

      // 6. SPA Route resolves index.html with 200 OK
      const resSpa = await request.get('http://127.0.0.1:3098/bfi-classroom/admin/batches/100082');
      expect(resSpa.status()).toBe(200);
      const textSpa = await resSpa.text();
      expect(textSpa).toContain('<!DOCTYPE html>');

      console.log('🛡️ Negative dotfile security checks and production bundle loading verified successfully');
    } finally {
      if (fs.existsSync(secretPath)) fs.unlinkSync(secretPath);
    }
  });
});
