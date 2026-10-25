import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

dotenv.config();

import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  PROD_DB_PATH,
  getTestApiUrl,
  verifyServerIsolation,
  assertServerRejectionProof,
  setupTestRouteProxy
} from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';
const COURSE_NAME = 'E2E Cinematography Masterclass';

let db;
let adminToken;
let studentToken;
let adminUser;
let studentUser;
let createdDefId;
let createdBatchId;
let testStudentId;
let createdEnrollmentId;

test.beforeAll(async () => {
  await assertServerRejectionProof('http://127.0.0.1:3001');
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
  studentUser = db.prepare("SELECT * FROM users WHERE role = 'student' ORDER BY id ASC LIMIT 1").get();
  if (!studentUser) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password', salt);
    const ins = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run('e2e_student_fallback', 'student_fallback@bfi.local', hash, 'student', 'Default', 'Student');
    studentUser = db.prepare("SELECT * FROM users WHERE id = ?").get(ins.lastInsertRowid);
  }

  const insertSession = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
    VALUES (?, 'test_session_hash', '127.0.0.1', 'playwright_test', datetime('now', '+1 day'), datetime('now'), datetime('now'), datetime('now'))
  `).run(adminUser.id);
  const adminSessionId = insertSession.lastInsertRowid;

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, type: 'access', sessionId: adminSessionId, token_version: adminUser.token_version || 1 },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  studentToken = jwt.sign(
    { id: studentUser.id, username: studentUser.username, role: studentUser.role, type: 'access' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Dedicated test student to prevent polluting production or historical records
  const existingTestStudent = db.prepare("SELECT * FROM users WHERE username = 'e2e_cm_student'").get();
  if (existingTestStudent) {
    testStudentId = existingTestStudent.id;
  } else {
    const res = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
      VALUES ('e2e_cm_student', 'e2e_cm@bfi.local', 'hash', 'student', 'E2E', 'Student', 1)
    `).run();
    testStudentId = res.lastInsertRowid;
    db.prepare(`
      INSERT INTO student_profiles (user_id, student_id, batch_number, full_name)
      VALUES (?, 'BFI-E2E-001', 'E2E Batch', 'E2E Student')
    `).run(testStudentId);
  }

  // Ensure test student is completely fresh and unassigned
  db.prepare('DELETE FROM batch_students WHERE student_id = ?').run(testStudentId);
  db.prepare('DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)').run(testStudentId);
  db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)').run(testStudentId);
  db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)').run(testStudentId);
  db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ?').run(testStudentId);

  // Clean any previous test course definition and related child records
  const oldDefs = db.prepare("SELECT id FROM course_definitions WHERE name = ?").all(COURSE_NAME).map(r => r.id);
  if (oldDefs.length > 0) {
    const placeholders = oldDefs.map(() => '?').join(',');
    db.prepare(`DELETE FROM course_routine_overrides WHERE course_definition_id IN (${placeholders})`).run(...oldDefs);
    db.prepare(`DELETE FROM course_routine_audits WHERE course_definition_id IN (${placeholders})`).run(...oldDefs);
    db.prepare(`DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (${placeholders}))`).run(...oldDefs);
    db.prepare(`DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (${placeholders}))`).run(...oldDefs);
    db.prepare(`DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (${placeholders}))`).run(...oldDefs);
    db.prepare(`DELETE FROM student_course_enrollments WHERE course_definition_id IN (${placeholders})`).run(...oldDefs);
    db.prepare(`DELETE FROM batch_students WHERE batch_id IN (SELECT id FROM batches WHERE course_definition_id IN (${placeholders}))`).run(...oldDefs);
    db.prepare(`DELETE FROM batches WHERE course_definition_id IN (${placeholders})`).run(...oldDefs);
    db.prepare(`DELETE FROM course_definitions WHERE id IN (${placeholders})`).run(...oldDefs);
  }
});

