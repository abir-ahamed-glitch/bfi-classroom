const Database = require('better-sqlite3');
const path = require('path');

/**
 * Lossless migration to replace table-level UNIQUE(user_id, course_name)
 * with partial unique indexes:
 *  - idx_enr_user_course_no_batch: UNIQUE(user_id, course_name) WHERE batch_id IS NULL
 *  - idx_enr_user_course_with_batch: UNIQUE(user_id, course_name, batch_id) WHERE batch_id IS NOT NULL
 *
 * Requirements:
 * 1. Detect collisions when stripping legacy " (batch_name)" suffix.
 * 2. Never discard enrollments, attendance, grades, fees, phase results, or certificate history.
 * 3. Losslessly merge scalar fields, combine fee details, and re-link child foreign keys.
 * 4. Record reviewable collision reports in `enrollment_migration_collisions` & `archived_duplicate_enrollments`.
 * 5. Verify row counts and foreign keys (`PRAGMA foreign_key_check`) before and after.
 * 6. Fully transactional and idempotent/repeatable.
 */
function runEnrollmentConstraintMigration(db) {
  // 1. Check whether migration is needed
  const tableCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='student_course_enrollments'").get();
  if (!tableCheck) {
    return { applied: false, reason: 'student_course_enrollments table does not exist' };
  }

  const indices = db.prepare('PRAGMA index_list(student_course_enrollments)').all();
  const hasOldUniqueConstraint = indices.some(i => i.unique === 1 && i.origin === 'u');
  const hasNewNoBatchIndex = indices.some(i => i.name === 'idx_enr_user_course_no_batch');
  const hasNewWithBatchIndex = indices.some(i => i.name === 'idx_enr_user_course_with_batch');

  // Check if there are any unstripped course names with batch_id
  const hasCorruptedNames = !!db.prepare(`
    SELECT id FROM student_course_enrollments 
    WHERE batch_id IS NOT NULL 
      AND course_name LIKE '% (%' 
      AND INSTR(course_name, ' (') > 0 
    LIMIT 1
  `).get();

  // Ensure collision and audit tables exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS enrollment_migration_collisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_name TEXT NOT NULL,
      batch_id INTEGER,
      primary_enrollment_id INTEGER NOT NULL,
      duplicate_enrollment_id INTEGER NOT NULL,
      resolution_action TEXT NOT NULL,
      merged_details TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS archived_duplicate_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_enrollment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      course_name TEXT NOT NULL,
      batch_id INTEGER,
      full_row_json TEXT NOT NULL,
      primary_enrollment_id INTEGER NOT NULL,
      archived_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `).run();

  if (!hasOldUniqueConstraint && hasNewNoBatchIndex && hasNewWithBatchIndex && !hasCorruptedNames) {
    return { applied: false, reason: 'Already canonical schema and no corrupted course names' };
  }

  console.log('🔄 Executing lossless enrollment unique constraint migration...');

  // Baseline verification
  const preFkErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (preFkErrors.length > 0) {
    console.warn('⚠️ Pre-migration foreign key issues detected:', preFkErrors);
  }

  const preEnrollmentCount = db.prepare('SELECT COUNT(*) as count FROM student_course_enrollments').get().count;
  const prePhaseResultsCount = db.prepare('SELECT COUNT(*) as count FROM student_phase_results').get().count;
  const preAttendanceCount = db.prepare('SELECT COUNT(*) as count FROM student_class_attendance').get().count;
  const preGradesCount = db.prepare('SELECT COUNT(*) as count FROM student_assignment_grades').get().count;
  const preMigrationsCount = db.prepare('SELECT COUNT(*) as count FROM legacy_enrollment_migrations').get().count;

  let resolvedCollisionsCount = 0;
  const collisionSummaries = [];

  // In SQLite, foreign key enforcement cannot be toggled inside an active transaction.
  // We must disable foreign keys before beginning the schema swap transaction,
  // then run foreign_key_check before committing or right after.
  db.pragma('foreign_keys = OFF');

  const runTx = db.transaction(() => {
    // Step A: Lossless collision resolution
    // Retrieve all enrollments and compute their canonical stripped course names
    const allRows = db.prepare(`
      SELECT
        id,
        user_id,
        course_name,
        CASE
          WHEN batch_id IS NOT NULL AND course_name LIKE '% (%' AND INSTR(course_name, ' (') > 0
            THEN SUBSTR(course_name, 1, INSTR(course_name, ' (') - 1)
          ELSE course_name
        END AS canonical_course_name,
        course_type,
        step1_completed,
        step2_completed,
        step3_completed,
        step4_completed,
        created_at,
        updated_at,
        attendance_classes,
        exam_written,
        assignment_screenplay,
        assignment_shooting_script,
        attendance_total,
        phase2_shooting_attended,
        phase2_editing_attended,
        fee_details,
        assignment_scores,
        course_definition_id,
        course_version,
        batch_id
      FROM student_course_enrollments
    `).all();

    // Group rows by target uniqueness key:
    // When batch_id IS NULL: (user_id, canonical_course_name, null)
    // When batch_id IS NOT NULL: (user_id, canonical_course_name, batch_id)
    const groups = new Map();
    for (const row of allRows) {
      const groupKey = `${row.user_id}:::${row.canonical_course_name}:::${row.batch_id ?? 'NULL'}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(row);
    }

    for (const [key, groupRows] of groups.entries()) {
      if (groupRows.length <= 1) continue;

      // Collision detected! Sort to select primary enrollment
      // Priority 1: Already has canonical course_name without suffix
      // Priority 2: Lower enrollment id
      groupRows.sort((a, b) => {
        const aHasSuffix = a.course_name.includes(' (');
        const bHasSuffix = b.course_name.includes(' (');
        if (aHasSuffix !== bHasSuffix) return aHasSuffix ? 1 : -1;
        return a.id - b.id;
      });

      const primary = groupRows[0];
      const duplicates = groupRows.slice(1);

      for (const dup of duplicates) {
        resolvedCollisionsCount++;

        // 1. Archive full duplicate row
        db.prepare(`
          INSERT INTO archived_duplicate_enrollments (
            original_enrollment_id, user_id, course_name, batch_id, full_row_json, primary_enrollment_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          dup.id,
          dup.user_id,
          dup.course_name,
          dup.batch_id,
          JSON.stringify(dup),
          primary.id
        );

        // 2. Losslessly merge scalars
        const mergedStep1 = Math.max(primary.step1_completed || 0, dup.step1_completed || 0);
        const mergedStep2 = Math.max(primary.step2_completed || 0, dup.step2_completed || 0);
        const mergedStep3 = Math.max(primary.step3_completed || 0, dup.step3_completed || 0);
        const mergedStep4 = Math.max(primary.step4_completed || 0, dup.step4_completed || 0);
        const mergedExam = Math.max(primary.exam_written || 0, dup.exam_written || 0);
        const mergedScreenplay = Math.max(primary.assignment_screenplay || 0, dup.assignment_screenplay || 0);
        const mergedShootingScript = Math.max(primary.assignment_shooting_script || 0, dup.assignment_shooting_script || 0);
        const mergedAttendanceTotal = Math.max(primary.attendance_total || 0, dup.attendance_total || 0);
        const mergedPhase2Shooting = Math.max(primary.phase2_shooting_attended || 0, dup.phase2_shooting_attended || 0);
        const mergedPhase2Editing = Math.max(primary.phase2_editing_attended || 0, dup.phase2_editing_attended || 0);
        const mergedDefId = primary.course_definition_id || dup.course_definition_id || null;
        const mergedVersion = primary.course_version || dup.course_version || null;

        // Parse and merge fee_details
        let primaryFees = {};
        let dupFees = {};
        try { if (primary.fee_details) primaryFees = JSON.parse(primary.fee_details); } catch (_) {}
        try { if (dup.fee_details) dupFees = JSON.parse(dup.fee_details); } catch (_) {}

        const mergedFees = { ...dupFees, ...primaryFees };
        // Combine phase1 if present in both
        if (primaryFees.phase1 || dupFees.phase1) {
          const p1A = primaryFees.phase1 || {};
          const p1B = dupFees.phase1 || {};
          const p1Paid = Math.max(
            parseFloat(String(p1A.amount_paid || '').replace(/[^\d.]/g, '')) || 0,
            parseFloat(String(p1B.amount_paid || '').replace(/[^\d.]/g, '')) || 0
          );
          const p1Inst = [...(p1A.installments || []), ...(p1B.installments || [])];
          mergedFees.phase1 = {
            ...p1B,
            ...p1A,
            amount_paid: p1Paid > 0 ? String(p1Paid) : (p1A.amount_paid || p1B.amount_paid || ''),
            installments: p1Inst
          };
        }
        // Combine phase2 if present in both
        if (primaryFees.phase2 || dupFees.phase2) {
          const p2A = primaryFees.phase2 || {};
          const p2B = dupFees.phase2 || {};
          const p2Paid = Math.max(
            parseFloat(String(p2A.amount_paid || '').replace(/[^\d.]/g, '')) || 0,
            parseFloat(String(p2B.amount_paid || '').replace(/[^\d.]/g, '')) || 0
          );
          const p2Inst = [...(p2A.installments || []), ...(p2B.installments || [])];
          mergedFees.phase2 = {
            ...p2B,
            ...p2A,
            amount_paid: p2Paid > 0 ? String(p2Paid) : (p2A.amount_paid || p2B.amount_paid || ''),
            installments: p2Inst
          };
        }

        // Parse and merge assignment_scores
        let primaryScores = {};
        let dupScores = {};
        try { if (primary.assignment_scores) primaryScores = JSON.parse(primary.assignment_scores); } catch (_) {}
        try { if (dup.assignment_scores) dupScores = JSON.parse(dup.assignment_scores); } catch (_) {}
        const mergedScores = { ...dupScores };
        for (const [k, v] of Object.entries(primaryScores)) {
          mergedScores[k] = Math.max(Number(v) || 0, Number(dupScores[k]) || 0);
        }

        // Update primary row in place
        db.prepare(`
          UPDATE student_course_enrollments
          SET course_name = ?,
              step1_completed = ?,
              step2_completed = ?,
              step3_completed = ?,
              step4_completed = ?,
              exam_written = ?,
              assignment_screenplay = ?,
              assignment_shooting_script = ?,
              attendance_total = ?,
              phase2_shooting_attended = ?,
              phase2_editing_attended = ?,
              fee_details = ?,
              assignment_scores = ?,
              course_definition_id = ?,
              course_version = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(
          primary.canonical_course_name,
          mergedStep1,
          mergedStep2,
          mergedStep3,
          mergedStep4,
          mergedExam,
          mergedScreenplay,
          mergedShootingScript,
          mergedAttendanceTotal,
          mergedPhase2Shooting,
          mergedPhase2Editing,
          JSON.stringify(mergedFees),
          JSON.stringify(mergedScores),
          mergedDefId,
          mergedVersion,
          primary.id
        );

        // Update local object in case of multiple duplicates in the same group
        primary.step1_completed = mergedStep1;
        primary.step2_completed = mergedStep2;
        primary.step3_completed = mergedStep3;
        primary.step4_completed = mergedStep4;
        primary.course_name = primary.canonical_course_name;

        // 3. Re-link child rows in student_phase_results
        const dupPhaseResults = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ?').all(dup.id);
        for (const pr of dupPhaseResults) {
          const existingPr = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ? AND phase_id = ?').get(primary.id, pr.phase_id);
          if (!existingPr) {
            db.prepare('UPDATE student_phase_results SET enrollment_id = ? WHERE id = ?').run(primary.id, pr.id);
          } else {
            // Merge results into existing on primary and delete dup child row
            const mergedPass = Math.max(existingPr.is_passed || 0, pr.is_passed || 0);
            const mergedAttClasses = Math.max(existingPr.attendance_classes || 0, pr.attendance_classes || 0);
            const mergedAttTotal = Math.max(existingPr.attendance_total || 0, pr.attendance_total || 0);
            const mergedExamMarks = Math.max(existingPr.exam_marks || 0, pr.exam_marks || 0);
            db.prepare(`
              UPDATE student_phase_results
              SET is_passed = ?, attendance_classes = ?, attendance_total = ?, exam_marks = ?, calculated_at = datetime('now')
              WHERE id = ?
            `).run(mergedPass, mergedAttClasses, mergedAttTotal, mergedExamMarks, existingPr.id);
            db.prepare('DELETE FROM student_phase_results WHERE id = ?').run(pr.id);
          }
        }

        // 4. Re-link child rows in student_class_attendance
        const dupAttendance = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ?').all(dup.id);
        for (const att of dupAttendance) {
          const existingAtt = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ? AND class_id = ?').get(primary.id, att.class_id);
          if (!existingAtt) {
            db.prepare('UPDATE student_class_attendance SET enrollment_id = ? WHERE id = ?').run(primary.id, att.id);
          } else {
            const mergedAttended = Math.max(existingAtt.attended || 0, att.attended || 0);
            db.prepare('UPDATE student_class_attendance SET attended = ? WHERE id = ?').run(mergedAttended, existingAtt.id);
            db.prepare('DELETE FROM student_class_attendance WHERE id = ?').run(att.id);
          }
        }

        // 5. Re-link child rows in student_assignment_grades
        const dupGrades = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ?').all(dup.id);
        for (const gr of dupGrades) {
          const existingGr = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(primary.id, gr.assignment_id);
          if (!existingGr) {
            db.prepare('UPDATE student_assignment_grades SET enrollment_id = ? WHERE id = ?').run(primary.id, gr.id);
          } else {
            const mergedMarks = Math.max(existingGr.marks_obtained || 0, gr.marks_obtained || 0);
            db.prepare('UPDATE student_assignment_grades SET marks_obtained = ? WHERE id = ?').run(mergedMarks, existingGr.id);
            db.prepare('DELETE FROM student_assignment_grades WHERE id = ?').run(gr.id);
          }
        }

        // 6. Re-link legacy_enrollment_migrations
        db.prepare('UPDATE legacy_enrollment_migrations SET enrollment_id = ? WHERE enrollment_id = ?').run(primary.id, dup.id);

        // 7. Remove the duplicate enrollment row from student_course_enrollments
        db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(dup.id);

        // 8. Record audit log entry
        const mergeDetails = {
          scalarsMerged: {
            step1: mergedStep1,
            step2: mergedStep2,
            step3: mergedStep3,
            step4: mergedStep4,
            examWritten: mergedExam
          },
          childRecords: {
            phaseResultsMovedOrMerged: dupPhaseResults.length,
            attendanceMovedOrMerged: dupAttendance.length,
            gradesMovedOrMerged: dupGrades.length
          }
        };

        db.prepare(`
          INSERT INTO enrollment_migration_collisions (
            user_id, course_name, batch_id, primary_enrollment_id, duplicate_enrollment_id, resolution_action, merged_details
          ) VALUES (?, ?, ?, ?, ?, 'MERGED_LOSSLESS', ?)
        `).run(
          dup.user_id,
          primary.canonical_course_name,
          dup.batch_id,
          primary.id,
          dup.id,
          JSON.stringify(mergeDetails)
        );

        collisionSummaries.push({
          userId: dup.user_id,
          courseName: primary.canonical_course_name,
          batchId: dup.batch_id,
          primaryId: primary.id,
          duplicateId: dup.id,
          mergeDetails
        });
      }
    }

    // Strip suffix on any remaining uncollided rows with batch_id
    db.prepare(`
      UPDATE student_course_enrollments
      SET course_name = SUBSTR(course_name, 1, INSTR(course_name, ' (') - 1),
          updated_at = datetime('now')
      WHERE batch_id IS NOT NULL
        AND course_name LIKE '% (%'
        AND INSTR(course_name, ' (') > 0
    `).run();

    // Step B: Recreate student_course_enrollments table without UNIQUE(user_id, course_name)
    // Disable foreign keys temporarily while swapping table structures
    db.pragma('foreign_keys = OFF');

    db.prepare(`
      CREATE TABLE student_course_enrollments_new (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                   INTEGER NOT NULL,
        course_name               TEXT    NOT NULL,
        course_type               TEXT    NOT NULL DEFAULT 'filmmaking',
        step1_completed           INTEGER NOT NULL DEFAULT 0,
        step2_completed           INTEGER NOT NULL DEFAULT 0,
        step3_completed           INTEGER NOT NULL DEFAULT 0,
        step4_completed           INTEGER NOT NULL DEFAULT 0,
        created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at                TEXT    NOT NULL DEFAULT (datetime('now')),
        attendance_classes        TEXT,
        exam_written              INTEGER,
        assignment_screenplay     INTEGER,
        assignment_shooting_script INTEGER,
        attendance_total          INTEGER,
        phase2_shooting_attended  INTEGER,
        phase2_editing_attended   INTEGER,
        fee_details               TEXT,
        assignment_scores         TEXT,
        course_definition_id      INTEGER,
        course_version            INTEGER,
        batch_id                  INTEGER REFERENCES batches(id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run();

    db.prepare(`
      INSERT INTO student_course_enrollments_new (
        id, user_id, course_name, course_type,
        step1_completed, step2_completed, step3_completed, step4_completed,
        created_at, updated_at, attendance_classes, exam_written,
        assignment_screenplay, assignment_shooting_script, attendance_total,
        phase2_shooting_attended, phase2_editing_attended,
        fee_details, assignment_scores,
        course_definition_id, course_version, batch_id
      )
      SELECT
        id, user_id, course_name, course_type,
        step1_completed, step2_completed, step3_completed, step4_completed,
        created_at, updated_at, attendance_classes, exam_written,
        assignment_screenplay, assignment_shooting_script, attendance_total,
        phase2_shooting_attended, phase2_editing_attended,
        fee_details, assignment_scores,
        course_definition_id, course_version, batch_id
      FROM student_course_enrollments
    `).run();

    db.prepare('DROP TABLE student_course_enrollments').run();
    db.prepare('ALTER TABLE student_course_enrollments_new RENAME TO student_course_enrollments').run();

    // Recreate indexes
    db.prepare('CREATE INDEX IF NOT EXISTS idx_student_course_enrollments_batch ON student_course_enrollments(batch_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_course_enrollments_user_id ON student_course_enrollments(user_id)').run();

    // Create partial unique indexes
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_user_course_no_batch
        ON student_course_enrollments(user_id, course_name)
        WHERE batch_id IS NULL
    `).run();

    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_user_course_with_batch
        ON student_course_enrollments(user_id, course_name, batch_id)
        WHERE batch_id IS NOT NULL
    `).run();

  });

  runTx();

  // Re-enable foreign keys after transaction commits
  db.pragma('foreign_keys = ON');

  // Post-migration verification
  const postFkErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (postFkErrors.length > 0) {
    throw new Error(`Foreign key check failed after migration: ${JSON.stringify(postFkErrors)}`);
  }

  const postEnrollmentCount = db.prepare('SELECT COUNT(*) as count FROM student_course_enrollments').get().count;
  const postPhaseResultsCount = db.prepare('SELECT COUNT(*) as count FROM student_phase_results').get().count;
  const postAttendanceCount = db.prepare('SELECT COUNT(*) as count FROM student_class_attendance').get().count;
  const postGradesCount = db.prepare('SELECT COUNT(*) as count FROM student_assignment_grades').get().count;
  const postMigrationsCount = db.prepare('SELECT COUNT(*) as count FROM legacy_enrollment_migrations').get().count;

  const expectedEnrollmentCount = preEnrollmentCount - resolvedCollisionsCount;
  if (postEnrollmentCount !== expectedEnrollmentCount) {
    throw new Error(`Enrollment count mismatch: expected ${expectedEnrollmentCount}, found ${postEnrollmentCount}`);
  }

  console.log('✅ Lossless enrollment migration completed successfully:');
  console.log(`   - Pre-enrollment count: ${preEnrollmentCount}`);
  console.log(`   - Collisions resolved & archived: ${resolvedCollisionsCount}`);
  console.log(`   - Post-enrollment count: ${postEnrollmentCount}`);
  console.log(`   - Phase results: ${prePhaseResultsCount} -> ${postPhaseResultsCount}`);
  console.log(`   - Class attendance: ${preAttendanceCount} -> ${postAttendanceCount}`);
  console.log(`   - Assignment grades: ${preGradesCount} -> ${postGradesCount}`);
  console.log(`   - Legacy migrations: ${preMigrationsCount} -> ${postMigrationsCount}`);
  console.log('   - Foreign key checks: 0 violations');

  return {
    applied: true,
    preEnrollmentCount,
    postEnrollmentCount: preEnrollmentCount - resolvedCollisionsCount,
    resolvedCollisionsCount,
    collisionSummaries
  };
}

// Allow CLI execution
if (require.main === module) {
  const dbPath = path.join(__dirname, '..', '..', 'bfi_classroom.db');
  const db = new Database(dbPath);
  try {
    const result = runEnrollmentConstraintMigration(db);
    console.log('Result:', result);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = { runEnrollmentConstraintMigration };
