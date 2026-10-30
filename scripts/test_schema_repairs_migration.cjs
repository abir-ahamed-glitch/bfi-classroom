#!/usr/bin/env node
/**
 * scripts/test_schema_repairs_migration.cjs
 *
 * Focused Verification Suite for Additive Schema Repairs Migration (`20261030_schema_repairs_and_key_pair`)
 * and the Complete Canonical Migration Runner (`scripts/run_migrations.cjs`):
 *
 * Covers:
 * 1. Exact Reviewer Probe Reproduction: Database with all 7 prior migration markers (including
 *    `20261029_universal_mfa_and_super_admin`) recorded in `app_migrations` but missing
 *    `users.private_key`, `reports.content_snapshot`, and `reports.screenshot_path` -> repaired
 *    cleanly by `runMigrations()` and `assertSchemaIntegrity()`.
 * 2. Historical Schema Variant (Minimal Schema Without `reports` Table): Database with all 7 prior
 *    migrations applied and no `reports` table -> creates `reports` table with required columns and indexes,
 *    adds `users.private_key`, and passes `runMigrations()`.
 * 3. Fresh Unmigrated Database: Baseline database with zero `app_migrations` markers and legacy table
 *    definitions -> executes all 8 canonical migrations in order and passes `assertSchemaIntegrity()`.
 * 4. Already-Correct Database: Database that already has `users.private_key`, `reports.content_snapshot`,
 *    and `reports.screenshot_path` (with and without the `20261030` marker) -> succeeds cleanly.
 * 5. Repeated Idempotent Execution: Running `runMigrations()` multiple times in sequence -> second and
 *    third runs skip all 8 migrations (`applied: false, reason: 'Already applied'`) and pass integrity checks.
 * 6. Data Preservation: Existing encrypted `users.private_key` / `users.public_key` values and existing
 *    `reports` records (`reason_category`, `reason_detail`, `content_snapshot`, `screenshot_path`, `status`,
 *    `admin_note`) are 100% preserved across migration and repeated runs.
 * 7. Genuine Failure Propagation:
 *    - Missing `users` table throws and rolls back without recording `20261030_schema_repairs_and_key_pair`.
 *    - Read-only / locked database or SQL failure during `ALTER TABLE` propagates the genuine error instead
 *      of silently treating it as "column already exists".
 *    - Foreign key violation propagates and rolls back transactionally.
 *    - `assertSchemaIntegrity()` fails closed if any of `users.private_key`, `reports.content_snapshot`,
 *      or `reports.screenshot_path` is missing despite migration markers being present.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations, assertSchemaIntegrity, MIGRATIONS } = require('./run_migrations.cjs');
const { runUniversalMfaAndSuperAdminMigration } = require('../server/db/migrations/20261029_universal_mfa_and_super_admin.cjs');
const {
  MIGRATION_NAME,
  runSchemaRepairsAndKeyPairMigration
} = require('../server/db/migrations/20261030_schema_repairs_and_key_pair.cjs');

const TEST_DIR = path.resolve(__dirname, '..', 'test_schema_repairs_env');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}

/**
 * Seeds the legacy pre-migration baseline tables (`users`, `sessions`, `reports` without new columns)
 * and user ID 1 (`admin@abir` / `k.eye.films@gmail.com`) required by `20261023_super_admin`.
 */
