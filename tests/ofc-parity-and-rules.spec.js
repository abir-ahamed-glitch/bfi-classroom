import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

dotenv.config();

import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation 
} from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;
let testStudentId;
let testCourseDefId;
let testBatchId;
let testEnrollmentId;

test.beforeAll(async () => {
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Clean all old test records completely
  db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'ofc_%'))").run();
  db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'ofc_%'))").run();
  db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'ofc_%'))").run();
  db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'ofc_%')").run();
  db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'ofc_%')").run();
  db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'ofc_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'ofc_%'").run();
  db.prepare("DELETE FROM batches WHERE batch_name LIKE 'OFC Parity%'").run();
  db.prepare("DELETE FROM course_definitions WHERE name LIKE 'OFC Parity%'").run();

  // Create a student for parity testing
  const res = db.prepare(`
    INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
    VALUES ('ofc_parity_student', '$2a$10$abcdefghijklmnopqrstuu', 'Parity', 'Student', 'parity.student@example.com', 'student', 1)
  `).run();
  testStudentId = res.lastInsertRowid;
  db.prepare(`
    INSERT INTO student_profiles (user_id, student_id, full_name)
    VALUES (?, 'PARITY001', 'Parity Student')
  `).run(testStudentId);

  // Create a 2-phase course definition modeling Online Filmmaking Course rules via Course Maker
  const ofcDefJson = JSON.stringify({
    basics: {
      name: 'OFC Parity Filmmaking Masterclass',
      type: 'filmmaking',
      description: 'Configurable course definition matching Online Filmmaking Course requirements',
      duration: { value: 6, unit: 'months' }
    },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Phase 1: Theory & Fundamentals',
        classCount: 2,
        requirements: {
          attendanceRequired: true,
          minAttendancePercent: 80,
          completionRequired: true
        },
        classes: [
          { id: 'cls_p1_1', title: 'Film Grammar', category: 'theory', mandatory: true },
          { id: 'cls_p1_2', title: 'Screenplay Basics', category: 'theory', mandatory: true }
        ],
        assignments: [
          { id: 'asg_p1_1', title: 'Screenplay Draft', subject: 'Screenwriting', maxMarks: 50, passMarks: 25, submissionRequired: true }
        ],
        exam: {
          enabled: true,
          title: 'Phase 1 Written Exam',
          type: 'written',
          maxMarks: 100,
          passMarks: 33,
          phasePassThreshold: 33
        }
      },
      {
        id: 'phase_2',
        phaseIndex: 2,
        title: 'Phase 2: Practical Production',
        classCount: 2,
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
          { id: 'cls_p2_shooting', title: 'Practical Set Shooting', category: 'shooting', mandatory: true },
          { id: 'cls_p2_editing', title: 'Post-Production Editing', category: 'editing', mandatory: true }
        ],
        assignments: [],
        exam: {
          enabled: false
        }
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
        requireFeesPaid: true
      },
      reEnrollment: {
        discountEnabled: true,
        discountPercentage: 50,
        discountDescription: '50% re-enrollment discount applied'
      }
    }
  });

  const cRes = db.prepare(`
    INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
    VALUES ('ofc-parity-filmmaking-masterclass', 'OFC Parity Filmmaking Masterclass', 'filmmaking', 2, 'published', 1, ?, ?, ?)
  `).run(ofcDefJson, adminUser.id, adminUser.id);
  testCourseDefId = cRes.lastInsertRowid;

  // Create a batch linked to this course definition
  const bRes = db.prepare(`
    INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status, created_by)
    VALUES ('OFC Parity 1st Batch', 'OP01', 'OFC Parity Filmmaking Masterclass', ?, 1, 'ongoing', ?)
  `).run(testCourseDefId, adminUser.id);
  testBatchId = bRes.lastInsertRowid;
});

test.afterAll(() => {
  if (db) {
    db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)").run(testStudentId);
    db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)").run(testStudentId);
    db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)").run(testStudentId);
    db.prepare("DELETE FROM batch_students WHERE student_id = ?").run(testStudentId);
    db.prepare("DELETE FROM student_course_enrollments WHERE user_id = ?").run(testStudentId);
    db.prepare("DELETE FROM batches WHERE batch_name LIKE 'OFC Parity %'").run();
    db.prepare("DELETE FROM course_definitions WHERE name LIKE 'OFC Parity %'").run();
    db.close();
  }
});

