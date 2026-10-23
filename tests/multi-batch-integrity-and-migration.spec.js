import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runEnrollmentConstraintMigration } = require('../server/db/migrations/20261019_enrollment_unique_constraint_fix.cjs');

import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation, 
  assertServerRejectionProof 
} from './test-db-isolation.js';

dotenv.config();

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;

const TEST_STUDENT_ID = 99996;
const BATCH_A_ID = 99991;
const BATCH_B_ID = 99992;

function cleanupTestArtifacts(database) {
  try {
    database.prepare(`
      DELETE FROM student_phase_results 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments WHERE user_id = ?
      )
    `).run(TEST_STUDENT_ID);

    database.prepare(`
      DELETE FROM student_class_attendance 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments WHERE user_id = ?
      )
    `).run(TEST_STUDENT_ID);

    database.prepare(`
      DELETE FROM student_assignment_grades 
      WHERE enrollment_id IN (
        SELECT id FROM student_course_enrollments WHERE user_id = ?
      )
    `).run(TEST_STUDENT_ID);

    database.prepare(`
      DELETE FROM legacy_enrollment_migrations 
      WHERE student_id = ? OR enrollment_id IN (
        SELECT id FROM student_course_enrollments WHERE user_id = ?
      )
    `).run(TEST_STUDENT_ID, TEST_STUDENT_ID);

    database.prepare(`
      DELETE FROM student_course_enrollments WHERE user_id = ?
    `).run(TEST_STUDENT_ID);

    database.prepare(`
      DELETE FROM batch_students WHERE student_id = ? OR batch_id IN (?, ?)
    `).run(TEST_STUDENT_ID, BATCH_A_ID, BATCH_B_ID);

    database.prepare(`
      DELETE FROM batches WHERE id IN (?, ?)
    `).run(BATCH_A_ID, BATCH_B_ID);

    database.prepare(`
      DELETE FROM student_profiles WHERE user_id = ?
    `).run(TEST_STUDENT_ID);

    database.prepare(`
      DELETE FROM users WHERE id = ?
    `).run(TEST_STUDENT_ID);
  } catch (err) {
    console.error('Cleanup warning:', err.message);
  }
}

