import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation 
} from './test-db-isolation.js';

dotenv.config();

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let studentToken;
let adminUser;

function cleanupMultiBatchArtifacts(database) {
  try {
    database.prepare(`
      DELETE FROM student_phase_results 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments 
        WHERE course_name LIKE 'Test Multi-Batch%' OR user_id = 99995
      )
    `).run();

    database.prepare(`
      DELETE FROM student_class_attendance 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments 
        WHERE course_name LIKE 'Test Multi-Batch%' OR user_id = 99995
      )
    `).run();

    database.prepare(`
      DELETE FROM student_assignment_grades 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments 
        WHERE course_name LIKE 'Test Multi-Batch%' OR user_id = 99995
      )
    `).run();

    database.prepare(`
      DELETE FROM student_course_enrollments 
      WHERE course_name LIKE 'Test Multi-Batch%' OR user_id = 99995
    `).run();

    database.prepare(`
      DELETE FROM batch_students 
      WHERE student_id = 99995 
         OR batch_id IN (SELECT id FROM batches WHERE batch_name LIKE 'Test Multi-Batch%')
    `).run();

    database.prepare(`
      DELETE FROM course_routine_audits 
      WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug LIKE 'test-multi-batch%')
    `).run();

    database.prepare(`
      DELETE FROM course_routine_overrides 
      WHERE course_definition_id IN (SELECT id FROM course_definitions WHERE slug LIKE 'test-multi-batch%')
    `).run();

    database.prepare(`
      DELETE FROM batches 
      WHERE batch_name LIKE 'Test Multi-Batch%'
    `).run();

    database.prepare(`
      DELETE FROM course_definitions 
      WHERE slug LIKE 'test-multi-batch%'
    `).run();

    database.prepare(`
      DELETE FROM users WHERE id = 99995
    `).run();

    database.prepare(`
      DELETE FROM student_profiles WHERE user_id = 99995
    `).run();
  } catch (err) {
    console.error('Cleanup warning:', err.message);
  }
}

