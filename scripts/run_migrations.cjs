#!/usr/bin/env node
/**
 * Unified Migration Runner for BFI Classroom
 *
 * Runs all pending migrations in strict chronological order with:
 * - Explicit database path support via CLI argument or DATABASE_PATH env var
 * - Foreign key enforcement and WAL safety
 * - Idempotent execution (safe to run multiple times)
 * - Strict post-migration schema and integrity assertions
 * - Clear exit codes (0 = success, 1 = failure)
 *
 * Usage:
 *   node scripts/run_migrations.cjs [path/to/database.db]
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function findMigrationsDir() {
  const candidateFromScripts = path.resolve(__dirname, '..', 'server', 'db', 'migrations');
  if (fs.existsSync(candidateFromScripts)) return candidateFromScripts;
  const candidateFromRecoveryTools = path.resolve(__dirname, '..', 'db', 'migrations');
  if (fs.existsSync(candidateFromRecoveryTools)) return candidateFromRecoveryTools;
  const candidateFromCwd = path.resolve(process.cwd(), 'server', 'db', 'migrations');
  if (fs.existsSync(candidateFromCwd)) return candidateFromCwd;
  throw new Error(`Migrations directory not found relative to ${__dirname} or ${process.cwd()}`);
}

const migrationsDir = findMigrationsDir();
const { runSuperAdminMigration } = require(path.join(migrationsDir, '20261023_super_admin.cjs'));
const { runAdminPermissionsMigration } = require(path.join(migrationsDir, '20261023_admin_permissions.cjs'));
const { runPrivilegedSafeguardsMigration } = require(path.join(migrationsDir, '20261024_privileged_safeguards.cjs'));
const { runMfaSingleUseChallengesMigration } = require(path.join(migrationsDir, '20261024_mfa_single_use_challenges.cjs'));
const { runAdminAccountabilityMigration } = require(path.join(migrationsDir, '20261025_admin_accountability.cjs'));
const { runAdminArchivingAndResetMigration } = require(path.join(migrationsDir, '20261028_admin_archiving_and_reset.cjs'));
const { runUniversalMfaAndSuperAdminMigration } = require(path.join(migrationsDir, '20261029_universal_mfa_and_super_admin.cjs'));
const { runSchemaRepairsAndKeyPairMigration } = require(path.join(migrationsDir, '20261030_schema_repairs_and_key_pair.cjs'));

const MIGRATIONS = [
  { name: '20261023_super_admin', runner: runSuperAdminMigration },
  { name: '20261023_admin_permissions', runner: runAdminPermissionsMigration },
  { name: '20261024_privileged_safeguards', runner: runPrivilegedSafeguardsMigration },
  { name: '20261024_mfa_single_use_challenges', runner: runMfaSingleUseChallengesMigration },
  { name: '20261025_admin_accountability', runner: runAdminAccountabilityMigration },
  { name: '20261028_admin_archiving_and_reset', runner: runAdminArchivingAndResetMigration },
  { name: '20261029_universal_mfa_and_super_admin', runner: runUniversalMfaAndSuperAdminMigration },
  { name: '20261030_schema_repairs_and_key_pair', runner: runSchemaRepairsAndKeyPairMigration },
];

function resolveDatabasePath() {
  const cliArg = process.argv[2];
  if (cliArg) {
    return path.resolve(process.cwd(), cliArg);
  }
  if (process.env.DATABASE_PATH) {
    return path.resolve(process.cwd(), process.env.DATABASE_PATH);
  }
  if (path.basename(__dirname) === '.recovery_tools') {
    return path.resolve(__dirname, '..', 'bfi_classroom.db');
  }
  return path.resolve(__dirname, '..', 'server', 'bfi_classroom.db');
}

function assertSchemaIntegrity(db) {
  console.log('[Integrity Check] Validating schema integrity and post-migration assertions...');

  // 1. Verify app_migrations table exists and has all entries
  const appMigrationsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_migrations'`).get();
  if (!appMigrationsExists) {
    throw new Error('Assertion failed: table app_migrations does not exist.');
  }

  const appliedMigrations = db.prepare(`SELECT name FROM app_migrations`).all().map(r => r.name);
  for (const m of MIGRATIONS) {
    if (!appliedMigrations.includes(m.name)) {
      throw new Error(`Assertion failed: migration '${m.name}' not found in app_migrations (found: ${appliedMigrations.join(', ')}).`);
    }
  }

  // 2. Verify users table columns
  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
  const requiredUserCols = [
    'private_key',
    'is_super_admin',
    'token_version',
    'permissions_version',
    'pending_two_factor_secret',
    'last_totp_timestamp',
    'created_by_admin_id',
    'archived_at',
    'archived_by_admin_id',
    'archive_reason',
    'restored_at',
    'restored_by_admin_id',
    'restore_reason',
    'email_verified_at',
    'verified_email',
    'password_reset_pending',
    'password_reset_requested_at',
    'password_reset_requested_by',
    'account_version'
  ];
  for (const col of requiredUserCols) {
    if (!userCols.includes(col)) {
      throw new Error(`Assertion failed: column users.${col} does not exist.`);
    }
  }

  // 3. Verify sessions table columns
  const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all().map(c => c.name);
  for (const col of ['last_activity', 'sudo_verified_at']) {
    if (!sessionCols.includes(col)) {
      throw new Error(`Assertion failed: column sessions.${col} does not exist.`);
    }
  }

  // 4. Verify admin_permissions table
  const adminPermsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='admin_permissions'`).get();
  if (!adminPermsExists) {
    throw new Error('Assertion failed: table admin_permissions does not exist.');
  }

  // 5. Verify admin_default_permissions table
  const defaultPermsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='admin_default_permissions'`).get();
  if (!defaultPermsExists) {
    throw new Error('Assertion failed: table admin_default_permissions does not exist.');
  }

  // 6. Verify admin_audit_logs table and operational columns
  const auditLogsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='admin_audit_logs'`).get();
  if (!auditLogsExists) {
    throw new Error('Assertion failed: table admin_audit_logs does not exist.');
  }
  const auditCols = db.prepare(`PRAGMA table_info(admin_audit_logs)`).all().map(c => c.name);
  const requiredAuditCols = ['module', 'resource', 'outcome', 'correlation_id', 'before_state', 'after_state'];
  for (const col of requiredAuditCols) {
    if (!auditCols.includes(col)) {
      throw new Error(`Assertion failed: column admin_audit_logs.${col} does not exist.`);
    }
  }

  // 7. Verify admin_mfa_recovery_codes table
  const recoveryExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='admin_mfa_recovery_codes'`).get();
  if (!recoveryExists) {
    throw new Error('Assertion failed: table admin_mfa_recovery_codes does not exist.');
  }

  // 8. Verify mfa_login_challenges table
  const challengesExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mfa_login_challenges'`).get();
  if (!challengesExists) {
    throw new Error('Assertion failed: table mfa_login_challenges does not exist.');
  }

  // 8B. Verify email_verification_challenges table
  const emailChallengesExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='email_verification_challenges'`).get();
  if (!emailChallengesExists) {
    throw new Error('Assertion failed: table email_verification_challenges does not exist.');
  }

  // 8C. Verify password_reset_tokens upgraded columns
  const resetTokenCols = db.prepare(`PRAGMA table_info(password_reset_tokens)`).all().map(c => c.name);
  for (const col of ['purpose', 'token_version', 'created_by_admin_id']) {
    if (!resetTokenCols.includes(col)) {
      throw new Error(`Assertion failed: column password_reset_tokens.${col} does not exist.`);
    }
  }

  // 8D. Verify user_mfa_recovery_codes table and columns
  const userRecoveryExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_mfa_recovery_codes'`).get();
  if (!userRecoveryExists) {
    throw new Error('Assertion failed: table user_mfa_recovery_codes does not exist.');
  }
  const userRecoveryCols = db.prepare(`PRAGMA table_info(user_mfa_recovery_codes)`).all().map(c => c.name);
  for (const col of ['id', 'user_id', 'code_hash', 'used', 'used_at', 'created_at']) {
    if (!userRecoveryCols.includes(col)) {
      throw new Error(`Assertion failed: column user_mfa_recovery_codes.${col} does not exist.`);
    }
  }

  // 8E. Verify action_bound_challenges table and columns
  const actionBoundExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='action_bound_challenges'`).get();
  if (!actionBoundExists) {
    throw new Error('Assertion failed: table action_bound_challenges does not exist.');
  }
  const actionBoundCols = db.prepare(`PRAGMA table_info(action_bound_challenges)`).all().map(c => c.name);
  for (const col of ['id', 'actor_id', 'session_id', 'target_id', 'action', 'challenge_token_hash', 'expires_at', 'consumed', 'consumed_at', 'created_at']) {
    if (!actionBoundCols.includes(col)) {
      throw new Error(`Assertion failed: column action_bound_challenges.${col} does not exist.`);
    }
  }

  // 8F. Verify reports table and repaired columns (content_snapshot, screenshot_path)
  const reportsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reports'`).get();
  if (!reportsExists) {
    throw new Error('Assertion failed: table reports does not exist.');
  }
  const reportCols = db.prepare(`PRAGMA table_info(reports)`).all().map(c => c.name);
  for (const col of ['content_snapshot', 'screenshot_path']) {
    if (!reportCols.includes(col)) {
      throw new Error(`Assertion failed: column reports.${col} does not exist.`);
    }
  }

  // 9. Foreign key check
  const fkErrors = db.prepare(`PRAGMA foreign_key_check`).all();
  if (fkErrors.length > 0) {
    throw new Error(`Assertion failed: PRAGMA foreign_key_check returned violations: ${JSON.stringify(fkErrors)}`);
  }

  // 10. SQLite quick check
  const quickCheck = db.prepare(`PRAGMA quick_check`).all();
  if (quickCheck.length === 0 || quickCheck[0].quick_check !== 'ok') {
    throw new Error(`Assertion failed: PRAGMA quick_check did not return ok: ${JSON.stringify(quickCheck)}`);
  }

  console.log('✅ [Integrity Check] All post-migration assertions verified successfully.');
}

function runMigrations(dbPath) {
  console.log(`=======================================================`);
  console.log(`BFI Classroom Migration Runner`);
  console.log(`Target Database: ${dbPath}`);
  console.log(`=======================================================`);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Target database file does not exist: ${dbPath}`);
  }

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');

    // Run each migration in sequence
    for (const migration of MIGRATIONS) {
      console.log(`\n--- Running migration: ${migration.name} ---`);
      const result = migration.runner(db);
      if (result && result.applied === false) {
        console.log(`ℹ️ [Skipped] ${migration.name}: ${result.reason || 'Already applied'}`);
      } else {
        console.log(`✅ [Applied] ${migration.name} completed successfully.`);
      }
    }

    // Run post-migration schema integrity assertions
    console.log('');
    assertSchemaIntegrity(db);

    console.log(`\n=======================================================`);
    console.log(`✅ All ${MIGRATIONS.length} migrations applied and verified successfully.`);
    console.log(`=======================================================`);
    return true;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    const targetDb = resolveDatabasePath();
    runMigrations(targetDb);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ [Migration Runner Error]:', err.message || err);
    process.exit(1);
  }
}

module.exports = {
  runMigrations,
  assertSchemaIntegrity,
  MIGRATIONS
};
