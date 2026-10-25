const Database = require('better-sqlite3');
const path = require('path');

const MIGRATION_NAME = '20261023_admin_permissions';

const ALL_PERMISSIONS = [
  'courses:view',
  'courses:create',
  'courses:edit',
  'courses:publish',
  'courses:delete',
  'batches:view',
  'batches:create',
  'batches:edit',
  'batches:delete',
  'batches:results_upload',
  'students:view',
  'students:create',
  'students:edit',
  'students:academic_records',
  'students:delete',
  'students:export',
  'teachers:view',
  'teachers:create',
  'teachers:edit',
  'teachers:delete',
  'notices:view',
  'notices:create',
  'notices:delete',
  'communications:view',
  'communications:send',
  'communications:schedule',
  'communications:delete',
  'finance:view',
  'finance:edit',
  'reports:view',
  'reports:export',
  'trash:view',
  'trash:restore',
  'trash:delete_permanent',
  'settings:view',
  'settings:edit',
];

/**
 * Migration: Administrator Permissions & Audit Governance
 * 
 * 1. Creates `admin_permissions` table with user foreign key and uniqueness constraint.
 * 2. Creates `admin_default_permissions` table to support configurable future defaults.
 * 3. Creates `admin_audit_logs` table for tracking admin lifecycle and permission mutations.
 * 4. Preserves 100% of capabilities for pre-existing ordinary administrators by granting full operational permissions.
 * 5. Uses `app_migrations` for strict idempotency and atomic transaction safety.
 */
function runAdminPermissionsMigration(db) {
  // 1. Ensure migrations table exists
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
    // 2. Create admin_permissions table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        permission TEXT NOT NULL,
        granted_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, permission),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_permissions_user ON admin_permissions(user_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_permissions_perm ON admin_permissions(permission)`).run();

    // 3. Create admin_default_permissions table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_default_permissions (
        permission TEXT PRIMARY KEY,
        is_default INTEGER NOT NULL DEFAULT 0,
        updated_by INTEGER,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Create admin_audit_logs table
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

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target ON admin_audit_logs(target_user_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor ON admin_audit_logs(actor_id)`).run();

    // 5. Populate admin_default_permissions catalog (defaults to 0 / conservative empty default)
    const insertDef = db.prepare(`
      INSERT OR IGNORE INTO admin_default_permissions (permission, is_default)
      VALUES (?, 0)
    `);
    for (const perm of ALL_PERMISSIONS) {
      insertDef.run(perm);
    }

    // 6. Migrate pre-existing ordinary administrators: grant full operational permissions
    // This strictly preserves their existing workflow without granting Super Admin status
    const existingAdmins = db.prepare(`
      SELECT id, username FROM users 
      WHERE role = 'admin' AND id != 1 AND deleted_at IS NULL
    `).all();

    const insertPerm = db.prepare(`
      INSERT OR IGNORE INTO admin_permissions (user_id, permission, granted_by)
      VALUES (?, ?, 1)
    `);

    for (const admin of existingAdmins) {
      for (const perm of ALL_PERMISSIONS) {
        insertPerm.run(admin.id, perm);
      }
      console.log(`[AdminPermissions Migration] Preserved existing operational access for admin ${admin.username} (id=${admin.id}).`);
    }

    // 7. Verify foreign keys
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length > 0) {
      throw new Error(`[AdminPermissions Migration] Foreign key check failed: ${JSON.stringify(fkErrors)}`);
    }

    // 8. Record migration
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(MIGRATION_NAME);
    console.log('✅ [AdminPermissions Migration] Admin permissions and audit governance setup completed successfully.');
    return { applied: true };
  });

  return executeMigration();
}

// CLI execution
if (require.main === module) {
  const targetDbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'bfi_classroom.db');
  console.log(`Running Admin Permissions migration on: ${targetDbPath}`);
  const db = new Database(targetDbPath);
  try {
    db.pragma('foreign_keys = ON');
    runAdminPermissionsMigration(db);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = { runAdminPermissionsMigration, ALL_PERMISSIONS };