test.beforeAll(async () => {
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  cleanupMultiBatchArtifacts(db);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (99995, 'test_multibatch', 'multibatch_spec@bfibd.org', 'test_hash', 'student', 'Multi', 'BatchStudent', 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO student_profiles (user_id, student_id, batch_number, full_name)
    VALUES (99995, 'BFI-MB-99995', 'MB-Base', 'Multi BatchStudent')
  `).run();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  studentToken = jwt.sign(
    { id: 99995, username: 'test_multibatch', role: 'student', name: 'Multi BatchStudent' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
});

test.afterAll(() => {
  if (db) {
    cleanupMultiBatchArtifacts(db);
    db.close();
  }
});

test.describe('Multi-Batch Enrollment, Subject Round-Trip, and Page Spacing Suite', () => {

  test('1. Assignment subject field round-trip in Course Maker API and progress service', async ({ request }) => {
    const slug = `test-multi-batch-subject-${Date.now()}`;
    const courseName = `Test Multi-Batch Subject Course ${Date.now()}`;

    // Create course with explicit assignment subjects
    const createRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        slug,
        name: courseName,
        course_type: 'workshop',
        duration: { value: 6, unit: 'weeks' },
        phase_count: 2,
        phases: [
          {
            id: 'phase_1',
            phaseIndex: 1,
            title: 'Phase 1 - Screenplay Foundations',
            classCount: 1,
            requirements: { attendanceRequired: true, minAttendancePercent: 80, completionRequired: true },
            routine: [{ weekday: 'Saturday', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c1_1', title: 'Scriptwriting Class', deliveryMode: 'live', category: 'theory', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              {
                id: 'asg_subj_1',
                title: 'Treatment Exercise',
                subject: 'Screenwriting & Narrative',
                instructions: 'Write a 2-page dramatic treatment.',
                submissionRequired: true,
                maxMarks: 50,
                passMarks: 25
              }
            ],
            exam: { enabled: false }
          },
          {
            id: 'phase_2',
            phaseIndex: 2,
            title: 'Phase 2 - Sound & Audio Post',
            classCount: 1,
            requirements: { attendanceRequired: true, minAttendancePercent: 80, completionRequired: true },
            routine: [{ weekday: 'Sunday', startTime: '14:00', endTime: '16:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c2_1', title: 'DAW Mixing Lab', deliveryMode: 'live', category: 'editing', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              {
                id: 'asg_subj_2',
                title: 'Dialogue Cleaning Task',
                subject: 'Audio Engineering',
                instructions: 'Clean background hum using EQ and iZotope RX.',
                submissionRequired: true,
                maxMarks: 50,
                passMarks: 25
              }
            ],
            exam: { enabled: false }
          }
        ],
        completionPolicy: {
          certificateEligibility: { allRequiredPhasesPassed: true },
          reEnrollment: { discountEnabled: true, discountPercentage: 50 }
        }
      }
    });

    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    const courseDefId = created.id;

    // Publish the course definition
    const publishRes = await request.post(`${API_BASE}/api/admin/course-definitions/${courseDefId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(publishRes.status()).toBe(200);

    // Fetch the published definition and verify assignment subject round-trip
    const fetchRes = await request.get(`${API_BASE}/api/admin/course-definitions/${courseDefId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(fetchRes.status()).toBe(200);
    const fetched = await fetchRes.json();

    const p1Asg = fetched.definition.phases[0].assignments[0];
    expect(p1Asg.subject).toBe('Screenwriting & Narrative');
    expect(p1Asg.title).toBe('Treatment Exercise');

    const p2Asg = fetched.definition.phases[1].assignments[0];
    expect(p2Asg.subject).toBe('Audio Engineering');
    expect(p2Asg.title).toBe('Dialogue Cleaning Task');
  });

  test('2. Course Maker page spacing: heading and top controls visible below fixed header on Desktop and Mobile', async ({ page }) => {
    // Inject admin authentication
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
    }, { t: adminToken, u: userPayload });

    // ── Desktop Viewport (1280x800) ──
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:5174/bfi-classroom/admin/course-maker', { waitUntil: 'networkidle' });

    const desktopHeading = page.locator('h1', { hasText: 'Course Maker' });
    await expect(desktopHeading).toBeVisible();

    const desktopHeader = page.locator('.desktop-only-header');
    await expect(desktopHeader).toBeVisible();

    const headerBox = await desktopHeader.boundingBox();
    const headingBox = await desktopHeading.boundingBox();

    expect(headerBox).not.toBeNull();
    expect(headingBox).not.toBeNull();

    // Verify the heading top (y) is strictly at or below the fixed desktop header's bottom edge
    expect(headingBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);

    // Verify top controls (Create New Course button) are visible and clickable
    const newCourseBtn = page.locator('button', { hasText: 'Create New Course' });
    await expect(newCourseBtn).toBeVisible();
    const btnBox = await newCourseBtn.boundingBox();
    expect(btnBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);

    // Click + New Course to open builder form
    await newCourseBtn.click();

    // Verify builder container and first section heading are visible below header
    const builderHeading = page.locator('h2', { hasText: '1. Course Basics' });
    await expect(builderHeading).toBeVisible();
    const builderHeadingBox = await builderHeading.boundingBox();
    expect(builderHeadingBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);

    // ── Mobile Viewport (375x812) ──
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'networkidle' });

    const mobileHeading = page.locator('h1', { hasText: 'Course Maker' });
    await expect(mobileHeading).toBeVisible();
    const mobileHeadingBox = await mobileHeading.boundingBox();

    // On mobile, the top padding ensures the heading is visible below the mobile top bar (at least 48px from top)
    expect(mobileHeadingBox.y).toBeGreaterThanOrEqual(48);
  });

  test('3. Two batches of the same course with one student: canonical course names, independent enrollments & routine overrides', async ({ request }) => {
    const slug = `test-multi-batch-canonical-${Date.now()}`;
    const canonicalCourseName = `Test Multi-Batch Direction Masterclass`;

    // 1. Create and publish 2-phase course definition
    const defRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        slug,
        name: canonicalCourseName,
        course_type: 'workshop',
        duration: { value: 8, unit: 'weeks' },
        phase_count: 2,
        phases: [
          {
            id: 'phase_1',
            phaseIndex: 1,
            title: 'Directing Actors',
            classCount: 1,
            requirements: { attendanceRequired: true, minAttendancePercent: 75, completionRequired: true },
            routine: [{ weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c1', title: 'Blocking & Performance', deliveryMode: 'live', category: 'theory', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              { id: 'asg1', title: 'Scene Monologue', subject: 'Acting Directing', submissionRequired: true, maxMarks: 50, passMarks: 25 }
            ],
            exam: { enabled: false }
          },
          {
            id: 'phase_2',
            phaseIndex: 2,
            title: 'Camera & Visual Grammar',
            classCount: 1,
            requirements: { attendanceRequired: true, minAttendancePercent: 75, completionRequired: true },
            routine: [{ weekday: 'Sunday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }],
            classes: [
              { id: 'c2', title: 'Shot Composition', deliveryMode: 'live', category: 'shooting', durationMinutes: 120, mandatory: true }
            ],
            assignments: [
              { id: 'asg2', title: 'Coverage Test', subject: 'Visual Grammar', submissionRequired: true, maxMarks: 50, passMarks: 25 }
            ],
            exam: { enabled: false }
          }
        ],
        completionPolicy: {
          certificateEligibility: { allRequiredPhasesPassed: true }
        }
      }
    });
    expect(defRes.status()).toBe(201);
    const courseDefId = (await defRes.json()).id;

    await request.post(`${API_BASE}/api/admin/course-definitions/${courseDefId}/publish`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    // 2. Create Batch 1 and Batch 2 linked to the same course definition
    const batch1Res = await request.post(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        batch_name: `Test Multi-Batch Direction B1`,
        batch_number: `MB-101`,
        course_name: canonicalCourseName,
        course_definition_id: courseDefId,
        status: 'active'
      }
    });
    expect(batch1Res.status()).toBe(201);
    const batch1Id = (await batch1Res.json()).id;

    const batch2Res = await request.post(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        batch_name: `Test Multi-Batch Direction B2`,
        batch_number: `MB-102`,
        course_name: canonicalCourseName,
        course_definition_id: courseDefId,
        status: 'active'
      }
    });
    expect(batch2Res.status()).toBe(201);
    const batch2Id = (await batch2Res.json()).id;

    // 3. Assign Student 99995 to Batch 1
    const assign1 = await request.post(`${API_BASE}/api/admin/batches/${batch1Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [99995] }
    });
    expect(assign1.status()).toBe(200);

    // 4. Assign Student 99995 to Batch 2
    const assign2 = await request.post(`${API_BASE}/api/admin/batches/${batch2Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { student_ids: [99995] }
    });
    expect(assign2.status()).toBe(200);

    // 5. Query student_course_enrollments directly:
    // MUST have canonical course_name and distinct batch_ids!
    const enrollments = db.prepare(`
      SELECT id, user_id, course_name, batch_id, course_definition_id
      FROM student_course_enrollments
      WHERE user_id = 99995 AND course_definition_id = ?
      ORDER BY batch_id ASC
    `).all(courseDefId);

    expect(enrollments.length).toBe(2);
    expect(enrollments[0].course_name).toBe(canonicalCourseName);
    expect(enrollments[1].course_name).toBe(canonicalCourseName);
    // Explicitly verify no suffix like ' (Batch ...)' was appended!
    expect(enrollments[0].course_name).not.toContain('(');
    expect(enrollments[1].course_name).not.toContain('(');

    expect(enrollments[0].batch_id).toBe(batch1Id);
    expect(enrollments[1].batch_id).toBe(batch2Id);

    // 6. Set distinct routine overrides for Batch 1 and Batch 2
    const overrideB1 = await request.put(`${API_BASE}/api/admin/course-definitions/${courseDefId}/routine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        batch_id: batch1Id,
        phase_id: 'phase_1',
        routine: [{ weekday: 'Monday', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Dhaka' }],
        reason: 'Batch 1 Monday Morning Slot'
      }
    });
    expect(overrideB1.status()).toBe(200);

    const overrideB2 = await request.put(`${API_BASE}/api/admin/course-definitions/${courseDefId}/routine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        batch_id: batch2Id,
        phase_id: 'phase_1',
        routine: [{ weekday: 'Friday', startTime: '15:00', endTime: '17:00', timezone: 'Asia/Dhaka' }],
        reason: 'Batch 2 Friday Afternoon Slot'
      }
    });
    expect(overrideB2.status()).toBe(200);

    // 7. Verify Batch 1 student list reflects Batch 1 routine
    const b1StudentsRes = await request.get(`${API_BASE}/api/admin/batches/${batch1Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(b1StudentsRes.status()).toBe(200);
    const b1Students = await b1StudentsRes.json();
    const studentInB1 = b1Students.find(s => s.user_id === 99995);
    const enrB1 = studentInB1.enrollments.find(e => e.batch_id === batch1Id);
    expect(enrB1.defined_progress.phases[0].routine[0].weekday).toBe('Monday');

    // 8. Verify Batch 2 student list reflects Batch 2 routine
    const b2StudentsRes = await request.get(`${API_BASE}/api/admin/batches/${batch2Id}/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(b2StudentsRes.status()).toBe(200);
    const b2Students = await b2StudentsRes.json();
    const studentInB2 = b2Students.find(s => s.user_id === 99995);
    const enrB2 = studentInB2.enrollments.find(e => e.batch_id === batch2Id);
    expect(enrB2.defined_progress.phases[0].routine[0].weekday).toBe('Friday');

    // 9. Separate progress tracking:
    // Mark Phase 1 & 2 complete on Batch 1 enrollment only
    const enr1Id = enrollments[0].id;
    const enr2Id = enrollments[1].id;

    // Update progress on Batch 1 only (mark both Phase 1 and Phase 2 mandatory classes and assignments completed)
    db.prepare(`
      INSERT OR REPLACE INTO student_class_attendance (enrollment_id, class_id, attended, updated_by)
      VALUES (?, 'c1', 1, ?)
    `).run(enr1Id, adminUser.id);

    db.prepare(`
      INSERT OR REPLACE INTO student_assignment_grades (enrollment_id, assignment_id, marks_obtained, submission_status, graded_by)
      VALUES (?, 'asg1', 45, 'submitted', ?)
    `).run(enr1Id, adminUser.id);

    db.prepare(`
      INSERT OR REPLACE INTO student_class_attendance (enrollment_id, class_id, attended, updated_by)
      VALUES (?, 'c2', 1, ?)
    `).run(enr1Id, adminUser.id);

    db.prepare(`
      INSERT OR REPLACE INTO student_assignment_grades (enrollment_id, assignment_id, marks_obtained, submission_status, graded_by)
      VALUES (?, 'asg2', 45, 'submitted', ?)
    `).run(enr1Id, adminUser.id);

    db.prepare(`
      INSERT OR REPLACE INTO student_phase_results (enrollment_id, phase_id, attendance_percentage, assignments_completed, exam_marks, is_passed)
      VALUES (?, 'phase_1', 100, 1, 0, 1)
    `).run(enr1Id);

    db.prepare(`
      INSERT OR REPLACE INTO student_phase_results (enrollment_id, phase_id, attendance_percentage, assignments_completed, exam_marks, is_passed)
      VALUES (?, 'phase_2', 100, 1, 0, 1)
    `).run(enr1Id);

    // Fetch progress for both enrollments via API
    const prog1Res = await request.get(`${API_BASE}/api/admin/students/99995/courses/${enr1Id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(prog1Res.status()).toBe(200);
    const prog1 = await prog1Res.json();
    expect(prog1.progress.certificateEligible).toBe(true);

    const prog2Res = await request.get(`${API_BASE}/api/admin/students/99995/courses/${enr2Id}/defined-progress`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(prog2Res.status()).toBe(200);
    const prog2 = await prog2Res.json();
    expect(prog2.progress.certificateEligible).toBe(false); // Batch 2 is still untouched!

    // 10. Correct certificate generation:
    // Add template for the canonical course name
    const existingTmpl = db.prepare('SELECT id FROM certificate_templates WHERE course_name = ?').get(canonicalCourseName);
    if (existingTmpl) {
      db.prepare('UPDATE certificate_templates SET layout_json = ?, updated_by = ? WHERE id = ?')
        .run('{"title":"Certificate of Completion"}', adminUser.id, existingTmpl.id);
    } else {
      db.prepare('INSERT INTO certificate_templates (course_name, layout_json, updated_by) VALUES (?, ?, ?)')
        .run(canonicalCourseName, '{"title":"Certificate of Completion"}', adminUser.id);
    }

    const certRes = await request.get(`${API_BASE}/api/certification/my-certificates`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    expect(certRes.status()).toBe(200);
    const certData = await certRes.json();

    const certForCourse = certData.certificates.filter(c => c.courseName === canonicalCourseName);
    // Exactly 1 certificate unlocked (for Batch 1)
    expect(certForCourse.length).toBe(1);
    expect(certForCourse[0].courseName).toBe(canonicalCourseName);
    expect(certForCourse[0].batchId).toBe(batch1Id);
    expect(certForCourse[0].studentDetails.batchNumber).toBe('MB-101');

    // 11. Accurate statistics: Student 99995 is counted once in distinct metrics
    const funnelRes = await request.get(`${API_BASE}/api/analytics/funnel`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(funnelRes.status()).toBe(200);
    const funnel = await funnelRes.json();
    expect(Array.isArray(funnel)).toBe(true);

    // Verify batch student counts are isolated
    const batch1Detail = await request.get(`${API_BASE}/api/admin/batches/${batch1Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(batch1Detail.status()).toBe(200);
    const b1Data = await batch1Detail.json();
    expect(b1Data.student_count).toBe(1);

    const batch2Detail = await request.get(`${API_BASE}/api/admin/batches/${batch2Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(batch2Detail.status()).toBe(200);
    const b2Data = await batch2Detail.json();
    expect(b2Data.student_count).toBe(1);
  });
});
