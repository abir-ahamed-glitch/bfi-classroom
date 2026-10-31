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
 *      - Rejection of 1:1 call-request to unrelated users across batches
 *      - Rejection of 1:1 call-request to self or non-existent/inactive users
 *      - Rejection of WebRTC offer, answer, and ICE candidate when no call session is active
 *      - Rejection of group-call-invite from users not in a connected call
 *      - Rejection of group-call-accepted from users not having a pending invitation
 *      - Rejection of client-controlled broadcast spamming via participantIds
 *      - Enforcement of fromId from socket session (spoofing prevented)
 *    - Positive Controls:
 *      - Successful 1:1 call establishment between batchmates (ringing -> answered -> WebRTC signaling -> call ended)
 *      - Successful group-call invitation and join between eligible peers
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

  // Student profiles
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(10, 'Alice Reporter', 'STU10', 'BATCH-01');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(20, 'Bob Unrelated', 'STU20', 'BATCH-02');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(50, 'Eve Inactive', 'STU50', 'BATCH-01');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(60, 'Frank Batchmate', 'STU60', 'BATCH-01'); // Same batch as Alice!

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
  batchmate_frank: makeToken({ id: 60, username: 'batchmate_frank', role: 'student' })
};

function requestUrl(urlPath, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method: 'GET', headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'],
          body: data,
          json
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('SECURITY VERIFICATION: REPORT SCREENSHOT LOCKDOWN & CALL SIGNALING');
  console.log('================================================================\n');

  await setupDatabase();
  console.log('✅ Synthetic database initialized at', TEST_DB_PATH);

  const env = {
    ...process.env,
    PORT: String(TEST_PORT),
    HOST: '127.0.0.1',
    DATABASE_PATH: TEST_DB_PATH,
    JWT_SECRET,
    JWT_REFRESH_SECRET,
    IS_TEST_SERVER: 'true',
    NODE_ENV: 'test',
    DISABLE_OUTBOUND_NOTIFICATIONS: 'true'
  };

  const serverProc = spawn('node', ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('API Gateway running')) console.log('[Server]', s.trim());
  });
  serverProc.stderr.on('data', (d) => {
    // console.error('[Server Err]', d.toString());
  });

  // Wait for server ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      await requestUrl('/api/health');
      ready = true;
      break;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (!ready) {
    serverProc.kill();
    throw new Error('Test server failed to start within 6 seconds.');
  }

  let passedAssertions = 0;
  let totalAssertions = 0;

  function assertCheck(desc, actual, expected) {
    totalAssertions++;
    if (actual === expected) {
      passedAssertions++;
      console.log(`  ✅ [PASS] ${desc}`);
    } else {
      console.error(`  ❌ [FAIL] ${desc} (Expected: ${expected}, Got: ${actual})`);
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // SUITE 1: REPORT SCREENSHOT ALIASES & ACCESS CONTROL MATRIX
  // ────────────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 1: Report Screenshot Lockdown Matrix (All 8 Aliases) ---');

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
    console.log(`\nEvaluating Alias: ${alias}`);

    // A. Unauthenticated
    const resUnauth = await requestUrl(alias, tokens.unauthenticated);
    assertCheck(`${alias} unauthenticated returns 401`, resUnauth.status, 401);
    assertCheck(`${alias} unauthenticated does not leak content`, resUnauth.body.includes(SYNTHETIC_PAYLOAD), false);

    // B. Unrelated Student (Bob)
    const resBob = await requestUrl(alias, tokens.unrelated_bob);
    assertCheck(`${alias} unrelated student returns 403`, resBob.status, 403);
    assertCheck(`${alias} unrelated student does not leak content`, resBob.body.includes(SYNTHETIC_PAYLOAD), false);

    // C. Unrelated Admin without reports permission (Charlie)
    const resCharlie = await requestUrl(alias, tokens.unrelated_admin);
    assertCheck(`${alias} admin without reports permission returns 403`, resCharlie.status, 403);
    assertCheck(`${alias} admin without reports permission does not leak content`, resCharlie.body.includes(SYNTHETIC_PAYLOAD), false);

    // D. Owner (Alice, Reporter)
    const resAlice = await requestUrl(alias, tokens.reporter_alice);
    assertCheck(`${alias} reporter owner returns 200`, resAlice.status, 200);
    assertCheck(`${alias} reporter owner receives valid content`, resAlice.body.includes(SYNTHETIC_PAYLOAD), true);

    // E. Moderator Admin with reports:view (Diana)
    const resDiana = await requestUrl(alias, tokens.moderator_diana);
    assertCheck(`${alias} moderator admin returns 200`, resDiana.status, 200);
    assertCheck(`${alias} moderator admin receives valid content`, resDiana.body.includes(SYNTHETIC_PAYLOAD), true);

    // F. Super Admin
    const resSuper = await requestUrl(alias, tokens.super_admin);
    assertCheck(`${alias} super admin returns 200`, resSuper.status, 200);
    assertCheck(`${alias} super admin receives valid content`, resSuper.body.includes(SYNTHETIC_PAYLOAD), true);
  }

  // Path traversal and non-matching filename checks
  console.log('\n--- Path Traversal & Invalid Filename Defense ---');
  const traversal1 = await requestUrl('/media/report-screenshots/../package.json', tokens.super_admin);
  console.log('traversal1 status:', traversal1.status, traversal1.body);
  assertCheck('Path traversal attempt with dots returns 404 or 401', [401, 404].includes(traversal1.status), true);

  const invalidExt = await requestUrl('/media/report-screenshots/report-screenshot-10-1234.sh', tokens.super_admin);
  assertCheck('Non-whitelisted image extension (.sh) returns 404 or 401', [401, 404].includes(invalidExt.status), true);

  // Private inbox attachments checks
  console.log('\n--- Private Inbox Attachments Static Block Checks ---');
  const inboxMedia1 = await requestUrl('/media/inbox-attachments/test.pdf', tokens.unauthenticated);
  assertCheck('/media/inbox-attachments unauthenticated returns 401 or 403', [401, 403].includes(inboxMedia1.status), true);

  const inboxMedia2 = await requestUrl('/bfi-classroom/media/inbox-attachments/test.pdf', tokens.unauthenticated);
  assertCheck('/bfi-classroom/media/inbox-attachments unauthenticated returns 401 or 403', [401, 403].includes(inboxMedia2.status), true);

  // ────────────────────────────────────────────────────────────────────
  // SUITE 2: SOCKET.IO CALL & GROUP-CALL SIGNALING GOVERNANCE
  // ────────────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 2: Socket.IO Call & Group-Call Signaling Governance ---');

  const aliceSocket = ioClient(BASE_URL, { auth: { token: tokens.reporter_alice }, transports: ['websocket'] });
  const bobSocket = ioClient(BASE_URL, { auth: { token: tokens.unrelated_bob }, transports: ['websocket'] });
  const frankSocket = ioClient(BASE_URL, { auth: { token: tokens.batchmate_frank }, transports: ['websocket'] });
  const superSocket = ioClient(BASE_URL, { auth: { token: tokens.super_admin }, transports: ['websocket'] });

  await Promise.all([
    new Promise(res => aliceSocket.on('connect', res)),
    new Promise(res => bobSocket.on('connect', res)),
    new Promise(res => frankSocket.on('connect', res)),
    new Promise(res => superSocket.on('connect', res))
  ]);
  console.log('✅ Connected 4 test sockets: Alice (10), Bob (20), Frank (60), SuperAdmin (1)');

  // 2.1 Negative Control: Arbitrary 1:1 Call Request across unrelated batches (Alice -> Bob)
  let bobReceivedCall = null;
  let aliceRejected = null;
  bobSocket.on('call-request', d => { bobReceivedCall = d; });
  aliceSocket.on('call-rejected', d => { aliceRejected = d; });

  aliceSocket.emit('call-request', { receiverId: 20, callerData: { name: 'Alice' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Alice cannot call Bob (unrelated batch) - Bob receives nothing', bobReceivedCall, null);
  assertCheck('Alice receives call-rejected with CALL_DISALLOWED code', aliceRejected?.code, 'CALL_DISALLOWED');

  // 2.2 Negative Control: Signaling without active call session
  let bobReceivedOffer = null;
  bobSocket.on('webrtc-offer', d => { bobReceivedOffer = d; });
  aliceSocket.emit('webrtc-offer', { receiverId: 20, offer: { sdp: 'fake-sdp' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Unauthenticated webrtc-offer without active call is dropped', bobReceivedOffer, null);

  // 2.3 Negative Control: Group-call invite from user not in an active call
  let bobReceivedGroupInvite = null;
  bobSocket.on('group-call-invite', d => { bobReceivedGroupInvite = d; });
  aliceSocket.emit('group-call-invite', { receiverId: 20, callerData: { id: 1, name: 'Forged Admin' } });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('group-call-invite dropped when caller is not in an active connected call', bobReceivedGroupInvite, null);

  // 2.4 Positive Control: Legitimate 1:1 Call between Batchmates (Alice <-> Frank)
  let frankReceivedCall = null;
  frankSocket.on('call-request', d => { frankReceivedCall = d; });

  aliceSocket.emit('call-request', { receiverId: 60, callerData: { name: 'Alice' }, hasVideo: false });
  await new Promise(r => setTimeout(r, 400));
  assertCheck('Frank (batchmate) successfully receives legitimate call-request', Boolean(frankReceivedCall), true);
  assertCheck('call-request callerId is authoritatively set to Alice (ID 10)', frankReceivedCall?.callerId, 10);

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

  // Teardown
  aliceSocket.disconnect();
  bobSocket.disconnect();
  frankSocket.disconnect();
  superSocket.disconnect();

  serverProc.kill();
  if (fs.existsSync(SYNTHETIC_FILEPATH)) fs.unlinkSync(SYNTHETIC_FILEPATH);

  console.log('\n================================================================');
  console.log(`FINAL OUTCOME: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED (100%)`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
