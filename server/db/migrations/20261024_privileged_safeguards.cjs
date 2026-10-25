/**
 * Migration: Privileged Account Safeguards & Session Hardening
 *
 * Adds:
 * 1. token_version, permissions_version, pending_two_factor_secret, last_totp_timestamp to users table
 * 2. last_activity, sudo_verified_at to sessions table
 * 3. admin_mfa_recovery_codes table for hashed TOTP recovery codes
 */

const MIGRATION_NAME = '20261024_privileged_safeguards';

function runPrivilegedSafeguardsMigration(db) {
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
    return;
  }

  const tx = db.transaction(() => {
    // 1. Users table columns
    const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!userColumns.includes('token_version')) {
      db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1');
    }
    if (!userColumns.includes('permissions_version')) {
      db.exec('ALTER TABLE users ADD COLUMN permissions_version INTEGER NOT NULL DEFAULT 1');
    }
    if (!userColumns.includes('pending_two_factor_secret')) {
      db.exec('ALTER TABLE users ADD COLUMN pending_two_factor_secret TEXT');
    }
    if (!userColumns.includes('last_totp_timestamp')) {
      db.exec('ALTER TABLE users ADD COLUMN last_totp_timestamp INTEGER DEFAULT 0');
    }

    // 2. Sessions table columns
    const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
    if (!sessionColumns.includes('last_activity')) {
      db.exec('ALTER TABLE sessions ADD COLUMN last_activity TEXT');
    }
    if (!sessionColumns.includes('sudo_verified_at')) {
      db.exec('ALTER TABLE sessions ADD COLUMN sudo_verified_at TEXT');
    }

    // 3. MFA Recovery Codes table
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code_hash TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON admin_mfa_recovery_codes(user_id);
    `);

    // Record completed migration
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(MIGRATION_NAME);
  });

  tx();
  console.log(`[Migration] ${MIGRATION_NAME} successfully applied.`);
}

module.exports = {
  runPrivilegedSafeguardsMigration,
  MIGRATION_NAME
};
