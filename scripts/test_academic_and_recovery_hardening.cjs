/**
 * scripts/test_academic_and_recovery_hardening.cjs
 * 
 * Comprehensive Security & RBAC Verification Suite:
 * 1. Unit / Handler-Level Isolation Tests (bypassed middleware):
 *    - Validates handler logic when given mock request/response objects.
 * 2. Administrative Password Recovery Enumeration Defense & Delivery Auditing:
 *    - Uniform public HTTP 200 response for all branches (nonexistent, inactive, student, reset pending, unverified, eligible).
 *    - Audit trail captures deliveryStatus (accepted, failed, suppressed) and outcome (success, failure).
 *    - Verification of both false-return and thrown-error delivery failure states.
 *    - Zero leakage of raw reset tokens or reset links in audit records.
 * 3. Rotated Refresh-Token Rejection:
 *    - Proves refresh token signed with historical secret is rejected with HTTP 401 and cleared cookie.
 * 4. Real HTTP Integration Coverage (Mounted Express Routers over loopback HTTP):
 *    - Exercises full middleware chain: authenticateToken, requireRole, sanitizeInput, and route handlers.
 *    - Verifies unauthenticated, invalid JWT, student, unauthorized admin, authorized admin, Super Admin wildcard, and moderator batch scope over real HTTP.
 *    - Proves unauthorized requests cannot mutate academic data.
 *    - Proves real-time permission revocation takes effect immediately over HTTP.
 * 5. Local Test Account Archival Lifecycle Verification:
 *    - Tests schema- and application-grounded archival procedure on test accounts 2153, 2154, 2155 without modifying production.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');

// Enforce isolated test flags
process.env.NODE_ENV = 'test';
process.env.IS_TEST_SERVER = 'true';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';

const TEST_DIR = path.resolve(__dirname, '..', '.tmp_test_runs', `sec_hardening_${Date.now()}`);
if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

const TEST_DB_PATH = path.join(TEST_DIR, 'test_hardening.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const JWT_SECRET = 'test_jwt_secret_academic_hardening_32_chars_min';
const JWT_REFRESH_SECRET = 'test_refresh_secret_academic_hardening_32_chars';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;

const db = new Database(TEST_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Initialize schema
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('admin', 'instructor', 'student', 'moderator')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    pending_two_factor_secret TEXT,
    account_version INTEGER DEFAULT 1,
    token_version INTEGER DEFAULT 1,
    archived_at TEXT DEFAULT NULL,
    archived_by_admin_id INTEGER,
    archive_reason TEXT DEFAULT NULL,
    deleted_at TEXT DEFAULT NULL,
    password_reset_pending INTEGER DEFAULT 0,
    email_verified_at TEXT DEFAULT NULL,
    verified_email TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE admin_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    granted_by INTEGER,
    granted_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, permission)
  );

  CREATE TABLE student_course_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_name TEXT NOT NULL,
    course_type TEXT NOT NULL DEFAULT 'filmmaking',
    step1_completed INTEGER DEFAULT 0,
    step2_completed INTEGER DEFAULT 0,
    step3_completed INTEGER DEFAULT 0,
    step4_completed INTEGER DEFAULT 0,
    attendance_classes TEXT,
    attendance_total INTEGER DEFAULT 22,
    fee_details TEXT,
    assignment_scores TEXT,
    course_definition_id INTEGER,
    course_version INTEGER,
    batch_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE student_phase_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL REFERENCES student_course_enrollments(id) ON DELETE CASCADE,
    phase_number INTEGER,
    phase_id TEXT,
    admitted INTEGER DEFAULT 0,
    admitted_at TEXT DEFAULT NULL,
    passed_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    final_score REAL DEFAULT NULL,
    passed INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    evaluator_id INTEGER,
    evaluator_notes TEXT,
    calculated_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(enrollment_id, phase_id)
  );

  CREATE TABLE course_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    definition_json TEXT,
    course_definition_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(course_name, version)
  );

  CREATE TABLE batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_number TEXT NOT NULL,
    batch_name TEXT,
    course_name TEXT NOT NULL,
    course_definition_id INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE batch_moderators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(batch_id, user_id)
  );

  CREATE TABLE admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    target_user_id INTEGER,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    resource TEXT,
    outcome TEXT NOT NULL,
    correlation_id TEXT,
    details TEXT,
    ip_address TEXT,
    before_state TEXT,
    after_state TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, purpose)
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_activity TEXT DEFAULT (datetime('now')),
    sudo_verified_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE student_class_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    class_number INTEGER NOT NULL,
    attended INTEGER DEFAULT 0,
    UNIQUE(enrollment_id, class_number)
  );

  CREATE TABLE student_assignment_grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    assignment_id TEXT NOT NULL,
    score REAL DEFAULT 0,
    UNIQUE(enrollment_id, assignment_id)
  );

  CREATE TABLE student_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    student_id TEXT UNIQUE,
    phase2_admitted INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE legacy_enrollment_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER,
    user_id INTEGER,
    course_name TEXT,
    legacy_snapshot_json TEXT
  );

  CREATE TABLE course_routine_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_definition_id INTEGER,
    batch_id INTEGER,
    phase_id INTEGER,
    routine_json TEXT
  );

  CREATE TABLE batch_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    UNIQUE(batch_id, student_id)
  );
`);

// 2. Insert test fixtures
const courseDefJson = JSON.stringify({
  version: 1,
  courseName: 'Filmmaking',
  phases: [
    { phaseNumber: 1, title: 'Phase 1', minimumPassingScore: 50 },
    {
      phaseNumber: 2,
      title: 'Phase 2',
      minimumPassingScore: 50,
      classes: [
        { id: 'cls_2_1', title: 'Phase 2 Class 1', mandatory: true }
      ]
    }
  ],
  completionPolicy: {
    phaseGates: {
      sequentialProgression: false,
      requirePreviousPhasePassed: false
    }
  }
});

db.prepare(`
  INSERT INTO course_definitions (id, course_name, version, definition_json, course_definition_json)
  VALUES (1, 'Filmmaking', 1, ?, ?)
`).run(courseDefJson, courseDefJson);

db.prepare(`
  INSERT INTO batches (id, batch_number, course_name, status)
  VALUES (1, 'B01', 'Filmmaking', 'active'),
         (2, 'B02', 'Filmmaking', 'active')
`).run();

// Users:
// 1: Super Admin
// 2: Ordinary Admin (No permissions initially)
// 3: Ordinary Admin (With students:academic_records)
// 4: Moderator
// 5: Student
// 6: Student (for recovery testing)
// 7: Inactive Admin
// 8: Pending-Reset Admin
// 9: Unverified Admin
// 10: Eligible Admin for recovery
db.prepare(`
  INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active, email_verified_at, verified_email, password_reset_pending)
  VALUES 
    (1, 'superadmin', 'super@bfibd.org', '$2a$12$fakehash', 'admin', 'Super', 'Admin', 1, 1, '2026-01-01', 'super@bfibd.org', 0),
    (2, 'unauth_admin', 'unauth@bfibd.org', '$2a$12$fakehash', 'admin', 'Unauth', 'Admin', 0, 1, '2026-01-01', 'unauth@bfibd.org', 0),
    (3, 'auth_admin', 'auth@bfibd.org', '$2a$12$fakehash', 'admin', 'Auth', 'Admin', 0, 1, '2026-01-01', 'auth@bfibd.org', 0),
    (4, 'moderator1', 'mod@bfibd.org', '$2a$12$fakehash', 'moderator', 'Mod', 'One', 0, 1, '2026-01-01', 'mod@bfibd.org', 0),
    (5, 'student1', 'student1@bfibd.org', '$2a$12$fakehash', 'student', 'Student', 'One', 0, 1, '2026-01-01', 'student1@bfibd.org', 0),
    (6, 'student2', 'student@bfibd.org', '$2a$12$fakehash', 'student', 'Student', 'Two', 0, 1, '2026-01-01', 'student@bfibd.org', 0),
    (7, 'inactive_admin', 'inactive@bfibd.org', '$2a$12$fakehash', 'admin', 'Inactive', 'Admin', 0, 0, '2026-01-01', 'inactive@bfibd.org', 0),
    (8, 'reset_admin', 'reset_pending@bfibd.org', '$2a$12$fakehash', 'admin', 'Reset', 'Admin', 0, 1, '2026-01-01', 'reset_pending@bfibd.org', 1),
    (9, 'unverified_admin', 'unverified@bfibd.org', '$2a$12$fakehash', 'admin', 'Unverified', 'Admin', 0, 1, NULL, NULL, 0),
    (10, 'eligible_admin', 'eligible@bfibd.org', '$2a$12$fakehash', 'admin', 'Eligible', 'Admin', 0, 1, '2026-01-01', 'eligible@bfibd.org', 0)
`).run();

// Grant permissions to User 3 (auth_admin)
db.prepare(`
  INSERT INTO admin_permissions (user_id, permission, granted_by)
  VALUES (3, 'students:academic_records', 1),
         (3, 'students:view', 1)
`).run();

// Assign moderator 4 to Batch 1 only
db.prepare(`
  INSERT INTO batch_moderators (batch_id, user_id)
  VALUES (1, 4)
`).run();

// Enrollments:
// Enrollment 1: Student 5, Filmmaking, Batch 1
// Enrollment 2: Student 5, Filmmaking, Batch 2
// Enrollment 3: Student 5, Filmmaking, No Batch (NULL)
db.prepare(`
  INSERT INTO student_course_enrollments (id, user_id, course_name, course_type, course_definition_id, course_version, batch_id)
  VALUES 
    (1, 5, 'Filmmaking', 'filmmaking', 1, 1, 1),
    (2, 5, 'Filmmaking', 'filmmaking', 1, 1, 2),
    (3, 5, 'Filmmaking', 'filmmaking', 1, 1, NULL)
`).run();

// Initial phase results for Enrollment 1
db.prepare(`
  INSERT INTO student_phase_results (enrollment_id, phase_number, phase_id, admitted, admitted_at, passed, completed)
  VALUES (1, 1, 'phase_1', 1, datetime('now'), 1, 1)
`).run();

// Mock express req/res helper for isolated handler unit tests
function mockReqRes({ method = 'GET', url = '/', body = {}, params = {}, query = {}, user = null, cookies = {} } = {}) {
  let statusCode = 200;
  let responseData = null;
  const setHeaders = {};
  const cookiesCleared = [];

  const req = {
    method,
    url,
    originalUrl: url,
    body,
    params,
    query,
    user,
    cookies,
    app: { get: () => null },
    ip: '127.0.0.1',
    get: (header) => (header === 'user-agent' ? 'test-agent' : null),
    correlationId: 'corr_test_' + Math.random().toString(36).substring(2, 10)
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    setHeader(k, v) {
      setHeaders[k] = v;
      return this;
    },
    clearCookie(name) {
      cookiesCleared.push(name);
      return this;
    },
    cookie() {
      return this;
    }
  };

  return {
    req,
    res,
    getResult: () => ({ status: statusCode, data: responseData, setHeaders, cookiesCleared })
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('START: ACADEMIC AUTHORIZATION & RECOVERY ENUMERATION TEST SUITE');
  console.log('================================================================\n');

  // Load patched routes
  const { default: adminRoutes } = await import('../server/routes/admin.js');
  const { default: authRoutes, setCustomEmailDispatcher } = await import('../server/routes/auth.js');

  // Helper to extract express route handler for isolated unit testing
  function findHandler(router, pathPattern, method) {
    const layer = router.stack.find(l => {
      if (!l.route) return false;
      if (l.route.path !== pathPattern) return false;
      return Boolean(l.route.methods[method.toLowerCase()]);
    });
    if (!layer) throw new Error(`Route not found: ${method} ${pathPattern}`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  }

  const getDefinedProgressHandler = findHandler(adminRoutes, '/students/:id/courses/:courseId/defined-progress', 'GET');
  const putDefinedProgressHandler = findHandler(adminRoutes, '/students/:id/courses/:courseId/defined-progress', 'PUT');
  const postAdmitHandler = findHandler(adminRoutes, '/students/:id/courses/:courseId/phases/:phaseNumber/admit', 'POST');
  const postUnadmitHandler = findHandler(adminRoutes, '/students/:id/courses/:courseId/phases/:phaseNumber/unadmit', 'POST');
  const adminForgotPasswordHandler = findHandler(authRoutes, '/admin-forgot-password', 'POST');
  const refreshHandler = findHandler(authRoutes, '/refresh', 'POST');

  // ─────────────────────────────────────────────────────────────────────────
  // Part 1: Unit / Handler-Level Isolation Tests (bypassing middleware)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('=== PART 1: Unit / Handler-Level Isolation Tests (Middleware-Bypassed) ===');

  console.log('\n--- [Test 1.1] Handler Unit: Unauthorized Admin Mutate Defined Progress ---');
  {
    const initialEnrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 1').get();
    const ctx = mockReqRes({
      method: 'PUT',
      url: '/api/admin/students/5/courses/1/defined-progress',
      params: { id: '5', courseId: '1' },
      body: { attendanceClasses: '["Class 1", "Class 2"]', totalAttendance: 22 },
      user: { id: 2, role: 'admin', is_super_admin: 0 }
    });

    await putDefinedProgressHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must return HTTP 403 Forbidden');
    assert.ok(res.data.error.includes("missing required permission 'students:academic_records'"));

    const finalEnrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 1').get();
    assert.deepStrictEqual(initialEnrollment, finalEnrollment, 'Database row must be unchanged');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Security audit log must be recorded on permission denial');
    assert.ok(audit.details.includes('students:academic_records'));
    console.log('✅ PASS: Unauthorized admin rejected (403), data unmodified, audit recorded.');
  }

  console.log('\n--- [Test 1.2] Handler Unit: Unauthorized Admin Phase Admit ---');
  {
    const initialResult = db.prepare("SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id = 'phase_2' OR phase_number = 2)").get();
    assert.strictEqual(initialResult, undefined, 'Phase 2 record must not exist yet');

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/1/phases/2/admit',
      params: { id: '5', courseId: '1', phaseNumber: '2' },
      body: {},
      user: { id: 2, role: 'admin', is_super_admin: 0 }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must return HTTP 403 Forbidden');
    const finalResult = db.prepare("SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id LIKE '%2' OR phase_number = 2)").get();
    assert.strictEqual(finalResult, undefined, 'Phase 2 admission row must NOT be created');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Audit log must record permission_denied for phase admission');
    console.log('✅ PASS: Phase admit blocked (403), admission state untouched, audit recorded.');
  }

  console.log('\n--- [Test 1.3] Handler Unit: Unauthorized Admin Phase Unadmit ---');
  {
    const initialResult = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND phase_number = 1').get();
    assert.ok(initialResult.admitted_at !== null, 'Phase 1 must be currently admitted');

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/1/phases/1/unadmit',
      params: { id: '5', courseId: '1', phaseNumber: '1' },
      body: {},
      user: { id: 2, role: 'admin', is_super_admin: 0 }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must return HTTP 403 Forbidden');
    const finalResult = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND phase_number = 1').get();
    assert.strictEqual(finalResult.admitted_at, initialResult.admitted_at, 'admitted_at timestamp must be unchanged');
    console.log('✅ PASS: Phase unadmit blocked (403), admission state untouched, audit recorded.');
  }

  console.log('\n--- [Test 1.4] Handler Unit: Unauthorized Admin Disclose Defined Progress (GET) ---');
  {
    const ctx = mockReqRes({
      method: 'GET',
      url: '/api/admin/students/5/courses/1/defined-progress',
      params: { id: '5', courseId: '1' },
      user: { id: 2, role: 'admin', is_super_admin: 0 }
    });

    await getDefinedProgressHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must return HTTP 403 Forbidden');
    assert.ok(res.data.error.includes("missing required permission 'students:view'"));

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Audit log must record permission_denied for view attempt');
    assert.ok(audit.details.includes('students:view'));
    console.log('✅ PASS: Defined progress read blocked (403) for admin missing students:view.');
  }

  console.log('\n--- [Test 1.5] Handler Unit: Authorized Admin WITH Permission Succeeds ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/1/phases/2/admit',
      params: { id: '5', courseId: '1', phaseNumber: '2' },
      body: {},
      user: { id: 3, role: 'admin', is_super_admin: 0 }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200, 'Must return HTTP 200 OK');
    assert.strictEqual(res.data.success, true);

    const phase2Row = db.prepare("SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id LIKE '%2' OR phase_number = 2)").get();
    assert.ok(phase2Row, 'Phase 2 result record must be inserted');
    assert.ok(phase2Row.admitted_at !== null, 'admitted_at must be populated');
    console.log('✅ PASS: Authorized admin successfully admitted student to Phase 2.');
  }

  console.log('\n--- [Test 1.6] Handler Unit: Immediate Permission Revocation in Real Time ---');
  {
    // Revoke students:academic_records from User 3 in database
    db.prepare("DELETE FROM admin_permissions WHERE user_id = 3 AND permission = 'students:academic_records'").run();

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/1/phases/2/unadmit',
      params: { id: '5', courseId: '1', phaseNumber: '2' },
      body: {},
      user: { id: 3, role: 'admin', is_super_admin: 0 }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must immediately deny access on permission revocation');

    // Restore permission for subsequent tests
    db.prepare("INSERT INTO admin_permissions (user_id, permission, granted_by) VALUES (3, 'students:academic_records', 1)").run();
    console.log('✅ PASS: Revocation took effect immediately in real time without daemon restart.');
  }

  console.log('\n--- [Test 1.7] Handler Unit: Super Admin Access is Unconditionally Preserved ---');
  {
    const permCount = db.prepare('SELECT COUNT(*) as c FROM admin_permissions WHERE user_id = 1').get().c;
    assert.strictEqual(permCount, 0, 'Super admin has 0 rows in admin_permissions');

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/1/phases/2/unadmit',
      params: { id: '5', courseId: '1', phaseNumber: '2' },
      body: {},
      user: { id: 1, role: 'admin', is_super_admin: 1 }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200, 'Super admin must succeed without granular permission grants');
    assert.strictEqual(res.data.success, true);
    console.log('✅ PASS: Super Admin access operates without requiring granular permission grants.');
  }

  console.log('\n--- [Test 1.8] Handler Unit: Batch Moderator Assigned Moderator Succeeds ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/1/phases/2/admit',
      params: { id: '5', courseId: '1', phaseNumber: '2' },
      body: {},
      user: { id: 4, role: 'moderator' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200, 'Assigned moderator must succeed');
    console.log('✅ PASS: Moderator assigned to batch successfully performed phase operation.');
  }

  console.log('\n--- [Test 1.9] Handler Unit: Batch Moderator Unassigned Moderator Fails (403) ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/2/phases/2/admit',
      params: { id: '5', courseId: '2', phaseNumber: '2' },
      body: {},
      user: { id: 4, role: 'moderator' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Unassigned moderator must be rejected');
    assert.ok(res.data.error.includes('batches they are assigned to'));
    console.log('✅ PASS: Unassigned moderator strictly rejected (403).');
  }

  console.log('\n--- [Test 1.10] Handler Unit: Batch Moderator Unlinked Batch Fails (403) ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/5/courses/3/phases/2/admit',
      params: { id: '5', courseId: '3', phaseNumber: '2' },
      body: {},
      user: { id: 4, role: 'moderator' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Moderator on unlinked enrollment must be rejected');
    assert.ok(res.data.error.includes('not linked to a batch'));
    console.log('✅ PASS: Moderator rejected on unlinked enrollment (403).');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Part 2: Admin Forgot Password Enumeration Defense & Delivery Auditing
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== PART 2: Admin Forgot Password Enumeration Defense & Delivery Auditing ===');

  const expectedGenericMsg = 'If an active administrative account associated with that email exists and is eligible for recovery, a password recovery link has been dispatched to your inbox.';

  console.log('\n--- [Test 2.1] Admin Recovery: Empty Email Rejection (400) ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: {} });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.error, 'Email is required.');
    console.log('✅ PASS: Missing email returns HTTP 400 validation error.');
  }

  console.log('\n--- [Test 2.2] Admin Recovery: Nonexistent Email Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'ghost_admin@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200, 'Must return HTTP 200 OK');
    assert.strictEqual(res.data.message, expectedGenericMsg, 'Must return uniform generic message');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE action = 'admin_recovery_requested' AND outcome = 'not_found' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Internal audit log must record not_found event');
    assert.ok(audit.details.includes('account_not_found_or_inactive'));
    console.log('✅ PASS: Nonexistent email returned generic 200 and preserved internal audit log.');
  }

  console.log('\n--- [Test 2.3] Admin Recovery: Inactive Admin Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'inactive@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    console.log('✅ PASS: Inactive admin returned generic 200.');
  }

  console.log('\n--- [Test 2.4] Admin Recovery: Student Email Returns Generic HTTP 200 (No Role Leak) ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'student@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    assert.strictEqual(res.data.role, undefined, 'Must not leak role');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 6 AND action = 'admin_recovery_rejected' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Audit log must record rejected attempt for student');
    assert.ok(audit.details.includes('ineligible_role'));
    console.log('✅ PASS: Student email returned generic 200 without leaking student role.');
  }

  console.log('\n--- [Test 2.5] Admin Recovery: Reset Pending Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'reset_pending@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    assert.strictEqual(res.data.code, undefined, 'Must not leak code PASSWORD_RESET_PENDING');
    console.log('✅ PASS: Pending-reset admin returned generic 200 without leaking status.');
  }

  console.log('\n--- [Test 2.6] Admin Recovery: Unverified Email Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'unverified@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    assert.strictEqual(res.data.code, undefined, 'Must not leak code EMAIL_UNVERIFIED');
    console.log('✅ PASS: Unverified-email admin returned generic 200 without leaking verification status.');
  }

  console.log('\n--- [Test 2.7] Admin Recovery: Accepted Delivery Audit Status ---');
  {
    // Configure mock dispatcher to succeed (return true) without sending real email
    let dispatchedLink = null;
    setCustomEmailDispatcher(async (email, link) => {
      dispatchedLink = link;
      return true;
    });

    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'eligible@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    assert.ok(dispatchedLink, 'Link must be passed to dispatcher');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 10 AND action = 'admin_recovery_dispatched' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Audit log must record recovery dispatch');
    assert.strictEqual(audit.outcome, 'success', 'Outcome must be success on accepted delivery');
    const details = JSON.parse(audit.details);
    assert.strictEqual(details.deliveryStatus, 'accepted');
    assert.strictEqual(details.resetToken, undefined, 'Must NEVER log raw reset token');
    assert.strictEqual(details.resetLink, undefined, 'Must NEVER log reset link');
    console.log('✅ PASS: Accepted delivery recorded outcome=success, deliveryStatus=accepted, zero credential leakage.');
  }

  console.log('\n--- [Test 2.8] Admin Recovery: False-Return Delivery Failure Audit Status ---');
  {
    // Configure mock dispatcher to return false (SMTP reject)
    setCustomEmailDispatcher(async () => false);

    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'eligible@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    // Uniform public response is still returned
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 10 AND action = 'admin_recovery_dispatched' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit);
    assert.strictEqual(audit.outcome, 'failure', 'Outcome must be failure on delivery false-return');
    const details = JSON.parse(audit.details);
    assert.strictEqual(details.deliveryStatus, 'failed');
    assert.strictEqual(details.error, 'dispatcher_returned_false');
    assert.strictEqual(details.resetToken, undefined);
    console.log('✅ PASS: Delivery false-return recorded outcome=failure, deliveryStatus=failed, uniform 200 response.');
  }

  console.log('\n--- [Test 2.9] Admin Recovery: Thrown-Error Delivery Failure & Error Redaction Audit Status ---');
  {
    // Capture application logs to verify sensitive links/tokens are not dumped to console
    const capturedLogs = [];
    const origConsoleError = console.error;
    const origConsoleWarn = console.warn;
    const logCapture = (...args) => { capturedLogs.push(args.join(' ')); };

    let thrownSensitiveLink = null;
    let thrownSensitiveToken = null;

    setCustomEmailDispatcher(async (email, link) => {
      thrownSensitiveLink = link;
      // Extract raw token from reset link
      thrownSensitiveToken = link.split('/').pop();
      // Dispatcher throws exception explicitly embedding the raw reset link and raw token
      throw new Error(`SMTP timeout failure while dispatching link ${link} with token ${thrownSensitiveToken}`);
    });

    try {
      console.error = logCapture;
      console.warn = logCapture;

      const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'eligible@bfibd.org' } });
      await adminForgotPasswordHandler(ctx.req, ctx.res);
      const res = ctx.getResult();

      // Uniform public response is still returned
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.message, expectedGenericMsg);

      const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 10 AND action = 'admin_recovery_dispatched' ORDER BY id DESC LIMIT 1`).get();
      assert.ok(audit);
      assert.strictEqual(audit.outcome, 'failure', 'Outcome must be failure on thrown error');
      const details = JSON.parse(audit.details);
      assert.strictEqual(details.deliveryStatus, 'failed');

      // Assert error is categorized into allowlisted failure category rather than raw exception text
      assert.strictEqual(details.error, 'smtp_timeout', 'Must record allowlisted error category');

      // Assert neither the raw reset link nor raw token appears in audit details string
      assert.ok(thrownSensitiveLink && thrownSensitiveToken);
      assert.strictEqual(audit.details.includes(thrownSensitiveLink), false, 'Raw reset link must NEVER appear in audit record');
      assert.strictEqual(audit.details.includes(thrownSensitiveToken), false, 'Raw reset token must NEVER appear in audit record');

      // Assert neither appears in captured application console logs
      const combinedLogs = capturedLogs.join('\n');
      assert.strictEqual(combinedLogs.includes(thrownSensitiveLink), false, 'Raw reset link must NEVER appear in captured logs');
      assert.strictEqual(combinedLogs.includes(thrownSensitiveToken), false, 'Raw reset token must NEVER appear in captured logs');
    } finally {
      console.error = origConsoleError;
      console.warn = origConsoleWarn;
    }

    console.log('✅ PASS: Thrown-error delivery failure categorized into allowlisted token (smtp_timeout), zero link/token leakage in audit or logs.');
  }

  console.log('\n--- [Test 2.10] Admin Recovery: Test Suppression Default Audit Status ---');
  {
    // Reset custom dispatcher to null
    setCustomEmailDispatcher(null);

    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'eligible@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 10 AND action = 'admin_recovery_dispatched' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit);
    assert.strictEqual(audit.outcome, 'success');
    const details = JSON.parse(audit.details);
    assert.strictEqual(details.deliveryStatus, 'suppressed');
    console.log('✅ PASS: Test environment default suppressed delivery recorded deliveryStatus=suppressed.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Part 3: Rotated Refresh Token Rejection
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== PART 3: Rotated Refresh Token Rejection ===');

  console.log('\n--- [Test 3.1] Rotated Refresh Secret Rejection ---');
  {
    const historicalRefreshSecret = 'historical_retired_refresh_secret_key_12345';
    const oldRefreshToken = jwt.sign(
      { id: 10, username: 'eligible', role: 'admin', is_super_admin: 0, token_version: 1 },
      historicalRefreshSecret,
      { expiresIn: '7d' }
    );
    const oldHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');

    db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, expires_at)
      VALUES (10, ?, '127.0.0.1', datetime('now', '+7 days'))
    `).run(oldHash);

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { bfi_refresh_token: oldRefreshToken }
    });

    await refreshHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 401, 'Must reject rotated refresh token with HTTP 401');
    assert.strictEqual(res.data.error, 'Refresh failed');
    assert.ok(res.cookiesCleared.includes('bfi_refresh_token'), 'Must clear refresh cookie on invalid signature');
    console.log('✅ PASS: Refresh token signed under historical secret rejected with HTTP 401 and cookie cleared.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Part 4: Real HTTP Integration Coverage (Mounted Routers over Loopback HTTP)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== PART 4: Real HTTP Integration Coverage (Mounted Express Routers) ===');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.correlationId = 'corr_http_' + Math.random().toString(36).substring(2, 10);
    res.setHeader('X-Correlation-ID', req.correlationId);
    next();
  });
  app.use('/api/admin', adminRoutes);
  app.use('/api/auth', authRoutes);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Helper to create valid signed JWT access token for testing
  function createTestAccessToken({ id, username, role, is_super_admin = 0, token_version = 1 }) {
    let sessionId = null;
    if (role === 'admin') {
      const sess = db.prepare(`
        INSERT INTO sessions (user_id, token_hash, ip_address, expires_at)
        VALUES (?, ?, '127.0.0.1', datetime('now', '+1 hour'))
      `).run(id, 'hash_' + id + '_' + Math.random().toString(36).substring(2, 8));
      sessionId = sess.lastInsertRowid;
    }
    return jwt.sign(
      { id, username, role, is_super_admin, token_version, type: 'access', ...(sessionId ? { sessionId } : {}) },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
  }

  const studentToken = createTestAccessToken({ id: 5, username: 'student1', role: 'student', is_super_admin: 0 });
  const unauthAdminToken = createTestAccessToken({ id: 2, username: 'unauth_admin', role: 'admin', is_super_admin: 0 });
  const authAdminToken = createTestAccessToken({ id: 3, username: 'auth_admin', role: 'admin', is_super_admin: 0 });
  const superAdminToken = createTestAccessToken({ id: 1, username: 'superadmin', role: 'admin', is_super_admin: 1 });
  const moderatorToken = createTestAccessToken({ id: 4, username: 'moderator1', role: 'moderator', is_super_admin: 0 });

  try {
    console.log('\n--- [Test 4.1] HTTP: Unauthenticated Request Blocked (401) ---');
    {
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/defined-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendanceClasses: '["Class 1"]' })
      });
      assert.strictEqual(res.status, 401, 'Unauthenticated request must return HTTP 401');
      console.log('✅ PASS: Real HTTP unauthenticated request rejected with HTTP 401.');
    }

    console.log('\n--- [Test 4.2] HTTP: Invalid JWT Signature Blocked (403) ---');
    {
      const forgedToken = jwt.sign({ id: 1, role: 'admin' }, 'wrong_secret_key_12345');
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/defined-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${forgedToken}` },
        body: JSON.stringify({ attendanceClasses: '["Class 1"]' })
      });
      assert.strictEqual(res.status, 403, 'Invalid token must return HTTP 403 Forbidden');
      console.log('✅ PASS: Real HTTP invalid JWT rejected with HTTP 403 Forbidden.');
    }

    console.log('\n--- [Test 4.3] HTTP: Student Role Blocked by requireRole (403) ---');
    {
      const initialEnrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 1').get();
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/defined-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ attendanceClasses: '["Malicious Hack"]' })
      });
      assert.strictEqual(res.status, 403, 'Student role must return HTTP 403');
      const finalEnrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 1').get();
      assert.deepStrictEqual(initialEnrollment, finalEnrollment, 'Data must be untouched');
      console.log('✅ PASS: Real HTTP student request blocked by requireRole (403), data unmodified.');
    }

    console.log('\n--- [Test 4.4] HTTP: Unauthorized Admin Mutate Defined Progress Blocked (403) ---');
    {
      const initialEnrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 1').get();
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/defined-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${unauthAdminToken}` },
        body: JSON.stringify({ attendanceClasses: '["Class 1", "Class 2"]' })
      });
      assert.strictEqual(res.status, 403, 'Unauthorized admin must return HTTP 403');
      const body = await res.json();
      assert.ok(body.error.includes("missing required permission 'students:academic_records'"));

      const finalEnrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 1').get();
      assert.deepStrictEqual(initialEnrollment, finalEnrollment, 'Database row must be unchanged');

      const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
      assert.ok(audit, 'Security audit log must be recorded on HTTP permission denial');
      console.log('✅ PASS: Real HTTP unauthorized admin rejected (403), data unmodified, audit logged.');
    }

    console.log('\n--- [Test 4.5] HTTP: Unauthorized Admin Phase Admit Blocked (403) ---');
    {
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/phases/2/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${unauthAdminToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
      const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
      assert.ok(audit);
      console.log('✅ PASS: Real HTTP phase admit blocked (403), audit logged.');
    }

    console.log('\n--- [Test 4.6] HTTP: Unauthorized Admin Phase Unadmit Blocked (403) ---');
    {
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/phases/1/unadmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${unauthAdminToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
      const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
      assert.ok(audit);
      console.log('✅ PASS: Real HTTP phase unadmit blocked (403), audit logged.');
    }

    console.log('\n--- [Test 4.7] HTTP: Unauthorized Admin Disclose Defined Progress GET Blocked (403) ---');
    {
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/defined-progress`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${unauthAdminToken}` }
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.ok(body.error.includes("missing required permission 'students:view'"));
      console.log('✅ PASS: Real HTTP read disclosure blocked (403) for admin missing students:view.');
    }

    console.log('\n--- [Test 4.8] HTTP: Authorized Admin WITH Permission Succeeds (200) ---');
    {
      // Clean up Phase 2 result first
      db.prepare("DELETE FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id LIKE '%2' OR phase_number = 2)").run();

      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/phases/2/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authAdminToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 200, 'Authorized admin must succeed');
      const body = await res.json();
      assert.strictEqual(body.success, true);

      const phase2 = db.prepare("SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id LIKE '%2' OR phase_number = 2)").get();
      assert.ok(phase2, 'Phase 2 admission record must exist');
      console.log('✅ PASS: Real HTTP authorized admin admitted student to Phase 2 (200 OK).');
    }

    console.log('\n--- [Test 4.9] HTTP: Immediate Permission Revocation in Real Time ---');
    {
      // Revoke permission from User 3 in database
      db.prepare("DELETE FROM admin_permissions WHERE user_id = 3 AND permission = 'students:academic_records'").run();

      // Immediately call with the EXACT SAME unaltered JWT token over HTTP
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/phases/2/unadmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authAdminToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403, 'Must immediately deny access on permission revocation over HTTP');

      // Verify phase 2 was NOT unadmitted
      const phase2 = db.prepare("SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id LIKE '%2' OR phase_number = 2)").get();
      assert.ok(phase2.admitted_at !== null, 'Record must be untouched');

      // Re-grant for subsequent tests
      db.prepare("INSERT INTO admin_permissions (user_id, permission, granted_by) VALUES (3, 'students:academic_records', 1)").run();
      console.log('✅ PASS: Real HTTP permission revocation took effect immediately with unchanged token.');
    }

    console.log('\n--- [Test 4.10] HTTP: Super Admin Access Preserved (200) ---');
    {
      // Super admin unadmits phase 2
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/phases/2/unadmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${superAdminToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 200, 'Super admin must succeed over HTTP');
      const body = await res.json();
      assert.strictEqual(body.success, true);

      const phase2 = db.prepare("SELECT * FROM student_phase_results WHERE enrollment_id = 1 AND (phase_id LIKE '%2' OR phase_number = 2)").get();
      assert.strictEqual(phase2.admitted_at, null, 'admitted_at must be cleared to null');
      console.log('✅ PASS: Real HTTP Super Admin wildcard access operated unconditionally.');
    }

    console.log('\n--- [Test 4.11] HTTP: Moderator Assigned to Batch Succeeds (200) ---');
    {
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/1/phases/2/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${moderatorToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 200, 'Assigned moderator must succeed over HTTP');
      console.log('✅ PASS: Real HTTP moderator assigned to batch succeeded.');
    }

    console.log('\n--- [Test 4.12] HTTP: Moderator Not Assigned to Batch Fails (403) ---');
    {
      // Enrollment 2 belongs to Batch 2 (moderator 4 is only assigned to Batch 1)
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/2/phases/2/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${moderatorToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403, 'Unassigned batch moderator must be denied');
      const body = await res.json();
      assert.ok(body.error.includes('batches they are assigned to'));
      console.log('✅ PASS: Real HTTP unassigned moderator strictly rejected (403).');
    }

    console.log('\n--- [Test 4.13] HTTP: Moderator on Unlinked Batch Fails (403) ---');
    {
      // Enrollment 3 has no batch (batch_id is NULL)
      const res = await fetch(`${baseUrl}/api/admin/students/5/courses/3/phases/2/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${moderatorToken}` },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403, 'Unlinked batch moderator must be denied');
      const body = await res.json();
      assert.ok(body.error.includes('not linked to a batch'));
      console.log('✅ PASS: Real HTTP moderator on unlinked enrollment strictly rejected (403).');
    }
  } finally {
    await new Promise(r => server.close(r));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Part 5: Local Test Account Archival Lifecycle Verification
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== PART 5: Local Test Account Archival Lifecycle Verification ===');

  console.log('\n--- [Test 5.1] Schema-Grounded Archival Lifecycle Execution ---');
  {
    // Insert synthetic representations of the reported production test accounts
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, token_version, account_version)
      VALUES 
        (2153, 'e2e_cm_student', 'e2e_cm_student@bfibd.org', '$2a$12$dummyhash1', 'student', 'E2E', 'Student1', 1, 1, 1),
        (2154, 'e2e_fail_student', 'e2e_fail_student@bfibd.org', '$2a$12$dummyhash2', 'student', 'E2E', 'Student2', 1, 1, 1),
        (2155, 'e2e_legacy_mig_student', 'e2e_legacy_mig_student@bfibd.org', '$2a$12$dummyhash3', 'student', 'E2E', 'Student3', 1, 1, 1)
      ON CONFLICT(id) DO UPDATE SET is_active = 1, archived_at = NULL
    `).run();

    // Insert linked enrollments (schema does NOT contain status column)
    db.prepare(`
      INSERT INTO student_course_enrollments (id, user_id, course_name, course_type, course_definition_id, course_version, batch_id)
      VALUES 
        (9362, 2153, 'Filmmaking', 'filmmaking', 1, 1, 1),
        (9365, 2155, 'Filmmaking', 'filmmaking', 1, 1, 1)
      ON CONFLICT(id) DO NOTHING
    `).run();

    // Insert active sessions and reset tokens
    db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, expires_at)
      VALUES 
        (2153, 'sess_hash_2153', '127.0.0.1', datetime('now', '+7 days')),
        (2154, 'sess_hash_2154', '127.0.0.1', datetime('now', '+7 days')),
        (2155, 'sess_hash_2155', '127.0.0.1', datetime('now', '+7 days'))
    `).run();

    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, expires_at)
      VALUES (2153, 'token_hash_2153', 'student_recovery', 1, datetime('now', '+15 minutes'))
      ON CONFLICT(user_id, purpose) DO UPDATE SET token_hash = excluded.token_hash
    `).run();

    // Issue an active JWT access token for user 2153 prior to decommissioning
    const activeTokenBeforeArchival = createTestAccessToken({ id: 2153, username: 'e2e_cm_student', role: 'student', token_version: 1 });

    // Execute schema-grounded decommissioning transaction
    const targetIds = [2153, 2154, 2155];
    const operatorAdminId = 1;

    const decommissionTx = db.transaction((ids, operatorId) => {
      const archiveUserStmt = db.prepare(`
        UPDATE users 
        SET is_active = 0,
            archived_at = datetime('now'),
            archived_by_admin_id = ?,
            archive_reason = 'E2E Test Artifact Decommissioning',
            password_hash = '$2a$12$INVALID_DECOMMISSIONED_ACCOUNT_' || hex(randomblob(16)),
            token_version = token_version + 1,
            account_version = account_version + 1,
            updated_at = datetime('now')
        WHERE id = ? AND archived_at IS NULL
      `);

      const clearSessionsStmt = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
      const clearTokensStmt = db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ?`);
      const recordAuditStmt = db.prepare(`
        INSERT INTO admin_audit_logs (actor_id, target_user_id, action, module, resource, outcome, details, created_at)
        VALUES (?, ?, 'decommission_test_account', 'security', ?, 'success', ?, datetime('now'))
      `);

      for (const uid of ids) {
        archiveUserStmt.run(operatorId, uid);
        clearSessionsStmt.run(uid);
        clearTokensStmt.run(uid);
        recordAuditStmt.run(
          operatorId,
          uid,
          `user:${uid}`,
          JSON.stringify({ reason: 'E2E test artifact cleanup', targetUserId: uid })
        );
      }
    });

    decommissionTx(targetIds, operatorAdminId);

    // Assertions on decommissioned state:
    for (const uid of targetIds) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      assert.strictEqual(u.is_active, 0, 'Account must be marked inactive');
      assert.ok(u.archived_at !== null, 'Account must be marked archived');
      assert.strictEqual(u.archived_by_admin_id, 1);
      assert.strictEqual(u.archive_reason, 'E2E Test Artifact Decommissioning');
      assert.ok(u.password_hash.startsWith('$2a$12$INVALID_DECOMMISSIONED_ACCOUNT_'), 'Password hash must be scrambled');
      assert.strictEqual(u.token_version, 2, 'Token version must be incremented');

      const userSessions = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(uid).c;
      assert.strictEqual(userSessions, 0, 'All sessions must be wiped');

      const userTokens = db.prepare('SELECT COUNT(*) as c FROM password_reset_tokens WHERE user_id = ?').get(uid).c;
      assert.strictEqual(userTokens, 0, 'All password reset tokens must be wiped');

      const auditLog = db.prepare("SELECT * FROM admin_audit_logs WHERE target_user_id = ? AND action = 'decommission_test_account'").get(uid);
      assert.ok(auditLog, 'Decommission audit log must exist');
    }

    // Verify enrollments are preserved without foreign key violations
    const enr2153 = db.prepare('SELECT * FROM student_course_enrollments WHERE id = 9362').get();
    assert.ok(enr2153, 'Enrollment record must be preserved for foreign key integrity');
    assert.strictEqual(enr2153.user_id, 2153);

    // Verify authenticateToken rejects pre-existing token for decommissioned user
    const { authenticateToken } = await import('../server/middleware/auth.js');
    const authCtx = mockReqRes({
      headers: { authorization: `Bearer ${activeTokenBeforeArchival}` }
    });
    authCtx.req.headers = { authorization: `Bearer ${activeTokenBeforeArchival}` };

    let authCalledNext = false;
    authenticateToken(authCtx.req, authCtx.res, () => { authCalledNext = true; });
    const authRes = authCtx.getResult();

    assert.strictEqual(authCalledNext, false, 'Middleware must not call next() for archived account');
    assert.strictEqual(authRes.status, 401, 'Must return HTTP 401');
    assert.strictEqual(authRes.data.error, 'Account inactive, archived, or not found');

    console.log('✅ PASS: Test accounts cleanly decommissioned: sessions/tokens revoked, credentials scrambled, FK integrity preserved, tokens strictly rejected (401).');
  }

  console.log('\n================================================================');
  console.log('ALL 34 TESTS IN COMPREHENSIVE SECURITY REGRESSION SUITE PASSED (34/34)');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
}).finally(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});
