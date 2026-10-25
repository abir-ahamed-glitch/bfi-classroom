const MIGRATION_NAME = '20261025_admin_accountability';

/**
 * Migration: Administrator Accountability & Operational Audit Ledger
 * 
 * 1. Adds `created_by_admin_id` column to `users` for creator attribution.
 *    For existing accounts, stays NULL; displayed as 'Unknown/Legacy'. Never invented.
 * 2. Expands `admin_audit_logs` table with:
 *    - module TEXT (e.g., 'students', 'academic', 'courses', 'batches', 'fees', 'notices', 'broadcasts', 'exports', 'admin_management', 'security')
 *    - resource TEXT (e.g., 'student:123', 'course:4', 'batch:10', 'admin:2')
 *    - outcome TEXT DEFAULT 'success' ('success', 'failed', 'denied')
 *    - correlation_id TEXT
 *    - before_state TEXT (allowlisted JSON snapshot)
 *    - after_state TEXT (allowlisted JSON snapshot)
 * 3. Creates performant indexes for module, action, outcome, created_at, and correlation_id.
 * 4. Idempotent execution recorded in `app_migrations`.
 */
function runAdminAccountabilityMigration(db) {
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

  const executeMigration = db.transaction(() => {
    // 1. Add created_by_admin_id to users if not present
    const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    if (!userColumns.includes('created_by_admin_id')) {
      db.prepare(`ALTER TABLE users ADD COLUMN created_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL`).run();
    }
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_admin_id)`).run();

    // 2. Ensure admin_audit_logs exists and has required operational columns
    db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER,
        target_user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `).run();

    const auditColumns = db.prepare(`PRAGMA table_info(admin_audit_logs)`).all().map(c => c.name);

    if (!auditColumns.includes('module')) {
      db.prepare(`ALTER TABLE admin_audit_logs ADD COLUMN module TEXT`).run();
    }
    if (!auditColumns.includes('resource')) {
      db.prepare(`ALTER TABLE admin_audit_logs ADD COLUMN resource TEXT`).run();
    }
    if (!auditColumns.includes('outcome')) {
      db.prepare(`ALTER TABLE admin_audit_logs ADD COLUMN outcome TEXT DEFAULT 'success'`).run();
    }
    if (!auditColumns.includes('correlation_id')) {
      db.prepare(`ALTER TABLE admin_audit_logs ADD COLUMN correlation_id TEXT`).run();
    }
    if (!auditColumns.includes('before_state')) {
      db.prepare(`ALTER TABLE admin_audit_logs ADD COLUMN before_state TEXT`).run();
    }
    if (!auditColumns.includes('after_state')) {
      db.prepare(`ALTER TABLE admin_audit_logs ADD COLUMN after_state TEXT`).run();
    }

    // 3. Create indexes for fast querying and filtering
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_module ON admin_audit_logs(module)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON admin_audit_logs(action)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_outcome ON admin_audit_logs(outcome)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_corr ON admin_audit_logs(correlation_id)`).run();

    // 4. Mark migration applied
    db.prepare(`INSERT INTO app_migrations (name) VALUES (?)`).run(MIGRATION_NAME);
  });

  executeMigration();
  return { applied: true };
}

function ensureAdminAccountabilitySchema(db) {
  runAdminAccountabilityMigration(db);
}

module.exports = {
  runAdminAccountabilityMigration,
  ensureAdminAccountabilitySchema,
};
