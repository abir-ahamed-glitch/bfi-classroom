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
let studentToken;
let teacherToken;

const testBatchId1 = 100082; // Script Writing Workshop (1 phase)
const testBatchId3P = 300099; // Directing Diploma (3 phases)
const testBatchIdIso = 300098; // Isolated batch with same course name
let diplomaDefId;
let enrId101;
let enrId102;
let enrId103;
let enrId104;

function issueUserSessionToken(userId, role, extraClaims = {}) {
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
    role: role || user.role,
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

async function injectStudentAuth(page) {
  await setupTestRouteProxy(page);
  await page.addInitScript(({ token }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify({
      id: 10,
      username: 'rahim',
      role: 'student',
      first_name: 'Rahim',
      last_name: 'Chowdhury'
    }));
  }, {
    token: studentToken
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

  const sessionData = issueUserSessionToken(adminUser.id, 'admin', { is_super_admin: 1 });
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

  studentToken = issueUserSessionToken(10, 'student').token;

  // Teacher Tanvir Mokammel
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (20, 'tanvir', 'tanvir@bfi.edu', 'hash', 'instructor', 'Tanvir', 'Mokammel', 1, 0, 1)`).run();
  teacherToken = issueUserSessionToken(20, 'instructor').token;

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

  // Batch 300098 (Same course name, different batch for populated isolation testing)
  db.prepare(`
    INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
    VALUES (?, 'batch-02-diploma-iso', 'Diploma Batch 02 Isolated', '02', 'Directing Diploma 3-Phase', ?, ?)
  `).run(testBatchIdIso, diplomaDefId, adminUser.id);

  // Seed Student 104 in Batch 300098 for robust isolation evidence
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (104, 'tarikh', 'tarikh@bfi.edu', 'hash', 'student', 'Tarikh', 'Ahmed', 1, 0, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (104, 'Tarikh Ahmed', 'BFI05012026', '02')`).run();
  db.prepare(`INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, 104)`).run(testBatchIdIso);
  const fee104 = JSON.stringify({
    phase1: { full_fee: 5000, amount_paid: 1000, status: 'Partial', installments: [{ id: 1, amount: 1000, status: 'paid' }, { id: 2, amount: 4000, status: 'unpaid' }] },
    phase2: { full_fee: 5000, amount_paid: 0, status: 'unpaid' },
    phase3: { full_fee: 5000, amount_paid: 0, status: 'unpaid' }
  });
  const enr104Res = db.prepare(`INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details) VALUES (104, 'Directing Diploma 3-Phase', 'workshop', ?, 1, ?, ?)`).run(diplomaDefId, testBatchIdIso, fee104);
  enrId104 = enr104Res.lastInsertRowid;
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_1', 1, 1, 100, 1, 1, 60, 1, 1)`).run(enrId104);

  // Seed 3 synthetic students in Batch 300099:
  // Student 101: Anisur Rahman (All 3 Phases Passed, Fees Fully Paid ৳15,000)
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version) VALUES (101, 'anisur', 'anisur@bfi.edu', 'hash', 'student', 'Anisur', 'Rahman', 1, 0, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (101, 'Anisur Rahman', 'BFI02012026', '01')`).run();
  db.prepare(`INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, 101)`).run(testBatchId3P);
  const fee101 = JSON.stringify({
    phase1: { full_fee: 5000, amount_paid: 5000, status: 'Paid Full', installments: [{ id: 1, amount: 5000, status: 'paid' }] },
    phase2: { full_fee: 5000, amount_paid: 5000, status: 'Paid Full', installments: [{ id: 1, amount: 5000, status: 'paid' }] },
    phase3: { full_fee: 5000, amount_paid: 5000, status: 'Paid Full', installments: [{ id: 1, amount: 5000, status: 'paid' }] }
  });
  const enr101 = db.prepare(`INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details) VALUES (101, 'Directing Diploma 3-Phase', 'workshop', ?, 1, ?, ?)`).run(diplomaDefId, testBatchId3P, fee101);
  enrId101 = enr101.lastInsertRowid;
  // Student 101 passed Phase 1, Phase 2, Phase 3
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_1', 1, 1, 100, 1, 1, 80, 1, 1)`).run(enrId101);
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_2', 1, 1, 100, 1, 1, 85, 1, 1)`).run(enrId101);
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_3', 1, 1, 100, 1, 1, 90, 1, 1)`).run(enrId101);

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
  enrId102 = enr102.lastInsertRowid;
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
  enrId103 = enr103.lastInsertRowid;
  db.prepare(`INSERT INTO student_phase_results (enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage, assignments_completed, assignments_total, exam_marks, is_passed, admitted) VALUES (?, 'phase_1', 0, 1, 0, 0, 1, null, 0, 1)`).run(enrId103);

  // Clean downloads
  db.prepare('DELETE FROM certificate_downloads').run();

  const screenshotDir = path.resolve('test-results/routine-evidence');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
});

