const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'bfi_classroom.db');
const db = new Database(dbPath);

console.log('Running migration: add batch_id to student_course_enrollments...');

try {
  // 1. Add batch_id column if missing
  const cols = db.prepare('PRAGMA table_info(student_course_enrollments)').all();
  const hasBatchId = cols.some(c => c.name === 'batch_id');

  if (!hasBatchId) {
    db.prepare('ALTER TABLE student_course_enrollments ADD COLUMN batch_id INTEGER REFERENCES batches(id)').run();
    console.log('Column batch_id added to student_course_enrollments.');
  } else {
    console.log('Column batch_id already exists on student_course_enrollments.');
  }

  // 2. Add index for performant lookups
  db.prepare('CREATE INDEX IF NOT EXISTS idx_student_course_enrollments_batch ON student_course_enrollments(batch_id)').run();
  console.log('Index idx_student_course_enrollments_batch ensured.');

  // 3. Safe, deterministic backfill for unambiguous existing records
  // ONLY backfill if there is EXACTLY ONE matching batch in batch_students.
  // If a student belongs to multiple batches or 0 batches, do NOT silently guess.
  const backfillStmt = db.prepare(`
    UPDATE student_course_enrollments
    SET batch_id = (
      SELECT bs.batch_id
      FROM batch_students bs
      JOIN batches b ON b.id = bs.batch_id
      WHERE bs.student_id = student_course_enrollments.user_id
        AND (
          (student_course_enrollments.course_definition_id IS NOT NULL AND b.course_definition_id = student_course_enrollments.course_definition_id)
          OR (student_course_enrollments.course_definition_id IS NULL AND b.course_name = student_course_enrollments.course_name)
        )
      GROUP BY bs.student_id
      HAVING COUNT(DISTINCT bs.batch_id) = 1
    )
    WHERE batch_id IS NULL
      AND user_id IN (
        SELECT bs.student_id
        FROM batch_students bs
        JOIN batches b ON b.id = bs.batch_id
        WHERE (
          (student_course_enrollments.course_definition_id IS NOT NULL AND b.course_definition_id = student_course_enrollments.course_definition_id)
          OR (student_course_enrollments.course_definition_id IS NULL AND b.course_name = student_course_enrollments.course_name)
        )
        GROUP BY bs.student_id
        HAVING COUNT(DISTINCT bs.batch_id) = 1
      )
  `);

  const result = backfillStmt.run();
  console.log(`Deterministic backfill complete: ${result.changes} unambiguous enrollments linked to their batch.`);

  console.log('Migration successful: 20261019_enrollment_batch_id.cjs complete.');
} catch (err) {
  console.error('Migration error:', err);
  process.exit(1);
} finally {
  db.close();
}
