function ensureFilmSubmissionSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS film_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL REFERENCES student_course_enrollments(id) ON DELETE CASCADE,
    phase_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    video_url TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'under_review' CHECK(status IN ('under_review','accepted','changes_requested')),
    feedback TEXT NOT NULL DEFAULT '',
    reviewed_by INTEGER REFERENCES users(id),
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    UNIQUE(enrollment_id, phase_id, revision)
  ); CREATE INDEX IF NOT EXISTS idx_film_enrollment ON film_submissions(enrollment_id, phase_id, revision);`);
  db.exec(`CREATE TABLE IF NOT EXISTS course_attendance_excuses (
    enrollment_id INTEGER NOT NULL REFERENCES student_course_enrollments(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (enrollment_id, class_id)
  )`);
  const result = db.prepare("INSERT OR IGNORE INTO app_migrations (name) VALUES ('20261109_film_submissions')").run();
  return { applied: result.changes > 0 };
}

module.exports = { ensureFilmSubmissionSchema };
