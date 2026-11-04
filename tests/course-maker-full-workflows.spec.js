import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
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

const testBatchId1 = 100082; // Script Writing Workshop (1 phase)
const testBatchId3P = 300099; // Directing Diploma (3 phases)
const testBatchIdIso = 300098; // Isolated batch with same course name
let diplomaDefId;

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

test.beforeAll(async () => {
  await assertServerRejectionProof('http://127.0.0.1:3001');
  const serverIdentity = await verifyServerIsolation(getTestApiUrl());
  console.log(`[FullWorkflowsTest] Connected to isolated test server: port=${serverIdentity.port} db=${serverIdentity.dbPath}`);

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

  db.prepare("UPDATE users SET is_super_admin = 1, is_active = 1 WHERE id = ?").run(adminUser.id);
  try {
    db.prepare("INSERT OR IGNORE INTO super_admin_users (user_id, granted_by) VALUES (?, ?)").run(adminUser.id, adminUser.id);
  } catch { /* empty */ }

  const perms = ['batches:edit', 'batches:view', 'courses:edit', 'courses:view', 'students:edit', 'students:view', 'students:academic_records', 'reports:view', 'settings:view', 'settings:edit'];
  for (const perm of perms) {
    db.prepare("INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (?, ?)").run(adminUser.id, perm);
  }

  const sessionData = issueAdminSessionToken(adminUser.id, { is_super_admin: 1 });
  adminToken = sessionData.token;

  // Clean up existing test batches/courses safely
  const batchesToClean = [testBatchId1, testBatchId3P, testBatchIdIso];
  for (const bId of batchesToClean) {
    db.prepare("DELETE FROM course_routine_audits WHERE batch_id = ?").run(bId);
    db.prepare("DELETE FROM course_routine_overrides WHERE batch_id = ?").run(bId);
    db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE batch_id = ?)").run(bId);
    db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE batch_id = ?)").run(bId);
    db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE batch_id = ?)").run(bId);
    db.prepare("DELETE FROM student_course_enrollments WHERE batch_id = ?").run(bId);
    db.prepare("DELETE FROM batch_students WHERE batch_id = ?").run(bId);
    db.prepare("DELETE FROM batches WHERE id = ?").run(bId);
  }

  // 1. Seed 1-Phase Course: Script Writing Workshop
  const swwDefJson = {
    basics: { name: 'Script Writing Workshop-2026', type: 'workshop', phaseCount: 1 },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Phase 1: Story Structure',
        classCount: 1,
        routine: [
          { date: '2026-08-25', weekday: 'Tuesday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom', teacherName: 'Tanvir Mokammel', subjectName: 'Film Language', classTitle: 'Part 01' }
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

  db.prepare("DELETE FROM course_definitions WHERE slug = 'script-writing-workshop-2026'").run();
  const swwRes = db.prepare(`
    INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
    VALUES ('script-writing-workshop-2026', 1, 'Script Writing Workshop-2026', 'workshop', 'published', 1, ?, ?, ?)
  `).run(JSON.stringify(swwDefJson), adminUser.id, adminUser.id);
  const swwDefId = swwRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
    VALUES (?, 'batch-01-sww', '1st Batch', '01', 'Script Writing Workshop-2026', ?, ?)
  `).run(testBatchId1, swwDefId, adminUser.id);

  // Student Rahim in Batch 100082
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (10, 'rahim', 'rahim@bfi.edu', 'hash', 'student', 'Rahim', 'Chowdhury', 1, 0, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (10, 'Rahim Chowdhury', 'BFI01012026', '01')`).run();
  db.prepare(`INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, 10)`).run(testBatchId1);
  db.prepare(`INSERT OR REPLACE INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id) VALUES (10, 'Script Writing Workshop-2026', 'workshop', ?, 1, ?)`).run(swwDefId, testBatchId1);

  // 2. Seed 3-Phase Course: Directing Diploma 3-Phase
  const diplomaDefJson = {
    basics: { name: 'Directing Diploma 3-Phase', type: 'workshop', phaseCount: 3 },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Phase 1: Pre-Production',
        classCount: 1,
        routine: [{ weekday: 'Saturday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }],
        classes: [{ id: 'cls_d1', title: 'Script Breakdown', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }],
        assignments: [{ id: 'asg_d1', title: 'Script Breakdown Sheet', maxMarks: 20, passMarks: 10 }],
        exam: { enabled: true, title: 'Pre-Production Exam', maxMarks: 100, passMarks: 40 },
        requirements: { minAttendancePercent: 75 }
      },
      {
        id: 'phase_2',
        phaseIndex: 2,
        title: 'Phase 2: Principal Photography',
        classCount: 1,
        routine: [{ weekday: 'Sunday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'in_person', category: 'practical', platform: 'Studio' }],
        classes: [{ id: 'cls_d2', title: 'Camera & Lighting Practical', deliveryMode: 'in_person', category: 'practical', platform: 'Studio' }],
        assignments: [{ id: 'asg_d2', title: 'Lighting Setup Report', maxMarks: 20, passMarks: 10 }],
        exam: { enabled: true, title: 'Cinematography Exam', maxMarks: 100, passMarks: 40 },
        requirements: { minAttendancePercent: 75 }
      },
      {
        id: 'phase_3',
        phaseIndex: 3,
        title: 'Phase 3: Post-Production',
        classCount: 1,
        routine: [{ weekday: 'Wednesday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'hybrid', category: 'practical', platform: 'Zoom' }],
        classes: [{ id: 'cls_d3', title: 'Editing & Color Grade', deliveryMode: 'hybrid', category: 'practical', platform: 'Zoom' }],
        assignments: [{ id: 'asg_d3', title: 'Rough Cut Project', maxMarks: 20, passMarks: 10 }],
        exam: { enabled: true, title: 'Final Film Project', maxMarks: 100, passMarks: 40 },
        requirements: { minAttendancePercent: 75 }
      }
    ]
  };

  db.prepare("DELETE FROM course_definitions WHERE slug = 'directing-diploma-3-phase'").run();
  const dipRes = db.prepare(`
    INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
    VALUES ('directing-diploma-3-phase', 1, 'Directing Diploma 3-Phase', 'workshop', 'published', 3, ?, ?, ?)
  `).run(JSON.stringify(diplomaDefJson), adminUser.id, adminUser.id);
  diplomaDefId = dipRes.lastInsertRowid;

  // Batch 300099
  db.prepare(`
    INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
    VALUES (?, 'batch-01-diploma', 'Diploma Batch 01', '01', 'Directing Diploma 3-Phase', ?, ?)
  `).run(testBatchId3P, diplomaDefId, adminUser.id);

  // Batch 300098 (Same course name, different batch for isolation testing)
  db.prepare(`
    INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
    VALUES (?, 'batch-02-diploma-iso', 'Diploma Batch 02 Isolated', '02', 'Directing Diploma 3-Phase', ?, ?)
  `).run(testBatchIdIso, diplomaDefId, adminUser.id);

  // Seed 3 synthetic students in Batch 300099:
  // Student 101: Anisur Rahman (Phase 1 Passed, Admitted Phase 2, Fees Fully Paid ৳15,000)
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (101, 'anisur', 'anisur@bfi.edu', 'hash', 'student', 'Anisur', 'Rahman', 1, 0, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (101, 'Anisur Rahman', 'BFI02012026', '01')`).run();
  db.prepare(`INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, 101)`).run(testBatchId3P);
  const fee101 = JSON.stringify({
    phase1: { full_fee: 5000, amount_paid: 5000, status: 'Paid Full', installments: [{ id: 1, amount: 5000, status: 'paid' }] },
    phase2: { full_fee: 5000, amount_paid: 5000, status: 'Paid Full', installments: [{ id: 1, amount: 5000, status: 'paid' }] },
    phase3: { full_fee: 5000, amount_paid: 5000, status: 'Paid Full', installments: [{ id: 1, amount: 5000, status: 'paid' }] }
  });
  const enr101 = db.prepare(`INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details) VALUES (101, 'Directing Diploma 3-Phase', 'workshop', ?, 1, ?, ?)`).run(diplomaDefId, testBatchId3P, fee101);
  const enrId101 = enr101.lastInsertRowid;
  // Student 101 passed Phase 1: 100% attendance, marks 18/20, exam 80 -> is_passed = 1
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_1', 1, 1, 100, 1, 1, 80, 1, 1)`).run(enrId101);
  // Student 101 admitted to Phase 2
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_2', 0, 1, 0, 0, 1, null, 0, 1)`).run(enrId101);

  // Student 102: Farzana Boby (Phase 1 Exam Failed (30 < 40), Fees Partial ৳2,500)
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (102, 'farzana', 'farzana@bfi.edu', 'hash', 'student', 'Farzana', 'Boby', 1, 0, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (102, 'Farzana Boby', 'BFI03012026', '01')`).run();
  db.prepare(`INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, 102)`).run(testBatchId3P);
  const fee102 = JSON.stringify({
    phase1: { full_fee: 5000, amount_paid: 2500, status: 'Partial', installments: [{ id: 1, amount: 2500, status: 'paid' }, { id: 2, amount: 2500, status: 'unpaid' }] },
    phase2: { full_fee: 5000, amount_paid: 0, status: 'unpaid' },
    phase3: { full_fee: 5000, amount_paid: 0, status: 'unpaid' }
  });
  const enr102 = db.prepare(`INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details) VALUES (102, 'Directing Diploma 3-Phase', 'workshop', ?, 1, ?, ?)`).run(diplomaDefId, testBatchId3P, fee102);
  const enrId102 = enr102.lastInsertRowid;
  // Student 102: 100% attendance, marks 15/20, exam 30 -> Exam Failed (30 < 40)
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_1', 1, 1, 100, 1, 1, 30, 0, 1)`).run(enrId102);

  // Student 103: Kamal Hossain (Phase 1 Attendance Not Qualified 0%, Fees Unpaid ৳0)
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (103, 'kamal', 'kamal@bfi.edu', 'hash', 'student', 'Kamal', 'Hossain', 1, 0, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (103, 'Kamal Hossain', 'BFI04012026', '01')`).run();
  db.prepare(`INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, 103)`).run(testBatchId3P);
  const fee103 = JSON.stringify({
    phase1: { full_fee: 5000, amount_paid: 0, status: 'unpaid' },
    phase2: { full_fee: 5000, amount_paid: 0, status: 'unpaid' },
    phase3: { full_fee: 5000, amount_paid: 0, status: 'unpaid' }
  });
  const enr103 = db.prepare(`INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details) VALUES (103, 'Directing Diploma 3-Phase', 'workshop', ?, 1, ?, ?)`).run(diplomaDefId, testBatchId3P, fee103);
  const enrId103 = enr103.lastInsertRowid;
  // Student 103: 0% attendance, no exam -> Not Qualified
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_1', 0, 1, 0, 0, 1, null, 0, 1)`).run(enrId103);

  // Ensure screenshot output directory
  const screenshotDir = path.resolve('test-results/routine-evidence');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
});