test.afterAll(() => {
  if (db) {
    if (createdEnrollmentId) {
      db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(createdEnrollmentId);
      db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(createdEnrollmentId);
      db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(createdEnrollmentId);
      db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(createdEnrollmentId);
    }
    if (createdBatchId) {
      try {
        db.prepare('DELETE FROM batch_students WHERE batch_id = ?').run(createdBatchId);
        db.prepare('DELETE FROM batch_course_fees WHERE batch_id = ?').run(createdBatchId);
        db.prepare('DELETE FROM course_settings WHERE batch_id = ?').run(createdBatchId);
        db.prepare('DELETE FROM course_routine_overrides WHERE batch_id = ?').run(createdBatchId);
        db.prepare('DELETE FROM student_course_enrollments WHERE batch_id = ?').run(createdBatchId);
        db.prepare('DELETE FROM batches WHERE id = ?').run(createdBatchId);
      } catch (err) {
        console.warn('[Cleanup Warning] createdBatchId cleanup:', err.message);
      }
    }
    const defsToClean = db.prepare("SELECT id FROM course_definitions WHERE name = ?").all(COURSE_NAME).map(r => r.id);
    if (createdDefId && !defsToClean.includes(createdDefId)) {
      defsToClean.push(createdDefId);
    }
    if (defsToClean.length > 0) {
      const placeholders = defsToClean.map(() => '?').join(',');
      db.prepare(`DELETE FROM course_routine_overrides WHERE course_definition_id IN (${placeholders})`).run(...defsToClean);
      db.prepare(`DELETE FROM course_routine_audits WHERE course_definition_id IN (${placeholders})`).run(...defsToClean);
      db.prepare(`DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (${placeholders}))`).run(...defsToClean);
      db.prepare(`DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (${placeholders}))`).run(...defsToClean);
      db.prepare(`DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE course_definition_id IN (${placeholders}))`).run(...defsToClean);
      db.prepare(`DELETE FROM student_course_enrollments WHERE course_definition_id IN (${placeholders})`).run(...defsToClean);
      db.prepare(`DELETE FROM batch_students WHERE batch_id IN (SELECT id FROM batches WHERE course_definition_id IN (${placeholders}))`).run(...defsToClean);
      db.prepare(`DELETE FROM batches WHERE course_definition_id IN (${placeholders})`).run(...defsToClean);
      db.prepare(`DELETE FROM course_definitions WHERE id IN (${placeholders})`).run(...defsToClean);
    }
    db.close();
  }
});

