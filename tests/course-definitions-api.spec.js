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
  verifyServerIsolation,
  setupTestRouteProxy
} from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let moderatorToken;
let instructorToken;
let studentToken;
let multiBatchStudentToken;
let adminUser;
let studentUser;
let soundCourseId;

function cleanupTestArtifacts(database) {
  try {
    database.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (99995, 99996))").run();
    database.prepare("DELETE FROM legacy_enrollment_migrations WHERE student_id IN (99995, 99996)").run();
    database.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (99995, 99996)").run();
    database.prepare("DELETE FROM student_course_enrollments WHERE course_name LIKE 'Test Multi-Batch%' OR course_name LIKE 'Test Batch Association%'").run();
    database.prepare("DELETE FROM batch_students WHERE student_id IN (99995, 99996, 99997, 99994)").run();
    database.prepare("DELETE FROM batch_students WHERE batch_id IN (SELECT id FROM batches WHERE batch_name LIKE 'Test Sound Batch%' OR batch_name LIKE 'Test Multi-Batch%' OR batch_name LIKE 'Assoc Batch%')").run();
    database.prepare("DELETE FROM batch_moderators WHERE user_id = 99998").run();
    database.prepare("DELETE FROM course_routine_audits WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug LIKE 'test-%')").run();
    database.prepare("DELETE FROM course_routine_overrides WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug LIKE 'test-%')").run();
    database.prepare("DELETE FROM batches WHERE batch_name LIKE 'Test Sound Batch%' OR batch_name LIKE 'Test Multi-Batch%' OR batch_name LIKE 'Assoc Batch%'").run();
    database.prepare("DELETE FROM course_definitions WHERE slug LIKE 'test-%'").run();
    database.prepare("DELETE FROM users WHERE id IN (99998, 99997, 99996, 99995, 99994)").run();
  } catch (err) {
    console.error('Cleanup warning:', err.message);
  }
}

