import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation, 
  assertServerRejectionProof, 
  startTestServer,
  setupTestRouteProxy
} from './test-db-isolation.js';
import { getBatchFee, resolvePhaseFee } from '../server/utils/feeResolver.js';

dotenv.config();

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;
let defAId;
let defBId;
let batchAId;
let batchBId;
let studentAId;
let studentBId;
let studentAToken;
let studentBToken;
let enrAId;
let enrBId;

test.beforeAll(async () => {
  // Start isolated test server on port 3099
  await startTestServer();
  await assertServerRejectionProof('http://127.0.0.1:3001');
  const serverIdentity = await verifyServerIsolation(getTestApiUrl());
  console.log(`[Same-Title Collision Test] Connected to isolated test server: port=${serverIdentity.port} db=${serverIdentity.dbPath}`);

  await initIsolatedTestDatabase(DB_PATH);
  db = new Database(DB_PATH);
  assertIsolatedTestDatabase(db.name || DB_PATH);

  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Clean old collision test records
  db.prepare("DELETE FROM course_materials WHERE title LIKE 'Collision Test%'").run();
  db.prepare("DELETE FROM course_routine_audits WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE name = 'Cinema Aesthetics Masterclass')").run();
  db.prepare("DELETE FROM course_routine_overrides WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE name = 'Cinema Aesthetics Masterclass')").run();
  db.prepare("DELETE FROM course_settings WHERE course_name = 'Cinema Aesthetics Masterclass'").run();
  db.prepare("DELETE FROM batch_course_fees WHERE course_name = 'Cinema Aesthetics Masterclass'").run();
  db.prepare("DELETE FROM instructor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'collision_%')").run();
  db.prepare("DELETE FROM batch_moderators WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'collision_%')").run();
  db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'collision_%')").run();
  db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'collision_%')").run();
  db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'collision_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'collision_%' OR email LIKE '%legacy%'").run();
  db.prepare("DELETE FROM batches WHERE course_name = 'Cinema Aesthetics Masterclass' OR course_name LIKE 'Numeric Collision%' OR LOWER(course_name) LIKE '%legacy scriptwriting%' OR course_name LIKE 'Legacy Duplicate%' OR course_name LIKE '%Hybrid%'").run();
  db.prepare("DELETE FROM course_definitions WHERE name = 'Cinema Aesthetics Masterclass' OR name LIKE 'Hybrid Course Def%'").run();
});

