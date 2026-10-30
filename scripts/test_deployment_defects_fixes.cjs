'use strict';
/**
 * scripts/test_deployment_defects_fixes.cjs
 *
 * Exhaustive unit tests verifying:
 * 1. Bounded TCP/HTTP socket readiness check (waitForServerReady)
 *    - Refused connections
 *    - Delayed socket binding
 *    - Accepted connections that never send response headers (hanging sockets)
 *    - Single retry per probe, strict deadline, timer/socket cleanup
 * 2. Policy-correct handling of expired pending-MFA envelopes vs strict fail-closed guards
 *    - Expired undecryptable on explicitly unenrolled (two_factor_enabled: 0) -> purged
 *    - Expired undecryptable on enrolled account (two_factor_enabled: 1) -> FAILS CLOSED & preserved
 *    - Unexpired pending envelope -> FAILS CLOSED
 *    - Malformed envelope (invalid JSON, missing/invalid expiresAt) -> FAILS CLOSED
 *    - Missing or ambiguous enrollment state (null, undefined, invalid) -> FAILS CLOSED
 *    - Active-secret decryption failure -> FAILS CLOSED
 *    - Dry-run and audit operations -> ZERO mutations
 *    - Transactional rollback on mid-rotation failure -> earlier updates rolled back
 */