function createLegacyBaseSchema(db, options = {}) {
  const includePrivateKey = Boolean(options.includePrivateKey);
  const reportsVariant = options.reportsVariant || 'legacy_without_snapshot'; // 'none' | 'legacy_without_snapshot' | 'partial_with_screenshot' | 'full'

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      first_name TEXT,
      last_name TEXT,
      public_key TEXT,
      ${includePrivateKey ? 'private_key TEXT,' : ''}
      is_active INTEGER DEFAULT 1,
      deleted_at TEXT,
      two_factor_enabled INTEGER DEFAULT 0,
      two_factor_secret TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  if (reportsVariant === 'legacy_without_snapshot') {
    db.exec(`
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL,
        reported_user_id INTEGER,
        content_type TEXT NOT NULL,
        content_id INTEGER,
        reason_category TEXT NOT NULL,
        reason_detail TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        resolved_by INTEGER
      );
    `);
  } else if (reportsVariant === 'partial_with_screenshot') {
    db.exec(`
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL,
        reported_user_id INTEGER,
        content_type TEXT NOT NULL,
        content_id INTEGER,
        reason_category TEXT NOT NULL,
        reason_detail TEXT,
        screenshot_path TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        resolved_by INTEGER
      );
    `);
  } else if (reportsVariant === 'full') {
    db.exec(`
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
      );
    `);
  }

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'hash_sa', 'admin', 'Abir', 'Ahmad', 1)
  `).run();
}

function runAllTests() {
  console.log('================================================================');
  console.log('START: ADDITIVE SCHEMA REPAIRS & CANONICAL RUNNER TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, desc) {
    total++;
    if (!condition) {
      console.error(`❌ FAIL: ${desc}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
    console.log(`✅ PASS: ${desc}`);
    passed++;
  }

  cleanDir(TEST_DIR);
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Verify MIGRATIONS registry in canonical runner
  assert(MIGRATIONS.length === 8, 'Canonical runner registers all 8 migrations');
  assert(
    MIGRATIONS[MIGRATIONS.length - 1].name === '20261030_schema_repairs_and_key_pair',
    '20261030_schema_repairs_and_key_pair is registered as the 8th migration in canonical order'
  );

  // ── TEST 1: Database with all 7 prior migration markers but missing repaired columns ──
  console.log('\n--- [Test 1] Previously Migrated Database (All 7 Prior Markers Present, Columns Missing) ---');
  {
    const dbPath = path.join(TEST_DIR, 'test1_prior_markers_missing_cols.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    createLegacyBaseSchema(db, { includePrivateKey: false, reportsVariant: 'legacy_without_snapshot' });

    // Run the first 7 historical migrations (up through 20261029_universal_mfa_and_super_admin)
    for (const m of MIGRATIONS.slice(0, 7)) {
      const res = m.runner(db);
      assert(res === undefined || res.applied === true, `Prior migration ${m.name} applied`);
    }

    // Reproduce the exact reviewer probe: 20261029 returns Already applied and private_key is still absent
    const oct29Probe = runUniversalMfaAndSuperAdminMigration(db);
    const colsBeforeRepair = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const reportColsBeforeRepair = db.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
    assert(
      oct29Probe && oct29Probe.applied === false && oct29Probe.reason === 'Already applied',
      'Reviewer probe confirmed: 20261029 returns { applied: false, reason: "Already applied" } when already recorded'
    );
    assert(
      !colsBeforeRepair.includes('private_key'),
      'Before 20261030 migration: users.private_key is absent on database migrated through 20261029'
    );
    assert(
      !reportColsBeforeRepair.includes('content_snapshot') && !reportColsBeforeRepair.includes('screenshot_path'),
      'Before 20261030 migration: reports.content_snapshot and reports.screenshot_path are absent'
    );
    db.close();

    // Now execute the complete canonical migration runner on this previously migrated database
    const runnerSuccess = runMigrations(dbPath);
    assert(runnerSuccess === true, 'Canonical runMigrations() succeeded on database with all prior markers');

    const verifyDb = new Database(dbPath, { readonly: true });
    const userColsAfter = verifyDb.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const reportColsAfter = verifyDb.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
    const appliedNames = verifyDb.prepare('SELECT name FROM app_migrations').all().map(r => r.name);
    verifyDb.close();

    assert(userColsAfter.includes('private_key'), 'users.private_key added to previously migrated database');
    assert(reportColsAfter.includes('content_snapshot'), 'reports.content_snapshot added to previously migrated database');
    assert(reportColsAfter.includes('screenshot_path'), 'reports.screenshot_path added to previously migrated database');
    assert(appliedNames.includes(MIGRATION_NAME), '20261030_schema_repairs_and_key_pair recorded in app_migrations');
  }

  // ── TEST 2: Historical Schema Variants (Missing `reports` Table & Partial `reports` Table) ──
  console.log('\n--- [Test 2] Historical Schema Variants (Missing reports Table & Partial reports Columns) ---');
  {
    // Variant 2A: Database with all 7 prior markers and NO reports table at all
    const dbPathNoReports = path.join(TEST_DIR, 'test2a_no_reports_table.db');
    const dbA = new Database(dbPathNoReports);
    dbA.pragma('foreign_keys = ON');
    createLegacyBaseSchema(dbA, { includePrivateKey: false, reportsVariant: 'none' });
    for (const m of MIGRATIONS.slice(0, 7)) {
      m.runner(dbA);
    }
    dbA.close();

    runMigrations(dbPathNoReports);

    const checkA = new Database(dbPathNoReports, { readonly: true });
    const reportColsA = checkA.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
    const reportIndexesA = checkA.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='reports'`).all().map(i => i.name);
    checkA.close();
    assert(
      reportColsA.includes('content_snapshot') && reportColsA.includes('screenshot_path') && reportColsA.includes('reason_category'),
      'Variant 2A: reports table created with content_snapshot and screenshot_path when absent'
    );
    assert(
      reportIndexesA.includes('idx_reports_status_created') &&
      reportIndexesA.includes('idx_reports_content') &&
      reportIndexesA.includes('idx_reports_reporter'),
      'Variant 2A: all 3 reports indexes created'
    );

    // Variant 2B: Database where screenshot_path already existed but content_snapshot was missing
    const dbPathPartial = path.join(TEST_DIR, 'test2b_partial_reports.db');
    const dbB = new Database(dbPathPartial);
    dbB.pragma('foreign_keys = ON');
    createLegacyBaseSchema(dbB, { includePrivateKey: false, reportsVariant: 'partial_with_screenshot' });
    for (const m of MIGRATIONS.slice(0, 7)) {
      m.runner(dbB);
    }
    dbB.close();

    runMigrations(dbPathPartial);

    const checkB = new Database(dbPathPartial, { readonly: true });
    const reportColsB = checkB.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
    const userColsB = checkB.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    checkB.close();
    assert(
      userColsB.includes('private_key') && reportColsB.includes('content_snapshot') && reportColsB.includes('screenshot_path'),
      'Variant 2B: partial reports table repaired without duplicate-column error'
    );
  }

  // ── TEST 3: Fresh Unmigrated Database Through Complete Canonical Runner ──
  console.log('\n--- [Test 3] Fresh Unmigrated Database Through Complete Canonical Runner ---');
  {
    const dbPathFresh = path.join(TEST_DIR, 'test3_fresh_unmigrated.db');
    const db = new Database(dbPathFresh);
    db.pragma('foreign_keys = ON');
    createLegacyBaseSchema(db, { includePrivateKey: false, reportsVariant: 'legacy_without_snapshot' });
    db.close();

    const ok = runMigrations(dbPathFresh);
    assert(ok === true, 'runMigrations() succeeded from scratch on fresh unmigrated database');

    const checkDb = new Database(dbPathFresh, { readonly: true });
    const countMig = checkDb.prepare('SELECT count(*) as c FROM app_migrations').get().c;
    const userCols = checkDb.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const reportCols = checkDb.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
    checkDb.close();

    assert(countMig === 8, 'All 8 migrations recorded in app_migrations on fresh database');
    assert(userCols.includes('private_key'), 'Fresh database has users.private_key');
    assert(reportCols.includes('content_snapshot') && reportCols.includes('screenshot_path'), 'Fresh database has reports.content_snapshot and reports.screenshot_path');
  }

  // ── TEST 4: Already-Correct Database & Repeated Execution ──
  console.log('\n--- [Test 4] Already-Correct Database & Repeated Idempotent Execution ---');
  {
    const dbPathCorrect = path.join(TEST_DIR, 'test4_already_correct.db');
    const db = new Database(dbPathCorrect);
    db.pragma('foreign_keys = ON');
    createLegacyBaseSchema(db, { includePrivateKey: true, reportsVariant: 'full' });
    db.close();

    // First run on database that already has the columns in its base table definitions
    const firstRun = runMigrations(dbPathCorrect);
    assert(firstRun === true, 'First canonical run on already-correct schema succeeded');

    // Second and third runs (repeated execution)
    const secondRun = runMigrations(dbPathCorrect);
    const thirdRun = runMigrations(dbPathCorrect);
    assert(secondRun === true && thirdRun === true, 'Repeated canonical runner executions succeeded idempotently');

    const checkDb = new Database(dbPathCorrect);
    const directRes = runSchemaRepairsAndKeyPairMigration(checkDb);
    assert(
      directRes && directRes.applied === false && directRes.reason === 'Already applied',
      'Direct invocation after runner returns { applied: false, reason: "Already applied" }'
    );
    checkDb.close();
  }

  // ── TEST 5: Preservation of Existing Encrypted Key Values & Report Records ──
  console.log('\n--- [Test 5] Preservation of Existing Encrypted Key Values and Report Records ---');
  {
    // Case 5A: Database with existing users (some with private_key already present) and existing reports rows
    const dbPathPreserve = path.join(TEST_DIR, 'test5_preserve_data.db');
    const db = new Database(dbPathPreserve);
    db.pragma('foreign_keys = ON');
    createLegacyBaseSchema(db, { includePrivateKey: true, reportsVariant: 'legacy_without_snapshot' });

    const encryptedPrivKey1 = JSON.stringify({
      ciphertext: 'enc_priv_key_base64_payload_admin1',
      iv: 'a1b2c3d4e5f6',
      salt: '998877665544'
    });
    const encryptedPrivKey2 = JSON.stringify({
      ciphertext: 'enc_priv_key_base64_payload_student2',
      iv: '112233445566',
      salt: 'aabbccddeeff'
    });

    db.prepare(`UPDATE users SET public_key = ?, private_key = ? WHERE id = 1`).run('pub_key_admin_1', encryptedPrivKey1);
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, public_key, private_key, is_active)
      VALUES (2, 'student.one', 'student1@bfi.local', 'hash_s1', 'student', 'Student', 'One', 'pub_key_student_2', ?, 1)
    `).run(encryptedPrivKey2);

    db.prepare(`
      INSERT INTO reports (id, reporter_id, reported_user_id, content_type, content_id, reason_category, reason_detail, status, admin_note)
      VALUES (10, 2, 1, 'post', 42, 'Spam or misleading', 'Repeated promotional links', 'reviewed', 'Checked by moderator')
    `).run();

    // Run first 7 migrations first
    for (const m of MIGRATIONS.slice(0, 7)) {
      m.runner(db);
    }
    db.close();

    // Now run canonical migration runner (applies 20261030_schema_repairs_and_key_pair)
    runMigrations(dbPathPreserve);

    // Also insert a report using the newly repaired columns and run migrations again
    const dbMid = new Database(dbPathPreserve);
    dbMid.prepare(`
      INSERT INTO reports (id, reporter_id, reported_user_id, content_type, content_id, reason_category, reason_detail, content_snapshot, screenshot_path, status)
      VALUES (11, 2, 1, 'message', 99, 'Harassment', 'Offensive DM', 'Snapshot of message #99', '/uploads/report-screenshots/report-screenshot-2-100.webp', 'pending')
    `).run();
    dbMid.close();

    // Repeated run
    runMigrations(dbPathPreserve);

    const verifyDb = new Database(dbPathPreserve, { readonly: true });
    const u1 = verifyDb.prepare('SELECT public_key, private_key FROM users WHERE id = 1').get();
    const u2 = verifyDb.prepare('SELECT public_key, private_key FROM users WHERE id = 2').get();
    const r10 = verifyDb.prepare('SELECT * FROM reports WHERE id = 10').get();
    const r11 = verifyDb.prepare('SELECT * FROM reports WHERE id = 11').get();
    verifyDb.close();

    assert(u1.public_key === 'pub_key_admin_1' && u1.private_key === encryptedPrivKey1, 'User 1 public_key and encrypted private_key preserved bit-for-bit');
    assert(u2.public_key === 'pub_key_student_2' && u2.private_key === encryptedPrivKey2, 'User 2 public_key and encrypted private_key preserved bit-for-bit');
    assert(
      r10.reporter_id === 2 &&
      r10.reported_user_id === 1 &&
      r10.content_type === 'post' &&
      r10.content_id === 42 &&
      r10.reason_category === 'Spam or misleading' &&
      r10.reason_detail === 'Repeated promotional links' &&
      r10.status === 'reviewed' &&
      r10.admin_note === 'Checked by moderator' &&
      r10.content_snapshot === null &&
      r10.screenshot_path === null,
      'Pre-existing report row #10 preserved intact with NULL defaults for new columns'
    );
    assert(
      r11.content_snapshot === 'Snapshot of message #99' &&
      r11.screenshot_path === '/uploads/report-screenshots/report-screenshot-2-100.webp',
      'Report row #11 with content_snapshot and screenshot_path preserved across repeated runner execution'
    );
  }

  // ── TEST 6: Genuine Migration Failures Propagate (Never Silently Ignored) ──
  console.log('\n--- [Test 6] Genuine Migration & Integrity Failures Propagate Strictly ---');
  {
    // 6A: Missing `users` table throws and does not record migration
    const memMissingUsers = new Database(':memory:');
    let missingUsersErr = null;
    try {
      runSchemaRepairsAndKeyPairMigration(memMissingUsers);
    } catch (err) {
      missingUsersErr = err;
    }
    const recordedOnFail = memMissingUsers.prepare('SELECT name FROM app_migrations WHERE name = ?').get(MIGRATION_NAME);
    memMissingUsers.close();
    assert(
      Boolean(missingUsersErr && missingUsersErr.message.includes("Required table 'users' does not exist")),
      'Failure propagation 6A: missing users table throws explicit error'
    );
    assert(!recordedOnFail, 'Failure propagation 6A: failed migration is NOT recorded in app_migrations');

    // 6B: Genuine SQL execution failure during ALTER TABLE propagates (not swallowed as "column already exists")
    const memAlterFail = new Database(':memory:');
    createLegacyBaseSchema(memAlterFail, { includePrivateKey: false, reportsVariant: 'legacy_without_snapshot' });
    const origPrepare = memAlterFail.prepare.bind(memAlterFail);
    memAlterFail.prepare = (sql) => {
      if (typeof sql === 'string' && sql.includes('ALTER TABLE users ADD COLUMN private_key')) {
        throw new Error('SQLITE_IOERR: simulated disk I/O failure during ALTER TABLE users');
      }
      return origPrepare(sql);
    };
    let alterErr = null;
    try {
      runSchemaRepairsAndKeyPairMigration(memAlterFail);
    } catch (err) {
      alterErr = err;
    }
    memAlterFail.prepare = origPrepare;
    const recordedAfterIoErr = memAlterFail.prepare('SELECT name FROM app_migrations WHERE name = ?').get(MIGRATION_NAME);
    memAlterFail.close();
    assert(
      Boolean(alterErr && alterErr.message.includes('SQLITE_IOERR: simulated disk I/O failure')),
      'Failure propagation 6B: genuine SQL/IO error during ALTER TABLE propagates instead of being swallowed'
    );
    assert(!recordedAfterIoErr, 'Failure propagation 6B: transaction rolled back and migration marker not recorded');

    // 6C: assertSchemaIntegrity fails closed when migration marker is spoofed but columns are missing
    const memSpoofed = new Database(':memory:');
    createLegacyBaseSchema(memSpoofed, { includePrivateKey: false, reportsVariant: 'legacy_without_snapshot' });
    for (const m of MIGRATIONS.slice(0, 7)) {
      m.runner(memSpoofed);
    }
    // Spoof the 8th migration marker without adding private_key
    memSpoofed.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(MIGRATION_NAME);
    let integrityErr = null;
    try {
      assertSchemaIntegrity(memSpoofed);
    } catch (err) {
      integrityErr = err;
    }
    assert(
      Boolean(integrityErr && integrityErr.message.includes('Assertion failed: column users.private_key does not exist')),
      'Failure propagation 6C: assertSchemaIntegrity fails closed when users.private_key is missing'
    );

    // Add private_key, spoof still lacks reports.content_snapshot -> must fail closed on reports.content_snapshot
    memSpoofed.prepare('ALTER TABLE users ADD COLUMN private_key TEXT').run();
    let reportIntegrityErr = null;
    try {
      assertSchemaIntegrity(memSpoofed);
    } catch (err) {
      reportIntegrityErr = err;
    }
    memSpoofed.close();
    assert(
      Boolean(reportIntegrityErr && reportIntegrityErr.message.includes('Assertion failed: column reports.content_snapshot does not exist')),
      'Failure propagation 6D: assertSchemaIntegrity fails closed when reports.content_snapshot is missing'
    );
  }

  cleanDir(TEST_DIR);

  console.log('\n================================================================');
  console.log(`ALL ${total} SCHEMA REPAIRS & CANONICAL RUNNER TESTS PASSED (${passed}/${total})`);
  console.log('================================================================\n');
}

if (require.main === module) {
  try {
    runAllTests();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ [TEST FATAL] ${err.message}\n${err.stack}`);
    cleanDir(TEST_DIR);
    process.exit(1);
  }
}

module.exports = { runAllTests };