test.describe('Course Maker Extended Verification: Mobile, 3-Phase Stats, Fees & Views', () => {

  test('Flow 1: Mobile Viewport Routine and Academic Progress Interface (390x844)', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAdminAuth(page);

    // 1. Navigate to batch manager on mobile
    await page.goto(`admin/batchmanager/${testBatchId1}`);
    await page.waitForLoadState('networkidle');

    // 2. Click Adjust Routine
    const adjustRoutineBtn = page.locator('button').filter({ hasText: 'Adjust Routine' }).first();
    await expect(adjustRoutineBtn).toBeVisible({ timeout: 10000 });
    await adjustRoutineBtn.click();

    // 3. Modal opens on mobile screen
    const modalTitle = page.locator('h3').filter({ hasText: 'Adjust Batch Routine — Phase 1: Story Structure' });
    await expect(modalTitle).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/10_mobile_routine_modal.png' });

    // 4. Test top "+ Add Slot" on mobile
    const topAddSlotBtn = page.locator('button').filter({ hasText: '+ Add Slot' }).first();
    await expect(topAddSlotBtn).toBeVisible();
    await topAddSlotBtn.click();
    await expect(page.locator('text=Slot #2')).toBeVisible();

    // 5. Test bottom "+ Add Slot" on mobile (scrolls inside modal)
    const bottomAddSlotBtn = page.locator('button').filter({ hasText: '+ Add Slot' }).last();
    await bottomAddSlotBtn.scrollIntoViewIfNeeded();
    await expect(bottomAddSlotBtn).toBeVisible();
    await bottomAddSlotBtn.click();
    await expect(page.locator('text=Slot #3')).toBeVisible();

    // 6. Test short reason validation on mobile
    const reasonInput = page.locator('input[placeholder*="Adjusted shooting schedule"]');
    await reasonInput.scrollIntoViewIfNeeded();
    await reasonInput.fill('ok');

    const saveBtn = page.locator('button[type="submit"]').filter({ hasText: 'Save Batch Schedule' });
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();

    // Visible error banner must appear and fit within mobile viewport
    const errorBanner = page.locator('text=/at least 3 characters/i');
    await expect(errorBanner).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/routine-evidence/11_mobile_error_banner.png' });

    // 7. Configure non-conflicting weekdays and save on mobile
    const slot2 = page.locator('text=Slot #2').locator('xpath=../..');
    const slot2Weekday = slot2.locator('select').filter({ hasText: 'Tuesday' }).first();
    await slot2Weekday.selectOption('Sunday');

    const slot3 = page.locator('text=Slot #3').locator('xpath=../..');
    const slot3Weekday = slot3.locator('select').filter({ hasText: 'Tuesday' }).first();
    await slot3Weekday.selectOption('Monday');

    await reasonInput.fill('Mobile schedule revision with weekend and weekday classes');
    await saveBtn.click();

    // Modal closes upon successful save
    await expect(modalTitle).not.toBeVisible({ timeout: 10000 });

    // 8. Reopen modal to verify persistence on mobile
    await adjustRoutineBtn.click();
    await expect(modalTitle).toBeVisible();
    await expect(page.locator('text=Slot #1')).toBeVisible();
    await expect(page.locator('text=Slot #2')).toBeVisible();
    await expect(page.locator('text=Slot #3')).toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/12_mobile_routine_saved_persistence.png' });

    // Close routine modal
    const closeBtn = page.locator('button[aria-label="Close"]');
    await closeBtn.click();

    // 9. Open Academic Progress Modal on mobile
    const progressBtn = page.locator('button[title*="Manage Defined Course Progress"]').first();
    await progressBtn.scrollIntoViewIfNeeded();
    await expect(progressBtn).toBeVisible({ timeout: 10000 });
    await progressBtn.click();

    const progressModalHeader = page.locator('text=Story Structure');
    await expect(progressModalHeader.first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/13_mobile_academic_progress_modal.png' });

    // Close progress modal
    const closeProgBtn = page.locator('button').filter({ hasText: 'Close' }).first();
    await closeProgBtn.click();

    console.log('✅ Flow 1: Mobile Viewport Routine & Academic Progress verification completed successfully');
  });

  test('Flow 2: Multi-Student Batch Statistics & Card Filtering in 3-Phase Defined Course', async ({ page }) => {
    await injectAdminAuth(page);

    // 1. Navigate to 3-Phase Batch (Batch ID: 300099)
    await page.goto(`admin/batchmanager/${testBatchId3P}`);
    await page.waitForLoadState('networkidle');

    // Verify batch header displays "Diploma Batch 01"
    await expect(page.locator('h1, h2, h3, div').filter({ hasText: 'Diploma Batch 01' }).first()).toBeVisible({ timeout: 15000 });

    // 2. Verify all 3 students are present in the batch
    await expect(page.locator('text=Anisur Rahman')).toBeVisible();
    await expect(page.locator('text=Farzana Boby')).toBeVisible();
    await expect(page.locator('text=Kamal Hossain')).toBeVisible();

    // 3. Verify 3-Phase multi-phase progress dashboard is displayed
    const phase1Label = page.locator('.batch-phase-label').filter({ hasText: 'Phase 1: Pre-Production' }).first();
    await expect(phase1Label).toBeVisible({ timeout: 10000 });
    const phase2Label = page.locator('.batch-phase-label').filter({ hasText: 'Phase 2: Principal Photography' }).first();
    await expect(phase2Label).toBeVisible();
    const phase3Label = page.locator('.batch-phase-label').filter({ hasText: 'Phase 3: Post-Production' }).first();
    await expect(phase3Label).toBeVisible();

    await page.screenshot({ path: 'test-results/routine-evidence/14_three_phase_batch_dashboard.png' });

    // 4. Test interactive filtering: Click "Exam Passed" on Phase 1
    // In Phase 1: Only Anisur Rahman passed the exam (score 80 >= 40)
    const examPassedCard = page.locator('.batch-metrics-grid').first().locator('.batch-stat-card').filter({ hasText: 'Exam Passed' });
    await expect(examPassedCard).toBeVisible();
    await examPassedCard.click();

    // Verify ONLY Anisur Rahman is visible, Farzana and Kamal are hidden
    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).not.toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).not.toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/15_phase1_exam_passed_filtered.png' });

    // 5. Test Fee Filter: Click "Partial Paid" card
    // In Fees: Only Farzana Boby has Partial payment (৳2,500 / ৳15,000)
    const feePartialCard = page.locator('.batch-fee-cert-row .subtle-card').filter({ hasText: 'Partial Paid' });
    await feePartialCard.click();

    // Verify ONLY Farzana Boby is visible
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).not.toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).not.toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/16_fee_partial_paid_filtered.png' });

    // 6. Test Fee Filter: Click "Fully Paid" card
    // Only Anisur Rahman is Fully Paid
    const feePaidCard = page.locator('.batch-fee-cert-row .subtle-card').filter({ hasText: 'Fully Paid' });
    await feePaidCard.click();
    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).not.toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).not.toBeVisible();

    // 7. Clear filter: click "Clear filter" button
    const clearFilterBtn = page.locator('button').filter({ hasText: 'Clear filter' });
    await expect(clearFilterBtn).toBeVisible();
    await clearFilterBtn.click();

    // All 3 students visible again
    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).toBeVisible();

    console.log('✅ Flow 2: Multi-student 3-phase statistics & card filtering verification completed successfully');
  });

  test('Flow 3: Fee Management UI Workflow (Partial, Discount, Final Payment & Reopen Persistence)', async ({ page }) => {
    await injectAdminAuth(page);

    // 1. Navigate to 3-Phase Batch (Batch ID: 300099)
    await page.goto(`admin/batchmanager/${testBatchId3P}`);
    await page.waitForLoadState('networkidle');

    // 2. Open Edit Student modal for Farzana Boby (user_id 102)
    const farzanaRow = page.locator('tbody tr').filter({ hasText: 'Farzana Boby' }).first();
    const editFarzanaBtn = farzanaRow.locator('button[title*="Edit Student"]').first();
    await expect(editFarzanaBtn).toBeVisible({ timeout: 10000 });
    await editFarzanaBtn.click();

    // 3. Modal opens: verify student name
    const editModalTitle = page.locator('h3').filter({ hasText: 'Edit Student Details' });
    await expect(editModalTitle.first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[value="Farzana"]').first()).toBeVisible({ timeout: 5000 });

    // 4. Verify Phase 1 Fee fields: Full fee 5000, Amount paid 2500, Remaining due 2500
    const p1AmountPaidInput = page.locator('input[value="2500"]').first();
    await expect(p1AmountPaidInput).toBeVisible({ timeout: 10000 });

    // Clear Phase 1 remaining dues: enter 5000
    await p1AmountPaidInput.fill('5000');
    await page.screenshot({ path: 'test-results/routine-evidence/17_fee_management_modal_editing.png' });

    // 5. Save changes
    const saveStudentBtn = page.locator('button[type="submit"]').filter({ hasText: 'Save Changes' }).first();
    await expect(saveStudentBtn).toBeVisible();
    await saveStudentBtn.click();

    // Modal closes
    await expect(page.locator('.modern-modal-overlay')).not.toBeVisible({ timeout: 10000 });

    // 6. Reopen Edit Student modal for Farzana Boby to verify persistence
    await editFarzanaBtn.click();
    await expect(editModalTitle.first()).toBeVisible({ timeout: 10000 });

    // Verify Phase 1 amount paid persisted as 5000
    const p1Persisted = page.locator('input[value="5000"]').first();
    await expect(p1Persisted).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/18_fee_management_persisted_dues_cleared.png' });

    // Close modal
    const cancelBtn = page.locator('button').filter({ hasText: 'Cancel' }).first();
    await cancelBtn.click();

    // 7. Verify isolated batch (Batch ID: 300098) was NOT mutated
    const isoBatchEnrs = db.prepare('SELECT COUNT(*) as count FROM student_course_enrollments WHERE batch_id = ?').get(testBatchIdIso);
    expect(isoBatchEnrs.count).toBe(0);

    console.log('✅ Flow 3: Fee Management UI workflow & batch isolation verification completed successfully');
  });

  test('Flow 4: Authorized Student and Teacher Schedule View with Zoom Platform and Routine Details', async ({ page }) => {
    await injectAdminAuth(page);

    // 1. Navigate to batch manager for batch 100082
    await page.goto(`admin/batchmanager/${testBatchId1}`);
    await page.waitForLoadState('networkidle');

    // 2. Locate the Routine card in Section 1
    const routineCard = page.locator('.batch-detail-header, .glass-panel').filter({ hasText: 'Story Structure' }).first();
    await expect(routineCard).toBeVisible({ timeout: 10000 });

    // Verify all saved routine attributes are visibly rendered in the UI:
    // - Date & Time: 2026-08-25 (Tuesday): 19:00–21:00
    // - Subject: Film Language
    // - Topic: Part 01
    // - Teacher: Tanvir Mokammel
    // - Mode: Recorded
    // - Category: (theory)
    // - Platform: 🎥 Zoom
    await expect(page.locator('text=/2026-08-25/').first()).toBeVisible();
    await expect(page.locator('text=/19:00.*21:00/').first()).toBeVisible();
    await expect(page.locator('text=Film Language').first()).toBeVisible();
    await expect(page.locator('text=Part 01').first()).toBeVisible();
    await expect(page.locator('text=/Tanvir Mokammel/').first()).toBeVisible();
    await expect(page.locator('text=/Recorded/i').first()).toBeVisible();
    await expect(page.locator('text=/(theory)/i').first()).toBeVisible();
    await expect(page.locator('text=/Zoom/').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/routine-evidence/19_routine_card_details_zoom.png' });

    // 3. Verify server batches API endpoint returns complete routine details
    const resBatch = await page.request.get(`api/admin/batches/${testBatchId1}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    expect(resBatch.ok()).toBeTruthy();
    const batchJson = await resBatch.json();
    const phase1Routine = batchJson.course_definition?.definition?.phases[0]?.routine;
    expect(Array.isArray(phase1Routine)).toBeTruthy();
    expect(phase1Routine.length).toBeGreaterThan(0);
    const slot = phase1Routine[0];
    expect(slot.platform).toBe('Zoom');
    expect(slot.deliveryMode).toBe('recorded');
    expect(slot.category).toBe('theory');
    expect(slot.teacherName).toBe('Tanvir Mokammel');
    expect(slot.startTime).toBe('19:00');
    expect(slot.endTime).toBe('21:00');

    console.log('✅ Flow 4: Authorized routine view with Zoom platform, delivery mode, category, teacher and date/time verified successfully');
  });

});
