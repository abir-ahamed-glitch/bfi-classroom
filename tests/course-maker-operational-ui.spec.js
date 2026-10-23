import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
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
let testStudentId;
let testCourseDefId;
let testBatchId;
let _testEnrollmentId;

test.beforeAll(async () => {
  // 0. Verify test server isolation and rejection of production target
  await assertServerRejectionProof('http://127.0.0.1:3001');
  const serverIdentity = await verifyServerIsolation(getTestApiUrl());
  console.log(`[OperationalUI Test] Connected to isolated test server: port=${serverIdentity.port} db=${serverIdentity.dbPath}`);

  await initIsolatedTestDatabase(DB_PATH);
  db = new Database(DB_PATH);
  assertIsolatedTestDatabase(db.name || DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Clean old test records completely
  db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%'))").run();
  db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%'))").run();
  db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%'))").run();
  db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'opui_%')").run();
  db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%')").run();
  db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'opui_%'").run();
  db.prepare("DELETE FROM batches WHERE batch_name LIKE 'OpUI %'").run();
  db.prepare("DELETE FROM course_definitions WHERE name LIKE 'OpUI %'").run();

  // 1. Create a test student
  const uRes = db.prepare(`
    INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
    VALUES ('opui_test_student', '$2a$10$abcdefghijklmnopqrstuu', 'Rahim', 'Chowdhury', 'opui.student@example.com', 'student', 1)
  `).run();
  testStudentId = uRes.lastInsertRowid;
  db.prepare(`
    INSERT INTO student_profiles (user_id, student_id, full_name, batch_number)
    VALUES (?, 'OPUI001', 'Rahim Chowdhury', 'OPUI01')
  `).run(testStudentId);

  // 2. Create a 3-phase course definition
  const opuiDefJson = JSON.stringify({
    basics: {
      name: 'OpUI Advanced Directing Masterclass',
      type: 'filmmaking',
      description: '3-phase course for operational UI verification',
      duration: { value: 6, unit: 'months' }
    },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Screenwriting & Story',
        classCount: 2,
        feeAmount: 4000,
        requirements: {
          attendanceRequired: true,
          minAttendancePercent: 80,
          completionRequired: true,
          categoryRequirements: {
            theory: { minAttended: 1 }
          }
        },
        classes: [
          { id: 'cls_opui_1', title: 'Story Structure', category: 'theory', mandatory: true },
          { id: 'cls_opui_2', title: 'Character Arc', category: 'theory', mandatory: true }
        ],
        assignments: [
          { id: 'asg_opui_1', title: 'Treatment Draft', subject: 'Screenwriting', maxMarks: 50, passMarks: 25, submissionRequired: true }
        ],
        exam: {
          enabled: true,
          title: 'Screenwriting Exam',
          type: 'written',
          maxMarks: 100,
          passMarks: 40,
          phasePassThreshold: 40
        }
      },
      {
        id: 'phase_2',
        phaseIndex: 2,
        title: 'Cinematography & Directing',
        classCount: 2,
        feeAmount: 4000,
        requirements: {
          attendanceRequired: true,
          minAttendancePercent: 50,
          completionRequired: true,
          categoryRequirements: {
            shooting: { minAttended: 1 },
            editing: { minAttended: 1 }
          }
        },
        classes: [
          { id: 'cls_opui_3', title: 'Lighting & Framing', category: 'shooting', mandatory: true },
          { id: 'cls_opui_4', title: 'Post-Production Sync', category: 'editing', mandatory: true }
        ],
        assignments: [],
        exam: { enabled: false }
      },
      {
        id: 'phase_3',
        phaseIndex: 3,
        title: 'Festival Distribution',
        classCount: 1,
        feeAmount: 0,
        requirements: {
          attendanceRequired: true,
          minAttendancePercent: 50,
          completionRequired: true
        },
        classes: [
          { id: 'cls_opui_5', title: 'Festival Submission', category: 'theory', mandatory: true }
        ],
        assignments: [],
        exam: { enabled: false }
      }
    ],
    completionPolicy: {
      phaseGates: {
        sequentialProgression: true,
        requirePreviousPhasePassed: true,
        requirePreviousPhaseFeesPaid: true
      },
      certificateEligibility: {
        allRequiredPhasesPassed: true,
        minOverallAttendance: 75,
        requireFeesPaid: true
      },
      reEnrollment: {
        discountEnabled: true,
        discountPercentage: 50,
        discountDescription: '50% retake discount for failed attempts'
      }
    }
  });

  const cRes = db.prepare(`
    INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
    VALUES ('opui-advanced-directing-masterclass', 'OpUI Advanced Directing Masterclass', 'filmmaking', 3, 'published', 1, ?, ?, ?)
  `).run(opuiDefJson, adminUser.id, adminUser.id);
  testCourseDefId = cRes.lastInsertRowid;

  // 3. Create a batch
  const bRes = db.prepare(`
    INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status, created_by)
    VALUES ('OpUI 1st Batch', 'OPUI01', 'OpUI Advanced Directing Masterclass', ?, 1, 'ongoing', ?)
  `).run(testCourseDefId, adminUser.id);
  testBatchId = bRes.lastInsertRowid;

  // 4. Enroll student in batch
  const enrRes = db.prepare(`
    INSERT INTO student_course_enrollments (
      user_id, course_name, course_type, course_definition_id, course_version, batch_id,
      step1_completed, step2_completed, step3_completed, step4_completed,
      fee_details
    ) VALUES (?, 'OpUI Advanced Directing Masterclass', 'filmmaking', ?, 1, ?, 1, 0, 0, 0, ?)
  `).run(
    testStudentId,
    testCourseDefId,
    testBatchId,
    JSON.stringify({
      phase1: { full_fee: 4000, amount_paid: 4000, discount: 0, status: 'Paid Full' },
      phase2: { full_fee: 4000, amount_paid: 0, discount: 0, status: 'Pending' }
    })
  );
  _testEnrollmentId = enrRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO batch_students (batch_id, student_id, assigned_by)
    VALUES (?, ?, ?)
  `).run(testBatchId, testStudentId, adminUser.id);
});

test.afterAll(() => {
  if (db) {
    db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%'))").run();
    db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%'))").run();
    db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%'))").run();
    db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'opui_%')").run();
    db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%')").run();
    db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'opui_%')").run();
    db.prepare("DELETE FROM users WHERE username LIKE 'opui_%'").run();
    db.prepare("DELETE FROM batches WHERE batch_name LIKE 'OpUI %'").run();
    db.prepare("DELETE FROM course_definitions WHERE name LIKE 'OpUI %'").run();
    db.close();
  }
});

// Helper to inject admin auth
async function injectAdminAuth(page) {
  await setupTestRouteProxy(page);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('auth_user_cache', JSON.stringify(user));
  }, {
    token: adminToken,
    user: { id: adminUser.id, username: adminUser.username, role: 'admin', first_name: adminUser.first_name, last_name: adminUser.last_name }
  });
}

test.describe('Course Maker Operational UI & Re-Enrollment Verification', () => {

  test('1. Interactive Phase Badge in Student Manager opens DefinedCourseProgressModal directly to target phase', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students');

    // Filter or locate our student Rahim Chowdhury
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Rahim Chowdhury');
    }

    const studentRow = page.locator('tr', { hasText: 'Rahim Chowdhury' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    // Verify defined course badges (P1, P2, P3) are rendered as clickable buttons
    const p1Btn = studentRow.locator('button', { hasText: 'P1' });
    const p2Btn = studentRow.locator('button', { hasText: 'P2' });
    const p3Btn = studentRow.locator('button', { hasText: 'P3' });

    await expect(p1Btn).toBeVisible();
    await expect(p2Btn).toBeVisible();
    await expect(p3Btn).toBeVisible();

    // Click P2 badge -> opens DefinedCourseProgressModal directly to Phase 2 tab!
    await p2Btn.click();

    const modal = page.locator('.defined-course-progress-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify header details
    await expect(modal.locator('h2')).toContainText('Rahim Chowdhury');
    await expect(modal).toContainText('OpUI Advanced Directing Masterclass');
    await expect(modal).toContainText('3-Phase Curriculum');

    // Verify actionable lock banner is shown because Phase 1 is not yet passed!
    await expect(modal).toContainText('Phase Progression Blocked');
    await expect(modal).toContainText('Phase 1 must be passed before advancing to Phase 2.');

    // Close modal
    await modal.locator('button[aria-label="Close modal"]').click();
    await expect(modal).not.toBeVisible();
  });

  test('2. Operational Attendance, Assignment, and Exam recording in DefinedCourseProgressModal', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students');

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Rahim Chowdhury');
    }

    const studentRow = page.locator('tr', { hasText: 'Rahim Chowdhury' });
    const p1Btn = studentRow.locator('button', { hasText: 'P1' });
    await p1Btn.click();

    const modal = page.locator('.defined-course-progress-modal');
    await expect(modal).toBeVisible();

    // In Phase 1: verify classes checklist
    await expect(modal).toContainText('Class 1: Story Structure');
    await expect(modal).toContainText('Class 2: Character Arc');

    // Click Attended for Class 1 and Class 2
    const attendButtons = modal.locator('button', { hasText: 'Absent' });
    const count = await attendButtons.count();
    for (let i = 0; i < count; i++) {
      await attendButtons.first().click();
    }

    // Enter Assignment Marks
    const asgMarksInput = modal.locator('input[type="number"]').first();
    await asgMarksInput.fill('45');

    // Enter Exam Marks
    const examMarksInput = modal.locator('input[placeholder="Enter marks"]').first();
    await examMarksInput.fill('85');

    // Click Save Progress
    const saveBtn = modal.locator('button', { hasText: 'Save Progress' });
    await saveBtn.click();

    // Verify success feedback
    await expect(modal.locator('text=Progress updated successfully!')).toBeVisible({ timeout: 5000 });

    // Close modal
    await modal.locator('button', { hasText: 'Close' }).click();
    await expect(modal).not.toBeVisible();
  });

  test('3. Phase Gate Unlocked after Phase 1 Clearance & Practical Category Verification in Phase 2', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students');

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Rahim Chowdhury');
    }

    const studentRow = page.locator('tr', { hasText: 'Rahim Chowdhury' });
    const p2Btn = studentRow.locator('button', { hasText: 'P2' });
    await p2Btn.click();

    const modal = page.locator('.defined-course-progress-modal');
    await expect(modal).toBeVisible();

    // Phase 1 was passed and Phase 1 fee was fully paid -> Phase 2 is now UNLOCKED!
    await expect(modal.locator('text=Phase Progression Blocked')).not.toBeVisible();

    // Authoritative admission to Phase 2 via operational modal control
    const admitBtn = modal.locator('button', { hasText: 'Admit to Phase 2' });
    await expect(admitBtn).toBeVisible();
    await admitBtn.click();
    await expect(modal.locator('text=Admitted / In Progress')).toBeVisible();

    // Verify Practical Requirements Category breakdown
    await expect(modal).toContainText(/shooting/i);
    await expect(modal).toContainText(/editing/i);

    // Mark Shooting class attended (Class 1)
    const shootingClassBtn = modal.locator('button[aria-label*="class 1"]').first();
    await shootingClassBtn.click();

    // Mark Editing class attended (Class 2)
    const editingClassBtn = modal.locator('button[aria-label*="class 2"]').first();
    await editingClassBtn.click();

    // Save Phase 2 progress
    await modal.locator('button', { hasText: 'Save Progress' }).click();
    await expect(modal.locator('text=Progress updated successfully!')).toBeVisible({ timeout: 5000 });

    await modal.locator('button', { hasText: 'Close' }).click();
  });

  test('4. Batch Detail View: GraduationCap opens DefinedCourseProgressModal and reflects updated progress', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto(`/bfi-classroom/admin/batchmanager/${testBatchId}`);

    // Wait for batch detail content
    await expect(page.locator('h1', { hasText: 'OpUI 1st Batch' })).toBeVisible({ timeout: 10000 });

    const studentRow = page.locator('tr', { hasText: 'Rahim Chowdhury' });
    await expect(studentRow).toBeVisible();

    // Click GraduationCap icon button
    const capBtn = studentRow.locator('button[title*="Defined Course Progress"]');
    await expect(capBtn).toBeVisible();
    await capBtn.click();

    // Verify DefinedCourseProgressModal opens
    const modal = page.locator('.defined-course-progress-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator('h2')).toContainText('Rahim Chowdhury');

    await modal.locator('button', { hasText: 'Close' }).click();
  });

  test('5. Re-Enrollment Accounting: Failed outcome vs Incomplete and Monetary 50% discount computation', async ({ request }) => {
    // 1. Create a student who attempts and fails Phase 1
    const failRes = db.prepare(`
      INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
      VALUES ('opui_re_fail', '$2a$10$abcdefghijklmnopqrstuu', 'Karim', 'Failed', 'karim.fail@example.com', 'student', 1)
    `).run();
    const failStudentId = failRes.lastInsertRowid;
    db.prepare("INSERT INTO student_profiles (user_id, student_id, full_name) VALUES (?, 'KFAIL01', 'Karim Failed')").run(failStudentId);

    // Enroll in Batch 1
    await request.post(`${getTestApiUrl()}/api/admin/batches/${testBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [failStudentId] }
    });

    const enr1 = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND course_definition_id = ?').get(failStudentId, testCourseDefId);
    expect(enr1).toBeTruthy();

    // Score 20/100 on exam (< 40 pass mark -> explicit failed outcome)
    await request.put(`${getTestApiUrl()}/api/admin/students/${failStudentId}/courses/${enr1.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [{ class_id: 'cls_opui_1', attended: true }],
        exam_marks: [{ phase_id: 'phase_1', marks: 20 }]
      }
    });

    // 2. Create second batch for re-enrollment
    const b2Res = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status, created_by)
      VALUES ('OpUI 2nd Batch', 'OPUI02', 'OpUI Advanced Directing Masterclass', ?, 1, 'ongoing', ?)
    `).run(testCourseDefId, adminUser.id);
    const batch2Id = b2Res.lastInsertRowid;

    // 3. Assign failed student to Batch 2 -> Auto-applies 50% monetary discount
    const assignRes = await request.post(`${getTestApiUrl()}/api/admin/batches/${batch2Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [failStudentId] }
    });
    expect(assignRes.status()).toBe(200);

    const enr2 = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(failStudentId, batch2Id);
    expect(enr2).toBeTruthy();
    expect(enr2.fee_details).toBeTruthy();

    const parsedFees = JSON.parse(enr2.fee_details);
    // Unambiguous monetary and percentage accounting!
    expect(parsedFees.discount_amount).toBeGreaterThanOrEqual(4000);
    expect(parsedFees.discount_percentage).toBe(50);
    expect(parsedFees.discount_type).toBe('re_enrollment');

    // 4. Create an INCOMPLETE / ONGOING student (no failed exam or dropped status)
    const ongoingRes = db.prepare(`
      INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
      VALUES ('opui_ongoing', '$2a$10$abcdefghijklmnopqrstuu', 'Ongoing', 'Student', 'ongoing@example.com', 'student', 1)
    `).run();
    const ongoingStudentId = ongoingRes.lastInsertRowid;
    db.prepare("INSERT INTO student_profiles (user_id, student_id, full_name) VALUES (?, 'ONGOING1', 'Ongoing Student')").run(ongoingStudentId);

    // Ongoing student enrolled in Batch 1 but never failed
    await request.post(`${getTestApiUrl()}/api/admin/batches/${testBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [ongoingStudentId] }
    });

    // 3. Create a third batch
    const b3Res = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status, created_by)
      VALUES ('OpUI 3rd Batch', 'OPUI03', 'OpUI Advanced Directing Masterclass', ?, 1, 'ongoing', ?)
    `).run(testCourseDefId, adminUser.id);
    const batch3Id = b3Res.lastInsertRowid;

    // Assign ongoing student to Batch 3 -> SHOULD NOT receive failure discount!
    await request.post(`${getTestApiUrl()}/api/admin/batches/${batch3Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [ongoingStudentId] }
    });

    const enrOngoing = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(ongoingStudentId, batch3Id);
    expect(enrOngoing.fee_details).toBeNull();
  });

  test('6. Advanced Course Maker Builder Options: Practical Minimums, Progression Gates, and Review Summary', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/course-maker?mode=builder&phase=1');

    // Verify Course Basics loaded
    const titleInput = page.locator('input[placeholder*="Masterclass"]').first();
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await titleInput.fill('OpUI Test Advanced Course');

    // Verify Practical Attendance Requirements inputs are visible
    await expect(page.locator('text=Min Shooting Sessions:')).toBeVisible();
    await expect(page.locator('text=Min Editing Sessions:')).toBeVisible();

    // Verify Phase Progression Gates card is visible
    await expect(page.locator('h4', { hasText: 'Phase Progression Gates' })).toBeVisible();
    await expect(page.locator('text=Sequential progression (Phases unlocked in order)')).toBeVisible();
    await expect(page.locator('text=Require previous phase passed before advancing')).toBeVisible();
    await expect(page.locator('text=Require previous phase fees paid before advancing')).toBeVisible();

    // Verify Certificate Criteria with Fee Lock is visible
    await expect(page.locator('text=Require all phase fees to be fully paid')).toBeVisible();
    await expect(page.locator('text=Min Overall Attendance:')).toBeVisible();

    // Navigate to Review and Publish
    const reviewBtn = page.locator('button', { hasText: 'Review Rules Before Publishing' }).first();
    await reviewBtn.click();

    // Verify Review screen displays Progression Gates and Certificate Criteria
    const reviewContainer = page.locator('.cm-review-container');
    await expect(reviewContainer).toBeVisible({ timeout: 5000 });
    await expect(reviewContainer).toContainText('Phase Progression Gates:');
    await expect(reviewContainer).toContainText('Certificate Criteria:');
    await expect(reviewContainer).toContainText('Re-enrollment Policy:');
  });

  test('7. Precision Grading & Dirty Tracking: untouched assignments remain NULL, blank clears marks, intentional 0 fails, invalid IDs/ranges rejected, and locked phases blocked', async ({ request }) => {
    // 1. Create a dedicated student for precision grading verification
    const precisionStudent = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES ('opui_precision_student', 'precision@test.com', 'hash', 'student', 'Precision', 'Tester')
    `).run();
    const pStudentId = precisionStudent.lastInsertRowid;
    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, student_id, batch_number)
      VALUES (?, 'Precision Tester', 'STU-PRECISION', 'OPUI-B1')
    `).run(pStudentId);

    // Assign to test batch
    const assignRes = await request.post(`${getTestApiUrl()}/api/admin/batches/${testBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [pStudentId] }
    });
    expect(assignRes.status()).toBe(200);

    const enrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(pStudentId, testBatchId);
    expect(enrollment).toBeTruthy();

    // 2. Administrator marks ONLY attendance for class 1 — does NOT touch assignments
    const saveAttOnlyRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [{ class_id: 'cls_opui_1', attended: true }]
      }
    });
    expect(saveAttOnlyRes.status()).toBe(200);

    // CRITICAL ASSERTION: Untouched assignment MUST NOT be graded or set to 0!
    const untouchedGrade = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(enrollment.id, 'asg_opui_1');
    expect(untouchedGrade).toBeUndefined();

    // Verify progress returns isGraded = false and marksObtained = null
    const progData = await saveAttOnlyRes.json();
    const p1 = progData.progress.phases[0];
    const asg1 = p1.assignments.find(a => a.id === 'asg_opui_1');
    expect(asg1.marksObtained).toBeNull();
    expect(asg1.isGraded).toBe(false);

    // 3. Clear marks by sending null — verify it persists null, NOT 0
    const setNullRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        assignments: [{ assignment_id: 'asg_opui_1', marks_obtained: null, submission_status: 'pending' }]
      }
    });
    expect(setNullRes.status()).toBe(200);
    const nullGradeRow = db.prepare('SELECT marks_obtained FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(enrollment.id, 'asg_opui_1');
    expect(nullGradeRow.marks_obtained).toBeNull();

    // 4. Intentionally record score of 0 — verify it records 0 (distinct from null) and fails pass threshold
    const setZeroRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        assignments: [{ assignment_id: 'asg_opui_1', marks_obtained: 0, submission_status: 'graded' }]
      }
    });
    expect(setZeroRes.status()).toBe(200);
    const zeroGradeRow = db.prepare('SELECT marks_obtained FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(enrollment.id, 'asg_opui_1');
    expect(zeroGradeRow.marks_obtained).toBe(0);

    const zeroProg = await setZeroRes.json();
    const asgZero = zeroProg.progress.phases[0].assignments.find(a => a.id === 'asg_opui_1');
    expect(asgZero.marksObtained).toBe(0);
    expect(asgZero.isGraded).toBe(true);
    expect(asgZero.isPassed).toBe(false);

    // 5. Attempt to modify locked Phase 2 directly before Phase 1 is cleared -> 400 Bad Request
    const lockedRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [{ class_id: 'cls_opui_3', attended: true }]
      }
    });
    expect(lockedRes.status()).toBe(400);
    const lockedErr = await lockedRes.json();
    expect(lockedErr.error).toContain('Cannot modify attendance for Phase 2');

    // 6. Deep Server Validation: Invalid class_id rejected with 400
    const badClassRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [{ class_id: 'nonexistent_class_id_999', attended: true }]
      }
    });
    expect(badClassRes.status()).toBe(400);
    const badClassErr = await badClassRes.json();
    expect(badClassErr.error).toContain('Invalid class_id');

    // 7. Deep Server Validation: Marks exceeding maxMarks rejected with 400
    const overMarksRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        assignments: [{ assignment_id: 'asg_opui_1', marks_obtained: 999 }]
      }
    });
    expect(overMarksRes.status()).toBe(400);
    const overMarksErr = await overMarksRes.json();
    expect(overMarksErr.error).toContain('must be between 0 and 50');

    // 8. Deep Server Validation: Invalid submission_status rejected with 400
    const badStatusRes = await request.put(`${getTestApiUrl()}/api/admin/students/${pStudentId}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        assignments: [{ assignment_id: 'asg_opui_1', marks_obtained: 40, submission_status: 'invalid_status_xyz' }]
      }
    });
    expect(badStatusRes.status()).toBe(400);
    const badStatusErr = await badStatusRes.json();
    expect(badStatusErr.error).toContain('Invalid submission_status');
  });

  test('8. Role Authorization: Assigned moderators can update progress, unassigned moderators rejected with 403, instructors and students rejected with 403', async ({ request }) => {
    // 1. Create a moderator user
    const modUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES ('opui_moderator_user', 'moderator@test.com', 'hash', 'moderator', 'Mod', 'Tester')
    `).run();
    const modId = modUser.lastInsertRowid;
    const modToken = jwt.sign(
      { id: modId, username: 'opui_moderator_user', role: 'moderator', name: 'Mod Tester' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Create an instructor user
    const instUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES ('opui_instructor_user', 'instructor@test.com', 'hash', 'instructor', 'Inst', 'Tester')
    `).run();
    const instToken = jwt.sign(
      { id: instUser.lastInsertRowid, username: 'opui_instructor_user', role: 'instructor', name: 'Inst Tester' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Create a student user
    const stdUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES ('opui_student_user', 'studentuser@test.com', 'hash', 'student', 'Std', 'Tester')
    `).run();
    const stdToken = jwt.sign(
      { id: stdUser.lastInsertRowid, username: 'opui_student_user', role: 'student', name: 'Std Tester' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const enrollment = db.prepare('SELECT id, user_id FROM student_course_enrollments WHERE course_definition_id = ? LIMIT 1').get(testCourseDefId);
    expect(enrollment).toBeTruthy();

    // 2. Instructor attempted update -> 403 Forbidden
    const instRes = await request.put(`${getTestApiUrl()}/api/admin/students/${enrollment.user_id}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${instToken}` },
      data: { attendance: [{ class_id: 'cls_opui_1', attended: true }] }
    });
    expect(instRes.status()).toBe(403);

    // 3. Student attempted update -> 403 Forbidden
    const stdRes = await request.put(`${getTestApiUrl()}/api/admin/students/${enrollment.user_id}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${stdToken}` },
      data: { attendance: [{ class_id: 'cls_opui_1', attended: true }] }
    });
    expect(stdRes.status()).toBe(403);

    // 4. Moderator NOT assigned to batch -> 403 Forbidden
    const modUnassignedRes = await request.put(`${getTestApiUrl()}/api/admin/students/${enrollment.user_id}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${modToken}` },
      data: { attendance: [{ class_id: 'cls_opui_1', attended: true }] }
    });
    expect(modUnassignedRes.status()).toBe(403);
    const modErr = await modUnassignedRes.json();
    expect(modErr.error).toContain('Moderators can only modify progress for batches they are assigned to');

    // 5. Assign moderator to batch -> 200 OK
    db.prepare('INSERT OR IGNORE INTO batch_moderators (batch_id, user_id, assigned_by) VALUES (?, ?, ?)').run(testBatchId, modId, adminUser.id);

    const modAssignedRes = await request.put(`${getTestApiUrl()}/api/admin/students/${enrollment.user_id}/courses/${enrollment.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${modToken}` },
      data: { attendance: [{ class_id: 'cls_opui_1', attended: true }] }
    });
    expect(modAssignedRes.status()).toBe(200);
  });

  test('9. Operational Parity: Phase Admission, Payment Gate Defense, and Reversal for Multi-Phase Defined Courses', async ({ request, page }) => {
    // Locate Rahim's enrollment in the 3-phase course
    const enr = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND course_definition_id = ?').get(testStudentId, testCourseDefId);
    expect(enr).toBeTruthy();

    // Reset fee_details to clean slate
    db.prepare(`
      UPDATE student_course_enrollments 
      SET fee_details = json_object(
        'phase1', json_object('full_fee', 4000, 'amount_paid', 4000, 'discount', 0, 'status', 'Paid Full'),
        'phase2', json_object('full_fee', 4000, 'amount_paid', 0, 'discount', 0, 'status', 'Pending'),
        'phase3', json_object('full_fee', 2000, 'amount_paid', 0, 'discount', 0, 'status', 'Pending')
      )
      WHERE id = ?
    `).run(enr.id);

    // 1. Attempt to admit to Phase 2 before Phase 1 is passed -> Rejected 400
    // Reset phase 1 records so it's not passed
    db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(enr.id);
    db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(enr.id);
    db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(enr.id);

    const prematureAdmitRes = await request.post(`${getTestApiUrl()}/api/admin/students/${testStudentId}/courses/${enr.id}/phases/2/admit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(prematureAdmitRes.status()).toBe(400);
    const premErr = await prematureAdmitRes.json();
    expect(premErr.error).toContain('Phase 1 must be passed first');

    // 2. Complete Phase 1 requirements
    await request.put(`${getTestApiUrl()}/api/admin/students/${testStudentId}/courses/${enr.id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [
          { class_id: 'cls_opui_1', attended: true },
          { class_id: 'cls_opui_2', attended: true }
        ],
        assignments: [
          { assignment_id: 'asg_opui_1', marks: 25, submission_status: 'graded' }
        ],
        exam_marks: [
          { phase_id: 'phase_1', marks: 85 }
        ]
      }
    });

    // 3. Now admit to Phase 2 -> 200 OK
    const validAdmitRes = await request.post(`${getTestApiUrl()}/api/admin/students/${testStudentId}/courses/${enr.id}/phases/2/admit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(validAdmitRes.status()).toBe(200);
    const admitBody = await validAdmitRes.json();
    expect(admitBody.progress.phases[1].isAdmitted).toBe(true);

    // 4. Undo admission while NO payment is recorded -> 200 OK
    const unadmitRes = await request.post(`${getTestApiUrl()}/api/admin/students/${testStudentId}/courses/${enr.id}/phases/2/unadmit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(unadmitRes.status()).toBe(200);
    const unadmitBody = await unadmitRes.json();
    expect(unadmitBody.progress.phases[1].isAdmitted).toBe(false);

    // 5. Re-admit to Phase 2
    await request.post(`${getTestApiUrl()}/api/admin/students/${testStudentId}/courses/${enr.id}/phases/2/admit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    // 6. Record payment for Phase 2
    db.prepare(`
      UPDATE student_course_enrollments 
      SET fee_details = json_set(fee_details, '$.phase2.amount_paid', 2000, '$.phase2.status', 'Partial')
      WHERE id = ?
    `).run(enr.id);

    // 7. Attempt undoing admission after payment recorded -> Strictly rejected 400 Bad Request
    const paidUnadmitRes = await request.post(`${getTestApiUrl()}/api/admin/students/${testStudentId}/courses/${enr.id}/phases/2/unadmit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(paidUnadmitRes.status()).toBe(400);
    const paidErr = await paidUnadmitRes.json();
    expect(paidErr.error).toContain('Cannot undo phase admission: payment has already been recorded for this phase.');

    // 8. Interactive UI verification of Phase Status & disabled Undo button
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students');

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Rahim Chowdhury');
    }

    const studentRow = page.locator('tr', { hasText: 'Rahim Chowdhury' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    const p2Btn = studentRow.locator('button', { hasText: 'P2' });
    await p2Btn.click();

    const modal = page.locator('.defined-course-progress-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify Phase 2 status card shows Admitted
    await expect(modal).toContainText('Phase 2 Status:');
    await expect(modal).toContainText('Admitted / In Progress');

    // Verify Fee Status indicates Partial payment
    await expect(modal).toContainText('Fee Status: Partial');

    // Verify Undo Admission button is disabled with payment warning
    const undoBtn = modal.locator('button', { hasText: 'Undo Admission (Payment Recorded)' });
    await expect(undoBtn).toBeVisible();
    await expect(undoBtn).toBeDisabled();

    // Verify touch target dimensions meet or exceed 44x44 px (WCAG AAA / mobile accessibility standard)
    const undoBox = await undoBtn.boundingBox();
    expect(undoBox).not.toBeNull();
    expect(undoBox.height).toBeGreaterThanOrEqual(44);
    expect(undoBox.width).toBeGreaterThanOrEqual(44);

    await modal.locator('button[aria-label="Close modal"]').click();
  });

});
