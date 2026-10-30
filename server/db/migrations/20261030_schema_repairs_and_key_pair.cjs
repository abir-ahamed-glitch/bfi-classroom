const Database = require('better-sqlite3');
const path = require('path');

const MIGRATION_NAME = '20261030_schema_repairs_and_key_pair';

/**
 * Migration: Additive Schema Repairs for E2E Key-Pair Backup and Moderation Reports
 *
 * Repairs historical schema drift across fresh and previously migrated databases:
 * 1. Ensures `users` table exists and has `private_key TEXT DEFAULT NULL` (preserving any existing encrypted key values).
 * 2. Ensures `reports` table exists (handling minimal historical test/rehearsal schemas that omitted `reports`,
 *    or full historical schemas where `reports` lacked `content_snapshot` and/or `screenshot_path`),
 *    and adds `content_snapshot TEXT DEFAULT NULL` and `screenshot_path TEXT DEFAULT NULL` while preserving all existing report rows.
 * 3. Ensures `idx_reports_status_created`, `idx_reports_content`, and `idx_reports_reporter` indexes exist.
 * 4. Propagates any genuine database or SQL errors rather than swallowing exceptions as "column already exists".
 * 5. Tracks idempotent execution in `app_migrations`.
 */
function runSchemaRepairsAndKeyPairMigration(db) {
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
      // 1. Verify users table exists and add private_key if missing
      const usersTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get();
      if (!usersTable) {
        throw new Error(`[${MIGRATION_NAME}] Required table 'users' does not exist.`);
      }

      const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
      if (!userColumns.includes('private_key')) {
        db.prepare(`ALTER TABLE users ADD COLUMN private_key TEXT DEFAULT NULL`).run();
      }

      // 2. Ensure reports table exists (supporting minimal historical schemas) and add missing columns
      const reportsTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reports'`).get();
      if (!reportsTable) {
        db.prepare(`
          CREATE TABLE reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_id INTEGER NOT NULL,
            reported_user_id INTEGER,
            content_type TEXT NOT NULL,
            content_id INTEGER,
            reason_category TEXT NOT NULL,
            reason_detail TEXT,
            content_snapshot TEXT,
            screenshot_path TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            admin_note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            resolved_at DATETIME,
            resolved_by INTEGER
          )
        `).run();
      } else {
        const reportColumns = db.prepare(`PRAGMA table_info(reports)`).all().map(c => c.name);
        if (!reportColumns.includes('content_snapshot')) {
          db.prepare(`ALTER TABLE reports ADD COLUMN content_snapshot TEXT DEFAULT NULL`).run();
        }
        if (!reportColumns.includes('screenshot_path')) {
          db.prepare(`ALTER TABLE reports ADD COLUMN screenshot_path TEXT DEFAULT NULL`).run();
        }
      }

      const finalReportColumns = db.prepare(`PRAGMA table_info(reports)`).all().map(c => c.name);
      if (finalReportColumns.includes('status') && finalReportColumns.includes('created_at')) {
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC)`).run();
      }
      if (finalReportColumns.includes('content_type') && finalReportColumns.includes('content_id')) {
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_content ON reports(content_type, content_id)`).run();
      }
      if (finalReportColumns.includes('reporter_id')) {
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id)`).run();
      }

      // 3. Verify foreign keys before committing
      const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (fkErrors.length > 0) {
        throw new Error(`[${MIGRATION_NAME}] Foreign key check failed: ${JSON.stringify(fkErrors)}`);
      }

      // 4. Record migration completion
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

if (require.main === module) {
  const targetDbPath = process.argv[2] || process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'bfi_classroom.db');
  console.log(`Running Schema Repairs & Key-Pair migration on: ${targetDbPath}`);
  const db = new Database(targetDbPath);
  try {
    db.pragma('foreign_keys = ON');
    runSchemaRepairsAndKeyPairMigration(db);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = {
  MIGRATION_NAME,
  runSchemaRepairsAndKeyPairMigration
};
