/**
 * Migration: Single-Use MFA Login Challenges
 *
 * Adds:
 * 1. mfa_login_challenges table for server-side single-use tracking of MFA login challenge tokens
 */

const MIGRATION_NAME = '20261024_mfa_single_use_challenges';

function runMfaSingleUseChallengesMigration(db) {
  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      executed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const alreadyRun = db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(MIGRATION_NAME);
  if (alreadyRun) {
    return { applied: false, reason: 'Already applied' };
  }

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mfa_login_challenges (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_version INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0,
        consumed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_login_challenges(user_id);
    `);

    // Record completed migration
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(MIGRATION_NAME);
  });

  tx();
  console.log(`[Migration] ${MIGRATION_NAME} successfully applied.`);
}


if (require.main === module) {
  const Database = require('better-sqlite3');
  const targetDbPath = process.argv[2] || process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'bfi_classroom.db');
  console.log(`Running MFA Single-Use Challenges migration on: ${targetDbPath}`);
  const db = new Database(targetDbPath);
  try {
    db.pragma('foreign_keys = ON');
    runMfaSingleUseChallengesMigration(db);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = {
  runMfaSingleUseChallengesMigration,
  MIGRATION_NAME
};
