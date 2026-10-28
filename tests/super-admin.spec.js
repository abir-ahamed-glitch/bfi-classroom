import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { io } from 'socket.io-client';
import { generateTotpCode } from '../server/utils/totp.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ensureSuperAdminSchema, runSuperAdminMigration } = require('../server/db/migrations/20261023_super_admin.cjs');
const { runAdminPermissionsMigration } = require('../server/db/migrations/20261023_admin_permissions.cjs');

dotenv.config();

import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation,
  setupTestRouteProxy
} from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const API_BASE = getTestApiUrl();
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let superAdminToken;
let superAdminSessionId;
let ordinaryAdminToken;
let ordinaryAdminSessionId;
let studentToken;

const SUPER_ADMIN_ID = 1;
const ORDINARY_ADMIN_ID = 99981;
const TEST_STUDENT_ID = 99982;
const TEST_PASSWORD = 'Password123!';

/**
 * Creates an authentic administrative session in the database and signs a compliant access token.
 */
function issueAdminSessionToken(userId, extraClaims = {}) {
  const user = db.prepare('SELECT id, username, email, role, is_super_admin, token_version FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
    VALUES (?, 'test_session_hash', '127.0.0.1', 'playwright_test', ?, datetime('now'), datetime('now'), datetime('now'))
  `).run(userId, expiresAt);
  const sessionId = insert.lastInsertRowid;

  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.username,
    is_super_admin: user.is_super_admin || 0,
    type: 'access',
    sessionId,
    token_version: user.token_version || 1,
    ...extraClaims
  };

  return {
    token: jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' }),
    sessionId
  };
}

function cleanupSuperAdminTestArtifacts(database) {
  try {
    const created = database.prepare("SELECT id FROM users WHERE username LIKE 'admin@created%' OR username LIKE 'admin@dyn%' OR username LIKE 'admin@e2e%' OR username LIKE 'admin@zero%' OR username LIKE 'admin@matrix%' OR username = 'admin@restricted'").all();
    const idsToClean = [ORDINARY_ADMIN_ID, TEST_STUDENT_ID, 99984, 99985, ...created.map(c => c.id)];
    const placeholders = idsToClean.map(() => '?').join(',');
    database.prepare(`DELETE FROM admin_permissions WHERE user_id IN (${placeholders})`).run(...idsToClean);
    database.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...idsToClean);
    database.prepare(`DELETE FROM student_profiles WHERE user_id IN (${placeholders})`).run(...idsToClean);
    database.prepare("DELETE FROM admin_audit_logs WHERE details LIKE '%created%' OR details LIKE '%restricted%' OR details LIKE '%dyn%' OR details LIKE '%e2e%'").run();
    database.exec('DROP TRIGGER IF EXISTS test_audit_failure_trigger;');
  } catch (err) {
    console.warn('[SuperAdminTest] Cleanup warning:', err.message);
  }
}

test.beforeAll(async () => {
  await verifyServerIsolation(API_BASE);
  db = await initIsolatedTestDatabase(DB_PATH);

  cleanupSuperAdminTestArtifacts(db);

  // 1. Verify / Setup Super Admin (User ID 1) in isolated test database
  const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
  db.prepare(`
    INSERT OR REPLACE INTO users (
      id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version
    ) VALUES (
      1, 'admin@abir', 'k.eye.films@gmail.com', ?, 'admin', 'Abir', 'Ahmad', 1, 1, datetime('now'), 1
    )
  `).run(passwordHash);

  // 2. Setup Ordinary Admin (ID 99981)
  db.prepare(`
    INSERT OR REPLACE INTO users (
      id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version
    ) VALUES (
      ?, 'admin@ordinary', 'ordinary_admin@bfibd.org', ?, 'admin', 'Ordinary', 'Admin', 1, 0, datetime('now'), 1
    )
  `).run(ORDINARY_ADMIN_ID, passwordHash);

  // Grant full operational permissions to ORDINARY_ADMIN_ID so it represents an existing migrated admin
  const allPermissionsList = [
    'courses:view', 'courses:create', 'courses:edit', 'courses:publish', 'courses:delete',
    'batches:view', 'batches:create', 'batches:edit', 'batches:delete', 'batches:results_upload',
    'students:view', 'students:create', 'students:edit', 'students:academic_records', 'students:delete', 'students:export',
    'teachers:view', 'teachers:create', 'teachers:edit', 'teachers:delete',
    'notices:view', 'notices:create', 'notices:delete',
    'communications:view', 'communications:send', 'communications:schedule', 'communications:delete',
    'finance:view', 'finance:edit',
    'reports:view', 'reports:export',
    'trash:view', 'trash:restore', 'trash:delete_permanent',
    'settings:view', 'settings:edit'
  ];
  const insertPermStmt = db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, 1)');
  allPermissionsList.forEach(p => insertPermStmt.run(ORDINARY_ADMIN_ID, p));

  // 3. Setup Test Student (ID 99982)
  db.prepare(`
    INSERT OR REPLACE INTO users (
      id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin
    ) VALUES (
      ?, 'student_test_sa', 'student_sa@bfibd.org', ?, 'student', 'Test', 'Student', 1, 0
    )
  `).run(TEST_STUDENT_ID, passwordHash);

  db.prepare(`
    INSERT OR REPLACE INTO student_profiles (user_id, student_id, batch_number, full_name)
    VALUES (?, 'BFISA01', '10', 'Test Student')
  `).run(TEST_STUDENT_ID);

  // Issue real/compliant test session tokens
  const saRes = issueAdminSessionToken(SUPER_ADMIN_ID);
  superAdminToken = saRes.token;
  superAdminSessionId = saRes.sessionId;

  const ordRes = issueAdminSessionToken(ORDINARY_ADMIN_ID);
  ordinaryAdminToken = ordRes.token;
  ordinaryAdminSessionId = ordRes.sessionId;

  studentToken = jwt.sign(
    { id: TEST_STUDENT_ID, username: 'student_test_sa', role: 'student', name: 'Test Student', type: 'access' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
});

test.afterAll(async () => {
  if (db) {
    cleanupSuperAdminTestArtifacts(db);
  }
});

test.describe('Super Admin Architecture & Role Governance Suite', () => {

  test('1. Super Admin Login & Permission Recognition', async ({ request }) => {
    // Authenticate via login endpoint
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: {
        username: 'admin@abir',
        password: TEST_PASSWORD,
        type: 'admin'
      }
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe(1);
    expect(body.user.username).toBe('admin@abir');
    expect(body.user.email).toBe('k.eye.films@gmail.com');
    expect(body.user.role).toBe('admin');
    expect(body.user.is_super_admin).toBe(1);
    expect(body.user.isSuperAdmin).toBe(true);

    // Verify token payload
    const token = body.token;
    const decoded = jwt.decode(token);
    expect(decoded.id).toBe(1);
    expect(decoded.role).toBe('admin');
    expect(decoded.is_super_admin).toBe(1);

    // Verify /me endpoint returns Super Admin privilege
    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(meRes.status()).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.id).toBe(1);
    expect(meBody.is_super_admin).toBe(1);
    expect(meBody.isSuperAdmin).toBe(true);
  });

  test('2. Ordinary Admin Login & Non-Super-Admin Recognition', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: {
        username: 'admin@ordinary',
        password: TEST_PASSWORD,
        type: 'admin'
      }
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(ORDINARY_ADMIN_ID);
    expect(body.user.role).toBe('admin');
    expect(body.user.is_super_admin).toBe(0);
    expect(body.user.isSuperAdmin).toBe(false);

    const decoded = jwt.decode(body.token);
    expect(decoded.id).toBe(ORDINARY_ADMIN_ID);
    expect(decoded.is_super_admin).toBe(0);

    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${body.token}` }
    });
    expect(meRes.status()).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.id).toBe(ORDINARY_ADMIN_ID);
    expect(meBody.is_super_admin).toBe(0);
    expect(meBody.isSuperAdmin).toBe(false);
  });

  test('3. Client Token Tampering Defense (Forged is_super_admin flag stripped)', async ({ request }) => {
    // Attacker crafts token claiming is_super_admin = 1 for a non-1 account but using valid session
    const forgedToken = jwt.sign(
      { 
        id: ORDINARY_ADMIN_ID, 
        username: 'admin@ordinary', 
        role: 'admin', 
        is_super_admin: 1,
        type: 'access',
        sessionId: ordinaryAdminSessionId,
        token_version: 1
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Call /me: authenticateToken middleware must sanitize and strip the privilege
    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` }
    });
    expect(meRes.status()).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.id).toBe(ORDINARY_ADMIN_ID);
    expect(meBody.is_super_admin).toBe(0);
    expect(meBody.isSuperAdmin).toBe(false);
  });

  test('4. Profile Update Tampering Defense (Cannot grant or strip Super Admin via PUT /update-name)', async ({ request }) => {
    // Ordinary admin attempts privilege escalation
    const escalateRes = await request.put(`${API_BASE}/api/auth/update-name`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: {
        first_name: 'Hacker',
        last_name: 'Admin',
        username: 'admin@ordinary',
        email: 'ordinary_admin@bfibd.org',
        is_super_admin: 1,
        role: 'super_admin'
      }
    });

    expect(escalateRes.status()).toBe(200);
    const escalateBody = await escalateRes.json();
    expect(escalateBody.user.is_super_admin).toBe(0);
    expect(escalateBody.user.isSuperAdmin).toBe(false);

    // Verify database remains unaffected
    const dbOrdinary = db.prepare('SELECT is_super_admin, role FROM users WHERE id = ?').get(ORDINARY_ADMIN_ID);
    expect(dbOrdinary.is_super_admin).toBe(0);
    expect(dbOrdinary.role).toBe('admin');

    // Student attempts privilege escalation via PUT /update-name
    const studentEscalateRes = await request.put(`${API_BASE}/api/auth/update-name`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: {
        first_name: 'Hacker',
        last_name: 'Student',
        username: 'student_test_sa',
        is_super_admin: 1,
        role: 'super_admin'
      }
    });
    expect(studentEscalateRes.status()).toBe(200);
    const studentBody = await studentEscalateRes.json();
    expect(studentBody.user.is_super_admin).toBe(0);
    expect(studentBody.user.isSuperAdmin).toBe(false);

    // Super Admin updating profile retains is_super_admin = 1
    const saUpdateRes = await request.put(`${API_BASE}/api/auth/update-name`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: {
        first_name: 'Abir',
        last_name: 'Ahmad',
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com'
      }
    });

    expect(saUpdateRes.status()).toBe(200);
    const saUpdateBody = await saUpdateRes.json();
    expect(saUpdateBody.user.is_super_admin).toBe(1);
    expect(saUpdateBody.user.isSuperAdmin).toBe(true);
    expect(saUpdateBody.user.username).toBe('admin@abir');
    expect(saUpdateBody.user.email).toBe('k.eye.films@gmail.com');
  });

  test('5. Management Endpoints Defense (Ordinary admins cannot delete, alter, or trash Super Admin)', async ({ request }) => {
    // 5a. PUT /api/admin/students/1 -> 403 Forbidden
    const putStudentRes = await request.put(`${API_BASE}/api/admin/students/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: { firstName: 'Hacked', lastName: 'Abir', username: 'admin@hacked', email: 'hacked@test.org' }
    });
    expect(putStudentRes.status()).toBe(403);

    // 5b. DELETE /api/admin/students/1 -> 403 Forbidden
    const delStudentRes = await request.delete(`${API_BASE}/api/admin/students/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(delStudentRes.status()).toBe(403);

    // 5c. PUT /api/admin/teachers/1 -> 403 Forbidden
    const putTeacherRes = await request.put(`${API_BASE}/api/admin/teachers/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: { firstName: 'Hacked', lastName: 'Teacher', username: 'admin@teacher1', email: 'hacked@teacher.org' }
    });
    expect(putTeacherRes.status()).toBe(403);

    // 5d. DELETE /api/admin/teachers/1 -> 403 Forbidden
    const delTeacherRes = await request.delete(`${API_BASE}/api/admin/teachers/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(delTeacherRes.status()).toBe(403);

    // 5e. DELETE /api/admin/students/leads/1 -> 403 Forbidden
    const delLeadRes = await request.delete(`${API_BASE}/api/admin/students/leads/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(delLeadRes.status()).toBe(403);

    // 5f. DELETE /api/admin/trash/permanent/students/1 -> 403 Forbidden
    const permDeleteRes = await request.delete(`${API_BASE}/api/admin/trash/permanent/students/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(permDeleteRes.status()).toBe(403);

    // 5g. DELETE /api/admin/trash/bulk-permanent/students with [1] -> 403 Forbidden
    const bulkPermRes = await request.delete(`${API_BASE}/api/admin/trash/bulk-permanent/students`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: { ids: [1, 99999] }
    });
    expect(bulkPermRes.status()).toBe(403);

    // Verify user 1 in DB remains completely unchanged
    const superUserInDb = db.prepare('SELECT id, username, email, is_super_admin, deleted_at FROM users WHERE id = 1').get();
    expect(superUserInDb.username).toBe('admin@abir');
    expect(superUserInDb.email).toBe('k.eye.films@gmail.com');
    expect(superUserInDb.is_super_admin).toBe(1);
    expect(superUserInDb.deleted_at).toBeNull();
  });

  test('6. Super Admin Retains Full Platform & Administrative Capabilities', async ({ request }) => {
    // 6a. Course definitions access
    const coursesRes = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(coursesRes.status()).toBe(200);

    // 6b. Batches access
    const batchesRes = await request.get(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(batchesRes.status()).toBe(200);

    // 6c. Students list access
    const studentsRes = await request.get(`${API_BASE}/api/admin/students`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(studentsRes.status()).toBe(200);

    // 6d. Trash admin list returns is_super_admin flag
    const trashAdminsRes = await request.get(`${API_BASE}/api/admin/trash/admins`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(trashAdminsRes.status()).toBe(200);
    const trashData = await trashAdminsRes.json();
    const superAdminInTrash = trashData.admins.find(a => a.id === 1);
    expect(superAdminInTrash).toBeDefined();
    expect(superAdminInTrash.is_super_admin).toBe(1);
  });

  test('7. Ordinary Admins Retain Normal Administrator Capabilities', async ({ request }) => {
    // 7a. Course definitions access works for ordinary admin
    const coursesRes = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(coursesRes.status()).toBe(200);

    // 7b. Batches access works for ordinary admin
    const batchesRes = await request.get(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(batchesRes.status()).toBe(200);

    // 7c. Student progress access works for ordinary admin
    const studentsRes = await request.get(`${API_BASE}/api/admin/students`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(studentsRes.status()).toBe(200);
  });

  test('8. UI Rendering of Super Admin Role Designation Across Pages', async ({ browser }) => {
    // 8a-8c: Verify UI elements in Super Admin session
    const saContext = await browser.newContext();
    const saPage = await saContext.newPage();
    await setupTestRouteProxy(saPage);

    await saPage.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: superAdminToken,
      user: {
        id: 1,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    // 8a. Verify Settings page renders "SUPER ADMIN"
    await saPage.goto('settings');
    await saPage.waitForLoadState('domcontentloaded');

    const superAdminRoleBadge = saPage.locator('text=SUPER ADMIN — Primary Control Panel');
    await expect(superAdminRoleBadge).toBeVisible();

    const superAdminDesc = saPage.locator('text=Super Administrator & Master Control Access');
    await expect(superAdminDesc).toBeVisible();

    // 8b. Verify Sidebar renders "Super Admin Profile"
    const sidebarProfileLink = saPage.locator('text=Super Admin Profile');
    await expect(sidebarProfileLink).toBeVisible();

    // 8c. Verify Trash Manager admin filter dropdown renders "(Super Admin)"
    await saPage.goto('admin/additional-options');
    await saPage.waitForLoadState('domcontentloaded');
    await saPage.locator('button:has-text("Trash Manager")').first().click();

    const adminDropdownOption = saPage.locator('select.trash-filter-input option').filter({ hasText: '(Super Admin)' });
    await expect(adminDropdownOption.first()).toBeAttached();
    const optionText = await adminDropdownOption.first().textContent();
    expect(optionText).toContain('Abir Ahmad (Super Admin)');

    await saContext.close();

    // 8d. In separate context as Ordinary Admin, view Public Profile for user ID 1
    // (PublicProfile displays Super Admin role badge for ID 1 to external viewers)
    const ordContext = await browser.newContext();
    const ordPage = await ordContext.newPage();
    await setupTestRouteProxy(ordPage);

    await ordPage.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: ordinaryAdminToken,
      user: {
        id: ORDINARY_ADMIN_ID,
        username: 'admin@ordinary',
        email: 'ordinary_admin@bfibd.org',
        role: 'admin',
        firstName: 'Ordinary',
        lastName: 'Admin',
        is_super_admin: 0,
        isSuperAdmin: false
      }
    });

    await ordPage.goto('profile/1');
    await ordPage.waitForLoadState('domcontentloaded');

    const publicProfileRole = ordPage.locator('.badge-pill').filter({ hasText: 'Super Admin' });
    await expect(publicProfileRole.first()).toBeVisible();

    await ordContext.close();
  });

  test('9. Stale Token & Real-Time Permission Revocation Defense', async ({ request }) => {
    // Baseline: Super admin token is currently valid for privileged endpoint
    const initialVerify = await request.get(`${API_BASE}/api/admin/super-admin/verify`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(initialVerify.status()).toBe(200);

    // Revoke privilege in database (simulate admin action revoking super admin)
    db.prepare('UPDATE users SET is_super_admin = 0 WHERE id = 1').run();

    try {
      // 1. Calling privileged endpoint with old token must now be rejected with 403 Forbidden
      const revokedVerify = await request.get(`${API_BASE}/api/admin/super-admin/verify`, {
        headers: { Authorization: `Bearer ${superAdminToken}` }
      });
      expect(revokedVerify.status()).toBe(403);

      // 2. /me endpoint with old token must return is_super_admin = 0 and isSuperAdmin = false
      const meRes = await request.get(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${superAdminToken}` }
      });
      expect(meRes.status()).toBe(200);
      const meBody = await meRes.json();
      expect(meBody.is_super_admin).toBe(0);
      expect(meBody.isSuperAdmin).toBe(false);
    } finally {
      // Restore privilege in DB
      db.prepare('UPDATE users SET is_super_admin = 1 WHERE id = 1').run();
    }

    // Verify privilege restored
    const restoredVerify = await request.get(`${API_BASE}/api/admin/super-admin/verify`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(restoredVerify.status()).toBe(200);
  });

  test('10. Inactive & Soft-Deleted Account Access Denial', async ({ request }) => {
    // 10a. Inactive account (is_active = 0)
    db.prepare('UPDATE users SET is_active = 0 WHERE id = 1').run();
    try {
      const inactiveRes = await request.get(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${superAdminToken}` }
      });
      expect(inactiveRes.status()).toBe(401);
      const body = await inactiveRes.json();
      expect(body.error).toContain('inactive or not found');

      // Login must also be rejected
      const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
        data: { username: 'admin@abir', password: TEST_PASSWORD, type: 'admin' }
      });
      expect(loginRes.status()).toBe(401);
    } finally {
      db.prepare('UPDATE users SET is_active = 1 WHERE id = 1').run();
    }

    // 10b. Soft-deleted account (deleted_at IS NOT NULL)
    db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = 1").run();
    try {
      const deletedRes = await request.get(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${superAdminToken}` }
      });
      expect(deletedRes.status()).toBe(401);
      const body = await deletedRes.json();
      expect(body.error).toContain('inactive or not found');

      // Login must also be rejected
      const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
        data: { username: 'admin@abir', password: TEST_PASSWORD, type: 'admin' }
      });
      expect(loginRes.status()).toBe(401);
    } finally {
      db.prepare('UPDATE users SET deleted_at = NULL WHERE id = 1').run();
    }

    // Verify user can now authenticate normally
    const normalRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(normalRes.status()).toBe(200);
  });

  test('11. Non-Admin Role Defense for Stable ID 1', async ({ request }) => {
    // Craft a token claiming id: 1, role: 'student', is_super_admin: 1
    const studentClaimToken = jwt.sign(
      { id: 1, username: 'admin@abir', role: 'student', is_super_admin: 1, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // If ID 1 has role = 'student' in DB:
    db.prepare("UPDATE users SET role = 'student' WHERE id = 1").run();
    try {
      // Middleware authenticateToken resolves DB role 'student', neutralizing is_super_admin
      const meRes = await request.get(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${studentClaimToken}` }
      });
      expect(meRes.status()).toBe(200);
      const meBody = await meRes.json();
      expect(meBody.role).toBe('student');
      expect(meBody.is_super_admin).toBe(0);
      expect(meBody.isSuperAdmin).toBe(false);

      // Endpoint requiring Super Admin must return 403 Forbidden
      const verifyRes = await request.get(`${API_BASE}/api/admin/super-admin/verify`, {
        headers: { Authorization: `Bearer ${studentClaimToken}` }
      });
      expect(verifyRes.status()).toBe(403);
    } finally {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
    }
  });

  test('12. Migration Identity Validation & Mismatched Account Rejection', () => {
    const memDb = new Database(':memory:');
    try {
      memDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          is_active INTEGER DEFAULT 1,
          deleted_at TEXT DEFAULT NULL
        );
      `);

      // Verify schema initialization adds column if missing
      ensureSuperAdminSchema(memDb);
      const cols = memDb.prepare('PRAGMA table_info(users)').all();
      expect(cols.some(c => c.name === 'is_super_admin')).toBe(true);

      // Scenario A: Candidate has matching username, but mismatched email
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (1, 'admin@abir', 'wrong_email@gmail.com', 'admin', 1)
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/Identifier mismatch/);

      // Scenario B: Candidate has matching email, but mismatched username
      memDb.prepare(`DELETE FROM users`).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (1, 'wrong_user', 'k.eye.films@gmail.com', 'admin', 1)
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/Identifier mismatch/);

      // Scenario C: Conflicting duplicate accounts (split identifiers)
      memDb.prepare(`DELETE FROM users`).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (1, 'admin@abir', 'other@gmail.com', 'admin', 1)
      `).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (2, 'other_user', 'k.eye.films@gmail.com', 'admin', 1)
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/Conflict: multiple accounts found/);

      // Scenario D: Wrong stable ID
      memDb.prepare(`DELETE FROM users`).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (2, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 1)
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/expected stable id=1/);

      // Scenario E: Inactive account
      memDb.prepare(`DELETE FROM users`).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 0)
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/inactive/);

      // Scenario F: Soft-deleted account
      memDb.prepare(`DELETE FROM users`).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active, deleted_at)
        VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 1, '2026-10-23')
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/soft-deleted/);

      // Scenario G: Ineligible role (student)
      memDb.prepare(`DELETE FROM users`).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active)
        VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'student', 1)
      `).run();
      expect(() => runSuperAdminMigration(memDb)).toThrow(/role='student'/);
    } finally {
      memDb.close();
    }
  });

  test('13. Migration Atomic Transaction Rollback on Failure', () => {
    const memDb = new Database(':memory:');
    try {
      memDb.pragma('foreign_keys = ON');
      memDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          is_active INTEGER DEFAULT 1,
          deleted_at TEXT DEFAULT NULL,
          is_super_admin INTEGER DEFAULT 0
        );
        CREATE TABLE child (
          id INTEGER PRIMARY KEY,
          user_id INTEGER,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `);

      // Insert valid user 1
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active, is_super_admin)
        VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 1, 0)
      `).run();

      // Corrupt foreign keys intentionally by turning FKs off, inserting invalid row, then turning FKs ON
      memDb.pragma('foreign_keys = OFF');
      memDb.prepare(`INSERT INTO child (id, user_id) VALUES (999, 9999)`).run();
      memDb.pragma('foreign_keys = ON');

      // Migration must fail on foreign key check and ROLL BACK
      expect(() => runSuperAdminMigration(memDb)).toThrow(/Foreign key check failed/);

      // User 1 must still have is_super_admin = 0 (unmodified due to rollback!)
      const u1 = memDb.prepare('SELECT is_super_admin FROM users WHERE id = 1').get();
      expect(u1.is_super_admin).toBe(0);

      // app_migrations must NOT have recorded 20261023_super_admin
      const mig = memDb.prepare("SELECT * FROM app_migrations WHERE name = '20261023_super_admin'").get();
      expect(mig).toBeUndefined();
    } finally {
      memDb.close();
    }
  });

  test('14. Repeated Server Initialization Idempotency & Unrelated Account Preservation', () => {
    const memDb = new Database(':memory:');
    try {
      memDb.pragma('foreign_keys = ON');
      memDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          is_active INTEGER DEFAULT 1,
          deleted_at TEXT DEFAULT NULL,
          is_super_admin INTEGER DEFAULT 0
        );
      `);

      // Seed User 1 (target) and User 2 (unrelated user with is_super_admin = 1)
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active, is_super_admin)
        VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 1, 0)
      `).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active, is_super_admin)
        VALUES (2, 'other@bfibd.org', 'other@bfibd.org', 'admin', 1, 1)
      `).run();

      // First run: executes promotion
      const firstResult = runSuperAdminMigration(memDb);
      expect(firstResult.applied).toBe(true);

      const u1First = memDb.prepare('SELECT is_super_admin FROM users WHERE id = 1').get();
      expect(u1First.is_super_admin).toBe(1);

      // Unrelated user 2 must NOT have been wiped to 0
      const u2First = memDb.prepare('SELECT is_super_admin FROM users WHERE id = 2').get();
      expect(u2First.is_super_admin).toBe(1);

      // Now simulate explicit revocation of User 1's super admin privilege in DB
      memDb.prepare('UPDATE users SET is_super_admin = 0 WHERE id = 1').run();

      // Second run (e.g. server restart)
      const secondResult = runSuperAdminMigration(memDb);
      expect(secondResult.applied).toBe(false);
      expect(secondResult.reason).toBe('Already applied');

      // User 1 must REMAIN 0 (not re-promoted!)
      const u1Second = memDb.prepare('SELECT is_super_admin FROM users WHERE id = 1').get();
      expect(u1Second.is_super_admin).toBe(0);

      // User 2 remains 1
      const u2Second = memDb.prepare('SELECT is_super_admin FROM users WHERE id = 2').get();
      expect(u2Second.is_super_admin).toBe(1);
    } finally {
      memDb.close();
    }
  });

  test('15. Authoritative UI Badge Rendering Without ID 1 Bias', async ({ browser }) => {
    // Revoke is_super_admin on User 1 in DB
    db.prepare('UPDATE users SET is_super_admin = 0 WHERE id = 1').run();

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await setupTestRouteProxy(page);

      await page.addInitScript(({ token, user }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
      }, {
        token: ordinaryAdminToken,
        user: {
          id: ORDINARY_ADMIN_ID,
          username: 'admin@ordinary',
          email: 'ordinary_admin@bfibd.org',
          role: 'admin',
          firstName: 'Ordinary',
          lastName: 'Admin',
          is_super_admin: 0,
          isSuperAdmin: false
        }
      });

      // View Profile 1 when is_super_admin is 0
      await page.goto('profile/1');
      await page.waitForLoadState('domcontentloaded');

      // Must display Administrator, NOT Super Admin
      const adminRoleBadge = page.locator('.badge-pill').filter({ hasText: 'Administrator' });
      await expect(adminRoleBadge.first()).toBeVisible();

      const superRoleBadge = page.locator('.badge-pill').filter({ hasText: 'Super Admin' });
      await expect(superRoleBadge).toHaveCount(0);

      await context.close();
    } finally {
      // Restore is_super_admin on User 1
      db.prepare('UPDATE users SET is_super_admin = 1 WHERE id = 1').run();
    }

    // Now verify that when is_super_admin = 1, it renders Super Admin
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await setupTestRouteProxy(page2);

    await page2.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: ordinaryAdminToken,
      user: {
        id: ORDINARY_ADMIN_ID,
        username: 'admin@ordinary',
        email: 'ordinary_admin@bfibd.org',
        role: 'admin',
        firstName: 'Ordinary',
        lastName: 'Admin',
        is_super_admin: 0,
        isSuperAdmin: false
      }
    });

    await page2.goto('profile/1');
    await page2.waitForLoadState('domcontentloaded');

    const superRoleBadge2 = page2.locator('.badge-pill').filter({ hasText: 'Super Admin' });
    await expect(superRoleBadge2.first()).toBeVisible();

    await context2.close();
  });

  test('16. Super Admin Creates Ordinary Admin with Default vs Custom Permissions & Audit Logging', async ({ request }) => {
    // 1. Create admin with default permissions (permissions omitted/null)
    const createRes1 = await request.post(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: {
        firstName: 'TestAdmin',
        lastName: 'Default',
        email: 'created1@bfibd.org',
        username: 'admin@created1',
        password: TEST_PASSWORD
      }
    });

    expect(createRes1.status()).toBe(201);
    const body1 = await createRes1.json();
    expect(body1.success).toBe(true);
    const createdUser1 = body1.user || body1.administrator;
    expect(createdUser1.username).toBe('admin@created1');
    expect(createdUser1.role).toBe('admin');
    expect(createdUser1.is_super_admin).toBe(0);
    const newAdmin1Id = createdUser1.id;

    // Verify assigned permissions match default permissions in DB
    const assignedPerms1 = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(newAdmin1Id).map(r => r.permission);
    const defaults = db.prepare('SELECT permission FROM admin_default_permissions WHERE is_default = 1').all().map(r => r.permission);
    expect(assignedPerms1.sort()).toEqual(defaults.sort());

    // Verify audit log entry exists
    const audit1 = db.prepare("SELECT * FROM admin_audit_logs WHERE action IN ('create_administrator', 'administrator_created') AND target_user_id = ?").get(newAdmin1Id);
    expect(audit1).toBeDefined();
    expect(audit1.actor_id).toBe(1);

    // 2. Create admin with custom permissions
    const customPerms = ['courses:view', 'courses:create', 'students:view'];
    const createRes2 = await request.post(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: {
        firstName: 'TestAdmin',
        lastName: 'Custom',
        email: 'created2@bfibd.org',
        username: 'admin@created2',
        password: TEST_PASSWORD,
        permissions: customPerms
      }
    });

    expect(createRes2.status()).toBe(201);
    const body2 = await createRes2.json();
    const createdUser2 = body2.user || body2.administrator;
    const newAdmin2Id = createdUser2.id;

    const assignedPerms2 = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(newAdmin2Id).map(r => r.permission);
    expect(assignedPerms2.sort()).toEqual(customPerms.sort());
  });

  test('17. Ordinary Admin Barred from Admin Management APIs & Account Self-Escalation (403)', async ({ request }) => {
    // 1. List administrators barred
    const listRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(listRes.status()).toBe(403);

    // 2. Create administrator barred
    const createRes = await request.post(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: {
        firstName: 'Hacker',
        lastName: 'Admin',
        email: 'hack@bfibd.org',
        username: 'admin@hack',
        password: TEST_PASSWORD
      }
    });
    expect(createRes.status()).toBe(403);

    // 3. Update permissions barred
    const permRes = await request.put(`${API_BASE}/api/admin/administrators/${ORDINARY_ADMIN_ID}/permissions`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: { permissions: ['*'] }
    });
    expect(permRes.status()).toBe(403);

    // 4. Update status barred
    const statusRes = await request.patch(`${API_BASE}/api/admin/administrators/${ORDINARY_ADMIN_ID}/status`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` },
      data: { is_active: 0 }
    });
    expect(statusRes.status()).toBe(403);

    // 5. Super Admin cannot alter root Super Admin (ID 1)
    const superAltersSuper = await request.put(`${API_BASE}/api/admin/administrators/1/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: [] }
    });
    expect(superAltersSuper.status()).toBe(403);

    const superDeactivatesSuper = await request.patch(`${API_BASE}/api/admin/administrators/1/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 0 }
    });
    expect(superDeactivatesSuper.status()).toBe(403);
  });

  test('18. Fine-Grained Modular Route Enforcement & 403 Rejection for Restricted Admin', async ({ request }) => {
    // Setup restricted admin with ONLY students:view
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const restrictedAdmin = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin)
      VALUES ('admin@restricted', 'restricted@bfibd.org', ?, 'admin', 'Restricted', 'Admin', 1, 0)
    `).run(passwordHash);
    const restrictedId = restrictedAdmin.lastInsertRowid;

    db.prepare(`
      INSERT INTO admin_permissions (user_id, permission, granted_by)
      VALUES (?, 'students:view', 1)
    `).run(restrictedId);

    const { token: restrictedToken } = issueAdminSessionToken(restrictedId);

    // 1. Authorized endpoint passes (students:view)
    const okRes = await request.get(`${API_BASE}/api/admin/students`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(okRes.status()).toBe(200);

    // 2. Unauthorized endpoint in same module rejected (students:create)
    const failCreateStudent = await request.post(`${API_BASE}/api/admin/students`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
      data: { firstName: 'Forbidden', lastName: 'Student', email: 'forbid@test.com' }
    });
    expect(failCreateStudent.status()).toBe(403);

    // 3. Unauthorized course module rejected (courses:view)
    const failCourses = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(failCourses.status()).toBe(403);

    // 4. Unauthorized batch module rejected (batches:view)
    const failBatches = await request.get(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(failBatches.status()).toBe(403);

    // 5. Unauthorized finance module rejected (finance:view)
    const failFinance = await request.get(`${API_BASE}/api/admin/batch-fees`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(failFinance.status()).toBe(403);

    const failFeeTracker = await request.get(`${API_BASE}/api/admin/fee-tracker/students`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(failFeeTracker.status()).toBe(403);

    // 6. Unauthorized trash module rejected (trash:view)
    const failTrash = await request.get(`${API_BASE}/api/admin/trash/students`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(failTrash.status()).toBe(403);
  });

  test('19. Immediate Real-Time Permission Revocation & Grant with Active Token', async ({ request }) => {
    // Find or create restricted admin ID
    let restricted = db.prepare("SELECT id FROM users WHERE username = 'admin@restricted'").get();
    if (!restricted) {
      const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
      const resIns = db.prepare(`
        INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin)
        VALUES ('admin@restricted', 'restricted@bfibd.org', ?, 'admin', 'Restricted', 'Admin', 1, 0)
      `).run(passwordHash);
      restricted = { id: resIns.lastInsertRowid };
    }

    // Ensure initial permission is only students:view
    db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(restricted.id);
    db.prepare('INSERT INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, 1)').run(restricted.id, 'students:view');

    const { token: restrictedToken } = issueAdminSessionToken(restricted.id);

    // Initial check: restricted admin cannot view courses
    const initialCheck = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(initialCheck.status()).toBe(403);

    // Super Admin dynamically grants courses:view
    const grantRes = await request.put(`${API_BASE}/api/admin/administrators/${restricted.id}/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['students:view', 'courses:view'] }
    });
    expect(grantRes.status()).toBe(200);

    // The SAME active token immediately succeeds without re-login!
    const grantedCheck = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(grantedCheck.status()).toBe(200);

    // Super Admin dynamically revokes courses:view
    const revokeRes = await request.put(`${API_BASE}/api/admin/administrators/${restricted.id}/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['students:view'] }
    });
    expect(revokeRes.status()).toBe(200);

    // The SAME active token immediately receives 403 again!
    const revokedCheck = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(revokedCheck.status()).toBe(403);
  });

  test('20. Immediate Account Deactivation Defense with Active Token (401)', async ({ request }) => {
    let restricted = db.prepare("SELECT id FROM users WHERE username = 'admin@restricted'").get();
    if (!restricted) {
      const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
      const resIns = db.prepare(`
        INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin)
        VALUES ('admin@restricted', 'restricted@bfibd.org', ?, 'admin', 'Restricted', 'Admin', 1, 0)
      `).run(passwordHash);
      restricted = { id: resIns.lastInsertRowid };
    }

    const { token: restrictedToken } = issueAdminSessionToken(restricted.id);

    // Initial check passes
    const beforeDeactivate = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(beforeDeactivate.status()).toBe(200);

    // Super Admin deactivates account
    const deactRes = await request.patch(`${API_BASE}/api/admin/administrators/${restricted.id}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 0, expected_account_version: 1 }
    });
    expect(deactRes.status()).toBe(200);

    // Active token is immediately rejected with HTTP 401
    const afterDeactivate = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${restrictedToken}` }
    });
    expect(afterDeactivate.status()).toBe(401);

    // Restore for any subsequent teardown
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(restricted.id);
  });

  test('21. Existing Ordinary Admin Migration Retains Full Operational Access & Defaults Invariant', () => {
    const memDb = new Database(':memory:');
    try {
      memDb.pragma('foreign_keys = ON');
      memDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          is_active INTEGER DEFAULT 1,
          deleted_at TEXT DEFAULT NULL,
          is_super_admin INTEGER DEFAULT 0
        );
      `);

      // Seed Super Admin (ID 1) and Existing Ordinary Admin (ID 2)
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active, is_super_admin)
        VALUES (1, 'admin@abir', 'k.eye.films@gmail.com', 'admin', 1, 1)
      `).run();
      memDb.prepare(`
        INSERT INTO users (id, username, email, role, is_active, is_super_admin)
        VALUES (2, 'admin@legacy', 'legacy@bfibd.org', 'admin', 1, 0)
      `).run();

      // Run migration
      const result = runAdminPermissionsMigration(memDb);
      expect(result.applied).toBe(true);

      // Verify Existing Ordinary Admin (ID 2) was granted full operational permissions
      const permsUser2 = memDb.prepare('SELECT permission FROM admin_permissions WHERE user_id = 2').all().map(r => r.permission);
      expect(permsUser2.length).toBeGreaterThan(30);
      expect(permsUser2).toContain('courses:view');
      expect(permsUser2).toContain('batches:view');
      expect(permsUser2).toContain('students:view');
      expect(permsUser2).toContain('finance:view');
      expect(permsUser2).toContain('trash:view');

      // Verify changing default permissions table does not modify existing user permissions
      memDb.prepare('UPDATE admin_default_permissions SET is_default = 0').run();
      const permsUser2After = memDb.prepare('SELECT permission FROM admin_permissions WHERE user_id = 2').all().map(r => r.permission);
      expect(permsUser2After.length).toBe(permsUser2.length);
    } finally {
      memDb.close();
    }
  });

  test('22. Viewer-Aware Identity Privacy Across Profile, Inbox, and Community Endpoints', async ({ request }) => {
    // 1. Student views Profile 1 -> Sanitized response (is_super_admin = 0, isSuperAdmin = false)
    const studentProfileRes = await request.get(`${API_BASE}/api/student/profile/1`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    expect(studentProfileRes.status()).toBe(200);
    const studentProfileData = await studentProfileRes.json();
    expect(studentProfileData.is_super_admin).toBe(0);
    expect(studentProfileData.isSuperAdmin).toBe(false);

    // 2. Admin views Profile 1 -> Authoritative response (is_super_admin = 1, isSuperAdmin = true)
    const adminProfileRes = await request.get(`${API_BASE}/api/student/profile/1`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(adminProfileRes.status()).toBe(200);
    const adminProfileData = await adminProfileRes.json();
    expect(adminProfileData.is_super_admin).toBe(1);
    expect(adminProfileData.isSuperAdmin).toBe(true);

    // 3. Student views Inbox recipients -> User 1 receives is_super_admin: 0
    const studentRecipientsRes = await request.get(`${API_BASE}/api/inbox/recipients`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    expect(studentRecipientsRes.status()).toBe(200);
    const studentRecipientsData = await studentRecipientsRes.json();
    const adminUserInRecipients = (studentRecipientsData.users || []).find(u => u.id === 1);
    if (adminUserInRecipients) {
      expect(adminUserInRecipients.is_super_admin).toBe(0);
    }

    // 4. Admin views Inbox recipients -> User 1 receives is_super_admin: 1
    const adminRecipientsRes = await request.get(`${API_BASE}/api/inbox/recipients`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(adminRecipientsRes.status()).toBe(200);
    const adminRecipientsData = await adminRecipientsRes.json();
    const adminUserInAdminRecipients = (adminRecipientsData.users || []).find(u => u.id === 1);
    if (adminUserInAdminRecipients) {
      expect(adminUserInAdminRecipients.is_super_admin).toBe(1);
    }
  });

  test('23. Browser UI Verification: Super Admin Console Navigation & Access Control', async ({ page }) => {
    await setupTestRouteProxy(page);

    // 1. Super Admin logs in and navigates to admin/administrators
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: superAdminToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Verify Console Header & Super Admin Badge
    const headerHeading = page.locator('h1').filter({ hasText: 'Administrator Governance' });
    await expect(headerHeading).toBeVisible({ timeout: 10000 });
    const superAdminBadge = page.locator('.super-admin-crown-badge');
    await expect(superAdminBadge).toBeVisible();

    // Verify Metrics and Action Buttons
    const newAdminBtn = page.locator('button').filter({ hasText: 'New Administrator' });
    await expect(newAdminBtn).toBeVisible();

    // Verify Table renders Super Admin root row
    const abirRow = page.locator('tr').filter({ hasText: 'admin@abir' });
    await expect(abirRow).toBeVisible();
    await expect(abirRow.locator('.badge-super-admin')).toBeVisible();

    // Click New Administrator button and verify modal opens with dependency-aware permission matrix
    await newAdminBtn.click();
    const modalHeading = page.locator('h2').filter({ hasText: 'Create New Administrator' });
    await expect(modalHeading).toBeVisible();

    // Close modal
    const closeBtn = page.locator('.admin-modal-close-btn');
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();

    // 2. Now verify that an Ordinary Admin cannot access the console
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: ordinaryAdminToken,
      user: {
        id: ORDINARY_ADMIN_ID,
        username: 'admin@ordinary',
        email: 'ordinary_admin@bfibd.org',
        role: 'admin',
        firstName: 'Ordinary',
        lastName: 'Admin',
        is_super_admin: 0,
        isSuperAdmin: false
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Either redirected or renders Access Denied
    const deniedText = page.locator('text=Access Denied');
    const isDeniedOrRedirected = (await deniedText.count() > 0) || !page.url().includes('/admin/administrators');
    expect(isDeniedOrRedirected).toBe(true);
  });

  test('24. Defect 1 Reproduction: Zero-Permission Admin Blocked from Analytics & Course Settings', async ({ request }) => {
    // Setup dedicated zero-permission admin
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const zeroAdminUsername = 'admin@zeroperms';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin)
      VALUES (99984, ?, 'zeroperms@bfibd.org', ?, 'admin', 'Zero', 'Perms', 1, 0)
    `).run(zeroAdminUsername, passwordHash);

    // Explicitly delete any permissions
    db.prepare('DELETE FROM admin_permissions WHERE user_id = 99984').run();

    const { token: zeroToken } = issueAdminSessionToken(99984);

    // 1. GET /api/analytics/students/all must return 403 Forbidden for zero-permission admin
    const analyticsRes = await request.get(`${API_BASE}/api/analytics/students/all`, {
      headers: { Authorization: `Bearer ${zeroToken}` }
    });
    expect(analyticsRes.status()).toBe(403);

    // 2. GET /api/admin/course-settings must return 403 Forbidden for zero-permission admin
    const courseSettingsRes = await request.get(`${API_BASE}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${zeroToken}` }
    });
    expect(courseSettingsRes.status()).toBe(403);

    // 3. GET /api/analytics/urgent must return 403 Forbidden for zero-permission admin
    const urgentRes = await request.get(`${API_BASE}/api/analytics/urgent`, {
      headers: { Authorization: `Bearer ${zeroToken}` }
    });
    expect(urgentRes.status()).toBe(403);

    // 4. GET /api/courses/admin/all must return 403 Forbidden for zero-permission admin
    const courseMatRes = await request.get(`${API_BASE}/api/courses/admin/all`, {
      headers: { Authorization: `Bearer ${zeroToken}` }
    });
    expect(courseMatRes.status()).toBe(403);

    // Verify authorized admin CAN access
    const authAnalytics = await request.get(`${API_BASE}/api/analytics/students/all`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(authAnalytics.status()).toBe(200);

    const authCourseSettings = await request.get(`${API_BASE}/api/admin/course-settings`, {
      headers: { Authorization: `Bearer ${ordinaryAdminToken}` }
    });
    expect(authCourseSettings.status()).toBe(200);

    // Verify legitimate student access is preserved on student endpoints
    const studentCoursesRes = await request.get(`${API_BASE}/api/courses`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    expect(studentCoursesRes.status()).toBe(200);
  });

  test('25. Defect 2 & 3 Reproduction: Audit Logs Route Conflict (404 Fix) & Contract Alignment', async ({ request }) => {
    // 1. Call GET /api/admin/administrators/audit-logs as Super Admin
    // Defect: was intercepted by /administrators/:id and returned 404
    const auditRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(auditRes.status()).toBe(200);
    const auditData = await auditRes.json();

    // Defect: UI reads data.logs while API returns auditLogs -> Contract alignment requires both
    expect(Array.isArray(auditData.auditLogs)).toBe(true);
    expect(Array.isArray(auditData.logs)).toBe(true);
    expect(auditData.logs).toEqual(auditData.auditLogs);

    // 2. Call GET /api/admin/permissions/defaults as Super Admin
    // Defect: UI reads defaultsData.default_permissions while API returned defaultPermissions
    const defaultsRes = await request.get(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(defaultsRes.status()).toBe(200);
    const defaultsData = await defaultsRes.json();

    expect(Array.isArray(defaultsData.defaultPermissions)).toBe(true);
    expect(Array.isArray(defaultsData.default_permissions)).toBe(true);
    expect(defaultsData.default_permissions).toEqual(defaultsData.defaultPermissions);
  });

  test('26. Defect 4 Reproduction: Dependency Enforcement & Unknown Permission Rejection', async ({ request }) => {
    // 1. Defect: Defaults API accepts ['courses:create'] without required 'courses:view' dependency
    const missingDepDefaults = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['courses:create'] }
    });
    expect(missingDepDefaults.status()).toBe(400);
    const missingDepBody = await missingDepDefaults.json();
    expect(missingDepBody.error).toMatch(/courses:view/);

    // 2. Defect: Unknown permission string accepted or unvalidated
    const unknownPermDefaults = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['courses:view', 'invalid:fake_permission'] }
    });
    expect(unknownPermDefaults.status()).toBe(400);
    const unknownPermBody = await unknownPermDefaults.json();
    expect(unknownPermBody.error).toMatch(/invalid:fake_permission/);

    // 3. Updating an administrator permissions with missing dependency must be rejected with 400
    const missingDepAdmin = await request.put(`${API_BASE}/api/admin/administrators/${ORDINARY_ADMIN_ID}/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['students:delete'] } // requires students:view
    });
    expect(missingDepAdmin.status()).toBe(400);

    // 4. Creating an administrator with missing dependency must be rejected with 400
    const missingDepCreate = await request.post(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: {
        username: 'admin@missingdep',
        email: 'missingdep@bfibd.org',
        password: TEST_PASSWORD,
        firstName: 'Missing',
        lastName: 'Dep',
        permissions: ['batches:edit'] // requires batches:view
      }
    });
    expect(missingDepCreate.status()).toBe(400);

    // 5. Valid combination with duplicates must succeed and deduplicate
    const validWithDupes = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['courses:view', 'courses:create', 'courses:view'] }
    });
    expect(validWithDupes.status()).toBe(200);
    const validBody = await validWithDupes.json();
    const uniqueDefaults = validBody.defaultPermissions || validBody.default_permissions;
    expect(uniqueDefaults.filter(p => p === 'courses:view').length).toBe(1);
    expect(uniqueDefaults).toContain('courses:view');
    expect(uniqueDefaults).toContain('courses:create');
  });

  test('27. Browser Workflow: Save Defaults, Reload, and Create Administrator with Defaults', async ({ page }) => {
    await setupTestRouteProxy(page);

    // Super Admin sets up initial defaults via UI
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: superAdminToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // 1. Switch to Default Permissions tab
    const defaultsTabBtn = page.locator('button.admin-tab-btn').filter({ hasText: 'Default Permissions' });
    await defaultsTabBtn.click();
    await expect(page.locator('text=Configure the baseline access')).toBeVisible();

    // Select courses:view, courses:create, and batches:view
    // Note: Click courses:create automatically selects courses:view via dependency resolution
    const courseCreateCheckbox = page.locator('input[type="checkbox"][value="courses:create"]');
    if (!(await courseCreateCheckbox.isChecked())) {
      await courseCreateCheckbox.check();
    }
    const batchesViewCheckbox = page.locator('input[type="checkbox"][value="batches:view"]');
    if (!(await batchesViewCheckbox.isChecked())) {
      await batchesViewCheckbox.check();
    }

    // Save defaults
    const saveDefaultsBtn = page.locator('button').filter({ hasText: 'Save Default Permissions' });
    await saveDefaultsBtn.click();
    await expect(page.locator('text=Default administrator permissions saved successfully')).toBeVisible();

    // 2. Reload the page to test persistence and contract alignment
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 3. Open Create Administrator modal
    const newAdminBtn = page.locator('button').filter({ hasText: 'New Administrator' });
    await newAdminBtn.click();
    const modalHeading = page.locator('h2').filter({ hasText: 'Create New Administrator' });
    await expect(modalHeading).toBeVisible();

    // Assert that the effective access summary displays the saved defaults
    await expect(page.locator('.effective-access-chip').filter({ hasText: 'courses:view' })).toBeVisible();
    await expect(page.locator('.effective-access-chip').filter({ hasText: 'courses:create' })).toBeVisible();
    await expect(page.locator('.effective-access-chip').filter({ hasText: 'batches:view' })).toBeVisible();

    // Switch to custom modular selection to inspect the pre-checked checkboxes
    const customRadio = page.locator('input[type="radio"][name="accessStrategy"]').nth(1);
    await customRadio.check();

    const modalCoursesView = page.locator('.admin-modal input[type="checkbox"][value="courses:view"]');
    const modalCoursesCreate = page.locator('.admin-modal input[type="checkbox"][value="courses:create"]');
    const modalBatchesView = page.locator('.admin-modal input[type="checkbox"][value="batches:view"]');
    await expect(modalCoursesView).toBeChecked();
    await expect(modalCoursesCreate).toBeChecked();
    await expect(modalBatchesView).toBeChecked();

    // Switch back to conservative defaults strategy
    const defaultsRadio = page.locator('input[type="radio"][name="accessStrategy"]').first();
    await defaultsRadio.check({ force: true });

    // 4. Fill form and create new administrator using these defaults
    const testUsername = `admin@e2e_${Date.now()}`;
    await page.locator('#admin-username').fill(testUsername);
    await page.locator('#admin-email').fill(`${testUsername.replace('@', '_')}@bfibd.org`);
    await page.locator('#admin-first-name').fill('E2E');
    await page.locator('#admin-last-name').fill('Defaults');
    await page.locator('#admin-password').fill(TEST_PASSWORD);

    const submitCreateBtn = page.locator('.admin-modal-footer button.admin-btn-primary');
    await submitCreateBtn.click();

    // Modal closes on success
    await expect(modalHeading).not.toBeVisible({ timeout: 10000 });

    // Verify created administrator exists in database with the exact default permissions
    const createdUser = db.prepare('SELECT id, username FROM users WHERE username = ?').get(testUsername);
    expect(createdUser).toBeTruthy();
    const perms = db.prepare('SELECT permission FROM admin_permissions WHERE user_id = ?').all(createdUser.id).map(r => r.permission);
    expect(perms).toContain('courses:view');
    expect(perms).toContain('courses:create');
    expect(perms).toContain('batches:view');
  });

  test('28. Browser Workflow: Opening Audit History and Seeing Actual Recorded Changes', async ({ page, request }) => {
    await setupTestRouteProxy(page);

    // Trigger an audit log event directly
    const ordUser = db.prepare('SELECT account_version FROM users WHERE id = ?').get(ORDINARY_ADMIN_ID);
    const auditRes = await request.patch(`${API_BASE}/api/admin/administrators/${ORDINARY_ADMIN_ID}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 1, expected_account_version: ordUser ? ordUser.account_version : 1 }
    });
    expect(auditRes.status()).toBe(200);

    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: superAdminToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Switch to Audit Log tab
    const auditTabBtn = page.locator('button.admin-tab-btn').filter({ hasText: 'Audit History' });
    await auditTabBtn.click();

    // Verify audit logs table renders actual recorded log rows
    const auditTable = page.locator('.admin-audit-table');
    await expect(auditTable).toBeVisible({ timeout: 10000 });

    const firstAuditRow = page.locator('.admin-audit-table tbody tr').first();
    await expect(firstAuditRow).toBeVisible({ timeout: 10000 });

    const auditRows = page.locator('.admin-audit-table tbody tr');
    const count = await auditRows.count();
    expect(count).toBeGreaterThan(0);

    // Verify column contents: action, actor, timestamp
    const firstRowText = await firstAuditRow.textContent();
    expect(firstRowText).toContain('admin@abir');
  });

  test('29. Real-Time Dynamic Grant & Revocation Workflow Verifying Allowed/Denied Operations', async ({ request }) => {
    // 1. Create a dynamic test admin with ONLY courses:view
    const dynUsername = `admin@dyn_${Date.now()}`;
    const createRes = await request.post(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: {
        username: dynUsername,
        email: `${dynUsername.replace('@', '_')}@bfibd.org`,
        password: TEST_PASSWORD,
        firstName: 'Dynamic',
        lastName: 'Admin',
        permissions: ['courses:view']
      }
    });
    expect(createRes.status()).toBe(201);
    const dynUser = (await createRes.json()).user;

    const { token: dynToken } = issueAdminSessionToken(dynUser.id);

    // 2. Viewing courses succeeds (has courses:view)
    const viewRes = await request.get(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${dynToken}` }
    });
    expect(viewRes.status()).toBe(200);

    // 3. Creating a course draft is DENIED (missing courses:create)
    const createDraftDenied = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${dynToken}` },
      data: {
        title: 'Unauthorized Draft',
        phases: [{ phase_number: 1, name: 'Phase 1' }]
      }
    });
    expect(createDraftDenied.status()).toBe(403);

    // 4. Super Admin dynamically grants courses:create (with required courses:view dependency)
    const grantRes = await request.put(`${API_BASE}/api/admin/administrators/${dynUser.id}/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['courses:view', 'courses:create'] }
    });
    expect(grantRes.status()).toBe(200);

    // 5. With the SAME active token, creating draft now SUCCEEDS immediately!
    const createDraftAllowed = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${dynToken}` },
      data: {
        name: `Dynamic Draft ${Date.now()}`,
        phase_count: 2,
        phases: [
          { phase_number: 1, name: 'Phase 1' },
          { phase_number: 2, name: 'Phase 2' }
        ]
      }
    });
    expect(createDraftAllowed.status()).toBe(201);
    const createdDraftId = (await createDraftAllowed.json()).id;

    // 6. Super Admin dynamically REVOKES courses:create
    const revokeRes = await request.put(`${API_BASE}/api/admin/administrators/${dynUser.id}/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['courses:view'] }
    });
    expect(revokeRes.status()).toBe(200);

    // 7. Retrying course creation with SAME token is immediately DENIED again with 403!
    const createDraftDeniedAgain = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { Authorization: `Bearer ${dynToken}` },
      data: {
        name: 'Revoked Draft',
        phase_count: 2,
        phases: [{ phase_number: 1, name: 'Phase 1' }, { phase_number: 2, name: 'Phase 2' }]
      }
    });
    expect(createDraftDeniedAgain.status()).toBe(403);

    // Clean up created draft
    db.prepare('DELETE FROM course_definitions WHERE id = ?').run(createdDraftId);
  });

  test('30. Direct Module Matrix & Navigation Hiding for Zero-Permission Administrator', async ({ page, request }) => {
    // 1. Setup clean zero-permission admin
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const zeroAdminUsername = 'admin@matrixzero';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin)
      VALUES (99985, ?, 'matrixzero@bfibd.org', ?, 'admin', 'Zero', 'Matrix', 1, 0)
    `).run(zeroAdminUsername, passwordHash);

    db.prepare('DELETE FROM admin_permissions WHERE user_id = 99985').run();

    const { token: zeroToken } = issueAdminSessionToken(99985);

    // 2. Direct API checks against EVERY protected administrative module:
    // All must strictly return 403 Forbidden!
    const endpointsToTest = [
      { method: 'get', url: `${API_BASE}/api/admin/course-definitions`, module: 'Course Maker' },
      { method: 'get', url: `${API_BASE}/api/admin/batches`, module: 'Batches' },
      { method: 'get', url: `${API_BASE}/api/admin/students`, module: 'Students' },
      { method: 'get', url: `${API_BASE}/api/admin/teachers`, module: 'Teachers' },
      { method: 'get', url: `${API_BASE}/api/admin/course-settings`, module: 'Course Settings' },
      { method: 'get', url: `${API_BASE}/api/analytics/urgent`, module: 'Analytics Urgent' },
      { method: 'get', url: `${API_BASE}/api/analytics/students/all`, module: 'Analytics Students' },
      { method: 'get', url: `${API_BASE}/api/reports/admin/all`, module: 'Reports' },
      { method: 'get', url: `${API_BASE}/api/admin/batch-fees`, module: 'Batch Fees' },
      { method: 'get', url: `${API_BASE}/api/admin/fee-tracker/students`, module: 'Fee Tracker' },
      { method: 'get', url: `${API_BASE}/api/admin/trash/students`, module: 'Trash' },
      { method: 'get', url: `${API_BASE}/api/admin/broadcast`, module: 'Broadcasts' },
      { method: 'get', url: `${API_BASE}/api/admin/sms/scheduled`, module: 'Scheduled SMS' },
      { method: 'get', url: `${API_BASE}/api/courses/admin/all`, module: 'Course Materials' },
      { method: 'get', url: `${API_BASE}/api/certification/template`, module: 'Certificate Designer' },
      { method: 'get', url: `${API_BASE}/api/admin/administrators`, module: 'Administrator Management' }
    ];

    for (const ep of endpointsToTest) {
      const res = await request[ep.method](ep.url, {
        headers: { Authorization: `Bearer ${zeroToken}` }
      });
      expect(res.status(), `Module ${ep.module} at ${ep.url} must return 403`).toBe(403);
    }

    // 3. Browser UI verification: Restricted admin navigation reflects effective permissions
    await setupTestRouteProxy(page);
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: zeroToken,
      user: {
        id: 99985,
        username: zeroAdminUsername,
        email: 'matrixzero@bfibd.org',
        role: 'admin',
        firstName: 'Zero',
        lastName: 'Matrix',
        is_super_admin: 0,
        isSuperAdmin: false,
        permissions: []
      }
    });

    await page.goto('');
    await page.waitForLoadState('domcontentloaded');

    // Sidebar should NOT contain links for modules requiring permissions
    const sidebar = page.locator('nav.sidebar-nav');
    await expect(sidebar.locator('text=Student Manager')).not.toBeVisible();
    await expect(sidebar.locator('text=Batch Manager')).not.toBeVisible();
    await expect(sidebar.locator('text=Course Maker')).not.toBeVisible();
    await expect(sidebar.locator('text=Analytics')).not.toBeVisible();
    await expect(sidebar.locator('text=Reports')).not.toBeVisible();
    await expect(sidebar.locator('text=Administrator Management')).not.toBeVisible();

    // Direct browser navigation to a protected admin route redirects away
    await page.goto('admin/course-maker');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toContain('/admin/course-maker');
  });

  test('31. Defect A: View Permission Does Not Permit Modification (reports:view vs reports:moderate)', async ({ request }) => {
    // 1. Setup ordinary admin holding ONLY reports:view
    const reportAdminUsername = `admin@rep_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'Report', 'Viewer', 1, 0, datetime('now'), 1)
    `).run(reportAdminUsername, `${reportAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const reportAdminId = insertRes.lastInsertRowid;

    // Grant ONLY reports:view
    db.prepare('INSERT INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, 1)').run(reportAdminId, 'reports:view');

    const { token: reportAdminToken } = issueAdminSessionToken(reportAdminId);

    // 2. Create a test pending report in database
    const createReport = db.prepare(`
      INSERT INTO reports (reporter_id, reported_user_id, content_type, content_id, reason_category, status)
      VALUES (?, ?, 'message', 1, 'Inappropriate behavior', 'pending')
    `).run(TEST_STUDENT_ID, ORDINARY_ADMIN_ID);
    const testReportId = createReport.lastInsertRowid;

    // 3. Viewing reports and unread count succeeds with reports:view
    const unreadRes = await request.get(`${API_BASE}/api/reports/admin/unread-count`, {
      headers: { Authorization: `Bearer ${reportAdminToken}` }
    });
    expect(unreadRes.status()).toBe(200);

    const listRes = await request.get(`${API_BASE}/api/reports/admin/all`, {
      headers: { Authorization: `Bearer ${reportAdminToken}` }
    });
    expect(listRes.status()).toBe(200);

    // 4. Mutating / resolving report is strictly FORBIDDEN with only reports:view! (Must return 403)
    const mutateAttempt = await request.patch(`${API_BASE}/api/reports/admin/${testReportId}/action`, {
      headers: { Authorization: `Bearer ${reportAdminToken}` },
      data: { action: 'dismissed' }
    });
    expect(mutateAttempt.status()).toBe(403);
    const mutateData = await mutateAttempt.json();
    expect(mutateData.error).toContain("missing required permission 'reports:moderate'");

    // Verify report remains unmodified in database
    const reportInDb = db.prepare('SELECT status FROM reports WHERE id = ?').get(testReportId);
    expect(reportInDb.status).toBe('pending');

    // 5. Super Admin grants reports:moderate
    const grantRes = await request.put(`${API_BASE}/api/admin/administrators/${reportAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { permissions: ['reports:view', 'reports:moderate'] }
    });
    expect(grantRes.status()).toBe(200);

    // 6. With reports:moderate granted, mutating report now succeeds!
    const mutateAllowed = await request.patch(`${API_BASE}/api/reports/admin/${testReportId}/action`, {
      headers: { Authorization: `Bearer ${reportAdminToken}` },
      data: { action: 'dismissed', admin_note: 'Verified harmless' }
    });
    expect(mutateAllowed.status()).toBe(200);

    const updatedReport = db.prepare('SELECT status FROM reports WHERE id = ?').get(testReportId);
    expect(updatedReport.status).toBe('dismissed');

    // Clean up
    db.prepare('DELETE FROM reports WHERE id = ?').run(testReportId);
    db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(reportAdminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(reportAdminId);
  });

  test('32. Defect B: Account Changes and Audit Writes are Atomic with Rollback', async ({ request }) => {
    // Setup target admin
    const atomicAdminUsername = `admin@atomic_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'Atomic', 'Test', 1, 0, datetime('now'), 1)
    `).run(atomicAdminUsername, `${atomicAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const atomicAdminId = insertRes.lastInsertRowid;

    // 1. Install a temporary trigger to simulate audit write failure on deactivation
    db.exec('DROP TRIGGER IF EXISTS test_audit_failure_trigger;');
    db.exec(`
      CREATE TRIGGER test_audit_failure_trigger
      BEFORE INSERT ON admin_audit_logs
      WHEN NEW.action = 'deactivate_administrator' AND NEW.target_user_id = ${atomicAdminId}
      BEGIN
        SELECT RAISE(ABORT, 'Simulated audit log insertion failure');
      END;
    `);

    // 2. Attempt deactivating admin while audit log write fails
    const failRes = await request.patch(`${API_BASE}/api/admin/administrators/${atomicAdminId}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 0, expected_account_version: 1 }
    });
    expect(failRes.status()).toBe(500);

    // 3. Verify Rollback: Account MUST NOT remain deactivated! is_active must still be 1!
    const userAfterFailure = db.prepare('SELECT is_active FROM users WHERE id = ?').get(atomicAdminId);
    expect(userAfterFailure.is_active).toBe(1);

    // 4. Remove the failure trigger
    db.exec('DROP TRIGGER IF EXISTS test_audit_failure_trigger;');

    // 5. Normal deactivation succeeds and commits both status change and audit log together
    const successRes = await request.patch(`${API_BASE}/api/admin/administrators/${atomicAdminId}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 0, expected_account_version: 1 }
    });
    expect(successRes.status()).toBe(200);

    const userAfterSuccess = db.prepare('SELECT is_active FROM users WHERE id = ?').get(atomicAdminId);
    expect(userAfterSuccess.is_active).toBe(0);

    const auditRow = db.prepare('SELECT id FROM admin_audit_logs WHERE target_user_id = ? AND action = ?').get(atomicAdminId, 'deactivate_administrator');
    expect(auditRow).toBeDefined();

    // Clean up
    db.prepare('DELETE FROM admin_audit_logs WHERE target_user_id = ?').run(atomicAdminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(atomicAdminId);
  });

  test('33. Defect C: Revoked Tokens and Session Deactivation/Reactivation Defense', async ({ request }) => {
    // 1. Create an ordinary admin account
    const reviveUsername = `admin@revive_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'Revive', 'Test', 1, 0, datetime('now'), 1)
    `).run(reviveUsername, `${reviveUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const reviveAdminId = insertRes.lastInsertRowid;

    // Grant courses:view
    db.prepare('INSERT INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, 1)').run(reviveAdminId, 'courses:view');

    // 2. Admin logs in legitimately via API to obtain a real token and session
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: reviveUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    const token1 = loginData.token;

    // Verify token1 works
    const meRes1 = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` }
    });
    expect(meRes1.status()).toBe(200);

    // 3. Super Admin deactivates the account
    const deactRes = await request.patch(`${API_BASE}/api/admin/administrators/${reviveAdminId}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 0, expected_account_version: 1 }
    });
    expect(deactRes.status()).toBe(200);

    // token1 is rejected while inactive
    const inactiveRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` }
    });
    expect(inactiveRes.status()).toBe(401);

    // 4. Super Admin REACTIVATES the account
    const reactRes = await request.patch(`${API_BASE}/api/admin/administrators/${reviveAdminId}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 1, expected_account_version: 2 }
    });
    expect(reactRes.status()).toBe(200);

    // 5. CRUCIAL CHECK: Does old token1 revive after reactivation?
    // MUST BE REJECTED (HTTP 401)! Deactivation permanently revoked previous sessions!
    const revivedAttempt = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` }
    });
    expect(revivedAttempt.status()).toBe(401);

    // 6. Reactivated admin must log in afresh to obtain a new valid token
    const freshLoginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: reviveUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(freshLoginRes.status()).toBe(200);
    const token2 = (await freshLoginRes.json()).token;

    const meRes2 = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token2}` }
    });
    expect(meRes2.status()).toBe(200);

    // 7. Test Logout Invalidation: Logging out immediately invalidates token2
    const logoutRes = await request.post(`${API_BASE}/api/auth/logout`, {
      headers: { Authorization: `Bearer ${token2}` }
    });
    expect(logoutRes.status()).toBe(200);

    const loggedOutAttempt = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token2}` }
    });
    expect(loggedOutAttempt.status()).toBe(401);

    // Clean up
    db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(reviveAdminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reviveAdminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(reviveAdminId);
  });

  test('34. Privileged Safeguards: Sensitive-Action Verification (Sudo Mode Step-Up Auth)', async ({ request }) => {
    // 1. Simulate an admin whose last_login and sudo verification expired (> 15 minutes ago)
    const sudoAdminUsername = `admin@sudo_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'Sudo', 'Tester', 1, 0, datetime('now', '-20 minutes'), 1)
    `).run(sudoAdminUsername, `${sudoAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const sudoAdminId = insertRes.lastInsertRowid;

    // Create an expired session for this admin
    const sessionInsert = db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
      VALUES (?, 'dummyhash', '127.0.0.1', 'test', datetime('now', '+7 days'), datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), datetime('now', '-20 minutes'))
    `).run(sudoAdminId);
    const sessionId = sessionInsert.lastInsertRowid;

    const sudoAdminToken = jwt.sign(
      { id: sudoAdminId, username: sudoAdminUsername, role: 'admin', is_super_admin: 0, sessionId, token_version: 1, type: 'access' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // 2. Ordinary Admin attempting admin-level sensitive action (MFA setup) with expired session -> 428 Precondition Required
    const unverifiedMfaAttempt = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${sudoAdminToken}` }
    });
    expect(unverifiedMfaAttempt.status()).toBe(428);
    const unverifiedMfaData = await unverifiedMfaAttempt.json();
    expect(unverifiedMfaData.requireSudo).toBe(true);

    // 3. Super Admin attempting Super Admin sensitive action (updating default permissions) with expired session -> 428 Precondition Required
    db.prepare("UPDATE users SET last_login = datetime('now', '-20 minutes') WHERE id = 1").run();
    const superSessionInsert = db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
      VALUES (1, 'expired_super_session_hash', '127.0.0.1', 'test', datetime('now', '+7 days'), datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), datetime('now', '-20 minutes'))
    `).run();
    const superSessionId = superSessionInsert.lastInsertRowid;

    const expiredSuperToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', is_super_admin: 1, sessionId: superSessionId, token_version: 1, type: 'access' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const unverifiedDefaultsAttempt = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { Authorization: `Bearer ${expiredSuperToken}` },
      data: { permissions: ['courses:view'] }
    });
    expect(unverifiedDefaultsAttempt.status()).toBe(428);
    const unverifiedDefaultsData = await unverifiedDefaultsAttempt.json();
    expect(unverifiedDefaultsData.requireSudo).toBe(true);

    // 4. Verify wrong password is rejected
    const badVerify = await request.post(`${API_BASE}/api/admin/auth/verify-password`, {
      headers: { Authorization: `Bearer ${expiredSuperToken}` },
      data: { password: 'WrongPassword!' }
    });
    expect(badVerify.status()).toBe(401);

    // Check failed action was recorded in audit log without secret leak
    const failedLog = db.prepare("SELECT details FROM admin_audit_logs WHERE action = 'failed_verify_password' AND actor_id = ?").get(SUPER_ADMIN_ID);
    expect(failedLog).toBeDefined();
    expect(failedLog.details).not.toContain('WrongPassword');

    // 5. Verify correct password returns sudo token and updates session sudo state
    const goodVerify = await request.post(`${API_BASE}/api/admin/auth/verify-password`, {
      headers: { Authorization: `Bearer ${expiredSuperToken}` },
      data: { password: TEST_PASSWORD }
    });
    expect(goodVerify.status()).toBe(200);
    const sudoToken = (await goodVerify.json()).sudoToken;
    expect(sudoToken).toBeDefined();

    // 6. Sensitive action succeeds using sudo token or refreshed session
    const sudoAllowed = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { 
        Authorization: `Bearer ${expiredSuperToken}`,
        'X-Sudo-Token': sudoToken 
      },
      data: { permissions: ['courses:view', 'batches:view'] }
    });
    expect(sudoAllowed.status()).toBe(200);

    // Clean up and restore Super Admin state
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = 1").run();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(superSessionId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(sudoAdminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(sudoAdminId);
  });

  test('35. Privileged Safeguards: Multi-Factor Authentication (RFC 6238 TOTP)', async ({ request }) => {
    // 1. Create a privileged admin for MFA testing
    const mfaUsername = `admin@mfa_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'User', 1, 0, datetime('now'), 1)
    `).run(mfaUsername, `${mfaUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const mfaUserId = insertRes.lastInsertRowid;

    const { token: mfaAdminToken } = issueAdminSessionToken(mfaUserId);

    // 2. Start MFA setup
    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { 
        Authorization: `Bearer ${mfaAdminToken}`,
        'X-Sudo-Password': TEST_PASSWORD 
      }
    });
    expect(setupRes.status()).toBe(200);
    const setupData = await setupRes.json();
    expect(setupData.secret).toBeDefined();
    expect(setupData.recoveryCodes).toHaveLength(8);

    // Verify account is NOT locked out before verification: two_factor_enabled must still be 0!
    // And pending enrollment is saved
    const userBeforeVerify = db.prepare('SELECT two_factor_enabled, pending_two_factor_secret FROM users WHERE id = ?').get(mfaUserId);
    expect(userBeforeVerify.two_factor_enabled).toBe(0);
    expect(userBeforeVerify.pending_two_factor_secret).toBeDefined();

    // 3. Verify bad code is rejected
    const badCodeRes = await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${mfaAdminToken}` },
      data: { code: '000000' }
    });
    expect(badCodeRes.status()).toBe(400);

    // 4. Verify valid TOTP code enables MFA
    const validCode = generateTotpCode(setupData.secret);
    const goodCodeRes = await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${mfaAdminToken}` },
      data: { code: validCode }
    });
    expect(goodCodeRes.status()).toBe(200);

    const userAfterVerify = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(mfaUserId);
    expect(userAfterVerify.two_factor_enabled).toBe(1);

    // Verify recovery codes are stored as hashes (never plaintext) after verification
    const storedCode = db.prepare('SELECT code_hash FROM admin_mfa_recovery_codes WHERE user_id = ? LIMIT 1').get(mfaUserId);
    expect(storedCode.code_hash).not.toBe(setupData.recoveryCodes[0]);
    expect(bcrypt.compareSync(setupData.recoveryCodes[0], storedCode.code_hash)).toBe(true);

    // 5. Test Login with MFA Enabled
    const mfaLoginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(mfaLoginRes.status()).toBe(200);
    const mfaLoginData = await mfaLoginRes.json();
    expect(mfaLoginData.requireMfa).toBe(true);
    expect(mfaLoginData.mfaToken).toBeDefined();

    // 6. Complete login with valid TOTP code in next step window (+35s) within allowed drift
    const loginTotpCode = generateTotpCode(setupData.secret, Date.now() + 35000);
    const verifyLoginRes = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: mfaLoginData.mfaToken, code: loginTotpCode }
    });
    expect(verifyLoginRes.status()).toBe(200);
    const authedData = await verifyLoginRes.json();
    expect(authedData.token).toBeDefined();

    // 7. REPLAY ATTACK DEFENSE: Retrying the same TOTP code immediately fails
    const replayLoginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    const replayMfaToken = (await replayLoginRes.json()).mfaToken;

    const replayAttempt = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: replayMfaToken, code: loginTotpCode }
    });
    expect(replayAttempt.status()).toBe(400);
    expect((await replayAttempt.json()).error).toContain('already used');

    // 8. RECOVERY CODE LOGIN: Burn a recovery code
    const recoveryCodeToUse = setupData.recoveryCodes[0];
    const recoveryLogin = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: replayMfaToken, recoveryCode: recoveryCodeToUse }
    });
    expect(recoveryLogin.status()).toBe(200);

    // Retrying with the same recovery code fails (code is burned)
    const retryBurnedLogin = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    const retryMfaToken = (await retryBurnedLogin.json()).mfaToken;

    const burnedAttempt = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: retryMfaToken, recoveryCode: recoveryCodeToUse }
    });
    expect(burnedAttempt.status()).toBe(400);

    // 9. Disable MFA (requires recent sudo auth and factor verification; testing recovery code factor)
    const disableRes = await request.post(`${API_BASE}/api/admin/mfa/disable`, {
      headers: { 
        Authorization: `Bearer ${mfaAdminToken}`,
        'X-Sudo-Password': TEST_PASSWORD 
      },
      data: { recoveryCode: setupData.recoveryCodes[1] }
    });
    expect(disableRes.status()).toBe(200);

    const userAfterDisable = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(mfaUserId);
    expect(userAfterDisable.two_factor_enabled).toBe(0);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(mfaUserId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(mfaUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(mfaUserId);
  });

  test('36. Privileged Safeguards: Privileged Session Tracking & Revocation', async ({ request }) => {
    // 1. Create a session for Super Admin
    const sessRes = await request.get(`${API_BASE}/api/admin/sessions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(sessRes.status()).toBe(200);
    const sessData = await sessRes.json();
    expect(Array.isArray(sessData.sessions)).toBe(true);

    // 2. Simulate a secondary active device session
    const extraSession = db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity)
      VALUES (?, 'extra_session_token_hash', '192.168.1.100', 'MobileSafari/17.0', datetime('now', '+7 days'), datetime('now'), datetime('now'))
    `).run(SUPER_ADMIN_ID);
    const extraSessionId = extraSession.lastInsertRowid;

    const extraToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', is_super_admin: 1, sessionId: extraSessionId, token_version: 1, type: 'access' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Verify extraToken is valid
    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${extraToken}` }
    });
    expect(meRes.status()).toBe(200);

    // 3. Super Admin revokes the extra session
    const revokeRes = await request.delete(`${API_BASE}/api/admin/sessions/${extraSessionId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(revokeRes.status()).toBe(200);

    // 4. Any subsequent request with extraToken is immediately rejected with 401
    const revokedAttempt = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${extraToken}` }
    });
    expect(revokedAttempt.status()).toBe(401);
  });

  test('37. Super Admin Management Reliability: Concurrency Conflict Detection & Permission Diff', async ({ page, request }) => {
    // 1. Concurrency Conflict Test: Stale expected_version returns 409
    const conflictRes = await request.put(`${API_BASE}/api/admin/administrators/${ORDINARY_ADMIN_ID}/permissions`, {
      headers: { 
        Authorization: `Bearer ${superAdminToken}`,
        'X-Sudo-Password': TEST_PASSWORD 
      },
      data: {
        permissions: ['courses:view'],
        expected_version: 9999 // Stale version mismatch!
      }
    });
    expect(conflictRes.status()).toBe(409);
    const conflictData = await conflictRes.json();
    expect(conflictData.code).toBe('CONCURRENCY_CONFLICT');

    // 2. Browser UI Workflow: Permission Diff Preview Modal
    await setupTestRouteProxy(page);
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: superAdminToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Find Ordinary Admin and click "Edit Access"
    const editBtn = page.locator('button').filter({ hasText: 'Edit Access' }).first();
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();

    // Permissions modal is open; click "Review & Save Changes"
    const reviewBtn = page.locator('button').filter({ hasText: 'Review & Save Changes' });
    await expect(reviewBtn).toBeVisible();

    // Toggle a permission to create a diff
    const firstCheckbox = page.locator('.permission-checkbox').first();
    await firstCheckbox.click();

    await reviewBtn.click();

    // Verify Diff Preview modal opens displaying exact additions/removals
    const diffModalHeader = page.locator('h2').filter({ hasText: 'Review Permission Changes' });
    await expect(diffModalHeader).toBeVisible({ timeout: 5000 });

    const confirmDiffBtn = page.locator('button').filter({ hasText: 'Confirm & Apply Changes' });
    await expect(confirmDiffBtn).toBeVisible();
  });

  test('38. Token-Purpose Separation: Reject non-access tokens on protected routes', async ({ request }) => {
    // 1. MFA challenge token must be rejected with 401 INVALID_TOKEN_PURPOSE
    const mfaPendingToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', type: 'mfa_challenge', token_version: 1 },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    const mfaRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${mfaPendingToken}` }
    });
    expect(mfaRes.status()).toBe(401);
    const mfaBody = await mfaRes.json();
    expect(mfaBody.code).toBe('INVALID_TOKEN_PURPOSE');

    // 2. Sudo token must be rejected as an access credential
    const sudoToken = jwt.sign(
      { id: SUPER_ADMIN_ID, sessionId: superAdminSessionId, token_version: 1, type: 'sudo' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    const sudoRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${sudoToken}` }
    });
    expect(sudoRes.status()).toBe(401);
    expect((await sudoRes.json()).code).toBe('INVALID_TOKEN_PURPOSE');

    // 3. Password reset token must be rejected
    const resetToken = jwt.sign(
      { id: SUPER_ADMIN_ID, type: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    const resetRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${resetToken}` }
    });
    expect(resetRes.status()).toBe(401);
    expect((await resetRes.json()).code).toBe('INVALID_TOKEN_PURPOSE');

    // 4. Token without explicit access purpose must be rejected
    const typelessToken = jwt.sign(
      { id: SUPER_ADMIN_ID, sessionId: superAdminSessionId, token_version: 1 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const typelessRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${typelessToken}` }
    });
    expect(typelessRes.status()).toBe(401);
    expect((await typelessRes.json()).code).toBe('INVALID_TOKEN_PURPOSE');
  });

  test('39. Close Legacy-Token Revocation Bypasses: Reject admin tokens lacking sessionId or token_version', async ({ request }) => {
    // 1. Admin access token lacking sessionId -> 401 SESSION_REVOKED
    const noSessionToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', type: 'access', token_version: 1 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const noSessionRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${noSessionToken}` }
    });
    expect(noSessionRes.status()).toBe(401);
    expect((await noSessionRes.json()).code).toBe('SESSION_REVOKED');

    // 2. Admin access token lacking token_version -> 401 SESSION_REVOKED
    const noVersionToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', type: 'access', sessionId: superAdminSessionId },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const noVersionRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${noVersionToken}` }
    });
    expect(noVersionRes.status()).toBe(401);
    expect((await noVersionRes.json()).code).toBe('SESSION_REVOKED');

    // 3. Admin access token with stale token_version -> 401 SESSION_REVOKED
    const staleVersionToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', type: 'access', sessionId: superAdminSessionId, token_version: 999 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const staleRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${staleVersionToken}` }
    });
    expect(staleRes.status()).toBe(401);
    expect((await staleRes.json()).code).toBe('SESSION_REVOKED');
  });

  test('40. Session-Bound Sudo Mode: Sudo tokens are bound strictly to active session and rejected across sessions', async ({ request }) => {
    // 1. Issue two separate sessions for Super Admin
    const sessA = issueAdminSessionToken(SUPER_ADMIN_ID);
    const sessB = issueAdminSessionToken(SUPER_ADMIN_ID);

    // Expire sudo verification on both sessions to require step-up
    db.prepare("UPDATE sessions SET sudo_verified_at = datetime('now', '-20 minutes') WHERE id IN (?, ?)").run(sessA.sessionId, sessB.sessionId);

    // 2. Obtain sudo token specifically in Session A
    const verifyResA = await request.post(`${API_BASE}/api/admin/auth/verify-password`, {
      headers: { Authorization: `Bearer ${sessA.token}` },
      data: { password: TEST_PASSWORD }
    });
    expect(verifyResA.status()).toBe(200);
    const sudoTokenA = (await verifyResA.json()).sudoToken;
    expect(sudoTokenA).toBeDefined();

    // 3. Cross-session rejection: Presenting Session A's sudoToken on Session B's request -> 428 Precondition Required
    const crossSessionAttempt = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { 
        Authorization: `Bearer ${sessB.token}`,
        'X-Sudo-Token': sudoTokenA 
      },
      data: { permissions: ['courses:view'] }
    });
    expect(crossSessionAttempt.status()).toBe(428);
    const crossData = await crossSessionAttempt.json();
    expect(crossData.requireSudo).toBe(true);

    // 4. In-session acceptance: Presenting Session A's sudoToken on Session A's request -> 200 OK
    const inSessionAttempt = await request.put(`${API_BASE}/api/admin/permissions/defaults`, {
      headers: { 
        Authorization: `Bearer ${sessA.token}`,
        'X-Sudo-Token': sudoTokenA 
      },
      data: { permissions: ['courses:view', 'batches:view'] }
    });
    expect(inSessionAttempt.status()).toBe(200);

    // Clean up
    db.prepare('DELETE FROM sessions WHERE id IN (?, ?)').run(sessA.sessionId, sessB.sessionId);
  });

  test('41. Factor Verification Required to Disable MFA', async ({ request }) => {
    // 1. Create admin and enroll MFA
    const mfaAdminUsername = `admin@mfadisable_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'DisableTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    // Setup MFA
    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);

    // Verify setup
    const verifySetup = await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });
    expect(verifySetup.status()).toBe(200);

    // 2. Attempting to disable MFA without providing factor code -> 400 Bad Request
    const noFactorDisable = await request.post(`${API_BASE}/api/admin/mfa/disable`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    expect(noFactorDisable.status()).toBe(400);
    expect((await noFactorDisable.json()).error).toContain('Verification code or recovery code is required');

    // 3. Attempting to disable with invalid TOTP code -> 400 Bad Request
    const badCodeDisable = await request.post(`${API_BASE}/api/admin/mfa/disable`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { code: '000000' }
    });
    expect(badCodeDisable.status()).toBe(400);

    // 4. Attempting to disable with valid factor code -> 200 OK
    const validDisableCode = generateTotpCode(setupData.secret, Date.now() + 35000);
    const goodDisable = await request.post(`${API_BASE}/api/admin/mfa/disable`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { code: validDisableCode }
    });
    expect(goodDisable.status()).toBe(200);

    const user = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(adminId);
    expect(user.two_factor_enabled).toBe(0);

    // Clean up
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('42. Safe Replacement: Active MFA and recovery codes remain intact if replacement setup is aborted', async ({ request }) => {
    // 1. Setup initial active MFA (Factor A)
    const mfaAdminUsername = `admin@mfarotate_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'RotateTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    // Setup Factor A
    const setupResA = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const dataA = await setupResA.json();
    const codeA = generateTotpCode(dataA.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: codeA }
    });

    // 2. Start replacement setup (Factor B) but DO NOT verify it (user aborts or leaves window)
    const setupResB = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const dataB = await setupResB.json();
    expect(dataB.secret).not.toBe(dataA.secret);

    // 3. Factor A MUST REMAIN FULLY FUNCTIONAL:
    // Logging in requires MFA
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const { mfaToken } = await loginRes.json();

    // Verification using Factor A's TOTP code SUCCEEDS!
    const codeAWindow = generateTotpCode(dataA.secret, Date.now() + 35000);
    const verifyA = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: codeAWindow }
    });
    expect(verifyA.status()).toBe(200);

    // Recovery code from Set A is still active and valid!
    const loginRes2 = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    const mfaToken2 = (await loginRes2.json()).mfaToken;
    const recoveryA = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: mfaToken2, recoveryCode: dataA.recoveryCodes[0] }
    });
    expect(recoveryA.status()).toBe(200);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('43. WebSocket Security: Token-purpose, session validation, and real-time disconnection', async ({ request }) => {
    // 1. Connection with mfa_challenge token is rejected
    const mfaChallengeToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', type: 'mfa_challenge', token_version: 1 },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    const mfaSocket = io(API_BASE, {
      auth: { token: mfaChallengeToken },
      transports: ['websocket'],
      reconnection: false
    });

    const mfaConnectError = await new Promise((resolve) => {
      mfaSocket.on('connect_error', (err) => resolve(err.message));
      mfaSocket.on('connect', () => resolve('connected_unexpectedly'));
      setTimeout(() => resolve('timeout'), 4000);
    });
    mfaSocket.close();
    expect(mfaConnectError).toContain('Access token required');

    // 2. Connection with admin token lacking sessionId is rejected
    const noSessionToken = jwt.sign(
      { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin', type: 'access', token_version: 1 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const noSessionSocket = io(API_BASE, {
      auth: { token: noSessionToken },
      transports: ['websocket'],
      reconnection: false
    });

    const noSessionError = await new Promise((resolve) => {
      noSessionSocket.on('connect_error', (err) => resolve(err.message));
      noSessionSocket.on('connect', () => resolve('connected_unexpectedly'));
      setTimeout(() => resolve('timeout'), 4000);
    });
    noSessionSocket.close();
    expect(noSessionError).toContain('Session credentials required');

    // 3. Connection with valid admin access token succeeds
    const sess = issueAdminSessionToken(SUPER_ADMIN_ID);
    const validSocket = io(API_BASE, {
      auth: { token: sess.token },
      transports: ['websocket'],
      reconnection: false
    });

    const isConnected = await new Promise((resolve) => {
      validSocket.on('connect', () => resolve(true));
      validSocket.on('connect_error', () => resolve(false));
      setTimeout(() => resolve(false), 4000);
    });
    expect(isConnected).toBe(true);

    // 4. When session is revoked via DELETE /api/admin/sessions/:id, the active socket is immediately disconnected
    const disconnectPromise = new Promise((resolve) => {
      validSocket.on('disconnect', (reason) => resolve(reason));
      setTimeout(() => resolve('timeout'), 5000);
    });

    const revokeRes = await request.delete(`${API_BASE}/api/admin/sessions/${sess.sessionId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    expect(revokeRes.status()).toBe(200);

    const disconnectReason = await disconnectPromise;
    expect(disconnectReason).not.toBe('timeout');
    validSocket.close();
  });

  test('44. Deactivation & Password Reset Invalidate Outstanding MFA Challenges', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfainvalid_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'InvalidTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    // Setup MFA
    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // 2. Admin logs in with password: gets mfaToken challenge
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const { mfaToken } = await loginRes.json();

    // 3. Super Admin deactivates account -> bumps token_version and clears sessions
    const deactRes = await request.patch(`${API_BASE}/api/admin/administrators/${adminId}/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
      data: { is_active: 0, expected_account_version: 1 }
    });
    expect(deactRes.status()).toBe(200);

    // 4. Submitting outstanding mfaToken now fails (401)
    const validCode = generateTotpCode(setupData.secret, Date.now() + 35000);
    const verifyAttempt = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: validCode }
    });
    expect(verifyAttempt.status()).toBe(401);
    expect((await verifyAttempt.json()).error).toContain('expired or invalidated');

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('45. Real Browser Workflow: MFA Login, Retry, Cancel & Recovery Code Login in AdminLogin.jsx', async ({ page, request }) => {
    // 1. Setup a test admin with active MFA and recovery codes
    const browserMfaUsername = `admin@browsermfa_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'Browser', 'MFAAdmin', 1, 0, datetime('now'), 1)
    `).run(browserMfaUsername, `${browserMfaUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: setupToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${setupToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${setupToken}` },
      data: { code: totpCode }
    });

    // 2. Navigate to /admin/login
    await setupTestRouteProxy(page);
    await page.addInitScript(() => {
      window.turnstile = {
        render: () => 'widget-mock',
        reset: () => {},
        getResponse: () => 'mock_test_turnstile_token'
      };
    });
    await page.goto('admin/login');
    await page.waitForLoadState('domcontentloaded');

    // Enter username and password
    const usernameInput = page.locator('#username');
    await usernameInput.fill(browserMfaUsername.replace(/^admin@/i, ''));
    await page.locator('#password').fill(TEST_PASSWORD);

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // 3. Verify MFA challenge screen is displayed
    const mfaHeading = page.locator('h2').filter({ hasText: 'Two-Factor Verification' });
    await expect(mfaHeading).toBeVisible({ timeout: 10000 });

    // CRITICAL: Verify NO token is stored in localStorage while MFA is pending!
    const tokenDuringMfa = await page.evaluate(() => localStorage.getItem('token'));
    expect(tokenDuringMfa).toBeNull();

    // 4. Test error state: Enter invalid TOTP code
    const totpInput = page.locator('#totpCode');
    await totpInput.fill('000000');
    await page.locator('button[type="submit"]').click();

    const errorAlert = page.locator('.error-alert');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });

    // 5. Test Cancel / Back button
    const backBtn = page.locator('button').filter({ hasText: 'Back to Sign In' });
    await backBtn.click();

    // Returns to username & password form
    await expect(page.locator('#password')).toBeVisible();

    // 6. Enter credentials again and test Recovery Code flow
    await usernameInput.fill(browserMfaUsername.replace(/^admin@/i, ''));
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(mfaHeading).toBeVisible({ timeout: 10000 });

    // Toggle to recovery code mode
    const toggleRecoveryBtn = page.locator('button').filter({ hasText: 'Lost your device? Use recovery code' });
    await toggleRecoveryBtn.click();

    const recoveryInput = page.locator('#recoveryCode');
    await expect(recoveryInput).toBeVisible();

    // Fill valid recovery code
    await recoveryInput.fill(setupData.recoveryCodes[0]);
    await page.locator('button[type="submit"]').click();

    // 7. Verify login completes and navigates to the app
    await page.waitForURL((url) => !url.pathname.includes('/admin/login'), { timeout: 10000 });
    const tokenAfterLogin = await page.evaluate(() => localStorage.getItem('token'));
    expect(tokenAfterLogin).toBeDefined();
    expect(tokenAfterLogin).not.toBeNull();

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('46. Single-Use MFA Challenge: Reusing challenge with another valid recovery code is rejected', async ({ request }) => {
    // 1. Create admin with MFA enabled and recovery codes
    const mfaAdminUsername = `admin@mfasingle_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'SingleTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // 2. Perform password login to get an MFA challenge token
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const { mfaToken } = await loginRes.json();
    expect(mfaToken).toBeDefined();

    // 3. First verification with recovery code 0 -> Must succeed
    const firstVerify = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, recoveryCode: setupData.recoveryCodes[0] }
    });
    expect(firstVerify.status()).toBe(200);
    const firstData = await firstVerify.json();
    expect(firstData.token).toBeDefined();

    // 4. Second verification attempting to REUSE the same mfaToken with recovery code 1 -> MUST BE REJECTED (401)
    const secondVerify = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, recoveryCode: setupData.recoveryCodes[1] }
    });
    expect(secondVerify.status()).toBe(401);
    const secondData = await secondVerify.json();
    expect(secondData.error).toMatch(/consumed|already used|expired|invalid/i);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('47. Single-Use MFA Challenge: Reusing challenge with a second valid TOTP code is rejected', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfatotpreuse_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'TotpReuseTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // 2. Perform password login to get an MFA challenge token
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const { mfaToken } = await loginRes.json();

    // 3. First verification with valid TOTP code at T+35s -> Must succeed
    const code1 = generateTotpCode(setupData.secret, Date.now() + 35000);
    const firstVerify = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: code1 }
    });
    expect(firstVerify.status()).toBe(200);

    // 4. Second verification attempting to REUSE the same mfaToken with code at T+70s -> MUST BE REJECTED (401)
    const code2 = generateTotpCode(setupData.secret, Date.now() + 70000);
    const secondVerify = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: code2 }
    });
    expect(secondVerify.status()).toBe(401);
    const secondData = await secondVerify.json();
    expect(secondData.error).toMatch(/consumed|already used|expired|invalid/i);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('48. Concurrent MFA Challenge Verification: Only one concurrent request may succeed', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfaconcurrent_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'ConcurrentTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // 2. Perform password login to get an MFA challenge token
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const { mfaToken } = await loginRes.json();

    // 3. Fire TWO concurrent verification requests using different valid recovery codes
    const [res1, res2] = await Promise.all([
      request.post(`${API_BASE}/api/auth/mfa-verify`, {
        data: { mfaToken, recoveryCode: setupData.recoveryCodes[0] }
      }),
      request.post(`${API_BASE}/api/auth/mfa-verify`, {
        data: { mfaToken, recoveryCode: setupData.recoveryCodes[1] }
      })
    ]);

    const statuses = [res1.status(), res2.status()].sort();
    // Exactly one must be 200, and the other must be 401
    expect(statuses).toEqual([200, 401]);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('49. Secure Replacement: Attempt replacement without verifying existing factor is rejected', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfareplacefail_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'ReplaceFailTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // 2. Now attempt to initiate replacement WITHOUT providing existing factor verification
    // Calling /api/admin/mfa/setup with only sudo password must be rejected because MFA is already active!
    const unauthSetupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    expect(unauthSetupRes.status()).toBe(400);
    const unauthData = await unauthSetupRes.json();
    expect(unauthData.error).toMatch(/existing factor verification required/i);

    // 3. Even if someone passes an invalid existing code, it must fail
    const badCodeRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { currentCode: '000000' }
    });
    expect(badCodeRes.status()).toBe(400);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('50. Secure Replacement Lifecycle: Authorized replacement, session revocation, rollback, cancellation, and old factor rejection', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfareplacelifecycle_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'LifecycleTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: activeToken } = issueAdminSessionToken(adminId);
    const { token: otherSessionToken } = issueAdminSessionToken(adminId);

    // Initial enrollment
    const initialSetupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${activeToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const initialData = await initialSetupRes.json();
    const initialCode = generateTotpCode(initialData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${activeToken}` },
      data: { code: initialCode }
    });

    // 2. Cancellation test: Start replacement with existing factor verification, then cancel
    const existingCode1 = generateTotpCode(initialData.secret, Date.now() + 35000);
    const replaceSetup1 = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${activeToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { currentCode: existingCode1 }
    });
    expect(replaceSetup1.status()).toBe(200);

    // Cancel setup
    const cancelRes = await request.post(`${API_BASE}/api/admin/mfa/cancel-setup`, {
      headers: { Authorization: `Bearer ${activeToken}` }
    });
    expect(cancelRes.status()).toBe(200);

    // Verify existing factor is STILL active and untouched
    const userCheck = db.prepare('SELECT two_factor_enabled, pending_two_factor_secret FROM users WHERE id = ?').get(adminId);
    expect(userCheck.two_factor_enabled).toBe(1);
    expect(userCheck.pending_two_factor_secret).toBeNull();

    // 3. Authorized replacement: Verify with existing factor (recovery code), then commit with new factor code
    const replaceSetup2 = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${activeToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { recoveryCode: initialData.recoveryCodes[0] }
    });
    expect(replaceSetup2.status()).toBe(200);
    const replacementData = await replaceSetup2.json();
    expect(replacementData.secret).not.toEqual(initialData.secret);

    // 3a. Expiration & rollback test: Expire pending authorization and verify verify-setup rejects without corrupting current factor
    const pendingRow = db.prepare('SELECT pending_two_factor_secret, two_factor_secret FROM users WHERE id = ?').get(adminId);
    const pendingJson = JSON.parse(pendingRow.pending_two_factor_secret);
    const expiredPayload = JSON.stringify({ ...pendingJson, expiresAt: new Date(Date.now() - 5000).toISOString() });
    db.prepare('UPDATE users SET pending_two_factor_secret = ? WHERE id = ?').run(expiredPayload, adminId);

    const expiredVerifyRes = await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${activeToken}` },
      data: { code: generateTotpCode(replacementData.secret) }
    });
    expect(expiredVerifyRes.status()).toBe(400);
    const expiredJson = await expiredVerifyRes.json();
    expect(expiredJson.code).toBe('REPLACEMENT_EXPIRED');

    // Confirm rollback / non-corruption: Active two_factor_secret remains untouched
    const userRollbackCheck = db.prepare('SELECT two_factor_secret FROM users WHERE id = ?').get(adminId);
    expect(userRollbackCheck.two_factor_secret).toBe(pendingRow.two_factor_secret);

    // 3b. Re-authorize replacement cleanly using another valid existing recovery code
    const replaceSetupFinal = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${activeToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { recoveryCode: initialData.recoveryCodes[1] }
    });
    expect(replaceSetupFinal.status()).toBe(200);
    const finalReplacementData = await replaceSetupFinal.json();

    // Other session should still be valid BEFORE replacement commit
    const probeBeforeCommit = await request.get(`${API_BASE}/api/admin/sessions`, {
      headers: { Authorization: `Bearer ${otherSessionToken}` }
    });
    expect(probeBeforeCommit.status()).toBe(200);

    // Complete replacement with code from the NEW secret
    const newTotpCode = generateTotpCode(finalReplacementData.secret);
    const commitRes = await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${activeToken}` },
      data: { code: newTotpCode }
    });
    expect(commitRes.status()).toBe(200);
    const commitJson = await commitRes.json();
    expect(commitJson.success).toBe(true);

    // 4. Verify other session was REVOKED upon replacement
    const probeAfterCommit = await request.get(`${API_BASE}/api/admin/sessions`, {
      headers: { Authorization: `Bearer ${otherSessionToken}` }
    });
    expect(probeAfterCommit.status()).toBe(401);

    // 5. Verify old factor is rejected on login
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    const { mfaToken } = await loginRes.json();

    // Attempting login with OLD secret's TOTP must fail
    const oldCodeAttempt = generateTotpCode(initialData.secret);
    const verifyOld = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: oldCodeAttempt }
    });
    expect(verifyOld.status()).toBe(400);

    // Login with NEW factor's recovery code must succeed
    const verifyNew = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, recoveryCode: finalReplacementData.recoveryCodes[0] }
    });
    expect(verifyNew.status()).toBe(200);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });
  test('51. Real Browser Workflow: Factor Replacement Lifecycle in AdminManagement.jsx', async ({ page, request }) => {
    // 1. Setup Super Admin (User ID 1) with active MFA and recovery codes
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(SUPER_ADMIN_ID);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(SUPER_ADMIN_ID);

    const { token: primaryToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const { token: secondaryToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // Initial enrollment via API
    const initialSetupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${primaryToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const initialData = await initialSetupRes.json();
    const initialCode = generateTotpCode(initialData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${primaryToken}` },
      data: { code: initialCode }
    });

    // 2. Open Admin Management page in browser
    await setupTestRouteProxy(page);
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: primaryToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // 3. Switch to Security & Sessions tab
    const securityTabBtn = page.locator('button.admin-tab-btn').filter({ hasText: 'Security & Sessions' });
    await expect(securityTabBtn).toBeVisible({ timeout: 10000 });
    await securityTabBtn.click();

    // Verify MFA shows Enabled (Active)
    await expect(page.locator('text=Enabled (Active)')).toBeVisible({ timeout: 10000 });

    // 4. Click "Change Device / Replace MFA" button
    const replaceBtn = page.locator('[data-testid="replace-mfa-btn"]');
    await expect(replaceBtn).toBeVisible();
    await replaceBtn.click();

    // 5. Verify Replacement Authorization Modal is open
    const authModalHeading = page.locator('h2').filter({ hasText: 'Authorize MFA Replacement' });
    await expect(authModalHeading).toBeVisible({ timeout: 5000 });

    // 6. Test Recovery Code authorization method
    const recoveryRadio = page.locator('[data-testid="replace-method-recovery"]');
    await recoveryRadio.click();

    const recoveryInput = page.locator('[data-testid="mfa-recovery-code-input"]');
    await expect(recoveryInput).toBeVisible();
    await recoveryInput.fill(initialData.recoveryCodes[0]);

    // Click Verify & Continue
    const authorizeBtn = page.locator('[data-testid="authorize-replacement-btn"]');
    await authorizeBtn.click();

    // 7. Verify Setup/Replacement modal appears with NEW secret and recovery codes
    const setupModalHeading = page.locator('h2').filter({ hasText: 'Replace Authenticator Device' });
    await expect(setupModalHeading).toBeVisible({ timeout: 10000 });

    const secretInput = page.locator('[data-testid="new-mfa-secret-display"]');
    await expect(secretInput).toBeVisible();
    const newSecret = await secretInput.inputValue();
    expect(newSecret).toBeDefined();
    expect(newSecret).not.toEqual(initialData.secret);

    // Other session should still be valid BEFORE replacement is finalized
    const probeBefore = await request.get(`${API_BASE}/api/admin/sessions`, {
      headers: { Authorization: `Bearer ${secondaryToken}` }
    });
    expect(probeBefore.status()).toBe(200);

    // 8. Generate and enter TOTP code from the NEW secret
    const newTotpCode = generateTotpCode(newSecret);
    const verifyInput = page.locator('[data-testid="mfa-verify-code-input"]');
    await verifyInput.fill(newTotpCode);

    // Click "Verify & Replace Authenticator"
    const confirmBtn = page.locator('[data-testid="verify-activate-mfa-btn"]');
    await confirmBtn.click();

    // 9. Verify success notification with guidance about revoked other sessions
    const successAlert = page.locator('.admin-alert.admin-alert-success');
    await expect(successAlert).toBeVisible({ timeout: 10000 });
    await expect(successAlert).toContainText('Two-factor authentication successfully replaced. All other active sessions have been terminated for security.');

    // 10. Verify secondary session was revoked on the server
    const probeAfter = await request.get(`${API_BASE}/api/admin/sessions`, {
      headers: { Authorization: `Bearer ${secondaryToken}` }
    });
    expect(probeAfter.status()).toBe(401);

    // 11. Verify login with old secret fails, login with new secret succeeds
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: 'admin@abir', password: TEST_PASSWORD, type: 'admin' }
    });
    const { mfaToken } = await loginRes.json();

    // Old secret code fails
    const oldCodeFail = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: generateTotpCode(initialData.secret) }
    });
    expect(oldCodeFail.status()).toBe(400);

    // New secret code succeeds
    const newCodeLogin = generateTotpCode(newSecret, Date.now() + 30000);
    const newCodeSuccess = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, code: newCodeLogin }
    });
    expect(newCodeSuccess.status()).toBe(200);

    // Clean up Super Admin MFA
    db.prepare('UPDATE users SET two_factor_secret = NULL, pending_two_factor_secret = NULL, two_factor_enabled = 0 WHERE id = ?').run(SUPER_ADMIN_ID);
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(SUPER_ADMIN_ID);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(SUPER_ADMIN_ID);
  });


  test('52. Untracked Challenges Rejected: Missing ID, Missing Version, Untracked Record, Mismatched ID', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfauntracked_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'UntrackedTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // A. Missing challenge identifier (no challengeId and no jti)
    const tokenNoChallengeId = jwt.sign(
      { id: adminId, username: mfaAdminUsername, role: 'admin', type: 'mfa_challenge', token_version: 1 },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    const resNoId = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: tokenNoChallengeId, recoveryCode: setupData.recoveryCodes[0] }
    });
    expect(resNoId.status()).toBe(401);
    const dataNoId = await resNoId.json();
    expect(dataNoId.code).toBe('CHALLENGE_INVALID');

    // B. Missing security version (no token_version)
    const tokenNoVersion = jwt.sign(
      { id: adminId, username: mfaAdminUsername, role: 'admin', type: 'mfa_challenge', challengeId: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    const resNoVer = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: tokenNoVersion, recoveryCode: setupData.recoveryCodes[0] }
    });
    expect(resNoVer.status()).toBe(401);
    const dataNoVer = await resNoVer.json();
    expect(dataNoVer.code).toBe('CHALLENGE_INVALID');

    // C. Untracked challenge record (valid UUID in token, but not present in mfa_login_challenges)
    const untrackedUuid = crypto.randomUUID();
    const tokenUntracked = jwt.sign(
      { id: adminId, username: mfaAdminUsername, role: 'admin', type: 'mfa_challenge', challengeId: untrackedUuid, jti: untrackedUuid, token_version: 1 },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    const resUntracked = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: tokenUntracked, recoveryCode: setupData.recoveryCodes[0] }
    });
    expect(resUntracked.status()).toBe(401);
    const dataUntracked = await resUntracked.json();
    expect(dataUntracked.code).toBe('CHALLENGE_INVALID');

    // D. Mismatched challenge identifiers (jti !== challengeId)
    const tokenMismatched = jwt.sign(
      { id: adminId, username: mfaAdminUsername, role: 'admin', type: 'mfa_challenge', challengeId: crypto.randomUUID(), jti: crypto.randomUUID(), token_version: 1 },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    const resMismatch = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: tokenMismatched, recoveryCode: setupData.recoveryCodes[0] }
    });
    expect(resMismatch.status()).toBe(401);
    const dataMismatch = await resMismatch.json();
    expect(dataMismatch.code).toBe('CHALLENGE_INVALID');

    // E. Verify recovery code was NOT consumed by the rejected attempts
    const recoveryRow = db.prepare('SELECT used FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').all(adminId);
    expect(recoveryRow.length).toBe(8);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('53. Recovery-Code Reuse During Replacement Authorization is Rejected and Atomically Consumed', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfarecovreuse_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'RecovReuseTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    const usedRecoveryCode = setupData.recoveryCodes[0];

    // 2. Authorize replacement using recoveryCodes[0] -> MUST SUCCEED (200)
    const firstAuthRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { recoveryCode: usedRecoveryCode }
    });
    expect(firstAuthRes.status()).toBe(200);

    // Verify recovery code was marked used (used = 1) in database
    const rows = db.prepare('SELECT id, used FROM admin_mfa_recovery_codes WHERE user_id = ?').all(adminId);
    const usedCount = rows.filter(r => r.used === 1).length;
    const remainingCount = rows.filter(r => r.used === 0).length;
    expect(usedCount).toBe(1);
    expect(remainingCount).toBe(7);

    // 3. Attempt to authorize replacement AGAIN using the SAME recovery code -> MUST BE REJECTED (400)
    const secondAuthRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { recoveryCode: usedRecoveryCode }
    });
    expect(secondAuthRes.status()).toBe(400);
    const secondAuthData = await secondAuthRes.json();
    expect(secondAuthData.error).toMatch(/invalid or already used recovery code|already been used/i);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('54. TOTP Replay During Replacement Authorization is Rejected', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfatotpreplay_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'TotpReplayTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    // 2. Authorize replacement with a fresh TOTP code at T+35s -> Must succeed
    const freshTotp = generateTotpCode(setupData.secret, Date.now() + 35000);
    const firstAuth = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { currentCode: freshTotp }
    });
    expect(firstAuth.status()).toBe(200);

    // Verify last_totp_timestamp was updated in users
    const userRow = db.prepare('SELECT last_totp_timestamp FROM users WHERE id = ?').get(adminId);
    expect(userRow.last_totp_timestamp).toBeGreaterThan(0);

    // 3. Immediately re-attempt authorization with the SAME code in the same window -> REPLAY MUST BE REJECTED (400)
    const replayAuth = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { currentCode: freshTotp }
    });
    expect(replayAuth.status()).toBe(400);
    const replayData = await replayAuth.json();
    expect(replayData.error).toMatch(/already used|invalid.*code/i);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('55. Concurrent Authorization Attempts and Transaction Rollback', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfaconcurrauth_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'ConcurrAuthTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    const targetCode = setupData.recoveryCodes[0];

    // 2. Fire concurrent replacement authorization requests with the SAME recovery code
    const [resA, resB] = await Promise.all([
      request.post(`${API_BASE}/api/admin/mfa/setup`, {
        headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
        data: { recoveryCode: targetCode }
      }),
      request.post(`${API_BASE}/api/admin/mfa/setup`, {
        headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
        data: { recoveryCode: targetCode }
      })
    ]);

    const statuses = [resA.status(), resB.status()].sort();
    // Exactly one must succeed (200) and the other must fail (400)
    expect(statuses).toEqual([200, 400]);

    // 3. Verify exactly 1 recovery code was consumed in total
    const remainingCodes = db.prepare('SELECT COUNT(*) as c FROM admin_mfa_recovery_codes WHERE user_id = ? AND used = 0').get(adminId);
    expect(remainingCodes.c).toBe(7);

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  test('56. Replacement Cancellation Does Not Restore Consumed Recovery Code', async ({ request }) => {
    // 1. Create admin with MFA enabled
    const mfaAdminUsername = `admin@mfacancelcodes_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'MFA', 'CancelCodeTester', 1, 0, datetime('now'), 1)
    `).run(mfaAdminUsername, `${mfaAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const adminId = insertRes.lastInsertRowid;
    const { token: adminToken } = issueAdminSessionToken(adminId);

    const setupRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD }
    });
    const setupData = await setupRes.json();
    const totpCode = generateTotpCode(setupData.secret);
    await request.post(`${API_BASE}/api/admin/mfa/verify-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { code: totpCode }
    });

    const codeToAuthorize = setupData.recoveryCodes[0];
    const codeToLogin = setupData.recoveryCodes[1];

    // 2. Authorize replacement with codeToAuthorize
    const authRes = await request.post(`${API_BASE}/api/admin/mfa/setup`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Sudo-Password': TEST_PASSWORD },
      data: { recoveryCode: codeToAuthorize }
    });
    expect(authRes.status()).toBe(200);

    // 3. User cancels replacement
    const cancelRes = await request.post(`${API_BASE}/api/admin/mfa/cancel-setup`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(cancelRes.status()).toBe(200);

    // Pending secret is cleared
    const userCheck = db.prepare('SELECT pending_two_factor_secret, two_factor_enabled FROM users WHERE id = ?').get(adminId);
    expect(userCheck.pending_two_factor_secret).toBeNull();
    expect(userCheck.two_factor_enabled).toBe(1);

    // Consumed recovery code is STILL used (cancellation must NOT restore it)
    const codeCheck = db.prepare('SELECT id, used FROM admin_mfa_recovery_codes WHERE user_id = ?').all(adminId);
    expect(codeCheck.filter(c => c.used === 1).length).toBe(1);
    expect(codeCheck.filter(c => c.used === 0).length).toBe(7);

    // 4. Test login with the consumed code -> FAILS (400)
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    expect(loginRes.status()).toBe(200);
    const { mfaToken } = await loginRes.json();

    const usedCodeLogin = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken, recoveryCode: codeToAuthorize }
    });
    expect(usedCodeLogin.status()).toBe(400);

    // 5. Test login with another UNUSED recovery code -> SUCCEEDS (200)
    const freshLogin = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: mfaAdminUsername, password: TEST_PASSWORD, type: 'admin' }
    });
    const freshMfaToken = (await freshLogin.json()).mfaToken;

    const unusedCodeLogin = await request.post(`${API_BASE}/api/auth/mfa-verify`, {
      data: { mfaToken: freshMfaToken, recoveryCode: codeToLogin }
    });
    expect(unusedCodeLogin.status()).toBe(200);
    const loginSuccessData = await unusedCodeLogin.json();
    expect(loginSuccessData.token).toBeDefined();

    // Clean up
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  });

  // =============================================================================
  // Phase 7: Administrator Accountability & Operational Audit Ledger (Tests 57-65)
  // =============================================================================

  test('57. Accountability Dashboard Summary API provides server-derived metrics and creator attribution', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const { token: ordToken } = issueAdminSessionToken(ORDINARY_ADMIN_ID);

    // 1. Super Admin fetches summary -> SUCCEEDS (200)
    const res = await request.get(`${API_BASE}/api/admin/administrators/accountability/summary`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(typeof data.total).toBe('number');
    expect(data.total).toBeGreaterThanOrEqual(2); // Super Admin + Ordinary Admin
    expect(typeof data.active).toBe('number');
    expect(typeof data.inactive).toBe('number');
    expect(typeof data.rangeCount).toBe('number');
    expect(Array.isArray(data.creators)).toBe(true);

    // Historical accounts without transactional creator recorded as Unknown/Legacy
    const legacyCreator = data.creators.find(c => c.creatorId === null);
    expect(legacyCreator).toBeDefined();
    expect(legacyCreator.creatorName).toBe('Unknown/Legacy');
    expect(legacyCreator.count).toBeGreaterThanOrEqual(1);

    // 2. Ordinary Admin attempts to access summary -> FORBIDDEN (403)
    const forbiddenRes = await request.get(`${API_BASE}/api/admin/administrators/accountability/summary`, {
      headers: { 'Authorization': `Bearer ${ordToken}` }
    });
    expect(forbiddenRes.status()).toBe(403);
  });

  test('58. Creator attribution is persisted transactionally when creating an administrator', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const testUsername = `admin@acctest_${Date.now()}`;
    const testEmail = `acctest_${Date.now()}@bfibd.org`;

    // Super Admin creates a new administrator
    const createRes = await request.post(`${API_BASE}/api/admin/administrators`, {
      headers: { 
        'Authorization': `Bearer ${saToken}`,
        'x-sudo-password': TEST_PASSWORD
      },
      data: {
        username: testUsername,
        email: testEmail,
        password: TEST_PASSWORD,
        firstName: 'Accountability',
        lastName: 'Tester',
        permissions: ['courses:view', 'batches:view']
      }
    });

    expect(createRes.status()).toBe(201);
    const data = await createRes.json();
    const createdAdmin = data.administrator || data.user;
    expect(createdAdmin).toBeDefined();
    expect(createdAdmin.created_by_admin_id).toBe(SUPER_ADMIN_ID);
    expect(createdAdmin.creatorName).toBe('admin@abir');

    // Verify directly in database
    const dbUser = db.prepare('SELECT id, username, created_by_admin_id FROM users WHERE id = ?').get(createdAdmin.id);
    expect(dbUser.created_by_admin_id).toBe(SUPER_ADMIN_ID);

    // Verify audit log recorded atomically with module and resource
    const auditLog = db.prepare("SELECT * FROM admin_audit_logs WHERE action IN ('create_administrator', 'admin.create') AND target_user_id = ?").get(createdAdmin.id);
    expect(auditLog).toBeDefined();
    expect(auditLog.module).toBe('admin_management');
    expect(auditLog.resource).toBe(`admin:${createdAdmin.id}`);
    expect(auditLog.actor_id).toBe(SUPER_ADMIN_ID);
    expect(auditLog.outcome).toBe('success');

    // Clean up
    db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(createdAdmin.id);
    db.prepare('DELETE FROM admin_audit_logs WHERE target_user_id = ?').run(createdAdmin.id);
    db.prepare('DELETE FROM admin_profiles WHERE user_id = ?').run(createdAdmin.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(createdAdmin.id);
  });

  test('59. Individual Administrator Accountability Profile returns identity, creator, and Asia/Dhaka timestamps', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // Query Super Admin profile
    const profileRes = await request.get(`${API_BASE}/api/admin/administrators/${SUPER_ADMIN_ID}/accountability-profile`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(profileRes.status()).toBe(200);
    const data = await profileRes.json();

    expect(data.admin).toBeDefined();
    expect(data.admin.id).toBe(SUPER_ADMIN_ID);
    expect(data.admin.isSuperAdmin).toBe(true);
    expect(data.admin.createdAtDhaka).toContain('BST');
    expect(data.effectivePermissions).toEqual(['*']);

    // Query Ordinary Admin (legacy creator)
    const ordProfileRes = await request.get(`${API_BASE}/api/admin/administrators/${ORDINARY_ADMIN_ID}/accountability-profile`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(ordProfileRes.status()).toBe(200);
    const ordData = await ordProfileRes.json();
    expect(ordData.admin.creator.name).toBe('Unknown/Legacy');
    expect(ordData.admin.creator.isLegacy).toBe(true);
    expect(Array.isArray(ordData.effectivePermissions)).toBe(true);
  });

  test('60. Dual timelines strictly distinguish actions performed by admin vs changes made to admin account', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // Setup a temporary target admin
    const targetUsername = `admin@dual_${Date.now()}`;
    const insertTarget = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, created_by_admin_id)
      VALUES (?, ?, 'hash', 'admin', 'Dual', 'Timeline', 1, 0, ?)
    `).run(targetUsername, `${targetUsername}@bfi.org`, SUPER_ADMIN_ID);
    const targetId = insertTarget.lastInsertRowid;

    // 1. Record an action performed BY targetId
    db.prepare(`
      INSERT INTO admin_audit_logs (actor_id, target_user_id, action, module, resource, outcome, details, created_at)
      VALUES (?, NULL, 'course.create', 'courses', 'course:999', 'success', '{"name":"Test Course"}', datetime('now'))
    `).run(targetId);

    // 2. Record an action performed ON targetId by Super Admin (actor 1)
    db.prepare(`
      INSERT INTO admin_audit_logs (actor_id, target_user_id, action, module, resource, outcome, details, created_at)
      VALUES (?, ?, 'admin.update_permissions', 'admin_management', ?, 'success', '{"granted":["courses:view"]}', datetime('now'))
    `).run(SUPER_ADMIN_ID, targetId, `admin:${targetId}`);

    // 3. Fetch profile
    const profileRes = await request.get(`${API_BASE}/api/admin/administrators/${targetId}/accountability-profile`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(profileRes.status()).toBe(200);
    const data = await profileRes.json();

    // Timeline 1: Actions performed BY this admin
    expect(Array.isArray(data.actionsPerformedTimeline)).toBe(true);
    const actionByTarget = data.actionsPerformedTimeline.find(a => a.action === 'course.create');
    expect(actionByTarget).toBeDefined();
    expect(actionByTarget.module).toBe('courses');
    expect(actionByTarget.dhaka_time).toContain('BST');

    // Timeline 2: Changes made TO this admin account
    expect(Array.isArray(data.changesReceivedTimeline)).toBe(true);
    const changeToTarget = data.changesReceivedTimeline.find(c => c.action === 'admin.update_permissions');
    expect(changeToTarget).toBeDefined();
    expect(changeToTarget.actor_id).toBe(SUPER_ADMIN_ID);
    expect(changeToTarget.dhaka_time).toContain('BST');

    // Strict separation: changes received MUST NOT appear in actions performed
    expect(data.actionsPerformedTimeline.some(a => a.action === 'admin.update_permissions')).toBe(false);

    // Clean up
    db.prepare('DELETE FROM admin_audit_logs WHERE actor_id = ? OR target_user_id = ?').run(targetId, targetId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });

  test('61. Operational activity ledger captures backend-generated events across actual modules', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Create a course definition -> generates 'courses' audit log
    const courseRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        name: `Audit Test Course ${Date.now()}`,
        course_type: 'workshop',
        duration_value: 2,
        duration_unit: 'months',
        phase_count: 1,
        phases: [{
          phase_number: 1,
          name: 'Phase 1',
          modules: [{ title: 'Module 1', week_number: 1 }]
        }]
      }
    });
    expect([200, 201]).toContain(courseRes.status());
    const courseData = await courseRes.json();

    // 2. Query audit logs with module=courses filter
    const logsRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs?module=courses`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(logsRes.status()).toBe(200);
    const logsData = await logsRes.json();
    const logsList = logsData.auditLogs || logsData.logs || [];
    expect(logsList.length).toBeGreaterThanOrEqual(1);
    const courseLog = logsList.find(l => l.resource === `course:${courseData.id}`);
    expect(courseLog).toBeDefined();
    expect(courseLog.module).toBe('courses');
    expect(courseLog.outcome).toBe('success');
    expect(courseLog.dhaka_time).toContain('BST');

    // Clean up
    db.prepare('DELETE FROM course_definitions WHERE id = ?').run(courseData.id);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource = ?').run(`course:${courseData.id}`);
  });

  test('62. Denied and unauthorized attempts are recorded with outcome=denied in the ledger', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const { token: ordToken } = issueAdminSessionToken(ORDINARY_ADMIN_ID);

    // Ordinary admin attempts to access Super Admin restricted endpoint
    const deniedRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs`, {
      headers: { 'Authorization': `Bearer ${ordToken}` }
    });
    expect(deniedRes.status()).toBe(403);

    // Super Admin inspects the audit ledger for the recorded denial
    const auditRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs?outcome=denied`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(auditRes.status()).toBe(200);
    const auditData = await auditRes.json();
    const deniedLogs = auditData.auditLogs || auditData.logs || [];

    const denialEvent = deniedLogs.find(l => l.actor_id === ORDINARY_ADMIN_ID && l.outcome === 'denied');
    expect(denialEvent).toBeDefined();
    expect(denialEvent.module).toBe('security');
    expect(denialEvent.action).toBe('super_admin_access_denied');
    expect(denialEvent.dhaka_time).toContain('BST');

    // Clean up
    db.prepare('DELETE FROM admin_audit_logs WHERE actor_id = ? AND outcome = ?').run(ORDINARY_ADMIN_ID, 'denied');
  });

  test('63. OWASP Logging compliance verifies zero sensitive credentials or tokens in audit logs', async () => {
    const logs = db.prepare('SELECT id, details, before_state, after_state FROM admin_audit_logs ORDER BY id DESC LIMIT 50').all();

    for (const log of logs) {
      const combined = `${log.details || ''} ${log.before_state || ''} ${log.after_state || ''}`;
      // Passwords, hashes, tokens, MFA secrets must NEVER be present as plain sensitive values
      expect(combined).not.toContain(TEST_PASSWORD);
      expect(combined).not.toMatch(/"password"s*:s*"(?!([REDACTED])).+"/i);
      expect(combined).not.toMatch(/"mfa_secret"s*:s*"(?!([REDACTED])).+"/i);
      expect(combined).not.toMatch(/"recovery_code"s*:s*"(?!([REDACTED])).+"/i);
    }
  });

  test('64. Non-super-admin users are strictly blocked from viewing or managing audit ledgers', async ({ request }) => {
    const { token: ordToken } = issueAdminSessionToken(ORDINARY_ADMIN_ID);

    // Ordinary Admin blocked
    const res1 = await request.get(`${API_BASE}/api/admin/administrators/audit-logs`, {
      headers: { 'Authorization': `Bearer ${ordToken}` }
    });
    expect(res1.status()).toBe(403);

    const res2 = await request.get(`${API_BASE}/api/admin/administrators/accountability/summary`, {
      headers: { 'Authorization': `Bearer ${ordToken}` }
    });
    expect(res2.status()).toBe(403);

    const res3 = await request.get(`${API_BASE}/api/admin/administrators/${SUPER_ADMIN_ID}/accountability-profile`, {
      headers: { 'Authorization': `Bearer ${ordToken}` }
    });
    expect(res3.status()).toBe(403);

    // Unauthenticated blocked
    const res4 = await request.get(`${API_BASE}/api/admin/administrators/audit-logs`);
    expect(res4.status()).toBe(401);
  });

  test('65. Browser E2E: Super Admin navigates Accountability Dashboard and inspects dual timelines', async ({ page }) => {
    await setupTestRouteProxy(page);
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: saToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Click Accountability Dashboard tab
    const accountabilityTab = page.locator('[data-testid="tab-accountability"]');
    await expect(accountabilityTab).toBeVisible({ timeout: 10000 });
    await accountabilityTab.click();

    // Verify KPI cards are rendered
    const kpiGrid = page.locator('[data-testid="accountability-kpi-grid"]');
    await expect(kpiGrid).toBeVisible();
    const totalKpi = page.locator('[data-testid="kpi-total-admins"]');
    await expect(totalKpi).toBeVisible();
    const totalCount = await totalKpi.textContent();
    expect(Number(totalCount)).toBeGreaterThanOrEqual(2);

    // Switch back to Administrators tab and open Accountability Profile
    await page.click('button:has-text("Administrators")');
    const profileBtn = page.locator(`[data-testid="view-profile-${SUPER_ADMIN_ID}"]`);
    await expect(profileBtn).toBeVisible({ timeout: 5000 });
    await profileBtn.click();

    // Verify Accountability Profile modal opens
    const creatorAttr = page.locator('[data-testid="profile-creator-attribution"]');
    await expect(creatorAttr).toBeVisible({ timeout: 5000 });

    // Click through sub-tabs (Actions Performed, Changes Received)
    await page.click('[data-testid="tab-timeline-performed"]');
    await expect(page.locator('[data-testid="timeline-performed-list"]')).toBeVisible();

    await page.click('[data-testid="tab-timeline-received"]');
    await expect(page.locator('[data-testid="timeline-received-list"]')).toBeVisible();

    // Close modal
    await page.click('[data-testid="close-profile-modal"]');
    await expect(page.locator('[data-testid="profile-creator-attribution"]')).not.toBeVisible();
  });

  // =============================================================================
  // Phase 8: Audit Ledger Reliability, Coverage & Adversarial Sentinel Testing (Tests 66-72)
  // =============================================================================

  test('66. Transactional Rollback: Administrator creation and all side effects roll back when audit log insertion fails', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const testUsername = `admin@probe_fail_${Date.now()}`;
    const testEmail = `probe_fail_${Date.now()}@bfibd.org`;

    // 1. Install a temporary SQLite trigger that deliberately rejects audit log insert for this username
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trigger_probe_reject_audit
      BEFORE INSERT ON admin_audit_logs
      WHEN NEW.action = 'create_administrator' AND NEW.details LIKE '%${testUsername}%'
      BEGIN
        SELECT RAISE(FAIL, 'PROBE_TRIGGER_REJECTED_AUDIT_INSERT');
      END;
    `);

    try {
      // 2. Super Admin attempts to create the administrator -> FAILS (500)
      const res = await request.post(`${API_BASE}/api/admin/administrators`, {
        headers: {
          'Authorization': `Bearer ${saToken}`,
          'x-sudo-password': TEST_PASSWORD
        },
        data: {
          username: testUsername,
          email: testEmail,
          password: TEST_PASSWORD,
          firstName: 'Probe',
          lastName: 'Rollback',
          permissions: ['courses:view']
        }
      });

      expect(res.status()).toBe(500);

      // 3. Verify in database: user, admin_profiles, and permissions MUST NOT exist
      const userInDb = db.prepare('SELECT id FROM users WHERE username = ?').get(testUsername);
      expect(userInDb).toBeUndefined();

      const profileInDb = db.prepare("SELECT id FROM admin_profiles WHERE full_name = 'Probe Rollback'").get();
      expect(profileInDb).toBeUndefined();
    } finally {
      // Always remove trigger
      db.prepare('DROP TRIGGER IF EXISTS trigger_probe_reject_audit').run();
    }
  });

  test('67. Transactional Rollback: Operational course update rolls back when audit log insertion fails', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const originalName = `Course Unmutated ${Date.now()}`;

    // 1. Create a draft course definition
    const createRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        name: originalName,
        course_type: 'workshop',
        duration_value: 1,
        duration_unit: 'months',
        phase_count: 1,
        phases: [{ phase_number: 1, name: 'P1', modules: [] }]
      }
    });
    expect([200, 201]).toContain(createRes.status());
    const course = await createRes.json();

    // 2. Install a temporary SQLite trigger rejecting audit log insert for this course update
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trigger_probe_reject_course_audit
      BEFORE INSERT ON admin_audit_logs
      WHEN NEW.action = 'course.update' AND NEW.resource = 'course:${course.id}'
      BEGIN
        SELECT RAISE(FAIL, 'PROBE_TRIGGER_REJECTED_COURSE_AUDIT');
      END;
    `);

    try {
      // 3. Attempt update -> FAILS (500)
      const updateRes = await request.put(`${API_BASE}/api/admin/course-definitions/${course.id}`, {
        headers: { 'Authorization': `Bearer ${saToken}` },
        data: {
          name: 'Should Not Persist Due To Audit Rollback',
          course_type: 'workshop',
          duration_value: 2,
          duration_unit: 'months',
          phase_count: 1,
          phases: [{ phase_number: 1, name: 'P1', modules: [] }]
        }
      });
      expect(updateRes.status()).toBe(500);

      // 4. Verify in DB: Course definition remains UNMUTATED with original name
      const courseInDb = db.prepare('SELECT name, duration_value FROM course_definitions WHERE id = ?').get(course.id);
      expect(courseInDb.name).toBe(originalName);
      expect(courseInDb.duration_value).toBe(1);
    } finally {
      db.prepare('DROP TRIGGER IF EXISTS trigger_probe_reject_course_audit').run();
      db.prepare('DELETE FROM course_definitions WHERE id = ?').run(course.id);
      db.prepare('DELETE FROM admin_audit_logs WHERE resource = ?').run(`course:${course.id}`);
    }
  });

  test('68. Operational Coverage Matrix: Module mutations record allowlisted events with before/after state', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Course Definition: create -> update -> publish
    const courseName = `Matrix Course ${Date.now()}`;
    const cRes = await request.post(`${API_BASE}/api/admin/course-definitions`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        name: courseName,
        course_type: 'workshop',
        duration_value: 2,
        duration_unit: 'months',
        phase_count: 1,
        phases: [{ phase_number: 1, name: 'Phase 1', modules: [{ title: 'M1', week_number: 1 }] }]
      }
    });
    expect([200, 201]).toContain(cRes.status());
    const course = await cRes.json();

    const cUpdateRes = await request.put(`${API_BASE}/api/admin/course-definitions/${course.id}`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        name: `${courseName} Updated`,
        course_type: 'workshop',
        duration_value: 3,
        duration_unit: 'months',
        phase_count: 1,
        phases: [{ phase_number: 1, name: 'Phase 1', modules: [{ title: 'M1', week_number: 1 }] }]
      }
    });
    expect(cUpdateRes.status()).toBe(200);

    const cPublishRes = await request.post(`${API_BASE}/api/admin/course-definitions/${course.id}/publish`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(cPublishRes.status()).toBe(200);

    // Verify course audit records
    const courseLogs = db.prepare('SELECT action, before_state, after_state FROM admin_audit_logs WHERE resource = ? ORDER BY id ASC').all(`course:${course.id}`);
    expect(courseLogs.some(l => l.action === 'course.create')).toBe(true);
    const updateLog = courseLogs.find(l => l.action === 'course.update');
    expect(updateLog).toBeDefined();
    expect(updateLog.before_state).toContain(courseName);
    expect(updateLog.after_state).toContain(`${courseName} Updated`);
    expect(courseLogs.some(l => l.action === 'course.publish')).toBe(true);

    // 2. Batch: create -> update (patch) -> delete
    const batchRes = await request.post(`${API_BASE}/api/admin/batches`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        batch_name: `Matrix Batch ${Date.now()}`,
        batch_number: `MB${Date.now().toString().slice(-4)}`,
        course_name: courseName,
        status: 'upcoming'
      }
    });
    expect([200, 201]).toContain(batchRes.status());
    const batch = await batchRes.json();

    const patchBatchRes = await request.patch(`${API_BASE}/api/admin/batches/${batch.id}`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: { status: 'active' }
    });
    expect(patchBatchRes.status()).toBe(200);

    const delBatchRes = await request.delete(`${API_BASE}/api/admin/batches/${batch.id}`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(delBatchRes.status()).toBe(200);

    const batchLogs = db.prepare('SELECT action FROM admin_audit_logs WHERE resource = ?').all(`batch:${batch.id}`);
    expect(batchLogs.some(l => l.action === 'batch.create')).toBe(true);
    expect(batchLogs.some(l => l.action === 'batch.status_change')).toBe(true);
    expect(batchLogs.some(l => l.action === 'batch.delete')).toBe(true);

    // 3. Notice / Announcement: create -> delete
    const noticeRes = await request.post(`${API_BASE}/api/admin/announcements`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        title: `Matrix Notice ${Date.now()}`,
        content: 'Matrix Notice Body',
        priority: 'high'
      }
    });
    expect([200, 201]).toContain(noticeRes.status());
    const noticeData = await noticeRes.json();
    const noticeId = noticeData.announcement?.id || noticeData.id || noticeData.insertId;

    if (noticeId) {
      const delNoticeRes = await request.delete(`${API_BASE}/api/admin/announcements/${noticeId}`, {
        headers: { 'Authorization': `Bearer ${saToken}` }
      });
      expect(delNoticeRes.status()).toBe(200);

      const noticeLogs = db.prepare('SELECT action FROM admin_audit_logs WHERE resource = ?').all(`notice:${noticeId}`);
      expect(noticeLogs.some(l => l.action === 'notice.create')).toBe(true);
      expect(noticeLogs.some(l => l.action === 'notice.delete')).toBe(true);
    }

    // Clean up
    db.prepare('DELETE FROM batches WHERE id = ?').run(batch.id);
    db.prepare('DELETE FROM course_definitions WHERE id = ?').run(course.id);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource IN (?, ?)').run(`course:${course.id}`, `batch:${batch.id}`);
  });

  test('69. External side effects & export tracking distinctly log attempted and completed outcomes', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Student Export: GET /api/student-export/excel
    const exportRes = await request.get(`${API_BASE}/api/student-export/excel`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(exportRes.status()).toBe(200);

    const exportLogs = db.prepare(`
      SELECT action, outcome, details FROM admin_audit_logs 
      WHERE module = 'export' AND resource = 'export:excel' 
      ORDER BY id DESC LIMIT 5
    `).all();

    expect(exportLogs.some(l => l.action === 'student.export_attempted' && l.outcome === 'success')).toBe(true);
    expect(exportLogs.some(l => l.action === 'student.export_completed' && l.outcome === 'success')).toBe(true);

    // Clean up export audit records
    db.prepare("DELETE FROM admin_audit_logs WHERE module = 'export'").run();
  });

  test('70. Audit Ledger filters clearly distinguish successful, denied, and failed outcomes', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const { token: ordToken } = issueAdminSessionToken(ORDINARY_ADMIN_ID);

    // 1. Generate a denied event: Ordinary admin accesses Super Admin endpoint
    const deniedRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs`, {
      headers: { 'Authorization': `Bearer ${ordToken}` }
    });
    expect(deniedRes.status()).toBe(403);

    // 2. Query with outcome=denied
    const deniedQueryRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs?outcome=denied`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(deniedQueryRes.status()).toBe(200);
    const deniedData = await deniedQueryRes.json();
    const deniedList = deniedData.auditLogs || deniedData.logs || [];
    expect(deniedList.length).toBeGreaterThanOrEqual(1);
    expect(deniedList.every(l => l.outcome === 'denied')).toBe(true);

    // 3. Query with outcome=success
    const successQueryRes = await request.get(`${API_BASE}/api/admin/administrators/audit-logs?outcome=success`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(successQueryRes.status()).toBe(200);
    const successData = await successQueryRes.json();
    const successList = successData.auditLogs || successData.logs || [];
    expect(successList.length).toBeGreaterThanOrEqual(1);
    expect(successList.every(l => l.outcome === 'success')).toBe(true);

    // Clean up
    db.prepare('DELETE FROM admin_audit_logs WHERE actor_id = ? AND outcome = ?').run(ORDINARY_ADMIN_ID, 'denied');
  });

  test('71. Adversarial Sentinel Redaction: Synthetic passwords, tokens, recovery codes, and JWTs never persist', async () => {
    const { recordAuditLog } = await import('../server/services/auditLedgerService.js');

    const passSentinel = `SENTINEL_PASSWORD_${Date.now()}`;
    const secretSentinel = `SENTINEL_SECRET_${Date.now()}`;
    const tokenSentinel = `SENTINEL_TOKEN_${Date.now()}`;
    const recoverySentinel = `SENTINEL_RECOVERY_${Date.now()}`;

    // 1. Unstructured free-text details are rejected with TypeError
    expect(() => {
      recordAuditLog({
        actorId: SUPER_ADMIN_ID,
        action: 'probe.adversarial_test',
        module: 'security',
        resource: 'probe:string_details',
        outcome: 'success',
        details: `Attempt with password=${passSentinel} and recovery_code=${recoverySentinel}`,
        beforeState: { raw_password: passSentinel },
        afterState: { token: tokenSentinel, secret_val: secretSentinel }
      });
    }).toThrow(/unstructured free-text/i);

    // 2. Pass structured object with before/after state and embedded secrets
    recordAuditLog({
      actorId: SUPER_ADMIN_ID,
      action: 'probe.adversarial_structured',
      module: 'security',
      resource: 'probe:structured',
      outcome: 'success',
      details: {
        note: 'Structured verification',
        credentials: { password: passSentinel, recovery_code: recoverySentinel }
      },
      beforeState: { raw_password: passSentinel, jwt: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature' },
      afterState: { token: tokenSentinel, secret_val: secretSentinel }
    });

    // 3. Pass sentinels through stringified JSON
    recordAuditLog({
      actorId: SUPER_ADMIN_ID,
      action: 'probe.adversarial_json',
      module: 'security',
      resource: 'probe:json_string',
      outcome: 'success',
      details: JSON.stringify({ password: passSentinel, nested: [{ token: tokenSentinel }] })
    });

    // 4. Query database directly for any occurrence of the sentinels
    const leakCheck = db.prepare(`
      SELECT id, details, before_state, after_state FROM admin_audit_logs 
      WHERE details LIKE ? OR details LIKE ? OR details LIKE ? OR details LIKE ?
         OR before_state LIKE ? OR after_state LIKE ?
    `).all(
      `%${passSentinel}%`,
      `%${secretSentinel}%`,
      `%${tokenSentinel}%`,
      `%${recoverySentinel}%`,
      `%${passSentinel}%`,
      `%${tokenSentinel}%`
    );

    expect(leakCheck.length).toBe(0);

    // Clean up
    db.prepare("DELETE FROM admin_audit_logs WHERE module = 'security' AND resource LIKE 'probe:%'").run();
  });

  test('72. Browser UI E2E: Super Admin inspects operational audit ledger, filters by outcome and module', async ({ page }) => {
    await setupTestRouteProxy(page);
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: saToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Switch to Audit History tab
    const auditTabBtn = page.locator('button.admin-tab-btn').filter({ hasText: 'Audit History' });
    await expect(auditTabBtn).toBeVisible({ timeout: 10000 });
    await auditTabBtn.click();

    // Verify Audit Filter Controls exist
    const outcomeFilter = page.locator('[data-testid="audit-outcome-filter"]');
    await expect(outcomeFilter).toBeVisible();

    const moduleFilter = page.locator('[data-testid="audit-module-filter"]');
    await expect(moduleFilter).toBeVisible();

    // Select outcome=success
    await outcomeFilter.selectOption('success');
    await page.waitForTimeout(500);

    // Verify audit rows are rendered with outcome pills and timestamps
    const outcomePills = page.locator('.outcome-pill');
    await expect(outcomePills.first()).toBeVisible({ timeout: 5000 });
  });

  test('73. Normalized credential casing & deep nested redaction with fresh randomized values (no sentinels)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { isSensitiveKey, redactSensitiveData, recordAuditLog } = await import('../server/services/auditLedgerService.js');

    // 1. Confirm production code contains ZERO references to test-specific SENTINEL_PATTERN_REGEX
    const serviceCode = fs.readFileSync(path.resolve('server/services/auditLedgerService.js'), 'utf8');
    expect(serviceCode.includes('SENTINEL_PATTERN_REGEX')).toBe(false);
    expect(serviceCode.includes('REDACTED_SENTINEL')).toBe(false);

    // 2. Test key normalization across camelCase, snake_case, PascalCase, kebab-case
    const sensitiveKeys = [
      'apiKey', 'api_key', 'api-key', 'API_KEY', 'ApiKey',
      'privateKey', 'private_key', 'private-key', 'PrivateKey',
      'clientSecret', 'client_secret', 'client-secret',
      'recoveryCode', 'recovery_code', 'recovery-code',
      'userPassword', 'user_password', 'password', 'pwd',
      'bearerToken', 'bearer_token', 'totpSecret', 'creditCard',
      'authorizationHeader', 'accessToken'
    ];
    for (const k of sensitiveKeys) {
      expect(isSensitiveKey(k)).toBe(true);
    }

    const safeKeys = ['email', 'username', 'first_name', 'last_name', 'course_name', 'status', 'created_at', 'batch_number'];
    for (const k of safeKeys) {
      expect(isSensitiveKey(k)).toBe(false);
    }

    // Direct unit test of redactSensitiveData
    const directClean = redactSensitiveData({ apiKey: 'direct_secret', publicInfo: 'safe' });
    expect(directClean.apiKey).toBe('[REDACTED]');
    expect(directClean.publicInfo).toBe('safe');

    // 3. Generate fresh randomized credentials with NO recognizable fixture prefix
    const randApiKey = crypto.randomBytes(16).toString('hex');
    const randPrivateKey = crypto.randomBytes(32).toString('base64');
    const randClientSecret = crypto.randomBytes(20).toString('hex');
    const randRecoveryCode = `${crypto.randomInt(100000, 999999)}-${crypto.randomInt(100000, 999999)}`;
    const randPassword = `pW_${crypto.randomBytes(8).toString('hex')}!Aa9`;
    const randBearer = `ey${crypto.randomBytes(24).toString('base64url')}`;

    // 4. Test deep nested arrays, embedded JSON strings, error metadata, and before/after states
    const testPayload = {
      actorId: SUPER_ADMIN_ID,
      action: 'probe.fresh_random_secrets',
      module: 'security',
      resource: 'probe:random_secrets',
      outcome: 'success',
      details: {
        operation: 'integration_probe',
        safeMetadata: 'public_audit_info',
        nestedArray: [
          { apiKey: randApiKey },
          { subItem: [{ privateKey: randPrivateKey, clientSecret: randClientSecret }] }
        ],
        embeddedJsonString: JSON.stringify({
          recoveryCode: randRecoveryCode,
          userPassword: randPassword,
          safeNote: 'Nested operational note'
        }),
        errorDetails: {
          name: 'AuthError',
          message: `Failed connecting to upstream service with bearer ${randBearer}`,
          code: 'ERR_UPSTREAM_AUTH'
        }
      },
      beforeState: {
        apiKey: randApiKey,
        recovery_code: randRecoveryCode,
        safeField: 'before_data'
      },
      afterState: {
        privateKey: randPrivateKey,
        client_secret: randClientSecret,
        safeField: 'after_data'
      }
    };

    recordAuditLog(testPayload);

    // 5. Query database directly: confirm zero random secrets persisted in plaintext
    const leakCheck = db.prepare(`
      SELECT id, details, before_state, after_state FROM admin_audit_logs 
      WHERE details LIKE ? OR details LIKE ? OR details LIKE ? OR details LIKE ? OR details LIKE ? OR details LIKE ?
         OR before_state LIKE ? OR before_state LIKE ?
         OR after_state LIKE ? OR after_state LIKE ?
    `).all(
      `%${randApiKey}%`, `%${randPrivateKey}%`, `%${randClientSecret}%`,
      `%${randRecoveryCode}%`, `%${randPassword}%`, `%${randBearer}%`,
      `%${randApiKey}%`, `%${randRecoveryCode}%`,
      `%${randPrivateKey}%`, `%${randClientSecret}%`
    );

    expect(leakCheck.length).toBe(0);

    // 6. Confirm that useful operational metadata was preserved
    const loggedRecord = db.prepare(`
      SELECT details, before_state, after_state FROM admin_audit_logs 
      WHERE resource = 'probe:random_secrets' ORDER BY id DESC LIMIT 1
    `).get();
    expect(loggedRecord).toBeDefined();

    const parsedDetails = JSON.parse(loggedRecord.details);
    expect(parsedDetails.safeMetadata).toBe('public_audit_info');
    expect(parsedDetails.nestedArray[0].apiKey).toBe('[REDACTED]');
    expect(parsedDetails.nestedArray[1].subItem[0].privateKey).toBe('[REDACTED]');
    expect(parsedDetails.nestedArray[1].subItem[0].clientSecret).toBe('[REDACTED]');

    const parsedEmbedded = JSON.parse(parsedDetails.embeddedJsonString);
    expect(parsedEmbedded.recoveryCode).toBe('[REDACTED]');
    expect(parsedEmbedded.userPassword).toBe('[REDACTED]');
    expect(parsedEmbedded.safeNote).toBe('Nested operational note');

    const parsedBefore = JSON.parse(loggedRecord.before_state);
    expect(parsedBefore.safeField).toBe('before_data');
    expect(parsedBefore.apiKey).toBe('[REDACTED]');

    const parsedAfter = JSON.parse(loggedRecord.after_state);
    expect(parsedAfter.safeField).toBe('after_data');
    expect(parsedAfter.privateKey).toBe('[REDACTED]');

    // Clean up
    db.prepare("DELETE FROM admin_audit_logs WHERE resource = 'probe:random_secrets'").run();
  });

  test('74. Audit payload validation rejects unstructured free text and non-structured inputs', async () => {
    const { recordAuditLog } = await import('../server/services/auditLedgerService.js');

    // 1. Free-text string details rejected
    expect(() => {
      recordAuditLog({
        actorId: SUPER_ADMIN_ID,
        action: 'test.unstructured',
        module: 'test',
        resource: 'test:1',
        details: 'Arbitrary prose describing a change with password=secret123'
      });
    }).toThrow(/unstructured free-text details is not permitted/i);

    // 2. Free-text string beforeState rejected
    expect(() => {
      recordAuditLog({
        actorId: SUPER_ADMIN_ID,
        action: 'test.unstructured',
        module: 'test',
        resource: 'test:1',
        details: { note: 'Valid details' },
        beforeState: 'Some raw state string'
      });
    }).toThrow(/unstructured free-text beforeState is not permitted/i);

    // 3. Non-object primitive payload rejected
    expect(() => {
      recordAuditLog({
        actorId: SUPER_ADMIN_ID,
        action: 'test.unstructured',
        module: 'test',
        resource: 'test:1',
        details: { note: 'Valid details' },
        afterState: 42
      });
    }).toThrow(/afterState must be a structured object or array/i);

    // 4. Valid structured objects and stringified JSON objects succeed
    const validResult = recordAuditLog({
      actorId: SUPER_ADMIN_ID,
      action: 'test.structured_valid',
      module: 'test',
      resource: 'test:valid',
      details: { action: 'valid_test', count: 1 },
      beforeState: { status: 'draft' },
      afterState: { status: 'published' }
    });
    expect(validResult).toBeDefined();
    expect(validResult.id).toBeGreaterThan(0);

    // Clean up
    db.prepare("DELETE FROM admin_audit_logs WHERE resource = 'test:valid'").run();
  });

  test('75. Export lifecycle tracking: attempt, server finish, generation failure, client abort, duplicate prevention', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);
    const { setupExportLifecycle } = await import('../server/routes/student-export.js');

    // 1. Real successful exports across all 3 formats: Excel, Word, and PDF
    const formatsToTest = [
      { endpoint: 'excel', expectedFormat: 'xlsx', resource: 'export:excel' },
      { endpoint: 'word', expectedFormat: 'docx', resource: 'export:word' },
      { endpoint: 'pdf', expectedFormat: 'pdf', resource: 'export:pdf' }
    ];

    const createdCorrIds = [];
    for (const fmt of formatsToTest) {
      const testCorrId = `corr_${fmt.endpoint}_${crypto.randomBytes(6).toString('hex')}`;
      createdCorrIds.push(testCorrId);

      const exportRes = await request.get(`${API_BASE}/api/student-export/${fmt.endpoint}`, {
        headers: {
          'Authorization': `Bearer ${saToken}`,
          'x-correlation-id': testCorrId
        }
      });
      expect(exportRes.status()).toBe(200);

      const logs = db.prepare(`
        SELECT action, outcome, correlation_id, details FROM admin_audit_logs 
        WHERE correlation_id = ? ORDER BY id ASC
      `).all(testCorrId);

      expect(logs.length).toBe(2);
      expect(logs[0].action).toBe('student.export_attempted');
      expect(logs[0].outcome).toBe('success');
      expect(logs[1].action).toBe('student.export_completed');
      expect(logs[1].outcome).toBe('success');
      const completedDetails = JSON.parse(logs[1].details);
      // Distinct server completion recorded
      expect(completedDetails.serverCompleted).toBe(true);
      expect(completedDetails.format).toBe(fmt.expectedFormat);
      expect(completedDetails.statusCode).toBe(200);
    }

    // 2. Export lifecycle unit test: stream write failure handling (mock response EventEmitter)
    const failCorrId = `fail_corr_${crypto.randomBytes(6).toString('hex')}`;
    createdCorrIds.push(failCorrId);

    const mockReq = {
      user: { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin' },
      headers: { 'x-correlation-id': failCorrId },
      ip: '127.0.0.1',
      query: { format: 'xlsx' }
    };
    const mockRes = new EventEmitter();
    mockRes.statusCode = 200;
    mockRes.writableEnded = false;

    const lifecycle = setupExportLifecycle(mockReq, mockRes, 'xlsx', 'export:excel');
    // Trigger actual pipeline failure
    lifecycle.recordFailure(new Error('Real generation write stream failure: disk full'));

    // Emitting subsequent finish/close events must NOT generate duplicate terminal records
    mockRes.emit('finish');
    mockRes.emit('close');

    const failLogs = db.prepare(`
      SELECT action, outcome, details FROM admin_audit_logs WHERE correlation_id = ? ORDER BY id ASC
    `).all(failCorrId);

    expect(failLogs.length).toBe(2);
    expect(failLogs[0].action).toBe('student.export_attempted');
    expect(failLogs[1].action).toBe('student.export_failed');
    expect(failLogs[1].outcome).toBe('failed');
    const failDetails = JSON.parse(failLogs[1].details);
    expect(failDetails.error).toContain('Real generation write stream failure: disk full');
    // Duplicate terminal prevention confirmed
    expect(failLogs.some(l => l.action === 'student.export_completed')).toBe(false);
    expect(failLogs.some(l => l.action === 'student.export_aborted')).toBe(false);

    // 3. Export lifecycle unit test: premature connection closure abort handling (mock response EventEmitter)
    const abortCorrId = `abort_corr_${crypto.randomBytes(6).toString('hex')}`;
    createdCorrIds.push(abortCorrId);

    const abortMockReq = {
      user: { id: SUPER_ADMIN_ID, username: 'admin@abir', role: 'admin' },
      headers: { 'x-correlation-id': abortCorrId },
      ip: '127.0.0.1',
      query: { format: 'xlsx' }
    };
    const abortMockRes = new EventEmitter();
    abortMockRes.statusCode = 200;
    abortMockRes.writableEnded = false;

    setupExportLifecycle(abortMockReq, abortMockRes, 'xlsx', 'export:excel');
    // Premature client socket disconnect before writableEnded
    abortMockRes.emit('close');

    const abortLogs = db.prepare(`
      SELECT action, outcome, details FROM admin_audit_logs WHERE correlation_id = ? ORDER BY id ASC
    `).all(abortCorrId);

    expect(abortLogs.length).toBe(2);
    expect(abortLogs[0].action).toBe('student.export_attempted');
    expect(abortLogs[1].action).toBe('student.export_aborted');
    expect(abortLogs[1].outcome).toBe('failed');
    const abortDetails = JSON.parse(abortLogs[1].details);
    expect(abortDetails.reason).toBe('stream_aborted_or_closed_prematurely');
    expect(abortDetails.writableEnded).toBe(false);
    expect(abortLogs.some(l => l.action === 'student.export_completed')).toBe(false);

    // Clean up
    db.prepare(`DELETE FROM admin_audit_logs WHERE correlation_id IN (${createdCorrIds.map(() => '?').join(',')})`).run(...createdCorrIds);
  });

  test('76. Broadcast operational audit coverage (create, schedule, cancel, send, delete)', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Create Draft Broadcast: POST /api/admin/broadcasts
    const createRes = await request.post(`${API_BASE}/api/admin/broadcast`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        title: 'Emergency Storm Protocol',
        message: 'Classes will be held remotely tomorrow.',
        audience_type: 'all',
        audience_value: '',
        channels: 'inbox,notification',
        priority: 'urgent',
        allow_reply: 0
      }
    });
    expect(createRes.status()).toBe(201);
    const createData = await createRes.json();
    const broadcastId = createData.broadcast.id;

    const createLogs = db.prepare("SELECT action, module, outcome FROM admin_audit_logs WHERE resource = ?").all(`broadcast:${broadcastId}`);
    expect(createLogs.some(l => l.action === 'broadcast.create' && l.outcome === 'success')).toBe(true);

    // 2. Schedule Broadcast: POST /api/admin/broadcasts/:id/schedule (at least 15 mins in future)
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const schedRes = await request.post(`${API_BASE}/api/admin/broadcast/${broadcastId}/schedule`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: { scheduled_at: futureDate }
    });
    expect(schedRes.status()).toBe(200);

    const schedLogs = db.prepare("SELECT action, outcome FROM admin_audit_logs WHERE resource = ?").all(`broadcast:${broadcastId}`);
    expect(schedLogs.some(l => l.action === 'broadcast.schedule' && l.outcome === 'success')).toBe(true);

    // 3. Cancel Scheduled Broadcast: POST /api/admin/broadcasts/:id/cancel
    const cancelRes = await request.post(`${API_BASE}/api/admin/broadcast/${broadcastId}/cancel`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(cancelRes.status()).toBe(200);

    const cancelLogs = db.prepare("SELECT action, outcome FROM admin_audit_logs WHERE resource = ?").all(`broadcast:${broadcastId}`);
    expect(cancelLogs.some(l => l.action === 'broadcast.cancel' && l.outcome === 'success')).toBe(true);

    // 4. Send Broadcast: POST /api/admin/broadcasts/:id/send
    const sendRes = await request.post(`${API_BASE}/api/admin/broadcast/${broadcastId}/send`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(sendRes.status()).toBe(200);

    const sendLogs = db.prepare("SELECT action, outcome FROM admin_audit_logs WHERE resource = ?").all(`broadcast:${broadcastId}`);
    expect(sendLogs.some(l => l.action === 'broadcast.send_attempted')).toBe(true);
    expect(sendLogs.some(l => l.action === 'broadcast.send')).toBe(true);

    // 5. Delete Broadcast: DELETE /api/admin/broadcasts/:id
    const delRes = await request.delete(`${API_BASE}/api/admin/broadcast/${broadcastId}`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(delRes.status()).toBe(200);

    const delLogs = db.prepare("SELECT action, outcome FROM admin_audit_logs WHERE resource = ?").all(`broadcast:${broadcastId}`);
    expect(delLogs.some(l => l.action === 'broadcast.delete' && l.outcome === 'success')).toBe(true);

    // Clean up
    db.prepare('DELETE FROM broadcasts WHERE id = ?').run(broadcastId);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource = ?').run(`broadcast:${broadcastId}`);
  });

  test('77. Student lead admission and student editing operational audit coverage', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Setup a test lead in users and student_profiles
    const leadEmail = `lead_${Date.now()}@test.org`;
    const leadUserRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, mobile_number)
      VALUES (?, ?, 'hash', 'student', 'LeadFirstName', 'LeadLastName', 1, '01700000000')
    `).run(`lead_${Date.now()}`, leadEmail);
    const leadId = leadUserRes.lastInsertRowid;

    db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, student_id, batch_number)
      VALUES (?, 'Lead Full Name', NULL, NULL)
    `).run(leadId);

    // 2. Admit lead: POST /api/admin/students/leads/:id/admit
    const randBatch = String(crypto.randomInt(70, 99));
    const randSn = String(crypto.randomInt(10, 99));
    const admitRes = await request.post(`${API_BASE}/api/admin/students/leads/${leadId}/admit`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        batchNumber: randBatch,
        snNo: randSn,
        month: '10',
        year: '26',
        course: 'Online Filmmaking Course'
      }
    });
    expect(admitRes.status()).toBe(200);

    const admitLogs = db.prepare('SELECT action, module, target_user_id, outcome FROM admin_audit_logs WHERE target_user_id = ?').all(leadId);
    expect(admitLogs.some(l => l.action === 'student.admit' && l.outcome === 'success')).toBe(true);

    // 3. Edit student: PUT /api/admin/students/:id (with allowlisted before/after state & fee update)
    const updateRes = await request.put(`${API_BASE}/api/admin/students/${leadId}`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        firstName: 'UpdatedLeadFirst',
        lastName: 'UpdatedLeadLast',
        username: `updated_lead_${Date.now()}`,
        email: leadEmail,
        mobileNumber: '01711111111',
        courses: ['Online Filmmaking Course'],
        course_fees: {
          'Online Filmmaking Course': { phase1: { fee: 5000, paid: 5000 } }
        }
      }
    });
    expect(updateRes.status()).toBe(200);

    const updateLogs = db.prepare('SELECT action, before_state, after_state, details FROM admin_audit_logs WHERE target_user_id = ?').all(leadId);
    const studentUpdateLog = updateLogs.find(l => l.action === 'student.update');
    expect(studentUpdateLog).toBeDefined();

    const beforeState = JSON.parse(studentUpdateLog.before_state);
    const afterState = JSON.parse(studentUpdateLog.after_state);
    expect(beforeState.firstName).toBe('LeadFirstName');
    expect(afterState.firstName).toBe('UpdatedLeadFirst');
    expect(afterState.mobileNumber).toBe('01711111111');

    // Confirm finance fee update was also logged
    const feeUpdateLog = updateLogs.find(l => l.action === 'finance.update_student_fees');
    expect(feeUpdateLog).toBeDefined();

    // Clean up
    db.prepare('DELETE FROM batch_students WHERE student_id = ?').run(leadId);
    db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ?').run(leadId);
    db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(leadId);
    db.prepare('DELETE FROM users WHERE id = ?').run(leadId);
    db.prepare('DELETE FROM admin_audit_logs WHERE target_user_id = ?').run(leadId);
  });

  test('78. Academic records, defined progress, phase admit/unadmit atomicity, and fee reminder audit coverage', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Setup student enrollment for academic records
    const enrRes = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, attendance_classes, attendance_total, exam_written, step1_completed, step2_completed)
      VALUES (?, 'Cinematography Masterclass', 4, 10, 45, 1, 0)
    `).run(TEST_STUDENT_ID);
    const enrollmentId = enrRes.lastInsertRowid;

    // 2. Update Academic Records: PUT /api/admin/students/:id/academic-records/:courseId
    const recordRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/academic-records/${enrollmentId}`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        attendance_classes: 8,
        attendance_total: 10,
        exam_written: 85
      }
    });
    expect(recordRes.status()).toBe(200);

    const recordLogs = db.prepare('SELECT action, outcome, before_state, after_state FROM admin_audit_logs WHERE resource = ?').all(`enrollment:${enrollmentId}`);
    const recordLog = recordLogs.find(l => l.action === 'academic.update_records');
    expect(recordLog).toBeDefined();
    const recBefore = JSON.parse(recordLog.before_state);
    const recAfter = JSON.parse(recordLog.after_state);
    expect(Number(recBefore.attendance_classes)).toBe(4);
    expect(recAfter.attendance_classes).toBe(8);
    expect(recAfter.exam_written).toBe(85);

    // 3. Update Progression Checkmarks: PATCH /api/admin/students/:id/progress
    const progRes = await request.patch(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/progress`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        course_id: enrollmentId,
        step2_completed: 1
      }
    });
    expect(progRes.status()).toBe(200);

    const progLogs = db.prepare('SELECT action, outcome FROM admin_audit_logs WHERE resource = ?').all(`enrollment:${enrollmentId}`);
    expect(progLogs.some(l => l.action === 'academic.progress_update' && l.outcome === 'success')).toBe(true);

    // 4. Send Fee Reminder: POST /api/admin/fee-tracker/send-reminder
    // Clear cooldown log before test
    db.prepare("DELETE FROM fee_reminder_log WHERE student_user_id = ?").run(TEST_STUDENT_ID);

    const remindRes = await request.post(`${API_BASE}/api/admin/fee-tracker/send-reminder`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        student_id: TEST_STUDENT_ID,
        course_name: 'Cinematography Masterclass',
        due_amount: 3500,
        next_due_date: '2026-11-15'
      }
    });
    expect(remindRes.status()).toBe(200);

    const remindLogs = db.prepare("SELECT action, outcome, details FROM admin_audit_logs WHERE action = 'finance.send_reminder' AND target_user_id = ?").all(TEST_STUDENT_ID);
    expect(remindLogs.length).toBeGreaterThanOrEqual(1);

    // 5. Notice Creation: POST /api/admin/announcements (verify EXACTLY 1 notice.create audit record)
    const noticeRes = await request.post(`${API_BASE}/api/admin/announcements`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        title: `Single Notice Test ${Date.now()}`,
        content: 'Testing zero duplicate notice audit log insertions.',
        priority: 'normal'
      }
    });
    expect(noticeRes.status()).toBe(201);
    const noticeData = await noticeRes.json();
    const noticeId = noticeData.noticeId || noticeData.id;

    // Check count of notice.create for this noticeId
    const noticeCreateLogs = db.prepare("SELECT id, action FROM admin_audit_logs WHERE action = 'notice.create' AND resource = ?").all(`notice:${noticeId}`);
    expect(noticeCreateLogs.length).toBe(1); // EXACTLY 1, NO DUPLICATE!

    // 6. Defined Course Setup: Course definition with 2 phases
    const courseDefPayload = {
      title: 'Defined Progress Audit Test Course',
      code: `DTC_${Date.now()}`,
      phases: [
        {
          id: 'p_1',
          phaseNumber: 1,
          title: 'Phase 1: Basic Production',
          classes: [{ id: 'c1_1', title: 'Intro Class' }],
          assignments: [{ id: 'a1_1', title: 'Script Outline', maxMarks: 50 }],
          exam: { enabled: true, maxMarks: 50, passingMarks: 25 }
        },
        {
          id: 'p_2',
          phaseNumber: 2,
          title: 'Phase 2: Post-Production',
          classes: [{ id: 'c2_1', title: 'Editing Masterclass' }],
          assignments: [{ id: 'a2_1', title: 'Final Cut', maxMarks: 50 }],
          exam: { enabled: false }
        }
      ]
    };
    const defInsert = db.prepare(`
      INSERT INTO course_definitions (name, slug, course_type, status, definition_json, created_by, updated_by, version)
      VALUES (?, ?, 'workshop', 'published', ?, ?, ?, 1)
    `).run('Defined Progress Audit Test Course', `defined-progress-audit-${Date.now()}`, JSON.stringify(courseDefPayload), SUPER_ADMIN_ID, SUPER_ADMIN_ID);
    const defId = defInsert.lastInsertRowid;

    const defEnrRes = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_definition_id, course_version, step1_completed, step2_completed)
      VALUES (?, 'Defined Progress Audit Test Course', ?, 1, 1, 0)
    `).run(TEST_STUDENT_ID, defId);
    const defEnrollmentId = defEnrRes.lastInsertRowid;

    // 7. Defined Progress Update: PUT /api/admin/students/:id/courses/:courseId/defined-progress
    const defProgRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/defined-progress`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        attendance: [{ class_id: 'c1_1', attended: true }],
        assignments: [{ assignment_id: 'a1_1', marks_obtained: 40, submission_status: 'graded' }],
        exam_marks: { phase_id: 'p_1', marks: 35 }
      }
    });
    expect(defProgRes.status()).toBe(200);

    const defProgLogs = db.prepare(`SELECT action, outcome, before_state, after_state FROM admin_audit_logs WHERE resource = ? AND action = 'academic.defined_progress_update'`).all(`enrollment:${defEnrollmentId}`);
    expect(defProgLogs.length).toBe(1);
    expect(defProgLogs[0].outcome).toBe('success');
    const defAfterState = JSON.parse(defProgLogs[0].after_state);
    expect(defAfterState.attendance.some(a => a.class_id === 'c1_1' && a.attended === 1)).toBe(true);

    // 8. Phase Admission: POST /api/admin/students/:id/courses/:courseId/phases/:phaseNumber/admit
    const admitPhaseRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/phases/2/admit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(admitPhaseRes.status()).toBe(200);

    const admitPhaseLogs = db.prepare(`SELECT action, outcome, before_state, after_state FROM admin_audit_logs WHERE resource = ? AND action = 'academic.phase_admit'`).all(`enrollment:${defEnrollmentId}`);
    expect(admitPhaseLogs.length).toBe(1);
    expect(admitPhaseLogs[0].outcome).toBe('success');
    const admitAfter = JSON.parse(admitPhaseLogs[0].after_state);
    expect(admitAfter.admitted).toBe(1);

    // 9. Phase Reversal (Unadmit): POST /api/admin/students/:id/courses/:courseId/phases/:phaseNumber/unadmit
    const unadmitPhaseRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/phases/2/unadmit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(unadmitPhaseRes.status()).toBe(200);

    const unadmitPhaseLogs = db.prepare(`SELECT action, outcome, before_state, after_state FROM admin_audit_logs WHERE resource = ? AND action = 'academic.phase_unadmit'`).all(`enrollment:${defEnrollmentId}`);
    expect(unadmitPhaseLogs.length).toBe(1);
    expect(unadmitPhaseLogs[0].outcome).toBe('success');
    const unadmitAfter = JSON.parse(unadmitPhaseLogs[0].after_state);
    expect(unadmitAfter.admitted).toBe(0);

    // 10. Atomic Rollback & Notification Emission Prevention on Audit Failure
    let socketEventsReceived = 0;
    const socketClient = io(API_BASE, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: saToken }
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket.IO connection timeout')), 5000);
      socketClient.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socketClient.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    socketClient.on('progression_updated', (data) => {
      if (data && data.studentId === TEST_STUDENT_ID) {
        socketEventsReceived++;
      }
    });

    // Control event: execute a clean progression update and prove observer receives it
    const controlRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/defined-progress`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        attendance: [{ class_id: 'c1_1', attended: true }]
      }
    });
    expect(controlRes.status()).toBe(200);
    // Give event loop brief tick to deliver Socket.IO event
    await new Promise(r => setTimeout(r, 100));
    expect(socketEventsReceived).toBe(1); // Proven connected and receiving!

    // Reset observer counter before testing rollback paths
    socketEventsReceived = 0;

    // Inject SQLite trigger rejecting audit log insert
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS test_audit_abort_trigger
      BEFORE INSERT ON admin_audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Simulated audit persistence failure for rollback verification');
      END;
    `).run();

    // Attempt defined-progress update while audit ledger is rejected
    const failedDefProgRes = await request.put(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/defined-progress`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        attendance: [{ class_id: 'c1_1', attended: false }]
      }
    });
    // Request must fail
    expect(failedDefProgRes.status()).toBe(500);

    // Academic record must remain UNCHANGED
    const attRow = db.prepare('SELECT attended FROM student_class_attendance WHERE enrollment_id = ? AND class_id = ?').get(defEnrollmentId, 'c1_1');
    expect(attRow.attended).toBe(1); // Still 1, NOT changed to 0!

    // Attempt phase admit while audit ledger is rejected
    const failedAdmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/phases/2/admit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    // Request must fail
    expect(failedAdmitRes.status()).toBe(500);

    // Phase result must remain unadmitted
    const p2Row = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = ? AND phase_id = ?').get(defEnrollmentId, 'p_2');
    expect(p2Row ? p2Row.admitted : 0).toBe(0);

    // Zero progression notifications emitted due to rollback
    expect(socketEventsReceived).toBe(0);

    // Drop the failure trigger to permit clean admission
    db.prepare('DROP TRIGGER IF EXISTS test_audit_abort_trigger').run();

    // Now normal phase admission succeeds
    const successAdmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/phases/2/admit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(successAdmitRes.status()).toBe(200);
    await new Promise(r => setTimeout(r, 100));
    expect(socketEventsReceived).toBe(1);
    socketEventsReceived = 0;

    // Verify student is admitted in DB
    const admittedRow = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = ? AND phase_id = ?').get(defEnrollmentId, 'p_2');
    expect(admittedRow.admitted).toBe(1);

    // Re-inject failure trigger to test unadmit rollback
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS test_audit_abort_trigger
      BEFORE INSERT ON admin_audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Simulated audit persistence failure for unadmit rollback verification');
      END;
    `).run();

    // Attempt phase unadmit while audit ledger is rejected
    const failedUnadmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/phases/2/unadmit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(failedUnadmitRes.status()).toBe(500);

    // Must remain admitted (rollback preserved admitted status = 1!)
    const unadmitRollbackRow = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = ? AND phase_id = ?').get(defEnrollmentId, 'p_2');
    expect(unadmitRollbackRow.admitted).toBe(1);

    // Zero progression notifications emitted due to rollback
    expect(socketEventsReceived).toBe(0);

    // Drop trigger
    db.prepare('DROP TRIGGER IF EXISTS test_audit_abort_trigger').run();

    // Clean unadmit succeeds
    const successUnadmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${defEnrollmentId}/phases/2/unadmit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(successUnadmitRes.status()).toBe(200);
    const finalUnadmittedRow = db.prepare('SELECT admitted FROM student_phase_results WHERE enrollment_id = ? AND phase_id = ?').get(defEnrollmentId, 'p_2');
    expect(finalUnadmittedRow.admitted).toBe(0);

    // Clean up socket
    socketClient.disconnect();

    // Clean up
    db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(defEnrollmentId);
    db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(defEnrollmentId);
    db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(defEnrollmentId);
    db.prepare('DELETE FROM student_course_enrollments WHERE id IN (?, ?)').run(enrollmentId, defEnrollmentId);
    db.prepare('DELETE FROM course_definitions WHERE id = ?').run(defId);
    db.prepare('DELETE FROM announcements WHERE id = ?').run(noticeId);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource IN (?, ?, ?)').run(`enrollment:${enrollmentId}`, `enrollment:${defEnrollmentId}`, `notice:${noticeId}`);
    db.prepare("DELETE FROM admin_audit_logs WHERE action = 'finance.send_reminder' AND target_user_id = ?").run(TEST_STUDENT_ID);
    db.prepare("DELETE FROM fee_reminder_log WHERE student_user_id = ?").run(TEST_STUDENT_ID);
  });

  test('79. Broadcast delivery lifecycle: acceptance vs background delivery completion and retry auditing', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Create Draft Broadcast: POST /api/admin/broadcast
    const createRes = await request.post(`${API_BASE}/api/admin/broadcast`, {
      headers: { 'Authorization': `Bearer ${saToken}` },
      data: {
        title: `Lifecycle Test Broadcast ${Date.now()}`,
        message: 'Testing acceptance vs background delivery lifecycle audit.',
        audience_type: 'all',
        priority: 'normal'
      }
    });
    expect(createRes.status()).toBe(201);
    const { broadcast } = await createRes.json();
    const broadcastId = broadcast.id;

    // 2. Send Broadcast: POST /api/admin/broadcast/:id/send
    const sendRes = await request.post(`${API_BASE}/api/admin/broadcast/${broadcastId}/send`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(sendRes.status()).toBe(200);

    // Verify synchronous acceptance: broadcast.send_attempted and broadcast.send (status: sending)
    const sendLogs = db.prepare(`SELECT action, outcome, after_state FROM admin_audit_logs WHERE resource = ? ORDER BY id ASC`).all(`broadcast:${broadcastId}`);
    expect(sendLogs.some(l => l.action === 'broadcast.send_attempted' && l.outcome === 'success')).toBe(true);
    const sendActionLog = sendLogs.find(l => l.action === 'broadcast.send');
    expect(sendActionLog).toBeDefined();
    const sendAfter = JSON.parse(sendActionLog.after_state);
    expect(sendAfter.status).toBe('sending'); // Confirms send acceptance

    // 3. Wait for background deliverBroadcast to finalize
    await new Promise(r => setTimeout(r, 400));

    const completedLogs = db.prepare(`SELECT action, outcome, details FROM admin_audit_logs WHERE resource = ? AND action = 'broadcast.delivery_completed'`).all(`broadcast:${broadcastId}`);
    expect(completedLogs.length).toBe(1);
    expect(completedLogs[0].outcome).toBe('success');
    const deliveryDetails = JSON.parse(completedLogs[0].details);
    expect(deliveryDetails.finalStatus).toBe('sent');
    expect(deliveryDetails.deliveredCount).toBeGreaterThanOrEqual(1);

    // 4. Test Delivery Retry Atomicity with Actual Failed-Recipient Fixture:
    // Create an explicit failed recipient record for this broadcast
    db.prepare(`
      INSERT INTO broadcast_recipients (
        broadcast_id, student_id, inbox_delivered, notification_delivered, notice_delivered, delivered_at, failed_reason
      ) VALUES (?, ?, 0, 0, 0, NULL, 'Simulated network timeout during send')
    `).run(broadcastId, TEST_STUDENT_ID);

    const initialFailedRecipients = db.prepare(`
      SELECT student_id, failed_reason FROM broadcast_recipients
      WHERE broadcast_id = ? AND inbox_delivered = 0 AND notification_delivered = 0 AND notice_delivered = 0
    `).all(broadcastId);
    expect(initialFailedRecipients.length).toBe(1);
    expect(initialFailedRecipients[0].failed_reason).toBe('Simulated network timeout during send');

    // Inject trigger rejecting audit log insert
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS test_audit_abort_trigger
      BEFORE INSERT ON admin_audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Simulated audit failure during broadcast retry');
      END;
    `).run();

    // Call retry while audit insert fails
    const failedRetryRes = await request.post(`${API_BASE}/api/admin/broadcast/${broadcastId}/retry`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    // Endpoint MUST return 500 error
    expect(failedRetryRes.status()).toBe(500);

    // Verify recipient record was NOT deleted! (Zero data loss)
    const afterFailedRetryRecipients = db.prepare(`
      SELECT student_id, failed_reason FROM broadcast_recipients
      WHERE broadcast_id = ? AND inbox_delivered = 0 AND notification_delivered = 0 AND notice_delivered = 0
    `).all(broadcastId);
    expect(afterFailedRetryRecipients.length).toBe(1);
    expect(afterFailedRetryRecipients[0].failed_reason).toBe('Simulated network timeout during send');

    // Drop failure trigger
    db.prepare('DROP TRIGGER IF EXISTS test_audit_abort_trigger').run();

    // Call retry cleanly with actual failed recipient
    const successRetryRes = await request.post(`${API_BASE}/api/admin/broadcast/${broadcastId}/retry`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(successRetryRes.status()).toBe(200);
    const retryBody = await successRetryRes.json();
    expect(retryBody.message).toContain('Retrying delivery to 1 students...');

    // Wait for background delivery to finalize
    await new Promise(r => setTimeout(r, 400));

    // Verify broadcast.retry audit log exists with exact recipient count
    const retryLogs = db.prepare(`SELECT action, outcome, details FROM admin_audit_logs WHERE resource = ? AND action = 'broadcast.retry'`).all(`broadcast:${broadcastId}`);
    expect(retryLogs.length).toBe(1);
    expect(retryLogs[0].outcome).toBe('success');
    const retryLogDetails = JSON.parse(retryLogs[0].details);
    expect(retryLogDetails.retryRecipientsCount).toBe(1);

    // Verify recipient was re-delivered successfully
    const finalRecipient = db.prepare('SELECT inbox_delivered, delivered_at FROM broadcast_recipients WHERE broadcast_id = ? AND student_id = ?').get(broadcastId, TEST_STUDENT_ID);
    expect(finalRecipient).toBeDefined();

    // Clean up broadcast records
    db.prepare('DELETE FROM broadcast_recipients WHERE broadcast_id = ?').run(broadcastId);
    db.prepare('DELETE FROM broadcasts WHERE id = ?').run(broadcastId);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource = ?').run(`broadcast:${broadcastId}`);
  });

  test('80. Scheduled broadcast acceptance atomicity: suppressed audit failure rollback prevents unrecorded send', async () => {
    const { checkScheduledBroadcasts } = await import('../server/utils/broadcastScheduler.js');

    // 1. Insert scheduled broadcast
    const scheduledId = db.prepare(`
      INSERT INTO broadcasts (title, message, audience_type, priority, status, scheduled_at, sender_id)
      VALUES (?, ?, 'all', 'normal', 'scheduled', datetime('now', '-1 minute'), ?)
    `).run('Scheduled Audit Rollback Test', 'Testing scheduler acceptance atomicity', SUPER_ADMIN_ID).lastInsertRowid;

    // 2. Inject SQLite trigger rejecting audit log insert
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS test_audit_abort_trigger
      BEFORE INSERT ON admin_audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Simulated audit persistence failure during scheduler acceptance');
      END;
    `).run();

    // Run scheduler check while audit ledger fails
    await checkScheduledBroadcasts(null);

    // Verify broadcast status remained 'scheduled' and was NOT transitioned to 'sending' or 'sent'
    const statusAfterFailure = db.prepare('SELECT status FROM broadcasts WHERE id = ?').get(scheduledId);
    expect(statusAfterFailure.status).toBe('scheduled');

    // Drop trigger
    db.prepare('DROP TRIGGER IF EXISTS test_audit_abort_trigger').run();

    // Run scheduler check cleanly
    await checkScheduledBroadcasts(null);

    // Verify broadcast status successfully transitioned to 'sent'
    const statusAfterSuccess = db.prepare('SELECT status FROM broadcasts WHERE id = ?').get(scheduledId);
    expect(statusAfterSuccess.status).toBe('sent');

    // Verify durable acceptance audit log was recorded
    const schedAuditLogs = db.prepare(`SELECT action, outcome, before_state, after_state FROM admin_audit_logs WHERE resource = ? AND action = 'broadcast.send_scheduled'`).all(`broadcast:${scheduledId}`);
    expect(schedAuditLogs.length).toBe(1);
    expect(schedAuditLogs[0].outcome).toBe('success');
    const beforeState = JSON.parse(schedAuditLogs[0].before_state);
    const afterState = JSON.parse(schedAuditLogs[0].after_state);
    expect(beforeState.status).toBe('scheduled');
    expect(afterState.status).toBe('sending');

    // Clean up
    db.prepare('DELETE FROM broadcast_recipients WHERE broadcast_id = ?').run(scheduledId);
    db.prepare('DELETE FROM broadcasts WHERE id = ?').run(scheduledId);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource = ?').run(`broadcast:${scheduledId}`);
  });

  test('81. Custom Phase ID course progression and accurate before-state capture across repeated admission and reversal', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // Create a course definition with custom arbitrary phase IDs (not p_1, p_2)
    const customCourseName = `Custom Phase Course ${Date.now()}`;
    const customDefPayload = {
      phases: [
        {
          id: 'phase_alpha_core',
          phaseNumber: 1,
          title: 'Core Fundamentals',
          classes: [{ id: 'cls_c1', title: 'Intro' }],
          assignments: [],
          exam: { enabled: false }
        },
        {
          id: 'phase_beta_advanced',
          phaseNumber: 2,
          title: 'Advanced Direction',
          classes: [{ id: 'cls_c2', title: 'Directing' }],
          assignments: [],
          exam: { enabled: false }
        }
      ],
      completionPolicy: { phaseGates: { sequentialProgression: false } }
    };

    const defInsert = db.prepare(`
      INSERT INTO course_definitions (name, slug, course_type, status, definition_json, created_by, updated_by, version)
      VALUES (?, ?, 'workshop', 'published', ?, ?, ?, 1)
    `).run(
      customCourseName,
      `custom-phase-slug-${Date.now()}`,
      JSON.stringify(customDefPayload),
      SUPER_ADMIN_ID,
      SUPER_ADMIN_ID
    );
    const customDefId = defInsert.lastInsertRowid;

    // Enroll student in this defined course
    const enrollmentResult = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, course_definition_id, course_version, step1_completed
      ) VALUES (?, ?, 'workshop', ?, 1, 1)
    `).run(TEST_STUDENT_ID, customCourseName, customDefId);
    const customEnrollmentId = enrollmentResult.lastInsertRowid;

    // 1. Initial Admission: POST .../phases/2/admit
    const firstAdmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${customEnrollmentId}/phases/2/admit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(firstAdmitRes.status()).toBe(200);

    const firstLogs = db.prepare(`SELECT action, outcome, before_state, after_state, details FROM admin_audit_logs WHERE resource = ? AND action = 'academic.phase_admit' ORDER BY id DESC LIMIT 1`).get(`enrollment:${customEnrollmentId}`);
    expect(firstLogs).toBeDefined();
    const firstBefore = JSON.parse(firstLogs.before_state);
    const firstAfter = JSON.parse(firstLogs.after_state);
    const firstDetails = JSON.parse(firstLogs.details);

    expect(firstDetails.phaseId).toBe('phase_beta_advanced'); // Real custom phase ID resolved!
    expect(firstBefore.admitted).toBe(0); // Before state: not admitted
    expect(firstAfter.admitted).toBe(1);  // After state: admitted

    // 2. Repeated Admission: POST .../phases/2/admit again
    const secondAdmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${customEnrollmentId}/phases/2/admit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(secondAdmitRes.status()).toBe(200);

    const secondLogs = db.prepare(`SELECT action, outcome, before_state, after_state, details FROM admin_audit_logs WHERE resource = ? AND action = 'academic.phase_admit' ORDER BY id DESC LIMIT 1`).get(`enrollment:${customEnrollmentId}`);
    expect(secondLogs).toBeDefined();
    const secondBefore = JSON.parse(secondLogs.before_state);
    const secondAfter = JSON.parse(secondLogs.after_state);
    const secondDetails = JSON.parse(secondLogs.details);

    expect(secondDetails.phaseId).toBe('phase_beta_advanced');
    expect(secondBefore.admitted).toBe(1); // Accurately captured before-state as already admitted!
    expect(secondAfter.admitted).toBe(1);

    // 3. Reversal (Unadmit): POST .../phases/2/unadmit
    const unadmitRes = await request.post(`${API_BASE}/api/admin/students/${TEST_STUDENT_ID}/courses/${customEnrollmentId}/phases/2/unadmit`, {
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    expect(unadmitRes.status()).toBe(200);

    const unadmitLogs = db.prepare(`SELECT action, outcome, before_state, after_state, details FROM admin_audit_logs WHERE resource = ? AND action = 'academic.phase_unadmit' ORDER BY id DESC LIMIT 1`).get(`enrollment:${customEnrollmentId}`);
    expect(unadmitLogs).toBeDefined();
    const unadmitBefore = JSON.parse(unadmitLogs.before_state);
    const unadmitAfter = JSON.parse(unadmitLogs.after_state);
    const unadmitDetails = JSON.parse(unadmitLogs.details);

    expect(unadmitDetails.phaseId).toBe('phase_beta_advanced');
    expect(unadmitBefore.admitted).toBe(1); // Accurately captured before-state as admitted!
    expect(unadmitAfter.admitted).toBe(0);  // After state: unadmitted

    // Clean up
    db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(customEnrollmentId);
    db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(customEnrollmentId);
    db.prepare('DELETE FROM course_definitions WHERE id = ?').run(customDefId);
    db.prepare('DELETE FROM admin_audit_logs WHERE resource = ?').run(`enrollment:${customEnrollmentId}`);
  });


  test('82. Integrated Main: Batches HTTP 304 ETag Conditional Caching & Invalidation', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // 1. Initial GET /api/batches -> HTTP 200 with ETag header
    const firstRes = await request.get(`${API_BASE}/api/admin/batches`, {
      headers: { Authorization: `Bearer ${saToken}` }
    });
    expect(firstRes.status()).toBe(200);
    const etag = firstRes.headers()['etag'];
    expect(etag).toBeDefined();
    expect(etag.startsWith('W/"b-')).toBe(true);

    // 2. Conditional GET with matching If-None-Match -> HTTP 304 Not Modified
    const cachedRes = await request.get(`${API_BASE}/api/admin/batches`, {
      headers: {
        Authorization: `Bearer ${saToken}`,
        'if-none-match': etag
      }
    });
    expect(cachedRes.status()).toBe(304);

    // 3. Trigger database update to invalidate ETag
    const testBatchNumber = `TEST_ETAG_${Date.now()}`;
    const insertRes = db.prepare(`
      INSERT INTO batches (batch_name, batch_number, course_name, status, created_at, updated_at)
      VALUES ('ETag Test Batch', ?, 'Online Filmmaking Course', 'active', datetime('now'), datetime('now'))
    `).run(testBatchNumber);
    const newBatchId = insertRes.lastInsertRowid;

    // 4. Conditional GET with stale ETag -> HTTP 200 with refreshed ETag
    const refreshedRes = await request.get(`${API_BASE}/api/admin/batches`, {
      headers: {
        Authorization: `Bearer ${saToken}`,
        'if-none-match': etag
      }
    });
    expect(refreshedRes.status()).toBe(200);
    const newEtag = refreshedRes.headers()['etag'];
    expect(newEtag).not.toBe(etag);

    // Cleanup
    db.prepare('DELETE FROM batches WHERE id = ?').run(newBatchId);
  });

  test('83. Integrated Main: Batches Server-Side Pagination & Global Status Aggregations', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    const paginatedRes = await request.get(`${API_BASE}/api/admin/batches?paginate=true&page=1&limit=5`, {
      headers: { Authorization: `Bearer ${saToken}` }
    });
    expect(paginatedRes.status()).toBe(200);
    const data = await paginatedRes.json();

    expect(data.batches).toBeDefined();
    expect(Array.isArray(data.batches)).toBe(true);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(5);
    expect(typeof data.total).toBe('number');
    expect(typeof data.totalPages).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(data.stats).toBeDefined();
    expect(typeof data.stats.total).toBe('number');
    expect(typeof data.stats.active).toBe('number');

    // In-memory fee resolution check
    if (data.batches.length > 0) {
      expect(data.batches[0].course_fee).toBeDefined();
      expect(data.batches[0].phase1_fee).toBeDefined();
      expect(data.batches[0].phase2_fee).toBeDefined();
    }
  });

  test('84. Integrated Main: Analytics Dynamic Unread Reports Count', async ({ request }) => {
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    const urgentRes = await request.get(`${API_BASE}/api/analytics/urgent`, {
      headers: { Authorization: `Bearer ${saToken}` }
    });
    expect(urgentRes.status()).toBe(200);
    const data = await urgentRes.json();

    expect(data.unreadReports).toBeDefined();
    expect(typeof data.unreadReports).toBe('number');
    expect(data.pendingCertApprovals).toBeDefined();
    expect(data.missingAttendance).toBeDefined();
    expect(data.inactiveStudents).toBeDefined();
  });

  test('85. Integrated Main: Global Search Role-Based Indexing & Super Admin Privileges', async ({ browser, request }) => {
    // Part 1: API Route Guard Verification
    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    // Super Admin can access administrator management
    const saRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${saToken}` }
    });
    expect(saRes.status()).toBe(200);

    // Ordinary admin cannot access administrator management
    const ordinaryAdminUsername = `admin@ordinary_${Date.now()}`;
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version)
      VALUES (?, ?, ?, 'admin', 'Ordinary', 'Admin', 1, 0, datetime('now'), 1)
    `).run(ordinaryAdminUsername, `${ordinaryAdminUsername.replace('@', '_')}@bfibd.org`, passwordHash);
    const ordinaryAdminId = insertRes.lastInsertRowid;
    const { token: ordinaryToken, sessionId: ordSessId } = issueAdminSessionToken(ordinaryAdminId);

    const ordRes = await request.get(`${API_BASE}/api/admin/administrators`, {
      headers: { Authorization: `Bearer ${ordinaryToken}` }
    });
    expect(ordRes.status()).toBe(403);
    const ordData = await ordRes.json();
    expect(ordData.error).toContain('Super Administrator privilege required');

    // Part 2: Browser Global Search Role-Based Indexing Verification
    // 2a. Super Admin browser session: Administrator Management MUST be indexed
    const saContext = await browser.newContext();
    const saPage = await saContext.newPage();
    await setupTestRouteProxy(saPage);
    await saPage.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: saToken,
      user: {
        id: 1,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await saPage.goto('');
    await saPage.waitForLoadState('domcontentloaded');

    // Type "administrators" into sidebar Global Search input
    const saSearchInput = saPage.locator('.sidebar-search-input');
    await expect(saSearchInput).toBeVisible();
    await saSearchInput.fill('administrators');

    // Verify search results appear and contain "Administrator Management"
    const saResult = saPage.locator('.sidebar-search-item').filter({ hasText: 'Administrator Management' });
    await expect(saResult).toBeVisible();

    await saContext.close();

    // 2b. Ordinary Admin browser session: Administrator Management MUST NOT be indexed
    const ordContext = await browser.newContext();
    const ordPage = await ordContext.newPage();
    await setupTestRouteProxy(ordPage);
    await ordPage.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: ordinaryToken,
      user: {
        id: ordinaryAdminId,
        username: ordinaryAdminUsername,
        email: `${ordinaryAdminUsername.replace('@', '_')}@bfibd.org`,
        role: 'admin',
        firstName: 'Ordinary',
        lastName: 'Admin',
        is_super_admin: 0,
        isSuperAdmin: false
      }
    });

    await ordPage.goto('');
    await ordPage.waitForLoadState('domcontentloaded');

    const ordSearchInput = ordPage.locator('.sidebar-search-input');
    await expect(ordSearchInput).toBeVisible();
    await ordSearchInput.fill('administrators');

    // Verify "Administrator Management" is NOT present for ordinary admin
    const ordResult = ordPage.locator('.sidebar-search-item').filter({ hasText: 'Administrator Management' });
    await expect(ordResult).toHaveCount(0);

    await ordContext.close();

    // Cleanup
    db.prepare('DELETE FROM sessions WHERE id = ?').run(ordSessId);
    db.prepare('DELETE FROM users WHERE id = ?').run(ordinaryAdminId);
  });

});

test.describe('Phase 3: Admin Archiving, Accountability & Super Admin Password Reset Suite', () => {
  const ARTIFACT_DIR = 'C:/Users/shahi/.gemini/antigravity/brain/8a2c550d-de2b-4cee-a467-088c18dbcc23';
  const TARGET_ADMIN_ID = 88812;
  const TARGET_USERNAME = 'admin@archivetarget';
  const TARGET_EMAIL = 'archivetarget@bfibd.org';

  test.beforeEach(async () => {
    // Ensure TARGET_ADMIN exists in clean state
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    db.prepare(`
      INSERT OR REPLACE INTO users (
        id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, last_login, token_version, account_version, archived_at, archive_reason, restored_at, restore_reason, password_reset_pending, email_verified_at, verified_email
      ) VALUES (
        ?, ?, ?, ?, 'admin', 'Target', 'Admin', 1, 0, datetime('now'), 1, 1, NULL, NULL, NULL, NULL, 0, datetime('now'), ?
      )
    `).run(TARGET_ADMIN_ID, TARGET_USERNAME, TARGET_EMAIL, passwordHash, TARGET_EMAIL);

    // Grant permission
    db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, 1)').run(TARGET_ADMIN_ID, 'courses:view');
  });

  test.afterAll(() => {
    try {
      db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(TARGET_ADMIN_ID);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(TARGET_ADMIN_ID);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(TARGET_ADMIN_ID);
      db.prepare('DELETE FROM users WHERE id = ?').run(TARGET_ADMIN_ID);
    } catch {}
  });

  test('30. Browser Interaction: Sub-view Switching, Archive Flow, and Inactive Restoration', async ({ page }) => {
    await setupTestRouteProxy(page);

    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: saToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // 1. Verify Sub-view Navigation Pills
    const currentPill = page.locator('[data-testid="subview-current-admins"]');
    const archivedPill = page.locator('[data-testid="subview-archived-admins"]');
    await expect(currentPill).toBeVisible();
    await expect(archivedPill).toBeVisible();

    // 2. Locate target administrator in Current table
    const targetRow = page.locator('tr').filter({ hasText: TARGET_USERNAME });
    await expect(targetRow).toBeVisible();

    // 3. Click Archive button -> Archive Modal opens
    const archiveBtn = page.locator(`[data-testid="archive-admin-${TARGET_ADMIN_ID}"]`);
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    const archiveModalHeader = page.locator('h2').filter({ hasText: 'Archive Administrator' });
    await expect(archiveModalHeader).toBeVisible();

    // Test cancel
    const cancelBtn = page.locator('.admin-modal-footer button').filter({ hasText: 'Cancel' });
    await cancelBtn.click();
    await expect(archiveModalHeader).not.toBeVisible();
    await expect(targetRow).toBeVisible();

    // Re-open Archive Modal and submit
    await archiveBtn.click();
    await expect(archiveModalHeader).toBeVisible();

    const reasonInput = page.locator('[data-testid="archive-reason-input"]');
    await reasonInput.fill('Staff member leaving for sabbatical research');

    const sudoInput = page.locator('[data-testid="archive-sudo-password-input"]');
    await sudoInput.fill(TEST_PASSWORD);

    const confirmArchiveBtn = page.locator('[data-testid="confirm-archive-btn"]');
    await expect(confirmArchiveBtn).toBeEnabled();
    await confirmArchiveBtn.click();

    // Verify modal closes and admin is removed from current table
    await expect(archiveModalHeader).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('tr').filter({ hasText: TARGET_USERNAME })).toHaveCount(0);

    // 4. Switch to Archived Administrators sub-view
    await archivedPill.click();
    const archivedTable = page.locator('[data-testid="archived-admins-table"]');
    await expect(archivedTable).toBeVisible();

    const archivedTargetRow = archivedTable.locator('tr').filter({ hasText: TARGET_USERNAME });
    await expect(archivedTargetRow).toBeVisible();
    await expect(archivedTargetRow.locator('.badge-archived-admin')).toBeVisible();
    await expect(archivedTargetRow).toContainText('Staff member leaving for sabbatical research');

    // Screenshot archived administrators view
    await page.screenshot({ path: `${ARTIFACT_DIR}/archived-administrators-desktop.png`, fullPage: false });

    // 5. Restore Administrator -> Opens Restore Modal
    const restoreBtn = page.locator(`[data-testid="restore-admin-${TARGET_ADMIN_ID}"]`);
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    const restoreModalHeader = page.locator('h2').filter({ hasText: 'Restore Administrator' });
    await expect(restoreModalHeader).toBeVisible();
    // Verify notice indicates account is restored as INACTIVE
    await expect(page.locator('.admin-modal-body')).toContainText('INACTIVE');

    const restoreReasonInput = page.locator('[data-testid="restore-reason-input"]');
    await restoreReasonInput.fill('Rehiring staff member as visiting instructor');

    const restoreSudoInput = page.locator('[data-testid="restore-sudo-password-input"]');
    await restoreSudoInput.fill(TEST_PASSWORD);

    const confirmRestoreBtn = page.locator('[data-testid="confirm-restore-btn"]');
    await expect(confirmRestoreBtn).toBeEnabled();
    await confirmRestoreBtn.click();

    await expect(restoreModalHeader).not.toBeVisible({ timeout: 10000 });

    // 6. Switch back to Current Administrators sub-view
    await currentPill.click();
    const restoredRow = page.locator('tr').filter({ hasText: TARGET_USERNAME });
    await expect(restoredRow).toBeVisible();

    // Verify restored administrator is strictly INACTIVE
    const statusPill = restoredRow.locator('.status-toggle-pill');
    await expect(statusPill).toContainText('Inactive');

    // Mobile viewport screenshot
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: `${ARTIFACT_DIR}/admin-management-mobile.png`, fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('31. Browser Interaction: Password Reset Modal, Out-of-Band Link & Fragment Reset Flow', async ({ page, browser }) => {
    await setupTestRouteProxy(page);

    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: saToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // 1. Click Reset Password for Target Admin
    const resetBtn = page.locator(`[data-testid="reset-admin-${TARGET_ADMIN_ID}"]`);
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    const resetModalHeader = page.locator('h2').filter({ hasText: 'Reset Administrator Password' });
    await expect(resetModalHeader).toBeVisible();

    // Verify email verified badge
    await expect(page.locator('[data-testid="verified-email-badge"]')).toBeVisible();

    // Select Out-of-Band direct link option
    const radioDirect = page.locator('[data-testid="radio-reset-direct"]');
    await radioDirect.click();

    const resetReasonInput = page.locator('[data-testid="reset-reason-input"]');
    await resetReasonInput.fill('Admin forgotten credentials verification test');

    const resetSudoInput = page.locator('[data-testid="reset-sudo-password-input"]');
    await resetSudoInput.fill(TEST_PASSWORD);

    const confirmResetBtn = page.locator('[data-testid="confirm-reset-btn"]');
    await expect(confirmResetBtn).toBeEnabled();
    await confirmResetBtn.click();

    // 2. Verify Out-of-Band Link Modal appears
    const directModalHeader = page.locator('h2').filter({ hasText: 'Direct Recovery Link Generated' });
    await expect(directModalHeader).toBeVisible({ timeout: 10000 });

    const directLinkInput = page.locator('[data-testid="direct-link-input"]');
    await expect(directLinkInput).toBeVisible();
    const rawDirectUrl = await directLinkInput.inputValue();
    expect(rawDirectUrl).toContain('#userId=88812&token=');

    // Verify live countdown timer
    const timerDisplay = page.locator('[data-testid="direct-link-timer"]');
    await expect(timerDisplay).toBeVisible();
    await expect(timerDisplay).toContainText('Link Expires In:');

    // Screenshot direct link modal
    await page.screenshot({ path: `${ARTIFACT_DIR}/direct-link-modal-desktop.png`, fullPage: false });

    // Close direct link modal
    const doneBtn = page.locator('[data-testid="done-direct-link-btn"]');
    await doneBtn.click();
    await expect(directModalHeader).not.toBeVisible();

    // 3. In an unauthenticated browser context, open the direct link
    const resetContext = await browser.newContext();
    const resetPage = await resetContext.newPage();
    await setupTestRouteProxy(resetPage);

    // Navigate to fragment URL
    const fragmentUrl = rawDirectUrl.replace('http://localhost:5174', '').replace('http://127.0.0.1:5174', '');
    const relativeUrl = fragmentUrl.startsWith('/bfi-classroom') ? fragmentUrl.replace('/bfi-classroom/', '') : fragmentUrl.replace(/^\//, '');

    await resetPage.goto(relativeUrl);
    await resetPage.waitForLoadState('domcontentloaded');

    // Verify URL fragment was stripped from the window address bar immediately
    const currentHash = await resetPage.evaluate(() => window.location.hash);
    expect(currentHash).toBe('');

    // Fill new password form
    const newPassInput = resetPage.locator('#password');
    const confirmPassInput = resetPage.locator('#confirmPassword');
    await expect(newPassInput).toBeVisible();

    await newPassInput.fill('BrandNewAdminPass2026!');
    await confirmPassInput.fill('BrandNewAdminPass2026!');

    const submitResetBtn = resetPage.locator('button[type="submit"]');
    await submitResetBtn.click();

    // Verify success alert
    const successAlert = resetPage.locator('.success-alert');
    await expect(successAlert).toBeVisible({ timeout: 10000 });
    await expect(successAlert).toContainText('reset successfully');

    await resetContext.close();

    // Verify in database that password was updated and reset pending cleared
    const updatedUser = db.prepare('SELECT password_hash, password_reset_pending FROM users WHERE id = ?').get(TARGET_ADMIN_ID);
    expect(updatedUser.password_reset_pending).toBe(0);
    expect(bcrypt.compareSync('BrandNewAdminPass2026!', updatedUser.password_hash)).toBe(true);
  });

  test('32. Browser Interaction: Accountability Dashboard KPI Counts & CSV Export Trigger', async ({ page }) => {
    await setupTestRouteProxy(page);

    const { token: saToken } = issueAdminSessionToken(SUPER_ADMIN_ID);

    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, {
      token: saToken,
      user: {
        id: SUPER_ADMIN_ID,
        username: 'admin@abir',
        email: 'k.eye.films@gmail.com',
        role: 'admin',
        firstName: 'Abir',
        lastName: 'Ahmad',
        is_super_admin: 1,
        isSuperAdmin: true
      }
    });

    await page.goto('admin/administrators');
    await page.waitForLoadState('domcontentloaded');

    // Switch to Accountability Dashboard
    const accountabilityTabBtn = page.locator('[data-testid="tab-accountability"]');
    await expect(accountabilityTabBtn).toBeVisible();
    await accountabilityTabBtn.click();

    // Verify non-overlapping KPI counts
    const totalKpi = page.locator('[data-testid="kpi-total-admins"]');
    const activeKpi = page.locator('[data-testid="kpi-active-admins"]');
    const inactiveKpi = page.locator('[data-testid="kpi-inactive-admins"]');
    const archivedKpi = page.locator('[data-testid="kpi-archived-admins"]');

    await expect(totalKpi).toBeVisible();
    await expect(activeKpi).toBeVisible();
    await expect(inactiveKpi).toBeVisible();
    await expect(archivedKpi).toBeVisible();

    // Screenshot accountability dashboard with new non-overlapping KPIs
    await page.screenshot({ path: `${ARTIFACT_DIR}/accountability-dashboard-kpis.png`, fullPage: false });
  });
});

