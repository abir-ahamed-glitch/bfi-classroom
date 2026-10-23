const path = require('path');
const Database = require(path.resolve('node_modules/better-sqlite3'));

function runMigration(dbInstance) {
  const db = dbInstance || new Database(path.resolve('server/bfi_classroom.db'));

  console.log('--- Starting Course Maker Migration ---');

  // 1. course_definitions
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      course_type TEXT NOT NULL,
      description TEXT,
      duration_value INTEGER,
      duration_unit TEXT DEFAULT 'months',
      phase_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      definition_json TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      updated_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(slug, version)
    );
  `);
  console.log('✅ Ensured course_definitions table exists');

  // 2. course_routine_audits
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_routine_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_definition_id INTEGER NOT NULL,
      batch_id INTEGER,
      phase_id TEXT NOT NULL,
      old_routine TEXT,
      new_routine TEXT NOT NULL,
      changed_by INTEGER NOT NULL,
      changed_at TEXT DEFAULT (datetime('now', 'localtime')),
      reason TEXT,
      FOREIGN KEY (course_definition_id) REFERENCES course_definitions(id),
      FOREIGN KEY (changed_by) REFERENCES users(id)
    );
  `);
  console.log('✅ Ensured course_routine_audits table exists');

  // 3. student_phase_results
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_phase_results (
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
  `);
  console.log('✅ Ensured student_phase_results table exists');

  // 4. student_class_attendance
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_class_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      class_id TEXT NOT NULL,
      attended INTEGER NOT NULL DEFAULT 0,
      attended_at TEXT,
      updated_by INTEGER,
      UNIQUE(enrollment_id, class_id),
      FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
    );
  `);
  console.log('✅ Ensured student_class_attendance table exists');

  // 5. student_assignment_grades
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_assignment_grades (
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
  `);
  console.log('✅ Ensured student_assignment_grades table exists');

  // 6. Alter batches table
  try {
    db.prepare('ALTER TABLE batches ADD COLUMN course_definition_id INTEGER').run();
    console.log('✅ Added course_definition_id to batches');
  } catch (e) {
    if (!e.message.includes('duplicate column')) console.log('Batches alter course_definition_id:', e.message);
  }
  try {
    db.prepare('ALTER TABLE batches ADD COLUMN course_version INTEGER').run();
    console.log('✅ Added course_version to batches');
  } catch (e) {
    if (!e.message.includes('duplicate column')) console.log('Batches alter course_version:', e.message);
  }

  // 7. Alter student_course_enrollments table
  try {
    db.prepare('ALTER TABLE student_course_enrollments ADD COLUMN course_definition_id INTEGER').run();
    console.log('✅ Added course_definition_id to student_course_enrollments');
  } catch (e) {
    if (!e.message.includes('duplicate column')) console.log('Enrollments alter course_definition_id:', e.message);
  }
  try {
    db.prepare('ALTER TABLE student_course_enrollments ADD COLUMN course_version INTEGER').run();
    console.log('✅ Added course_version to student_course_enrollments');
  } catch (e) {
    if (!e.message.includes('duplicate column')) console.log('Enrollments alter course_version:', e.message);
  }

  // 8. Verification
  const count = db.prepare('SELECT COUNT(*) as cnt FROM student_course_enrollments').get();
  console.log('Post-migration enrollments count (must be 911):', count.cnt);

  console.log('--- Migration Complete ---');
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
