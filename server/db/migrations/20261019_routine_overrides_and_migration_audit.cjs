const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../bfi_classroom.db');
const db = new Database(dbPath);

console.log('Running migration: 20261019_routine_overrides_and_migration_audit.cjs on', dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS course_routine_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_definition_id INTEGER NOT NULL,
    batch_id INTEGER DEFAULT 0,
    phase_id TEXT NOT NULL,
    routine_json TEXT NOT NULL,
    updated_by INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (course_definition_id) REFERENCES course_definitions(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_course_routine_overrides
    ON course_routine_overrides(course_definition_id, batch_id, phase_id);

  CREATE TABLE IF NOT EXISTS legacy_enrollment_migrations (
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
    FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id),
    FOREIGN KEY (target_course_definition_id) REFERENCES course_definitions(id),
    FOREIGN KEY (migrated_by) REFERENCES users(id)
  );
`);

console.log('Migration completed successfully.');
db.close();
