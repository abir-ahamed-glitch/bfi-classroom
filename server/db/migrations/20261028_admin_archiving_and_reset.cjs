const MIGRATION_NAME = '20261028_admin_archiving_and_reset';

/**
 * Migration: Admin Archiving, Email Verification Challenges & Password Reset Tokens
 *
 * 1. Extends `users` table with:
 *    - archive lifecycle: archived_at, archived_by_admin_id, archive_reason, restored_at, restored_by_admin_id, restore_reason
 *    - email ownership: email_verified_at, verified_email (existing accounts start unverified/NULL)
 *    - reset pending: password_reset_pending, password_reset_requested_at, password_reset_requested_by
 *    - optimistic concurrency: account_version (INTEGER NOT NULL DEFAULT 1)
 * 2. Creates `email_verification_challenges` table with user and exact email binding.
 * 3. Upgrades `password_reset_tokens` table via SQLite table recreation to support:
 *    - purpose separation: 'user_recovery', 'admin_self_recovery', 'admin_password_reset'
 *    - credential version pinning: token_version
 *    - creator attribution: created_by_admin_id
 *    - composite unique constraint: UNIQUE(user_id, purpose)
 *    - safely discards unversioned legacy reset links
 * 4. Idempotent execution tracked in `app_migrations`.
 */
function runAdminArchivingAndResetMigration(db) {
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
      // 1. Extend users table with required columns
      const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);

      if (!userColumns.includes('archived_at')) {
        db.prepare(`ALTER TABLE users ADD COLUMN archived_at TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('archived_by_admin_id')) {
        db.prepare(`ALTER TABLE users ADD COLUMN archived_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL`).run();
      }
      if (!userColumns.includes('archive_reason')) {
        db.prepare(`ALTER TABLE users ADD COLUMN archive_reason TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('restored_at')) {
        db.prepare(`ALTER TABLE users ADD COLUMN restored_at TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('restored_by_admin_id')) {
        db.prepare(`ALTER TABLE users ADD COLUMN restored_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL`).run();
      }
      if (!userColumns.includes('restore_reason')) {
        db.prepare(`ALTER TABLE users ADD COLUMN restore_reason TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('email_verified_at')) {
        db.prepare(`ALTER TABLE users ADD COLUMN email_verified_at TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('verified_email')) {
        db.prepare(`ALTER TABLE users ADD COLUMN verified_email TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('password_reset_pending')) {
        db.prepare(`ALTER TABLE users ADD COLUMN password_reset_pending INTEGER NOT NULL DEFAULT 0`).run();
      }
      if (!userColumns.includes('password_reset_requested_at')) {
        db.prepare(`ALTER TABLE users ADD COLUMN password_reset_requested_at TEXT DEFAULT NULL`).run();
      }
      if (!userColumns.includes('password_reset_requested_by')) {
        db.prepare(`ALTER TABLE users ADD COLUMN password_reset_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL`).run();
      }
      if (!userColumns.includes('account_version')) {
        db.prepare(`ALTER TABLE users ADD COLUMN account_version INTEGER NOT NULL DEFAULT 1`).run();
      }

      // Users indexes
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_admin_archived ON users(role, archived_at)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_password_reset_pending ON users(password_reset_pending)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_account_version ON users(id, account_version)`).run();

      // 2. Create email_verification_challenges table
      db.prepare(`
        CREATE TABLE IF NOT EXISTS email_verification_challenges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'email_verification',
          expires_at TEXT NOT NULL,
          consumed INTEGER NOT NULL DEFAULT 0,
          consumed_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_verification_lookup ON email_verification_challenges(user_id, token_hash, consumed)`).run();

      // 3. Upgrade password_reset_tokens table
      const resetTableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'`).get();
      if (!resetTableExists) {
        db.prepare(`
          CREATE TABLE password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'user_recovery' CHECK(purpose IN ('user_recovery', 'admin_self_recovery', 'admin_password_reset')),
            token_version INTEGER NOT NULL DEFAULT 1,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            created_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, purpose)
          )
        `).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup ON password_reset_tokens(user_id, token_hash, purpose)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)`).run();
      } else {
        const resetCols = db.prepare(`PRAGMA table_info(password_reset_tokens)`).all().map(c => c.name);
        if (!resetCols.includes('purpose') || !resetCols.includes('token_version')) {
          db.prepare(`ALTER TABLE password_reset_tokens RENAME TO _password_reset_tokens_old`).run();

          db.prepare(`
            CREATE TABLE password_reset_tokens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              token_hash TEXT NOT NULL,
              purpose TEXT NOT NULL DEFAULT 'user_recovery' CHECK(purpose IN ('user_recovery', 'admin_self_recovery', 'admin_password_reset')),
              token_version INTEGER NOT NULL DEFAULT 1,
              expires_at TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now')),
              created_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              UNIQUE(user_id, purpose)
            )
          `).run();

          db.prepare(`DROP TABLE _password_reset_tokens_old`).run();

          db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup ON password_reset_tokens(user_id, token_hash, purpose)`).run();
          db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)`).run();
        }
      }

      // 4. Mark migration applied in app_migrations
      db.prepare(`INSERT INTO app_migrations (name) VALUES (?)`).run(MIGRATION_NAME);
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
  runAdminArchivingAndResetMigration,
  MIGRATION_NAME
};