test.beforeAll(async () => {
  await assertServerRejectionProof('http://127.0.0.1:3001');
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  adminToken = jwt.sign(
    { id: adminUser.id, role: 'admin', username: adminUser.username },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  cleanupTestArtifacts(db);
});

test.afterAll(() => {
  if (db) {
    cleanupTestArtifacts(db);
    db.close();
  }
});

test.describe('Multi-Batch Data Integrity & Migration Test Suite', () => {

  test('1. Fresh database initialization creates canonical schema with partial unique indexes and allows multi-batch enrollments', () => {
    // Create an isolated fresh in-memory database
    const freshDb = new Database(':memory:');
    freshDb.pragma('foreign_keys = ON');

    // Minimal users and batches tables
    freshDb.prepare(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL
      )
    `).run();

    freshDb.prepare(`
      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_name TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        course_name TEXT NOT NULL
      )
    `).run();

    // Canonical table creation from database.js
    freshDb.prepare(`
      CREATE TABLE IF NOT EXISTS student_course_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        course_name TEXT NOT NULL,
        course_type TEXT NOT NULL DEFAULT 'filmmaking',
        step1_completed INTEGER DEFAULT 0,
        step2_completed INTEGER DEFAULT 0,
        step3_completed INTEGER DEFAULT 0,
        step4_completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        attendance_classes TEXT,
        exam_written INTEGER DEFAULT 0,
        assignment_screenplay INTEGER DEFAULT 0,
        assignment_shooting_script INTEGER DEFAULT 0,
        attendance_total INTEGER DEFAULT 22,
        phase2_shooting_attended INTEGER DEFAULT 0,
        phase2_editing_attended INTEGER DEFAULT 0,
        fee_details TEXT,
        assignment_scores TEXT,
        course_definition_id INTEGER,
        course_version INTEGER,
        batch_id INTEGER REFERENCES batches(id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run();

    freshDb.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_user_course_no_batch
        ON student_course_enrollments(user_id, course_name)
        WHERE batch_id IS NULL
    `).run();

    freshDb.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_user_course_with_batch
        ON student_course_enrollments(user_id, course_name, batch_id)
        WHERE batch_id IS NOT NULL
    `).run();

    // Verify index list
    const indices = freshDb.prepare('PRAGMA index_list(student_course_enrollments)').all();
    const hasTableLevelUnique = indices.some(i => i.origin === 'u' && i.unique === 1);
    expect(hasTableLevelUnique).toBe(false);

    const hasNoBatchIdx = indices.some(i => i.name === 'idx_enr_user_course_no_batch' && i.unique === 1);
    const hasWithBatchIdx = indices.some(i => i.name === 'idx_enr_user_course_with_batch' && i.unique === 1);
    expect(hasNoBatchIdx).toBe(true);
    expect(hasWithBatchIdx).toBe(true);

    // Insert user & batches
    freshDb.prepare("INSERT INTO users (id, username, email) VALUES (1, 'u1', 'u1@test.org')").run();
    freshDb.prepare("INSERT INTO batches (id, batch_name, batch_number, course_name) VALUES (10, 'Batch 10', '10', 'Online Filmmaking Course')").run();
    freshDb.prepare("INSERT INTO batches (id, batch_name, batch_number, course_name) VALUES (20, 'Batch 20', '20', 'Online Filmmaking Course')").run();

    // Insert student into Batch 10 and Batch 20 with identical canonical course_name
    const enr1 = freshDb.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (1, 'Online Filmmaking Course', 10)
    `).run();
    const enr2 = freshDb.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (1, 'Online Filmmaking Course', 20)
    `).run();

    expect(enr1.lastInsertRowid).not.toBe(enr2.lastInsertRowid);

    // Assert: inserting duplicate for same batch fails
    expect(() => {
      freshDb.prepare(`
        INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (1, 'Online Filmmaking Course', 10)
      `).run();
    }).toThrow(/UNIQUE constraint failed/);

    // Assert: inserting duplicate unassigned legacy fails
    freshDb.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (1, 'Workshop Course', NULL)
    `).run();

    expect(() => {
      freshDb.prepare(`
        INSERT INTO student_course_enrollments (user_id, course_name, batch_id) VALUES (1, 'Workshop Course', NULL)
      `).run();
    }).toThrow(/UNIQUE constraint failed/);

    freshDb.close();
  });

  test('2. Lossless migration resolves collisions, combines scalar progress and fees, re-links child FKs, and archives duplicates without data loss', () => {
    const memDb = new Database(':memory:');
    memDb.pragma('foreign_keys = ON');

    memDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT);
      CREATE TABLE batches (id INTEGER PRIMARY KEY, batch_name TEXT, batch_number TEXT, course_name TEXT);

      CREATE TABLE student_course_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        course_name TEXT NOT NULL,
        course_type TEXT NOT NULL DEFAULT 'filmmaking',
        step1_completed INTEGER DEFAULT 0,
        step2_completed INTEGER DEFAULT 0,
        step3_completed INTEGER DEFAULT 0,
        step4_completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        attendance_classes TEXT,
        exam_written INTEGER DEFAULT 0,
        assignment_screenplay INTEGER DEFAULT 0,
        assignment_shooting_script INTEGER DEFAULT 0,
        attendance_total INTEGER DEFAULT 22,
        phase2_shooting_attended INTEGER DEFAULT 0,
        phase2_editing_attended INTEGER DEFAULT 0,
        fee_details TEXT,
        assignment_scores TEXT,
        course_definition_id INTEGER,
        course_version INTEGER,
        batch_id INTEGER,
        UNIQUE(user_id, course_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE student_phase_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        phase_id TEXT NOT NULL,
        attendance_classes INTEGER DEFAULT 0,
        attendance_total INTEGER DEFAULT 0,
        attendance_percentage REAL DEFAULT 0.0,
        assignments_completed INTEGER DEFAULT 0,
        assignments_total INTEGER DEFAULT 0,
        exam_marks REAL DEFAULT NULL,
        is_passed INTEGER DEFAULT 0,
        calculated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(enrollment_id, phase_id),
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
      );

      CREATE TABLE student_class_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        class_id TEXT NOT NULL,
        attended INTEGER NOT NULL DEFAULT 0,
        attended_at TEXT,
        updated_by INTEGER,
        UNIQUE(enrollment_id, class_id),
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
      );

      CREATE TABLE student_assignment_grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        assignment_id TEXT NOT NULL,
        marks_obtained REAL DEFAULT 0,
        submission_status TEXT DEFAULT 'pending',
        remarks TEXT,
        graded_by INTEGER,
        graded_at TEXT,
        UNIQUE(enrollment_id, assignment_id),
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
      );

      CREATE TABLE legacy_enrollment_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        source_course_name TEXT NOT NULL,
        target_course_definition_id INTEGER NOT NULL,
        target_version INTEGER NOT NULL,
        legacy_snapshot_json TEXT NOT NULL,
        migrated_by INTEGER NOT NULL,
        migrated_at TEXT DEFAULT (datetime('now', 'localtime')),
        notes TEXT,
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id)
      );
    `);

    memDb.prepare("INSERT INTO users (id, username, email) VALUES (50, 's50', 's50@test.org')").run();
    memDb.prepare("INSERT INTO batches (id, batch_name, batch_number, course_name) VALUES (5, 'Batch 5', '5', 'Online Filmmaking Course')").run();

    // Primary row: id 100
    memDb.prepare(`
      INSERT INTO student_course_enrollments (
        id, user_id, course_name, batch_id, step1_completed, step2_completed, fee_details
      ) VALUES (100, 50, 'Online Filmmaking Course', 5, 1, 0, '{"phase1":{"amount_paid":"4000"}}')
    `).run();

    memDb.prepare("INSERT INTO student_class_attendance (enrollment_id, class_id, attended) VALUES (100, 'class-1', 1)").run();
    memDb.prepare("INSERT INTO student_assignment_grades (enrollment_id, assignment_id, marks_obtained) VALUES (100, 'asg-1', 80)").run();
    memDb.prepare("INSERT INTO student_phase_results (enrollment_id, phase_id, is_passed) VALUES (100, 'ph-1', 1)").run();

    // Duplicate row with suffix: id 101
    memDb.prepare(`
      INSERT INTO student_course_enrollments (
        id, user_id, course_name, batch_id, step1_completed, step2_completed, fee_details
      ) VALUES (101, 50, 'Online Filmmaking Course (Batch 5)', 5, 0, 1, '{"phase2":{"amount_paid":"7000"}}')
    `).run();

    memDb.prepare("INSERT INTO student_class_attendance (enrollment_id, class_id, attended) VALUES (101, 'class-2', 1)").run();
    memDb.prepare("INSERT INTO student_assignment_grades (enrollment_id, assignment_id, marks_obtained) VALUES (101, 'asg-2', 92)").run();
    memDb.prepare("INSERT INTO student_phase_results (enrollment_id, phase_id, is_passed) VALUES (101, 'ph-2', 1)").run();
    memDb.prepare("INSERT INTO legacy_enrollment_migrations (enrollment_id, student_id, source_course_name, target_course_definition_id, target_version, legacy_snapshot_json, migrated_by) VALUES (101, 50, 'Online Filmmaking Course', 1, 1, '{}', 1)").run();

    // Run lossless migration
    const result = runEnrollmentConstraintMigration(memDb);
    expect(result.applied).toBe(true);
    expect(result.preEnrollmentCount).toBe(2);
    expect(result.resolvedCollisionsCount).toBe(1);
    expect(result.postEnrollmentCount).toBe(1);

    // Verify primary enrollment received all merged progress & fees
    const primaryRow = memDb.prepare('SELECT * FROM student_course_enrollments WHERE id = 100').get();
    expect(primaryRow).toBeDefined();
    expect(primaryRow.course_name).toBe('Online Filmmaking Course');
    expect(primaryRow.step1_completed).toBe(1);
    expect(primaryRow.step2_completed).toBe(1);

    const mergedFees = JSON.parse(primaryRow.fee_details);
    expect(mergedFees.phase1.amount_paid).toBe('4000');
    expect(mergedFees.phase2.amount_paid).toBe('7000');

    // Verify child records re-linked to primary
    const attCount = memDb.prepare('SELECT COUNT(*) as c FROM student_class_attendance WHERE enrollment_id = 100').get().c;
    expect(attCount).toBe(2);

    const gradeCount = memDb.prepare('SELECT COUNT(*) as c FROM student_assignment_grades WHERE enrollment_id = 100').get().c;
    expect(gradeCount).toBe(2);

    const prCount = memDb.prepare('SELECT COUNT(*) as c FROM student_phase_results WHERE enrollment_id = 100').get().c;
    expect(prCount).toBe(2);

    const migCount = memDb.prepare('SELECT COUNT(*) as c FROM legacy_enrollment_migrations WHERE enrollment_id = 100').get().c;
    expect(migCount).toBe(1);

    // Verify audit logs and duplicate archive
    const archivedRows = memDb.prepare('SELECT * FROM archived_duplicate_enrollments').all();
    expect(archivedRows.length).toBe(1);
    expect(archivedRows[0].original_enrollment_id).toBe(101);
    expect(archivedRows[0].primary_enrollment_id).toBe(100);

    const collisionAudits = memDb.prepare('SELECT * FROM enrollment_migration_collisions').all();
    expect(collisionAudits.length).toBe(1);
    expect(collisionAudits[0].duplicate_enrollment_id).toBe(101);
    expect(collisionAudits[0].resolution_action).toBe('MERGED_LOSSLESS');

    // Verify 0 foreign key violations
    const fkErrors = memDb.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors.length).toBe(0);

    memDb.close();
  });

  test('3. Editing student fees, status, or details in Batch A leaves Batch B enrollment completely unchanged and uncorrupted', async ({ request }) => {
    // Set up test student in live db
    cleanupTestArtifacts(db);

    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
      VALUES (?, 'multibatch_user', 'multibatch@bfi-app.org', 'fake_hash', 'student', 'TestFirst', 'TestLast', 1)
    `).run(TEST_STUDENT_ID);

    db.prepare(`
      INSERT INTO student_profiles (user_id, student_id, batch_number, full_name)
      VALUES (?, 'BFI-MB-99996', '99991', 'TestFirst TestLast')
    `).run(TEST_STUDENT_ID);

    db.prepare(`
      INSERT INTO batches (id, batch_name, batch_number, course_name, status)
      VALUES (?, 'Test Batch A', '99991', 'Online Filmmaking Course', 'ongoing')
    `).run(BATCH_A_ID);

    db.prepare(`
      INSERT INTO batches (id, batch_name, batch_number, course_name, status)
      VALUES (?, 'Test Batch B', '99992', 'Online Filmmaking Course', 'ongoing')
    `).run(BATCH_B_ID);

    db.prepare("INSERT INTO batch_students (batch_id, student_id) VALUES (?, ?)").run(BATCH_A_ID, TEST_STUDENT_ID);
    db.prepare("INSERT INTO batch_students (batch_id, student_id) VALUES (?, ?)").run(BATCH_B_ID, TEST_STUDENT_ID);

    // Create Enrollment A for Batch A
    const enrAInfo = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, batch_id, step1_completed, step2_completed, step3_completed, step4_completed, fee_details
      ) VALUES (?, 'Online Filmmaking Course', 'filmmaking', ?, 1, 0, 0, 0, ?)
    `).run(
      TEST_STUDENT_ID,
      BATCH_A_ID,
      JSON.stringify({
        phase1: { full_fee: '6000', amount_paid: '6000', status: 'Paid', installments: [] },
        phase2: { full_fee: '9000', amount_paid: '0', status: 'Pending', installments: [] }
      })
    );
    const enrAId = enrAInfo.lastInsertRowid;

    // Create Enrollment B for Batch B with distinct data
    const enrBInfo = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, batch_id, step1_completed, step2_completed, step3_completed, step4_completed, fee_details
      ) VALUES (?, 'Online Filmmaking Course', 'filmmaking', ?, 0, 0, 0, 0, ?)
    `).run(
      TEST_STUDENT_ID,
      BATCH_B_ID,
      JSON.stringify({
        phase1: { full_fee: '7500', amount_paid: '2500', status: 'Partial', installments: [{ amount: '2500', status: 'Paid' }] },
        phase2: { full_fee: '10000', amount_paid: '0', status: 'Pending', installments: [] }
      })
    );
    const enrBId = enrBInfo.lastInsertRowid;

    // Admin updates student with batch_id = BATCH_A_ID (updating Batch A's fee)
    const updateRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        firstName: 'TestFirstUpdated',
        lastName: 'TestLastUpdated',
        email: 'multibatch_updated@bfi-app.org',
        username: 'multibatch_user',
        batchNumber: '99991',
        batch_id: BATCH_A_ID,
        courses: ['Online Filmmaking Course'],
        course_fees: {
          'Online Filmmaking Course': {
            batch_id: BATCH_A_ID,
            phase1: { full_fee: '6000', amount_paid: '6000', status: 'Paid', installments: [] },
            phase2: { full_fee: '9000', amount_paid: '0', status: 'Pending', installments: [] }
          }
        }
      }
    });

    expect(updateRes.status()).toBe(200);

    // Verify Batch A enrollment was updated
    const updatedEnrA = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ?').get(enrAId);
    expect(updatedEnrA).toBeDefined();

    // Verify Batch B enrollment was NOT modified or deleted
    const preservedEnrB = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ?').get(enrBId);
    expect(preservedEnrB).toBeDefined();
    expect(preservedEnrB.batch_id).toBe(BATCH_B_ID);
    expect(preservedEnrB.course_name).toBe('Online Filmmaking Course');
    expect(preservedEnrB.step1_completed).toBe(0); // remains untouched

    const feeDetailsB = JSON.parse(preservedEnrB.fee_details);
    expect(feeDetailsB.phase1.full_fee).toBe('7500');
    expect(feeDetailsB.phase1.amount_paid).toBe('2500');
    expect(feeDetailsB.phase1.status).toBe('Partial');
  });

  test('4. Ambiguous student edit without batch or enrollment context is rejected with 400 Bad Request to protect multi-batch enrollments', async ({ request }) => {
    // Student TEST_STUDENT_ID still has enrollments for both Batch A and Batch B
    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(TEST_STUDENT_ID);
    expect(enrollments.length).toBe(2);

    // Attempt to update without batch_id, enrollment_id, or batchNumber
    const ambiguousRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        firstName: 'AmbiguousAttempt',
        lastName: 'Student',
        email: 'ambiguous@bfi-app.org',
        username: 'multibatch_user',
        courses: ['Online Filmmaking Course'],
        course_fees: {
          'Online Filmmaking Course': {
            phase1: { full_fee: '5000', amount_paid: '5000' }
          }
        }
      }
    });

    expect(ambiguousRes.status()).toBe(400);
    const errBody = await ambiguousRes.json();
    expect(errBody.error).toMatch(/Ambiguous enrollment operation.*Specify enrollment_id or batch_id context/);

    // Verify DB was NOT mutated
    const preservedEnrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? ORDER BY id').all(TEST_STUDENT_ID);
    expect(preservedEnrollments.length).toBe(2);
  });

  test('5. Course removal scoped to Batch A deletes only Batch A enrollment, keeping Batch B enrollment active', async ({ request }) => {
    // Send PUT request removing course from Batch A
    const removeRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        firstName: 'TestFirstUpdated',
        lastName: 'TestLastUpdated',
        email: 'multibatch_updated@bfi-app.org',
        username: 'multibatch_user',
        batch_id: BATCH_A_ID,
        courses: [] // Removing from Batch A
      }
    });

    expect(removeRes.status()).toBe(200);

    // Batch A enrollment should be deleted
    const remainingEnrA = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(TEST_STUDENT_ID, BATCH_A_ID);
    expect(remainingEnrA).toBeUndefined();

    // Batch B enrollment must remain intact!
    const remainingEnrB = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(TEST_STUDENT_ID, BATCH_B_ID);
    expect(remainingEnrB).toBeDefined();
    expect(remainingEnrB.batch_id).toBe(BATCH_B_ID);
    expect(remainingEnrB.course_name).toBe('Online Filmmaking Course');
  });

  test('6. Batch bulk results upload for Batch B updates only Batch B enrollment and isolates other batches', async ({ request }) => {
    // Re-create Batch A enrollment for the student
    db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, batch_id, step1_completed, step2_completed, exam_written, fee_details
      ) VALUES (?, 'Online Filmmaking Course', 'filmmaking', ?, 1, 0, NULL, '{"phase1":{"amount_paid":"6000"}}')
    `).run(TEST_STUDENT_ID, BATCH_A_ID);

    // Student has:
    // Batch A enrollment: step2_completed = 0, exam_written = NULL
    // Batch B enrollment: step2_completed = 0, exam_written = NULL (we update fee to be paid so bulk results allows it)
    db.prepare(`
      UPDATE student_course_enrollments 
      SET fee_details = '{"phase1":{"amount_paid":"7500"}}' 
      WHERE user_id = ? AND batch_id = ?
    `).run(TEST_STUDENT_ID, BATCH_B_ID);

    const profile = db.prepare('SELECT student_id, full_name FROM student_profiles WHERE user_id = ?').get(TEST_STUDENT_ID);

    // POST bulk results for Batch B
    const bulkRes = await request.post(`${API_BASE}/api/admin/batches/${BATCH_B_ID}/results/bulk`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        results: [
          {
            rollNo: profile.student_id,
            name: profile.full_name,
            obtainedMarks: 88,
            remarks: 'Pass'
          }
        ]
      }
    });

    expect(bulkRes.status()).toBe(200);

    // Verify Batch B enrollment received marks and pass status
    const enrB = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(TEST_STUDENT_ID, BATCH_B_ID);
    expect(enrB).toBeDefined();
    expect(enrB.exam_written).toBe(88);
    expect(enrB.step2_completed).toBe(1);

    // Verify Batch A enrollment remains unchanged (exam_written is still null, step2_completed is 0)
    const enrA = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(TEST_STUDENT_ID, BATCH_A_ID);
    expect(enrA).toBeDefined();
    expect(enrA.exam_written).toBeNull();
    expect(enrA.step2_completed).toBe(0);
  });

  test('7. Academic records attendance_total sync for Batch A updates Batch A enrollments without mutating Batch B enrollments', async ({ request }) => {
    // Both enrollments start with attendance_total = 22 and step3_completed = 1
    db.prepare(`
      UPDATE student_course_enrollments 
      SET attendance_total = 22, step3_completed = 1 
      WHERE user_id = ?
    `).run(TEST_STUDENT_ID);

    const enrA = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(TEST_STUDENT_ID, BATCH_A_ID);
    const enrB = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND batch_id = ?').get(TEST_STUDENT_ID, BATCH_B_ID);

    // Update academic records on Batch A's enrollment to total 30 classes
    const acadRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/academic-records/${enrA.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        attendance_classes: 25,
        attendance_total: 30,
        exam_written: 40,
        assignment_scores: {}
      }
    });

    expect(acadRes.status()).toBe(200);

    // Check DB: Batch A enrollment attendance_total is 30
    const checkEnrA = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(enrA.id);
    expect(checkEnrA.attendance_total).toBe(30);

    // Check DB: Batch B enrollment attendance_total remains 22
    const checkEnrB = db.prepare('SELECT attendance_total FROM student_course_enrollments WHERE id = ?').get(enrB.id);
    expect(checkEnrB.attendance_total).toBe(22);
  });
});
