#!/usr/bin/env node
/**
 * scripts/test_schema_migration_and_rollback.cjs
 *
 * Verifies canonical migration runner, schema deployment, idempotency,
 * unique constraints, and reversible rollback rehearsal on an isolated database.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');

const tempDbPath = path.resolve(__dirname, `test_migration_${Date.now()}.db`);

try {
  console.log(`[Schema Migration Test] Initializing test DB at ${tempDbPath}`);
  const db = new Database(tempDbPath);

  // Set up baseline schema (users, sessions, course_definitions without new columns)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      role TEXT DEFAULT 'student',
      is_active INTEGER DEFAULT 1,
      private_key TEXT,
      is_super_admin INTEGER DEFAULT 0,
      token_version INTEGER DEFAULT 1,
      permissions_version INTEGER DEFAULT 1,
      pending_two_factor_secret TEXT,
      last_totp_timestamp INTEGER,
      created_by_admin_id INTEGER,
      archived_at TEXT,
      archived_by_admin_id INTEGER,
      archive_reason TEXT,
      restored_at TEXT,
      restored_by_admin_id INTEGER,
      restore_reason TEXT,
      email_verified_at TEXT,
      verified_email TEXT,
      password_reset_pending INTEGER DEFAULT 0,
      password_reset_requested_at TEXT,
      password_reset_requested_by INTEGER,
      account_version INTEGER DEFAULT 1,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
      sudo_verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS course_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      course_type TEXT NOT NULL,
      description TEXT,
      duration_value INTEGER DEFAULT 1,
      duration_unit TEXT DEFAULT 'months',
      phase_count INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      definition_json TEXT,
      created_by INTEGER NOT NULL,
      updated_by INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(slug, version)
    );

    CREATE TABLE IF NOT EXISTS admin_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      UNIQUE(user_id, permission)
    );

    CREATE TABLE IF NOT EXISTS admin_default_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      UNIQUE(role, permission)
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      module TEXT,
      resource TEXT,
      outcome TEXT,
      correlation_id TEXT,
      before_state TEXT,
      after_state TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mfa_login_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_version INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      consumed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS email_verification_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      purpose TEXT,
      token_version INTEGER,
      created_by_admin_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS action_bound_challenges (
      id TEXT PRIMARY KEY,
      actor_id INTEGER NOT NULL,
      session_id INTEGER,
      target_id INTEGER,
      action TEXT NOT NULL,
      challenge_token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed INTEGER DEFAULT 0,
      consumed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_snapshot TEXT,
      screenshot_path TEXT
    );

    CREATE TABLE IF NOT EXISTS batch_instructors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      assigned_by INTEGER,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS certificate_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      course_definition_id INTEGER NOT NULL,
      downloaded_by INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Mark all prior migrations as applied so we test 20261106_session_grace_and_course_draft_idempotency
  const priorMigrations = [
    '20261023_super_admin',
    '20261023_admin_permissions',
    '20261024_privileged_safeguards',
    '20261024_mfa_single_use_challenges',
    '20261025_admin_accountability',
    '20261028_admin_archiving_and_reset',
    '20261029_universal_mfa_and_super_admin',
    '20261030_schema_repairs_and_key_pair',
    '20261104_batch_instructors_and_certificate_downloads'
  ];
  for (const name of priorMigrations) {
    db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(name);
  }
  db.close();

  console.log('✅ Baseline schema and prior migrations populated.');

  // 1. Run canonical migration runner
  console.log('--- Step 1: Executing canonical runner scripts/run_migrations.cjs ---');
  const runnerOutput = execFileSync(process.execPath, [
    path.resolve(__dirname, 'run_migrations.cjs'),
    tempDbPath
  ], { encoding: 'utf8' });
  console.log(runnerOutput);

  // 2. Open DB and verify schema
  console.log('--- Step 2: Verifying applied columns and indexes ---');
  const verifyDb = new Database(tempDbPath);

  const applied = verifyDb.prepare('SELECT name FROM app_migrations WHERE name = ?').get('20261106_session_grace_and_course_draft_idempotency');
  assert.ok(applied, 'Migration 20261106_session_grace_and_course_draft_idempotency must be recorded');

  const sessionCols = verifyDb.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  assert.ok(sessionCols.includes('prev_token_hash'), 'sessions.prev_token_hash must exist');
  assert.ok(sessionCols.includes('last_rotated_at'), 'sessions.last_rotated_at must exist');

  const courseDefCols = verifyDb.prepare('PRAGMA table_info(course_definitions)').all().map(c => c.name);
  assert.ok(courseDefCols.includes('client_draft_id'), 'course_definitions.client_draft_id must exist');

  const indexes = verifyDb.prepare('PRAGMA index_list(course_definitions)').all().map(i => i.name);
  assert.ok(indexes.includes('idx_course_defs_user_client_draft'), 'Unique index idx_course_defs_user_client_draft must exist');

  // Verify unique index enforcement on (created_by, client_draft_id)
  verifyDb.prepare(`
    INSERT INTO course_definitions (slug, version, name, course_type, created_by, updated_by, client_draft_id)
    VALUES ('test-slug-1', 1, 'Test Course 1', 'workshop', 1, 1, 'draft_key_100')
  `).run();

  // Same creator + same client_draft_id MUST FAIL with UNIQUE constraint
  assert.throws(() => {
    verifyDb.prepare(`
      INSERT INTO course_definitions (slug, version, name, course_type, created_by, updated_by, client_draft_id)
      VALUES ('test-slug-2', 1, 'Test Course 2', 'workshop', 1, 1, 'draft_key_100')
    `).run();
  }, /UNIQUE constraint failed/, 'Same creator with same client_draft_id must fail unique constraint');

  // Different creator + same client_draft_id MUST SUCCEED (isolated)
  verifyDb.prepare(`
    INSERT INTO course_definitions (slug, version, name, course_type, created_by, updated_by, client_draft_id)
    VALUES ('test-slug-3', 1, 'Test Course 3', 'workshop', 2, 2, 'draft_key_100')
  `).run();
  console.log('✅ Creator-scoped unique constraint verified successfully.');

  // 3. Rollback Rehearsal
  console.log('--- Step 3: Reversible Rollback Rehearsal ---');
  const { rollbackSessionGraceAndCourseDraftIdempotency } = require('../server/db/migrations/20261106_session_grace_and_course_draft_idempotency.cjs');
  const rollbackRes = rollbackSessionGraceAndCourseDraftIdempotency(verifyDb);
  assert.strictEqual(rollbackRes.rolledBack, true, 'Rollback function must return rolledBack: true');

  const rolledBackApplied = verifyDb.prepare('SELECT name FROM app_migrations WHERE name = ?').get('20261106_session_grace_and_course_draft_idempotency');
  assert.strictEqual(rolledBackApplied, undefined, 'Migration entry must be removed from app_migrations on rollback');

  const rolledBackIndexes = verifyDb.prepare('PRAGMA index_list(course_definitions)').all().map(i => i.name);
  assert.ok(!rolledBackIndexes.includes('idx_course_defs_user_client_draft'), 'Unique index must be dropped on rollback');
  console.log('✅ Rollback verified successfully.');

  // 4. Idempotent Re-application
  console.log('--- Step 4: Idempotent Re-application via canonical runner ---');
  verifyDb.close();

  const runnerOutput2 = execFileSync(process.execPath, [
    path.resolve(__dirname, 'run_migrations.cjs'),
    tempDbPath
  ], { encoding: 'utf8' });
  console.log(runnerOutput2);

  const reVerifyDb = new Database(tempDbPath);
  const reApplied = reVerifyDb.prepare('SELECT name FROM app_migrations WHERE name = ?').get('20261106_session_grace_and_course_draft_idempotency');
  assert.ok(reApplied, 'Migration must be cleanly reapplied');
  reVerifyDb.close();

  console.log('================================================================');
  console.log('✅ ALL SCHEMA MIGRATION & ROLLBACK REHEARSAL CHECKS PASSED');
  console.log('================================================================');
} finally {
  if (fs.existsSync(tempDbPath)) {
    try { fs.unlinkSync(tempDbPath); } catch {}
  }
}
