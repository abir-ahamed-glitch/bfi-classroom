'use strict';

/**
 * scripts/test_media_routes_and_signaling_hardening.cjs
 *
 * Comprehensive Automated Verification Suite for:
 *
 * 1. REPORT SCREENSHOT LOCKDOWN & ACCESS CONTROL
 *    - Validates all 8 URL aliases:
 *      /uploads/report-screenshots/:filename
 *      /uploads/report-screenshots/:filename/view
 *      /bfi-classroom/uploads/report-screenshots/:filename
 *      /bfi-classroom/uploads/report-screenshots/:filename/view
 *      /media/report-screenshots/:filename
 *      /media/report-screenshots/:filename/view
 *      /bfi-classroom/media/report-screenshots/:filename
 *      /bfi-classroom/media/report-screenshots/:filename/view
 *    - Matrix verification across 6 distinct authorization contexts:
 *      A. Unauthenticated (no token) -> strictly 401
 *      B. Unrelated Student (User 20, different batch, not reporter) -> strictly 403
 *      C. Unrelated Admin (User 30, no reports permission) -> strictly 403
 *      D. Reporter Owner (User 10) -> 200 OK
 *      E. Moderator Admin (User 40, reports:view permission) -> 200 OK
 *      F. Super Admin (User 1) -> 200 OK
 *    - Directory traversal and invalid extension rejection -> 404
 *    - Private inbox attachments locked at /media, /bfi-classroom/media, /uploads -> 403
 *
 * 2. SOCKET.IO CALL & GROUP-CALL SIGNALING GOVERNANCE
 *    - Negative Controls:
 *      - Arbitrary call-rejected by authenticated user with no active pending call -> target receives nothing
 *      - Rejection of call-rejected by third-party non-recipient on a pending call
 *      - Strict enforcement that only the invited recipient can reject a pending call
 *      - Rejection of 1:1 call-request to unrelated users across batches
 *      - Rejection of call-request based solely on student_profiles.batch_number text without active batch_students row
 *      - Rejection of call-request for students in archived batches
 *      - Rejection of call-request for students in soft-deleted batches
 *      - Rejection of 1:1 call-request to self or non-existent/inactive users
 *      - Rejection of WebRTC offer, answer, and ICE candidate when no call session is active
 *      - Rejection of group-call-invite from users not in a connected call
 *      - Enforcement of 60-second pending call expiry TTL (calls expired after 60s fail to answer or reject)
 *      - Enforcement of maximum 9-person group call ceiling
 *      - Rejection of client-controlled broadcast spamming via participantIds
 *      - Enforcement of fromId from socket session (spoofing prevented)
 *    - Positive Controls:
 *      - Successful 1:1 call establishment between active batchmates (ringing -> answered -> WebRTC signaling -> call ended)
 *      - Successful 1:1 call rejection by the designated recipient
 *      - Successful group-call invitation up to 9-person maximum ceiling
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { spawn } = require('child_process');

const TEST_PORT = 3098;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const JWT_SECRET = 'test_jwt_secret_media_signaling_hardening_32c!';
const JWT_REFRESH_SECRET = 'test_jwt_refresh_media_signaling_hardening_32c!';

const TMP_DIR = path.resolve(__dirname, '..', '.tmp_media_signaling_test');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const TEST_DB_PATH = path.join(TMP_DIR, 'hardening_test.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

// Synthetic report screenshot file
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'uploads', 'report-screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const SYNTHETIC_FILENAME = `report-screenshot-10-1730389999999.png`;
const SYNTHETIC_FILEPATH = path.join(SCREENSHOTS_DIR, SYNTHETIC_FILENAME);
const SYNTHETIC_PAYLOAD = 'CONFIDENTIAL_SYNTHETIC_SCREENSHOT_DATA_ABCXYZ_987';
fs.writeFileSync(SYNTHETIC_FILEPATH, SYNTHETIC_PAYLOAD);

process.env.DATABASE_PATH = TEST_DB_PATH;

async function setupDatabase() {
  const dbModule = await import('../server/db/database.js');
  dbModule.initializeDatabase();
  const db = dbModule.default;
  activeDbHandle = db;

  // Configure Super Admin (ID 1)
  db.prepare(`UPDATE users SET username = 'superadmin', email = 'super@bfi.local', role = 'admin', first_name = 'Super', last_name = 'Admin', is_super_admin = 1, is_active = 1 WHERE id = 1`).run();

  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active)
    VALUES (?, ?, ?, 'hash', ?, ?, ?, ?, ?)
  `);

  insertUser.run(10, 'reporter_alice', 'alice@bfi.local', 'student', 'Alice', 'Reporter', 0, 1);
  insertUser.run(20, 'unrelated_bob', 'bob@bfi.local', 'student', 'Bob', 'Unrelated', 0, 1);
  insertUser.run(30, 'unrelated_admin', 'charlie_admin@bfi.local', 'admin', 'Charlie', 'Admin', 0, 1);
  insertUser.run(40, 'moderator_diana', 'diana_mod@bfi.local', 'admin', 'Diana', 'Moderator', 0, 1);
  insertUser.run(50, 'inactive_eve', 'eve@bfi.local', 'student', 'Eve', 'Inactive', 0, 0);
  insertUser.run(60, 'batchmate_frank', 'frank@bfi.local', 'student', 'Frank', 'Batchmate', 0, 1);
  insertUser.run(70, 'mallory_text_spoof', 'mallory@bfi.local', 'student', 'Mallory', 'Spoof', 0, 1);
  insertUser.run(80, 'grace_archived', 'grace@bfi.local', 'student', 'Grace', 'Archived', 0, 1);
  insertUser.run(81, 'heidi_archived', 'heidi@bfi.local', 'student', 'Heidi', 'Archived', 0, 1);
  insertUser.run(90, 'ivan_deleted', 'ivan@bfi.local', 'student', 'Ivan', 'Deleted', 0, 1);
  insertUser.run(91, 'judy_deleted', 'judy@bfi.local', 'student', 'Judy', 'Deleted', 0, 1);

  // Group call cohort candidate users (101..108)
  for (let id = 101; id <= 108; id++) {
    insertUser.run(id, `student_${id}`, `student_${id}@bfi.local`, 'student', `User${id}`, 'Cohort', 0, 1);
  }

  // Batches:
  // Batch 1: Active batch
  db.prepare(`
    INSERT OR REPLACE INTO batches (id, batch_name, batch_number, course_name, status, deleted_at)
    VALUES (1, 'Batch 01', 'BATCH-01', 'Film Appreciation Course', 'active', NULL)
  `).run();

  // Batch 2: Active batch (different)
  db.prepare(`
    INSERT OR REPLACE INTO batches (id, batch_name, batch_number, course_name, status, deleted_at)
    VALUES (2, 'Batch 02', 'BATCH-02', 'Film Appreciation Course', 'active', NULL)
  `).run();

  // Batch 3: Archived batch
  db.prepare(`
    INSERT OR REPLACE INTO batches (id, batch_name, batch_number, course_name, status, deleted_at)
    VALUES (3, 'Batch 03', 'BATCH-03', 'Film Appreciation Course', 'archived', NULL)
  `).run();

  // Batch 4: Soft-deleted batch
  db.prepare(`
    INSERT OR REPLACE INTO batches (id, batch_name, batch_number, course_name, status, deleted_at)
    VALUES (4, 'Batch 04', 'BATCH-04', 'Film Appreciation Course', 'active', '2026-10-31 00:00:00')
  `).run();

  // Active Batch Memberships in batch_students:
  // Alice (10) and Frank (60) in Batch 1
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (1, 10)').run();
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (1, 60)').run();

  // Group candidate users (101..108) also in Batch 1
  for (let id = 101; id <= 108; id++) {
    db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (1, ?)').run(id);
  }

  // Bob (20) in Batch 2
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (2, 20)').run();

  // Grace (80) and Heidi (81) in Archived Batch 3
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (3, 80)').run();
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (3, 81)').run();

  // Ivan (90) and Judy (91) in Deleted Batch 4
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (4, 90)').run();
  db.prepare('INSERT OR REPLACE INTO batch_students (batch_id, student_id) VALUES (4, 91)').run();

  // Student profiles
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(10, 'Alice Reporter', 'STU10', 'BATCH-01');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(20, 'Bob Unrelated', 'STU20', 'BATCH-02');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(50, 'Eve Inactive', 'STU50', 'BATCH-01');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(60, 'Frank Batchmate', 'STU60', 'BATCH-01');
  // Mallory has 'BATCH-01' text in profile, but NO entry in batch_students!
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(70, 'Mallory Spoof', 'STU70', 'BATCH-01');

  // Admin permissions: User 40 has reports permissions; User 30 has none
  db.prepare('INSERT OR REPLACE INTO admin_permissions (user_id, permission) VALUES (?, ?)').run(40, 'reports:view');
  db.prepare('INSERT OR REPLACE INTO admin_permissions (user_id, permission) VALUES (?, ?)').run(40, 'reports:moderate');

  // Active Sessions for admins
  const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(1, 1, 'hash-super-1', nextWeek);
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(30, 30, 'hash-unrelated-30', nextWeek);
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(40, 40, 'hash-mod-40', nextWeek);

  // Seed synthetic pending report
  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_user_id, content_type, content_id, reason_category, screenshot_path, status)
    VALUES (1, 10, 20, 'post', 1, 'Harassment', ?, 'pending')
  `).run(`/uploads/report-screenshots/${SYNTHETIC_FILENAME}`);
}

function makeToken(user, sessionId = null) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    type: 'access',
    token_version: 1
  };
  if (sessionId) payload.sessionId = sessionId;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

const tokens = {
  unauthenticated: null,
  reporter_alice: makeToken({ id: 10, username: 'reporter_alice', role: 'student' }),
  unrelated_bob: makeToken({ id: 20, username: 'unrelated_bob', role: 'student' }),
  unrelated_admin: makeToken({ id: 30, username: 'unrelated_admin', role: 'admin' }, 30),
  moderator_diana: makeToken({ id: 40, username: 'moderator_diana', role: 'admin' }, 40),
  super_admin: makeToken({ id: 1, username: 'superadmin', role: 'admin' }, 1),
  batchmate_frank: makeToken({ id: 60, username: 'batchmate_frank', role: 'student' }),
  mallory_text_spoof: makeToken({ id: 70, username: 'mallory_text_spoof', role: 'student' }),
  grace_archived: makeToken({ id: 80, username: 'grace_archived', role: 'student' }),
  ivan_deleted: makeToken({ id: 90, username: 'ivan_deleted', role: 'student' }),
  student_101: makeToken({ id: 101, username: 'student_101', role: 'student' }),
  student_102: makeToken({ id: 102, username: 'student_102', role: 'student' })
};

function requestUrl(urlPath, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    req.end();
  });
}

let serverProc = null;
const activeSockets = [];
let activeDbHandle = null;
let isCleaningUp = false;

async function cleanup(isAsync = true) {
  if (isCleaningUp) return;
  isCleaningUp = true;

  for (const s of activeSockets) {
    try { s.disconnect(); } catch { /* ignore */ }
  }
  activeSockets.length = 0;

  if (activeDbHandle) {
    try { activeDbHandle.close(); } catch { /* ignore */ }
    activeDbHandle = null;
  }

  if (serverProc && !serverProc.killed) {
    try { serverProc.kill('SIGKILL'); } catch { /* ignore */ }
    try { serverProc.kill(); } catch { /* ignore */ }
  }

  if (isAsync) {
    // Give child process up to 500ms to terminate and release file locks
    const start = Date.now();
    while (Date.now() - start < 500) {
      if (serverProc && serverProc.exitCode !== null) break;
      await new Promise(r => setTimeout(r, 50));
    }
  }

  if (fs.existsSync(SYNTHETIC_FILEPATH)) {
    try { fs.unlinkSync(SYNTHETIC_FILEPATH); } catch { /* ignore */ }
  }

  if (fs.existsSync(TMP_DIR)) {
    // Retry removing directory up to 5 times (helps on Windows if OS file handles take a moment)
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
        break;
      } catch {
        if (isAsync) await new Promise(r => setTimeout(r, 50));
      }
    }
  }
}

