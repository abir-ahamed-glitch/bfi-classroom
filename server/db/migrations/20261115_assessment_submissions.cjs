const migrationName = '20261115_assessment_submissions';

function ensureAssessmentSchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assessment_windows (
        id INTEGER PRIMARY KEY,
        batch_id INTEGER NOT NULL REFERENCES batches(id),
        phase_id TEXT NOT NULL,
        assessment_type TEXT NOT NULL CHECK(assessment_type IN ('exam', 'assignment')),
        assessment_id TEXT NOT NULL,
        routine_slot_id TEXT,
        session_date TEXT,
        session_start TEXT,
        session_end TEXT,
        opens_at TEXT NOT NULL,
        closes_at TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(batch_id, phase_id, assessment_type, assessment_id),
        CHECK(opens_at < closes_at)
      );
    `);
    const result = db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(migrationName);
    return { applied: result.changes > 0 };
  })();
}

module.exports = { ensureAssessmentSchema };