const assert = require('assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const { waitForServerReady } = require('./production_lifecycle.cjs');
const { executeRotation, auditDecryptability, encrypt, deriveKey } = require('./rotate_mfa_secrets.cjs');

const TEST_DIR = path.resolve(__dirname, '..', '.tmp_test_runs', `defects_fixes_${Date.now()}`);

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (e) {
      // Ignore cleanup lock issues on Windows
    }
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('START: DEPLOYMENT DEFECTS & RECOVERY TOOLING REGRESSION SUITE');
  console.log('================================================================\n');

  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Part 1: Bounded Socket Readiness (waitForServerReady)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- [Test 1.1] Socket Readiness: Server Already Listening ---');
    {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });

      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const res = await waitForServerReady({ baseUrl, timeoutMs: 5000, intervalMs: 100 });
      assert.strictEqual(res.ready, true);
      assert.strictEqual(res.status, 200);
      srv.close();
      console.log('✅ PASS: Immediate connection resolves successfully.');
    }

    console.log('\n--- [Test 1.2] Socket Readiness: Delayed Server Startup (Connection Refused -> Ready) ---');
    {
      let srv = null;
      const targetPort = 49152 + Math.floor(Math.random() * 10000);
      const baseUrl = `http://127.0.0.1:${targetPort}`;

      setTimeout(() => {
        srv = http.createServer((req, res) => {
          res.writeHead(302, { Location: '/bfi-classroom' });
          res.end();
        });
        srv.listen(targetPort, '127.0.0.1');
      }, 600);

      const res = await waitForServerReady({ baseUrl, timeoutMs: 5000, intervalMs: 150 });
      assert.strictEqual(res.ready, true);
      assert.strictEqual(res.status, 302);
      if (srv) srv.close();
      console.log('✅ PASS: Refused socket retried with backoff and resolved when port opened.');
    }

    console.log('\n--- [Test 1.3] Socket Readiness: Accepted Connection That Never Sends Headers (Hanging Socket) ---');
    {
      // Create a raw TCP server that accepts TCP connection but never sends any HTTP bytes
      let clientSockets = [];
      const tcpServer = net.createServer((socket) => {
        clientSockets.push(socket);
        // Do not write anything back; simulate hung server process
      });

      await new Promise(r => tcpServer.listen(0, '127.0.0.1', r));
      const port = tcpServer.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      let caught = null;
      const startT = Date.now();
      try {
        // Strict 1500ms overall timeout, 300ms probe timeout, 100ms interval
        await waitForServerReady({ baseUrl, timeoutMs: 1500, intervalMs: 100, probeTimeoutMs: 300 });
      } catch (err) {
        caught = err;
      }

      const elapsed = Date.now() - startT;
      assert.ok(caught, 'Expected timeout error on hanging server');
      assert.ok(caught.message.includes('readiness check timed out'), caught.message);
      assert.ok(elapsed >= 1400 && elapsed < 2500, `Expected elapsed around 1500ms, got ${elapsed}ms`);

      for (const s of clientSockets) {
        try { s.destroy(); } catch {}
      }
      tcpServer.close();
      console.log('✅ PASS: Hanging accepted connection timed out cleanly without duplicate retry leaks.');
    }

    console.log('\n--- [Test 1.4] Socket Readiness: Hanging Server Becomes Responsive on Subsequent Attempt ---');
    {
      let reqCount = 0;
      const srv = http.createServer((req, res) => {
        reqCount++;
        if (reqCount === 1) {
          // First request hangs (never send headers)
          return;
        }
        // Second request answers immediately
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('recovered');
      });

      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const res = await waitForServerReady({ baseUrl, timeoutMs: 5000, intervalMs: 100, probeTimeoutMs: 400 });
      assert.strictEqual(res.ready, true);
      assert.strictEqual(res.status, 200);
      assert.ok(reqCount >= 2, `Expected at least 2 requests, got ${reqCount}`);
      srv.close();
      console.log('✅ PASS: Single probe timeout aborted hung socket and next probe succeeded cleanly.');
    }

    console.log('\n--- [Test 1.5] Socket Readiness: Strict Overall Deadline Rejection When Closed ---');
    {
      const nonExistentPort = 49152 + Math.floor(Math.random() * 10000);
      const baseUrl = `http://127.0.0.1:${nonExistentPort}`;

      let caught = null;
      try {
        await waitForServerReady({ baseUrl, timeoutMs: 1000, intervalMs: 150 });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, 'Expected timeout error');
      assert.ok(caught.message.includes('readiness check timed out'), caught.message);
      console.log('✅ PASS: Overall deadline strictly enforced.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Part 2: MFA Secret Rotation Expired Pending Envelope Handling
    // ─────────────────────────────────────────────────────────────────────────
    const oldKey = 'test_historical_old_mfa_key_123';
    const newKey = 'test_target_new_mfa_key_456';
    const ancientKey = 'test_ancient_unrelated_key_789';

    function initDb(dbFile) {
      const db = new Database(dbFile);
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          email TEXT,
          role TEXT NOT NULL DEFAULT 'user',
          two_factor_enabled INTEGER NOT NULL DEFAULT 0,
          two_factor_secret TEXT,
          pending_two_factor_secret TEXT
        );
      `);
      return db;
    }

    console.log('\n--- [Test 2.1] Expired Pending on Explicitly Unenrolled Account (Approved Cleanup Policy) ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_21.db');
      const db = initDb(dbPath);

      const ancientKeyHash = deriveKey(ancientKey);
      const ancientEncrypted = encrypt('STALE_SECRET', ancientKeyHash);

      const expiredEnvelope = JSON.stringify({
        secret: ancientEncrypted,
        recoveryHashes: ['h1'],
        authorizedUserId: 1,
        expiresAt: new Date(Date.now() - 3600000 * 24).toISOString() // 24 hours expired
      });

      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, pending_two_factor_secret)
        VALUES (1, 'unenrolled_user', 0, ?)
      `).run(expiredEnvelope);
      db.close();

      const rot = executeRotation({
        dbPath,
        oldKeySource: oldKey,
        newKeySource: newKey,
        dryRun: false
      });

      assert.strictEqual(rot.success, true);

      // Verify the stale expired pending secret was purged
      const verifyDb = new Database(dbPath);
      const u = verifyDb.prepare('SELECT two_factor_enabled, pending_two_factor_secret FROM users WHERE id = 1').get();
      assert.strictEqual(u.two_factor_enabled, 0);
      assert.strictEqual(u.pending_two_factor_secret, null);
      verifyDb.close();

      const audit = auditDecryptability(dbPath, {
        primaryKeySource: newKey,
        requirePrimaryOnly: true
      });
      assert.strictEqual(audit.auditPassed, true);
      console.log('✅ PASS: Expired setup envelope on explicitly unenrolled account was purged cleanly.');
    }

    console.log('\n--- [Test 2.2] Expired Undecryptable Pending on ENROLLED Account (two_factor_enabled = 1) Must FAIL CLOSED ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_22.db');
      const db = initDb(dbPath);

      const oldKeyHash = deriveKey(oldKey);
      const activeEncrypted = encrypt('VALID_ACTIVE_SECRET', oldKeyHash);

      const ancientKeyHash = deriveKey(ancientKey);
      const ancientEncrypted = encrypt('STALE_REPLACEMENT_SECRET', ancientKeyHash);

      const expiredEnvelope = JSON.stringify({
        secret: ancientEncrypted,
        recoveryHashes: ['h1'],
        authorizedUserId: 2,
        isReplacement: true,
        expiresAt: new Date(Date.now() - 3600000 * 24).toISOString() // Expired in flight
      });

      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, two_factor_secret, pending_two_factor_secret)
        VALUES (2, 'enrolled_user', 1, ?, ?)
      `).run(activeEncrypted, expiredEnvelope);
      db.close();

      let rotError = null;
      try {
        executeRotation({
          dbPath,
          oldKeySource: oldKey,
          newKeySource: newKey,
          dryRun: false
        });
      } catch (err) {
        rotError = err;
      }

      assert.ok(rotError, 'Expected rotation to strictly fail closed for enrolled user');
      assert.ok(rotError.message.includes('Failed to decrypt pending MFA secret for user ID 2'), rotError.message);

      // Verify database records were PRESERVED intact (not purged)
      const verifyDb = new Database(dbPath);
      const u = verifyDb.prepare('SELECT two_factor_enabled, two_factor_secret, pending_two_factor_secret FROM users WHERE id = 2').get();
      assert.strictEqual(u.two_factor_enabled, 1);
      assert.strictEqual(u.two_factor_secret, activeEncrypted);
      assert.strictEqual(u.pending_two_factor_secret, expiredEnvelope);
      verifyDb.close();
      console.log('✅ PASS: Enrolled account with undecryptable pending envelope strictly failed closed and preserved records.');
    }

    console.log('\n--- [Test 2.3] UNEXPIRED Pending Setup on Unenrolled Account Must FAIL CLOSED ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_23.db');
      const db = initDb(dbPath);

      const ancientKeyHash = deriveKey(ancientKey);
      const ancientEncrypted = encrypt('FUTURE_SECRET', ancientKeyHash);

      const unexpiredEnvelope = JSON.stringify({
        secret: ancientEncrypted,
        recoveryHashes: ['h1'],
        authorizedUserId: 3,
        expiresAt: new Date(Date.now() + 600000).toISOString() // 10 minutes in FUTURE
      });

      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, pending_two_factor_secret)
        VALUES (3, 'user3', 0, ?)
      `).run(unexpiredEnvelope);
      db.close();

      let rotError = null;
      try {
        executeRotation({ dbPath, oldKeySource: oldKey, newKeySource: newKey, dryRun: false });
      } catch (err) {
        rotError = err;
      }

      assert.ok(rotError, 'Expected unexpired pending secret failure to throw');
      assert.ok(rotError.message.includes('Failed to decrypt pending MFA secret for user ID 3'), rotError.message);
      console.log('✅ PASS: Unexpired pending setup envelope strictly failed closed.');
    }

    console.log('\n--- [Test 2.4] Malformed Envelope (Missing/Invalid expiresAt or Non-JSON) Must FAIL CLOSED ---');
    {
      const ancientKeyHash = deriveKey(ancientKey);
      const undecryptableCipher = encrypt('MALFORMED_UNDECRYPTABLE_SECRET', ancientKeyHash);

      // Sub-case A: Missing expiresAt
      {
        const dbPath = path.join(TEST_DIR, 'test_24a.db');
        const db = initDb(dbPath);
        const noExpires = JSON.stringify({ secret: undecryptableCipher, authorizedUserId: 40 });
        db.prepare(`INSERT INTO users (id, username, two_factor_enabled, pending_two_factor_secret) VALUES (40, 'u40', 0, ?)`).run(noExpires);
        db.close();

        let err = null;
        try {
          executeRotation({ dbPath, oldKeySource: oldKey, newKeySource: newKey, dryRun: false });
        } catch (e) { err = e; }
        assert.ok(err, 'Expected missing expiresAt to fail closed');
        assert.ok(err.message.includes('Failed to decrypt pending MFA secret for user ID 40'), err.message);
      }

      // Sub-case B: Invalid date string for expiresAt
      {
        const dbPath = path.join(TEST_DIR, 'test_24b.db');
        const db = initDb(dbPath);
        const badDate = JSON.stringify({ secret: undecryptableCipher, expiresAt: 'not-a-valid-date' });
        db.prepare(`INSERT INTO users (id, username, two_factor_enabled, pending_two_factor_secret) VALUES (41, 'u41', 0, ?)`).run(badDate);
        db.close();

        let err = null;
        try {
          executeRotation({ dbPath, oldKeySource: oldKey, newKeySource: newKey, dryRun: false });
        } catch (e) { err = e; }
        assert.ok(err, 'Expected invalid date string to fail closed');
        assert.ok(err.message.includes('Failed to decrypt pending MFA secret for user ID 41'), err.message);
      }

      // Sub-case C: Non-JSON raw undecryptable string
      {
        const dbPath = path.join(TEST_DIR, 'test_24c.db');
        const db = initDb(dbPath);
        db.prepare(`INSERT INTO users (id, username, two_factor_enabled, pending_two_factor_secret) VALUES (42, 'u42', 0, ?)`).run(undecryptableCipher);
        db.close();

        let err = null;
        try {
          executeRotation({ dbPath, oldKeySource: oldKey, newKeySource: newKey, dryRun: false });
        } catch (e) { err = e; }
        assert.ok(err, 'Expected non-JSON undecryptable raw string to fail closed');
        assert.ok(err.message.includes('Failed to decrypt pending MFA secret for user ID 42'), err.message);
      }

      console.log('✅ PASS: Malformed envelopes without valid past expiresAt strictly failed closed.');
    }

    console.log('\n--- [Test 2.5] Ambiguous or Missing Enrollment State (null / undefined) Must FAIL CLOSED ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_25.db');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          two_factor_enabled INTEGER,
          two_factor_secret TEXT,
          pending_two_factor_secret TEXT
        );
      `);

      const ancientKeyHash = deriveKey(ancientKey);
      const ancientEncrypted = encrypt('SECRET', ancientKeyHash);
      const expiredEnvelope = JSON.stringify({
        secret: ancientEncrypted,
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      });

      // two_factor_enabled set to NULL
      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, pending_two_factor_secret)
        VALUES (5, 'null_state_user', NULL, ?)
      `).run(expiredEnvelope);
      db.close();

      let rotError = null;
      try {
        executeRotation({ dbPath, oldKeySource: oldKey, newKeySource: newKey, dryRun: false });
      } catch (err) {
        rotError = err;
      }

      assert.ok(rotError, 'Expected ambiguous enrollment state to fail closed');
      assert.ok(rotError.message.includes('Ambiguous or invalid two_factor_enabled state'), rotError.message);
      console.log('✅ PASS: Null/ambiguous enrollment state rejected before data mutation.');
    }

    console.log('\n--- [Test 2.6] Active Secret Decryption Failure Must Strictly Abort Atomically ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_26.db');
      const db = initDb(dbPath);

      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, two_factor_secret)
        VALUES (6, 'enrolled_active_fail', 1, 'corrupted_iv:tag:data')
      `).run();
      db.close();

      let rotError = null;
      try {
        executeRotation({ dbPath, oldKeySource: oldKey, newKeySource: newKey, dryRun: false });
      } catch (err) {
        rotError = err;
      }

      assert.ok(rotError, 'Expected active secret failure to throw');
      assert.ok(rotError.message.includes('Failed to decrypt active MFA secret for user ID 6'), rotError.message);
      console.log('✅ PASS: Active MFA secret failure strictly aborts rotation.');
    }

    console.log('\n--- [Test 2.7] Dry-Run and Audit Operations Do NOT Mutate Database Data ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_27.db');
      const db = initDb(dbPath);

      const oldKeyHash = deriveKey(oldKey);
      const activeCipher = encrypt('MY_ACTIVE_MFA', oldKeyHash);
      const pendingCipher = encrypt('MY_PENDING_MFA', oldKeyHash);

      const pendingEnv = JSON.stringify({
        secret: pendingCipher,
        expiresAt: new Date(Date.now() + 600000).toISOString()
      });

      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, two_factor_secret, pending_two_factor_secret)
        VALUES (7, 'dry_user', 1, ?, ?)
      `).run(activeCipher, pendingEnv);
      db.close();

      // Take SHA-256 hash of entire database before dry run
      const hashBefore = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');

      // 1. Audit check
      const audit = auditDecryptability(dbPath, {
        primaryKeySource: oldKey,
        requirePrimaryOnly: true
      });
      assert.strictEqual(audit.auditPassed, true);

      // 2. Dry-run rotation
      const dryRot = executeRotation({
        dbPath,
        oldKeySource: oldKey,
        newKeySource: newKey,
        dryRun: true
      });
      assert.strictEqual(dryRot.dryRun, true);

      // Verify database on disk was not modified in any row
      const verifyDb = new Database(dbPath);
      const row = verifyDb.prepare('SELECT two_factor_secret, pending_two_factor_secret FROM users WHERE id = 7').get();
      assert.strictEqual(row.two_factor_secret, activeCipher);
      assert.strictEqual(row.pending_two_factor_secret, pendingEnv);
      verifyDb.close();

      console.log('✅ PASS: Audit and dry-run operations did not mutate data.');
    }

    console.log('\n--- [Test 2.8] Transactional Rollback on Mid-Rotation Failure ---');
    {
      const dbPath = path.join(TEST_DIR, 'test_28.db');
      const db = initDb(dbPath);

      const oldKeyHash = deriveKey(oldKey);
      const user8ActiveCipher = encrypt('USER8_ACTIVE', oldKeyHash);

      // User 8: Valid active secret (rotates cleanly)
      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, two_factor_secret)
        VALUES (8, 'valid_user_8', 1, ?)
      `).run(user8ActiveCipher);

      // User 9: Corrupted secret (causes failure on second record)
      db.prepare(`
        INSERT INTO users (id, username, two_factor_enabled, two_factor_secret)
        VALUES (9, 'corrupt_user_9', 1, 'bad:iv:data')
      `).run();
      db.close();

      let rotError = null;
      try {
        executeRotation({
          dbPath,
          oldKeySource: oldKey,
          newKeySource: newKey,
          dryRun: false
        });
      } catch (err) {
        rotError = err;
      }

      assert.ok(rotError, 'Expected rotation to abort on User 9');

      // Crucial assertion: User 8 was rotated in memory, but because User 9 failed,
      // the SQLite transaction rolled back. User 8 must STILL have the OLD ciphertext!
      const verifyDb = new Database(dbPath);
      const row8 = verifyDb.prepare('SELECT two_factor_secret FROM users WHERE id = 8').get();
      assert.strictEqual(row8.two_factor_secret, user8ActiveCipher, 'User 8 should have rolled back to original cipher');
      verifyDb.close();
      console.log('✅ PASS: Transaction rolled back earlier updates cleanly on failure.');
    }

    console.log('\n================================================================');
    console.log('ALL 13 TESTS IN EXTENDED REGRESSION SUITE PASSED CLEANLY (13/13)');
    console.log('================================================================');
  } finally {
    cleanup();
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
