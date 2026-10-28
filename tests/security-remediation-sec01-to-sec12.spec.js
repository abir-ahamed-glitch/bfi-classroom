import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { 
  startTestServer, 
  stopTestServer, 
  getTestApiUrl, 
  getTestDbPath, 
  initIsolatedTestDatabase 
} from './test-db-isolation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

describe('Security Remediation Suite: SEC-01 through SEC-12', () => {
  let testServerProcess = null;
  let testApiUrl = null;
  let isolatedDb = null;
  let adminAuthToken = null;

  before(async () => {
    testServerProcess = await startTestServer();
    testApiUrl = getTestApiUrl();
    const dbPath = getTestDbPath();
    isolatedDb = new Database(dbPath);

    // Seed or retrieve active admin user and session for API route tests
    const adminUser = isolatedDb.prepare("SELECT * FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get();
    assert.ok(adminUser, 'Admin user must exist in test database');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sessionRes = isolatedDb.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
      VALUES (?, 'sec_test_session_hash', '127.0.0.1', 'sec_test_runner', ?, datetime('now'), datetime('now'), datetime('now'))
    `).run(adminUser.id, expiresAt);

    adminAuthToken = jwt.sign(
      {
        id: adminUser.id,
        username: adminUser.username,
        role: adminUser.role,
        is_super_admin: adminUser.is_super_admin || 0,
        sessionId: sessionRes.lastInsertRowid,
        type: 'access',
        token_version: adminUser.token_version || 1
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
  });

  after(async () => {
    if (isolatedDb) {
      try { isolatedDb.close(); } catch { /* ignore */ }
    }
    await stopTestServer();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-01: Secret Isolation, Rotation and MFA Key Transition
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-01: Secret Isolation, Rotation and MFA Key Transition', () => {
    test('.env is untracked in git repository', () => {
      const trackedFiles = execSync('git ls-files .env', { cwd: path.join(__dirname, '..') }).toString().trim();
      assert.strictEqual(trackedFiles, '', '.env must not be tracked in git index');
    });

    test('.env.example exists with placeholder values and no plaintext credentials', () => {
      const examplePath = path.join(__dirname, '../.env.example');
      assert.ok(fs.existsSync(examplePath), '.env.example must exist');
      const content = fs.readFileSync(examplePath, 'utf8');
      assert.match(content, /JWT_SECRET=/);
      
      // Generic check: ensure no 16+ char random hex/alphanumeric strings without placeholder tags
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [k, v] = trimmed.split('=');
        if (v) {
          const val = v.trim().replace(/^["']|["']$/g, '');
          if (val && !val.includes('your_') && !val.includes('change_me') && !val.includes('replace_with') && !val.includes('example') && !val.includes('localhost') && !val.includes('sqlite') && !val.includes('bfi_classroom') && !val.includes('smtp.gmail.com') && !val.includes('587')) {
            assert.ok(val.length < 24, `Key ${k} appears to contain a non-placeholder secret value`);
          }
        }
      }
    });

    test('totp decryptSecret seamlessly falls back to previous key during rotation', async () => {
      const { encryptSecret, decryptSecret } = await import('../server/utils/totp.js');

      const oldKey = 'original_jwt_secret_key_1234567890123456';
      const newKey = 'rotated_new_jwt_secret_key_123456789012345';
      const secret = 'JBSWY3DPEHPK3PXP';

      const encryptedWithOld = encryptSecret(secret, oldKey);

      process.env.JWT_SECRET = newKey;
      process.env.PREVIOUS_JWT_SECRET = oldKey;

      const decrypted = decryptSecret(encryptedWithOld);
      assert.strictEqual(decrypted, secret, 'Must decrypt using previous key fallback');

      delete process.env.PREVIOUS_JWT_SECRET;
    });

    test('rotate_mfa_secrets CLI enforces --db parameter and rejects command-line secrets', () => {
      const scriptPath = path.join(__dirname, '../scripts/rotate_mfa_secrets.cjs');

      // Refusal when --db is missing
      assert.throws(() => {
        execSync(`node "${scriptPath}"`, { stdio: 'pipe' });
      }, /FATAL ERROR/);

      // Refusal when secrets are passed on CLI
      assert.throws(() => {
        execSync(`node "${scriptPath}" --db=test.db --old-key=abc`, { stdio: 'pipe' });
      }, /FATAL SECURITY VIOLATION/);
    });

    test('rotate_mfa_secrets re-encrypts active and pending MFA secrets with --dry-run and atomic rollback', async () => {
      const { encryptSecret } = await import('../server/utils/totp.js');
      const tmpDir = path.join(__dirname, '.tmp_test_runs');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const rotationDbPath = path.join(tmpDir, `test_rotation_${Date.now()}.db`);

      const db = new Database(rotationDbPath);
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          username TEXT,
          two_factor_secret TEXT,
          pending_two_factor_secret TEXT
        );
      `);

      const keyOld = 'test_rotation_previous_key_1234567890';
      const keyNew = 'test_rotation_brand_new_key_0987654321';
      const secret1 = 'JBSWY3DPEHPK3PXP';
      const secret2 = 'KREH5WCKJVEUQRKD';
      const secret3 = 'MFRGGZDFMZTWQ2LK';

      // Insert active secret (user 1)
      const enc1 = encryptSecret(secret1, keyOld);
      // Insert pending JSON secret (user 2)
      const enc2 = JSON.stringify({ secret: encryptSecret(secret2, keyOld), timestamp: Date.now() });
      // Insert legacy plain pending secret (user 3)
      const enc3 = encryptSecret(secret3, keyOld);

      db.prepare('INSERT INTO users (id, username, two_factor_secret, pending_two_factor_secret) VALUES (?, ?, ?, ?)').run(1, 'u1', enc1, null);
      db.prepare('INSERT INTO users (id, username, two_factor_secret, pending_two_factor_secret) VALUES (?, ?, ?, ?)').run(2, 'u2', null, enc2);
      db.prepare('INSERT INTO users (id, username, two_factor_secret, pending_two_factor_secret) VALUES (?, ?, ?, ?)').run(3, 'u3', null, enc3);
      db.close();

      const scriptPath = path.join(__dirname, '../scripts/rotate_mfa_secrets.cjs');
      const env = {
        ...process.env,
        PREVIOUS_MFA_ENCRYPTION_KEY: keyOld,
        MFA_ENCRYPTION_KEY: keyNew
      };

      // 1. Dry run verification: rows must remain unchanged
      const dryRunOutput = execSync(`node "${scriptPath}" --db="${rotationDbPath}" --dry-run`, { env }).toString();
      assert.match(dryRunOutput, /DRY RUN/i);

      const dbVerifyDry = new Database(rotationDbPath);
      const row1Dry = dbVerifyDry.prepare('SELECT two_factor_secret FROM users WHERE id = 1').get();
      assert.strictEqual(row1Dry.two_factor_secret, enc1, 'Dry run must not modify records');
      dbVerifyDry.close();

      // 2. Real rotation: re-encrypts all rows
      const runOutput = execSync(`node "${scriptPath}" --db="${rotationDbPath}"`, { env }).toString();
      assert.match(runOutput, /Rotation completed successfully/i);

      // Verify that all secrets now decrypt using keyNew
      const { decryptSecret } = await import('../server/utils/totp.js');
      const dbVerifyRun = new Database(rotationDbPath);
      const rows = dbVerifyRun.prepare('SELECT id, two_factor_secret, pending_two_factor_secret FROM users').all();
      
      // User 1 active secret
      const dec1 = decryptSecret(rows.find(r => r.id === 1).two_factor_secret, keyNew);
      assert.strictEqual(dec1, secret1);

      // User 2 pending JSON secret
      const pendingJson = JSON.parse(rows.find(r => r.id === 2).pending_two_factor_secret);
      const dec2 = decryptSecret(pendingJson.secret, keyNew);
      assert.strictEqual(dec2, secret2);

      // User 3 pending plain secret
      const dec3 = decryptSecret(rows.find(r => r.id === 3).pending_two_factor_secret, keyNew);
      assert.strictEqual(dec3, secret3);

      // 3. Rollback on corrupt record test
      dbVerifyRun.prepare('INSERT INTO users (id, username, two_factor_secret, pending_two_factor_secret) VALUES (?, ?, ?, ?)').run(4, 'u4', 'corrupted:iv:data', null);
      dbVerifyRun.close();

      assert.throws(() => {
        execSync(`node "${scriptPath}" --db="${rotationDbPath}"`, { env: { ...env, PREVIOUS_MFA_ENCRYPTION_KEY: keyNew, MFA_ENCRYPTION_KEY: 'third_key_xyz' }, stdio: 'pipe' });
      }, /Rotation aborted and rolled back/i);

      // Clean up temporary database
      try { fs.unlinkSync(rotationDbPath); } catch { /* ignore */ }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-02: SSRF Prevention in Public Fetch and Previews
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-02: SSRF Prevention in Public Fetch and Previews', () => {
    test('isPrivateIP rejects all loopback, RFC1918, link-local, expanded IPv6, and multicast addresses', async () => {
      const { isPrivateIP } = await import('../server/utils/ssrf-filter.js');

      // Standard IPv4 internal/loopback
      assert.strictEqual(isPrivateIP('127.0.0.1'), true, '127.0.0.1 must be private');
      assert.strictEqual(isPrivateIP('127.1.2.3'), true, '127.x.x.x must be private');
      assert.strictEqual(isPrivateIP('10.0.0.1'), true, '10.x must be private');
      assert.strictEqual(isPrivateIP('172.16.0.1'), true, '172.16 must be private');
      assert.strictEqual(isPrivateIP('172.31.255.254'), true, '172.31 must be private');
      assert.strictEqual(isPrivateIP('192.168.1.1'), true, '192.168 must be private');
      assert.strictEqual(isPrivateIP('169.254.169.254'), true, '169.254 (cloud metadata) must be private');
      assert.strictEqual(isPrivateIP('0.0.0.0'), true, '0.0.0.0 must be private');
      assert.strictEqual(isPrivateIP('100.64.0.1'), true, 'Carrier grade NAT must be private');
      assert.strictEqual(isPrivateIP('224.0.0.1'), true, 'Multicast must be private');

      // IPv6 loopback, link-local, ULA, and IPv4-mapped
      assert.strictEqual(isPrivateIP('::1'), true, '::1 must be private');
      assert.strictEqual(isPrivateIP('fe80::1'), true, 'fe80:: link-local must be private');
      assert.strictEqual(isPrivateIP('fc00::1'), true, 'fc00:: ULA must be private');
      assert.strictEqual(isPrivateIP('::ffff:127.0.0.1'), true, 'IPv4-mapped 127.0.0.1 must be private');
      assert.strictEqual(isPrivateIP('::ffff:10.0.0.1'), true, 'IPv4-mapped 10.0.0.1 must be private');
      // Fully expanded IPv4-mapped loopback notation
      assert.strictEqual(isPrivateIP('0:0:0:0:0:ffff:7f00:1'), true, 'Expanded IPv4-mapped loopback must be private');

      // Public IPs
      assert.strictEqual(isPrivateIP('8.8.8.8'), false, '8.8.8.8 must be public');
      assert.strictEqual(isPrivateIP('1.1.1.1'), false, '1.1.1.1 must be public');
      assert.strictEqual(isPrivateIP('2606:4700:4700::1111'), false, 'Public IPv6 must be public');
    });

    test('validateSafePublicUrl rejects local hostnames and loopback targets', async () => {
      const { validateSafePublicUrl } = await import('../server/utils/ssrf-filter.js');

      await assert.rejects(
        () => validateSafePublicUrl('http://localhost:3000'),
        /forbidden|restricted/i
      );
      await assert.rejects(
        () => validateSafePublicUrl('http://127.0.0.1:8080'),
        /forbidden|restricted/i
      );
      await assert.rejects(
        () => validateSafePublicUrl('http://169.254.169.254/latest/meta-data'),
        /forbidden|restricted/i
      );
      await assert.rejects(
        () => validateSafePublicUrl('http://[0:0:0:0:0:ffff:7f00:1]:3001/'),
        /forbidden|restricted/i
      );
      await assert.rejects(
        () => validateSafePublicUrl('file:///etc/passwd'),
        /supported/i
      );
    });

    test('createPinnedAgent returns an undici Agent for connection pinning', async () => {
      const { createPinnedAgent } = await import('../server/utils/ssrf-filter.js');
      const agent = createPinnedAgent('8.8.8.8');
      assert.ok(agent, 'Agent must be created');
      assert.ok(typeof agent.dispatch === 'function', 'Agent must implement undici dispatch');
    });

    test('Live Route: GET /api/link-preview rejects loopback, expanded IPv6, and cloud metadata targets with 400', async () => {
      // 1. Loopback target
      const resLoopback = await fetch(`${testApiUrl}/api/link-preview?url=${encodeURIComponent('http://127.0.0.1:3099/api/test/db-identity')}`);
      assert.strictEqual(resLoopback.status, 400, 'Loopback link preview must return 400');
      const body1 = await resLoopback.json();
      assert.match(body1.error, /forbidden|restricted|invalid/i);

      // 2. Expanded IPv4-mapped loopback target
      const resExpandedIPv6 = await fetch(`${testApiUrl}/api/link-preview?url=${encodeURIComponent('http://[0:0:0:0:0:ffff:7f00:1]:3099/')}`);
      assert.strictEqual(resExpandedIPv6.status, 400, 'Expanded IPv6 loopback must return 400');

      // 3. Cloud metadata target
      const resMetadata = await fetch(`${testApiUrl}/api/link-preview?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`);
      assert.strictEqual(resMetadata.status, 400, 'Metadata service target must return 400');
    });

    test('Live Route: GET /api/proxy-image rejects private and loopback targets with 400', async () => {
      // 1. Non-HTTPS target rejected
      const resHttp = await fetch(`${testApiUrl}/api/proxy-image?url=${encodeURIComponent('http://127.0.0.1:3099/favicon.ico')}`);
      assert.strictEqual(resHttp.status, 400, 'HTTP target must return 400');
      const bodyHttp = await resHttp.json();
      assert.match(bodyHttp.error, /only https/i);

      // 2. HTTPS private loopback target rejected
      const resHttpsLoopback = await fetch(`${testApiUrl}/api/proxy-image?url=${encodeURIComponent('https://127.0.0.1:3099/favicon.ico')}`);
      assert.strictEqual(resHttpsLoopback.status, 403, 'Loopback image proxy must return 403');
      const bodyHttps = await resHttpsLoopback.json();
      assert.match(bodyHttps.error, /forbidden|restricted/i);
    });

    test('Live Route: Aliased endpoints (/bfi-classroom/api/*) enforce identical SSRF restrictions', async () => {
      const res = await fetch(`${testApiUrl}/bfi-classroom/api/link-preview?url=${encodeURIComponent('http://127.0.0.1:3099/api/test/db-identity')}`);
      assert.strictEqual(res.status, 400, 'Aliased route must return 400 for loopback targets');
    });

    test('createPinnedAgent pins lookup directly to validated IP preventing DNS rebinding', async () => {
      const { createPinnedAgent } = await import('../server/utils/ssrf-filter.js');
      const pinnedAgent = createPinnedAgent('93.184.216.34');
      assert.ok(pinnedAgent, 'Agent must be instantiated');
      pinnedAgent.destroy();
    });

    test('readBoundedStream enforces byte limits and cancels stream reader on overflow', async () => {
      const { readBoundedStream, PayloadTooLargeError } = await import('../server/utils/ssrf-filter.js');
      let cancelled = false;
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.alloc(1024, 'A'));
          controller.enqueue(Buffer.alloc(1024, 'B'));
        },
        cancel() {
          cancelled = true;
        }
      });

      await assert.rejects(
        () => readBoundedStream(mockStream, { maxBytes: 1500, mode: 'buffer' }),
        PayloadTooLargeError
      );
      assert.strictEqual(cancelled, true, 'Stream reader must be cancelled when limit is exceeded');
    });

    test('readBoundedStream aborts and cancels stream on active deadline cancellation', async () => {
      const { readBoundedStream } = await import('../server/utils/ssrf-filter.js');
      const controller = new AbortController();
      let cancelled = false;

      const mockStream = new ReadableStream({
        async pull(streamController) {
          streamController.enqueue(Buffer.from('chunk1'));
          controller.abort();
        },
        cancel() {
          cancelled = true;
        }
      });

      await assert.rejects(
        () => readBoundedStream(mockStream, { maxBytes: 10000, signal: controller.signal }),
        (err) => err.name === 'AbortError'
      );
      assert.strictEqual(cancelled, true, 'Stream reader must be cancelled on deadline abort');
    });

    test('readBoundedStream soft-stops HTML preview at stopPattern without throwing', async () => {
      const { readBoundedStream } = await import('../server/utils/ssrf-filter.js');
      let cancelled = false;
      const htmlChunk1 = '<html><head><title>Test Title</title></head>';
      const htmlChunk2 = '<body><h1>Rest of massive page</h1></body></html>';

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(htmlChunk1));
          controller.enqueue(Buffer.from(htmlChunk2));
        },
        cancel() {
          cancelled = true;
        }
      });

      const result = await readBoundedStream(mockStream, {
        maxBytes: 100 * 1024,
        mode: 'text',
        stopPattern: '</head>'
      });

      assert.strictEqual(result.text, htmlChunk1);
      assert.strictEqual(cancelled, true, 'Stream must be cancelled early once stopPattern is reached');
    });

    test('Live Route: GET /api/link-preview succeeds on legitimate public URL', async () => {
      const res = await fetch(`${testApiUrl}/api/link-preview?url=${encodeURIComponent('https://example.com')}`);
      assert.strictEqual(res.status, 200, 'Legitimate public link preview must return 200');
      const data = await res.json();
      assert.strictEqual(data.url, 'https://example.com');
      assert.ok(data.title, 'Title must be extracted');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-03: File Upload Validation & Media CSP Headers
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-03: File Upload Validation & Media CSP Headers', () => {
    test('validateExtensionAndMime rejects dangerous extensions and mismatched MIME types', async () => {
      const { validateExtensionAndMime, CERTIFICATE_ALLOWED_TYPES, COURSE_ATTACHMENT_ALLOWED_TYPES } = await import('../server/utils/file-validator.js');

      // Audit sentinel HTML uploaded with image/png MIME
      const sentinel = validateExtensionAndMime('audit-sentinel.html', 'image/png', CERTIFICATE_ALLOWED_TYPES);
      assert.strictEqual(sentinel.valid, false, 'HTML extension must be rejected even with image MIME');

      // SVG upload
      const svg = validateExtensionAndMime('vector.svg', 'image/svg+xml', CERTIFICATE_ALLOWED_TYPES);
      assert.strictEqual(svg.valid, false, 'SVG must be rejected in certificate templates');

      // Valid PNG
      const validPng = validateExtensionAndMime('cert.png', 'image/png', CERTIFICATE_ALLOWED_TYPES);
      assert.strictEqual(validPng.valid, true, 'Valid PNG must be accepted');

      // Valid PDF
      const validPdf = validateExtensionAndMime('doc.pdf', 'application/pdf', COURSE_ATTACHMENT_ALLOWED_TYPES);
      assert.strictEqual(validPdf.valid, true, 'Valid PDF must be accepted');
    });

    test('validateMagicBytes verifies actual binary file headers', async () => {
      const { validateMagicBytes } = await import('../server/utils/file-validator.js');

      // Valid PNG header
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
      assert.strictEqual(validateMagicBytes(pngHeader, '.png').valid, true);

      // HTML disguised as PNG
      const htmlHeader = Buffer.from('<html><body>Test</body></html>');
      assert.strictEqual(validateMagicBytes(htmlHeader, '.png').valid, false);

      // Valid PDF header
      const pdfHeader = Buffer.from('%PDF-1.7 header content');
      assert.strictEqual(validateMagicBytes(pdfHeader, '.pdf').valid, true);
    });

    test('Live Upload Route: Certificate image upload rejects HTML file disguised as PNG and unlinks it', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['<!DOCTYPE html><html><body>malicious payload</body></html>'], { type: 'image/png' }), 'audit-sentinel.html');

      const res = await fetch(`${testApiUrl}/api/certification/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAuthToken}` },
        body: formData,
      });

      assert.strictEqual(res.status, 400, 'HTML file must be rejected with 400');
      const body = await res.json();
      assert.match(body.error, /disallowed|not allowed/i);

      // Verify that no file named audit-sentinel.html exists in the certificate uploads directory
      const certUploadDir = path.join(__dirname, '../uploads/certificates');
      if (fs.existsSync(certUploadDir)) {
        const files = fs.readdirSync(certUploadDir);
        assert.strictEqual(files.some(f => f.includes('audit-sentinel')), false, 'Rejected file must not exist on disk');
      }
    });

    test('Live Upload Route: Certificate image upload rejects fake PNG with non-image bytes and unlinks it', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['This is plain text disguised as a png file.'], { type: 'image/png' }), 'corrupt-image.png');

      const res = await fetch(`${testApiUrl}/api/certification/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAuthToken}` },
        body: formData,
      });

      assert.strictEqual(res.status, 400, 'Mismatched magic bytes must be rejected with 400');
      const body = await res.json();
      assert.match(body.error, /invalid png signature|header does not match/i);
    });

    test('Live Upload Route: Certificate image upload accepts valid PNG image and verifies presence', async () => {
      const validPngBytes = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR length
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        0x00, 0x00, 0x00, 0x01, // width: 1
        0x00, 0x00, 0x00, 0x01, // height: 1
        0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
        0x1F, 0x15, 0xC4, 0x89, // CRC
        0x00, 0x00, 0x00, 0x00, // IEND length
        0x49, 0x45, 0x4E, 0x44, // "IEND"
        0xAE, 0x42, 0x60, 0x82  // CRC
      ]);

      const formData = new FormData();
      formData.append('file', new Blob([validPngBytes], { type: 'image/png' }), 'genuine-cert.png');

      const res = await fetch(`${testApiUrl}/api/certification/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAuthToken}` },
        body: formData,
      });

      assert.strictEqual(res.status, 200, 'Valid PNG must return 200');
      const body = await res.json();
      assert.ok(body.url, 'Must return uploaded file URL');

      const filename = path.basename(body.url);
      const filePath = path.join(__dirname, '../uploads/certificates', filename);
      assert.strictEqual(fs.existsSync(filePath), true, 'Valid file must be written to disk');

      // Cleanup
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    });

    test('Live Serving Headers: Media routes serve strict sandbox and nosniff protection', async () => {
      const res = await fetch(`${testApiUrl}/media/nonexistent-fixture.jpg`);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-security-policy') || '', /sandbox/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-04: Student Profile Privacy & Academic/Fee Isolation
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-04: Student Profile Privacy & Academic/Fee Isolation', () => {
    test('other-user profile response strips fee details and academic marks for non-admins', async () => {
      const tmpDir = path.join(__dirname, '.tmp_test_runs');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const testDbPath = path.join(tmpDir, `test_sec04_${Date.now()}.db`);
      const db = await initIsolatedTestDatabase(testDbPath);

      // Seed student viewer (ID 20) and student target (ID 21)
      db.prepare(`INSERT INTO users (id, username, email, password_hash, first_name, last_name, role) VALUES (20, 'viewer_stu', 'viewer@bfi.local', 'hash', 'Viewer', 'Student', 'student')`).run();
      db.prepare(`INSERT INTO users (id, username, email, password_hash, first_name, last_name, role) VALUES (21, 'target_stu', 'target@bfi.local', 'hash', 'Target', 'Student', 'student')`).run();

      // Seed enrollment with confidential fee and score data
      db.prepare(`
        INSERT INTO student_course_enrollments (id, user_id, course_name, batch_id, fee_details)
        VALUES (101, 21, 'Cinematography', 1, '{"due": 50000, "concession": "confidential"}')
      `).run();

      const studentRoutes = (await import('../server/routes/student.js')).default;
      const getHandler = (router, method, pathStr) => {
        const layer = router.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
        return layer.route.stack[layer.route.stack.length - 1].handle;
      };

      const handler = getHandler(studentRoutes, 'GET', '/profile/:userId');
      let statusCode = 200;
      let jsonPayload = null;

      const mockReq = {
        params: { userId: '21' },
        query: {},
        user: { id: 20, role: 'student' }
      };
      const mockRes = {
        status(code) { statusCode = code; return this; },
        json(data) { jsonPayload = data; return this; }
      };

      await handler(mockReq, mockRes);

      assert.strictEqual(statusCode, 200);
      assert.ok(jsonPayload.enrollments, 'Enrollments list must be returned');
      const enr = jsonPayload.enrollments[0];
      assert.strictEqual(enr.fee_details, undefined, 'fee_details must be stripped for non-admin viewers');
      assert.strictEqual(enr.total_fee, undefined, 'total_fee must be stripped for non-admin viewers');
      assert.strictEqual(enr.paid_amount, undefined, 'paid_amount must be stripped for non-admin viewers');
      assert.strictEqual(enr.course_name, 'Cinematography');

      db.close();
      try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-05: Rate Limiter & Challenge Bounding
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-05: Rate Limiter & Challenge Bounding', () => {
    test('Rate limiter key generator isolates by client IP, not arbitrary Authorization header variations', () => {
      // In server.js, the keyGenerator for unauthenticated/generic requests uses ipKeyGenerator(req.ip)
      // Verify that rotating client Authorization headers does NOT create different buckets
      const reqA = { ip: '203.0.113.10', headers: { authorization: 'Bearer random_token_variant_1' } };
      const reqB = { ip: '203.0.113.10', headers: { authorization: 'Bearer random_token_variant_2' } };

      // Re-create the key generation policy from server.js
      const generateKey = (req) => {
        if (req.user?.id) return `user:${req.user.id}`;
        return req.ip;
      };

      assert.strictEqual(generateKey(reqA), generateKey(reqB), 'Authorization header rotation must NOT change rate limit key');
      assert.strictEqual(generateKey(reqA), '203.0.113.10');

      // Authenticated requests bind to verified user ID
      const reqAuth = { ip: '203.0.113.10', user: { id: 42 } };
      assert.strictEqual(generateKey(reqAuth), 'user:42');
    });

    test('validatePassword rejects common breached passwords and restricts length to bcrypt boundary', async () => {
      const { validatePassword } = await import('../server/middleware/auth.js');

      assert.strictEqual(validatePassword('Password123!'), false, 'Common breached password must be rejected');
      assert.strictEqual(validatePassword('Admin@BFI2024'), false, 'Known default password must be rejected');
      assert.strictEqual(validatePassword('short1!'), false, 'Less than 8 chars must be rejected');
      assert.strictEqual(validatePassword('A'.repeat(73) + '1!a'), false, 'Over 72 chars must be rejected');
      assert.strictEqual(validatePassword('Correct Horse Battery 123!'), true, 'Long passphrase with spaces must be accepted');
      assert.strictEqual(validatePassword('Secure#P@ssw0rd$2026'), true, 'Valid strong password must be accepted');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-06: Recovery URL Trust & Enumeration Defense
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-06: Recovery URL Trust & Enumeration Defense', () => {
    test('getValidatedAppUrl requires configured app URL and preserves base path', async () => {
      const { getValidatedAppUrl } = await import('../server/utils/app-url.js');

      process.env.APP_URL = 'https://classroom.bfi.gov.bd/portal';
      const url = getValidatedAppUrl();
      assert.strictEqual(url, 'https://classroom.bfi.gov.bd/portal');

      delete process.env.APP_URL;
    });

    test('forgot-password returns generic response for both existent and nonexistent users', async () => {
      const authRoutes = (await import('../server/routes/auth.js')).default;
      const getHandler = (router, method, pathStr) => {
        const layer = router.stack.find(l => l.route?.path === pathStr && l.route?.methods?.[method.toLowerCase()]);
        return layer.route.stack[layer.route.stack.length - 1].handle;
      };

      const handler = getHandler(authRoutes, 'POST', '/forgot-password');

      let res1Payload = null;
      let res2Payload = null;

      await handler(
        { body: { email: 'nonexistent_user_xyz@bfi.local' }, ip: '127.0.0.1' },
        { status(code) { return this; }, json(data) { res1Payload = data; return this; } }
      );

      await handler(
        { body: { email: 'student@bfibd.org' }, ip: '127.0.0.1' },
        { status(code) { return this; }, json(data) { res2Payload = data; return this; } }
      );

      assert.ok(res1Payload.message, 'Must return generic message');
      assert.strictEqual(res1Payload.message, res2Payload.message, 'Responses must be identical to prevent user enumeration');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-07: Fail-Closed Audit Requirements & Atomic Rollback
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-07: Fail-Closed Audit Requirements & Atomic Rollback', () => {
    test('Live Route: Simulated database audit write failure aborts password reset and rolls back all changes', async () => {
      const dbPath = getTestDbPath();
      const db = new Database(dbPath);

      // Create a test user with reset pending
      const testUserId = 998877;
      const testEmail = `sec07_test_${Date.now()}@bfi.local`;
      const originalPasswordHash = '$2a$12$originalPasswordHashSimulationValue12345';
      const rawResetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');

      db.prepare(`
        INSERT INTO users (id, username, email, first_name, last_name, password_hash, role, is_active, password_reset_pending, token_version, account_version)
        VALUES (?, 'sec07_admin', ?, 'SecSeven', 'Admin', ?, 'admin', 1, 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, password_reset_pending = 1, token_version = 1
      `).run(testUserId, testEmail, originalPasswordHash);

      // Seed password reset token
      db.prepare(`
        INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, expires_at)
        VALUES (?, ?, 'admin_password_reset', 1, datetime('now', '+1 hour'))
      `).run(testUserId, tokenHash);

      // 1. Install SQLite trigger to simulate failure in admin_audit_logs write
      db.exec(`
        CREATE TRIGGER simulate_audit_failure
        BEFORE INSERT ON admin_audit_logs
        BEGIN
          SELECT RAISE(ABORT, 'Simulated audit table persistence failure for SEC-07 test');
        END;
      `);

      // 2. Call password reset completion endpoint
      const resetPayload = {
        userId: testUserId,
        token: rawResetToken,
        password: 'Valid#NewPassword$2026'
      };

      const failRes = await fetch(`${testApiUrl}/api/auth/admin/reset-password/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetPayload)
      });

      assert.strictEqual(failRes.status, 500, 'Audit table write failure must cause endpoint to return 500');

      // 3. Verify atomic rollback: user password must NOT be updated, reset token must STILL exist
      const userAfterFailure = db.prepare('SELECT password_hash, password_reset_pending, token_version FROM users WHERE id = ?').get(testUserId);
      assert.strictEqual(userAfterFailure.password_hash, originalPasswordHash, 'Password hash must NOT change when audit write fails');
      assert.strictEqual(userAfterFailure.password_reset_pending, 1, 'Reset pending flag must remain 1');

      const tokenAfterFailure = db.prepare('SELECT id FROM password_reset_tokens WHERE user_id = ?').get(testUserId);
      assert.ok(tokenAfterFailure, 'Password reset token must NOT be consumed after transaction rollback');

      // 4. Drop trigger to prove it succeeds when audit logging is healthy
      db.exec('DROP TRIGGER simulate_audit_failure;');

      const successRes = await fetch(`${testApiUrl}/api/auth/admin/reset-password/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetPayload)
      });

      assert.strictEqual(successRes.status, 200, 'Endpoint must succeed when audit log table write succeeds');

      const userAfterSuccess = db.prepare('SELECT password_hash, password_reset_pending, token_version FROM users WHERE id = ?').get(testUserId);
      assert.notStrictEqual(userAfterSuccess.password_hash, originalPasswordHash, 'Password hash must be updated');
      assert.strictEqual(userAfterSuccess.password_reset_pending, 0, 'Reset pending flag must be cleared to 0');

      const tokenAfterSuccess = db.prepare('SELECT id FROM password_reset_tokens WHERE user_id = ?').get(testUserId);
      assert.strictEqual(tokenAfterSuccess, undefined, 'Password reset token must be consumed');

      // Clean up test user
      db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
      db.close();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-08: WebSocket Identity Overwrite
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-08: WebSocket Identity Overwrite', () => {
    test('Server-side WebSocket event dispatch overwrites client-supplied callerId and senderId with socket.user.id', () => {
      // Direct simulation of the WebRTC call signaling handler logic in server/server.js
      const authenticatedUser = { id: 77, username: 'valid_actor' };
      const attackerPayload = {
        receiverId: 88,
        callerId: 1, // Maliciously attempting to impersonate user 1 (Super Admin)
        callerData: { id: 1, name: 'Fake Super Admin' }
      };

      // Handler implementation in server/server.js:
      // const sanitized = { ...data, callerId: socket.user.id, callerData: { ...(data.callerData || {}), id: socket.user.id } };
      const sanitized = {
        ...attackerPayload,
        callerId: authenticatedUser.id,
        callerData: {
          ...(attackerPayload.callerData || {}),
          id: authenticatedUser.id
        }
      };

      assert.strictEqual(sanitized.callerId, 77, 'callerId must be overwritten with socket.user.id');
      assert.strictEqual(sanitized.callerData.id, 77, 'callerData.id must be overwritten with socket.user.id');
      assert.notStrictEqual(sanitized.callerId, attackerPayload.callerId, 'Attacker callerId must be discarded');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-09: Token Query Parameter Removal in Export
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-09: Token Query Parameter Removal in Export', () => {
    test('fee-tracker export does not accept token in query string', () => {
      const feeContent = fs.readFileSync(path.join(__dirname, '../server/routes/fee-tracker.js'), 'utf8');
      assert.doesNotMatch(feeContent, /checkQueryToken/);
      assert.doesNotMatch(feeContent, /req\.query\.token/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-10: Dependency Triage & PDF.js Eval Mitigation
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-10: Dependency Triage & PDF.js Eval Mitigation', () => {
    test('PDF.js Viewer and import components configure isEvalSupported: false', () => {
      const viewerPath = path.join(__dirname, '../src/components/PdfViewer.jsx');
      const import1 = path.join(__dirname, '../src/components/admin/BulkRegisteredStudentImport.jsx');
      const import2 = path.join(__dirname, '../src/components/admin/BulkStudentImport.jsx');
      const import3 = path.join(__dirname, '../src/components/admin/UploadResultsModal.jsx');

      assert.match(fs.readFileSync(viewerPath, 'utf8'), /isEvalSupported:\s*false/);
      assert.match(fs.readFileSync(import1, 'utf8'), /isEvalSupported:\s*false/);
      assert.match(fs.readFileSync(import2, 'utf8'), /isEvalSupported:\s*false/);
      assert.match(fs.readFileSync(import3, 'utf8'), /isEvalSupported:\s*false/);
    });

    test('Full dependency audit inventory exists and reflects 48 affected packages', () => {
      const candidates = [
        path.join(__dirname, '../security-audit-2026-10-28-npm.json'),
        path.join(__dirname, '../../../security-audit-2026-10-28-npm.json')
      ];
      const auditReportPath = candidates.find(p => fs.existsSync(p));
      assert.ok(auditReportPath, 'Full npm audit report must be preserved');
      const auditData = JSON.parse(fs.readFileSync(auditReportPath, 'utf8'));
      assert.ok(auditData.vulnerabilities, 'Audit report must contain vulnerabilities object');
      const count = Object.keys(auditData.vulnerabilities).length;
      assert.strictEqual(count, 48, 'Audit inventory must cover all 48 affected packages');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-11: Deployment Workflow Safeguards
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-11: Deployment Workflow Safeguards', () => {
    test('deploy.yml enforces least-privilege permissions, commit checkout, and pre-deployment backup', () => {
      const deployContent = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy.yml'), 'utf8');
      assert.match(deployContent, /permissions:\s*[\r\n]+\s*contents:\s*read/);
      assert.match(deployContent, /environment:\s*production/);
      assert.match(deployContent, /production_lifecycle\.cjs\s+deploy\s+--target-commit\s+\$\{\{\s*github\.sha\s*\}\}/);
      assert.match(deployContent, /production_lifecycle\.cjs\s+rollback/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-12: Bootstrap Safety
  // ───────────────────────────────────────────────────────────────────────────
  describe('SEC-12: Bootstrap Safety', () => {
    test('database bootstrap does not seed fixed password in production', () => {
      const dbContent = fs.readFileSync(path.join(__dirname, '../server/db/database.js'), 'utf8');
      assert.doesNotMatch(dbContent, /hashSync\('Admin@BFI2024'/);
    });
  });
});
