const Database = require('better-sqlite3');
const path = require('path');

const MIGRATION_NAME = '20261023_super_admin';

/**
 * Idempotently ensure the `is_super_admin` column exists on `users` table.
 * Does not alter existing user flags or permissions.
 */
function ensureSuperAdminSchema(db) {
  const userCols = db.prepare('PRAGMA table_info(users)').all();
  const hasCol = userCols.some(c => c.name === 'is_super_admin');

  if (!hasCol) {
    console.log('[SuperAdmin Migration] Adding is_super_admin column to users table...');
    db.prepare('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0').run();
  }
}

/**
 * One-time targeted account promotion:
 * 1. Tracks execution via `app_migrations` table to guarantee one-time execution.
 * 2. Unambiguously verifies target user ID 1 (both admin@abir AND k.eye.films@gmail.com).
 * 3. Enforces that the candidate is active, non-deleted, and has role='admin'.
 * 4. Atomic transaction with full rollback if foreign-key check or any validation fails.
 * 5. Strictly preserves all unrelated accounts' flags.
 */
function runSuperAdminMigration(db) {
  // 1. Ensure schema is ready
  ensureSuperAdminSchema(db);

  // 2. Ensure migrations tracking table exists
  db.prepare(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  // 3. Check if migration has already been applied
  const alreadyApplied = db.prepare('SELECT name FROM app_migrations WHERE name = ?').get(MIGRATION_NAME);
  if (alreadyApplied) {
    return { applied: false, reason: 'Already applied' };
  }

  // 4. Atomic transaction wrapping candidate validation, promotion, FK verification, and migration record
  const executePromotion = db.transaction(() => {
    // Check for any account matching either identifier
    const matchingAccounts = db.prepare(`
      SELECT id, username, email, role, is_active, deleted_at, is_super_admin 
      FROM users 
      WHERE username = 'admin@abir' OR email = 'k.eye.films@gmail.com'
    `).all();

    if (matchingAccounts.length === 0) {
      console.log('[SuperAdmin Migration] Target user admin@abir / k.eye.films@gmail.com not present in database.');
      return { applied: false, reason: 'Target account not present' };
    }

    if (matchingAccounts.length > 1) {
      throw new Error(`[SuperAdmin Migration] Conflict: multiple accounts found matching admin@abir or k.eye.films@gmail.com (${JSON.stringify(matchingAccounts)})`);
    }

    const candidate = matchingAccounts[0];

    // Must match BOTH identifiers
    if (candidate.username !== 'admin@abir' || candidate.email !== 'k.eye.films@gmail.com') {
      throw new Error(`[SuperAdmin Migration] Identifier mismatch: account must have both username admin@abir and email k.eye.films@gmail.com (found username=${candidate.username}, email=${candidate.email})`);
    }

    // Must have stable ID 1
    if (candidate.id !== 1) {
      throw new Error(`[SuperAdmin Migration] Account found with id=${candidate.id}, expected stable id=1`);
    }

    // Must have role 'admin'
    if (candidate.role !== 'admin') {
      throw new Error(`[SuperAdmin Migration] Account id=1 has role='${candidate.role}', expected role='admin'`);
    }

    // Must be active
    if (candidate.is_active !== 1) {
      throw new Error(`[SuperAdmin Migration] Account id=1 is inactive (is_active=${candidate.is_active})`);
    }

    // Must not be deleted
    if (candidate.deleted_at !== null) {
      throw new Error(`[SuperAdmin Migration] Account id=1 is soft-deleted (deleted_at=${candidate.deleted_at})`);
    }

    // Promote verified user 1
    db.prepare('UPDATE users SET is_super_admin = 1 WHERE id = 1').run();

    // Verify foreign keys before committing
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length > 0) {
      throw new Error(`[SuperAdmin Migration] Foreign key check failed: ${JSON.stringify(fkErrors)}`);
    }

    // Record migration in app_migrations
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(MIGRATION_NAME);

    console.log(`✅ [SuperAdmin Migration] User ID 1 (${candidate.username} / ${candidate.email}) verified and promoted to Super Admin.`);
    return { applied: true };
  });

  return executePromotion();
}

// CLI execution
if (require.main === module) {
  const targetDbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'bfi_classroom.db');
  console.log(`Running Super Admin migration on: ${targetDbPath}`);
  const db = new Database(targetDbPath);
  try {
    db.pragma('foreign_keys = ON');
    runSuperAdminMigration(db);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = { ensureSuperAdminSchema, runSuperAdminMigration };
