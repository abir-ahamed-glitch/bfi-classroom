'use strict';

/**
 * scripts/reproduce_security_issues.cjs
 *
 * HISTORICAL SECURITY REPRODUCTION ARTIFACT
 * Note: This script was authored to isolate and reproduce the vulnerabilities discovered in
 * release 6784547 prior to the hardened defenses implemented in commits 806832b and 88d274e.
 * In the hardened codebase, group-call-accepted strictly requires an exact matching callId
 * and active invitation membership; client-controlled participant broadcasts fail closed.
 *
 * 1. Test every report screenshot URL alias (/uploads, /bfi-classroom/uploads, /media, /bfi-classroom/media, and /view)
 *    across unauthenticated, unrelated user, unrelated admin, owner, moderator, and Super Admin.
 * 2. Test Socket.IO 1:1 and group-call signaling across arbitrary recipients, inactive users, and forged payloads.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { spawn } = require('child_process');

const TEST_PORT = 3097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const JWT_SECRET = 'test_jwt_secret_reproduction_32_chars_minimum!';
const JWT_REFRESH_SECRET = 'test_jwt_refresh_reproduction_32_chars_min!';

const TMP_DIR = path.resolve(__dirname, '..', '.tmp_reproduction_run');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const TEST_DB_PATH = path.join(TMP_DIR, 'reproduction_test.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

// Synthetic screenshot file
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'uploads', 'report-screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const SYNTHETIC_FILENAME = `report-screenshot-10-1730380000000.png`;
const SYNTHETIC_FILEPATH = path.join(SCREENSHOTS_DIR, SYNTHETIC_FILENAME);
const SYNTHETIC_CONTENT = 'SYNTHETIC_TEST_SCREENSHOT_DATA_PIXEL_12345';
fs.writeFileSync(SYNTHETIC_FILEPATH, SYNTHETIC_CONTENT);

process.env.DATABASE_PATH = TEST_DB_PATH;

async function setupDatabase() {
  const dbModule = await import('../server/db/database.js');
  dbModule.initializeDatabase();
  const db = dbModule.default;

  // Insert or update synthetic users
  db.prepare(`UPDATE users SET username = 'superadmin', email = 'super@bfi.local', role = 'admin', first_name = 'Super', last_name = 'Admin', is_super_admin = 1, is_active = 1 WHERE id = 1`).run();

  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_super_admin, is_active)
    VALUES (?, ?, ?, 'hash', ?, ?, ?, ?, ?)
  `);

  insertUser.run(10, 'reporter_student', 'reporter@bfi.local', 'student', 'Alice', 'Reporter', 0, 1);
  insertUser.run(20, 'unrelated_student', 'unrelated@bfi.local', 'student', 'Bob', 'Unrelated', 0, 1);
  insertUser.run(30, 'unrelated_admin', 'unrelated_admin@bfi.local', 'admin', 'Charlie', 'Admin', 0, 1);
  insertUser.run(40, 'moderator_admin', 'moderator@bfi.local', 'admin', 'Diana', 'Moderator', 0, 1);
  insertUser.run(50, 'inactive_student', 'inactive@bfi.local', 'student', 'Eve', 'Inactive', 0, 0);

  // Student profiles
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(10, 'Alice Reporter', 'STU10', 'BATCH-01');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(20, 'Bob Unrelated', 'STU20', 'BATCH-02');
  db.prepare('INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)').run(50, 'Eve Inactive', 'STU50', 'BATCH-01');

  // Admin permissions: User 40 has reports permissions; User 30 has none
  db.prepare('INSERT OR REPLACE INTO admin_permissions (user_id, permission) VALUES (?, ?)').run(40, 'reports:view');
  db.prepare('INSERT OR REPLACE INTO admin_permissions (user_id, permission) VALUES (?, ?)').run(40, 'reports:moderate');

  // Sessions for admins
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(1, 1, 'hash-super-1', nextWeek);
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(30, 30, 'hash-unrelated-30', nextWeek);
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(40, 40, 'hash-mod-40', nextWeek);

  // Insert synthetic report
  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_user_id, content_type, content_id, reason_category, screenshot_path, status)
    VALUES (1, 10, 20, 'post', 1, 'Harassment', ?, 'pending')
  `).run(`/uploads/report-screenshots/${SYNTHETIC_FILENAME}`);
}

// Token generation helper
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
  reporter: makeToken({ id: 10, username: 'reporter_student', role: 'student' }),
  unrelated_student: makeToken({ id: 20, username: 'unrelated_student', role: 'student' }),
  unrelated_admin: makeToken({ id: 30, username: 'unrelated_admin', role: 'admin' }, 30),
  moderator_admin: makeToken({ id: 40, username: 'moderator_admin', role: 'admin' }, 40),
  super_admin: makeToken({ id: 1, username: 'superadmin', role: 'admin' }, 1)
};

// HTTP Request helper
function requestUrl(urlPath, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method: 'GET', headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'],
          body: data
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log('REPRODUCTION SUITE: REPORT SCREENSHOT ALIASES & SOCKET.IO SIGNALING');
  console.log('================================================================');

  await setupDatabase();
  console.log('✅ Synthetic database initialized at', TEST_DB_PATH);

  // Spawn isolated test backend
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
    console.error('[Server Err]', d.toString());
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

  console.log('✅ Isolated backend listening on port', TEST_PORT);

  const results = [];

  // ── TEST 1: URL Aliases for Report Screenshots ─────────────────────────
  console.log('\n--- 1. Testing Report Screenshot URL Aliases ---');
  const aliases = [
    `/uploads/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/bfi-classroom/uploads/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/media/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/bfi-classroom/media/report-screenshots/${SYNTHETIC_FILENAME}`,
    `/media/report-screenshots/${SYNTHETIC_FILENAME}/view`,
    `/bfi-classroom/media/report-screenshots/${SYNTHETIC_FILENAME}/view`
  ];

  const authStates = [
    { label: 'Unauthenticated (No Token)', token: tokens.unauthenticated },
    { label: 'Unrelated Student (User 20)', token: tokens.unrelated_student },
    { label: 'Unrelated Admin (User 30, no reports perm)', token: tokens.unrelated_admin },
    { label: 'Owner (User 10, Reporter)', token: tokens.reporter },
    { label: 'Moderator Admin (User 40, reports:view)', token: tokens.moderator_admin },
    { label: 'Super Admin (User 1)', token: tokens.super_admin }
  ];

  for (const alias of aliases) {
    console.log(`\nTesting Alias: ${alias}`);
    for (const auth of authStates) {
      const resp = await requestUrl(alias, auth.token);
      const isLeaked = resp.status === 200 && resp.body.includes(SYNTHETIC_CONTENT);
      console.log(`  [${auth.label.padEnd(45)}] Status: ${resp.status} | Content leaked: ${isLeaked ? 'YES (VULNERABILITY)' : 'NO'}`);
      results.push({
        test: 'Screenshot Alias Access',
        alias,
        authState: auth.label,
        status: resp.status,
        leaked: isLeaked
      });
    }
  }

  // ── TEST 2: Socket.IO 1:1 and Group Call Signaling ────────────────────
  console.log('\n--- 2. Testing Socket.IO Signaling Authorization ---');

  // Connect Alice (User 10) and Bob (User 20)
  const clientA = ioClient(BASE_URL, {
    auth: { token: tokens.reporter },
    transports: ['websocket']
  });

  const clientB = ioClient(BASE_URL, {
    auth: { token: tokens.unrelated_student },
    transports: ['websocket']
  });

  await Promise.all([
    new Promise(res => clientA.on('connect', res)),
    new Promise(res => clientB.on('connect', res))
  ]);

  console.log('✅ Socket clients connected: Alice (User 10) and Bob (User 20)');

  // Test 2.1: Arbitrary 1:1 Call Request (unrelated batch, no chat history)
  let bReceivedCallRequest = null;
  clientB.on('call-request', (data) => {
    bReceivedCallRequest = data;
  });

  clientA.emit('call-request', {
    receiverId: 20, // Bob, unrelated student!
    callerData: { name: 'Alice' },
    hasVideo: false
  });

  await new Promise(r => setTimeout(r, 400));
  console.log('  [2.1 Arbitrary call-request] Delivered to unrelated User 20:', bReceivedCallRequest ? 'YES (VULNERABILITY: Arbitrary signaling forwarded)' : 'NO (Rejected/Blocked)');
  results.push({
    test: 'Socket Signaling',
    scenario: 'Arbitrary 1:1 call-request to unrelated user',
    vulnerable: Boolean(bReceivedCallRequest),
    received: bReceivedCallRequest
  });

  // Test 2.2: Arbitrary webrtc-offer without an active call session
  let bReceivedOffer = null;
  clientB.on('webrtc-offer', (data) => {
    bReceivedOffer = data;
  });

  clientA.emit('webrtc-offer', {
    receiverId: 20,
    offer: { sdp: 'fake-sdp-attack', type: 'offer' }
  });

  await new Promise(r => setTimeout(r, 400));
  console.log('  [2.2 webrtc-offer without active call] Delivered to User 20:', bReceivedOffer ? 'YES (VULNERABILITY: No session membership check)' : 'NO (Rejected/Blocked)');
  results.push({
    test: 'Socket Signaling',
    scenario: 'webrtc-offer without active call session',
    vulnerable: Boolean(bReceivedOffer),
    received: bReceivedOffer
  });

  // Test 2.3: group-call-invite with forged callerData (spoofing Super Admin User 1)
  let bReceivedGroupInvite = null;
  clientB.on('group-call-invite', (data) => {
    bReceivedGroupInvite = data;
  });

  clientA.emit('group-call-invite', {
    receiverId: 20,
    callerData: { id: 1, name: 'SuperAdmin' }, // FORGED callerData!
    existingParticipants: [{ id: 1 }],
    hasVideo: false
  });

  await new Promise(r => setTimeout(r, 400));
  const forgedAccepted = bReceivedGroupInvite?.callerData?.id === 1;
  console.log('  [2.3 group-call-invite forged callerData] Received forged callerData ID 1:', forgedAccepted ? 'YES (VULNERABILITY: Server does not sanitize/enforce callerId)' : 'NO');
  results.push({
    test: 'Socket Signaling',
    scenario: 'group-call-invite forged callerData',
    vulnerable: forgedAccepted,
    received: bReceivedGroupInvite
  });

  // Test 2.4: group-call-accepted broadcast to arbitrary participantIds
  let bReceivedGroupAccepted = null;
  clientB.on('group-call-accepted', (data) => {
    bReceivedGroupAccepted = data;
  });

  // Note: Post-hardening, handleGroupAccepted rejects missing callId (INVALID_CALL_ID).
  // Passing exploratory callId verifies that client-specified arbitrary participantIds fail closed.
  clientA.emit('group-call-accepted', {
    callId: 'call_test_exploratory_broadcast',
    participantIds: [20], // Client specifies arbitrary target user IDs
    joinerData: { id: 10, name: 'Spam Joiner' }
  });

  await new Promise(r => setTimeout(r, 400));
  console.log('  [2.4 group-call-accepted arbitrary participantIds] Broadcast received by User 20:', bReceivedGroupAccepted ? 'YES (VULNERABILITY: Client controls broadcast targets)' : 'NO');
  results.push({
    test: 'Socket Signaling',
    scenario: 'group-call-accepted client-controlled broadcast targets',
    vulnerable: Boolean(bReceivedGroupAccepted),
    received: bReceivedGroupAccepted
  });

  // Test 2.5: group-webrtc-offer with forged fromId
  let bReceivedGroupOffer = null;
  clientB.on('group-webrtc-offer', (data) => {
    bReceivedGroupOffer = data;
  });

  clientA.emit('group-webrtc-offer', {
    receiverId: 20,
    fromId: 1, // Forged fromId!
    offer: { sdp: 'fake-group-offer', type: 'offer' }
  });

  await new Promise(r => setTimeout(r, 400));
  const forgedFromReceived = bReceivedGroupOffer?.fromId === 1;
  console.log('  [2.5 group-webrtc-offer forged fromId] Received with forged fromId 1:', forgedFromReceived ? 'YES (VULNERABILITY: fromId not enforced from socket.user.id)' : 'NO');
  results.push({
    test: 'Socket Signaling',
    scenario: 'group-webrtc-offer forged fromId',
    vulnerable: forgedFromReceived,
    received: bReceivedGroupOffer
  });

  // Teardown
  clientA.disconnect();
  clientB.disconnect();
  serverProc.kill();

  if (fs.existsSync(SYNTHETIC_FILEPATH)) fs.unlinkSync(SYNTHETIC_FILEPATH);

  console.log('\n================================================================');
  console.log('REPRODUCTION VERDICT SUMMARY');
  console.log('================================================================');
  const mediaLeaks = results.filter(r => r.alias && r.alias.includes('/media') && r.authState.includes('Unauthenticated') && r.leaked);
  console.log(`- Unauthenticated /media screenshot leaks: ${mediaLeaks.length} / 4 aliases LEAKED.`);

  const unrelatedStudentUploadsLeaks = results.filter(r => r.alias && r.alias.includes('/uploads') && r.authState.includes('Unrelated Student') && r.leaked);
  console.log(`- Unrelated student accessing /uploads screenshot: ${unrelatedStudentUploadsLeaks.length} / 2 aliases LEAKED.`);

  const signalingVulns = results.filter(r => r.test === 'Socket Signaling' && r.vulnerable);
  console.log(`- Socket signaling vulnerabilities confirmed: ${signalingVulns.length} / 5 scenarios VULNERABLE.`);
  console.log('================================================================\n');

  // Save JSON report for inspection
  fs.writeFileSync(path.join(TMP_DIR, 'reproduction_results.json'), JSON.stringify(results, null, 2));
}

run().catch(err => {
  console.error('Fatal reproduction error:', err);
  process.exit(1);
});
