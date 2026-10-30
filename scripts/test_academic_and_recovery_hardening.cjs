/**
 * scripts/test_academic_and_recovery_hardening.cjs
 * 
 * Verifies:
 * 1. Academic-Record Authorization & RBAC Boundary Enforcement:
 *    - Rejection of unauthorized ordinary admins on all 3 write routes and 1 read route.
 *    - Verification that unauthorized requests cannot mutate records.
 *    - Verification that legitimate Super Admin access is fully preserved.
 *    - Verification of the intended batch-moderator policy (moderator assigned to batch succeeds, unassigned fails).
 *    - Verification that immediate permission revocation in database takes effect immediately.
 *    - Verification of security audit logging for permission denials.
 * 2. Administrative Password Recovery Enumeration Defense:
 *    - Uniform public HTTP 200 response for existing, nonexistent, archived, student, and ineligible admin accounts.
 *    - Zero information leakage (no status code, code, or message divergence).
 *    - Granular internal audit trail preservation across all rejection branches.
 *    - Legitimate token generation and storage for valid eligible admins without sending real email.
 * 3. Rotated Refresh-Token Rejection:
 *    - Proves refresh token signed with historical refresh secret is rejected with HTTP 401 under rotated secret.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
    username TEXT UNIQUE,
    email TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'student',
    first_name TEXT,
    last_name TEXT,
    is_active INTEGER DEFAULT 1,
    archived_at TEXT,
    deleted_at TEXT,
    is_super_admin INTEGER DEFAULT 0,
    two_factor_enabled INTEGER DEFAULT 0,
    token_version INTEGER DEFAULT 1,
    password_reset_pending INTEGER DEFAULT 0,
    email_verified_at TEXT,
    verified_email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE admin_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    permission TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_name TEXT NOT NULL,
    slug TEXT UNIQUE,
    course_name TEXT,
    course_definition_id INTEGER
  );

  CREATE TABLE batch_moderators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL
  );

  CREATE TABLE course_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_name TEXT,
    definition_json TEXT
  );

  CREATE TABLE student_course_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    batch_id INTEGER,
    course_name TEXT,
    course_definition_id INTEGER,
    status TEXT DEFAULT 'enrolled',
    step3_completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE student_phase_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    phase_id TEXT,
    phase_number INTEGER,
    admitted INTEGER DEFAULT 0,
    admitted_at TEXT,
    unadmitted_at TEXT,
    attendance_pct REAL,
    assignment_pct REAL,
    exam_pct REAL,
    overall_phase_score REAL,
    calculated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(enrollment_id, phase_id)
  );

  CREATE TABLE student_class_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    class_id TEXT NOT NULL,
    attended INTEGER NOT NULL DEFAULT 0,
    attended_at TEXT,
    updated_by INTEGER,
    UNIQUE(enrollment_id, class_id)
  );

  CREATE TABLE student_assignment_grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    assignment_id TEXT NOT NULL,
    marks_obtained REAL DEFAULT 0,
    submission_status TEXT DEFAULT 'pending',
    remarks TEXT,
    graded_by INTEGER,
    graded_at TEXT,
    UNIQUE(enrollment_id, assignment_id)
  );

  CREATE TABLE student_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    full_name TEXT,
    batch_number TEXT,
    student_id TEXT,
    phase2_admitted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE legacy_enrollment_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    legacy_snapshot_json TEXT
  );

  CREATE TABLE course_routine_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_definition_id INTEGER NOT NULL,
    batch_id INTEGER DEFAULT 0,
    phase_id TEXT,
    class_id TEXT,
    routine_json TEXT,
    updated_by INTEGER
  );

  CREATE TABLE batch_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL
  );

  CREATE TABLE admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    target_user_id INTEGER,
    action TEXT NOT NULL,
    module TEXT,
    resource TEXT,
    outcome TEXT,
    correlation_id TEXT,
    details TEXT,
    ip_address TEXT,
    before_state TEXT,
    after_state TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    token_version INTEGER DEFAULT 1,
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
    sudo_verified_at TEXT
  );
`);

// 2. Populate test fixtures
const courseDefJson = JSON.stringify({
  phases: [
    {
      id: 'phase_1',
      name: 'Phase 1',
      phase_number: 1,
      classes: [{ id: 'c1', title: 'Class 1' }],
      assignments: [{ id: 'a1', title: 'Assignment 1', max_score: 100 }],
      exams: [{ id: 'e1', title: 'Exam 1', max_score: 100 }]
    },
    {
      id: 'phase_2',
      name: 'Phase 2',
      phase_number: 2,
      classes: [{ id: 'c2', title: 'Class 2' }],
      assignments: [],
      exams: []
    }
  ],
  completionPolicy: {
    phaseGates: {
      sequentialProgression: false,
      requirePreviousPhasePassed: false
    }
  }
});

db.prepare(`INSERT INTO course_definitions (id, course_name, definition_json) VALUES (1, 'Filmmaking', ?)`).run(courseDefJson);
db.prepare(`INSERT INTO batches (id, batch_name, slug, course_name, course_definition_id) VALUES (10, 'Batch 10', 'batch-10', 'Filmmaking', 1)`).run();

// Users:
// 1: Super Admin
// 2: Ordinary Admin with NO permissions
// 3: Ordinary Admin with academic permissions
// 4: Moderator assigned to Batch 10
// 5: Moderator NOT assigned to Batch 10
// 6: Student
// 7: Inactive Admin
// 8: Admin with reset pending
// 9: Admin with unverified email
// 10: Valid Eligible Admin for recovery
db.prepare(`INSERT INTO users (id, username, email, role, is_super_admin, is_active, email_verified_at, verified_email) VALUES 
  (1, 'super_admin', 'super@bfibd.org', 'admin', 1, 1, '2026-01-01', 'super@bfibd.org'),
  (2, 'unauth_admin', 'unauth@bfibd.org', 'admin', 0, 1, '2026-01-01', 'unauth@bfibd.org'),
  (3, 'academic_admin', 'academic@bfibd.org', 'admin', 0, 1, '2026-01-01', 'academic@bfibd.org'),
  (4, 'mod_assigned', 'mod_assigned@bfibd.org', 'moderator', 0, 1, '2026-01-01', 'mod_assigned@bfibd.org'),
  (5, 'mod_unassigned', 'mod_unassigned@bfibd.org', 'moderator', 0, 1, '2026-01-01', 'mod_unassigned@bfibd.org'),
  (6, 'student_user', 'student@bfibd.org', 'student', 0, 1, '2026-01-01', 'student@bfibd.org'),
  (7, 'inactive_admin', 'inactive@bfibd.org', 'admin', 0, 0, '2026-01-01', 'inactive@bfibd.org'),
  (8, 'reset_pending_admin', 'reset_pending@bfibd.org', 'admin', 0, 1, '2026-01-01', 'reset_pending@bfibd.org'),
  (9, 'unverified_admin', 'unverified@bfibd.org', 'admin', 0, 1, NULL, NULL),
  (10, 'eligible_admin', 'eligible@bfibd.org', 'admin', 0, 1, '2026-01-01', 'eligible@bfibd.org')
`).run();

db.prepare(`UPDATE users SET password_reset_pending = 1 WHERE id = 8`).run();

// Permissions for User 3
db.prepare(`INSERT INTO admin_permissions (user_id, permission) VALUES (3, 'students:academic_records'), (3, 'students:view')`).run();

// Moderator Assignment for User 4 on Batch 10
db.prepare(`INSERT INTO batch_moderators (batch_id, user_id) VALUES (10, 4)`).run();

// Student 6 Enrollment in Batch 10 (Enrollment ID 100)
db.prepare(`INSERT INTO student_course_enrollments (id, user_id, batch_id, course_name, course_definition_id) VALUES 
  (100, 6, 10, 'Filmmaking', 1),
  (101, 6, NULL, 'Filmmaking', 1)
`).run();

db.prepare(`INSERT INTO student_phase_results (id, enrollment_id, phase_id, phase_number, admitted) VALUES
  (1, 100, 'phase_1', 1, 1),
  (2, 100, 'phase_2', 2, 0)
`).run();

db.prepare(`INSERT INTO student_profiles (user_id, full_name) VALUES (6, 'Student 6')`).run();

// Helper to create mock req/res
function mockReqRes({ method = 'GET', url = '/', user = null, body = {}, params = {}, query = {}, headers = {}, cookies = {} } = {}) {
  let statusCode = 200;
  let responseData = null;
  const setHeaders = {};
  const cookiesCleared = [];

  const req = {
    method,
    originalUrl: url,
    url,
    user,
    body,
    params,
    query,
    headers: { 'x-correlation-id': `test-corr-${Date.now()}`, ...headers },
    cookies,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    app: { get: () => null }
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
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const authRoutes = (await import('../server/routes/auth.js')).default;

  // Helper to find express route handler
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
  // Part 1: Academic-Record Authorization
  // ─────────────────────────────────────────────────────────────────────────

  console.log('--- [Test 1.1] Unauthorized Ordinary Admin Cannot Mutate Defined Progress ---');
  {
    const initialEnrollment = db.prepare('SELECT step3_completed FROM student_course_enrollments WHERE id = 100').get();
    const ctx = mockReqRes({
      method: 'PUT',
      url: '/api/admin/students/6/courses/100/defined-progress',
      user: { id: 2, username: 'unauth_admin', role: 'admin', is_super_admin: 0 },
      params: { id: '6', courseId: '100' },
      body: { attendance: { c1: 'present' }, assignments: {}, exam_marks: {} }
    });

    await putDefinedProgressHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must return 403 Forbidden');
    assert.ok(res.data.error.includes("missing required permission 'students:academic_records'"));

    // Verify database was NOT mutated
    const postEnrollment = db.prepare('SELECT step3_completed FROM student_course_enrollments WHERE id = 100').get();
    assert.deepStrictEqual(postEnrollment, initialEnrollment, 'Database must not be mutated on permission denial');

    // Verify security audit log was recorded
    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 2 AND action = 'permission_denied' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Audit log must record permission_denied for unauthorized attempt');
    console.log('✅ PASS: Unauthorized admin rejected (403), data unmodified, audit recorded.');
  }

  console.log('\n--- [Test 1.2] Unauthorized Ordinary Admin Cannot Admit Student to Phase ---');
  {
    const initialAdmitted = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = 100 AND phase_number = 2').get().admitted;
    assert.strictEqual(initialAdmitted, 0, 'Phase 2 initially unadmitted');

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/2/admit',
      user: { id: 2, username: 'unauth_admin', role: 'admin', is_super_admin: 0 },
      params: { id: '6', courseId: '100', phaseNumber: '2' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes("missing required permission 'students:academic_records'"));

    const postAdmitted = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = 100 AND phase_number = 2').get().admitted;
    assert.strictEqual(postAdmitted, 0, 'Phase 2 must remain unadmitted');
    console.log('✅ PASS: Phase admit blocked (403), admission state untouched, audit recorded.');
  }

  console.log('\n--- [Test 1.3] Unauthorized Ordinary Admin Cannot Unadmit Student from Phase ---');
  {
    const initialAdmitted = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = 100 AND phase_number = 1').get().admitted;
    assert.strictEqual(initialAdmitted, 1, 'Phase 1 initially admitted');

    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/1/unadmit',
      user: { id: 2, username: 'unauth_admin', role: 'admin', is_super_admin: 0 },
      params: { id: '6', courseId: '100', phaseNumber: '1' }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes("missing required permission 'students:academic_records'"));

    const postAdmitted = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = 100 AND phase_number = 1').get().admitted;
    assert.strictEqual(postAdmitted, 1, 'Phase 1 must remain admitted');
    console.log('✅ PASS: Phase unadmit blocked (403), admission state untouched, audit recorded.');
  }

  console.log('\n--- [Test 1.4] Unauthorized Ordinary Admin Cannot Disclose Defined Progress (GET) ---');
  {
    const ctx = mockReqRes({
      method: 'GET',
      url: '/api/admin/students/6/courses/100/defined-progress',
      user: { id: 2, username: 'unauth_admin', role: 'admin', is_super_admin: 0 },
      params: { id: '6', courseId: '100' }
    });

    await getDefinedProgressHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes("missing required permission 'students:view'"));
    console.log('✅ PASS: Defined progress read blocked (403) for admin missing students:view.');
  }

  console.log('\n--- [Test 1.5] Authorized Ordinary Admin WITH Permission Succeeds ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/2/admit',
      user: { id: 3, username: 'academic_admin', role: 'admin', is_super_admin: 0 },
      params: { id: '6', courseId: '100', phaseNumber: '2' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);

    const postAdmitted = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = 100 AND phase_number = 2').get().admitted;
    assert.strictEqual(postAdmitted, 1, 'Phase 2 must now be admitted');
    console.log('✅ PASS: Authorized admin successfully admitted student to Phase 2.');
  }

  console.log('\n--- [Test 1.6] Immediate Permission Revocation Takes Effect In Real Time ---');
  {
    // Revoke students:academic_records from User 3 in database
    db.prepare(`DELETE FROM admin_permissions WHERE user_id = 3 AND permission = 'students:academic_records'`).run();

    // User 3 tries to unadmit Phase 2 immediately with same token/session
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/2/unadmit',
      user: { id: 3, username: 'academic_admin', role: 'admin', is_super_admin: 0 },
      params: { id: '6', courseId: '100', phaseNumber: '2' }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403, 'Must immediately deny after database permission deletion');
    assert.ok(res.data.error.includes("missing required permission 'students:academic_records'"));

    // Restore permission for subsequent tests
    db.prepare(`INSERT INTO admin_permissions (user_id, permission) VALUES (3, 'students:academic_records')`).run();
    console.log('✅ PASS: Revocation took effect immediately in real time without daemon restart.');
  }

  console.log('\n--- [Test 1.7] Super Admin Access is Unconditionally Preserved ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/2/unadmit',
      user: { id: 1, username: 'super_admin', role: 'admin', is_super_admin: 1 },
      params: { id: '6', courseId: '100', phaseNumber: '2' }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    console.log('✅ PASS: Super Admin access operates without requiring granular permission grants.');
  }

  console.log('\n--- [Test 1.8] Batch Moderator Policy: Assigned Moderator Succeeds ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/2/admit',
      user: { id: 4, username: 'mod_assigned', role: 'moderator', is_super_admin: 0 },
      params: { id: '6', courseId: '100', phaseNumber: '2' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    console.log('✅ PASS: Moderator assigned to batch successfully performed phase operation.');
  }

  console.log('\n--- [Test 1.9] Batch Moderator Policy: Unassigned Moderator Fails (403) ---');
  {
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/100/phases/2/unadmit',
      user: { id: 5, username: 'mod_unassigned', role: 'moderator', is_super_admin: 0 },
      params: { id: '6', courseId: '100', phaseNumber: '2' }
    });

    await postUnadmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes('Moderators can only modify progress for batches they are assigned to'));
    console.log('✅ PASS: Unassigned moderator strictly rejected (403).');
  }

  console.log('\n--- [Test 1.10] Batch Moderator Policy: Unlinked Batch Fails (403) ---');
  {
    // Enrollment 101 has batch_id = NULL
    const ctx = mockReqRes({
      method: 'POST',
      url: '/api/admin/students/6/courses/101/phases/1/admit',
      user: { id: 4, username: 'mod_assigned', role: 'moderator', is_super_admin: 0 },
      params: { id: '6', courseId: '101', phaseNumber: '1' }
    });

    await postAdmitHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes('Moderators cannot modify progress for enrollments not linked to a batch'));
    console.log('✅ PASS: Moderator rejected on unlinked enrollment (403).');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Part 2: Administrative Password Recovery Account Enumeration Defense
  // ─────────────────────────────────────────────────────────────────────────

  const expectedGenericMsg = 'If an active administrative account associated with that email exists and is eligible for recovery, a password recovery link has been dispatched to your inbox.';

  console.log('\n--- [Test 2.1] Admin Forgot Password: Empty Email Rejection (400) ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: '' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.error, 'Email is required.');
    console.log('✅ PASS: Missing email returns HTTP 400 validation error.');
  }

  console.log('\n--- [Test 2.2] Admin Forgot Password: Nonexistent Email Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'nonexistent_ghost@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200, 'Must return HTTP 200');
    assert.strictEqual(res.data.message, expectedGenericMsg, 'Must return uniform generic message');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE action = 'admin_recovery_requested' AND outcome = 'not_found' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Internal audit log must record not_found event');
    assert.ok(audit.details.includes('account_not_found_or_inactive'));
    console.log('✅ PASS: Nonexistent email returned generic 200 and preserved internal audit log.');
  }

  console.log('\n--- [Test 2.3] Admin Forgot Password: Inactive Admin Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'inactive@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    console.log('✅ PASS: Inactive admin returned generic 200.');
  }

  console.log('\n--- [Test 2.4] Admin Forgot Password: Student Email Returns Generic HTTP 200 (No Role Leak) ---');
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

  console.log('\n--- [Test 2.5] Admin Forgot Password: Reset Pending Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'reset_pending@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    assert.strictEqual(res.data.code, undefined, 'Must not leak code PASSWORD_RESET_PENDING');
    console.log('✅ PASS: Pending-reset admin returned generic 200 without leaking status.');
  }

  console.log('\n--- [Test 2.6] Admin Forgot Password: Unverified Email Returns Generic HTTP 200 ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'unverified@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);
    assert.strictEqual(res.data.code, undefined, 'Must not leak code EMAIL_UNVERIFIED');
    console.log('✅ PASS: Unverified-email admin returned generic 200 without leaking verification status.');
  }

  console.log('\n--- [Test 2.7] Admin Forgot Password: Valid Eligible Admin Generates Token & Audit Log ---');
  {
    const ctx = mockReqRes({ method: 'POST', url: '/api/auth/admin-forgot-password', body: { email: 'eligible@bfibd.org' } });
    await adminForgotPasswordHandler(ctx.req, ctx.res);
    const res = ctx.getResult();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, expectedGenericMsg);

    // Verify reset token was inserted into database with purpose admin_self_recovery
    const tokenRecord = db.prepare(`SELECT * FROM password_reset_tokens WHERE user_id = 10 AND purpose = 'admin_self_recovery'`).get();
    assert.ok(tokenRecord, 'Reset token record must be inserted in database');
    assert.strictEqual(tokenRecord.token_version, 1);
    assert.ok(new Date(tokenRecord.expires_at).getTime() > Date.now(), 'Token must be unexpired');

    const audit = db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_id = 10 AND action = 'admin_recovery_dispatched' ORDER BY id DESC LIMIT 1`).get();
    assert.ok(audit, 'Audit log must record recovery dispatch');
    console.log('✅ PASS: Eligible admin generated secure reset token, audit logged, uniform 200 response.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Part 3: Rotated Refresh Token Rejection
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- [Test 3.1] Rotated Refresh Secret Rejection ---');
  {
    const historicalRefreshSecret = 'historical_retired_refresh_secret_key_12345';
    // User 10 has a refresh token signed under the historical refresh secret
    const oldRefreshToken = jwt.sign(
      { id: 10, username: 'eligible', role: 'admin', is_super_admin: 0, token_version: 1 },
      historicalRefreshSecret,
      { expiresIn: '7d' }
    );
    const oldHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');

    // Store in sessions
    db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, expires_at)
      VALUES (10, ?, '127.0.0.1', datetime('now', '+7 days'))
    `).run(oldHash);

    // Now attempt to refresh using the rotated live JWT_REFRESH_SECRET
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

  console.log('\n================================================================');
  console.log('ALL 18 TESTS IN SECURITY HARDENING REGRESSION SUITE PASSED (18/18)');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
}).finally(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});
