const migrationName = '20261115_film_feedback';

function ensureFilmFeedback(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS film_feedback_notes (
        id INTEGER PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES film_submissions(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        video_seconds INTEGER NOT NULL CHECK(typeof(video_seconds) = 'integer' AND video_seconds BETWEEN 0 AND 359999),
        note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_film_feedback_submission_time
        ON film_feedback_notes (submission_id, video_seconds, id);
    `);
    const result = db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(migrationName);
    return { applied: result.changes > 0 };
  })();
}

module.exports = { ensureFilmFeedback };
