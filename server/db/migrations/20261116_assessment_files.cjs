const migrationName = '20261116_assessment_files';

function ensureAssessmentSubmissions(db) {
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS assessment_submissions (
      id INTEGER PRIMARY KEY,
      window_id INTEGER NOT NULL REFERENCES assessment_windows(id),
      enrollment_id INTEGER NOT NULL REFERENCES student_course_enrollments(id),
      version INTEGER NOT NULL CHECK(version > 0),
      pdf_data BLOB NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK(byte_size > 0),
      request_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','graded')),
      submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      graded_at TEXT,
      marks REAL,
      remarks TEXT,
      UNIQUE(window_id, enrollment_id, version),
      UNIQUE(window_id, enrollment_id, request_key)
    );`);
    return {applied: db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(migrationName).changes > 0};
  })();
}
module.exports = {ensureAssessmentSubmissions};