test.describe('Online Filmmaking Course vs Course Maker Parity & Rules Suite', () => {

  test('1. Phase Gating: Attempting to advance to Phase 2 before Phase 1 is passed is blocked with 400', async ({ request }) => {
    // 1. Assign student to batch
    const assignRes = await request.post(`${API_BASE}/api/admin/batches/${testBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [testStudentId] }
    });
    expect(assignRes.status()).toBe(200);

    const enrollment = db.prepare(`
      SELECT id FROM student_course_enrollments 
      WHERE user_id = ? AND course_definition_id = ?
    `).get(testStudentId, testCourseDefId);
    expect(enrollment).toBeTruthy();
    testEnrollmentId = enrollment.id;

    // 2. Inspect initial progress: Phase 1 is in_progress, Phase 2 is locked!
    const progressRes = await request.get(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(progressRes.status()).toBe(200);
    const body = await progressRes.json();
    const phases = body.progress.phases;
    expect(phases).toHaveLength(2);
    expect(phases[0].status).toBe('in_progress');
    expect(phases[1].isLocked).toBe(true);
    expect(phases[1].status).toBe('locked');
    expect(phases[1].lockReason).toContain('Phase 1 must be passed');

    // 3. Attempt to record Phase 2 shooting attendance while Phase 1 is unpassed -> Expect 400!
    const gatedRes = await request.put(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          attendance: [{ class_id: 'cls_p2_shooting', attended: true }]
        }
      }
    );
    expect(gatedRes.status()).toBe(400);
    const gatedErr = await gatedRes.json();
    expect(gatedErr.error).toContain('Phase 1 must be passed');
  });

  test('2. Phase Gate Clearance: Passing Phase 1 & Paying Phase 1 fee unlocks Phase 2 progression', async ({ request }) => {
    const enrollment = db.prepare(`
      SELECT id FROM student_course_enrollments 
      WHERE user_id = ? AND course_definition_id = ?
    `).get(testStudentId, testCourseDefId);
    expect(enrollment).toBeTruthy();
    testEnrollmentId = enrollment.id;

    // 1. Pass Phase 1: Attend both classes (100% >= 80%), pass assignment (45/50 >= 25), pass exam (75/100 >= 33)
    const passP1Res = await request.put(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          attendance: [
            { class_id: 'cls_p1_1', attended: true },
            { class_id: 'cls_p1_2', attended: true }
          ],
          assignments: [
            { assignment_id: 'asg_p1_1', marks: 45 }
          ],
          exam_marks: [
            { phase_id: 'phase_1', marks: 75 }
          ]
        }
      }
    );
    expect(passP1Res.status()).toBe(200);

    // 2. Set Phase 1 fee to paid
    const p1FeeDetails = JSON.stringify({
      phase1: { full_fee: 4000, amount_paid: 4000, discount: 0, status: 'Paid Full' },
      phase2: { full_fee: 4000, amount_paid: 0, discount: 0, status: 'Pending' }
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(p1FeeDetails, testEnrollmentId);

    // 3. Re-check progress: Phase 1 is passed, Phase 2 is now unlocked and pending admission!
    const progressRes = await request.get(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const body = await progressRes.json();
    expect(body.progress.phases[0].isPassed).toBe(true);
    expect(body.progress.phases[0].status).toBe('passed');
    expect(body.progress.phases[1].isLocked).toBe(false);
    expect(body.progress.phases[1].isAdmitted).toBe(false);
    expect(body.progress.phases[1].status).toBe('pending_admission');

    // 4. Authoritatively admit student to Phase 2
    const admitRes = await request.post(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/phases/2/admit`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(admitRes.status()).toBe(200);

    // 5. Now recording Phase 2 attendance succeeds without error!
    const p2Res = await request.put(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          attendance: [
            { class_id: 'cls_p2_shooting', attended: true }
          ]
        }
      }
    );
    expect(p2Res.status()).toBe(200);
  });

  test('3. Category Requirements: Phase 2 requires both shooting and editing sessions for completion', async ({ request }) => {
    // Student only attended shooting session in previous test -> Phase 2 should NOT be passed yet
    const prog1 = await request.get(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const p1Body = await prog1.json();
    const phase2_step1 = p1Body.progress.phases[1];
    expect(phase2_step1.isPassed).toBe(false);
    expect(phase2_step1.categoryStats.shooting.attended).toBe(1);
    expect(phase2_step1.categoryStats.editing.attended).toBe(0);

    // Now attend the editing session
    const attendEditRes = await request.put(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          attendance: [
            { class_id: 'cls_p2_editing', attended: true }
          ]
        }
      }
    );
    expect(attendEditRes.status()).toBe(200);

    // Verify Phase 2 is now PASSED because both shooting and editing requirements are satisfied!
    const prog2 = await request.get(
      `${API_BASE}/api/admin/students/${testStudentId}/courses/${testEnrollmentId}/defined-progress`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const p2Body = await prog2.json();
    const phase2_step2 = p2Body.progress.phases[1];
    expect(phase2_step2.isPassed).toBe(true);
    expect(phase2_step2.categoryStats.shooting.attended).toBe(1);
    expect(phase2_step2.categoryStats.editing.attended).toBe(1);
  });

  test('4. Certificate Payment Lock: Full academic completion with pending Phase 2 fee locks certificate', async ({ request }) => {
    const studentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(testStudentId);
    const studentToken = jwt.sign(
      { id: studentUser.id, username: studentUser.username, role: 'student', name: 'Parity Student' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Student has completed all phases academically, but Phase 2 fee is still pending
    const certsRes = await request.get(`${API_BASE}/api/certification/my-certificates`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    expect(certsRes.status()).toBe(200);
    const body = await certsRes.json();
    expect(body.certificates).toHaveLength(1);
    const cert = body.certificates[0];
    // Certificate is LOCKED due to unpaid Phase 2 fee!
    expect(cert.locked).toBe(true);
    expect(cert.courseName).toBe('OFC Parity Filmmaking Masterclass');

    // Pay Phase 2 fee in full
    const paidFullDetails = JSON.stringify({
      phase1: { full_fee: 4000, amount_paid: 4000, discount: 0, status: 'Paid Full' },
      phase2: { full_fee: 4000, amount_paid: 4000, discount: 0, status: 'Paid Full' }
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(paidFullDetails, testEnrollmentId);

    // Re-check certificates: Certificate is now UNLOCKED and downloadable!
    const certsRes2 = await request.get(`${API_BASE}/api/certification/my-certificates`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const body2 = await certsRes2.json();
    expect(body2.certificates[0].locked).toBeUndefined();
    expect(body2.certificates[0].studentDetails.fullName).toBe('Parity Student');
  });

  test('5. Re-Enrollment Discount Policy: Automated 50% discount applied to fee_details on new enrollment', async ({ request }) => {
    // 1. Create a second student who attempts the course and fails Phase 1
    const s2Res = db.prepare(`
      INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
      VALUES ('ofc_failing_student', '$2a$10$abcdefghijklmnopqrstuu', 'Fail', 'Student', 'fail.student@example.com', 'student', 1)
    `).run();
    const failingStudentId = s2Res.lastInsertRowid;
    db.prepare("INSERT INTO student_profiles (user_id, student_id, full_name) VALUES (?, 'FAIL001', 'Fail Student')").run(failingStudentId);

    // Enroll in Batch 1
    await request.post(`${API_BASE}/api/admin/batches/${testBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [failingStudentId] }
    });

    const enr1 = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND course_definition_id = ?').get(failingStudentId, testCourseDefId);

    // Grade Phase 1 exam with 15/100 (< 33 -> failed)
    await request.put(
      `${API_BASE}/api/admin/students/${failingStudentId}/courses/${enr1.id}/defined-progress`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          attendance: [{ class_id: 'cls_p1_1', attended: true }],
          exam_marks: [{ phase_id: 'phase_1', marks: 15 }]
        }
      }
    );

    // Verify first enrollment failed
    const progRes = await request.get(
      `${API_BASE}/api/admin/students/${failingStudentId}/courses/${enr1.id}/defined-progress`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const prog = await progRes.json();
    expect(prog.progress.failedAnyPhase).toBe(true);
    expect(prog.progress.reEnrollmentDiscount.percent).toBe(50);

    // 2. Create a second batch for re-enrollment
    const b2Res = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status, created_by)
      VALUES ('OFC Parity 2nd Batch', 'OP02', 'OFC Parity Filmmaking Masterclass', ?, 1, 'ongoing', ?)
    `).run(testCourseDefId, adminUser.id);
    const batch2Id = b2Res.lastInsertRowid;

    // 3. Assign the failing student to the new batch -> Auto-applies 50% discount!
    const assign2Res = await request.post(`${API_BASE}/api/admin/batches/${batch2Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [failingStudentId] }
    });
    expect(assign2Res.status()).toBe(200);

    // 4. Inspect the student's new enrollment in Batch 2:
    const enr2 = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(failingStudentId, batch2Id);
    expect(enr2).toBeTruthy();
    expect(enr2.fee_details).toBeTruthy();

    const parsedFees = JSON.parse(enr2.fee_details);
    expect(parsedFees.discount).toBe(4000);
    expect(parsedFees.discount_amount).toBe(4000);
    expect(parsedFees.discount_percentage).toBe(50);
    expect(parsedFees.discount_type).toBe('re_enrollment');
  });

  test('6. Batch Progress Metrics: Dynamic defined_phases breakdown and certificate counts for defined batches', async ({ request }) => {
    const progressRes = await request.get(`${API_BASE}/api/admin/batches/${testBatchId}/progress`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(progressRes.status()).toBe(200);
    const body = await progressRes.json();

    // Verify defined course response structure
    expect(body.is_defined_course).toBe(true);
    expect(body.course_definition_id).toBe(testCourseDefId);
    expect(body.defined_phases).toHaveLength(2);

    // Check Phase 1 metrics
    const p1 = body.defined_phases[0];
    expect(p1.title).toBe('Phase 1: Theory & Fundamentals');
    expect(p1.admitted).toBeGreaterThanOrEqual(1);
    expect(p1.completed).toBeGreaterThanOrEqual(1);

    // Check Phase 2 metrics
    const p2 = body.defined_phases[1];
    expect(p2.title).toBe('Phase 2: Practical Production');
    expect(p2.completed).toBeGreaterThanOrEqual(1);

    // Check backwards-compatible aliases
    expect(body.phase1).toBeTruthy();
    expect(body.phase2).toBeTruthy();
    expect(body.certificates).toBeTruthy();
    expect(body.certificates.issued).toBeGreaterThanOrEqual(1);
  });
});
