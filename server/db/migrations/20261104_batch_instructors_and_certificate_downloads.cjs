const Database = require('better-sqlite3');
const path = require('path');

const MIGRATION_NAME = '20261104_batch_instructors_and_certificate_downloads';

/**
 * Migration: batch_instructors table & certificate_downloads columns
 *
 * 1. Ensures `batch_instructors` association table exists with unique constraint on (batch_id, user_id).
 * 2. Ensures `certificate_downloads` table has `enrollment_id`, `batch_id`, `course_definition_id`, `downloaded_by`.
 * 3. Creates supporting lookup indexes.
 * 4. Verifies foreign key integrity before recording in `app_migrations`.
 */
function runBatchInstructorsAndCertificateDownloadsMigration(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  const alreadyApplied = db.prepare('SELECT name FROM app_migrations WHERE name = ?').get(MIGRATION_NAME);
  if (alreadyApplied) {
    return { applied: false, reason: 'Already applied' };
  }

  // Safe foreign key toggling
  const fkStatus = db.prepare('PRAGMA foreign_keys').get();
  const wasFkOn = fkStatus ? Object.values(fkStatus)[0] === 1 : true;

  try {
    db.pragma('foreign_keys = OFF');

    const executeMigration = db.transaction(() => {
      // 1. Ensure batch_instructors table exists
      db.prepare(`
        CREATE TABLE IF NOT EXISTS batch_instructors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          assigned_by INTEGER REFERENCES users(id),
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(batch_id, user_id)
        )
      `).run();

      db.prepare(`CREATE INDEX IF NOT EXISTS idx_batch_instructors_batch ON batch_instructors(batch_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_batch_instructors_user ON batch_instructors(user_id)`).run();

      // 2. Ensure certificate_downloads exists and add missing columns
      const cdTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'certificate_downloads'`).get();
      if (!cdTable) {
        db.prepare(`
          CREATE TABLE certificate_downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            course_name TEXT NOT NULL,
            enrollment_id INTEGER REFERENCES student_course_enrollments(id) ON DELETE CASCADE,
            batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
            course_definition_id INTEGER REFERENCES course_definitions(id) ON DELETE SET NULL,
            downloaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            downloaded_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `).run();
      } else {
        const cdColumns = db.prepare(`PRAGMA table_info(certificate_downloads)`).all().map(c => c.name);
        if (!cdColumns.includes('enrollment_id')) {
          db.prepare(`ALTER TABLE certificate_downloads ADD COLUMN enrollment_id INTEGER REFERENCES student_course_enrollments(id) ON DELETE CASCADE`).run();
        }
        if (!cdColumns.includes('batch_id')) {
          db.prepare(`ALTER TABLE certificate_downloads ADD COLUMN batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL`).run();
        }
        if (!cdColumns.includes('course_definition_id')) {
          db.prepare(`ALTER TABLE certificate_downloads ADD COLUMN course_definition_id INTEGER REFERENCES course_definitions(id) ON DELETE SET NULL`).run();
        }
        if (!cdColumns.includes('downloaded_by')) {
          db.prepare(`ALTER TABLE certificate_downloads ADD COLUMN downloaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL`).run();
        }
      }

      db.prepare(`CREATE INDEX IF NOT EXISTS idx_cd_enrollment ON certificate_downloads(enrollment_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_cd_batch ON certificate_downloads(batch_id)`).run();

      // 3. Verify foreign keys before committing
      const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (fkErrors.length > 0) {
        throw new Error(`[${MIGRATION_NAME}] Foreign key check failed: ${JSON.stringify(fkErrors)}`);
      }

      // 4. Record migration completion
      db.prepare(`INSERT INTO app_migrations (name) VALUES (?)`).run(MIGRATION_NAME);
    });

    executeMigration();

    if (wasFkOn) {
      db.pragma('foreign_keys = ON');
    }

    return { applied: true };
  } catch (err) {
    if (wasFkOn) {
      db.pragma('foreign_keys = ON');
    }
    throw err;
  }
}

module.exports = {
  runBatchInstructorsAndCertificateDownloadsMigration,
  MIGRATION_NAME
};
