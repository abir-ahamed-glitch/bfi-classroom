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
  setupTestRouteProxy,
  startTestServer
} from './test-db-isolation.js';
import { resolvePhaseFee } from '../server/utils/feeResolver.js';
import { courseProgressService } from '../server/services/courseProgressService.js';

dotenv.config();

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;
let testAppCourseDefId;
let testSecondDefId;
let batch1Id;
let batch2Id;
let batch3Id;
let student1Id;
let student2Id;
let student3Id;
let enrollment1Id;

test.beforeAll(async () => {
  // Ensure test server is started on port 3099
  await startTestServer();

  // Verify test server isolation and rejection of production target
  await assertServerRejectionProof('http://127.0.0.1:3001');
  const serverIdentity = await verifyServerIsolation(getTestApiUrl());
  console.log(`[Appreciation & Multi-Batch Test] Connected to isolated test server: port=${serverIdentity.port} db=${serverIdentity.dbPath}`);

  await initIsolatedTestDatabase(DB_PATH);
  db = new Database(DB_PATH);
  assertIsolatedTestDatabase(db.name || DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
  const insertSession = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
    VALUES (?, 'test_session_hash', '127.0.0.1', 'playwright_test', datetime('now', '+1 day'), datetime('now'), datetime('now'), datetime('now'))
  `).run(adminUser.id);
  const adminSessionId = insertSession.lastInsertRowid;

  adminToken = jwt.sign(
    { 
      id: adminUser.id, 
      username: adminUser.username, 
      role: adminUser.role, 
      name: `${adminUser.first_name} ${adminUser.last_name}`,
      type: 'access',
      sessionId: adminSessionId,
      token_version: adminUser.token_version || 1
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Clean old test records
  db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'apptest_%'))").run();
  db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'apptest_%'))").run();
  db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'apptest_%'))").run();
  db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'apptest_%')").run();
  db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'apptest_%')").run();
  db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'apptest_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'apptest_%'").run();
  db.prepare("DELETE FROM course_routine_audits WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE name LIKE 'Appreciation Test%')").run();
  db.prepare("DELETE FROM course_routine_overrides WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE name LIKE 'Appreciation Test%')").run();
  db.prepare("DELETE FROM batch_course_fees WHERE course_name LIKE 'Appreciation Test%'").run();
  db.prepare("DELETE FROM batches WHERE course_name LIKE 'Appreciation Test%'").run();
  db.prepare("DELETE FROM course_definitions WHERE name LIKE 'Appreciation Test%'").run();
});

test.describe('Course Maker: Appreciation Course & Multi-Batch Isolation', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Create and publish an Appreciation Course with stable course_type="appreciation"', async ({ request }) => {
    const coursePayload = {
      name: 'Appreciation Test Cinema Aesthetics',
      course_type: 'appreciation',
      description: 'Masterclass in cinematic visual analysis and narrative critique.',
      duration_value: 2,
      duration_unit: 'months',
      phase_count: 1,
      phases: [
        {
          id: 'phase_1',
          phaseIndex: 1,
          title: 'Aesthetics & Semiotics',
          description: 'Film language and visual analysis',
          duration: { value: 2, unit: 'months' },
          classCount: 2,
          feeAmount: 6000,
          requirements: {
            attendanceRequired: true,
            minAttendancePercent: 75
          },
          routine: [
            { weekday: 'Saturday', startTime: '18:00', endTime: '20:00', room: 'Hall A' }
          ],
          classes: [
            { id: 'c1', title: 'Mise-en-scene', deliveryMode: 'live', category: 'theory' },
            { id: 'c2', title: 'Montage Theory', deliveryMode: 'live', category: 'theory' }
          ],
          assignments: [
            { id: 'a1', title: 'Shot Breakdown Essay', maxMarks: 50, passMarks: 25 }
          ],
          exam: {
            enabled: true,
            type: 'written',
            maxMarks: 50,
            passMarks: 25,
            phasePassThreshold: 50
          }
        }
      ],
      completionPolicy: {
        certificateEligible: true,
        phaseGates: {
          requirePreviousPass: false,
          requireFeePayment: true
        }
      }
    };

    const createRes = await request.post(`${getTestApiUrl()}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: coursePayload
    });

    expect(createRes.status()).toBe(201);
    const createdData = await createRes.json();
    testAppCourseDefId = createdData.id;
    expect(testAppCourseDefId).toBeGreaterThan(0);
    expect(createdData.status).toBe('draft');

    // Verify persisted course_type is exactly 'appreciation'
    const dbRow = db.prepare('SELECT course_type, status FROM course_definitions WHERE id = ?').get(testAppCourseDefId);
    expect(dbRow.course_type).toBe('appreciation');
    expect(dbRow.status).toBe('draft');

    // Publish the course definition
    const pubRes = await request.post(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(pubRes.status()).toBe(200);
    const pubData = await pubRes.json();
    expect(pubData.status).toBe('published');

    // Verify GET /api/admin/course-definitions/:id contains course_type: 'appreciation'
    const getRes = await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(getRes.status()).toBe(200);
    const defDetail = await getRes.json();
    expect(defDetail.course_type).toBe('appreciation');
    expect(defDetail.status).toBe('published');
    expect(Array.isArray(defDetail.batches)).toBe(true);
    expect(defDetail.batch_count).toBe(0);
    expect(defDetail.total_students).toBe(0);
  });

  test('2. Support unlimited batches per definition: create >= 3 batches linked to this definition', async ({ request }) => {
    expect(testAppCourseDefId).toBeDefined();

    // Create Batch 1
    const b1Res = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Appreciation Autumn Batch',
        batch_number: 'AP01',
        course_definition_id: testAppCourseDefId,
        status: 'active',
        start_date: '2026-11-01',
        end_date: '2026-11-30',
        description: 'First autumn cohort'
      }
    });
    expect(b1Res.status()).toBe(201);
    const b1Data = await b1Res.json();
    batch1Id = b1Data.id;
    expect(b1Data.course_definition_id).toBe(testAppCourseDefId);
    expect(b1Data.course_version).toBe(1);

    // Create Batch 2
    const b2Res = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Appreciation Winter Batch',
        batch_number: 'AP02',
        course_definition_id: testAppCourseDefId,
        status: 'upcoming',
        start_date: '2026-12-01',
        end_date: '2026-12-31',
        description: 'Second winter cohort'
      }
    });
    expect(b2Res.status()).toBe(201);
    const b2Data = await b2Res.json();
    batch2Id = b2Data.id;
    expect(b2Data.course_definition_id).toBe(testAppCourseDefId);

    // Create Batch 3
    const b3Res = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Appreciation Spring Batch',
        batch_number: 'AP03',
        course_definition_id: testAppCourseDefId,
        status: 'upcoming',
        start_date: '2027-01-01',
        end_date: '2027-01-31',
        description: 'Third spring cohort'
      }
    });
    expect(b3Res.status()).toBe(201);
    const b3Data = await b3Res.json();
    batch3Id = b3Data.id;
    expect(b3Data.course_definition_id).toBe(testAppCourseDefId);

    // Verify course definition catalog GET attaches all 3 batches
    const getRes = await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(getRes.status()).toBe(200);
    const defDetail = await getRes.json();
    expect(defDetail.batch_count).toBe(3);
    expect(defDetail.batches.length).toBe(3);
    const batchNumbers = defDetail.batches.map(b => b.batch_number);
    expect(batchNumbers).toContain('AP01');
    expect(batchNumbers).toContain('AP02');
    expect(batchNumbers).toContain('AP03');
  });

  test('3. Enforce duplicate batch-number rejection within the same course definition', async ({ request }) => {
    // Attempt to create another batch with duplicate batch_number 'AP01' for this course definition
    const dupRes = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Appreciation Conflict Batch',
        batch_number: 'AP01', // Collides with Batch 1
        course_definition_id: testAppCourseDefId,
        status: 'upcoming'
      }
    });
    expect(dupRes.status()).toBe(409);
    const errData = await dupRes.json();
    expect(errData.error).toContain('already exists for this course');
  });

  test('4. Two course definitions with exact same title have isolated batches and same batch_number AP01 without collision', async ({ request }) => {
    // 4.1: Verify server rejects conflicting client-supplied course_name for a course definition
    const conflictRes = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Conflict Batch',
        batch_number: 'AP99',
        course_definition_id: testAppCourseDefId,
        course_name: 'Completely Wrong And Conflicting Title',
        status: 'upcoming'
      }
    });
    expect(conflictRes.status()).toBe(400);
    const conflictData = await conflictRes.json();
    expect(conflictData.error).toContain('Conflicting course_name supplied');

    // 4.2: Create a second course definition with the EXACT SAME title 'Appreciation Test Cinema Aesthetics'
    // but distinct slug 'appreciation-test-cinema-aesthetics-ed2'
    const secondDefRes = await request.post(`${getTestApiUrl()}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        name: 'Appreciation Test Cinema Aesthetics', // EXACT SAME TITLE
        slug: 'appreciation-test-cinema-aesthetics-ed2',
        course_type: 'appreciation',
        description: 'Second edition of cinema aesthetics with exact same title',
        duration_value: 3,
        duration_unit: 'months',
        phase_count: 1,
        phases: [
          {
            id: 'p1',
            title: 'Advanced Seminar',
            classCount: 1,
            classes: [{ id: 'c1', title: 'Deconstruction', deliveryMode: 'live', category: 'theory' }]
          }
        ]
      }
    });
    expect(secondDefRes.status()).toBe(201);
    const secondData = await secondDefRes.json();
    testSecondDefId = secondData.id;

    await request.post(`${getTestApiUrl()}/api/admin/course-definitions/${testSecondDefId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    // 4.3: Create Batch 'AP01' for this SECOND definition.
    // Definition 1 already has a batch with batch_number 'AP01' and course_name 'Appreciation Test Cinema Aesthetics'!
    // Under the old schema, UNIQUE(batch_number, course_name) would have violated uniqueness.
    // Under the scoped schema UNIQUE(batch_number, course_definition_id), this SUCCEEDS!
    const secondBatchRes = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Edition 2 Premiere Batch',
        batch_number: 'AP01', // Exact same batch_number 'AP01' as Course 1's batch!
        course_definition_id: testSecondDefId,
        status: 'upcoming'
      }
    });
    expect(secondBatchRes.status()).toBe(201);
    const secondBatch = await secondBatchRes.json();
    expect(secondBatch.course_definition_id).toBe(testSecondDefId);
    expect(secondBatch.course_name).toBe('Appreciation Test Cinema Aesthetics'); // Authoritatively derived from definition!

    // 4.4: Verify duplicate AP01 within Definition 2 is strictly rejected with 409
    const dupDef2Res = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Edition 2 Duplicate Batch',
        batch_number: 'AP01',
        course_definition_id: testSecondDefId,
        status: 'upcoming'
      }
    });
    expect(dupDef2Res.status()).toBe(409);
    const dupDef2Err = await dupDef2Res.json();
    expect(dupDef2Err.error).toContain('already exists for this course');

    // 4.5: Verify duplicate AP01 within Definition 1 is also strictly rejected with 409
    const dupDef1Res = await request.post(`${getTestApiUrl()}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        batch_name: 'Edition 1 Duplicate Batch',
        batch_number: 'AP01',
        course_definition_id: testAppCourseDefId,
        status: 'upcoming'
      }
    });
    expect(dupDef1Res.status()).toBe(409);
    const dupDef1Err = await dupDef1Res.json();
    expect(dupDef1Err.error).toContain('already exists for this course');

    // 4.6: Verify Course 1 still has only its 3 batches, and Course 2 only has its 1 batch
    const c1Detail = await (await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    expect(c1Detail.batch_count).toBe(3);

    const c2Detail = await (await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testSecondDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    expect(c2Detail.batch_count).toBe(1);
    expect(c2Detail.batches[0].id).toBe(secondBatch.id);
    expect(c2Detail.batches[0].batch_number).toBe('AP01');
  });

  test('5. Student enrollment propagates course_type="appreciation" and maintains strict batch separation', async ({ request }) => {
    // Create 3 separate test students
    for (let i = 1; i <= 3; i++) {
      const uRes = db.prepare(`
        INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
        VALUES (?, '$2a$10$abcdefghijklmnopqrstuu', ?, 'User', ?, 'student', 1)
      `).run(`apptest_student_${i}`, `Student${i}`, `student${i}.apptest@example.com`);
      const sId = uRes.lastInsertRowid;
      db.prepare(`
        INSERT INTO student_profiles (user_id, student_id, full_name, batch_number)
        VALUES (?, ?, ?, ?)
      `).run(sId, `BFIA${i}`, `Appreciation Student ${i}`, `AP0${i}`);

      if (i === 1) student1Id = sId;
      if (i === 2) student2Id = sId;
      if (i === 3) student3Id = sId;
    }

    // Assign Student 1 to Batch 1
    const assign1 = await request.post(`${getTestApiUrl()}/api/admin/batches/${batch1Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { student_ids: [student1Id] }
    });
    expect(assign1.status()).toBe(200);

    // Assign Student 2 to Batch 2
    const assign2 = await request.post(`${getTestApiUrl()}/api/admin/batches/${batch2Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { student_ids: [student2Id] }
    });
    expect(assign2.status()).toBe(200);

    // Assign Student 3 to Batch 3
    const assign3 = await request.post(`${getTestApiUrl()}/api/admin/batches/${batch3Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { student_ids: [student3Id] }
    });
    expect(assign3.status()).toBe(200);

    // Verify enrollment records: course_type must be 'appreciation' (NOT 'workshop')
    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id IN (?, ?, ?)').all(student1Id, student2Id, student3Id);
    expect(enrollments.length).toBe(3);
    for (const enr of enrollments) {
      expect(enr.course_type).toBe('appreciation');
      expect(enr.course_definition_id).toBe(testAppCourseDefId);
      expect(enr.course_version).toBe(1);
    }

    const enr1 = enrollments.find(e => e.user_id === student1Id);
    enrollment1Id = enr1.id;
    expect(enr1.batch_id).toBe(batch1Id);

    // Verify Batch separation in Batch Details API:
    // Batch 1 detail only has Student 1
    const b1Detail = await (await request.get(`${getTestApiUrl()}/api/admin/batches/${batch1Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    const b1StudentIds = b1Detail.map(s => s.user_id);
    expect(b1StudentIds).toContain(student1Id);
    expect(b1StudentIds).not.toContain(student2Id);
    expect(b1StudentIds).not.toContain(student3Id);

    // Course definition totals aggregate all batches (3 total students)
    const defSummary = await (await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    expect(defSummary.total_students).toBe(3);
  });

  test('6. Batch-specific routine and fee overrides operate without mutating the shared course definition', async ({ request }) => {
    // Apply routine override to Batch 1 specifically
    const overrideRoutine = [
      { weekday: 'Sunday', startTime: '10:00', endTime: '12:00', room: 'Custom Studio B' }
    ];
    const routineRes = await request.put(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}/routine`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: {
        phase_id: 'phase_1',
        batch_id: batch1Id,
        routine: overrideRoutine,
        reason: 'Custom batch Sunday morning schedule override'
      }
    });
    expect(routineRes.status()).toBe(200);

    // Verify Batch 1's resolved routine has the override
    const b1Def = await (await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}?batch_id=${batch1Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    expect(b1Def.definition.phases[0].routine[0].weekday).toBe('Sunday');
    expect(b1Def.definition.phases[0].routineSource).toBe('batch_override');

    // Verify master definition (and other batches) still have original Saturday schedule
    const masterDef = await (await request.get(`${getTestApiUrl()}/api/admin/course-definitions/${testAppCourseDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    expect(masterDef.definition.phases[0].routine[0].weekday).toBe('Saturday');
    expect(masterDef.definition.phases[0].routineSource).toBe('definition_baseline');

    // Set batch-specific fee in batch_course_fees for Batch 1 (5000) and Batch 2 (7000)
    db.prepare(`
      INSERT INTO batch_course_fees (batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee)
      VALUES (?, ?, 'AP01', 5000, 0, 5000), (?, ?, 'AP02', 7000, 0, 7000)
    `).run(batch1Id, 'Appreciation Test Cinema Aesthetics', batch2Id, 'Appreciation Test Cinema Aesthetics');

    // Test resolvePhaseFee for student in Batch 1 vs Batch 2
    const feeResB1 = resolvePhaseFee({
      feeDetailsRaw: { status: 'Pending' },
      courseType: 'appreciation',
      phaseNumber: 1,
      batchId: batch1Id,
      customDb: db
    });
    expect(feeResB1.grossFee).toBe(5000);
    expect(feeResB1.remainingDue).toBe(5000);
    expect(feeResB1.isPaid).toBe(false);

    const feeResB2 = resolvePhaseFee({
      feeDetailsRaw: { status: 'Pending' },
      courseType: 'appreciation',
      phaseNumber: 1,
      batchId: batch2Id,
      customDb: db
    });
    expect(feeResB2.grossFee).toBe(7000);
    expect(feeResB2.remainingDue).toBe(7000);
  });

  test('7. Certificate eligibility and locking for Appreciation Course with unpaid vs paid fee', async ({ request }) => {
    // Evaluate progress: record attendance, assignment, & pass exam for Phase 1
    await courseProgressService.recordClassAttendance(enrollment1Id, 'c1', true, adminUser.id, db);
    await courseProgressService.recordClassAttendance(enrollment1Id, 'c2', true, adminUser.id, db);
    await courseProgressService.recordAssignmentGrade(enrollment1Id, 'a1', 40, 'graded', 'Well done', adminUser.id, db);
    await courseProgressService.recordExamMarks(enrollment1Id, 'phase_1', 40, db);

    // Check certificate route: fee is unpaid, certificate must be locked
    const certUnpaidRes = await request.get(`${getTestApiUrl()}/api/certification/my-certificates`, {
      headers: { Authorization: `Bearer ${jwt.sign({ id: student1Id, username: 'apptest_student_1', role: 'student', type: 'access' }, JWT_SECRET, { expiresIn: '1d' })}` }
    });
    expect(certUnpaidRes.status()).toBe(200);
    const certUnpaidData = await certUnpaidRes.json();
    const student1Cert = certUnpaidData.certificates.find(c => c.enrollmentId === enrollment1Id);
    expect(student1Cert).toBeDefined();
    expect(student1Cert.locked).toBe(true);

    // Now record valid payment of full fee (6000) in fee_details
    const paidFeeDetails = JSON.stringify({
      full_fee: 6000,
      amount_paid: 6000,
      status: 'Paid Full',
      phases: [
        { phase_number: 1, fee_amount: 6000, amount_paid: 6000, status: 'Paid Full', payment_method: 'bKash' }
      ]
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(paidFeeDetails, enrollment1Id);

    // Re-check certificate route: now unlocked!
    const certPaidRes = await request.get(`${getTestApiUrl()}/api/certification/my-certificates`, {
      headers: { Authorization: `Bearer ${jwt.sign({ id: student1Id, username: 'apptest_student_1', role: 'student', type: 'access' }, JWT_SECRET, { expiresIn: '1d' })}` }
    });
    expect(certPaidRes.status()).toBe(200);
    const certPaidData = await certPaidRes.json();
    const unlockedCert = certPaidData.certificates.find(c => c.enrollmentId === enrollment1Id);
    expect(unlockedCert).toBeDefined();
    expect(unlockedCert.locked).toBeUndefined();
    expect(unlockedCert.studentDetails.fullName).toBe('Appreciation Student 1');
    expect(unlockedCert.studentDetails.batchNumber).toBe('AP01');
  });

  test('8. Browser UI: Course Maker catalog card displays linked batches, Create Batch action, and accessible responsive layout', async ({ page }) => {
    await setupTestRouteProxy(page);

    // Authenticate admin in browser
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('auth_user_cache', JSON.stringify(user));
    }, { token: adminToken, user: { id: adminUser.id, username: adminUser.username, role: 'admin', first_name: 'Admin', last_name: 'User' } });

    // Desktop Viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/bfi-classroom/admin/course-maker');
    await page.waitForSelector('.cm-catalog-grid', { timeout: 15000 });

    // Find our Appreciation Course Edition 1 card (with 3 batches)
    const courseCard = page.locator('.cm-catalog-card').filter({ hasText: 'Appreciation Test Cinema Aesthetics' }).filter({ hasText: 'Appreciation Autumn Batch' }).first();
    await expect(courseCard).toBeVisible();

    // Also verify Edition 2 card (with 1 batch) exists with exact same title in catalog but isolated batches
    const ed2Card = page.locator('.cm-catalog-card').filter({ hasText: 'Appreciation Test Cinema Aesthetics' }).filter({ hasText: 'Edition 2 Premiere Batch' }).first();
    await expect(ed2Card).toBeVisible();
    await expect(ed2Card.locator('.cm-catalog-batches-section')).toContainText('Batches (1)');

    // Verify course type label renders "Appreciation Course"
    await expect(courseCard.locator('.cm-catalog-card-footer')).toContainText('Appreciation Course');

    // Verify linked batches section is visible
    const batchesSection = courseCard.locator('.cm-catalog-batches-section');
    await expect(batchesSection).toBeVisible();
    await expect(batchesSection).toContainText('Batches (3)');
    await expect(batchesSection).toContainText('3 Enrolled');

    // Verify all 3 batches are listed with status badges and Manage buttons
    await expect(batchesSection).toContainText('Appreciation Autumn Batch');
    await expect(batchesSection).toContainText('Appreciation Winter Batch');
    await expect(batchesSection).toContainText('Appreciation Spring Batch');

    // Check touch targets and zero hover transforms
    const manageButtons = batchesSection.locator('button:has-text("Manage")');
    const manageCount = await manageButtons.count();
    expect(manageCount).toBe(3);

    // Helper function to measure touch targets (>= 44x44px per WCAG / design specs)
    const verifyTouchTargets = async (viewportName) => {
      const cbBtn = batchesSection.locator('button:has-text("Create Batch")').first();
      const cbBox = await cbBtn.boundingBox();
      expect(cbBox.height, `Create Batch height at ${viewportName}`).toBeGreaterThanOrEqual(44);
      expect(cbBox.width, `Create Batch width at ${viewportName}`).toBeGreaterThanOrEqual(44);

      const mButtons = batchesSection.locator('button:has-text("Manage")');
      const count = await mButtons.count();
      for (let i = 0; i < count; i++) {
        const btn = mButtons.nth(i);
        const box = await btn.boundingBox();
        expect(box.height, `Manage button ${i} height at ${viewportName}`).toBeGreaterThanOrEqual(44);
        expect(box.width, `Manage button ${i} width at ${viewportName}`).toBeGreaterThanOrEqual(44);
      }
    };

    // Verify touch targets at Desktop Viewport (1440x900)
    await verifyTouchTargets('desktop (1440px)');

    // Verify no transform hover violation
    const firstManage = batchesSection.locator('button:has-text("Manage")').first();
    await firstManage.hover();
    const transform = await firstManage.evaluate(el => window.getComputedStyle(el).transform);
    expect(transform).toBe('none');

    // Click "+ Create Batch" button from within the catalog card
    const createBatchBtn = courseCard.locator('button:has-text("Create Batch")').first();
    await expect(createBatchBtn).toBeVisible();
    await createBatchBtn.click();

    // Verify BatchFormModal opened and is pre-filled with this course definition
    const batchModal = page.locator('.batch-modal-container');
    await expect(batchModal).toBeVisible();
    await expect(batchModal.locator('.batch-modal-header-title')).toContainText('Create New Batch');

    // Close the modal
    await batchModal.locator('button.icon-btn-ghost').click();
    await expect(batchModal).toBeHidden();

    // Tablet Viewport (768x1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);
    await verifyTouchTargets('tablet (768px)');

    // Mobile Viewport (375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await expect(courseCard).toBeVisible();
    await expect(batchesSection).toBeVisible();
    await verifyTouchTargets('mobile (375px)');
  });

  test('9. Migration test against database copy with existing batches validates row counts, FK integrity, and scoped uniqueness', async () => {
    // Create an in-memory database with the legacy table-level UNIQUE(batch_number, course_name)
    const tempDb = new Database(':memory:');
    tempDb.pragma('foreign_keys = ON');

    // Initialize schema matching legacy database structure
    tempDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL
      );

      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_name TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        course_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'upcoming',
        start_date DATE,
        end_date DATE,
        description TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        slug TEXT,
        deleted_at TEXT DEFAULT NULL,
        deleted_by_admin_id INTEGER DEFAULT NULL,
        course_definition_id INTEGER,
        course_version INTEGER,
        UNIQUE(batch_number, course_name)
      );

      CREATE TABLE batch_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id),
        UNIQUE(batch_id, student_id)
      );

      CREATE TABLE student_course_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        course_name TEXT NOT NULL,
        course_type TEXT NOT NULL DEFAULT 'filmmaking',
        batch_id INTEGER REFERENCES batches(id),
        attendance_total INTEGER DEFAULT 22
      );

      CREATE TRIGGER set_default_attendance_total
      AFTER INSERT ON student_course_enrollments
      FOR EACH ROW
      WHEN NEW.attendance_total = 22
      BEGIN
        UPDATE student_course_enrollments
        SET attendance_total = 25
        WHERE id = NEW.id;
      END;
    `);

    // Seed historical rows: 2 unlinked legacy batches, 1 defined batch
    tempDb.exec(`
      INSERT INTO users (username) VALUES ('mig_student_1'), ('mig_student_2');

      INSERT INTO batches (id, batch_name, batch_number, course_name, course_definition_id)
      VALUES (1, 'Legacy Batch 1', 'B01', 'Online Filmmaking Course', NULL),
             (2, 'Legacy Batch 2', 'B02', 'Online Filmmaking Course', NULL);

      INSERT INTO batches (id, batch_name, batch_number, course_name, course_definition_id, course_version)
      VALUES (3, 'Defined Course Batch 1', 'D01', 'Film Appreciation Masterclass', 201, 1);

      INSERT INTO batch_students (batch_id, student_id) VALUES (1, 1), (3, 2);
      INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (1, 'Online Filmmaking Course', 1), (2, 'Film Appreciation Masterclass', 3);
    `);

    // Verify old table-level unique constraint exists before migration
    const preIndices = tempDb.prepare('PRAGMA index_list(batches)').all();
    const hasOldUnique = preIndices.some(i => i.origin === 'u' && i.unique === 1);
    expect(hasOldUnique).toBe(true);

    // Execute migration
    const { runBatchesConstraintMigration } = await import('../server/db/migrations/20261022_batches_unique_constraint_fix.cjs');
    const migResult = runBatchesConstraintMigration(tempDb);
    expect(migResult.applied).toBe(true);
    expect(migResult.preBatchesCount).toBe(3);
    expect(migResult.postBatchesCount).toBe(3);
    expect(migResult.batchStudentsCount).toBe(2);
    expect(migResult.enrollmentsWithBatchCount).toBe(2);

    // Verify zero FK errors
    const fkErrors = tempDb.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors.length).toBe(0);

    // Verify trigger integrity after migration
    tempDb.prepare("INSERT INTO student_course_enrollments (user_id, course_name, attendance_total) VALUES (1, 'Test Course Trigger', 22)").run();
    const testRow = tempDb.prepare("SELECT attendance_total FROM student_course_enrollments WHERE course_name = 'Test Course Trigger'").get();
    expect(testRow.attendance_total).toBe(25);

    // Verify scoped uniqueness behavior:
    // 1. Same batch_number 'D01' on DIFFERENT definition (id: 202) with same title succeeds:
    const insertSameNumberDiffDef = tempDb.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version)
      VALUES ('Defined Course Batch 2', 'D01', 'Film Appreciation Masterclass', 202, 1)
    `);
    expect(() => insertSameNumberDiffDef.run()).not.toThrow();

    // 2. Duplicate batch_number 'D01' on SAME definition (id: 201) fails with UNIQUE constraint error:
    const insertDupOnSameDef = tempDb.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, course_version)
      VALUES ('Defined Course Batch 1 Dup', 'D01', 'Film Appreciation Masterclass', 201, 1)
    `);
    expect(() => insertDupOnSameDef.run()).toThrow(/UNIQUE constraint failed/);

    // 3. Legacy unlinked courses still forbid duplicate (batch_number, course_name):
    const insertDupLegacy = tempDb.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id)
      VALUES ('Legacy Batch 1 Dup', 'B01', 'Online Filmmaking Course', NULL)
    `);
    expect(() => insertDupLegacy.run()).toThrow(/UNIQUE constraint failed/);

    tempDb.close();
  });

});
