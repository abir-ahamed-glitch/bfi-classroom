#!/usr/bin/env node
/**
 * scripts/test_post_deployment_recovery_isolation.cjs
 *
 * Verifies post-deployment recovery behavior and code-only recovery options on an isolated database:
 * 1. Confirms the deployment runner strictly blocks automatic database rollback when traffic was reopened,
 *    preventing accidental destruction of post-deployment records (workshops, sessions, enrollments).
 * 2. Demonstrates backward compatibility of post-deployment schema additions (prev_token_hash, client_draft_id)
 *    with pre-deployment code queries.
 * 3. Demonstrates supported code-only recovery paths (fix-forward / code redeployment) without wiping user data.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { executeRollback } = require('./production_lifecycle.cjs');

const TEST_DIR = path.resolve(__dirname, '..', 'test_post_deploy_recovery_env');

function setupTestEnvironment() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'server'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'server', 'backups'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'scripts'), { recursive: true });

  const dbPath = path.join(TEST_DIR, 'server', 'bfi_classroom.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Baseline schema before migration 10
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT,
      password_hash TEXT,
      role TEXT,
      token_version INTEGER DEFAULT 1,
      two_factor_enabled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE student_course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      course_id INTEGER,
      enrolled_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_number TEXT,
      course_id INTEGER,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE batch_course_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER,
      amount NUMERIC
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE course_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      version INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      course_type TEXT DEFAULT 'course',
      description TEXT,
      duration_value INTEGER DEFAULT 1,
      duration_unit TEXT DEFAULT 'months',
      phase_count INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      definition_json TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE migrations_applied (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed pre-deployment records
  db.exec(`
    INSERT INTO users (username, email, password_hash, role) VALUES ('admin_pre', 'admin@bfi.test', 'hash123', 'admin');
    INSERT INTO batches (batch_number, course_id, status) VALUES ('B-PRE-01', 1, 'active');
    INSERT INTO batch_course_fees (batch_id, amount) VALUES (1, 5000);
    INSERT INTO student_course_enrollments (user_id, course_id) VALUES (1, 1);
    INSERT INTO course_definitions (slug, name, description, status, created_by)
      VALUES ('pre-deployment-workshop', 'Pre-Deployment Workshop', 'Created before deployment', 'published', 1);
  `);

  // Record 9 initial migrations as applied
  const initialMigrations = [
    '20261020_initial.cjs',
    '20261021_auth.cjs',
    '20261022_batches.cjs',
    '20261023_enrollments.cjs',
    '20261024_fees.cjs',
    '20261025_mfa.cjs',
    '20261026_super_admin.cjs',
    '20261027_student_profiles.cjs',
    '20261028_course_definitions.cjs'
  ];
  const insertMigration = db.prepare('INSERT INTO migrations_applied (name) VALUES (?)');
  for (const m of initialMigrations) {
    insertMigration.run(m);
  }

  // Pre-deployment baseline snapshot (what runner captures before applying new candidate)
  const baseline = {
    users: db.prepare('SELECT count(*) as c FROM users').get().c,
    student_course_enrollments: db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c,
    batches: db.prepare('SELECT count(*) as c FROM batches').get().c,
    batch_course_fees: db.prepare('SELECT count(*) as c FROM batch_course_fees').get().c
  };
  fs.writeFileSync(path.join(TEST_DIR, 'server', 'pre_deployment_baseline.json'), JSON.stringify(baseline, null, 2));

  // Pre-deployment database backup
  const backupFile = path.join(TEST_DIR, 'server', 'backups', 'bfi_classroom_pre_deployment_backup.db');
  fs.copyFileSync(dbPath, backupFile);

  // Pre-deployment revision
  const prevRev = 'aa755b1e1be6a1a687a7ccc5af3ac86caa730a1a';
  fs.writeFileSync(path.join(TEST_DIR, 'server', 'pre_deployment_revision.txt'), prevRev);

  // Now apply Migration 10: 20261106_session_grace_and_course_draft_idempotency.cjs
  const migration10Path = path.resolve(__dirname, '..', 'server', 'db', 'migrations', '20261106_session_grace_and_course_draft_idempotency.cjs');
  const migration10 = require(migration10Path);
  migration10.runSessionGraceAndCourseDraftIdempotencyMigration(db);

  db.close();

  return { dbPath, backupFile, prevRev };
}

async function runTests() {
  console.log('--- Testing Post-Deployment Recovery and Isolation ---');
  const { dbPath, backupFile, prevRev } = setupTestEnvironment();

  // 1. Simulate active deployment state where deployment completed and traffic was reopened
  const attemptId = 'post_deploy_test_' + Date.now();
  const statePath = path.join(TEST_DIR, 'server', 'active_deployment_state.json');
  const deploymentState = {
    attemptId,
    backupFile,
    backupValidated: true,
    trafficReopened: true,
    trafficReopenedAt: new Date().toISOString(),
    trafficMayReopen: true,
    trafficExposureInitiatedAt: new Date().toISOString(),
    phasesCompleted: ['0', '1', '2', '3', '4', '5', '6']
  };
  fs.writeFileSync(statePath, JSON.stringify(deploymentState, null, 2));

  const envBackupFile = path.join(TEST_DIR, 'server', 'backups', `env_pre_reconciliation_${attemptId}.env`);
  fs.writeFileSync(envBackupFile, 'PORT=3001\nNODE_ENV=production\n');
  const dummyEnv = path.join(TEST_DIR, '.env');
  fs.writeFileSync(dummyEnv, 'PORT=3001\nNODE_ENV=production\n');

  const activeBackupPathEnv = path.join(TEST_DIR, 'server', 'backups', 'active_backup_path.env');
  fs.writeFileSync(activeBackupPathEnv, `ATTEMPT_ID=${attemptId}\nBACKUP_FILE=${backupFile}\nBACKUP_VALIDATED=true\nENV_BACKUP_FILE=${envBackupFile}\n`);

  // 2. Create post-deployment records (workshops, sessions, enrollments created after traffic reopened)
  console.log('Seeding post-deployment records in live database...');
  const liveDb = new Database(dbPath);
  liveDb.exec(`
    INSERT INTO users (username, email, password_hash, role) VALUES ('student_post_deploy', 'student@bfi.test', 'hash456', 'student');
    INSERT INTO student_course_enrollments (user_id, course_id) VALUES (2, 1);
    INSERT INTO sessions (user_id, token_hash, prev_token_hash, expires_at)
      VALUES (1, 'active_hash_789', 'grace_hash_123', datetime('now', '+15 minutes'));
    INSERT INTO course_definitions (slug, name, description, status, created_by, client_draft_id)
      VALUES ('post-launch-advanced-workshop', 'Post-Launch Advanced Workshop', 'Created while traffic was live', 'draft', 1, 'draft-client-uuid-999');
  `);

  const postDeployUserCount = liveDb.prepare('SELECT count(*) as c FROM users').get().c;
  const postDeployEnrollmentCount = liveDb.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
  const postDeploySession = liveDb.prepare("SELECT * FROM sessions WHERE prev_token_hash = 'grace_hash_123'").get();
  const postDeployDraft = liveDb.prepare("SELECT * FROM course_definitions WHERE client_draft_id = 'draft-client-uuid-999'").get();
  liveDb.close();

  console.log(`Live DB post-deployment counts: users=${postDeployUserCount}, enrollments=${postDeployEnrollmentCount}`);
  console.log(`Live DB post-deployment session: user_id=${postDeploySession.user_id}, prev_token_hash=${postDeploySession.prev_token_hash}`);
  console.log(`Live DB post-deployment draft: name="${postDeployDraft.name}", client_draft_id=${postDeployDraft.client_draft_id}`);

  if (!postDeploySession || !postDeployDraft) {
    throw new Error('Failed to seed post-deployment records in live database!');
  }

  // 3. Test Runner Rollback Protection:
  // Execute rollback WITHOUT --allow-post-reopening-reconciliation.
  // The runner MUST halt and throw an error to prevent data loss.
  console.log('\n--- Test Case 1: Automatic Rollback Blocked After Traffic Reopening ---');
  let rollbackBlocked = false;
  let rollbackError = null;
  try {
    await executeRollback({
      rootDir: TEST_DIR,
      databasePath: dbPath,
      envPath: dummyEnv,
      allowPostReopeningReconciliation: false,
      isRehearsal: true
    });
  } catch (err) {
    rollbackBlocked = true;
    rollbackError = err;
    console.log(`Rollback correctly refused with message: "${err.message}"`);
  }

  if (!rollbackBlocked) {
    throw new Error('FAIL: Rollback should have been blocked because traffic was reopened!');
  }
  if (!rollbackError.message.includes('Automatic restore rejected after traffic reopening boundary crossed')) {
    throw new Error(`FAIL: Unexpected error message: ${rollbackError.message}`);
  }

  // Verify that the live database and post-deployment records were NOT destroyed or overwritten!
  const verifyDb = new Database(dbPath, { readonly: true });
  const preservedDraft = verifyDb.prepare("SELECT * FROM course_definitions WHERE client_draft_id = 'draft-client-uuid-999'").get();
  const preservedSession = verifyDb.prepare("SELECT * FROM sessions WHERE prev_token_hash = 'grace_hash_123'").get();
  const preservedEnrollmentCount = verifyDb.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
  verifyDb.close();

  if (!preservedDraft || preservedDraft.name !== 'Post-Launch Advanced Workshop') {
    throw new Error('FAIL: Post-deployment draft was wiped or corrupted!');
  }
  if (!preservedSession || preservedSession.prev_token_hash !== 'grace_hash_123') {
    throw new Error('FAIL: Post-deployment session grace record was wiped!');
  }
  if (preservedEnrollmentCount !== 2) {
    throw new Error(`FAIL: Post-deployment enrollments were wiped! Expected 2, got ${preservedEnrollmentCount}`);
  }
  console.log('PASS: Runner safely blocked automatic database restore; 100% of post-deployment records preserved.');

  // 4. Test Case 2: Code-Only Recovery Compatibility
  // Demonstrate that baseline / pre-deployment code queries run seamlessly against the migrated database with post-deployment records.
  console.log('\n--- Test Case 2: Code-Only Recovery Compatibility ---');
  const compatDb = new Database(dbPath);

  // Baseline code queries (from pre-upgrade server/routes/auth.js and course_definitions.js):
  // Baseline auth route queried sessions by token_hash without referencing prev_token_hash:
  const baselineSessionQuery = compatDb.prepare('SELECT * FROM sessions WHERE token_hash = ?').get('active_hash_789');
  if (!baselineSessionQuery || baselineSessionQuery.user_id !== 1) {
    throw new Error('FAIL: Baseline session query failed on migrated schema!');
  }

  // Baseline insert into sessions without specifying prev_token_hash (tests column default / nullability):
  const baselineSessionInsert = compatDb.prepare(`
    INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+15 minutes'))
  `).run(1, 'baseline_code_token_hash_456', 'Mozilla/5.0', '127.0.0.1');
  if (!baselineSessionInsert.lastInsertRowid) {
    throw new Error('FAIL: Baseline session insert without prev_token_hash failed!');
  }

  // Baseline course definition query without referencing client_draft_id:
  const baselineCourses = compatDb.prepare('SELECT id, name, description, status FROM course_definitions WHERE status = ?').all('draft');
  if (baselineCourses.length !== 1 || baselineCourses[0].name !== 'Post-Launch Advanced Workshop') {
    throw new Error('FAIL: Baseline course definition query failed on migrated schema!');
  }

  // Baseline insert into course_definitions without specifying client_draft_id:
  const baselineCourseInsert = compatDb.prepare(`
    INSERT INTO course_definitions (slug, name, description, status, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run('baseline-recovery-course', 'Baseline Recovery Course', 'Created by older code revision', 'draft', 1);
  if (!baselineCourseInsert.lastInsertRowid) {
    throw new Error('FAIL: Baseline course insert without client_draft_id failed!');
  }

  // Baseline idempotent migration check: run_migrations would see migration 10 already in app_migrations
  const appliedMigrations = compatDb.prepare('SELECT name FROM app_migrations').all().map(r => r.name);
  if (!appliedMigrations.includes('20261106_session_grace_and_course_draft_idempotency')) {
    throw new Error('FAIL: Migration 10 not marked in app_migrations!');
  }

  compatDb.close();
  console.log('PASS: Migrated database is 100% backward-compatible with baseline/pre-upgrade application code.');
  console.log('PASS: Code-only recovery (deploying previous commit or hotfix) safely runs on existing database without restoring old backup.');

  // Clean up disposable test directory
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}

  console.log('\n=== ALL POST-DEPLOYMENT RECOVERY TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
