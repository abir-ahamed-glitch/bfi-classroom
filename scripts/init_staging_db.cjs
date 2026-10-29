/**
 * Staging Database Initializer & Schema Validator
 * Explicitly initializes tables, runs migrations, verifies schema integrity,
 * and provisions a synthetic staging administrator.
 */
const fs = require('fs');
const path = require('path');
const { loadAndValidateStagingEnv } = require('./staging_guard.cjs');

async function initStagingDb(envPath) {
  const config = loadAndValidateStagingEnv(envPath);
  console.log(`[StagingInit] Verified isolated environment:`);
  console.log(`  Target DB: ${config.databasePath}`);
  console.log(`  Host/Port: ${config.host}:${config.port}`);

  // Ensure target directory exists
  const targetDir = path.dirname(config.databasePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Import Database module dynamically after environment is validated
  const dbModule = await import('../server/db/database.js');
  const db = dbModule.default;

  // Explicitly call initializeDatabase() to create schema and run migrations
  console.log('[StagingInit] Invoking initializeDatabase()...');
  dbModule.initializeDatabase();

  // Run SQLite integrity checks
  const quickCheck = db.prepare('PRAGMA quick_check').get();
  const fkCheck = db.prepare('PRAGMA foreign_key_check').all();

  if (quickCheck.quick_check !== 'ok') {
    throw new Error(`[StagingInit] PRAGMA quick_check failed: ${JSON.stringify(quickCheck)}`);
  }
  if (fkCheck.length > 0) {
    throw new Error(`[StagingInit] Foreign key violations detected: ${JSON.stringify(fkCheck)}`);
  }

  // Verify critical tables exist
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  const requiredTables = [
    'users',
    'student_profiles',
    'course_definitions',
    'batches',
    'batch_students',
    'announcements',
    'admin_audit_logs',
    'action_bound_challenges'
  ];
  for (const table of requiredTables) {
    if (!tables.includes(table)) {
      throw new Error(`[StagingInit] Expected table '${table}' missing after initialization!`);
    }
  }

  // Seed synthetic staging Super Admin if not present
  const existingAdmin = db.prepare(`SELECT id, email, is_super_admin FROM users WHERE email = ?`).get('staging-admin@bfi.local');
  if (!existingAdmin) {
    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = bcrypt.hashSync('StagingAdminPass123!', 10);
    const insertAdmin = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_super_admin, is_active)
      VALUES (?, ?, ?, 'admin', 'Staging', 'SuperAdmin', 1, 1)
    `);
    const info = insertAdmin.run('staging-admin', 'staging-admin@bfi.local', passwordHash);
    console.log(`[StagingInit] Provisioned synthetic Super Admin (ID: ${info.lastInsertRowid}, email: staging-admin@bfi.local)`);
  }

  console.log(`[StagingInit] ✅ Staging database successfully initialized with ${tables.length} tables at: ${config.databasePath}`);
  return { success: true, tableCount: tables.length, databasePath: config.databasePath };
}

if (require.main === module) {
  initStagingDb(process.argv[2])
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[StagingInit] FAILED:', err.message);
      process.exit(1);
    });
}

module.exports = { initStagingDb };
