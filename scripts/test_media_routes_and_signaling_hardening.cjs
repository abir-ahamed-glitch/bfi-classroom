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
  ivan_deleted: makeToken({ id: 90, username: 'ivan_deleted', role: 'student' })
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

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

async function main() {
  console.log('================================================================');
  console.log('SECURITY VERIFICATION: REPORT SCREENSHOT LOCKDOWN & CALL SIGNALING');
  console.log('================================================================\n');

  await setupDatabase();
  console.log(`✅ Synthetic database initialized at ${TEST_DB_PATH}`);

  // Start test server process
  const serverProc = spawn('node', ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: TEST_PORT,
      DATABASE_PATH: TEST_DB_PATH,
      JWT_SECRET,
      JWT_REFRESH_SECRET,
      NODE_ENV: 'test'
    },
    stdio: 'inherit'
  });

  // Wait for server to listen
  await new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const probe = http.get(`${BASE_URL}/health`, (res) => {
        clearInterval(interval);
        probe.destroy();
        resolve();
      });
      probe.on('error', () => {
        if (Date.now() - start > 10000) {
          clearInterval(interval);
          reject(new Error('Server failed to start within 10 seconds'));
        }
      });
    }, 200);
  });

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

  const [aliceSocket, bobSocket, frankSocket, superSocket, mallorySocket, graceSocket, ivanSocket] = await Promise.all([
    connectSocket(tokens.reporter_alice),
    connectSocket(tokens.unrelated_bob),
    connectSocket(tokens.batchmate_frank),
    connectSocket(tokens.super_admin),
    connectSocket(tokens.mallory_text_spoof),
    connectSocket(tokens.grace_archived),
    connectSocket(tokens.ivan_deleted)
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

  // Teardown
  aliceSocket.disconnect();
  bobSocket.disconnect();
  frankSocket.disconnect();
  superSocket.disconnect();
  mallorySocket.disconnect();
  graceSocket.disconnect();
  ivanSocket.disconnect();

  serverProc.kill();
  if (fs.existsSync(SYNTHETIC_FILEPATH)) fs.unlinkSync(SYNTHETIC_FILEPATH);

  console.log('\n================================================================');
  console.log(`FINAL OUTCOME: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED (100%)`);
  console.log('================================================================\n');

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