test.describe('Course Maker End-to-End Lifecycle & Integration Suite', () => {
  test.describe.configure({ mode: 'serial' });

  test('Step 1: Create a 3-Phase Course Definition with Practical Classes, Assignments, Exams & Discount Policy', async ({ request }) => {
    const payload = {
      name: COURSE_NAME,
      course_type: 'workshop',
      description: 'Comprehensive 3-phase hands-on cinematography program.',
      duration_value: 6,
      duration_unit: 'months',
      phase_count: 3,
      phases: [
        {
          id: 'p_1',
          phaseNumber: 1,
          name: 'Visual Grammar & Lighting',
          title: 'Visual Grammar & Lighting',
          duration: '2 Months',
          classCount: 2,
          requirements: {
            attendanceRequired: true,
            minAttendancePercent: 75
          },
          classes: [
            { id: 'c1_1', title: 'Lighting Fundamentals', mode: 'live', category: 'theory', durationMinutes: 120, mandatory: true },
            { id: 'c1_2', title: 'Camera Optics & Lenses', mode: 'live', category: 'shooting', durationMinutes: 180, mandatory: true }
          ],
          assignments: [
            { id: 'a1_1', title: '3-Point Lighting Diagram', subject: 'Lighting', maxMarks: 50, passMarks: 25, isMandatory: true }
          ],
          exam: {
            enabled: true,
            type: 'written',
            maxMarks: 50,
            passMarks: 25,
            phasePassThreshold: 50
          },
          routine: [
            { weekday: 'Saturday', startTime: '10:00', endTime: '13:00' }
          ]
        },
        {
          id: 'p_2',
          phaseNumber: 2,
          name: 'Camera Movement & Practical Shooting',
          title: 'Camera Movement & Practical Shooting',
          duration: '2 Months',
          classCount: 1,
          requirements: {
            attendanceRequired: true,
            minAttendancePercent: 80
          },
          classes: [
            { id: 'c2_1', title: 'Dolly & Gimbal Operations', mode: 'live', category: 'shooting', durationMinutes: 240, mandatory: true }
          ],
          assignments: [
            { id: 'a2_1', title: 'Dynamic Tracking Shot Exercise', subject: 'Cinematography', maxMarks: 100, passMarks: 50, isMandatory: true }
          ],
          exam: {
            enabled: false
          }
        },
        {
          id: 'p_3',
          phaseNumber: 3,
          name: 'Color Grading & Master Project',
          title: 'Color Grading & Master Project',
          duration: '2 Months',
          classCount: 1,
          requirements: {
            attendanceRequired: true,
            minAttendancePercent: 80
          },
          classes: [
            { id: 'c3_1', title: 'DaVinci Resolve Workflow', mode: 'recorded_plus_live', category: 'editing', durationMinutes: 180, mandatory: true }
          ],
          assignments: [
            { id: 'a3_1', title: 'Short Film Color Grade Portfolio', subject: 'Post-Production', maxMarks: 100, passMarks: 60, isMandatory: true }
          ],
          exam: {
            enabled: true,
            type: 'practical',
            maxMarks: 100,
            passMarks: 60,
            phasePassThreshold: 120
          }
        }
      ],
      routine: [
        { dayOfWeek: 'Friday', startTime: '16:00', endTime: '19:00', roomOrLink: 'Studio A' },
        { dayOfWeek: 'Saturday', startTime: '10:00', endTime: '13:00', roomOrLink: 'Studio B' }
      ],
      completionPolicy: {
        certificateEligibility: {
          allRequiredPhasesPassed: true,
          minOverallAttendance: 75,
          requireAllMandatoryClasses: true,
          requireAllMandatoryAssignments: true
        },
        reEnrollment: {
          discountEnabled: true,
          discountPercentage: 50.0
        }
      }
    };

    const res = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: payload
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.phase_count).toBe(3);
    expect(body.status).toBe('draft');
    createdDefId = body.id;
  });

  test('Step 2: Publish Course Definition and Enforce Immutability', async ({ request }) => {
    const pubRes = await request.post(`${API_BASE}/api/admin/course-definitions/${createdDefId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(pubRes.status()).toBe(200);
    const pubBody = await pubRes.json();
    expect(pubBody.status).toBe('published');

    // Attempting to modify structure of published definition must be rejected with 400
    const editRes = await request.put(`${API_BASE}/api/admin/course-definitions/${createdDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Hacked Published Name'
      }
    });
    expect(editRes.status()).toBe(400);
    const editBody = await editRes.json();
    expect(editBody.error).toMatch(/immutable/i);
  });

  test('Step 3: Modify Routine on Published Course with Audit Trail', async ({ request }) => {
    const newRoutine = [
      { weekday: 'Sunday', startTime: '18:00', endTime: '21:00', roomOrLink: 'Online Zoom Room' }
    ];

    const patchRes = await request.put(`${API_BASE}/api/admin/course-definitions/${createdDefId}/routine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        phase_id: 'p_1',
        routine: newRoutine,
        reason: 'Rescheduled for winter studio maintenance'
      }
    });
    expect(patchRes.status()).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.is_operational_override).toBe(true);

    // Verify course_definitions.definition_json remains unchanged (immutability preserved)
    const defRow = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(createdDefId);
    const parsedDef = JSON.parse(defRow.definition_json);
    expect(parsedDef.phases[0].routine[0].weekday).toBe('Saturday'); // original untouched

    // Verify audit record exists
    const auditsRes = await request.get(`${API_BASE}/api/admin/course-definitions/${createdDefId}/routine-audits`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(auditsRes.status()).toBe(200);
    const audits = await auditsRes.json();
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].changed_by).toBe(adminUser.id);
    expect(audits[0].reason).toBe('Rescheduled for winter studio maintenance');
  });

  test('Step 4: Create Batch Linked to Course Definition', async ({ request }) => {
    const uid = Date.now().toString().slice(-6);
    const batchPayload = {
      course_name: COURSE_NAME,
      batch_number: `E2E-${uid}`,
      batch_name: `E2E Batch ${uid}`,
      status: 'active',
      course_definition_id: createdDefId
    };

    const batchRes = await request.post(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: batchPayload
    });

    expect(batchRes.status()).toBe(201);
    const batchData = await batchRes.json();
    expect(batchData.course_definition_id).toBe(createdDefId);
    expect(batchData.course_version).toBe(1);
    createdBatchId = batchData.id;
  });

  test('Step 5: Assign Student to Batch and Verify Bound Course Definition', async ({ request }) => {
    const assignRes = await request.post(`${API_BASE}/api/admin/batches/${createdBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [testStudentId] }
    });
    expect(assignRes.status()).toBe(200);

    // Inspect student_course_enrollments table
    const enr = db.prepare(`
      SELECT * FROM student_course_enrollments 
      WHERE user_id = ? AND course_definition_id = ?
    `).get(testStudentId, createdDefId);

    expect(enr).toBeDefined();
    expect(enr.course_definition_id).toBe(createdDefId);
    expect(enr.course_version).toBe(1);
    createdEnrollmentId = enr.id;
  });

  test('Step 6: Atomic Progress Tracking Across Phases 1, 2, and 3', async ({ request }) => {
    // 1. Phase 1: Attendance + Assignment + Exam
    const resP1 = await request.put(`${API_BASE}/api/admin/students/${testStudentId}/courses/${createdEnrollmentId}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [
          { class_id: 'c1_1', attended: true },
          { class_id: 'c1_2', attended: true }
        ],
        assignments: [
          { assignment_id: 'a1_1', marks_obtained: 45 }
        ],
        exam_marks: { phase_id: 'p_1', marks: 40 }
      }
    });
    expect(resP1.status()).toBe(200);
    const bodyP1 = await resP1.json();
    expect(bodyP1.progress.phases[0].isPassed).toBe(true);

    // Authoritative Phase 2 admission before recording progress
    const admitP2 = await request.post(`${API_BASE}/api/admin/students/${testStudentId}/courses/${createdEnrollmentId}/phases/2/admit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(admitP2.status()).toBe(200);

    // 2. Phase 2: Attendance + Assignment
    const resP2 = await request.put(`${API_BASE}/api/admin/students/${testStudentId}/courses/${createdEnrollmentId}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [
          { class_id: 'c2_1', attended: true }
        ],
        assignments: [
          { assignment_id: 'a2_1', marks_obtained: 85 }
        ]
      }
    });
    expect(resP2.status()).toBe(200);
    const bodyP2 = await resP2.json();
    expect(bodyP2.progress.phases[1].isPassed).toBe(true);

    // Authoritative Phase 3 admission before recording progress
    const admitP3 = await request.post(`${API_BASE}/api/admin/students/${testStudentId}/courses/${createdEnrollmentId}/phases/3/admit`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(admitP3.status()).toBe(200);

    // 3. Phase 3: Attendance + Assignment + Exam
    const resP3 = await request.put(`${API_BASE}/api/admin/students/${testStudentId}/courses/${createdEnrollmentId}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        attendance: [
          { class_id: 'c3_1', attended: true }
        ],
        assignments: [
          { assignment_id: 'a3_1', marks_obtained: 90 }
        ],
        exam_marks: { phase_id: 'p_3', marks: 95 }
      }
    });
    expect(resP3.status()).toBe(200);
    const bodyP3 = await resP3.json();
    expect(bodyP3.progress.phases[2].isPassed).toBe(true);
    expect(bodyP3.progress.certificateEligible).toBe(true);
  });

  test('Step 7: Student Profile & Certification Dynamic Integration', async ({ request }) => {
    // Check student profile endpoint returns defined progress
    const profileRes = await request.get(`${API_BASE}/api/student/profile/${testStudentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json();
    const enrolled = profile.enrollments.find(e => e.id === createdEnrollmentId);
    expect(enrolled).toBeDefined();
    expect(enrolled.defined_progress).toBeDefined();
    expect(enrolled.defined_progress.certificateEligible).toBe(true);
    expect(enrolled.defined_progress.phases.length).toBe(3);

    // Verify batch students listing returns defined progress
    const batchStudentsRes = await request.get(`${API_BASE}/api/admin/batches/${createdBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(batchStudentsRes.status()).toBe(200);
    const batchStudents = await batchStudentsRes.json();
    const foundStudent = batchStudents.find(s => s.user_id === testStudentId);
    expect(foundStudent).toBeDefined();
    const batchEnr = foundStudent.enrollments.find(e => e.id === createdEnrollmentId);
    expect(batchEnr.defined_progress).toBeDefined();
    expect(batchEnr.defined_progress.certificateEligible).toBe(true);

    // Verify student sees their own profile using studentToken
    const studentSelfRes = await request.get(`${API_BASE}/api/student/profile`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    expect(studentSelfRes.status()).toBe(200);
  });

  test('Step 8: Re-Enrollment Discount Policy on Failure', async ({ request }) => {
    let failUserId;
    const existingFailUser = db.prepare("SELECT * FROM users WHERE username = 'e2e_fail_student'").get();
    if (existingFailUser) {
      failUserId = existingFailUser.id;
      db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id = ?)").run(failUserId);
      db.prepare("DELETE FROM student_course_enrollments WHERE user_id = ?").run(failUserId);
    } else {
      const res = db.prepare(`
        INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
        VALUES ('e2e_fail_student', 'e2e_fail@bfi.local', 'hash', 'student', 'Fail', 'Student', 1)
      `).run();
      failUserId = res.lastInsertRowid;
      db.prepare(`
        INSERT INTO student_profiles (user_id, student_id, batch_number, full_name)
        VALUES (?, 'BFI-E2E-FAIL-001', 'E2E Fail Batch', 'Fail Student')
      `).run(failUserId);
    }

    const failEnrRes = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version)
      VALUES (?, ?, 'workshop', ?, 1)
    `).run(failUserId, COURSE_NAME, createdDefId);
    const failEnrId = failEnrRes.lastInsertRowid;

    // Fail Phase 1 exam with 10 marks (pass is 25)
    const failPutRes = await request.put(`${API_BASE}/api/admin/students/${failUserId}/courses/${failEnrId}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        exam_marks: { phase_id: 'p_1', marks: 10 }
      }
    });
    expect(failPutRes.status()).toBe(200);

    const progRes = await request.get(`${API_BASE}/api/admin/students/${failUserId}/courses/${failEnrId}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(progRes.status()).toBe(200);
    const prog = await progRes.json();
    expect(prog.progress.phases[0].isPassed).toBe(false);
    expect(prog.progress.certificateEligible).toBe(false);
    expect(prog.progress.completionPolicy.reEnrollment.discountPercentage).toBe(50.0);

    // Clean up failure test enrollment
    db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(failEnrId);
    db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(failEnrId);
    db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(failEnrId);
    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(failEnrId);
  });

  test('Step 9: Backward Compatibility & Historical Enrollments Integrity', async () => {
    // Verify that the production database's historical enrollments have course_definition_id IS NULL and are uncorrupted
    const prodDb = new Database(PROD_DB_PATH, { readonly: true });
    try {
      const legacyCount = prodDb.prepare('SELECT COUNT(*) as count FROM student_course_enrollments WHERE course_definition_id IS NULL').get();
      expect(legacyCount.count).toBeGreaterThanOrEqual(911);

      // Ensure legacy step columns are intact
      const sampleLegacy = prodDb.prepare('SELECT * FROM student_course_enrollments WHERE course_definition_id IS NULL AND step4_completed = 1 LIMIT 5').all();
      expect(sampleLegacy.length).toBeGreaterThan(0);
      sampleLegacy.forEach(row => {
        expect(row.course_definition_id).toBeNull();
        expect(row.step4_completed).toBe(1);
      });
    } finally {
      prodDb.close();
    }
  });

  test('Step 10: Prevention of Implicit Conversion & Explicit Migration Path with Snapshot Audit', async ({ request }) => {
    // 10a. Create a dedicated student with legacy enrollment
    let migUserId;
    const existingMigUser = db.prepare("SELECT * FROM users WHERE username = 'e2e_legacy_mig_student'").get();
    if (existingMigUser) {
      migUserId = existingMigUser.id;
    } else {
      const res = db.prepare(`
        INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
        VALUES ('e2e_legacy_mig_student', 'e2e_legacy_mig@test.com', 'hash', 'student', 'Legacy', 'Migrant', 1)
      `).run();
      migUserId = res.lastInsertRowid;
    }

    db.prepare('DELETE FROM batch_students WHERE student_id = ?').run(migUserId);
    db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ?').run(migUserId);

    const legacyEnrRes = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, step1_completed, step2_completed, exam_written, course_definition_id
      ) VALUES (?, ?, 'workshop', 1, 1, 75, NULL)
    `).run(migUserId, COURSE_NAME);
    const legacyEnrId = legacyEnrRes.lastInsertRowid;

    // 10b. Assign student to defined course batch - MUST NOT implicitly mutate course_definition_id!
    const assignRes = await request.post(`${API_BASE}/api/admin/batches/${createdBatchId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [migUserId] }
    });
    expect(assignRes.status()).toBe(200);

    const enrAfterAssign = db.prepare('SELECT course_definition_id FROM student_course_enrollments WHERE id = ?').get(legacyEnrId);
    expect(enrAfterAssign.course_definition_id).toBeNull(); // Still legacy!

    // 10c. Explicit migration endpoint invocation
    const migrateRes = await request.post(`${API_BASE}/api/admin/students/${migUserId}/courses/${legacyEnrId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: createdDefId,
        notes: 'Verified explicit migration test'
      }
    });
    expect(migrateRes.status()).toBe(200);
    const migrateBody = await migrateRes.json();
    expect(migrateBody.success).toBe(true);

    // 10d. Verify migration audit table has snapshot
    const migrationAudit = db.prepare('SELECT * FROM legacy_enrollment_migrations WHERE enrollment_id = ?').get(legacyEnrId);
    expect(migrationAudit).toBeDefined();
    expect(migrationAudit.student_id).toBe(migUserId);
    const snapshot = JSON.parse(migrationAudit.legacy_snapshot_json);
    expect(snapshot.step2_completed).toBe(1);
    expect(snapshot.exam_written).toBe(75);

    // 10e. Verify enrollment is now cleanly bound to course definition
    const enrAfterMigrate = db.prepare('SELECT course_definition_id, course_version FROM student_course_enrollments WHERE id = ?').get(legacyEnrId);
    expect(enrAfterMigrate.course_definition_id).toBe(createdDefId);

    // Clean up
    db.prepare('DELETE FROM legacy_enrollment_migrations WHERE enrollment_id = ?').run(legacyEnrId);
    db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(legacyEnrId);
    db.prepare('DELETE FROM batch_students WHERE student_id = ?').run(migUserId);
    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(legacyEnrId);
  });

});