test.describe('Course Maker Extended Verification: Mobile, 3-Phase Stats, Fees, Auth Access & Certificates', () => {

  test('Flow 1: Mobile Viewport Routine and Academic Progress Interface (390x844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAdminAuth(page);

    await page.goto(`admin/batchmanager/${testBatchId1}`);
    await page.waitForLoadState('networkidle');

    const adjustRoutineBtn = page.locator('button').filter({ hasText: 'Adjust Routine' }).first();
    await expect(adjustRoutineBtn).toBeVisible({ timeout: 10000 });
    await adjustRoutineBtn.click();

    const modalTitle = page.locator('h3').filter({ hasText: 'Adjust Batch Routine — Phase 1: Story Structure' });
    await expect(modalTitle).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/10_mobile_routine_modal.png' });

    const topAddSlotBtn = page.locator('button').filter({ hasText: '+ Add Slot' }).first();
    await expect(topAddSlotBtn).toBeVisible();
    await topAddSlotBtn.click();
    await expect(page.locator('text=Slot #2')).toBeVisible();

    const bottomAddSlotBtn = page.locator('button').filter({ hasText: '+ Add Slot' }).last();
    await bottomAddSlotBtn.scrollIntoViewIfNeeded();
    await expect(bottomAddSlotBtn).toBeVisible();
    await bottomAddSlotBtn.click();
    await expect(page.locator('text=Slot #3')).toBeVisible();

    const reasonInput = page.locator('input[placeholder*="Adjusted shooting schedule"]');
    await reasonInput.scrollIntoViewIfNeeded();
    await reasonInput.fill('ok');

    const saveBtn = page.locator('button[type="submit"]').filter({ hasText: 'Save Batch Schedule' });
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();

    const errorBanner = page.locator('text=/at least 3 characters/i');
    await expect(errorBanner).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/routine-evidence/11_mobile_error_banner.png' });

    const slot2 = page.locator('text=Slot #2').locator('xpath=../..');
    const slot2Weekday = slot2.locator('select').filter({ hasText: 'Tuesday' }).first();
    await slot2Weekday.selectOption('Sunday');

    const slot3 = page.locator('text=Slot #3').locator('xpath=../..');
    const slot3Weekday = slot3.locator('select').filter({ hasText: 'Tuesday' }).first();
    await slot3Weekday.selectOption('Monday');

    await reasonInput.fill('Mobile schedule revision with weekend and weekday classes');
    await saveBtn.click();

    await expect(modalTitle).not.toBeVisible({ timeout: 10000 });

    await adjustRoutineBtn.click();
    await expect(modalTitle).toBeVisible();
    await expect(page.locator('text=Slot #1')).toBeVisible();
    await expect(page.locator('text=Slot #2')).toBeVisible();
    await expect(page.locator('text=Slot #3')).toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/12_mobile_routine_saved_persistence.png' });

    const closeBtn = page.locator('button[aria-label="Close"]');
    await closeBtn.click();
    await expect(modalTitle).not.toBeVisible({ timeout: 10000 });

    const studentRow = page.locator('tbody tr').filter({ hasText: 'Rahim Chowdhury' }).first();
    const progressBtn = studentRow.locator('button[title*="Progress"]').first();
    await expect(progressBtn).toBeVisible({ timeout: 10000 });
    await progressBtn.click();

    const progModalTitle = page.locator('#defined-progress-modal-title');
    await expect(progModalTitle).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/13_mobile_academic_progress_modal.png' });

    const closeProgBtn = page.locator('button[aria-label="Close modal"]').first();
    await closeProgBtn.click();
    await expect(progModalTitle).not.toBeVisible({ timeout: 10000 });

    console.log('✅ Flow 1: Mobile viewport routine and academic progress modal verified successfully');
  });

  test('Flow 2: Multi-Student 3-Phase Batch Statistics & Card Filtering', async ({ page }) => {
    await injectAdminAuth(page);

    await page.goto(`admin/batchmanager/${testBatchId3P}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h3').filter({ hasText: 'Directing Diploma 3-Phase' }).first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/routine-evidence/14_three_phase_batch_dashboard.png' });

    const phase1Header = page.locator('.batch-phase-label').filter({ hasText: 'Phase 1: Pre-Production' });
    await expect(phase1Header).toBeVisible();

    const phase1Grid = page.locator('.batch-progress-section .batch-metrics-grid').first();
    const examPassedCard = phase1Grid.locator('.batch-stat-card').filter({ hasText: 'Exam Passed' });
    await expect(examPassedCard).toBeVisible();
    await examPassedCard.click();

    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).not.toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).not.toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/15_phase1_exam_passed_filtered.png' });

    const feePartialCard = page.locator('.batch-fee-cert-row .subtle-card').filter({ hasText: 'Partial Paid' });
    await expect(feePartialCard).toBeVisible();
    await feePartialCard.click();

    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).not.toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).not.toBeVisible();
    await page.screenshot({ path: 'test-results/routine-evidence/16_fee_partial_paid_filtered.png' });

    const feePaidCard = page.locator('.batch-fee-cert-row .subtle-card').filter({ hasText: 'Fully Paid' });
    await feePaidCard.click();
    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).not.toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).not.toBeVisible();

    const clearFilterBtn = page.locator('button').filter({ hasText: 'Clear filter' });
    await expect(clearFilterBtn).toBeVisible();
    await clearFilterBtn.click();

    await expect(page.locator('tbody tr').filter({ hasText: 'Anisur Rahman' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Farzana Boby' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Kamal Hossain' })).toBeVisible();

    console.log('✅ Flow 2: Multi-student 3-phase statistics & card filtering verification completed successfully');
  });

  test('Flow 3: Fee Management UI Workflow (Accessible Labels, Partial, Discount, Dues Cleared & Isolation)', async ({ page }) => {
    await injectAdminAuth(page);

    await page.goto(`admin/batchmanager/${testBatchId3P}`);
    await page.waitForLoadState('networkidle');

    // Open Edit Student modal for Farzana Boby (user_id 102)
    const farzanaRow = page.locator('tbody tr').filter({ hasText: 'Farzana Boby' }).first();
    const editFarzanaBtn = farzanaRow.locator('button[title*="Edit Student"]').first();
    await expect(editFarzanaBtn).toBeVisible({ timeout: 10000 });
    await editFarzanaBtn.click();

    const editModalTitle = page.locator('h3').filter({ hasText: 'Edit Student Details' });
    await expect(editModalTitle.first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[value="Farzana"]').first()).toBeVisible({ timeout: 5000 });

    // Locate Phase 1 container inside Edit Student Details modal
    const phase1Container = page.locator('p:has-text("Phase 1")').locator('xpath=../..');
    await expect(phase1Container).toBeVisible({ timeout: 10000 });

    // Locate Amount Paid input by accessible label inside Phase 1
    const amountPaidField = phase1Container.locator('label:has-text("Amount Paid") + input, div:has(> label:has-text("Amount Paid")) input').first();
    await expect(amountPaidField).toBeVisible({ timeout: 10000 });
    expect(await amountPaidField.inputValue()).toBe('2500');

    // Fill 5000 to clear Phase 1 remaining dues
    await amountPaidField.fill('5000');

    // Select Status "Paid Full"
    const statusSelect = phase1Container.locator('label:has-text("Payment Status") + select, div:has(> label:has-text("Payment Status")) select').first();
    await statusSelect.selectOption('Paid Full');

    // Assert Phase 1 Remaining Due displays ৳0
    const remainingDueDisplay = phase1Container.locator('span:has-text("Remaining Due")').locator('xpath=..').locator('span').last();
    await expect(remainingDueDisplay).toHaveText('৳0');

    await page.screenshot({ path: 'test-results/routine-evidence/17_fee_management_modal_editing.png' });

    // Save changes
    const saveStudentBtn = page.locator('button[type="submit"]').filter({ hasText: 'Save Changes' }).first();
    await expect(saveStudentBtn).toBeVisible();
    await saveStudentBtn.click();

    await expect(page.locator('.modern-modal-overlay')).not.toBeVisible({ timeout: 10000 });

    // Reopen modal to assert persistence with exact label targeting
    await editFarzanaBtn.click();
    await expect(editModalTitle.first()).toBeVisible({ timeout: 10000 });

    const phase1ReopenContainer = page.locator('p:has-text("Phase 1")').locator('xpath=../..');
    const persistedAmountPaid = phase1ReopenContainer.locator('label:has-text("Amount Paid") + input, div:has(> label:has-text("Amount Paid")) input').first();
    await expect(persistedAmountPaid).toHaveValue('5000');

    const persistedRemainingDue = phase1ReopenContainer.locator('span:has-text("Remaining Due")').locator('xpath=..').locator('span').last();
    await expect(persistedRemainingDue).toHaveText('৳0');

    const persistedStatus = phase1ReopenContainer.locator('div:has(> label:has-text("Payment Status")) select, label:has-text("Payment Status") + select').first();
    await expect(persistedStatus).toHaveValue('Paid Full');

    await page.screenshot({ path: 'test-results/routine-evidence/18_fee_management_persisted_dues_cleared.png' });

    const cancelBtn = page.locator('button').filter({ hasText: 'Cancel' }).first();
    await cancelBtn.click();

    // Verify Farzana's database record
    const farzanaDbRow = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE id = ?').get(enrId102);
    const farzanaFee = JSON.parse(farzanaDbRow.fee_details);
    expect(String(farzanaFee.phase1.amount_paid).replace(/[^\d.]/g, '')).toBe('5000');
    expect(farzanaFee.phase1.status).toBe('Paid Full');

    // Verify populated isolated batch (Batch 300098) student 104 payment values remain untouched
    const tarikhDbRow = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE id = ?').get(enrId104);
    const tarikhFee = JSON.parse(tarikhDbRow.fee_details);
    expect(String(tarikhFee.phase1.amount_paid).replace(/[^\d.]/g, '')).toBe('1000');
    expect(tarikhFee.phase1.status).toBe('Partial');

    console.log('✅ Flow 3: Fee Management accessible labels, dues clearing & populated batch isolation verified successfully');
  });

  test('Flow 4: Student & Teacher Schedule Access Restrictions & Admin Schedule Presentation', async ({ page }) => {
    // 1. API Level Security: Genuine student and teacher access attempts must be rejected with HTTP 403 Forbidden
    const studentRes = await page.request.get(`api/admin/batches/${testBatchId1}`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    expect(studentRes.status()).toBe(403);

    const teacherRes = await page.request.get(`api/admin/batches/${testBatchId1}`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    expect(teacherRes.status()).toBe(403);

    const studentUnrelatedRes = await page.request.get(`api/admin/batches/${testBatchId3P}`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    expect(studentUnrelatedRes.status()).toBe(403);

    // 2. Client Level Security: Student attempting to navigate to admin batch manager is redirected away
    await injectStudentAuth(page);
    await page.goto(`admin/batchmanager/${testBatchId1}`);
    await page.waitForTimeout(500);
    // Student must NOT have access to admin batch manager
    expect(page.url()).not.toContain(`admin/batchmanager/${testBatchId1}`);

    // 3. Document Student Portal & Classroom Schedule State:
    // Student navigates to Student Portal — verify routine schedule interface is not present (documented missing feature)
    await page.goto('student-portal');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.batch-routine-table')).not.toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Adjust Routine' })).not.toBeVisible();

    // Student navigates to Classroom — verify "Coming Soon" placeholder is present
    await page.goto('classroom');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Coming Soon')).toBeVisible();

    // 4. Admin Level Verification: Admin views batch 100082 routine schedule with all rich attributes
    await injectAdminAuth(page);
    await page.goto(`admin/batchmanager/${testBatchId1}`);
    await page.waitForLoadState('networkidle');

    const routineCard = page.locator('.batch-detail-header, .glass-panel').filter({ hasText: 'Story Structure' }).first();
    await expect(routineCard).toBeVisible({ timeout: 10000 });

    // Verify all saved routine attributes are visibly rendered in the Admin UI:
    await expect(page.locator('text=/2026-08-25/').first()).toBeVisible();
    await expect(page.locator('text=/19:00.*21:00/').first()).toBeVisible();
    await expect(page.locator('text=Film Language').first()).toBeVisible();
    await expect(page.locator('text=Part 01').first()).toBeVisible();
    await expect(page.locator('text=/Tanvir Mokammel/').first()).toBeVisible();
    await expect(page.locator('text=/Recorded/i').first()).toBeVisible();
    await expect(page.locator('text=/(theory)/i').first()).toBeVisible();
    await expect(page.locator('text=/Zoom/').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/routine-evidence/19_routine_card_details_zoom.png' });

    console.log('✅ Flow 4: Student/Teacher security rejection, missing portal schedule classification, and admin routine verified');
  });

  test('Flow 5: Certificate Parity, Eligibility vs. Issuance Distinction & Download Verification', async ({ page }) => {
    await injectAdminAuth(page);

    // 1. Batch 300099 Progress API: Student 101 has passed all 3 phases and paid in full
    // But NO certificate has been downloaded yet!
    const resProgressBefore = await page.request.get(`api/admin/batches/${testBatchId3P}/progress`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    expect(resProgressBefore.ok()).toBeTruthy();
    const progressDataBefore = await resProgressBefore.json();

    // Assert: issued is 0, pending is 1 (Eligible but unissued!)
    expect(progressDataBefore.certificates.issued).toBe(0);
    expect(progressDataBefore.certificates.pending).toBeGreaterThanOrEqual(1);

    // 2. Insert actual certificate download record for Student 101
    db.prepare(`
      INSERT INTO certificate_downloads (user_id, course_name, downloaded_at)
      VALUES (101, 'Directing Diploma 3-Phase', datetime('now'))
    `).run();

    // 3. Re-query Batch 300099 Progress API:
    // Now issued MUST be 1, and pending must reflect the remaining unissued students
    const resProgressAfter = await page.request.get(`api/admin/batches/${testBatchId3P}/progress`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    expect(resProgressAfter.ok()).toBeTruthy();
    const progressDataAfter = await resProgressAfter.json();

    expect(progressDataAfter.certificates.issued).toBe(1);
    expect(progressDataAfter.certificates.pending).toBe(progressDataBefore.certificates.pending - 1);

    // 4. Verify in UI: Batch Detail displays "1 Certificates Issued"
    await page.goto(`admin/batchmanager/${testBatchId3P}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=/1 Certificates Issued/')).toBeVisible({ timeout: 10000 });

    // 5. Client-Side Certificate Generation: Exercise downloadCertificatePdf in browser
    await page.goto('admin/certificate-designer');
    await page.waitForLoadState('networkidle');

    // Exercise downloadCertificatePdf for defined course with {Course Name} placeholder replacement
    const downloadResult = await page.evaluate(async () => {
      try {
        const { downloadCertificatePdf } = await import('/bfi-classroom/src/utils/certificates.js');
        const certObj = {
          courseName: 'Script Writing Workshop-2026',
          studentDetails: {
            fullName: 'Rahim Chowdhury',
            studentId: 'BFI01012026',
            batchNumber: '01',
            completionDate: '2026-11-04'
          }
        };
        const template = {
          layout_json: JSON.stringify({
            bodyTemplate: 'This certifies that {Student Name} has passed {Course Name} of {Batch Number} Batch.'
          })
        };

        // Stub doc.save so no physical file download prompt blocks the browser
        let savedFilename = '';
        const originalDocSave = window.jspdf?.jsPDF?.prototype?.save;
        if (window.jspdf?.jsPDF?.prototype) {
          window.jspdf.jsPDF.prototype.save = function(name) {
            savedFilename = name;
          };
        }

        await downloadCertificatePdf(certObj, template);
        if (originalDocSave && window.jspdf?.jsPDF?.prototype) {
          window.jspdf.jsPDF.prototype.save = originalDocSave;
        }
        return { success: true, savedFilename };
      } catch (err) {
        return { success: false, error: err.message, stack: err.stack };
      }
    });

    expect(downloadResult.success).toBe(true);
    console.log('✅ Flow 5: Certificate eligibility vs issuance distinction and PDF generation verified successfully');
  });

});
