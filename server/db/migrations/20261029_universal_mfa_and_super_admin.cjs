const MIGRATION_NAME = '20261029_universal_mfa_and_super_admin';

/**
 * Migration: Universal 2FA, Preserved MFA Recovery Codes, and Action-Bound Super Admin Challenges
 *
 * 1. Creates `user_mfa_recovery_codes` table to support universal MFA for all roles (students, teachers, admins).
 *    - Preserves existing rows from `admin_mfa_recovery_codes` (id, user_id, code_hash, used, used_at).
 *    - Unused codes remain valid once; used codes remain permanently used.
 * 2. Creates `action_bound_challenges` table for high-risk ceremonies (Super Admin promotion/demotion).
 *    - Cryptographically binds MFA verification to actor_id, session_id, target_id, action, and short expiry.
 * 3. Ensures `users` table has `pending_two_factor_secret` column for universal 2FA setup.
 * 4. Idempotent execution tracked in `app_migrations`.
 */
function runUniversalMfaAndSuperAdminMigration(db) {
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
      // 1. Ensure users table has pending_two_factor_secret column
      const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
      if (!userColumns.includes('pending_two_factor_secret')) {
        db.prepare(`ALTER TABLE users ADD COLUMN pending_two_factor_secret TEXT DEFAULT NULL`).run();
      }

      // 2. Create user_mfa_recovery_codes table
      db.prepare(`
        CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          used_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_codes_lookup 
        ON user_mfa_recovery_codes(user_id, used)
      `).run();

      // 3. Data Preservation: Copy existing codes from admin_mfa_recovery_codes if table exists
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(t => t.name);
      if (tables.includes('admin_mfa_recovery_codes')) {
        db.prepare(`
          INSERT OR IGNORE INTO user_mfa_recovery_codes (id, user_id, code_hash, used, used_at)
          SELECT id, user_id, code_hash, used, used_at FROM admin_mfa_recovery_codes
        `).run();
      }

      // 4. Create action_bound_challenges table
      db.prepare(`
        CREATE TABLE IF NOT EXISTS action_bound_challenges (
          id TEXT PRIMARY KEY,
          actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          challenge_token_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed INTEGER NOT NULL DEFAULT 0,
          consumed_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_action_bound_challenges_lookup 
        ON action_bound_challenges(actor_id, action, consumed)
      `).run();

      // 5. Record migration completion
      db.prepare(`INSERT OR REPLACE INTO app_migrations (name, applied_at) VALUES (?, datetime('now'))`).run(MIGRATION_NAME);
    });

    executeMigration();
    return { applied: true };
  } finally {
    if (wasFkOn) {
      db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = {
  MIGRATION_NAME,
  runUniversalMfaAndSuperAdminMigration
};
