const MIGRATION_NAME = '20261106_session_grace_and_course_draft_idempotency';

/**
 * Migration: Session Grace Window & Course Draft Idempotency
 *
 * 1. Adds `prev_token_hash` and `last_rotated_at` to `sessions` table.
 * 2. Creates index `idx_sessions_prev_token_hash` on `sessions(prev_token_hash)`.
 * 3. Adds `client_draft_id` to `course_definitions` table.
 * 4. Creates scoped unique index `idx_course_defs_user_client_draft` on `course_definitions(created_by, client_draft_id)`.
 * 5. Registers migration in `app_migrations`.
 */
function runSessionGraceAndCourseDraftIdempotencyMigration(db) {
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

  const fkStatus = db.prepare('PRAGMA foreign_keys').get();
  const wasFkOn = fkStatus ? Object.values(fkStatus)[0] === 1 : true;

  try {
    db.pragma('foreign_keys = OFF');

    const executeMigration = db.transaction(() => {
      // 1. Sessions table updates
      const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
      if (!sessionCols.includes('prev_token_hash')) {
        db.prepare('ALTER TABLE sessions ADD COLUMN prev_token_hash TEXT').run();
      }
      if (!sessionCols.includes('last_rotated_at')) {
        db.prepare('ALTER TABLE sessions ADD COLUMN last_rotated_at TEXT').run();
      }
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_prev_token_hash ON sessions(prev_token_hash)').run();

      // 2. Course definitions table updates
      const courseDefCols = db.prepare('PRAGMA table_info(course_definitions)').all().map(c => c.name);
      if (!courseDefCols.includes('client_draft_id')) {
        db.prepare('ALTER TABLE course_definitions ADD COLUMN client_draft_id TEXT').run();
      }

      // Drop legacy non-unique index if it exists
      db.prepare('DROP INDEX IF EXISTS idx_course_defs_client_draft_id').run();

      // Ensure creator-scoped atomic uniqueness for non-null client draft IDs
      db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_course_defs_user_client_draft 
        ON course_definitions(created_by, client_draft_id) 
        WHERE client_draft_id IS NOT NULL
      `).run();

      // 3. Record in app_migrations
      db.prepare('INSERT INTO app_migrations (name, applied_at) VALUES (?, datetime(\'now\'))').run(MIGRATION_NAME);
    });

    executeMigration();

    // Verification check
    const checkSessionCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
    if (!checkSessionCols.includes('prev_token_hash') || !checkSessionCols.includes('last_rotated_at')) {
      throw new Error('Migration assertion failed: sessions columns missing.');
    }
    const checkCourseDefCols = db.prepare('PRAGMA table_info(course_definitions)').all().map(c => c.name);
    if (!checkCourseDefCols.includes('client_draft_id')) {
      throw new Error('Migration assertion failed: course_definitions.client_draft_id missing.');
    }

    return { applied: true };
  } finally {
    if (wasFkOn) {
      db.pragma('foreign_keys = ON');
    }
  }
}

/**
 * Reversible Rollback Rehearsal
 */
function rollbackSessionGraceAndCourseDraftIdempotency(db) {
  const fkStatus = db.prepare('PRAGMA foreign_keys').get();
  const wasFkOn = fkStatus ? Object.values(fkStatus)[0] === 1 : true;

  try {
    db.pragma('foreign_keys = OFF');

    const executeRollback = db.transaction(() => {
      // Remove indexes
      db.prepare('DROP INDEX IF EXISTS idx_course_defs_user_client_draft').run();
      db.prepare('DROP INDEX IF EXISTS idx_sessions_prev_token_hash').run();

      // Remove migration record
      db.prepare('DELETE FROM app_migrations WHERE name = ?').run(MIGRATION_NAME);
    });

    executeRollback();
    return { rolledBack: true };
  } finally {
    if (wasFkOn) {
      db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = {
  runSessionGraceAndCourseDraftIdempotencyMigration,
  rollbackSessionGraceAndCourseDraftIdempotency,
  MIGRATION_NAME
};
