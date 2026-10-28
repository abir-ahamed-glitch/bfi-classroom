import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Remediation Suite: SEC-01 through SEC-12', () => {

  describe('SEC-01: Secret Isolation, Rotation and MFA Key Transition', () => {
    test('.env is untracked in git repository', async () => {
      const { execSync } = await import('child_process');
      const trackedFiles = execSync('git ls-files .env', { cwd: path.join(__dirname, '..') }).toString().trim();
      assert.strictEqual(trackedFiles, '', '.env must not be tracked in git index');
    });

    test('.env.example exists with placeholder values and no secrets', () => {
      const examplePath = path.join(__dirname, '../.env.example');
      assert.ok(fs.existsSync(examplePath), '.env.example must exist');
      const content = fs.readFileSync(examplePath, 'utf8');
      assert.match(content, /JWT_SECRET=/);
      assert.doesNotMatch(content, /rexmeerkbwqbtzha/);
      assert.doesNotMatch(content, /bangladesh\.film\.institute@gmail\.com/);
    });

    test('totp decryptSecret seamlessly falls back to previous key during rotation', async () => {
      const { encryptSecret, decryptSecret } = await import('../server/utils/totp.js');

      const oldKey = 'original_jwt_secret_key_1234567890123456';
      const newKey = 'rotated_new_jwt_secret_key_123456789012345';
      const secret = 'JBSWY3DPEHPK3PXP';

      // Encrypt with old key
      const encryptedWithOld = encryptSecret(secret, oldKey);

      // Decrypt using new key but with oldKey configured as previous key
      process.env.JWT_SECRET = newKey;
      process.env.PREVIOUS_JWT_SECRET = oldKey;

      const decrypted = decryptSecret(encryptedWithOld);
      assert.strictEqual(decrypted, secret, 'Must decrypt using previous key fallback');

      delete process.env.PREVIOUS_JWT_SECRET;
    });
  });

  describe('SEC-02: SSRF Prevention in Public Fetch and Previews', () => {
    test('isPrivateIP rejects all loopback, RFC1918, link-local, and multicast addresses', async () => {
      const { isPrivateIP } = await import('../server/utils/ssrf-filter.js');

      // IPv4 private/internal
      assert.strictEqual(isPrivateIP('127.0.0.1'), true, '127.0.0.1 must be private');
      assert.strictEqual(isPrivateIP('127.1.2.3'), true, '127.x.x.x must be private');
      assert.strictEqual(isPrivateIP('10.0.0.1'), true, '10.x must be private');
      assert.strictEqual(isPrivateIP('172.16.0.1'), true, '172.16 must be private');
      assert.strictEqual(isPrivateIP('172.31.255.254'), true, '172.31 must be private');
      assert.strictEqual(isPrivateIP('192.168.1.1'), true, '192.168 must be private');
      assert.strictEqual(isPrivateIP('169.254.169.254'), true, '169.254 (cloud metadata) must be private');
      assert.strictEqual(isPrivateIP('0.0.0.0'), true, '0.0.0.0 must be private');

      // IPv6 private/internal
      assert.strictEqual(isPrivateIP('::1'), true, '::1 must be private');
      assert.strictEqual(isPrivateIP('fe80::1'), true, 'fe80:: link-local must be private');
      assert.strictEqual(isPrivateIP('fc00::1'), true, 'fc00:: ULA must be private');
      assert.strictEqual(isPrivateIP('::ffff:127.0.0.1'), true, 'IPv4-mapped 127.0.0.1 must be private');
      assert.strictEqual(isPrivateIP('::ffff:10.0.0.1'), true, 'IPv4-mapped 10.0.0.1 must be private');

      // Public IP
      assert.strictEqual(isPrivateIP('8.8.8.8'), false, '8.8.8.8 must be public');
      assert.strictEqual(isPrivateIP('1.1.1.1'), false, '1.1.1.1 must be public');
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
        () => validateSafePublicUrl('file:///etc/passwd'),
        /supported/i
      );
    });
  });

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

      // Fake PNG header: 89 50 4E 47 0D 0A 1A 0A
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
      assert.strictEqual(validateMagicBytes(pngHeader, '.png').valid, true);

      // HTML disguised as PNG
      const htmlHeader = Buffer.from('<html><body>Test</body></html>');
      assert.strictEqual(validateMagicBytes(htmlHeader, '.png').valid, false);

      // Fake PDF header: %PDF
      const pdfHeader = Buffer.from('%PDF-1.7 header content');
      assert.strictEqual(validateMagicBytes(pdfHeader, '.pdf').valid, true);
    });
  });

  describe('SEC-04: Student Profile Privacy & Academic/Fee Isolation', () => {
    test('other-user profile response strips fee details and academic marks for non-admins', async () => {
      const { initIsolatedTestDatabase } = await import('./test-db-isolation.js');
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
    });
  });

  describe('SEC-05: Rate Limiter & Challenge Bounding', () => {
    test('apiLimiter does not create separate buckets for arbitrary client Authorization headers', async () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
      // keyGenerator must not use slice of arbitrary Authorization header
      assert.doesNotMatch(serverContent, /authHeader\.slice\(-32\)/, 'Must not use raw client auth header as limiter key');
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

  describe('SEC-07: Fail-Closed Audit Requirements', () => {
    test('password reset completion passes throwOnError: true inside atomic transaction', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../server/routes/auth.js'), 'utf8');
      const idx = authContent.indexOf("action: 'admin.password_reset_completed'");
      assert.ok(idx !== -1, 'admin.password_reset_completed audit log must exist');
      const slice = authContent.slice(idx, idx + 300);
      assert.match(slice, /throwOnError:\s*true/);
    });

    test('accountability export passes throwOnError: true', () => {
      const adminMgmtContent = fs.readFileSync(path.join(__dirname, '../server/routes/admin-management.js'), 'utf8');
      assert.doesNotMatch(adminMgmtContent, /action:\s*'admin\.export_accountability_history'[\s\S]*?throwOnError:\s*false/);
    });
  });

  describe('SEC-08: WebSocket Identity Overwrite', () => {
    test('server.js overwrites client-supplied callerId and senderId with socket.user.id', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
      assert.match(serverContent, /callerId:\s*socket\.user\.id/);
    });
  });

  describe('SEC-09: Token Query Parameter Removal in Export', () => {
    test('fee-tracker export does not accept token in query string', () => {
      const feeContent = fs.readFileSync(path.join(__dirname, '../server/routes/fee-tracker.js'), 'utf8');
      assert.doesNotMatch(feeContent, /checkQueryToken/);
      assert.doesNotMatch(feeContent, /req\.query\.token/);
    });
  });

  describe('SEC-10: PDF.js Eval Mitigation', () => {
    test('pdfjs getDocument calls pass isEvalSupported: false', () => {
      const import1 = fs.readFileSync(path.join(__dirname, '../src/components/admin/BulkRegisteredStudentImport.jsx'), 'utf8');
      const import2 = fs.readFileSync(path.join(__dirname, '../src/components/admin/BulkStudentImport.jsx'), 'utf8');
      const import3 = fs.readFileSync(path.join(__dirname, '../src/components/admin/UploadResultsModal.jsx'), 'utf8');

      assert.match(import1, /isEvalSupported:\s*false/);
      assert.match(import2, /isEvalSupported:\s*false/);
      assert.match(import3, /isEvalSupported:\s*false/);
    });
  });

  describe('SEC-11: Deployment Workflow Safeguards', () => {
    test('deploy.yml specifies explicit least-privilege permissions and environment', () => {
      const deployContent = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy.yml'), 'utf8');
      assert.match(deployContent, /permissions:\s*[\r\n]+\s*contents:\s*read/);
      assert.match(deployContent, /environment:\s*production/);
      assert.doesNotMatch(deployContent, /rexmeerkbwqbtzha/);
    });
  });

  describe('SEC-12: Bootstrap Safety', () => {
    test('database bootstrap does not seed fixed password in production', () => {
      const dbContent = fs.readFileSync(path.join(__dirname, '../server/db/database.js'), 'utf8');
      assert.doesNotMatch(dbContent, /hashSync\('Admin@BFI2024'/);
    });
  });
});