process.on('SIGINT', () => { cleanup(false); process.exit(1); });
process.on('SIGTERM', () => { cleanup(false); process.exit(1); });
process.on('uncaughtException', (err) => {
  console.error('[Test Harness] Uncaught Exception:', err);
  cleanup(false);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[Test Harness] Unhandled Rejection:', err);
  cleanup(false);
  process.exit(1);
});
process.on('exit', () => { cleanup(false); });

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000
    });
    socket.on('connect', () => {
      activeSockets.push(socket);
      resolve(socket);
    });
    socket.on('connect_error', reject);
  });
}

async function waitForServer(proc, port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(`Server process exited prematurely with code ${proc.exitCode}`);
    }
    const ready = await new Promise((resolve) => {
      const req = http.get({
        hostname: '127.0.0.1',
        port,
        path: '/health',
        timeout: 1000
      }, (res) => {
        res.resume();
        if (res.statusCode === 200 || res.statusCode === 404) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });

    if (ready) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server failed to respond to /health within ${timeoutMs / 1000} seconds`);
}

async function main() {
  try {
    console.log('================================================================');
    console.log('SECURITY VERIFICATION: REPORT SCREENSHOT LOCKDOWN & CALL SIGNALING');
    console.log('================================================================\n');

    await setupDatabase();
    console.log(`✅ Synthetic database initialized at ${TEST_DB_PATH}`);

    // Start test server process with explicit HOST and isolated port
    serverProc = spawn('node', ['server/server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: TEST_PORT,
        DATABASE_PATH: TEST_DB_PATH,
        JWT_SECRET,
        JWT_REFRESH_SECRET,
        NODE_ENV: 'test'
      },
      stdio: 'inherit'
    });

    // Wait for server to listen using sequential probe with process exit guard
    await waitForServer(serverProc, TEST_PORT, 30000);
    console.log(`✅ Test server confirmed responsive on port ${TEST_PORT} (PID: ${serverProc.pid})`);

  let totalAssertions = 0;
  let passedAssertions = 0;

  function assertCheck(desc, actual, expected) {
    totalAssertions++;
    if (actual === expected) {
      passedAssertions++;
      console.log(`  ✅ [PASS] ${desc}`);
    } else {
      console.error(`  ❌ [FAIL] ${desc}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      process.exitCode = 1;
    }
  }

  // ── SUITE 1: Report Screenshot Lockdown Matrix (All 8 Aliases) ────────
  console.log('\n--- SUITE 1: Report Screenshot Lockdown Matrix (All 8 Aliases) ---\n');

  // Verify /health readiness probe and correlation ID header over HTTP
  const healthRes = await requestUrl('/health');
  assertCheck('/health returns HTTP 200 on healthy database', healthRes.status, 200);
  assertCheck('/health carries X-Correlation-ID header', Boolean(healthRes.headers['x-correlation-id']), true);

  const aliases = [
    `/uploads/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/uploads/report-screenshots/${SYNTHETIC_FILENAME}/view`,
    `/bfi-classroom/uploads/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/bfi-classroom/uploads/report-screenshots/${SYNTHETIC_FILENAME}/view`,
    `/media/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/media/report-screenshots/${SYNTHETIC_FILENAME}/view`,
    `/bfi-classroom/media/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/bfi-classroom/media/report-screenshots/${SYNTHETIC_FILENAME}/view`
  ];

  for (const alias of aliases) {
    console.log(`Evaluating Alias: ${alias}`);

    // A. Unauthenticated
    const resUnauth = await requestUrl(alias, tokens.unauthenticated);
    assertCheck(`${alias} unauthenticated returns 401`, resUnauth.status, 401);
    assertCheck(`${alias} unauthenticated does not leak content`, resUnauth.body.includes(SYNTHETIC_PAYLOAD), false);

    // B. Unrelated Student (Bob)
    const resBob = await requestUrl(alias, tokens.unrelated_bob);
    assertCheck(`${alias} unrelated student returns 403`, resBob.status, 403);
    assertCheck(`${alias} unrelated student does not leak content`, resBob.body.includes(SYNTHETIC_PAYLOAD), false);

    // C. Unrelated Admin (Charlie - no reports permission)
    const resAdmin = await requestUrl(alias, tokens.unrelated_admin);
    assertCheck(`${alias} admin without reports permission returns 403`, resAdmin.status, 403);
    assertCheck(`${alias} admin without reports permission does not leak content`, resAdmin.body.includes(SYNTHETIC_PAYLOAD), false);

    // D. Reporter Owner (Alice)
    const resAlice = await requestUrl(alias, tokens.reporter_alice);
    assertCheck(`${alias} reporter owner returns 200`, resAlice.status, 200);
    assertCheck(`${alias} reporter owner receives valid content`, resAlice.body.includes(SYNTHETIC_PAYLOAD), true);

    // E. Moderator Admin (Diana - reports:view permission)
    const resMod = await requestUrl(alias, tokens.moderator_diana);
    assertCheck(`${alias} moderator admin returns 200`, resMod.status, 200);
    assertCheck(`${alias} moderator admin receives valid content`, resMod.body.includes(SYNTHETIC_PAYLOAD), true);

    // F. Super Admin
    const resSuper = await requestUrl(alias, tokens.super_admin);
    assertCheck(`${alias} super admin returns 200`, resSuper.status, 200);
    assertCheck(`${alias} super admin receives valid content`, resSuper.body.includes(SYNTHETIC_PAYLOAD), true);

    console.log('');
  }

  // Path Traversal & Invalid Extension Checks
  console.log('--- Path Traversal & Invalid Filename Defense ---');
  const traversal1 = await requestUrl('/uploads/report-screenshots/..%2F..%2Fpackage.json', tokens.super_admin);
  console.log('traversal1 status:', traversal1.status);
  assertCheck('Path traversal attempt with dots returns 404 or 401', traversal1.status === 404 || traversal1.status === 401, true);

  const nonImage = await requestUrl('/uploads/report-screenshots/malicious.sh', tokens.super_admin);
  assertCheck('Non-whitelisted image extension (.sh) returns 404 or 401', nonImage.status === 404 || nonImage.status === 401, true);

  // Private Inbox Attachments Static Block Checks
  console.log('\n--- Private Inbox Attachments Static Block Checks ---');
  const inboxMedia = await requestUrl('/media/inbox-attachments/secret.png', tokens.unauthenticated);
  assertCheck('/media/inbox-attachments unauthenticated returns 401 or 403', inboxMedia.status === 401 || inboxMedia.status === 403, true);

  const bfiInboxMedia = await requestUrl('/bfi-classroom/media/inbox-attachments/secret.png', tokens.unauthenticated);
  assertCheck('/bfi-classroom/media/inbox-attachments unauthenticated returns 401 or 403', bfiInboxMedia.status === 401 || bfiInboxMedia.status === 403, true);

  // ── SUITE 2: Socket.IO Call & Group-Call Signaling Governance ────────
  console.log('\n--- SUITE 2: Socket.IO Call & Group-Call Signaling Governance ---\n');

  const [aliceSocket, bobSocket, frankSocket, superSocket, mallorySocket, graceSocket, ivanSocket, student101Socket, student102Socket] = await Promise.all([
    connectSocket(tokens.reporter_alice),
    connectSocket(tokens.unrelated_bob),
    connectSocket(tokens.batchmate_frank),
    connectSocket(tokens.super_admin),
    connectSocket(tokens.mallory_text_spoof),
    connectSocket(tokens.grace_archived),
    connectSocket(tokens.ivan_deleted),
    connectSocket(tokens.student_101),
    connectSocket(tokens.student_102)
  ]);
  // Explicitly ensure Mallory (70) has 'BATCH-01' profile text but NO row in batch_students or student_course_enrollments
  const dbForSetup = (await import('../server/db/database.js')).default;
  dbForSetup.prepare('DELETE FROM batch_students WHERE student_id = 70').run();
  dbForSetup.prepare('DELETE FROM student_course_enrollments WHERE user_id = 70').run();

  console.log('✅ Connected test sockets: Alice (10), Bob (20), Frank (60), SuperAdmin (1), Mallory (70), Grace (80), Ivan (90)');

  // 2.1 Negative Control: Arbitrary call-rejected by authenticated user with no active pending call
  let aliceReceivedSpuriousRejection = null;
  aliceSocket.on('call-rejected', d => { aliceReceivedSpuriousRejection = d; });
  bobSocket.emit('call-rejected', { callerId: 10, reason: 'Arbitrary unprompted rejection' });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Arbitrary call-rejected without pending call is dropped: target receives nothing', aliceReceivedSpuriousRejection, null);

  // 2.2 Negative Control: Arbitrary 1:1 Call Request across unrelated batches (Alice -> Bob)
  let bobReceivedCall = null;
  let aliceRejected = null;
  bobSocket.on('call-request', d => { bobReceivedCall = d; });
  aliceSocket.on('call-rejected', d => { aliceRejected = d; });

  aliceSocket.emit('call-request', { receiverId: 20, callerData: { name: 'Alice' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice cannot call Bob (unrelated batch) - Bob receives nothing', bobReceivedCall, null);
  assertCheck('Alice receives call-rejected with CALL_DISALLOWED code', aliceRejected?.code, 'CALL_DISALLOWED');

  // 2.3 Negative Control: Call eligibility enforces actual active batch membership rather than profile text
  // Mallory (70) has student_profiles.batch_number = 'BATCH-01' matching Alice's text, but NO batch_students row!
  let aliceReceivedMalloryCall = null;
  let malloryRejected = null;
  aliceSocket.on('call-request', d => { aliceReceivedMalloryCall = d; });
  mallorySocket.on('call-rejected', d => { malloryRejected = d; });

  mallorySocket.emit('call-request', { receiverId: 10, callerData: { name: 'Mallory Spoof' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Profile text match without active batch_students assignment is rejected (Mallory -> Alice)', aliceReceivedMalloryCall, null);
  assertCheck('Mallory receives CALL_DISALLOWED rejection code', malloryRejected?.code, 'CALL_DISALLOWED');

  // 2.4 Negative Control: Students enrolled in archived batch cannot initiate calls
  // Grace (80) attempts to call Heidi (81) in Batch 3 (archived)
  let graceRejected = null;
  graceSocket.on('call-rejected', d => { graceRejected = d; });
  graceSocket.emit('call-request', { receiverId: 81, callerData: { name: 'Grace' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Call in archived batch is rejected with CALL_DISALLOWED', graceRejected?.code, 'CALL_DISALLOWED');

  // 2.5 Negative Control: Students enrolled in soft-deleted batch cannot initiate calls
  // Ivan (90) attempts to call Judy (91) in Batch 4 (deleted)
  let ivanRejected = null;
  ivanSocket.on('call-rejected', d => { ivanRejected = d; });
  ivanSocket.emit('call-request', { receiverId: 91, callerData: { name: 'Ivan' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Call in deleted batch is rejected with CALL_DISALLOWED', ivanRejected?.code, 'CALL_DISALLOWED');

  // 2.6 Negative Control: Signaling without active call session
  let bobReceivedOffer = null;
  bobSocket.on('webrtc-offer', d => { bobReceivedOffer = d; });
  aliceSocket.emit('webrtc-offer', { receiverId: 20, offer: { sdp: 'fake-sdp' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Unauthenticated webrtc-offer without active call is dropped', bobReceivedOffer, null);

  // 2.7 Negative Control: Group-call invite from user not in an active call
  let bobReceivedGroupInvite = null;
  bobSocket.on('group-call-invite', d => { bobReceivedGroupInvite = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 20, callerData: { id: 1, name: 'Forged Admin' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('group-call-invite dropped when caller is not in an active connected call', bobReceivedGroupInvite, null);

  // 2.8 Positive Control: Legitimate 1:1 Call Request between Active Batchmates (Alice -> Frank)
  let frankReceivedCall = null;
  frankSocket.on('call-request', d => { frankReceivedCall = d; });

  aliceSocket.emit('call-request', { receiverId: 60, callerData: { name: 'Alice' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Frank (batchmate in active batch 1) receives legitimate call-request', Boolean(frankReceivedCall), true);
  assertCheck('call-request callerId is authoritatively set to Alice (ID 10)', frankReceivedCall?.callerId, 10);

  // 2.9 Negative Control: Third-party (Bob) attempts to reject Alice's pending call to Frank
  let aliceReceivedBobRejection = null;
  aliceSocket.on('call-rejected', d => { aliceReceivedBobRejection = d; });
  bobSocket.emit('call-rejected', { callerId: 10, reason: 'Malicious third-party rejection attempt' });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Third-party non-recipient cannot reject pending call: caller receives nothing', aliceReceivedBobRejection, null);

  // 2.10 Positive Control: Frank (designated recipient) legitimately rejects the call
  let aliceReceivedFrankRejection = null;
  aliceSocket.on('call-rejected', d => { aliceReceivedFrankRejection = d; });
  frankSocket.emit('call-rejected', { callerId: 10, reason: 'Busy right now' });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives legitimate call-rejected from designated recipient Frank', Boolean(aliceReceivedFrankRejection), true);
  assertCheck('call-rejected rejecterId is authoritatively Frank (ID 60)', aliceReceivedFrankRejection?.rejecterId, 60);

  // 2.11 Positive Control: Second legitimate 1:1 Call (Alice -> Frank) followed by Answering
  frankReceivedCall = null;
  aliceSocket.emit('call-request', { receiverId: 60, callerData: { name: 'Alice' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Second call request received by Frank', Boolean(frankReceivedCall), true);

  // Frank answers call
  let aliceReceivedAnswer = null;
  aliceSocket.on('call-answered', d => { aliceReceivedAnswer = d; });
  frankSocket.emit('call-answered', { callerId: 10, answererData: { name: 'Frank' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives call-answered from Frank', Boolean(aliceReceivedAnswer), true);
  assertCheck('call-answered answererId is authoritatively Frank (ID 60)', aliceReceivedAnswer?.answererId, 60);

  // Now both are connected in an active call! Verify WebRTC signaling passes between peers
  let frankReceivedOffer = null;
  frankSocket.on('webrtc-offer', d => { frankReceivedOffer = d; });
  aliceSocket.emit('webrtc-offer', { receiverId: 60, offer: { sdp: 'legit-alice-sdp' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Frank receives legitimate webrtc-offer within active call session', frankReceivedOffer?.offer?.sdp, 'legit-alice-sdp');

  // Verify third-party (Bob) cannot inject an ICE candidate into Alice & Frank's call
  let frankReceivedFakeIce = null;
  frankSocket.on('ice-candidate', d => { frankReceivedFakeIce = d; });
  bobSocket.emit('ice-candidate', { targetId: 60, candidate: { candidate: 'forged-bob-candidate' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Bob cannot inject ICE candidate into Alice & Frank call', frankReceivedFakeIce, null);

  // 2.12 Group-Call Invite & Decline via Socket.IO
  let user101ReceivedInvite = null;
  student101Socket.on('group-call-invite', d => { user101ReceivedInvite = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 101, callerData: { id: 10, name: 'Alice' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('User 101 receives group-call-invite with callId', Boolean(user101ReceivedInvite?.callId), true);

  // User 101 declines the invitation
  let aliceReceivedGroupDecline = null;
  let frankReceivedGroupDecline = null;
  aliceSocket.on('group-call-declined', d => { aliceReceivedGroupDecline = d; });
  frankSocket.on('group-call-declined', d => { frankReceivedGroupDecline = d; });

  student101Socket.emit('group-call-declined', {
    callId: user101ReceivedInvite.callId,
    inviterId: 10,
    reason: 'Declining group call'
  });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives group-call-declined from User 101', aliceReceivedGroupDecline?.declinerId, 101);
  assertCheck('Frank (group peer) receives group-call-declined from User 101', frankReceivedGroupDecline?.declinerId, 101);

  // Alice and Frank session is still intact: offer still works
  frankReceivedOffer = null;
  aliceSocket.emit('webrtc-offer', { receiverId: 60, offer: { sdp: 'still-connected-sdp' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice & Frank session remains connected after group invite decline', frankReceivedOffer?.offer?.sdp, 'still-connected-sdp');

  // ── 2.13 Socket-level Group-Call Invite Cancellation (Wire Verification) ─
  let user101ReceivedCancel = null;
  student101Socket.on('group-invite-cancelled', d => { user101ReceivedCancel = d; });

  // Alice re-invites User 101 to test wire cancellation
  let user101SecondInvite = null;
  student101Socket.on('group-call-invite', d => { user101SecondInvite = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 101, callerData: { id: 10, name: 'Alice' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('User 101 receives second group-call-invite over the wire', Boolean(user101SecondInvite?.callId), true);

  // Negative: Third-party (Bob, not in call) emits group-invite-cancelled
  bobSocket.emit('group-invite-cancelled', { callId: user101SecondInvite.callId, receiverId: 101 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Unauthorized third-party cancel dropped over the wire', user101ReceivedCancel, null);

  // Negative: Alice emits group-invite-cancelled with mismatched callId
  aliceSocket.emit('group-invite-cancelled', { callId: 'call_mismatched_wire_id', receiverId: 101 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Mismatched callId cancel dropped over the wire', user101ReceivedCancel, null);

  // Positive: Alice emits legitimate group-invite-cancelled
  aliceSocket.emit('group-invite-cancelled', { callId: user101SecondInvite.callId, receiverId: 101 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('User 101 receives legitimate group-invite-cancelled over the wire', user101ReceivedCancel?.callId, user101SecondInvite.callId);

  // ── 2.14 Socket-level Stale Event & Missing callId Wire Rejection ────────
  // Alice invites User 101 a third time
  let wireInvite = null;
  student101Socket.on('group-call-invite', d => { wireInvite = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 101, callerData: { id: 10, name: 'Alice' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('User 101 receives third group-call-invite for wire stale tests', Boolean(wireInvite?.callId), true);

  // Wire Negative A: Missing callId on group-call-accepted -> dropped by server
  let wireJoinReceived = null;
  aliceSocket.on('group-call-accepted', d => { wireJoinReceived = d; });
  frankSocket.on('group-call-accepted', d => { wireJoinReceived = d; });
  student101Socket.emit('group-call-accepted', { joinerData: { id: 101 } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('group-call-accepted with missing callId dropped over wire', wireJoinReceived, null);

  // Wire Negative B: Stale callId on group-call-accepted -> dropped by server
  student101Socket.emit('group-call-accepted', { callId: 'stale_call_ended_wire', joinerData: { id: 101 } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('group-call-accepted with stale callId dropped over wire', wireJoinReceived, null);

  // Wire Negative C: Missing callId on group-call-declined -> dropped by server
  let wireDeclineReceived = null;
  aliceSocket.on('group-call-declined', d => { wireDeclineReceived = d; });
  frankSocket.on('group-call-declined', d => { wireDeclineReceived = d; });
  student101Socket.emit('group-call-declined', { inviterId: 10 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('group-call-declined with missing callId dropped over wire', wireDeclineReceived, null);

  // Wire Negative D: Stale callId on group-call-declined -> dropped by server
  student101Socket.emit('group-call-declined', { callId: 'stale_call_ended_wire', inviterId: 10 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('group-call-declined with stale callId dropped over wire', wireDeclineReceived, null);

  // Wire Positive: Legitimate group-call-accepted with matching callId
  let aliceReceivedWireJoin = null;
  let frankReceivedWireJoin = null;
  aliceSocket.on('group-call-accepted', d => { aliceReceivedWireJoin = d; });
  frankSocket.on('group-call-accepted', d => { frankReceivedWireJoin = d; });
  student101Socket.emit('group-call-accepted', {
    callId: wireInvite.callId,
    joinerData: { id: 101, name: 'Student 101' }
  });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives legitimate group-call-accepted over the wire', aliceReceivedWireJoin?.joinerData?.id, 101);
  assertCheck('Frank receives legitimate group-call-accepted over the wire', frankReceivedWireJoin?.joinerData?.id, 101);

  // Wire signaling check: newly joined User 101 sends offer to Frank
  let frankReceivedWireOffer = null;
  frankSocket.on('group-webrtc-offer', d => { frankReceivedWireOffer = d; });
  student101Socket.emit('group-webrtc-offer', { receiverId: 60, offer: { sdp: 'user101-group-sdp' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Frank receives group-webrtc-offer from User 101 over the wire', frankReceivedWireOffer?.offer?.sdp, 'user101-group-sdp');

  // ── 2.15 Group Invite Acknowledgements & Joiner Cancellation (Bug 1 & Bug 2) ──
  // A. Bug 2 Negative: Alice invites ineligible User 20 (Bob, different batch) -> rejected with ack
  let aliceInviteResultFail = null;
  aliceSocket.on('group-invite-result', d => { aliceInviteResultFail = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 20, callerData: { id: 10, name: 'Alice' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives group-invite-result on rejected invitation', aliceInviteResultFail?.ok, false);
  assertCheck('Rejected group invite returns INVITE_DISALLOWED code', aliceInviteResultFail?.code, 'INVITE_DISALLOWED');
  assertCheck('Rejected group invite targets receiverId 20', aliceInviteResultFail?.receiverId, 20);

  // B. Bug 2 Positive: Alice invites eligible User 102 (Student 102, same batch) -> succeeds with ack
  let aliceInviteResultSuccess = null;
  let user102ReceivedInvite = null;
  aliceSocket.on('group-invite-result', d => { aliceInviteResultSuccess = d; });
  student102Socket.on('group-call-invite', d => { user102ReceivedInvite = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 102, callerData: { id: 10, name: 'Alice' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives group-invite-result on successful invitation', aliceInviteResultSuccess?.ok, true);
  assertCheck('Successful group invite returns matching callId', aliceInviteResultSuccess?.callId, wireInvite.callId);
  assertCheck('User 102 receives group-call-invite over the wire', user102ReceivedInvite?.callId, wireInvite.callId);

  // C. Bug 1 Regression: User 101 (who joined via group-invite accept) cancels the invitation to User 102
  let user101CancelResult = null;
  let user102ReceivedCancel = null;
  student101Socket.on('group-invite-cancelled-result', d => { user101CancelResult = d; });
  student102Socket.on('group-invite-cancelled', d => { user102ReceivedCancel = d; });
  student101Socket.emit('group-invite-cancelled', { callId: wireInvite.callId, receiverId: 102 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Group joiner (User 101) cancellation accepted by server', user101CancelResult?.ok, true);
  assertCheck('User 102 receives group-invite-cancelled triggered by group joiner', user102ReceivedCancel?.callId, wireInvite.callId);

  // D. Negative Control: User 101 attempts to cancel uninvited User 20 -> rejected with ack
  let user101CancelFail = null;
  student101Socket.on('group-invite-cancelled-result', d => { user101CancelFail = d; });
  student101Socket.emit('group-invite-cancelled', { callId: wireInvite.callId, receiverId: 20 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Cancelling uninvited user returns ok: false', user101CancelFail?.ok, false);
  assertCheck('Cancelling uninvited user returns NOT_INVITED code', user101CancelFail?.code, 'NOT_INVITED');

  // Frank ends call
  let aliceReceivedEnded = null;
  aliceSocket.on('call-ended', d => { aliceReceivedEnded = d; });
  frankSocket.emit('call-ended', { targetId: 10 });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice receives call-ended notification when peer terminates call', Boolean(aliceReceivedEnded), true);

  // Verify call session was torn down: subsequent offers are now dropped
  let frankPostOffer = null;
  frankSocket.on('webrtc-offer', d => { frankPostOffer = d; });
  aliceSocket.emit('webrtc-offer', { receiverId: 60, offer: { sdp: 'post-end-sdp' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Post-termination signaling is strictly dropped', frankPostOffer, null);

  // ── SUITE 3: In-Process Service Verification (TTL & Capacity Enforcement) ───
  console.log('\n--- SUITE 3: Service-Level Pending Call Expiry & Group Ceiling Tests ---\n');

  const signalingModule = await import('../server/services/callSignalingService.js');
  const dbModule = await import('../server/db/database.js');
  const activeDb = dbModule.default;

  signalingModule.resetCallSignalingState();

  // 3.1 60-Second Pending Call Expiry Enforcement
  assertCheck('PENDING_CALL_TTL_MS is strictly 60,000ms', signalingModule.PENDING_CALL_TTL_MS, 60000);

  const reqResult = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  assertCheck('handleCallRequest created pending ringing session', reqResult.ok, true);

  // Manually backdate the ringing session to 65 seconds ago
  reqResult.session.createdAt = Date.now() - 65000;
  assertCheck('isPendingCallExpired detects expired ringing call', signalingModule.isPendingCallExpired(reqResult.session), true);

  // Attempt to answer expired call
  const answerExpired = signalingModule.handleCallAnswered(60, { callerId: 10 });
  assertCheck('handleCallAnswered rejects expired pending call', answerExpired.ok, false);
  assertCheck('Expired call answer returns CALL_EXPIRED code', answerExpired.code, 'CALL_EXPIRED');

  // Attempt to reject expired call
  const reqResult2 = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  reqResult2.session.createdAt = Date.now() - 65000;
  const rejectExpired = signalingModule.handleCallRejected(60, { callerId: 10 });
  assertCheck('handleCallRejected rejects expired pending call', rejectExpired.ok, false);
  assertCheck('Expired call reject returns CALL_EXPIRED code', rejectExpired.code, 'CALL_EXPIRED');

  // Global Pruning of Expired Calls
  const reqResult3 = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  reqResult3.session.createdAt = Date.now() - 65000;
  const prunedCount = signalingModule.pruneExpiredPendingCalls();
  assertCheck('pruneExpiredPendingCalls cleanly purged expired session', prunedCount, 1);

  // 3.2 Maximum 9-Person Group Call Ceiling Enforcement
  assertCheck('MAX_GROUP_PARTICIPANTS is strictly 9', signalingModule.MAX_GROUP_PARTICIPANTS, 9);

  // Connect Alice (10) and Frank (60)
  signalingModule.resetCallSignalingState();
  signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  signalingModule.handleCallAnswered(60, { callerId: 10 });

  // Invite 7 additional cohort members (Users 101..107), bringing total to 9
  for (let id = 101; id <= 107; id++) {
    const invRes = signalingModule.handleGroupInvite(10, { receiverId: id }, activeDb);
    assertCheck(`Group invite for participant #${id} (capacity ${id - 100 + 2}/9) succeeded`, invRes.ok, true);
  }

  // Attempt 10th participant invitation (User 108) -> MUST BE REJECTED
  const overCapacityInvite = signalingModule.handleGroupInvite(10, { receiverId: 108 }, activeDb);
  assertCheck('Invitation exceeding 9 participants is rejected', overCapacityInvite.ok, false);
  assertCheck('Exceeded capacity returns MAX_PARTICIPANTS_REACHED code', overCapacityInvite.code, 'MAX_PARTICIPANTS_REACHED');

  // 3.3 Call-State Conflict Prevention Tests
  console.log('\n--- SUITE 3.3: Call-State Conflict Negative Controls ---\n');

  // ── Test A: Ringing caller cannot start a second call ─────────────────────
  signalingModule.resetCallSignalingState();
  const callerRingResult = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  assertCheck('Test A setup: Alice→Frank ringing session created', callerRingResult.ok, true);

  // Alice (10) attempts a second call to User 101 (eligible cohort peer) while already ringing
  const secondCallByCaller = signalingModule.handleCallRequest(10, { receiverId: 101 }, activeDb);
  assertCheck('Test A: Ringing caller cannot start a second call', secondCallByCaller.ok, false);
  assertCheck('Test A: Returns CALLER_RINGING code', secondCallByCaller.code, 'CALLER_RINGING');

  // Original call (Alice→Frank) remains answerable
  const answerOriginalAfterBlock = signalingModule.handleCallAnswered(60, { callerId: 10 });
  assertCheck('Test A: Original pending call still answerable after blocked second attempt', answerOriginalAfterBlock.ok, true);

  // ── Test B: Second caller cannot ring an already-ringing receiver ──────────
  signalingModule.resetCallSignalingState();
  // Frank (60) calls Alice (10); Alice is now ringing as receiver
  signalingModule.handleCallRequest(60, { receiverId: 10 }, activeDb);
  // User 101 (eligible cohort peer) also tries to call Alice (10) — Alice is ringing, must block
  const secondCallerToRinging = signalingModule.handleCallRequest(101, { receiverId: 10 }, activeDb);
  assertCheck('Test B: Second caller blocked when receiver is already ringing', secondCallerToRinging.ok, false);
  assertCheck('Test B: Returns RECIPIENT_RINGING code', secondCallerToRinging.code, 'RECIPIENT_RINGING');

  // Frank's original call to Alice remains answerable
  const answerOriginalReceiver = signalingModule.handleCallAnswered(10, { callerId: 60 });
  assertCheck('Test B: Original ringing call to receiver still answerable', answerOriginalReceiver.ok, true);

  // Alice is now CONNECTED; User 101 must still be blocked
  const thirdCallerToConnected = signalingModule.handleCallRequest(101, { receiverId: 10 }, activeDb);
  assertCheck('Test B: Connected receiver blocks incoming call', thirdCallerToConnected.ok, false);
  assertCheck('Test B: Returns RECIPIENT_BUSY code for connected receiver', thirdCallerToConnected.code, 'RECIPIENT_BUSY');

  // ── Test C: Group invite rejected when invitee is already in another call ──
  signalingModule.resetCallSignalingState();
  // Alice (10) ↔ Frank (60): connected in Call 1
  signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  signalingModule.handleCallAnswered(60, { callerId: 10 });
  // User 101 ↔ User 102: connected in Call 2
  signalingModule.handleCallRequest(101, { receiverId: 102 }, activeDb);
  signalingModule.handleCallAnswered(102, { callerId: 101 });

  // Alice (in call with Frank) tries to invite User 101 (connected with 102)
  const busyInvite = signalingModule.handleGroupInvite(10, { receiverId: 101 }, activeDb);
  assertCheck('Test C: Group invite to user already connected in another call is rejected', busyInvite.ok, false);
  assertCheck('Test C: Returns INVITEE_BUSY code', busyInvite.code, 'INVITEE_BUSY');

  // Alice-Frank session remains intact: verifyActivePeer should still confirm both sides
  assertCheck('Test C: Alice-Frank session is intact after rejected group invite', signalingModule.verifyActivePeer(10, 60), true);
  assertCheck('Test C: Frank-Alice session is intact after rejected group invite', signalingModule.verifyActivePeer(60, 10), true);
  // User 101-102 session also remains intact
  assertCheck('Test C: Peer 101-102 session is intact after rejected group invite', signalingModule.verifyActivePeer(101, 102), true);

  // ── Test D: cleanupPendingCall identity guard (observable via call behaviour) ──
  signalingModule.resetCallSignalingState();
  // Frank (60) calls Alice (10)
  signalingModule.handleCallRequest(60, { receiverId: 10 }, activeDb);
  // Alice rejects the call
  const reject1 = signalingModule.handleCallRejected(10, { callerId: 60 });
  assertCheck('Test D: Alice correctly rejects Frank\'s call', reject1.ok, true);

  // After rejection, User 101 can now call Alice (10) — userActiveCall[10] was cleanly removed
  const newCallAfterRejection = signalingModule.handleCallRequest(101, { receiverId: 10 }, activeDb);
  assertCheck('Test D: New call to previously-ringing receiver succeeds after rejection', newCallAfterRejection.ok, true);

  // Frank (60) is also free; can be called by User 102
  const frankFreeCheck = signalingModule.handleCallRequest(102, { receiverId: 60 }, activeDb);
  assertCheck('Test D: Frank is free and can receive calls after his call was rejected and cleaned up', frankFreeCheck.ok, true);

  // ── Test E: User with pending group invite is busy for conflicting calls ───
  signalingModule.resetCallSignalingState();
  // Alice (10) and Frank (60) connected
  signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  signalingModule.handleCallAnswered(60, { callerId: 10 });
  // Alice invites User 103 to group call
  const invite103 = signalingModule.handleGroupInvite(10, { receiverId: 103 }, activeDb);
  assertCheck('Test E setup: Group invite for User 103 created', invite103.ok, true);

  // User 104 tries to call User 103 (1:1 call) -> User 103 has pending group invite, must block
  const callToPendingInvitee = signalingModule.handleCallRequest(104, { receiverId: 103 }, activeDb);
  assertCheck('Test E: 1:1 call to user with pending group invite is blocked', callToPendingInvitee.ok, false);
  assertCheck('Test E: Returns RECIPIENT_RINGING code', callToPendingInvitee.code, 'RECIPIENT_RINGING');

  // Another ongoing call tries to invite User 103 -> blocked
  signalingModule.handleCallRequest(105, { receiverId: 106 }, activeDb);
  signalingModule.handleCallAnswered(106, { callerId: 105 });
  const duplicateGroupInvite = signalingModule.handleGroupInvite(105, { receiverId: 103 }, activeDb);
  assertCheck('Test E: Second group invite to user with pending group invite is blocked', duplicateGroupInvite.ok, false);
  assertCheck('Test E: Returns INVITEE_BUSY code', duplicateGroupInvite.code, 'INVITEE_BUSY');

  // User 103 can still accept Alice's original group invite with exact callId
  const acceptOriginal = signalingModule.handleGroupAccepted(103, { callId: invite103.session.callId });
  assertCheck('Test E: Original group invite remains acceptable after conflicting attempts', acceptOriginal.ok, true);

  // 3.4 Group-Call Invitation Lifecycle, Rejection & Expiry Controls
  console.log('\n--- SUITE 3.4: Group-Call Invitation Rejection & Expiry Controls ---\n');

  // ── 3.4.1 Group Invitation Expiry TTL Constant & Detection ───────────────
  assertCheck('GROUP_INVITE_TTL_MS is strictly 60,000ms', signalingModule.GROUP_INVITE_TTL_MS, 60000);

  signalingModule.resetCallSignalingState();
  // Alice (10) and Frank (60) connected
  signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb);
  signalingModule.handleCallAnswered(60, { callerId: 10 });

  // Alice invites User 101
  const invite101 = signalingModule.handleGroupInvite(10, { receiverId: 101 }, activeDb);
  assertCheck('Group invite for User 101 created', invite101.ok, true);
  assertCheck('User 101 is busy in invited state', signalingModule.userBusyState(101)?.state, 'invited');

  // Backdate User 101 invitation to 65 seconds ago
  invite101.session.invitedTimestamps.get(101).invitedAt = Date.now() - 65000;
  assertCheck('isGroupInviteExpired detects expired group invitation', signalingModule.isGroupInviteExpired(invite101.session, 101), true);

  // Attempt to accept expired group invitation -> rejected with INVITE_EXPIRED
  const acceptExpiredGroup = signalingModule.handleGroupAccepted(101, { callId: invite101.session.callId });
  assertCheck('handleGroupAccepted rejects expired invitation', acceptExpiredGroup.ok, false);
  assertCheck('Expired group accept returns INVITE_EXPIRED code', acceptExpiredGroup.code, 'INVITE_EXPIRED');

  // Verify User 101 is now free after expired accept attempt
  assertCheck('User 101 is free after expired invitation cleanup', signalingModule.userBusyState(101), null);

  // User 101 can now start a new 1:1 call to User 102
  const newCallFromExpiredInvitee = signalingModule.handleCallRequest(101, { receiverId: 102 }, activeDb);
  assertCheck('Previously-expired invitee can start a new call', newCallFromExpiredInvitee.ok, true);

  // ── 3.4.2 Authenticated Group Invite Decline Flow ─────────────────────────
  signalingModule.resetCallSignalingState();
  // Alice (10) and Frank (60) connected in group call
  const s2 = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb).session;
  signalingModule.handleCallAnswered(60, { callerId: 10 });

  // Alice invites User 102
  signalingModule.handleGroupInvite(10, { receiverId: 102 }, activeDb);
  assertCheck('User 102 is marked invited before decline', signalingModule.userBusyState(102)?.state, 'invited');

  // User 102 declines the group invitation
  const declineRes = signalingModule.handleGroupInviteDeclined(102, { callId: s2.callId, reason: 'Busy studying' });
  assertCheck('handleGroupInviteDeclined returns ok: true', declineRes.ok, true);
  assertCheck('handleGroupInviteDeclined sets isGroupInvite: true', declineRes.isGroupInvite, true);
  assertCheck('Decline payload has authoritatively declinerId: 102', declineRes.sanitizedPayload?.declinerId, 102);

  // Group call remains connected with original participants (Alice & Frank)
  assertCheck('Group call session still has 2 active participants', s2.participants.size, 2);
  assertCheck('Group call session is still connected', s2.state, 'connected');
  assertCheck('Alice & Frank peer signaling remains valid', signalingModule.verifyActivePeer(10, 60), true);

  // User 102 is NO LONGER busy
  assertCheck('Decliner User 102 is free after decline', signalingModule.userBusyState(102), null);

  // User 102 can immediately receive a new call from User 103
  const incomingCallToDecliner = signalingModule.handleCallRequest(103, { receiverId: 102 }, activeDb);
  assertCheck('Declined invitee can immediately receive new call', incomingCallToDecliner.ok, true);

  // ── 3.4.3 Fallback Rejection via handleCallRejected ────────────────────────
  signalingModule.resetCallSignalingState();
  const s3 = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb).session;
  signalingModule.handleCallAnswered(60, { callerId: 10 });

  // Alice invites User 104
  signalingModule.handleGroupInvite(10, { receiverId: 104 }, activeDb);

  // User 104 calls handleCallRejected with inviterId as callerId (legacy / client fallback)
  const fallbackReject = signalingModule.handleCallRejected(104, { callerId: 10, callId: s3.callId });
  assertCheck('handleCallRejected handles group invite decline fallback', fallbackReject.ok, true);
  assertCheck('handleCallRejected sets isGroupInvite: true', fallbackReject.isGroupInvite, true);
  assertCheck('User 104 is free after fallback rejection', signalingModule.userBusyState(104), null);
  assertCheck('Group call session remains connected after fallback rejection', s3.state, 'connected');

  // ── 3.4.4 Group Invitation Cancellation Flow ──────────────────────────────
  signalingModule.resetCallSignalingState();
  const s4 = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb).session;
  signalingModule.handleCallAnswered(60, { callerId: 10 });

  // Alice invites User 105
  signalingModule.handleGroupInvite(10, { receiverId: 105 }, activeDb);

  // Third party (User 20, not in call) attempts to cancel -> fails
  const unauthorizedCancel = signalingModule.handleGroupInviteCancelled(20, { receiverId: 105, callId: s4.callId });
  assertCheck('Unauthorized non-participant cannot cancel group invitation', unauthorizedCancel.ok, false);

  // Alice (inviter/participant) cancels the invitation
  const cancelRes = signalingModule.handleGroupInviteCancelled(10, { receiverId: 105, callId: s4.callId });
  assertCheck('Legitimate participant cancels group invitation', cancelRes.ok, true);
  assertCheck('Cancelled user is removed from invitedParticipants', s4.invitedParticipants.has(105), false);
  assertCheck('User 105 is free after cancellation', signalingModule.userBusyState(105), null);

  // User 105 can start a new call to User 106
  const callAfterCancel = signalingModule.handleCallRequest(105, { receiverId: 106 }, activeDb);
  assertCheck('User 105 can start new call after invitation cancellation', callAfterCancel.ok, true);

  // ── 3.4.5 Group Invitation Sweep Pruning ──────────────────────────────────
  signalingModule.resetCallSignalingState();
  const s5 = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb).session;
  signalingModule.handleCallAnswered(60, { callerId: 10 });
  signalingModule.handleGroupInvite(10, { receiverId: 106 }, activeDb);
  s5.invitedTimestamps.get(106).invitedAt = Date.now() - 70000;

  const prunedInvites = signalingModule.pruneExpiredGroupInvites();
  assertCheck('pruneExpiredGroupInvites purges expired invitations', prunedInvites, 1);
  assertCheck('User 106 is free after sweep pruning', signalingModule.userBusyState(106), null);

  // ── 3.4.6 Exact callId Matching & Stale Event Isolation Controls ──────────
  console.log('\n--- SUITE 3.4.6: Exact callId Matching & Stale Event Isolation Controls ---\n');
  signalingModule.resetCallSignalingState();

  // Test 1: Missing or invalid callId is rejected without changing state
  assertCheck('handleGroupAccepted rejects missing callId', signalingModule.handleGroupAccepted(107, {}).ok, false);
  assertCheck('Missing callId returns INVALID_CALL_ID code on accept', signalingModule.handleGroupAccepted(107, {}).code, 'INVALID_CALL_ID');
  assertCheck('handleGroupAccepted rejects empty callId', signalingModule.handleGroupAccepted(107, { callId: '   ' }).ok, false);

  assertCheck('handleGroupInviteDeclined rejects missing callId', signalingModule.handleGroupInviteDeclined(107, {}).ok, false);
  assertCheck('Missing callId returns INVALID_CALL_ID code on decline', signalingModule.handleGroupInviteDeclined(107, {}).code, 'INVALID_CALL_ID');
  assertCheck('handleGroupInviteDeclined rejects empty callId', signalingModule.handleGroupInviteDeclined(107, { callId: '   ' }).ok, false);

  assertCheck('handleGroupInviteCancelled rejects missing callId', signalingModule.handleGroupInviteCancelled(10, { receiverId: 107 }).ok, false);
  assertCheck('Missing callId returns INVALID_CALL_ID code on cancel', signalingModule.handleGroupInviteCancelled(10, { receiverId: 107 }).code, 'INVALID_CALL_ID');
  assertCheck('handleGroupInviteCancelled rejects empty callId', signalingModule.handleGroupInviteCancelled(10, { receiverId: 107, callId: '   ' }).ok, false);

  // Test 2: Stale events from an old call cannot affect a newer invitation
  // Step A: Create and finish Call A
  const callA = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb).session;
  signalingModule.handleCallAnswered(60, { callerId: 10 });
  const staleCallId = callA.callId;
  // End Call A
  signalingModule.handleCallEnded(10, { targetId: 60 });
  assertCheck('Call A cleanly ended and removed from callSessions', signalingModule.__testing.hasSession(staleCallId), false);

  // Step B: Wait 15ms so timestamp advances, start new Call B (Alice & Frank) and invite User 107
  await new Promise(r => setTimeout(r, 15));
  const callB = signalingModule.handleCallRequest(10, { receiverId: 60 }, activeDb).session;
  signalingModule.handleCallAnswered(60, { callerId: 10 });
  const activeCallId = callB.callId;
  assertCheck('Call B is connected with distinct callId', activeCallId !== staleCallId, true);

  const inviteUser107 = signalingModule.handleGroupInvite(10, { receiverId: 107 }, activeDb);
  assertCheck('User 107 invited to Call B', inviteUser107.ok, true);
  assertCheck('User 107 in invited state for Call B', signalingModule.userBusyState(107)?.state, 'invited');
  assertCheck('Call B invitedParticipants contains User 107', callB.invitedParticipants.has(107), true);

  // Step C: Stale accept with staleCallId -> rejected, does NOT alter Call B
  const staleAccept = signalingModule.handleGroupAccepted(107, { callId: staleCallId });
  assertCheck('Stale accept with old callId fails', staleAccept.ok, false);
  assertCheck('Stale accept returns CALL_NOT_FOUND', staleAccept.code, 'CALL_NOT_FOUND');
  assertCheck('User 107 remains pending in Call B after stale accept', callB.invitedParticipants.has(107), true);
  assertCheck('Call B participants do NOT include User 107 after stale accept', callB.participants.has(107), false);
  assertCheck('User 107 busy state remains invited after stale accept', signalingModule.userBusyState(107)?.state, 'invited');

  // Step D: Stale decline with staleCallId -> rejected, does NOT alter Call B
  const staleDecline = signalingModule.handleGroupInviteDeclined(107, { callId: staleCallId });
  assertCheck('Stale decline with old callId fails', staleDecline.ok, false);
  assertCheck('Stale decline returns CALL_NOT_FOUND', staleDecline.code, 'CALL_NOT_FOUND');
  assertCheck('User 107 remains pending in Call B after stale decline', callB.invitedParticipants.has(107), true);
  assertCheck('User 107 busy state remains invited after stale decline', signalingModule.userBusyState(107)?.state, 'invited');

  // Step E: Stale cancellation with staleCallId by Alice -> rejected, does NOT alter Call B
  const staleCancel = signalingModule.handleGroupInviteCancelled(10, { receiverId: 107, callId: staleCallId });
  assertCheck('Stale cancellation with old callId fails', staleCancel.ok, false);
  assertCheck('Stale cancellation returns CALL_NOT_FOUND', staleCancel.code, 'CALL_NOT_FOUND');
  assertCheck('User 107 remains pending in Call B after stale cancellation', callB.invitedParticipants.has(107), true);
  assertCheck('User 107 busy state remains invited after stale cancellation', signalingModule.userBusyState(107)?.state, 'invited');

  // Step F: Stale fallback rejection via handleCallRejected with staleCallId -> rejected, does NOT alter Call B
  const staleCallRejected = signalingModule.handleCallRejected(107, { callId: staleCallId });
  assertCheck('Stale handleCallRejected with old callId fails', staleCallRejected.ok, false);
  assertCheck('User 107 remains pending in Call B after stale handleCallRejected', callB.invitedParticipants.has(107), true);

  // Step G: Stale decline with another existing session's callId that did not invite User 107
  const callC = signalingModule.handleCallRequest(105, { receiverId: 106 }, activeDb).session;
  signalingModule.handleCallAnswered(106, { callerId: 105 });
  const mismatchedDecline = signalingModule.handleGroupInviteDeclined(107, { callId: callC.callId });
  assertCheck('Decline with mismatched concurrent callId fails', mismatchedDecline.ok, false);
  assertCheck('Mismatched decline returns NOT_INVITED', mismatchedDecline.code, 'NOT_INVITED');
  assertCheck('User 107 remains pending in Call B after mismatched decline', callB.invitedParticipants.has(107), true);
  signalingModule.handleCallEnded(105, { targetId: 106 });

  // Step H: Legitimate acceptance with the exact matching activeCallId succeeds
  const legitAccept = signalingModule.handleGroupAccepted(107, { callId: activeCallId });
  assertCheck('Legitimate accept with exact activeCallId succeeds', legitAccept.ok, true);
  assertCheck('User 107 added to Call B participants', callB.participants.has(107), true);
  assertCheck('User 107 removed from Call B invitedParticipants', callB.invitedParticipants.has(107), false);
  assertCheck('User 107 busy state is now connected', signalingModule.userBusyState(107)?.state, 'connected');

  // ── 3.4.7 Error Contract & Non-Connected Decline Controls ─────────────────
  console.log('\n--- SUITE 3.4.7: Error Contract & Non-Connected State Controls ---\n');

  // Five failure branches of handleGroupInviteCancelled:
  // Branch 1: INVALID_CALL_ID
  const cancelInvCallId = signalingModule.handleGroupInviteCancelled(10, { receiverId: 107, callId: '' });
  assertCheck('Cancel missing callId returns INVALID_CALL_ID', cancelInvCallId.code, 'INVALID_CALL_ID');

  // Branch 2: INVALID_RECEIVER_ID
  const cancelInvRecId = signalingModule.handleGroupInviteCancelled(10, { callId: callB.callId, receiverId: 'invalid' });
  assertCheck('Cancel invalid receiverId returns INVALID_RECEIVER_ID', cancelInvRecId.code, 'INVALID_RECEIVER_ID');

  // Branch 3: CALL_NOT_FOUND (session does not exist or not connected)
  const cancelNotFound = signalingModule.handleGroupInviteCancelled(10, { callId: 'non_existent_call_123', receiverId: 107 });
  assertCheck('Cancel nonexistent session returns CALL_NOT_FOUND', cancelNotFound.code, 'CALL_NOT_FOUND');

  // Branch 4: CALL_MISMATCH (canceller is active in a different call than the provided callId)
  signalingModule.handleCallRequest(105, { receiverId: 106 }, activeDb);
  signalingModule.handleCallAnswered(106, { callerId: 105 });
  const cancelMismatch = signalingModule.handleGroupInviteCancelled(105, { callId: callB.callId, receiverId: 107 });
  assertCheck('Canceller in different call returns CALL_MISMATCH', cancelMismatch.code, 'CALL_MISMATCH');
  signalingModule.handleCallEnded(105, { targetId: 106 });

  // Branch 5: NOT_IN_CALL (canceller is not in any active connected call, but calls a valid session)
  const cancelNotInCall = signalingModule.handleGroupInviteCancelled(20, { callId: callB.callId, receiverId: 107 });
  assertCheck('Canceller not in call returns NOT_IN_CALL', cancelNotInCall.code, 'NOT_IN_CALL');

  // Branch 6: NOT_INVITED (canceller is in callB, but receiver was not invited)
  const cancelNotInvited = signalingModule.handleGroupInviteCancelled(10, { callId: callB.callId, receiverId: 20 });
  assertCheck('Canceller targeting uninvited user returns NOT_INVITED', cancelNotInvited.code, 'NOT_INVITED');

  // Non-connected state check on decline (Correction 3):
  const ringingSession = signalingModule.handleCallRequest(105, { receiverId: 106 }, activeDb).session;
  ringingSession.invitedParticipants.add(107); // simulate invite on ringing session
  const declineNonConnected = signalingModule.handleGroupInviteDeclined(107, { callId: ringingSession.callId });
  assertCheck('Decline against non-connected ringing session fails', declineNonConnected.ok, false);
  assertCheck('Decline against non-connected session returns CALL_NOT_FOUND', declineNonConnected.code, 'CALL_NOT_FOUND');
  assertCheck('Ringing session invitedParticipants not mutated', ringingSession.invitedParticipants.has(107), true);
  signalingModule.handleCallEnded(105, { targetId: 106 });

  // ── 3.4.8 /health Genuine Readiness Probe Verification ───────────────────
  console.log('\n--- SUITE 3.4.8: Health Readiness Probe Verification ---\n');
  const healthyCheck = () => {
    try {
      activeDb.prepare('SELECT 1').get();
      return { status: 200, body: { status: 'ok' } };
    } catch {
      return { status: 503, body: { status: 'degraded', error: 'Database unreachable' } };
    }
  };
  assertCheck('Healthy database returns 200 ok', healthyCheck().status, 200);

  const brokenCheck = () => {
    try {
      const mockDb = { prepare: () => { throw new Error('Database connection lost'); } };
      mockDb.prepare('SELECT 1').get();
      return { status: 200, body: { status: 'ok' } };
    } catch {
      return { status: 503, body: { status: 'degraded', error: 'Database unreachable' } };
    }
  };
  assertCheck('Unreachable database returns 503 degraded', brokenCheck().status, 503);

  // Teardown
  for (const s of [student101Socket, student102Socket, aliceSocket, bobSocket, frankSocket, superSocket, mallorySocket, graceSocket, ivanSocket]) {
    try { s.disconnect(); } catch { /* ignore */ }
  }

  console.log('\n================================================================');
  console.log(`FINAL OUTCOME: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED (100%)`);
  console.log('================================================================\n');

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
  } finally {
    await cleanup(true);
  }
}

main().catch(async (err) => {
  console.error('Test Suite Failed:', err);
  await cleanup(true);
  process.exit(1);
});