test.beforeAll(async () => {
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  studentUser = db.prepare("SELECT * FROM users WHERE role = 'student' LIMIT 1").get();

  cleanupTestArtifacts(db);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99998, 'test_moderator', 'mod_test@bfibd.org', 'test_hash', 'moderator', 'Test', 'Moderator', 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99997, 'test_instructor', 'inst_test@bfibd.org', 'test_hash', 'instructor', 'Test', 'Instructor', 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99996, 'test_student_assoc', 'assoc_student@bfibd.org', 'test_hash', 'student', 'Assoc', 'Student', 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99995, 'test_multibatch', 'multibatch_test@bfibd.org', 'test_hash', 'student', 'Multi', 'BatchStudent', 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99994, 'test_student_archived', 'archived_student@bfibd.org', 'test_hash', 'student', 'Archived', 'Student', 1)
  `).run();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  moderatorToken = jwt.sign(
    { id: 99998, username: 'test_moderator', role: 'moderator' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  instructorToken = jwt.sign(
    { id: 99997, username: 'test_instructor', role: 'instructor' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  studentToken = jwt.sign(
    { id: studentUser.id, username: studentUser.username, role: studentUser.role },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  multiBatchStudentToken = jwt.sign(
    { id: 99995, username: 'test_multibatch', role: 'student' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
});

  test('12. Routine edits reject overlapping or malformed slots without changing schedules or audits', async ({ request }) => {
    const slot = (weekday, startTime, endTime) => ({ weekday, startTime, endTime, timezone: 'Asia/Dhaka' });
    const baseline = [slot('Saturday', '10:00', '12:00')];
    const invalidRoutines = [
      [slot('Friday', '18:00', '20:00'), slot('Friday', '19:00', '21:00')],
      [slot('Friday', '18:00', '21:00'), slot('Friday', '19:00', '20:00')],
      [slot('Friday', '18:00', '20:00'), slot('Friday', '18:00', '20:00')],
      [null],
      ['Friday'],
      [[]],
    ];

    for (const status of ['draft', 'published']) {
      const definitionJson = JSON.stringify({ phases: [{ id: 'phase_1', title: 'Routine validation', routine: baseline }] });
      const defId = db.prepare(`
        INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
        VALUES (?, ?, 'workshop', 1, ?, 1, ?, ?, ?)
      `).run(`test-routine-validation-${status}`, `Test Routine Validation ${status}`, status, definitionJson, adminUser.id, adminUser.id).lastInsertRowid;
      const batchId = db.prepare(`
        INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
        VALUES (?, ?, ?, 'active', ?, 1, ?)
      `).run(`Test Sound Batch Routine ${status}`, `RV-${status}`, `Test Routine Validation ${status}`, defId, adminUser.id).lastInsertRowid;
      const readState = () => ({
        definition: db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(defId),
        overrides: db.prepare('SELECT * FROM course_routine_overrides WHERE course_definition_id = ? ORDER BY id').all(defId),
        audits: db.prepare('SELECT * FROM course_routine_audits WHERE course_definition_id = ? ORDER BY id').all(defId),
      });

      for (const targetBatch of [null, batchId]) {
        for (const routine of invalidRoutines) {
          const before = readState();
          const response = await request.put(`${API_BASE}/api/admin/course-definitions/${defId}/routine`, {
            headers: { Authorization: `Bearer ${adminToken}` },
            data: { phase_id: 'phase_1', batch_id: targetBatch, routine, reason: 'Validate routine edit' },
          });
          expect(response.status(), JSON.stringify({ status, targetBatch, routine })).toBe(400);
          expect((await response.json()).error).toMatch(/overlap|slot/i);
          expect(readState()).toEqual(before);
        }

        // Adjacent slots, unsorted input, and the same times on different days remain valid.
        const validRoutine = [slot('Friday', '20:00', '21:00'), slot('Friday', '18:00', '20:00'), slot('Saturday', '18:00', '20:00')];
        const before = readState();
        const response = await request.put(`${API_BASE}/api/admin/course-definitions/${defId}/routine`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: { phase_id: 'phase_1', batch_id: targetBatch, routine: validRoutine, reason: 'Valid adjacent routine edit' },
        });
        expect(response.status()).toBe(200);
        const after = readState();
        expect(after.audits).toHaveLength(before.audits.length + 1);
        const override = after.overrides.find(row => row.batch_id === (targetBatch || 0));
        expect(JSON.parse(override.routine_json)).toEqual(validRoutine);
        if (status === 'published') expect(after.definition).toEqual(before.definition);
      }
    }
  });

test.afterAll(() => {
  if (db) {
    cleanupTestArtifacts(db);
    db.close();
  }
});

test.describe('Course Definitions API & Validation Suite', () => {

  test('1. Reject draft creation with invalid phase count (< 1 or > 5)', async ({ request }) => {
    const resZero = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Invalid Zero Phases',
        course_type: 'workshop',
        phase_count: 0
      }
    });
    expect(resZero.status()).toBe(400);
    const bodyZero = await resZero.json();
    expect(bodyZero.error).toMatch(/phase_count must be between 1 and 5/i);

    const resSix = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Invalid Six Phases',
        course_type: 'workshop',
        phase_count: 6
      }
    });
    expect(resSix.status()).toBe(400);
    const bodySix = await resSix.json();
    expect(bodySix.error).toMatch(/phase_count must be between 1 and 5/i);
  });

  test('2. Reject non-admin role attempting to create course definition', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: {
        name: 'Student Unauthorized Course',
        course_type: 'workshop',
        phase_count: 1
      }
    });
    expect(res.status()).toBe(403);
  });

  test('3. Create valid draft course definition with 3 phases', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Sound Design Masterclass',
        course_type: 'workshop',
        description: 'Comprehensive 3-phase sound engineering and post-production workshop',
        duration_value: 3,
        duration_unit: 'months',
        phase_count: 3,
        phases: [
          {
            id: 'phase_1',
            phaseIndex: 1,
            title: 'Acoustics & Microphones',
            classCount: 2,
            requirements: { attendanceRequired: true, minAttendancePercent: 80, completionRequired: true },
            routine: [{ weekday: 'Saturday', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c1', title: 'Acoustics Fundamentals', deliveryMode: 'live', category: 'theory', durationMinutes: 120, mandatory: true },
              { id: 'c2', title: 'Location Audio Recording', deliveryMode: 'live', category: 'shooting', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              { id: 'a1', title: 'Field Recording Take', submissionRequired: true, maxMarks: 20, passMarks: 10 }
            ],
            exam: { enabled: true, title: 'Phase 1 Sound Theory', type: 'written', maxMarks: 80, passMarks: 32, phasePassThreshold: 45, includeAssignmentsInTotal: true }
          },
          {
            id: 'phase_2',
            phaseIndex: 2,
            title: 'DAW & Dialogue Editing',
            classCount: 2,
            requirements: { attendanceRequired: true, minAttendancePercent: 75, completionRequired: true },
            routine: [{ weekday: 'Sunday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c3', title: 'Pro Tools & Nuendo Workflow', deliveryMode: 'live', category: 'editing', durationMinutes: 120, mandatory: true },
              { id: 'c4', title: 'Noise Reduction Lab', deliveryMode: 'recorded_plus_live_discussion', category: 'practical', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              { id: 'a2', title: 'Dialogue Cleaning Session', submissionRequired: true, maxMarks: 30, passMarks: 15 }
            ],
            exam: { enabled: true, title: 'Phase 2 Practical Exam', type: 'practical', maxMarks: 70, passMarks: 30, phasePassThreshold: 50, includeAssignmentsInTotal: true }
          },
          {
            id: 'phase_3',
            phaseIndex: 3,
            title: 'Foley, Sound Design & 5.1 Surround Mixing',
            classCount: 2,
            requirements: { attendanceRequired: true, minAttendancePercent: 75, completionRequired: true },
            routine: [{ weekday: 'Wednesday', startTime: '18:00', endTime: '21:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c5', title: 'Foley Recording Session', deliveryMode: 'live', category: 'practical', durationMinutes: 180, mandatory: true },
              { id: 'c6', title: 'Dolby Atmos & 5.1 Delivery', deliveryMode: 'live', category: 'theory', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              { id: 'a3', title: 'Short Film Final Mix', submissionRequired: true, maxMarks: 50, passMarks: 25 }
            ],
            exam: { enabled: true, title: 'Graduation Final Assessment', type: 'written', maxMarks: 50, passMarks: 25, phasePassThreshold: 60, includeAssignmentsInTotal: true }
          }
        ],
        completionPolicy: {
          certificate: { minOverallAttendance: 75, requireAllPhases: true },
          reEnrollment: { discountEnabled: true, discountPercentage: 50 }
        }
      }
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.slug).toBe('test-sound-design-masterclass');
    expect(body.version).toBe(1);
    expect(body.status).toBe('draft');
    soundCourseId = body.id;
  });

  test('4. Retrieve course definitions list and detail by ID/slug', async ({ request }) => {
    const listRes = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    const found = list.find(c => c.id === soundCourseId);
    expect(found).toBeDefined();
    expect(found.phase_count).toBe(3);

    const detailRes = await request.get(`${API_BASE}/api/admin/course-definitions/${soundCourseId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.name).toBe('Test Sound Design Masterclass');
    expect(detail.definition.phases.length).toBe(3);
  });

  test('5. Reject duplicate IDs, invalid schedules, and contradictory grading rules', async ({ request }) => {
    // 5a. Reject duplicate Phase ID
    const dupPhaseRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Duplicate Phase IDs',
        course_type: 'workshop',
        phase_count: 2,
        phases: [
          { id: 'same_phase_id', phaseIndex: 1, title: 'Phase 1' },
          { id: 'same_phase_id', phaseIndex: 2, title: 'Phase 2' }
        ]
      }
    });
    expect(dupPhaseRes.status()).toBe(400);
    const dupPhaseErr = await dupPhaseRes.json();
    expect(dupPhaseErr.error).toMatch(/duplicate phase id/i);

    // 5b. Reject duplicate Class ID across phases
    const dupClassRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Duplicate Class IDs',
        course_type: 'workshop',
        phase_count: 2,
        phases: [
          { id: 'p1', phaseIndex: 1, title: 'Phase 1', classes: [{ id: 'duplicate_class_id', title: 'C1' }] },
          { id: 'p2', phaseIndex: 2, title: 'Phase 2', classes: [{ id: 'duplicate_class_id', title: 'C2' }] }
        ]
      }
    });
    expect(dupClassRes.status()).toBe(400);
    const dupClassErr = await dupClassRes.json();
    expect(dupClassErr.error).toMatch(/duplicate class id/i);

    // 5c. Reject duplicate Assignment ID
    const dupAsgRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Duplicate Asg IDs',
        course_type: 'workshop',
        phase_count: 2,
        phases: [
          { id: 'p1', phaseIndex: 1, title: 'Phase 1', assignments: [{ id: 'dup_asg', title: 'A1', maxMarks: 10, passMarks: 5 }] },
          { id: 'p2', phaseIndex: 2, title: 'Phase 2', assignments: [{ id: 'dup_asg', title: 'A2', maxMarks: 10, passMarks: 5 }] }
        ]
      }
    });
    expect(dupAsgRes.status()).toBe(400);
    const dupAsgErr = await dupAsgRes.json();
    expect(dupAsgErr.error).toMatch(/duplicate assignment id/i);

    // 5d. Reject invalid schedule where end time is before start time
    const badTimeRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Inverted Schedule',
        course_type: 'workshop',
        phase_count: 1,
        phases: [
          {
            id: 'p1',
            phaseIndex: 1,
            title: 'Phase 1',
            routine: [{ weekday: 'Saturday', startTime: '18:00', endTime: '16:00' }]
          }
        ]
      }
    });
    expect(badTimeRes.status()).toBe(400);
    const badTimeErr = await badTimeRes.json();
    expect(badTimeErr.error).toMatch(/end time.*strictly after start time/i);

    // 5e. Reject contradictory grading rules (threshold < exam.passMarks)
    const badThresholdRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Contradictory Threshold',
        course_type: 'workshop',
        phase_count: 1,
        phases: [
          {
            id: 'p1',
            phaseIndex: 1,
            title: 'Phase 1',
            exam: { enabled: true, maxMarks: 80, passMarks: 40, phasePassThreshold: 30 }
          }
        ]
      }
    });
    expect(badThresholdRes.status()).toBe(400);
    const badThresholdErr = await badThresholdRes.json();
    expect(badThresholdErr.error).toMatch(/contradictory grading rules.*cannot be less than exam pass mark/i);
  });

  test('6. Publish valid draft and verify strict immutability of published definition', async ({ request }) => {
    const publishRes = await request.post(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(publishRes.status()).toBe(200);
    const published = await publishRes.json();
    expect(published.status).toBe('published');

    // Attempting to modify published definition in place via PUT MUST fail
    const mutateRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Mutated Sound Course',
        phase_count: 2
      }
    });
    expect(mutateRes.status()).toBe(400);
    const mutateErr = await mutateRes.json();
    expect(mutateErr.error).toMatch(/published course definition.*immutable/i);
  });

  test('7. Routine updates enforce roles and preserve published definition immutability', async ({ request }) => {
    // 7a. Non-authorized instructor role is rejected with 403
    const instRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine`, {
      headers: { Authorization: `Bearer ${instructorToken}` },
      data: {
        phase_id: 'phase_1',
        routine: [{ weekday: 'Friday', startTime: '16:00', endTime: '18:00' }],
        reason: 'Instructor attempt'
      }
    });
    expect(instRes.status()).toBe(403);
    const instErr = await instRes.json();
    expect(instErr.error).toMatch(/only authorized administrators and moderators/i);

    // 7b. Student role is rejected with 403
    const studentRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: {
        phase_id: 'phase_1',
        routine: [{ weekday: 'Friday', startTime: '16:00', endTime: '18:00' }],
        reason: 'Student attempt'
      }
    });
    expect(studentRes.status()).toBe(403);

    // 7c. Unauthenticated request rejected with 401
    const unauthRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine`, {
      data: {
        phase_id: 'phase_1',
        routine: [{ weekday: 'Friday', startTime: '16:00', endTime: '18:00' }],
        reason: 'No token'
      }
    });
    expect(unauthRes.status()).toBe(401);

    // 7d. Moderator attempting to modify course-level routine (batch_id is null/0) is rejected with 403
    const modCourseLevelRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine`, {
      headers: { Authorization: `Bearer ${moderatorToken}` },
      data: {
        phase_id: 'phase_1',
        batch_id: null,
        routine: [{ weekday: 'Friday', startTime: '16:00', endTime: '18:00' }],
        reason: 'Moderator course-level attempt'
      }
    });
    expect(modCourseLevelRes.status()).toBe(403);
    const modCourseLevelErr = await modCourseLevelRes.json();
    expect(modCourseLevelErr.error).toMatch(/moderators cannot modify course-level routines/i);

    // Setup test batches for soundCourseId
    const b1 = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Test Sound Batch 101', 'TSB-101', 'Test Sound Design Masterclass', 'active', ?, 1, ?)
    `).run(soundCourseId, adminUser.id);
    const batch101Id = b1.lastInsertRowid;

    const b2 = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Test Sound Batch 102', 'TSB-102', 'Test Sound Design Masterclass', 'active', ?, 1, ?)
    `).run(soundCourseId, adminUser.id);
    const batch102Id = b2.lastInsertRowid;

    // Assign moderator 99998 ONLY to batch101, NOT to batch102
    db.prepare(`
      INSERT OR REPLACE INTO batch_moderators (batch_id, user_id, assigned_by)
      VALUES (?, 99998, ?)
    `).run(batch101Id, adminUser.id);

    // 7e. Moderator attempting to modify UNRELATED batch (batch102Id) is rejected with 403
    const modUnrelatedRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine`, {
      headers: { Authorization: `Bearer ${moderatorToken}` },
      data: {
        phase_id: 'phase_1',
        batch_id: batch102Id,
        routine: [{ weekday: 'Friday', startTime: '16:00', endTime: '18:00' }],
        reason: 'Moderator unauthorized batch attempt'
      }
    });
    expect(modUnrelatedRes.status()).toBe(403);
    const modUnrelatedErr = await modUnrelatedRes.json();
    expect(modUnrelatedErr.error).toMatch(/not authorized to modify the routine for this batch/i);

    // 7f. Moderator role is authorized to update routine for ASSIGNED batch (batch101Id)
    const modRes = await request.put(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine`, {
      headers: { Authorization: `Bearer ${moderatorToken}` },
      data: {
        phase_id: 'phase_1',
        batch_id: batch101Id,
        routine: [
          { weekday: 'Friday', startTime: '16:00', endTime: '19:00', timezone: 'Asia/Dhaka' },
          { weekday: 'Tuesday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }
        ],
        reason: 'Moderator adjusted for Friday studio availability'
      }
    });
    expect(modRes.status()).toBe(200);
    const modBody = await modRes.json();
    expect(modBody.is_operational_override).toBe(true);

    // 7g. CRITICAL IMMUTABILITY VERIFICATION:
    // Verify course_definitions.definition_json in database was NOT changed!
    const row = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(soundCourseId);
    const parsedRow = JSON.parse(row.definition_json);
    const originalPhase1Routine = parsedRow.phases[0].routine;
    // Original routine was Saturday 10:00 - 12:00
    expect(originalPhase1Routine[0].weekday).toBe('Saturday');
    expect(originalPhase1Routine[0].startTime).toBe('10:00');

    // 7h. Verify operational override is stored in course_routine_overrides
    const override = db.prepare('SELECT * FROM course_routine_overrides WHERE course_definition_id = ? AND batch_id = ? AND phase_id = ?').get(soundCourseId, batch101Id, 'phase_1');
    expect(override).toBeDefined();
    expect(override.batch_id).toBe(batch101Id);
    const overrideRoutine = JSON.parse(override.routine_json);
    expect(overrideRoutine[0].weekday).toBe('Friday');

    // 7i. Verify audit log entry
    const auditsRes = await request.get(`${API_BASE}/api/admin/course-definitions/${soundCourseId}/routine-audits`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(auditsRes.status()).toBe(200);
    const audits = await auditsRes.json();
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0].reason).toBe('Moderator adjusted for Friday studio availability');
    expect(audits[0].batch_id).toBe(batch101Id);

    // 7j. BATCH-SPECIFIC ROUTINE ISOLATION VERIFICATION:
    // Batch 101 must resolve to the Friday override, while Batch 102 must resolve to definition baseline (Saturday)
    const b1Res = await request.get(`${API_BASE}/api/admin/batches/${batch101Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(b1Res.status()).toBe(200);
    const b1Data = await b1Res.json();
    const b1Phase1 = b1Data.course_definition.definition.phases[0];
    expect(b1Phase1.routineSource).toBe('batch_override');
    expect(b1Phase1.routine[0].weekday).toBe('Friday');

    const b2Res = await request.get(`${API_BASE}/api/admin/batches/${batch102Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(b2Res.status()).toBe(200);
    const b2Data = await b2Res.json();
    const b2Phase1 = b2Data.course_definition.definition.phases[0];
    expect(b2Phase1.routineSource).toBe('definition_baseline');
    expect(b2Phase1.routine[0].weekday).toBe('Saturday'); // UNTOUCHED!

    // 7k. ROUTINE VISIBLE TO STUDENT AFTER AUTHORIZED CHANGE:
    // Enroll a student into Batch 101 and check getEnrollmentProgress
    const modProgress = await import('../server/services/courseProgressService.js');
    const service = modProgress.default || modProgress;

    const enrRes = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, created_at, updated_at)
      VALUES (?, 'Test Sound Design Masterclass', 'workshop', ?, 1, datetime('now'), datetime('now'))
    `).run(studentUser.id, soundCourseId);
    const soundEnrId = enrRes.lastInsertRowid;

    // Link student to Batch 101
    db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (?, ?)').run(batch101Id, studentUser.id);

    const studentProg = await service.getEnrollmentProgress(soundEnrId);
    expect(studentProg).toBeDefined();
    expect(studentProg.phases[0].routineSource).toBe('batch_override');
    expect(studentProg.phases[0].routine[0].weekday).toBe('Friday');
    expect(studentProg.phases[0].routine[0].startTime).toBe('16:00');

    // Clean up student enrollment
    db.prepare('DELETE FROM batch_students WHERE batch_id = ? AND student_id = ?').run(batch101Id, studentUser.id);
    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(soundEnrId);
  });

  test('8. Explicit legacy migration rejects unmappable states, unrelated courses, and invalid target_version', async ({ request }) => {
    // Create dedicated test student
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
      VALUES (99996, 'test_migrant', 'migrant_test@bfibd.org', 'test_hash', 'student', 'Test', 'Migrant', 1)
    `).run();

    // 8a. Reject migrating to unrelated course definition without explicit mapping or allow_cross_course_mapping
    const unrelatedEnr = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, step1_completed, step2_completed, step3_completed, step4_completed)
      VALUES (99996, 'Online Filmmaking Course', 'filmmaking', 1, 1, 0, 0)
    `).run();
    const unrelatedId = unrelatedEnr.lastInsertRowid;

    const resUnrelated = await request.post(`${API_BASE}/api/admin/students/99996/courses/${unrelatedId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: soundCourseId,
        target_version: 1
      }
    });
    expect(resUnrelated.status()).toBe(400);
    const errUnrelated = await resUnrelated.json();
    expect(errUnrelated.error).toMatch(/Cannot migrate enrollment to unrelated course definition.*without an explicit, validated phase_mapping or allow_cross_course_mapping/i);

    // 8b. Reject invalid phase_mapping with non-existent target phase ID
    const resBadMapping = await request.post(`${API_BASE}/api/admin/students/99996/courses/${unrelatedId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: soundCourseId,
        target_version: 1,
        phase_mapping: { "1": "non_existent_phase_id_999" }
      }
    });
    expect(resBadMapping.status()).toBe(400);
    const errBadMapping = await resBadMapping.json();
    expect(errBadMapping.error).toMatch(/Invalid phase_mapping.*does not exist/i);

    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(unrelatedId);

    // 8c. Reject contradictory legacy state (step2_completed = 0, step4_completed = 1) even with cross-mapping
    const contradictEnr = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, step1_completed, step2_completed, step3_completed, step4_completed)
      VALUES (99996, 'Online Filmmaking Course', 'filmmaking', 1, 0, 1, 1)
    `).run();
    const contradictId = contradictEnr.lastInsertRowid;

    const resContradict = await request.post(`${API_BASE}/api/admin/students/99996/courses/${contradictId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: soundCourseId,
        target_version: 1,
        allow_cross_course_mapping: true
      }
    });
    expect(resContradict.status()).toBe(400);
    const errContradict = await resContradict.json();
    expect(errContradict.error).toMatch(/contradictory legacy progress/i);

    // Clean up contradictId so next enrollment for same user and course name can be created
    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(contradictId);

    // 8d. Reject migrating completed legacy graduate (2 phases) to >2 phases (soundCourseId has 3 phases)
    const gradEnr = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, step1_completed, step2_completed, step3_completed, step4_completed)
      VALUES (99996, 'Online Filmmaking Course', 'filmmaking', 1, 1, 1, 1)
    `).run();
    const gradId = gradEnr.lastInsertRowid;

    const resGrad3Phase = await request.post(`${API_BASE}/api/admin/students/99996/courses/${gradId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: soundCourseId,
        target_version: 1,
        allow_cross_course_mapping: true
      }
    });
    expect(resGrad3Phase.status()).toBe(400);
    const errGrad3Phase = await resGrad3Phase.json();
    expect(errGrad3Phase.error).toMatch(/Cannot safely migrate completed legacy graduate.*more than 2 phases/i);

    // 8e. Reject invalid target_version (target_version: 999 !== targetDef.version 1)
    db.prepare("DELETE FROM course_definitions WHERE slug = 'test-two-phase-cinema'").run();
    const def2 = db.prepare(`
      INSERT INTO course_definitions (slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by)
      VALUES ('test-two-phase-cinema', 1, 'Test Two Phase Cinema', 'workshop', 2, 'published', ?, 1, 1)
    `).run(JSON.stringify({
      name: 'Test Two Phase Cinema',
      phases: [
        { id: 'ph_1', phaseIndex: 1, title: 'Phase 1', classCount: 1, classes: [{ id: 'c1', title: 'C1' }], assignments: [], exam: { enabled: false } },
        { id: 'ph_2', phaseIndex: 2, title: 'Phase 2', classCount: 1, classes: [{ id: 'c2', title: 'C2' }], assignments: [], exam: { enabled: false } }
      ],
      completionPolicy: { certificateEligibility: { allRequiredPhasesPassed: true } }
    }));
    const def2Id = def2.lastInsertRowid;

    const resBadVer = await request.post(`${API_BASE}/api/admin/students/99996/courses/${gradId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: def2Id,
        target_version: 999,
        allow_cross_course_mapping: true
      }
    });
    expect(resBadVer.status()).toBe(400);
    const errBadVer = await resBadVer.json();
    expect(errBadVer.error).toMatch(/Invalid target_version 999/i);

    // Clean up gradId so test 9 can create a fresh enrollment
    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(gradId);
  });

  test('9. Explicit migration of previously passed legacy student preserves historical results & certificate eligibility', async ({ request }) => {
    // 9a. Find our 2-phase definition created in test 8
    const def2 = db.prepare("SELECT * FROM course_definitions WHERE slug = 'test-two-phase-cinema'").get();
    expect(def2).toBeDefined();

    // 9b. Create a legacy graduate student enrollment with full completed history
    const enr = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, step1_completed, step2_completed, step3_completed, step4_completed,
        attendance_classes, attendance_total, exam_written, phase2_shooting_attended, phase2_editing_attended
      )
      VALUES (99996, 'Online Filmmaking Course', 'filmmaking', 1, 1, 1, 1, 16, 16, 45, 1, 1)
    `).run();
    const enrId = enr.lastInsertRowid;

    // 9c. First verify rejection without allow_cross_course_mapping (different course types/names)
    const rejectUnmapped = await request.post(`${API_BASE}/api/admin/students/99996/courses/${enrId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: def2.id,
        target_version: 1
      }
    });
    expect(rejectUnmapped.status()).toBe(400);

    // 9d. Execute explicit migration with allow_cross_course_mapping: true
    const migRes = await request.post(`${API_BASE}/api/admin/students/99996/courses/${enrId}/migrate-to-defined`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        target_course_definition_id: def2.id,
        target_version: 1,
        allow_cross_course_mapping: true,
        notes: 'End-to-end legacy graduate migration'
      }
    });
    expect(migRes.status()).toBe(200);
    const migBody = await migRes.json();
    expect(migBody.success).toBe(true);

    // 9e. Verify progress evaluation:
    // Even with ZERO new classes or assignments attended in the new tables,
    // historical results and certificate eligibility are 100% preserved!
    const modProgress = await import('../server/services/courseProgressService.js');
    const service = modProgress.default || modProgress;

    const progress = await service.getEnrollmentProgress(enrId);
    expect(progress).toBeDefined();
    expect(progress.isLegacy).toBe(false);
    expect(progress.isMigrated).toBe(true);
    expect(progress.certificateEligible).toBe(true); // GRADUATE PRESERVED!
    expect(progress.phases.length).toBe(2);

    // Phase 1 verification
    expect(progress.phases[0].isPassed).toBe(true);
    expect(progress.phases[0].status).toBe('passed');
    expect(progress.phases[0].isMigrated).toBe(true);
    expect(progress.phases[0].attendance.percentage).toBe(100);
    expect(progress.phases[0].attendance.attendedClasses).toBe(16);
    expect(progress.phases[0].exam.score).toBe(45);

    // Phase 2 verification
    expect(progress.phases[1].isPassed).toBe(true);
    expect(progress.phases[1].status).toBe('passed');
    expect(progress.phases[1].isMigrated).toBe(true);
  });

  test('10. Multi-batch regression: one student in two batches sharing course definition receives distinct routine overrides deterministically', async ({ request }) => {
    // 10a. Create and publish a multi-batch course definition
    db.prepare("DELETE FROM course_definitions WHERE slug = 'test-multi-batch-course'").run();
    const createDefRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Multi-Batch Course',
        course_type: 'filmmaking',
        phase_count: 2,
        phases: [
          {
            id: 'phase_1',
            phaseIndex: 1,
            title: 'Multi-Batch Phase 1',
            classCount: 2,
            classes: [
              { id: 'mb_c1', title: 'Intro Lecture', category: 'theory', deliveryMode: 'live' },
              { id: 'mb_c2', title: 'Camera Lab', category: 'shooting', deliveryMode: 'live' }
            ],
            routine: [
              { weekday: 'Monday', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Dhaka' }
            ],
            assignments: [],
            exam: { enabled: false }
          },
          {
            id: 'phase_2',
            phaseIndex: 2,
            title: 'Multi-Batch Phase 2',
            classCount: 1,
            classes: [
              { id: 'mb_c3', title: 'Final Review', category: 'editing', deliveryMode: 'live' }
            ],
            routine: [],
            assignments: [],
            exam: { enabled: false }
          }
        ],
        completionPolicy: {
          certificateEligibility: { allRequiredPhasesPassed: true }
        }
      }
    });
    expect(createDefRes.status()).toBe(201);
    const defData = await createDefRes.json();
    const multiCourseId = defData.id;

    const publishRes = await request.post(`${API_BASE}/api/admin/course-definitions/${multiCourseId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(publishRes.status()).toBe(200);

    // 10b. Create Batch A and Batch B for this course definition
    const bA = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Test Multi-Batch 01', 'TMB-01', 'Test Multi-Batch Course', 'active', ?, 1, ?)
    `).run(multiCourseId, adminUser.id);
    const batchAId = bA.lastInsertRowid;

    const bB = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Test Multi-Batch 02', 'TMB-02', 'Test Multi-Batch Course', 'active', ?, 1, ?)
    `).run(multiCourseId, adminUser.id);
    const batchBId = bB.lastInsertRowid;

    // 10c. Configure different routine overrides:
    // Batch A: Monday 18:00 - 20:00
    const ovARes = await request.put(`${API_BASE}/api/admin/course-definitions/${multiCourseId}/routine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        phase_id: 'phase_1',
        batch_id: batchAId,
        routine: [{ weekday: 'Monday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }],
        reason: 'Batch A evening schedule'
      }
    });
    expect(ovARes.status()).toBe(200);

    // Batch B: Thursday 19:00 - 21:00
    const ovBRes = await request.put(`${API_BASE}/api/admin/course-definitions/${multiCourseId}/routine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        phase_id: 'phase_1',
        batch_id: batchBId,
        routine: [{ weekday: 'Thursday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka' }],
        reason: 'Batch B Thursday schedule'
      }
    });
    expect(ovBRes.status()).toBe(200);

    // 10d. Assign student 99995 to Batch A
    const assignARes = await request.post(`${API_BASE}/api/admin/batches/${batchAId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [99995] }
    });
    expect(assignARes.status()).toBe(200);
    const assignABody = await assignARes.json();
    expect(assignABody.assigned).toBe(1);

    // 10e. Assign SAME student 99995 to Batch B
    const assignBRes = await request.post(`${API_BASE}/api/admin/batches/${batchBId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [99995] }
    });
    expect(assignBRes.status()).toBe(200);
    const assignBBody = await assignBRes.json();
    expect(assignBBody.assigned).toBe(1);

    // 10f. Verify Batch A student view:
    // GET /api/admin/batches/:batchAId/students must show Batch A's Monday schedule
    const bAStudentsRes = await request.get(`${API_BASE}/api/admin/batches/${batchAId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(bAStudentsRes.status()).toBe(200);
    const bAStudents = await bAStudentsRes.json();
    const studentInA = bAStudents.find(s => s.user_id === 99995);
    expect(studentInA).toBeDefined();
    const enrA = studentInA.enrollments.find(e => e.batch_id === batchAId || e.course_name.includes('Test Multi-Batch Course'));
    expect(enrA).toBeDefined();
    expect(enrA.defined_progress.batchId).toBe(batchAId);
    expect(enrA.defined_progress.phases[0].routineSource).toBe('batch_override');
    expect(enrA.defined_progress.phases[0].routine[0].weekday).toBe('Monday');
    expect(enrA.defined_progress.phases[0].routine[0].startTime).toBe('18:00');

    // 10g. Verify Batch B student view:
    // GET /api/admin/batches/:batchBId/students must show Batch B's Thursday schedule
    const bBStudentsRes = await request.get(`${API_BASE}/api/admin/batches/${batchBId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(bBStudentsRes.status()).toBe(200);
    const bBStudents = await bBStudentsRes.json();
    const studentInB = bBStudents.find(s => s.user_id === 99995);
    expect(studentInB).toBeDefined();
    const enrB = studentInB.enrollments.find(e => e.batch_id === batchBId || e.course_name.includes('TMB-02') || e.course_name.includes('Batch 02'));
    expect(enrB).toBeDefined();
    expect(enrB.defined_progress.batchId).toBe(batchBId);
    expect(enrB.defined_progress.phases[0].routineSource).toBe('batch_override');
    expect(enrB.defined_progress.phases[0].routine[0].weekday).toBe('Thursday');
    expect(enrB.defined_progress.phases[0].routine[0].startTime).toBe('19:00');

    // 10h. Verify Student Profile view:
    // GET /api/student/profile must return both enrollments with their isolated schedules
    const profileRes = await request.get(`${API_BASE}/api/student/profile`, {
      headers: { Authorization: `Bearer ${multiBatchStudentToken}` }
    });
    expect(profileRes.status()).toBe(200);
    const profileData = await profileRes.json();
    const multiEnrollments = profileData.enrollments.filter(e => e.course_definition_id === multiCourseId);
    expect(multiEnrollments.length).toBe(2);

    const profEnrA = multiEnrollments.find(e => e.batch_id === batchAId);
    expect(profEnrA).toBeDefined();
    expect(profEnrA.defined_progress.batchId).toBe(batchAId);
    expect(profEnrA.defined_progress.phases[0].routineSource).toBe('batch_override');
    expect(profEnrA.defined_progress.phases[0].routine[0].weekday).toBe('Monday');
    expect(profEnrA.defined_progress.phases[0].routine[0].startTime).toBe('18:00');

    const profEnrB = multiEnrollments.find(e => e.batch_id === batchBId);
    expect(profEnrB).toBeDefined();
    expect(profEnrB.defined_progress.batchId).toBe(batchBId);
    expect(profEnrB.defined_progress.phases[0].routineSource).toBe('batch_override');
    expect(profEnrB.defined_progress.phases[0].routine[0].weekday).toBe('Thursday');
    expect(profEnrB.defined_progress.phases[0].routine[0].startTime).toBe('19:00');

    // Neither view silently chose an arbitrary batch via LIMIT 1!
  });

  test('11. Course Maker catalog batch association: strictly returns explicitly linked, non-deleted batches (including archived lifecycle); excludes soft-deleted/trashed and unlinked legacy batches across list, detail, /batches endpoints and Manage UI list', async ({ page, request }) => {
    await setupTestRouteProxy(page);

    // 11a. Create and publish a dedicated course definition
    db.prepare("DELETE FROM course_definitions WHERE slug = 'test-batch-association-mastery'").run();
    const createRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Test Batch Association Mastery',
        course_type: 'workshop',
        phase_count: 1,
        phases: [
          {
            id: 'phase_1',
            phaseIndex: 1,
            title: 'Foundations Phase',
            classCount: 1,
            classes: [
              { id: 'assoc_cls_1', title: 'Intro to Association', category: 'theory', deliveryMode: 'live' }
            ],
            routine: [
              { weekday: 'Monday', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Dhaka' }
            ],
            assignments: [],
            exam: { enabled: false }
          }
        ],
        completionPolicy: {
          certificateEligibility: { allRequiredPhasesPassed: true }
        }
      }
    });
    expect(createRes.status()).toBe(201);
    const defData = await createRes.json();
    const assocCourseId = defData.id;

    const pubRes = await request.post(`${API_BASE}/api/admin/course-definitions/${assocCourseId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(pubRes.status()).toBe(200);

    // 11b. Insert the test batches:
    // (1) Linked active batch
    const b1 = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Assoc Batch 01 (Active Linked)', 'ABA-01', 'Test Batch Association Mastery', 'active', ?, 1, ?)
    `).run(assocCourseId, adminUser.id);
    const batch1Id = b1.lastInsertRowid;

    // Enrol student 99995 in Batch 1
    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id, assigned_at, assigned_by)
      VALUES (?, 99995, datetime('now'), ?)
    `).run(batch1Id, adminUser.id);

    // (2) Soft-deleted linked batch (in Trash: deleted_at IS NOT NULL)
    const b2 = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by, deleted_at, deleted_by_admin_id)
      VALUES ('Assoc Batch 02 (Soft-Deleted Linked)', 'ABA-02', 'Test Batch Association Mastery', 'active', ?, 1, ?, datetime('now'), ?)
    `).run(assocCourseId, adminUser.id, adminUser.id);
    const batch2Id = b2.lastInsertRowid;

    // Enrol student 99996 in Batch 2
    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id, assigned_at, assigned_by)
      VALUES (?, 99996, datetime('now'), ?)
    `).run(batch2Id, adminUser.id);

    // (3) Unlinked legacy batch with the same course name (course_definition_id IS NULL)
    const b3 = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Assoc Batch 03 (Unlinked Legacy)', 'ABA-03', 'Test Batch Association Mastery', 'active', NULL, NULL, ?)
    `).run(adminUser.id);
    const batch3Id = b3.lastInsertRowid;

    // Enrol student 99997 in Batch 3
    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id, assigned_at, assigned_by)
      VALUES (?, 99997, datetime('now'), ?)
    `).run(batch3Id, adminUser.id);

    // (4) Explicitly linked archived batch (historical lifecycle, NOT in trash: deleted_at IS NULL)
    const b4 = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version, created_by)
      VALUES ('Assoc Batch 04 (Archived Linked)', 'ABA-04', 'Test Batch Association Mastery', 'archived', ?, 1, ?)
    `).run(assocCourseId, adminUser.id);
    const batch4Id = b4.lastInsertRowid;

    // Enrol student 99994 in Batch 4
    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id, assigned_at, assigned_by)
      VALUES (?, 99994, datetime('now'), ?)
    `).run(batch4Id, adminUser.id);

    // 11c. Assert Endpoint 1: Definitions list (GET /api/admin/course-definitions)
    const listRes = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(listRes.status()).toBe(200);
    const definitions = await listRes.json();
    const assocDef = definitions.find(d => d.id === assocCourseId);
    expect(assocDef).toBeDefined();

    // Both explicitly linked non-deleted batches (Batch 1 active + Batch 4 archived) must be included
    expect(assocDef.batch_count).toBe(2);
    expect(assocDef.linked_batch_count).toBe(2);
    expect(assocDef.total_students).toBe(2);
    expect(assocDef.enrollment_count).toBe(2);
    expect(assocDef.batches).toHaveLength(2);

    expect(assocDef.batches.some(b => b.id === batch1Id && b.batch_name === 'Assoc Batch 01 (Active Linked)')).toBe(true);
    expect(assocDef.batches.some(b => b.id === batch4Id && b.batch_name === 'Assoc Batch 04 (Archived Linked)')).toBe(true);
    expect(assocDef.batches.some(b => b.id === batch2Id)).toBe(false);
    expect(assocDef.batches.some(b => b.id === batch3Id)).toBe(false);

    // 11d. Assert Endpoint 2: Linked batches sub-route (GET /api/admin/course-definitions/:id/batches)
    const batchesRes = await request.get(`${API_BASE}/api/admin/course-definitions/${assocCourseId}/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(batchesRes.status()).toBe(200);
    const linkedBatchesList = await batchesRes.json();
    expect(linkedBatchesList).toHaveLength(2);
    expect(linkedBatchesList.some(b => b.id === batch1Id)).toBe(true);
    expect(linkedBatchesList.some(b => b.id === batch4Id)).toBe(true);
    expect(linkedBatchesList.some(b => b.id === batch2Id)).toBe(false);
    expect(linkedBatchesList.some(b => b.id === batch3Id)).toBe(false);

    // 11e. Assert Endpoint 3: Definition detail (GET /api/admin/course-definitions/:idOrSlug)
    // By ID
    const detailIdRes = await request.get(`${API_BASE}/api/admin/course-definitions/${assocCourseId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(detailIdRes.status()).toBe(200);
    const detailById = await detailIdRes.json();
    expect(detailById.batch_count).toBe(2);
    expect(detailById.linked_batch_count).toBe(2);
    expect(detailById.total_students).toBe(2);
    expect(detailById.enrollment_count).toBe(2);
    expect(detailById.batches).toHaveLength(2);
    expect(detailById.batches.some(b => b.id === batch1Id)).toBe(true);
    expect(detailById.batches.some(b => b.id === batch4Id)).toBe(true);

    // By slug
    const detailSlugRes = await request.get(`${API_BASE}/api/admin/course-definitions/${assocDef.slug}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(detailSlugRes.status()).toBe(200);
    const detailBySlug = await detailSlugRes.json();
    expect(detailBySlug.batch_count).toBe(2);
    expect(detailBySlug.batches).toHaveLength(2);
    expect(detailBySlug.batches.some(b => b.id === batch1Id)).toBe(true);
    expect(detailBySlug.batches.some(b => b.id === batch4Id)).toBe(true);

    // 11f. Check the catalog's Manage list in the UI
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

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('admin/course-maker', { waitUntil: 'networkidle' });

    // Locate the catalog card for this course definition
    const courseCard = page.locator('.cm-catalog-card').filter({ hasText: 'Test Batch Association Mastery' });
    await expect(courseCard).toBeVisible();

    // Verify batch count badge and enrollment badge on the card
    await expect(courseCard.locator('text=Batches (2)')).toBeVisible();
    await expect(courseCard.locator('.cm-badge-enrolled')).toContainText('2 Enrolled');

    // Verify batch items in the card
    const batchItems = courseCard.locator('.cm-catalog-batch-item');
    await expect(batchItems).toHaveCount(2);

    const activeItem = batchItems.filter({ hasText: 'Assoc Batch 01 (Active Linked)' });
    await expect(activeItem).toBeVisible();
    await expect(activeItem.locator('.cm-batch-status--active')).toBeVisible();
    await expect(activeItem.locator('button', { hasText: 'Manage' })).toBeVisible();

    const archivedItem = batchItems.filter({ hasText: 'Assoc Batch 04 (Archived Linked)' });
    await expect(archivedItem).toBeVisible();
    await expect(archivedItem.locator('.cm-batch-status--archived')).toBeVisible();
    await expect(archivedItem.locator('button', { hasText: 'Manage' })).toBeVisible();

    // Verify soft-deleted batch and unlinked legacy batch are NOT rendered anywhere in the card
    await expect(courseCard.locator('text=Assoc Batch 02 (Soft-Deleted Linked)')).not.toBeVisible();
    await expect(courseCard.locator('text=Assoc Batch 03 (Unlinked Legacy)')).not.toBeVisible();

    // 11g. Verify legacy workflow preservation
    // Legacy batches query via GET /api/admin/batches?course=...
    const legacyBatchesRes = await request.get(`${API_BASE}/api/admin/batches?course=${encodeURIComponent('Test Batch Association Mastery')}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(legacyBatchesRes.status()).toBe(200);
    const legacyBatchesList = await legacyBatchesRes.json();
    // Legacy workflow retains access to all non-deleted batches (Batch 1, legacy Batch 3, and archived Batch 4), while excluding soft-deleted Batch 2
    expect(legacyBatchesList.some(b => b.id === batch1Id)).toBe(true);
    expect(legacyBatchesList.some(b => b.id === batch3Id)).toBe(true);
    expect(legacyBatchesList.some(b => b.id === batch4Id)).toBe(true);
    expect(legacyBatchesList.some(b => b.id === batch2Id)).toBe(false);

    // Database invariant: legacy batch was NOT silently modified or linked
    const b3InDb = db.prepare('SELECT id, course_definition_id, course_name FROM batches WHERE id = ?').get(batch3Id);
    expect(b3InDb.course_definition_id).toBeNull();
    expect(b3InDb.course_name).toBe('Test Batch Association Mastery');
  });
});