test.describe('Downstream Identity Collision Fix: Same Title & Same Batch Number Isolation', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Setup two published definitions with EXACT same title and create batch AP01 on each', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Create Definition A
    const defAPayload = {
      name: 'Cinema Aesthetics Masterclass',
      course_type: 'appreciation',
      description: 'Definition A curriculum for aesthetic theory and film analysis.',
      duration_value: 2,
      duration_unit: 'months',
      phase_count: 1,
      phases: [
        {
          id: 'phase_1',
          phaseIndex: 1,
          title: 'Visual Poetics',
          description: 'Aesthetic theory',
          duration: { value: 2, unit: 'months' },
          classCount: 2,
          feeAmount: 5000,
          routine: [{ weekday: 'Tuesday', startTime: '18:00', endTime: '20:00', room: 'Auditorium' }],
          classes: [
            { id: 'c1', title: 'Visual Harmony' },
            { id: 'c2', title: 'Cinematic Rhythm' }
          ]
        }
      ]
    };

    const resDefA = await request.post(`${apiUrl}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: defAPayload
    });
    expect(resDefA.status()).toBe(201);
    const dataA = await resDefA.json();
    defAId = dataA.id;

    // Publish Definition A
    const resPubA = await request.post(`${apiUrl}/api/admin/course-definitions/${defAId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resPubA.status()).toBe(200);

    // 2. Create Definition B (DIFFERENT definition row, EXACT SAME TITLE)
    const defBPayload = {
      name: 'Cinema Aesthetics Masterclass',
      course_type: 'workshop',
      description: 'Definition B intensive workshop with different practical focus.',
      duration_value: 1,
      duration_unit: 'months',
      phase_count: 1,
      phases: [
        {
          id: 'phase_1',
          phaseIndex: 1,
          title: 'Directing Aesthetics',
          description: 'Practical directing aesthetics',
          duration: { value: 1, unit: 'months' },
          classCount: 2,
          feeAmount: 7500,
          routine: [{ weekday: 'Saturday', startTime: '11:00', endTime: '13:00', room: 'Studio 1' }],
          classes: [
            { id: 'c1', title: 'Camera Movement' },
            { id: 'c2', title: 'Actor Staging' }
          ]
        }
      ]
    };

    const resDefB = await request.post(`${apiUrl}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: defBPayload
    });
    expect(resDefB.status()).toBe(201);
    const dataB = await resDefB.json();
    defBId = dataB.id;
    expect(defBId).not.toBe(defAId);

    // Publish Definition B
    const resPubB = await request.post(`${apiUrl}/api/admin/course-definitions/${defBId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resPubB.status()).toBe(200);

    // 3. Create Batch AP01 on Definition A
    const resBatchA = await request.post(`${apiUrl}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Batch AP01 (Theory)',
        batch_number: 'AP01',
        course_definition_id: defAId,
        status: 'active',
        description: 'First batch under Definition A'
      }
    });
    expect(resBatchA.status()).toBe(201);
    const batchAData = await resBatchA.json();
    batchAId = batchAData.id;

    // 4. Create Batch AP01 on Definition B (SAME batch_number, SAME title, DIFFERENT definition)
    const resBatchB = await request.post(`${apiUrl}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Batch AP01 (Workshop)',
        batch_number: 'AP01',
        course_definition_id: defBId,
        status: 'active',
        description: 'First batch under Definition B'
      }
    });
    expect(resBatchB.status()).toBe(201);
    const batchBData = await resBatchB.json();
    batchBId = batchBData.id;
    expect(batchBId).not.toBe(batchAId);
  });

  test('2. Configure distinct batch fees, course settings, materials, routine overrides, and students', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Configure distinct batch fees in batch_course_fees using batch_id
    // Batch A: 5000 fee
    const resFeeA = await request.post(`${apiUrl}/api/admin/batch-fees`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_id: batchAId,
        phase1_fee: 5000,
        phase2_fee: 0,
        full_fee: 5000
      }
    });
    expect(resFeeA.status()).toBe(200);

    // Batch B: 7500 fee
    const resFeeB = await request.post(`${apiUrl}/api/admin/batch-fees`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_id: batchBId,
        phase1_fee: 7500,
        phase2_fee: 0,
        full_fee: 7500
      }
    });
    expect(resFeeB.status()).toBe(200);

    // 2. Configure distinct course settings using batch_id
    // Batch A: total_classes = 20, exam_max = 100, exam_pass = 40
    const resSetA = await request.put(`${apiUrl}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_id: batchAId,
        total_classes: 20,
        exam_max_score: 100,
        exam_pass_mark: 40,
        has_assignment: true,
        assignments: [{ title: 'Theory Essay', maxScore: 50 }]
      }
    });
    expect(resSetA.status()).toBe(200);

    // Batch B: total_classes = 30, exam_max = 50, exam_pass = 25
    const resSetB = await request.put(`${apiUrl}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_id: batchBId,
        total_classes: 30,
        exam_max_score: 50,
        exam_pass_mark: 25,
        has_assignment: true,
        assignments: [{ title: 'Short Film Pitch', maxScore: 50 }]
      }
    });
    expect(resSetB.status()).toBe(200);

    // 3. Configure distinct routine overrides for Phase 1
    // Batch A: Friday 10:00
    db.prepare(`
      INSERT OR REPLACE INTO course_routine_overrides (course_definition_id, batch_id, phase_id, routine_json, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(defAId, batchAId, 'phase_1', JSON.stringify([{ weekday: 'Friday', startTime: '10:00', endTime: '12:00', room: 'Theory Hall A' }]), adminUser.id);

    // Batch B: Monday 14:00
    db.prepare(`
      INSERT OR REPLACE INTO course_routine_overrides (course_definition_id, batch_id, phase_id, routine_json, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(defBId, batchBId, 'phase_1', JSON.stringify([{ weekday: 'Monday', startTime: '14:00', endTime: '16:00', room: 'Editing Lab B' }]), adminUser.id);

    // 4. Upload distinct course materials for each batch
    // Material for Batch A
    const resMatA = await request.post(`${apiUrl}/api/courses/upload`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        title: 'Collision Test: Def A Exclusive Syllabus',
        description: 'Readings for Theory Batch AP01',
        course_name: 'Cinema Aesthetics Masterclass',
        batch_number: 'AP01',
        batch_id: batchAId,
        external_url: 'https://example.com/syllabus-a.pdf'
      }
    });
    expect(resMatA.status()).toBe(201);

    // Material for Batch B
    const resMatB = await request.post(`${apiUrl}/api/courses/upload`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        title: 'Collision Test: Def B Exclusive Syllabus',
        description: 'Production guidelines for Workshop Batch AP01',
        course_name: 'Cinema Aesthetics Masterclass',
        batch_number: 'AP01',
        batch_id: batchBId,
        external_url: 'https://example.com/syllabus-b.pdf'
      }
    });
    expect(resMatB.status()).toBe(201);

    // 5. Create Student A and enroll in Batch A
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password123', salt);

    const resUserA = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, 'student', 'Amina', 'Al-Theory')
    `).run('collision_student_a', 'collision_student_a@test.com', hash);
    studentAId = resUserA.lastInsertRowid;
    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, batch_number)
      VALUES (?, 'Amina Al-Theory', 'AP01')
    `).run(studentAId);

    studentAToken = jwt.sign(
      { id: studentAId, username: 'collision_student_a', role: 'student', name: 'Amina Al-Theory' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Enroll Student A into Batch A
    const resEnrA = await request.post(`${apiUrl}/api/admin/batches/${batchAId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { student_ids: [studentAId] }
    });
    expect(resEnrA.status()).toBe(200);

    const enrARow = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(studentAId, batchAId);
    expect(enrARow).toBeDefined();
    enrAId = enrARow.id;

    // 6. Create Student B and enroll in Batch B
    const resUserB = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, 'student', 'Bilal', 'Al-Workshop')
    `).run('collision_student_b', 'collision_student_b@test.com', hash);
    studentBId = resUserB.lastInsertRowid;
    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, batch_number, bio)
      VALUES (?, 'Bilal Al-Workshop', 'AP01', 'Aspiring director and cinematographer from Workshop Batch')
    `).run(studentBId);

    studentBToken = jwt.sign(
      { id: studentBId, username: 'collision_student_b', role: 'student', name: 'Bilal Al-Workshop' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Enroll Student B into Batch B
    const resEnrB = await request.post(`${apiUrl}/api/admin/batches/${batchBId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { student_ids: [studentBId] }
    });
    expect(resEnrB.status()).toBe(200);

    const enrBRow = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(studentBId, batchBId);
    expect(enrBRow).toBeDefined();
    enrBId = enrBRow.id;
  });

  test('3. Verify Admin Batch Details show isolated fees, settings, routines, and students for each batch', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Inspect Batch A Details
    const resA = await request.get(`${apiUrl}/api/admin/batches/${batchAId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resA.status()).toBe(200);
    const batchADetail = await resA.json();

    expect(batchADetail.batch_number).toBe('AP01');
    expect(batchADetail.course_name).toBe('Cinema Aesthetics Masterclass');
    expect(batchADetail.course_definition_id).toBe(defAId);
    expect(batchADetail.course_fee).toBe(5000);
    expect(batchADetail.phase1_fee).toBe(5000);

    // Inspect Batch A Students roster
    const resStudentsA = await request.get(`${apiUrl}/api/admin/batches/${batchAId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resStudentsA.status()).toBe(200);
    const studentsAData = await resStudentsA.json();
    const studentIdsA = Array.isArray(studentsAData) ? studentsAData.map(s => s.user_id) : [];
    expect(studentIdsA).toContain(studentAId);
    expect(studentIdsA).not.toContain(studentBId);

    // Inspect Batch A Routine Override
    expect(batchADetail.course_definition.definition.phases[0].routineSource).toBe('batch_override');
    expect(batchADetail.course_definition.definition.phases[0].routine[0].weekday).toBe('Friday');
    expect(batchADetail.course_definition.definition.phases[0].routine[0].room).toBe('Theory Hall A');

    // 2. Inspect Batch B Details
    const resB = await request.get(`${apiUrl}/api/admin/batches/${batchBId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resB.status()).toBe(200);
    const batchBDetail = await resB.json();

    expect(batchBDetail.batch_number).toBe('AP01');
    expect(batchBDetail.course_name).toBe('Cinema Aesthetics Masterclass');
    expect(batchBDetail.course_definition_id).toBe(defBId);
    expect(batchBDetail.course_fee).toBe(7500);
    expect(batchBDetail.phase1_fee).toBe(7500);

    // Inspect Batch B Students roster
    const resStudentsB = await request.get(`${apiUrl}/api/admin/batches/${batchBId}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resStudentsB.status()).toBe(200);
    const studentsBData = await resStudentsB.json();
    const studentIdsB = Array.isArray(studentsBData) ? studentsBData.map(s => s.user_id) : [];
    expect(studentIdsB).toContain(studentBId);
    expect(studentIdsB).not.toContain(studentAId);

    // Inspect Batch B Routine Override
    expect(batchBDetail.course_definition.definition.phases[0].routineSource).toBe('batch_override');
    expect(batchBDetail.course_definition.definition.phases[0].routine[0].weekday).toBe('Monday');
    expect(batchBDetail.course_definition.definition.phases[0].routine[0].room).toBe('Editing Lab B');
  });

  test('4. Verify Course Settings Manager returns distinct settings by batch_id', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    const res = await request.get(`${apiUrl}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(res.status()).toBe(200);
    const allSettings = await res.json();

    const settingA = allSettings.find(s => s.batch_id === batchAId);
    const settingB = allSettings.find(s => s.batch_id === batchBId);

    expect(settingA).toBeDefined();
    expect(settingA.total_classes).toBe(20);
    expect(settingA.exam_max_score).toBe(100);
    expect(settingA.exam_pass_mark).toBe(40);

    expect(settingB).toBeDefined();
    expect(settingB.total_classes).toBe(30);
    expect(settingB.exam_max_score).toBe(50);
    expect(settingB.exam_pass_mark).toBe(25);
  });

  test('5. Verify Student Profiles, Fee Balances, and Student Portals show strictly isolated data', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Student A Profile & Progress
    const resProfA = await request.get(`${apiUrl}/api/student/profile`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    expect(resProfA.status()).toBe(200);
    const profA = await resProfA.json();
    const enrA = profA.enrollments.find(e => e.id === enrAId);
    expect(enrA).toBeDefined();
    expect(enrA.batch_id).toBe(batchAId);
    expect(enrA.course_definition_id).toBe(defAId);
    expect(enrA.defined_progress.phases[0].feeAmount).toBe(5000);
    expect(enrA.defined_progress.phases[0].remainingDue).toBe(5000);

    // 2. Student A Course Materials
    const resMatStudentA = await request.get(`${apiUrl}/api/courses?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    expect(resMatStudentA.status()).toBe(200);
    const matDataA = await resMatStudentA.json();
    const titlesA = matDataA.materials.map(m => m.title);
    expect(titlesA).toContain('Collision Test: Def A Exclusive Syllabus');
    expect(titlesA).not.toContain('Collision Test: Def B Exclusive Syllabus');

    // 2b. Student A requests Student B's batch materials (unauthorized cross-batch request must return 403)
    const resUnauthorizedA = await request.get(`${apiUrl}/api/courses?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    expect(resUnauthorizedA.status()).toBe(403);
    const unauthBodyA = await resUnauthorizedA.json();
    expect(unauthBodyA.error).toContain('Access denied');

    // 3. Student B Profile & Progress
    const resProfB = await request.get(`${apiUrl}/api/student/profile`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    expect(resProfB.status()).toBe(200);
    const profB = await resProfB.json();
    const enrB = profB.enrollments.find(e => e.id === enrBId);
    expect(enrB).toBeDefined();
    expect(enrB.batch_id).toBe(batchBId);
    expect(enrB.course_definition_id).toBe(defBId);
    expect(enrB.defined_progress.phases[0].feeAmount).toBe(7500);
    expect(enrB.defined_progress.phases[0].remainingDue).toBe(7500);

    // 4. Student B Course Materials
    const resMatStudentB = await request.get(`${apiUrl}/api/courses?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    expect(resMatStudentB.status()).toBe(200);
    const matDataB = await resMatStudentB.json();
    const titlesB = matDataB.materials.map(m => m.title);
    expect(titlesB).toContain('Collision Test: Def B Exclusive Syllabus');
    expect(titlesB).not.toContain('Collision Test: Def A Exclusive Syllabus');

    // 4b. Student B requests Student A's batch materials (unauthorized cross-batch request must return 403)
    const resUnauthorizedB = await request.get(`${apiUrl}/api/courses?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    expect(resUnauthorizedB.status()).toBe(403);
    const unauthBodyB = await resUnauthorizedB.json();
    expect(unauthBodyB.error).toContain('Access denied');
  });

  test('6. Verify Fee Tracker and Analytics separate Student A and Student B without cross-contamination', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Fee Tracker Endpoint
    const resTracker = await request.get(`${apiUrl}/api/admin/fee-tracker/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resTracker.status()).toBe(200);
    const trackerData = await resTracker.json();

    const studentARow = trackerData.students.find(s => s.user_id === studentAId);
    const studentBRow = trackerData.students.find(s => s.user_id === studentBId);

    expect(studentARow).toBeDefined();
    expect(studentARow.total_fee).toBe(5000);
    expect(studentARow.outstanding).toBe(5000);

    expect(studentBRow).toBeDefined();
    expect(studentBRow.total_fee).toBe(7500);
    expect(studentBRow.outstanding).toBe(7500);

    // 2. Fee Status Breakdown in Analytics
    const resFeeStatus = await request.get(`${apiUrl}/api/analytics/fee-status`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resFeeStatus.status()).toBe(200);
    const feeStatusData = await resFeeStatus.json();

    expect(feeStatusData.grossAmount).toBeGreaterThanOrEqual(12500);
    expect(feeStatusData.outstandingAmount).toBeGreaterThanOrEqual(12500);
  });

  test('7. Verify Course Maker Catalog linked batches count and course-wide totals per definition', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    const res = await request.get(`${apiUrl}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(res.status()).toBe(200);
    const definitions = await res.json();

    const fetchedDefA = definitions.find(d => d.id === defAId);
    const fetchedDefB = definitions.find(d => d.id === defBId);

    expect(fetchedDefA).toBeDefined();
    expect(fetchedDefB).toBeDefined();

    // Each definition must show linked_batch_count = 1 (NOT 2)
    expect(fetchedDefA.linked_batch_count).toBe(1);
    expect(fetchedDefB.linked_batch_count).toBe(1);

    expect(fetchedDefA.enrollment_count).toBe(1);
    expect(fetchedDefB.enrollment_count).toBe(1);

    // Verify linked batches list for Def A
    const resBatchesA = await request.get(`${apiUrl}/api/admin/course-definitions/${defAId}/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resBatchesA.status()).toBe(200);
    const batchesAList = await resBatchesA.json();
    expect(batchesAList.length).toBe(1);
    expect(batchesAList[0].id).toBe(batchAId);
    expect(batchesAList[0].batch_name).toBe('Batch AP01 (Theory)');

    // Verify linked batches list for Def B
    const resBatchesB = await request.get(`${apiUrl}/api/admin/course-definitions/${defBId}/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resBatchesB.status()).toBe(200);
    const batchesBList = await resBatchesB.json();
    expect(batchesBList.length).toBe(1);
    expect(batchesBList[0].id).toBe(batchBId);
    expect(batchesBList[0].batch_name).toBe('Batch AP01 (Workshop)');
  });

  test('8. Verify Registry Batchmates Endpoint resolves accurately with batch_id and enforces access authorization', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Authorized queries by enrolled students via batch_id
    // Query batchmates for Batch A by Student A (enrolled in Batch A)
    const resMatesA = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    expect(resMatesA.status()).toBe(200);
    const matesA = await resMatesA.json();
    const idsA = matesA.batchmates.map(m => m.id);
    expect(idsA).toContain(studentAId);
    expect(idsA).not.toContain(studentBId);

    // Query batchmates for Batch B by Student B (enrolled in Batch B)
    const resMatesB = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    expect(resMatesB.status()).toBe(200);
    const matesB = await resMatesB.json();
    const idsB = matesB.batchmates.map(m => m.id);
    expect(idsB).toContain(studentBId);
    expect(idsB).not.toContain(studentAId);

    // 2. Unauthorized cross-batch access: Student A requesting Batch B via batch_id
    const resUnauth = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    expect(resUnauth.status()).toBe(403);
    const unauthBody = await resUnauth.text();
    // Verify Student B's name, email, and bio are strictly protected and never returned
    expect(unauthBody).not.toContain('Bilal');
    expect(unauthBody).not.toContain('collision_student_b@test.com');
    expect(unauthBody).not.toContain('Aspiring director');
    expect(unauthBody).not.toContain('Workshop Batch');

    // 3. Defined enrollment students CANNOT use legacy name-and-number parameters
    // Student A (enrolled in Defined Batch A AP01) querying via legacy parameters:
    const resLegacyDefA = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP01`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    expect(resLegacyDefA.status()).toBe(400);
    const legacyDefABody = await resLegacyDefA.text();
    expect(legacyDefABody).toContain('batch_id is required');
    // Student B's details MUST NOT be exposed
    expect(legacyDefABody).not.toContain('Bilal');
    expect(legacyDefABody).not.toContain('collision_student_b@test.com');
    expect(legacyDefABody).not.toContain('Aspiring director');

    // Student B (enrolled in Defined Batch B AP01) querying via legacy parameters:
    const resLegacyDefB = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP01`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    expect(resLegacyDefB.status()).toBe(400);
    const legacyDefBBody = await resLegacyDefB.text();
    expect(legacyDefBBody).toContain('batch_id is required');
    // Student A's details MUST NOT be exposed
    expect(legacyDefBBody).not.toContain('Ahmad');
    expect(legacyDefBBody).not.toContain('collision_student_a@test.com');
    expect(legacyDefBBody).not.toContain('Passionate cinephile');

    // 4. Authorized Legacy Student querying unlinked legacy cohort
    const legTs = Date.now();
    const legUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'Farhan', 'Legacy')
    `).run(`collision_reg_legacy_${legTs}`, `collision_reg_legacy_${legTs}@test.com`);
    const legStudentId = legUser.lastInsertRowid;

    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, batch_number, bio)
      VALUES (?, 'Farhan Legacy', 'AP01', 'Dedicated 35mm film historian')
    `).run(legStudentId);

    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, batch_id)
      VALUES (?, 'Cinema Aesthetics Masterclass', 'workshop', NULL, NULL)
    `).run(legStudentId);

    const legToken = jwt.sign(
      { id: legStudentId, username: `collision_reg_legacy_${legTs}`, role: 'student', name: 'Farhan Legacy' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Authorized legacy query for AP01
    const resLegAP01 = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP01`, {
      headers: { Authorization: `Bearer ${legToken}` }
    });
    expect(resLegAP01.status()).toBe(200);
    const legMates = await resLegAP01.json();
    const legIds = legMates.batchmates.map(m => m.id);
    expect(legIds).toContain(legStudentId);
    // MUST NOT leak defined students A or B even though they share course_name and batch_number!
    expect(legIds).not.toContain(studentAId);
    expect(legIds).not.toContain(studentBId);
    const legResText = JSON.stringify(legMates);
    expect(legResText).not.toContain('collision_student_a@test.com');
    expect(legResText).not.toContain('collision_student_b@test.com');

    // Legacy student unauthorized for unenrolled batch AP02
    const resLegAP02 = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP02`, {
      headers: { Authorization: `Bearer ${legToken}` }
    });
    expect(resLegAP02.status()).toBe(403);

    // 5. Staff Assigned-Batch Access Rules (Moderators & Instructors)
    // Create Moderator assigned ONLY to Batch A
    const modUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'moderator', 'Mona', 'Moderator')
    `).run(`collision_mod_${legTs}`, `collision_mod_${legTs}@test.com`);
    const modId = modUser.lastInsertRowid;

    db.prepare(`
      INSERT INTO batch_moderators (batch_id, user_id)
      VALUES (?, ?)
    `).run(batchAId, modId);

    const modToken = jwt.sign(
      { id: modId, username: `collision_mod_${legTs}`, role: 'moderator', name: 'Mona Moderator' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Assigned moderator can access Batch A
    const resModA = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${modToken}` }
    });
    expect(resModA.status()).toBe(200);
    const modMatesA = await resModA.json();
    expect(modMatesA.batchmates.map(m => m.id)).toContain(studentAId);

    // Unassigned moderator CANNOT access Batch B
    const resModB = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${modToken}` }
    });
    expect(resModB.status()).toBe(403);

    // Unassigned moderator CANNOT access unassigned legacy batch
    const resModLeg = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP01`, {
      headers: { Authorization: `Bearer ${modToken}` }
    });
    expect(resModLeg.status()).toBe(403);

    // Create Instructor assigned ONLY to Batch A
    const instUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'Irfan', 'Instructor')
    `).run(`collision_inst_${legTs}`, `collision_inst_${legTs}@test.com`);
    const instId = instUser.lastInsertRowid;

    db.prepare(`
      INSERT INTO instructor_profiles (user_id, full_name, bfi_batch)
      VALUES (?, 'Irfan Instructor', 'Batch AP01 (Theory)')
    `).run(instId);

    const instToken = jwt.sign(
      { id: instId, username: `collision_inst_${legTs}`, role: 'instructor', name: 'Irfan Instructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Assigned instructor can access Batch A
    const resInstA = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resInstA.status()).toBe(200);
    const instMatesA = await resInstA.json();
    expect(instMatesA.batchmates.map(m => m.id)).toContain(studentAId);

    // Unassigned instructor CANNOT access Batch B
    const resInstB = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resInstB.status()).toBe(403);

    // 5b. Instructor with Ambiguous Legacy Batch Number 'AP01' (shared across multiple defined batches)
    const ambInstUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'Amir', 'AmbiguousInstructor')
    `).run(`collision_amb_inst_${legTs}`, `collision_amb_inst_${legTs}@test.com`);
    const ambInstId = ambInstUser.lastInsertRowid;

    // Set bfi_batch to 'AP01' - which matches BOTH Batch A and Batch B's batch_number!
    db.prepare(`
      INSERT INTO instructor_profiles (user_id, full_name, bfi_batch)
      VALUES (?, 'Amir AmbiguousInstructor', 'AP01')
    `).run(ambInstId);

    const ambInstToken = jwt.sign(
      { id: ambInstId, username: `collision_amb_inst_${legTs}`, role: 'instructor', name: 'Amir AmbiguousInstructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // When bfi_batch is 'AP01' and multiple defined batches share 'AP01', resolution is ambiguous:
    // Requesting Batch A MUST be denied (403)
    const resAmbA = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${ambInstToken}` }
    });
    expect(resAmbA.status()).toBe(403);
    const ambAErr = await resAmbA.json();
    expect(ambAErr.error).toMatch(/Access denied.*ambiguous|not assigned/i);

    // Requesting Batch B MUST also be denied (403)
    const resAmbB = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${ambInstToken}` }
    });
    expect(resAmbB.status()).toBe(403);

    // Requesting legacy route with AP01 MUST also be denied (403) due to ambiguity
    const resAmbLeg = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP01`, {
      headers: { Authorization: `Bearer ${ambInstToken}` }
    });
    expect(resAmbLeg.status()).toBe(403);

    // Now explicitly assign this instructor to Batch A only via batch_moderators
    db.prepare(`
      INSERT INTO batch_moderators (batch_id, user_id)
      VALUES (?, ?)
    `).run(batchAId, ambInstId);

    // Explicit assignment permits Batch A:
    const resAmbAAssigned = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${ambInstToken}` }
    });
    expect(resAmbAAssigned.status()).toBe(200);
    const ambAMates = await resAmbAAssigned.json();
    expect(ambAMates.batchmates.map(m => m.id)).toContain(studentAId);

    // Unassigned Batch B MUST still be denied (403):
    const resAmbBStillDenied = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${ambInstToken}` }
    });
    expect(resAmbBStillDenied.status()).toBe(403);

    // 6. Admin retains legitimate institutional access across all batches
    const resAdminA = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchAId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminA.status()).toBe(200);
    const adminMatesA = await resAdminA.json();
    expect(adminMatesA.batchmates.map(m => m.id)).toContain(studentAId);

    const resAdminB = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batchBId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminB.status()).toBe(200);
    const adminMatesB = await resAdminB.json();
    expect(adminMatesB.batchmates.map(m => m.id)).toContain(studentBId);

    const resAdminLeg = await request.get(`${apiUrl}/api/registry/batchmates?course_name=Cinema%20Aesthetics%20Masterclass&batch_number=AP01`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminLeg.status()).toBe(200);
    const adminMatesLeg = await resAdminLeg.json();
    expect(adminMatesLeg.batchmates.map(m => m.id)).toContain(legStudentId);

    // 7. Global Search Authorization & Scope Hardening (GET /api/registry/search)
    // Instructor assigned ONLY to Batch A searches for Student B from colliding Batch B:
    const resSearchB = await request.get(`${apiUrl}/api/registry/search?q=Bilal`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resSearchB.status()).toBe(200);
    const searchBData = await resSearchB.json();
    expect(searchBData.batchmates).toHaveLength(0);
    const searchBText = JSON.stringify(searchBData);
    expect(searchBText).not.toContain('Bilal');
    expect(searchBText).not.toContain('Al-Workshop');
    expect(searchBText).not.toContain('collision_student_b@test.com');
    expect(searchBText).not.toContain('Aspiring director and cinematographer from Workshop Batch');

    // Instructor searches by Student B email directly:
    const resSearchEmailB = await request.get(`${apiUrl}/api/registry/search?q=collision_student_b`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resSearchEmailB.status()).toBe(200);
    const searchEmailBData = await resSearchEmailB.json();
    expect(searchEmailBData.batchmates).toHaveLength(0);

    // Instructor searches for assigned Student A:
    const resSearchA = await request.get(`${apiUrl}/api/registry/search?q=Amina`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resSearchA.status()).toBe(200);
    const searchAData = await resSearchA.json();
    expect(searchAData.batchmates).toHaveLength(1);
    expect(searchAData.batchmates[0].id).toBe(studentAId);
    expect(searchAData.batchmates[0].email).toBe('collision_student_a@test.com');

    // Instructor searches broad term 'collision' (matching both student usernames):
    const resSearchBroad = await request.get(`${apiUrl}/api/registry/search?q=collision`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resSearchBroad.status()).toBe(200);
    const searchBroadData = await resSearchBroad.json();
    const broadIds = searchBroadData.batchmates.map(m => m.id);
    expect(broadIds).toContain(studentAId);
    expect(broadIds).not.toContain(studentBId);

    // Admin searches broad term 'collision': retains institution-wide access and sees both:
    const resAdminSearch = await request.get(`${apiUrl}/api/registry/search?q=collision`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminSearch.status()).toBe(200);
    const adminSearchData = await resAdminSearch.json();
    const adminSearchIds = adminSearchData.batchmates.map(m => m.id);
    expect(adminSearchIds).toContain(studentAId);
    expect(adminSearchIds).toContain(studentBId);

    // 8. Staff Course & Batch List Scope Filtering (GET /api/registry/courses & /batches)
    // Instructor assigned ONLY to Batch A requests available courses:
    const resInstCourses = await request.get(`${apiUrl}/api/registry/courses`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resInstCourses.status()).toBe(200);
    const instCoursesData = await resInstCourses.json();
    expect(instCoursesData.courses).toContain('Cinema Aesthetics Masterclass');

    // Instructor requests batches for Cinema Aesthetics Masterclass:
    const resInstBatches = await request.get(`${apiUrl}/api/registry/batches?course_name=Cinema%20Aesthetics%20Masterclass`, {
      headers: { Authorization: `Bearer ${instToken}` }
    });
    expect(resInstBatches.status()).toBe(200);
    const instBatchesData = await resInstBatches.json();
    const instBatchIds = instBatchesData.batch_list.map(b => b.id);
    expect(instBatchIds).toContain(batchAId);
    expect(instBatchIds).not.toContain(batchBId); // Batch B is strictly hidden!

    // Admin requests batches: sees both Batch A and Batch B:
    const resAdminBatches = await request.get(`${apiUrl}/api/registry/batches?course_name=Cinema%20Aesthetics%20Masterclass`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminBatches.status()).toBe(200);
    const adminBatchesData = await resAdminBatches.json();
    const adminBatchIds = adminBatchesData.batch_list.map(b => b.id);
    expect(adminBatchIds).toContain(batchAId);
    expect(adminBatchIds).toContain(batchBId);
  });

  test('9. Missing Fee Override Isolation: Two same-title/same-number batches exist, Batch A has fee override, Batch B has none; Batch B resolves fee from its course definition, never inheriting Batch A fee', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // Create Batch AP02 on Def A (title: 'Cinema Aesthetics Masterclass')
    const resB2A = await request.post(`${apiUrl}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Batch AP02 (Theory)',
        batch_number: 'AP02',
        course_definition_id: defAId,
        status: 'active'
      }
    });
    expect(resB2A.status()).toBe(201);
    const batchA2 = await resB2A.json();

    // Create Batch AP02 on Def B (title: 'Cinema Aesthetics Masterclass')
    const resB2B = await request.post(`${apiUrl}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Batch AP02 (Workshop)',
        batch_number: 'AP02',
        course_definition_id: defBId,
        status: 'active'
      }
    });
    expect(resB2B.status()).toBe(201);
    const batchB2 = await resB2B.json();

    // 1. Admin sets a custom fee override ONLY for Batch A2 (full_fee = 9000)
    const resFeeA2 = await request.post(`${apiUrl}/api/admin/batch-fees`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_id: batchA2.id,
        course_name: 'Cinema Aesthetics Masterclass',
        batch_number: 'AP02',
        phase1_fee: 9000,
        full_fee: 9000
      }
    });
    expect(resFeeA2.status()).toBe(200);

    // 2. Batch B2 has NO custom fee override in batch_course_fees!
    const feeRowB2 = db.prepare('SELECT * FROM batch_course_fees WHERE batch_id = ?').get(batchB2.id);
    expect(feeRowB2).toBeUndefined();

    // 3. Directly call getBatchFee for Batch A2 and Batch B2
    const feeA2 = getBatchFee('Cinema Aesthetics Masterclass', 'AP02', db, batchA2.id);
    expect(feeA2).toBeDefined();
    expect(feeA2.full_fee).toBe(9000);
    expect(feeA2.is_custom).toBe(true);

    const feeB2 = getBatchFee('Cinema Aesthetics Masterclass', 'AP02', db, batchB2.id);
    expect(feeB2).toBeDefined();
    // Batch B2 MUST NOT inherit Batch A2's 9000 fee!
    // It must resolve to Definition B's phase fee policy (7500):
    expect(feeB2.full_fee).toBe(7500);
    expect(feeB2.is_custom).toBe(false);

    // 4. Test resolvePhaseFee for an enrollment in Batch B2 with no recorded fee
    const resolvedB2 = resolvePhaseFee({
      feeDetailsRaw: null,
      phaseIndex: 0,
      courseDefId: defBId,
      batchId: batchB2.id,
      customDb: db
    });
    expect(resolvedB2.grossFee).toBe(7500);
    expect(resolvedB2.netPayable).toBe(7500);
    expect(resolvedB2.remainingDue).toBe(7500);
    expect(resolvedB2.isPaid).toBe(false);

    // 5. Verify batch details API for Batch B2 also reflects 7500, NOT 9000
    const resBatchDetailB2 = await request.get(`${apiUrl}/api/admin/batches/${batchB2.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resBatchDetailB2.status()).toBe(200);
    const detailB2 = await resBatchDetailB2.json();
    expect(detailB2.course_fee).toBe(7500);
  });

  test('10. Legacy Record alongside Colliding Defined Batches & Missing Course Settings Override', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Insert two legacy unlinked batches with SAME course_name (AP01 and AP02, course_definition_id = NULL)
    const legBatch1Insert = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status)
      VALUES (?, ?, ?, NULL, NULL, 'active')
    `).run('Legacy AP01 Cohort', 'AP01', 'Cinema Aesthetics Masterclass');
    const legacyBatch1Id = legBatch1Insert.lastInsertRowid;

    const legBatch2Insert = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status)
      VALUES (?, ?, ?, NULL, NULL, 'active')
    `).run('Legacy AP02 Cohort', 'AP02', 'Cinema Aesthetics Masterclass');
    const _legacyBatch2Id = legBatch2Insert.lastInsertRowid;

    // Create legacy student 1 in Batch AP01
    const legTs = Date.now();
    const legUser1Insert = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash_for_test', 'student', 'Legacy1', 'Student')
    `).run(`collision_student_legacy1_${legTs}`, `collision_legacy1_${legTs}@bfi.test`);
    const legacyStudent1Id = legUser1Insert.lastInsertRowid;

    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, batch_number)
      VALUES (?, 'Legacy Student 1', 'AP01')
    `).run(legacyStudent1Id);

    const legEnr1Insert = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, batch_id, course_definition_id, attendance_total)
      VALUES (?, 'Cinema Aesthetics Masterclass', 'appreciation', ?, NULL, 22)
    `).run(legacyStudent1Id, legacyBatch1Id);
    const legacyEnr1Id = legEnr1Insert.lastInsertRowid;

    // Create legacy student 2 in Batch AP02 (unlinked enrollment: batch_id IS NULL, scoped via profile)
    const legUser2Insert = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash_for_test', 'student', 'Legacy2', 'Student')
    `).run(`collision_student_legacy2_${legTs}`, `collision_legacy2_${legTs}@bfi.test`);
    const legacyStudent2Id = legUser2Insert.lastInsertRowid;

    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, batch_number)
      VALUES (?, 'Legacy Student 2', 'AP02')
    `).run(legacyStudent2Id);

    const legEnr2Insert = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, batch_id, course_definition_id, attendance_total)
      VALUES (?, 'Cinema Aesthetics Masterclass', 'appreciation', NULL, NULL, 22)
    `).run(legacyStudent2Id);
    const legacyEnr2Id = legEnr2Insert.lastInsertRowid;

    // 2. Missing course settings override test:
    // Batch A has custom course_settings (total_classes = 10 from Test 2)
    // Batch B has its custom course_settings row removed to simulate missing override
    db.prepare('DELETE FROM course_settings WHERE batch_id = ?').run(batchBId);

    // Check Batch B details via API
    const resBatchB = await request.get(`${apiUrl}/api/admin/batches/${batchBId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resBatchB.status()).toBe(200);
    const batchBData = await resBatchB.json();
    // Batch B must NOT inherit Batch A's custom 10 classes; it falls back to DEFAULT (22 classes)
    expect(batchBData.course_settings?.total_classes || 22).toBe(22);

    // 3. Legacy attendance update isolation:
    // Admin updates course settings for legacy unlinked 'AP01' WITHOUT batch_id (total_classes: 35)
    const resUpdateLegacy = await request.put(`${apiUrl}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        course_name: 'Cinema Aesthetics Masterclass',
        batch_number: 'AP01',
        total_classes: 35,
        exam_max_score: 100,
        exam_pass_mark: 33
      }
    });
    expect(resUpdateLegacy.status()).toBe(200);

    // Verify student_course_enrollments:
    // Legacy enrollment 1 (AP01) must update to 35
    const updatedLegEnr1 = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(legacyEnr1Id);
    expect(updatedLegEnr1.attendance_total).toBe(35);

    // Legacy enrollment 2 (AP02) must remain 22 (untouched by AP01 update!)
    const updatedLegEnr2 = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(legacyEnr2Id);
    expect(updatedLegEnr2.attendance_total).toBe(22);

    // Defined Batch A enrollment must remain 20 (untouched by legacy update)
    const enrARow = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(enrAId);
    expect(enrARow.attendance_total).toBe(20);

    // 4. Defined attendance update isolation:
    // Admin updates course settings specifically for Batch B (batch_id: batchBId, total_classes: 16)
    const resUpdateBatchB = await request.put(`${apiUrl}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_id: batchBId,
        course_name: 'Cinema Aesthetics Masterclass',
        batch_number: 'AP01',
        total_classes: 16,
        exam_max_score: 100,
        exam_pass_mark: 33
      }
    });
    expect(resUpdateBatchB.status()).toBe(200);

    // Defined Batch B enrollment must be updated to 16
    const updatedEnrB = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(enrBId);
    expect(updatedEnrB.attendance_total).toBe(16);

    // Legacy enrollment 1 must still be 35
    const recheckedLegEnr1 = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(legacyEnr1Id);
    expect(recheckedLegEnr1.attendance_total).toBe(35);

    // Legacy enrollment 2 must still be 22
    const recheckedLegEnr2 = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(legacyEnr2Id);
    expect(recheckedLegEnr2.attendance_total).toBe(22);

    // Batch A enrollment must still be 20
    const recheckedEnrA = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(enrAId);
    expect(recheckedEnrA.attendance_total).toBe(20);

    // 5. Available-batch selector audit:
    const resAvail = await request.get(`${apiUrl}/api/admin/batch-fees/available-batches?course_name=Cinema%20Aesthetics%20Masterclass&format=detailed`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAvail.status()).toBe(200);
    const availData = await resAvail.json();
    expect(availData.defined_batches).toBeDefined();
    const definedIds = availData.defined_batches.map(b => b.batch_id);
    expect(definedIds).toContain(batchAId);
    expect(definedIds).toContain(batchBId);
  });

  test('11. Migration Suite: Test older schema migration & startup halt on corrupted database', async () => {
    // 1. Create an in-memory test database with legacy schema (table-level UNIQUE constraints)
    const legacyDb = new Database(':memory:');
    legacyDb.pragma('foreign_keys = OFF');

    legacyDb.exec(`
      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_name TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        course_name TEXT NOT NULL,
        course_definition_id INTEGER,
        course_version INTEGER
      );

      CREATE TABLE batch_course_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_name TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        phase1_fee INTEGER NOT NULL DEFAULT 0,
        phase2_fee INTEGER NOT NULL DEFAULT 0,
        full_fee INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(course_name, batch_number)
      );

      CREATE TABLE course_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_name TEXT NOT NULL,
        batch_number TEXT NOT NULL DEFAULT 'DEFAULT',
        total_classes INTEGER DEFAULT 22,
        exam_max_score INTEGER DEFAULT 100,
        exam_pass_mark INTEGER DEFAULT 33,
        has_assignment INTEGER DEFAULT 0,
        assignments TEXT DEFAULT '[]',
        has_phase2 INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(course_name, batch_number)
      );

      CREATE TABLE course_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        file_url TEXT,
        file_type TEXT,
        batch_number TEXT,
        course_name TEXT,
        uploaded_by INTEGER NOT NULL,
        is_downloadable INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      INSERT INTO batches (id, batch_name, batch_number, course_name, course_definition_id)
      VALUES (1, 'Legacy Batch', 'B01', 'Online Filmmaking Course', NULL);

      INSERT INTO batch_course_fees (id, course_name, batch_number, phase1_fee, full_fee)
      VALUES (1, 'Online Filmmaking Course', 'B01', 4000, 8000);

      INSERT INTO course_settings (id, course_name, batch_number, total_classes)
      VALUES (1, 'Online Filmmaking Course', 'B01', 22);

      INSERT INTO course_materials (id, title, batch_number, course_name, uploaded_by)
      VALUES (1, 'Legacy Syllabus', 'B01', 'Online Filmmaking Course', 1);
    `);

    // Verify old table-level unique constraints exist
    const bcfIndices = legacyDb.prepare('PRAGMA index_list(batch_course_fees)').all();
    expect(bcfIndices.some(i => i.origin === 'u')).toBe(true);

    const csIndices = legacyDb.prepare('PRAGMA index_list(course_settings)').all();
    expect(csIndices.some(i => i.origin === 'u')).toBe(true);

    // Run downstream migration
    const { runDownstreamCollisionMigration } = await import('../server/db/migrations/20261022_downstream_identity_collision_fix.cjs');
    const migRes = runDownstreamCollisionMigration(legacyDb);
    expect(migRes.applied).toBe(true);

    // Verify new scoped partial indexes exist
    const postBcfIndices = legacyDb.prepare('PRAGMA index_list(batch_course_fees)').all();
    expect(postBcfIndices.some(i => i.name === 'idx_bcf_batch_id')).toBe(true);
    expect(postBcfIndices.some(i => i.name === 'idx_bcf_legacy_unique')).toBe(true);

    const postCsIndices = legacyDb.prepare('PRAGMA index_list(course_settings)').all();
    expect(postCsIndices.some(i => i.name === 'idx_cs_batch_id')).toBe(true);
    expect(postCsIndices.some(i => i.name === 'idx_cs_legacy_unique')).toBe(true);

    // Verify batch_id column added to course_materials
    const cmCols = legacyDb.prepare('PRAGMA table_info(course_materials)').all();
    expect(cmCols.some(c => c.name === 'batch_id')).toBe(true);

    // Verify data was 100% preserved
    expect(legacyDb.prepare('SELECT COUNT(*) as c FROM batch_course_fees').get().c).toBe(1);
    expect(legacyDb.prepare('SELECT COUNT(*) as c FROM course_settings').get().c).toBe(1);
    expect(legacyDb.prepare('SELECT COUNT(*) as c FROM course_materials').get().c).toBe(1);

    // 2. Test Corruption / Constraint Mismatch Failure Behavior:
    // Verify that a corrupted table or data mismatch causes migration to throw immediately,
    // protecting the database from half-migrated state.
    const corruptDb = new Database(':memory:');
    corruptDb.exec(`
      CREATE TABLE batches (
        id INTEGER PRIMARY KEY,
        batch_name TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        course_name TEXT NOT NULL
      );
    `);

    const { runBatchesConstraintMigration } = await import('../server/db/migrations/20261022_batches_unique_constraint_fix.cjs');
    
    // Corrupt trigger that fails during table rebuild
    corruptDb.exec(`
      CREATE TRIGGER failing_trigger AFTER INSERT ON batches
      BEGIN
        SELECT RAISE(FAIL, 'Deliberate test corruption trigger failure');
      END;
    `);

    // Verify that attempting to corrupt or fail within transaction aborts cleanly
    // and rethrowing halts startup
    expect(() => {
      runBatchesConstraintMigration(corruptDb);
    }).toThrow();

    legacyDb.close();
    corruptDb.close();
  });

  test('12. Read-Only Fee Resolution: Verify getBatchFee and fee reads leave the database completely unchanged', async ({ request }) => {
    const apiUrl = getTestApiUrl();

    // 1. Create an unlinked custom fee row in batch_course_fees where batch_id IS NULL
    const testCourseName = 'ReadOnly Fee Isolation Course ' + Date.now();
    const testBatchNumber = 'RO_' + Date.now();
    const initialFee = 9200;

    const bcfInsert = db.prepare(`
      INSERT INTO batch_course_fees (batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee)
      VALUES (NULL, ?, ?, ?, 0, ?)
    `).run(testCourseName, testBatchNumber, initialFee, initialFee);
    const feeRowId = bcfInsert.lastInsertRowid;

    // 2. Create one matching batch record with this course_name and batch_number
    const batchInsert = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version, status)
      VALUES (?, ?, ?, ?, 1, 'active')
    `).run('ReadOnly Test Cohort', testBatchNumber, testCourseName, defAId);
    const roBatchId = batchInsert.lastInsertRowid;

    try {
      // 3. Snapshot the exact fee row state before resolution
      const feeRowBefore = db.prepare('SELECT * FROM batch_course_fees WHERE id = ?').get(feeRowId);
      expect(feeRowBefore.batch_id).toBeNull();
      expect(feeRowBefore.full_fee).toBe(initialFee);

      // 4. Resolve the batch fee via feeResolver helper
      const { getBatchFee, resolvePhaseFee } = await import('../server/utils/feeResolver.js');
      const resolvedDirect = getBatchFee(testCourseName, testBatchNumber, db, roBatchId);
      expect(resolvedDirect).toBeDefined();
      expect(resolvedDirect.full_fee).toBe(initialFee);
      expect(resolvedDirect.is_custom).toBe(true);

      const resolvedPhase = resolvePhaseFee({
        feeDetailsRaw: null,
        phaseIndex: 0,
        courseName: testCourseName,
        batchNumber: testBatchNumber,
        batchId: roBatchId,
        customDb: db
      });
      expect(resolvedPhase.grossFee).toBe(initialFee);

      // 5. Query batch detail via HTTP API (triggering server-side fee lookup)
      const resApi = await request.get(`${apiUrl}/api/admin/batches/${roBatchId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      expect(resApi.status()).toBe(200);
      const apiBatch = await resApi.json();
      expect(apiBatch.course_fee).toBe(initialFee);

      // 6. Verify that the database was 100% UNTOUCHED by fee resolution
      const feeRowAfter = db.prepare('SELECT * FROM batch_course_fees WHERE id = ?').get(feeRowId);
      expect(feeRowAfter.batch_id).toBeNull(); // Must NOT have been mutated to roBatchId!
      expect(JSON.stringify(feeRowBefore)).toBe(JSON.stringify(feeRowAfter));
    } finally {
      // Clean up test fixture
      db.prepare('DELETE FROM batch_course_fees WHERE id = ?').run(feeRowId);
      db.prepare('DELETE FROM batches WHERE id = ?').run(roBatchId);
    }
  });

  test('13. Dual-Enrolled Student UI & Refresh Persistence: Student enrolled in two same-title definitions selects each batch and verifies isolation survives page reload', async ({ page }) => {
    await setupTestRouteProxy(page);

    const dualTs = Date.now();
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password123', salt);

    // 1. Create dual-enrolled student
    const resUserDual = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, 'student', 'Zainab', 'DualEnrolled')
    `).run(`collision_student_dual_${dualTs}`, `collision_dual_${dualTs}@test.com`, hash);
    const dualStudentId = resUserDual.lastInsertRowid;

    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, batch_number, bio)
      VALUES (?, 'Zainab DualEnrolled', 'AP01', 'Cross-curriculum scholar in theory and workshop')
    `).run(dualStudentId);

    // 2. Enroll in both same-title definitions (Batch A and Batch B)
    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id)
      VALUES (?, 'Cinema Aesthetics Masterclass', 'appreciation', ?, 1, ?)
    `).run(dualStudentId, defAId, batchAId);

    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id)
      VALUES (?, ?)
    `).run(batchAId, dualStudentId);

    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id)
      VALUES (?, 'Cinema Aesthetics Masterclass', 'workshop', ?, 1, ?)
    `).run(dualStudentId, defBId, batchBId);

    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id)
      VALUES (?, ?)
    `).run(batchBId, dualStudentId);

    const dualToken = jwt.sign(
      { 
        id: dualStudentId, 
        username: `collision_student_dual_${dualTs}`, 
        role: 'student', 
        name: 'Zainab DualEnrolled' 
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 3. Authenticate in browser context
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('auth_user_cache', JSON.stringify(user));
    }, {
      token: dualToken,
      user: { 
        id: dualStudentId, 
        username: `collision_student_dual_${dualTs}`, 
        role: 'student', 
        first_name: 'Zainab', 
        last_name: 'DualEnrolled' 
      }
    });

    // 4. Navigate to Registry
    await page.goto('/bfi-classroom/registry', { waitUntil: 'networkidle' });

    // Verify both distinct enrollment cards exist for the same title
    const cardA = page.locator(`[data-testid="enrollment-card-${batchAId}"]`);
    const cardB = page.locator(`[data-testid="enrollment-card-${batchBId}"]`);

    await expect(cardA).toBeVisible({ timeout: 10000 });
    await expect(cardB).toBeVisible({ timeout: 10000 });
    await expect(cardA).toContainText('Cinema Aesthetics Masterclass');
    await expect(cardA).toContainText('Batch AP01 (Theory)');
    await expect(cardB).toContainText('Cinema Aesthetics Masterclass');
    await expect(cardB).toContainText('Batch AP01 (Workshop)');

    // 5. Select Batch A
    await cardA.click();

    // Verify Batch A classmates view:
    // Should see Amina Al-Theory (Batch A student)
    // Should NOT see Bilal Al-Workshop (Batch B student)
    const studentGrid = page.locator('.students-grid');
    await expect(studentGrid).toBeVisible({ timeout: 10000 });
    await expect(studentGrid).toContainText('Amina Al-Theory');
    await expect(studentGrid).not.toContainText('Bilal Al-Workshop');

    // Breadcrumb verification
    const breadcrumb = page.locator('.registry-breadcrumb');
    await expect(breadcrumb).toContainText('Batch AP01 (Theory)');

    // 6. Refresh page while viewing Batch A
    await page.reload({ waitUntil: 'networkidle' });

    // Verify view and isolation persist after refresh
    await expect(page.locator('.students-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.students-grid')).toContainText('Amina Al-Theory');
    await expect(page.locator('.students-grid')).not.toContainText('Bilal Al-Workshop');
    await expect(page.locator('.registry-breadcrumb')).toContainText('Batch AP01 (Theory)');

    // 7. Click "Courses" in breadcrumb to return to course list
    const coursesCrumb = page.locator('.registry-breadcrumb .breadcrumb-item', { hasText: 'Courses' });
    await coursesCrumb.click();

    // Verify back on enrollment selection
    await expect(cardA).toBeVisible({ timeout: 10000 });
    await expect(cardB).toBeVisible({ timeout: 10000 });

    // 8. Select Batch B
    await cardB.click();

    // Verify Batch B classmates view:
    // Should see Bilal Al-Workshop (Batch B student)
    // Should NOT see Amina Al-Theory (Batch A student)
    await expect(page.locator('.students-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.students-grid')).toContainText('Bilal Al-Workshop');
    await expect(page.locator('.students-grid')).not.toContainText('Amina Al-Theory');
    await expect(page.locator('.registry-breadcrumb')).toContainText('Batch AP01 (Workshop)');

    // 9. Refresh page while viewing Batch B
    await page.reload({ waitUntil: 'networkidle' });

    // Verify view and isolation persist after refresh
    await expect(page.locator('.students-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.students-grid')).toContainText('Bilal Al-Workshop');
    await expect(page.locator('.students-grid')).not.toContainText('Amina Al-Theory');
    await expect(page.locator('.registry-breadcrumb')).toContainText('Batch AP01 (Workshop)');
  });

  test('14. Registry Global Search UI Isolation: Instructor assigned only to Batch A searches in Registry UI, verifying student from colliding Batch B is never displayed and admin can search both', async ({ page }) => {
    await setupTestRouteProxy(page);

    const instTs = Date.now();
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password123', salt);

    // 1. Create Instructor assigned strictly and exclusively to Batch A
    const resInstUi = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, 'instructor', 'Tariq', 'InstructorA')
    `).run(`collision_inst_ui_${instTs}`, `collision_inst_ui_${instTs}@test.com`, hash);
    const instUiId = resInstUi.lastInsertRowid;

    // Explicit assignment via batch_moderators to Batch A only
    db.prepare(`
      INSERT INTO batch_moderators (batch_id, user_id)
      VALUES (?, ?)
    `).run(batchAId, instUiId);

    const instUiToken = jwt.sign(
      { 
        id: instUiId, 
        username: `collision_inst_ui_${instTs}`, 
        role: 'instructor', 
        name: 'Tariq InstructorA' 
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 2. Authenticate as Instructor in browser context
    await page.goto('/bfi-classroom/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ token, user }) => {
      sessionStorage.clear();
      localStorage.setItem('token', token);
      localStorage.setItem('auth_user_cache', JSON.stringify(user));
    }, {
      token: instUiToken,
      user: { 
        id: instUiId, 
        username: `collision_inst_ui_${instTs}`, 
        role: 'instructor', 
        first_name: 'Tariq', 
        last_name: 'InstructorA' 
      }
    });

    // 3. Navigate to Registry
    await page.goto('/bfi-classroom/registry', { waitUntil: 'networkidle' });

    // Verify master search input is visible for staff
    const searchInput = page.locator('input[placeholder*="Master Search"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // 4. Search for Student B from colliding Batch B (Bilal)
    await searchInput.fill('Bilal');

    // Wait for debounced search execution (500ms debounce)
    await expect(page.locator('.students-count')).toContainText('0 Results Found', { timeout: 10000 });
    await expect(page.locator('.empty-state')).toContainText('No students found.');
    await expect(page.locator('.students-grid')).not.toBeVisible();
    
    // Assert zero exposure of Student B's details across entire page DOM
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Bilal Al-Workshop');
    expect(pageContent).not.toContain('collision_student_b@test.com');
    expect(pageContent).not.toContain('Aspiring director and cinematographer from Workshop Batch');

    // 5. Search for assigned Student A (Amina)
    await searchInput.fill('Amina');
    await expect(page.locator('.students-count')).toContainText('1 Results Found', { timeout: 10000 });
    const studentGrid = page.locator('.students-grid');
    await expect(studentGrid).toBeVisible({ timeout: 10000 });
    await expect(studentGrid).toContainText('Amina Al-Theory');
    await expect(studentGrid).not.toContainText('Bilal Al-Workshop');

    // 6. Verify Course and Batch Navigation isolation for instructor:
    // Clear search
    await searchInput.fill('');
    // Courses grid should only show Cinema Aesthetics Masterclass
    const coursesGrid = page.locator('.courses-grid');
    await expect(coursesGrid).toBeVisible({ timeout: 10000 });
    await expect(coursesGrid).toContainText('Cinema Aesthetics Masterclass');

    // Click course
    await page.locator('.courses-grid .registry-card', { hasText: 'Cinema Aesthetics Masterclass' }).click();

    // Batches view should show ONLY Batch A (Theory), NEVER Batch B (Workshop)
    const batchesGrid = page.locator('.batches-grid');
    await expect(batchesGrid).toBeVisible({ timeout: 10000 });
    await expect(batchesGrid).toContainText('Batch AP01 (Theory)');
    await expect(batchesGrid).not.toContainText('Batch AP01 (Workshop)');

    // 7. Test Admin search capability: switch context to Admin
    await page.evaluate(({ token, user }) => {
      sessionStorage.clear();
      localStorage.setItem('token', token);
      localStorage.setItem('auth_user_cache', JSON.stringify(user));
    }, {
      token: adminToken,
      user: { id: adminUser.id, username: adminUser.username, role: 'admin', first_name: adminUser.first_name, last_name: adminUser.last_name }
    });

    await page.goto('/bfi-classroom/registry', { waitUntil: 'networkidle' });
    const adminSearchInput = page.locator('input[placeholder*="Master Search"]');
    await expect(adminSearchInput).toBeVisible({ timeout: 10000 });

    // Admin searches 'Bilal' -> found
    await adminSearchInput.fill('Bilal');
    await expect(page.locator('.students-count')).toContainText('1 Results Found', { timeout: 10000 });
    const adminGrid = page.locator('.students-grid');
    await expect(adminGrid).toBeVisible({ timeout: 10000 });
    await expect(adminGrid).toContainText('Bilal Al-Workshop');

    // Admin searches 'Amina' -> found
    await adminSearchInput.fill('Amina');
    await expect(page.locator('.students-count')).toContainText('1 Results Found', { timeout: 10000 });
    await expect(adminGrid).toContainText('Amina Al-Theory');

    // Admin searches broad term 'collision' (matching both Student A and Student B)
    await adminSearchInput.fill('collision');
    await expect(page.locator('.students-count')).toContainText('Results Found', { timeout: 10000 });
    await expect(adminGrid).toContainText('Amina Al-Theory');
    await expect(adminGrid).toContainText('Bilal Al-Workshop');
  });

  test('15. Strict Registry Authorization & Scope Isolation: bfi_batch untyped numeric collisions, duplicate legacy cohorts, hybrid collisions, explicit typed assignments, and UI verification', async ({ request, page }) => {
    await setupTestRouteProxy(page);
    const apiUrl = getTestApiUrl();
    const tStamp = Date.now();

    // =========================================================================
    // Scenario A: A numeric batch number equal to another batch's database ID
    // =========================================================================
    // Create Batch 1: has auto-increment ID = batch1Id, batch_number = 'ALPHA01'
    const b1Res = db.prepare(`
      INSERT INTO batches (course_name, batch_number, batch_name)
      VALUES (?, ?, ?)
    `).run('Numeric Collision Course One', 'ALPHA01', 'Alpha 01 Batch');
    const batch1Id = b1Res.lastInsertRowid;

    // Create Batch 2: has batch_number = String(batch1Id)!
    // Notice: batch_number is the EXACT string of Batch 1's database ID!
    const b2Res = db.prepare(`
      INSERT INTO batches (course_name, batch_number, batch_name)
      VALUES (?, ?, ?)
    `).run('Numeric Collision Course Two', String(batch1Id), `Numeric Batch ${batch1Id}`);
    const batch2Id = b2Res.lastInsertRowid;

    // Create Student in Batch 1
    const s1User = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentOne', 'Alpha')
    `).run(`collision_num_s1_${tStamp}`, `collision_num_s1_${tStamp}@test.com`);
    const s1Id = s1User.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(s1Id, 'StudentOne Alpha', 'ALPHA01');
    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, batch_id)
      VALUES (?, ?, ?)
    `).run(s1Id, 'Numeric Collision Course One', batch1Id);

    // Create Student in Batch 2
    const s2User = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentTwo', 'Beta')
    `).run(`collision_num_s2_${tStamp}`, `collision_num_s2_${tStamp}@test.com`);
    const s2Id = s2User.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(s2Id, 'StudentTwo Beta', String(batch1Id));
    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, batch_id)
      VALUES (?, ?, ?)
    `).run(s2Id, 'Numeric Collision Course Two', batch2Id);

    // Instructor with untyped bfi_batch = String(batch1Id)
    // IMPORTANT: Because this string is untyped, it MUST resolve to batch_number = String(batch1Id) (Batch 2).
    // It must NEVER be interpreted as database ID = batch1Id (Batch 1)!
    const instNumUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'UntypedNum', 'Instructor')
    `).run(`collision_inst_num_${tStamp}`, `collision_inst_num_${tStamp}@test.com`);
    const instNumId = instNumUser.lastInsertRowid;
    db.prepare('INSERT INTO instructor_profiles (user_id, full_name, bfi_batch) VALUES (?, ?, ?)').run(instNumId, 'UntypedNum Instructor', String(batch1Id));

    const instNumToken = jwt.sign(
      { id: instNumId, username: `collision_inst_num_${tStamp}`, role: 'instructor', name: 'UntypedNum Instructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Instructor queries Batch 1 (whose database ID is batch1Id): MUST BE DENIED (403)
    const resInstNumB1 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batch1Id}`, {
      headers: { Authorization: `Bearer ${instNumToken}` }
    });
    expect(resInstNumB1.status()).toBe(403);
    const b1Err = await resInstNumB1.json();
    expect(b1Err.error).toMatch(/Access denied/i);

    // Instructor queries Batch 2 (whose batch_number is String(batch1Id)): MUST SUCCEED (200)
    const resInstNumB2 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batch2Id}`, {
      headers: { Authorization: `Bearer ${instNumToken}` }
    });
    expect(resInstNumB2.status()).toBe(200);
    const b2Data = await resInstNumB2.json();
    const b2Mates = b2Data.batchmates.map(m => m.id);
    expect(b2Mates).toContain(s2Id);
    expect(b2Mates).not.toContain(s1Id);

    // Search via /api/registry/search: StudentTwo is visible, StudentOne is completely hidden
    const resSearchS1 = await request.get(`${apiUrl}/api/registry/search?q=StudentOne`, {
      headers: { Authorization: `Bearer ${instNumToken}` }
    });
    expect(resSearchS1.status()).toBe(200);
    const s1Search = await resSearchS1.json();
    expect(s1Search.batchmates).toHaveLength(0);

    const resSearchS2 = await request.get(`${apiUrl}/api/registry/search?q=StudentTwo`, {
      headers: { Authorization: `Bearer ${instNumToken}` }
    });
    expect(resSearchS2.status()).toBe(200);
    const s2Search = await resSearchS2.json();
    expect(s2Search.batchmates.map(m => m.id)).toContain(s2Id);

    // Typed identifier: Instructor with bfi_batch = `batch_id:${batch1Id}`
    const instTypedUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'TypedId', 'Instructor')
    `).run(`collision_inst_typed_${tStamp}`, `collision_inst_typed_${tStamp}@test.com`);
    const instTypedId = instTypedUser.lastInsertRowid;
    db.prepare('INSERT INTO instructor_profiles (user_id, full_name, bfi_batch) VALUES (?, ?, ?)').run(instTypedId, 'TypedId Instructor', `batch_id:${batch1Id}`);

    const instTypedToken = jwt.sign(
      { id: instTypedId, username: `collision_inst_typed_${tStamp}`, role: 'instructor', name: 'TypedId Instructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Typed ID instructor can access Batch 1 (200) and cannot access Batch 2 (403)
    const resTypedB1 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batch1Id}`, {
      headers: { Authorization: `Bearer ${instTypedToken}` }
    });
    expect(resTypedB1.status()).toBe(200);
    const typedB1Mates = (await resTypedB1.json()).batchmates.map(m => m.id);
    expect(typedB1Mates).toContain(s1Id);
    expect(typedB1Mates).not.toContain(s2Id);

    const resTypedB2 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${batch2Id}`, {
      headers: { Authorization: `Bearer ${instTypedToken}` }
    });
    expect(resTypedB2.status()).toBe(403);


    // =========================================================================
    // Scenario B: Two legacy batches with the same course title and batch number
    // =========================================================================
    const legCourse = 'Legacy Scriptwriting Masterclass';
    const legBNum = `LEG${tStamp.toString().slice(-4)}`;

    // Create Legacy Batch L1
    const legB1Res = db.prepare(`
      INSERT INTO batches (course_name, batch_number, batch_name, course_definition_id)
      VALUES (?, ?, ?, NULL)
    `).run(legCourse, legBNum, 'Legacy Batch L1');
    const legB1Id = legB1Res.lastInsertRowid;

    // Create Legacy Batch L2 (same course_name with case variation, same batch_number)
    const legB2Res = db.prepare(`
      INSERT INTO batches (course_name, batch_number, batch_name, course_definition_id)
      VALUES (?, ?, ?, NULL)
    `).run(legCourse.toLowerCase(), legBNum, 'Legacy Batch L2');
    const legB2Id = legB2Res.lastInsertRowid;

    // Student in L1
    const sL1User = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentL1', 'Legacy')
    `).run(`collision_s_l1_${tStamp}`, `collision_s_l1_${tStamp}@test.com`);
    const sL1Id = sL1User.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(sL1Id, 'StudentL1 Legacy', legBNum);
    db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (?, ?, ?)').run(sL1Id, legCourse, legB1Id);

    // Student in L2
    const sL2User = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentL2', 'Legacy')
    `).run(`collision_s_l2_${tStamp}`, `collision_s_l2_${tStamp}@test.com`);
    const sL2Id = sL2User.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(sL2Id, 'StudentL2 Legacy', legBNum);
    db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (?, ?, ?)').run(sL2Id, legCourse.toLowerCase(), legB2Id);

    // Student L3 in genuinely unlinked enrollment for this legacy course
    const sL3User = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentL3', 'Unlinked')
    `).run(`collision_s_l3_${tStamp}`, `collision_s_l3_${tStamp}@test.com`);
    const sL3Id = sL3User.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(sL3Id, 'StudentL3 Unlinked', legBNum);
    db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (?, ?, NULL)').run(sL3Id, legCourse);

    // Instructor with untyped bfi_batch = 'LEG99'
    // Because two active batches share 'LEG99', matching is ambiguous -> MUST BE DENIED FOR BOTH
    const instDupLegUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'DupLeg', 'Instructor')
    `).run(`collision_inst_dupleg_${tStamp}`, `collision_inst_dupleg_${tStamp}@test.com`);
    const instDupLegId = instDupLegUser.lastInsertRowid;
    db.prepare('INSERT INTO instructor_profiles (user_id, full_name, bfi_batch) VALUES (?, ?, ?)').run(instDupLegId, 'DupLeg Instructor', legBNum);

    const instDupLegToken = jwt.sign(
      { id: instDupLegId, username: `collision_inst_dupleg_${tStamp}`, role: 'instructor', name: 'DupLeg Instructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Denied for L1 (403) and L2 (403)
    const resDupL1 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${legB1Id}`, {
      headers: { Authorization: `Bearer ${instDupLegToken}` }
    });
    expect(resDupL1.status()).toBe(403);

    const resDupL2 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${legB2Id}`, {
      headers: { Authorization: `Bearer ${instDupLegToken}` }
    });
    expect(resDupL2.status()).toBe(403);

    // Legacy query parameters also denied due to ambiguity
    const resDupLegParams = await request.get(`${apiUrl}/api/registry/batchmates?course_name=${encodeURIComponent(legCourse)}&batch_number=${legBNum}`, {
      headers: { Authorization: `Bearer ${instDupLegToken}` }
    });
    expect(resDupLegParams.status()).toBe(403);

    // Search returns empty (0 results)
    const resSearchDup = await request.get(`${apiUrl}/api/registry/search?q=StudentL`, {
      headers: { Authorization: `Bearer ${instDupLegToken}` }
    });
    expect(resSearchDup.status()).toBe(200);
    expect((await resSearchDup.json()).batchmates).toHaveLength(0);

    // Now explicitly assign an instructor to L1 via batch_moderators
    const instModL1User = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'ModL1', 'Instructor')
    `).run(`collision_inst_modl1_${tStamp}`, `collision_inst_modl1_${tStamp}@test.com`);
    const instModL1Id = instModL1User.lastInsertRowid;
    db.prepare('INSERT INTO instructor_profiles (user_id, full_name) VALUES (?, ?)').run(instModL1Id, 'ModL1 Instructor');
    db.prepare('INSERT INTO batch_moderators (batch_id, user_id) VALUES (?, ?)').run(legB1Id, instModL1Id);

    const instModL1Token = jwt.sign(
      { id: instModL1Id, username: `collision_inst_modl1_${tStamp}`, role: 'instructor', name: 'ModL1 Instructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Explicit moderator assignment authorizes L1 (200), keeps L2 denied (403)
    const resModL1 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${legB1Id}`, {
      headers: { Authorization: `Bearer ${instModL1Token}` }
    });
    expect(resModL1.status()).toBe(200);
    const modL1Mates = (await resModL1.json()).batchmates.map(m => m.id);
    expect(modL1Mates).toContain(sL1Id);
    expect(modL1Mates).not.toContain(sL2Id);

    const resModL2 = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${legB2Id}`, {
      headers: { Authorization: `Bearer ${instModL1Token}` }
    });
    expect(resModL2.status()).toBe(403);

    // Search for ModL1 shows StudentL1, never StudentL2 or unlinked StudentL3
    const resSearchModL1 = await request.get(`${apiUrl}/api/registry/search?q=StudentL`, {
      headers: { Authorization: `Bearer ${instModL1Token}` }
    });
    expect(resSearchModL1.status()).toBe(200);
    const modL1SearchIds = (await resSearchModL1.json()).batchmates.map(m => m.id);
    expect(modL1SearchIds).toContain(sL1Id);
    expect(modL1SearchIds).not.toContain(sL2Id);
    expect(modL1SearchIds).not.toContain(sL3Id);


    // =========================================================================
    // Scenario C: A legacy and a defined batch sharing the same identifier
    // =========================================================================
    const hybCourse = `Hybrid Test Course ${tStamp}`;
    const hybBNum = 'HYB77';

    // Defined course definition & batch
    const hybDef = db.prepare(`
      INSERT INTO course_definitions (name, slug, course_type, phase_count, status, version, definition_json, created_by, updated_by)
      VALUES (?, ?, 'appreciation', 1, 'published', 1, '{}', ?, ?)
    `).run(`Hybrid Course Def ${tStamp}`, `hybrid-course-def-${tStamp}`, adminUser.id, adminUser.id);
    const hybDefId = hybDef.lastInsertRowid;

    const hybDefBatch = db.prepare(`
      INSERT INTO batches (course_name, batch_number, batch_name, course_definition_id)
      VALUES (?, ?, ?, ?)
    `).run(hybCourse, hybBNum, 'Hybrid Defined Batch', hybDefId);
    const hybDefBatchId = hybDefBatch.lastInsertRowid;

    // Legacy batch sharing hybBNum ('HYB77')
    const hybLegBatch = db.prepare(`
      INSERT INTO batches (course_name, batch_number, batch_name, course_definition_id)
      VALUES (?, ?, ?, NULL)
    `).run(`Old Hybrid Course ${tStamp}`, hybBNum, 'Hybrid Legacy Batch');
    const hybLegBatchId = hybLegBatch.lastInsertRowid;

    // Student in Defined Batch
    const sHybDefUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentHybDef', 'Defined')
    `).run(`collision_s_hybdef_${tStamp}`, `collision_s_hybdef_${tStamp}@test.com`);
    const sHybDefId = sHybDefUser.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(sHybDefId, 'StudentHybDef Defined', hybBNum);
    db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_definition_id, batch_id) VALUES (?, ?, ?, ?)').run(sHybDefId, hybCourse, hybDefId, hybDefBatchId);

    // Student in Legacy Batch
    const sHybLegUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'student', 'StudentHybLeg', 'Legacy')
    `).run(`collision_s_hybleg_${tStamp}`, `collision_s_hybleg_${tStamp}@test.com`);
    const sHybLegId = sHybLegUser.lastInsertRowid;
    db.prepare('INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (?, ?, ?)').run(sHybLegId, 'StudentHybLeg Legacy', hybBNum);
    db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (?, ?, ?)').run(sHybLegId, `Old Hybrid Course ${tStamp}`, hybLegBatchId);

    // Instructor with untyped bfi_batch = 'HYB77'
    // Matches BOTH Defined and Legacy batch -> Ambiguous! Deny completely. Do NOT pick legacy fallback!
    const instHybUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, 'dummy_hash', 'instructor', 'HybInst', 'Instructor')
    `).run(`collision_inst_hyb_${tStamp}`, `collision_inst_hyb_${tStamp}@test.com`);
    const instHybId = instHybUser.lastInsertRowid;
    db.prepare('INSERT INTO instructor_profiles (user_id, full_name, bfi_batch) VALUES (?, ?, ?)').run(instHybId, 'HybInst Instructor', hybBNum);

    const instHybToken = jwt.sign(
      { id: instHybId, username: `collision_inst_hyb_${tStamp}`, role: 'instructor', name: 'HybInst Instructor' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Both defined and legacy batch denied (403)
    const resHybDef = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${hybDefBatchId}`, {
      headers: { Authorization: `Bearer ${instHybToken}` }
    });
    expect(resHybDef.status()).toBe(403);

    const resHybLeg = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${hybLegBatchId}`, {
      headers: { Authorization: `Bearer ${instHybToken}` }
    });
    expect(resHybLeg.status()).toBe(403);

    // Search returns empty
    const resSearchHyb = await request.get(`${apiUrl}/api/registry/search?q=StudentHyb`, {
      headers: { Authorization: `Bearer ${instHybToken}` }
    });
    expect(resSearchHyb.status()).toBe(200);
    expect((await resSearchHyb.json()).batchmates).toHaveLength(0);


    // =========================================================================
    // Scenario D & E: Authorized access & UI verification
    // =========================================================================
    // Verify an instructor explicitly assigned to Defined Batch D can view classmates and search
    db.prepare('INSERT INTO batch_moderators (batch_id, user_id) VALUES (?, ?)').run(hybDefBatchId, instHybId);

    const resHybDefAssigned = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${hybDefBatchId}`, {
      headers: { Authorization: `Bearer ${instHybToken}` }
    });
    expect(resHybDefAssigned.status()).toBe(200);
    const hybAssignedMates = (await resHybDefAssigned.json()).batchmates.map(m => m.id);
    expect(hybAssignedMates).toContain(sHybDefId);
    expect(hybAssignedMates).not.toContain(sHybLegId);

    // HybLeg batch still strictly denied
    const resHybLegStillDenied = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${hybLegBatchId}`, {
      headers: { Authorization: `Bearer ${instHybToken}` }
    });
    expect(resHybLegStillDenied.status()).toBe(403);

    // Search shows StudentHybDef, strictly hides StudentHybLeg
    const resSearchHybAssigned = await request.get(`${apiUrl}/api/registry/search?q=StudentHyb`, {
      headers: { Authorization: `Bearer ${instHybToken}` }
    });
    expect(resSearchHybAssigned.status()).toBe(200);
    const hybSearchIds = (await resSearchHybAssigned.json()).batchmates.map(m => m.id);
    expect(hybSearchIds).toContain(sHybDefId);
    expect(hybSearchIds).not.toContain(sHybLegId);

    // Registry UI Verification via Playwright page
    await page.goto('/bfi-classroom/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ token, user }) => {
      sessionStorage.clear();
      localStorage.setItem('token', token);
      localStorage.setItem('auth_user_cache', JSON.stringify(user));
    }, {
      token: instHybToken,
      user: { id: instHybId, username: `collision_inst_hyb_${tStamp}`, role: 'instructor', first_name: 'HybInst', last_name: 'Instructor' }
    });

    await page.goto('/bfi-classroom/registry', { waitUntil: 'networkidle' });
    const searchInput = page.locator('input[placeholder*="Master Search"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Search for unauthorized student StudentHybLeg: 0 results / empty state
    await searchInput.fill('StudentHybLeg');
    await expect(page.locator('.students-count')).toContainText('0 Results Found', { timeout: 10000 });
    await expect(page.locator('.empty-state')).toContainText('No students found.');
    await expect(page.locator('.students-grid')).not.toBeVisible();
    const registryPageText = await page.content();
    expect(registryPageText).not.toContain('StudentHybLeg Defined');
    expect(registryPageText).not.toContain('StudentHybLeg Legacy');

    // Search for authorized student StudentHybDef: visible in results
    await searchInput.fill('StudentHybDef');
    await expect(page.locator('.students-count')).toContainText('1 Results Found', { timeout: 10000 });
    const studentGrid = page.locator('.students-grid');
    await expect(studentGrid).toBeVisible({ timeout: 10000 });
    await expect(studentGrid).toContainText('StudentHybDef Defined');
    await expect(studentGrid).not.toContainText('StudentHybLeg Legacy');


    // =========================================================================
    // Scenario F: Admin access still working across all batches and search
    // =========================================================================
    const resAdminHybDef = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${hybDefBatchId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminHybDef.status()).toBe(200);
    expect((await resAdminHybDef.json()).batchmates.map(m => m.id)).toContain(sHybDefId);

    const resAdminHybLeg = await request.get(`${apiUrl}/api/registry/batchmates?batch_id=${hybLegBatchId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminHybLeg.status()).toBe(200);
    expect((await resAdminHybLeg.json()).batchmates.map(m => m.id)).toContain(sHybLegId);

    const resAdminSearchHyb = await request.get(`${apiUrl}/api/registry/search?q=StudentHyb`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resAdminSearchHyb.status()).toBe(200);
    const adminSearchIds = (await resAdminSearchHyb.json()).batchmates.map(m => m.id);
    expect(adminSearchIds).toContain(sHybDefId);
    expect(adminSearchIds).toContain(sHybLegId);
  });

  test.afterAll(async () => {
    if (db) {
      db.close();
    }
  });
});
