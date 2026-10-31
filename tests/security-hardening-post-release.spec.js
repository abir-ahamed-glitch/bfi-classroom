import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { getAllowedOrigins, isOriginAllowed, corsOptions, socketCorsOptions } from '../server/config/cors.js';
import { safeDeleteCourseMaterialFile } from '../server/utils/safe-material-cleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Hardening Suite: Post-Deployment Fixes', () => {
  const tmpTestDir = path.join(__dirname, '.tmp_test_runs', 'security_hardening_' + Date.now());

  before(() => {
    fs.mkdirSync(tmpTestDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('1. CORS Origin Allowlist & Policy Alignment', () => {
    let server;
    let baseUrl;

    before(async () => {
      const app = express();
      app.use(cors(corsOptions));
      app.get('/api/test-cors', (req, res) => res.json({ status: 'ok' }));
      app.post('/api/test-cors', (req, res) => res.json({ status: 'ok' }));

      const httpServer = createServer(app);
      new Server(httpServer, { cors: socketCorsOptions });

      await new Promise(resolve => {
        server = httpServer.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    after(async () => {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });

    test('Allowed origin receives Access-Control-Allow-Origin and Credentials headers', async () => {
      const res = await fetch(`${baseUrl}/api/test-cors`, {
        headers: { 'Origin': 'https://classroom.bfibd.org' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://classroom.bfibd.org');
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    });

    test('Unauthorized cross-site origin does NOT receive Access-Control-Allow-Origin', async () => {
      const res = await fetch(`${baseUrl}/api/test-cors`, {
        headers: { 'Origin': 'https://malicious-site.com' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
    });

    test('Unauthorized same-site cross-origin does NOT receive Access-Control-Allow-Origin by default', async () => {
      const res = await fetch(`${baseUrl}/api/test-cors`, {
        headers: { 'Origin': 'https://attacker.bfibd.org' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    });

    test('Preflight OPTIONS from allowed origin returns 204 with headers', async () => {
      const res = await fetch(`${baseUrl}/api/test-cors`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://classroom.bfibd.org',
          'Access-Control-Request-Method': 'POST'
        }
      });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://classroom.bfibd.org');
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    });

    test('Preflight OPTIONS from unauthorized origin omits Access-Control-Allow-Origin', async () => {
      const res = await fetch(`${baseUrl}/api/test-cors`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://evil.com',
          'Access-Control-Request-Method': 'POST'
        }
      });
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    });

    test('Requests without Origin header (curl, same-origin, mobile) are accepted', async () => {
      const res = await fetch(`${baseUrl}/api/test-cors`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });

    test('Socket.IO origin policy aligns with HTTP policy', () => {
      let passedOrigin = null;
      socketCorsOptions.origin('https://classroom.bfibd.org', (err, allow) => {
        passedOrigin = allow;
      });
      assert.equal(passedOrigin, true);

      let blockedOrigin = null;
      socketCorsOptions.origin('https://evil.org', (err, allow) => {
        blockedOrigin = allow;
      });
      assert.equal(blockedOrigin, false);

      let noOrigin = null;
      socketCorsOptions.origin(undefined, (err, allow) => {
        noOrigin = allow;
      });
      assert.equal(noOrigin, true);
    });
  });

  describe('2. Safe Course Material File Deletion', () => {
    let mockManagedDir;
    let mockSiblingDir;
    let outsideDir;

    before(() => {
      mockManagedDir = path.join(tmpTestDir, 'uploads', 'course-materials');
      mockSiblingDir = path.join(tmpTestDir, 'uploads', 'course-materials-sibling');
      outsideDir = path.join(tmpTestDir, 'outside');

      fs.mkdirSync(mockManagedDir, { recursive: true });
      fs.mkdirSync(mockSiblingDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });
    });

    test('Successfully unlinks legitimate managed course material file', () => {
      const filename = 'test-material-123.pdf';
      const filePath = path.join(mockManagedDir, filename);
      fs.writeFileSync(filePath, 'dummy content');
      assert.ok(fs.existsSync(filePath));

      const result = safeDeleteCourseMaterialFile(`/media/course-materials/${filename}`, mockManagedDir);
      assert.equal(result.success, true);
      assert.equal(fs.existsSync(filePath), false);
    });

    test('Successfully unlinks when URL has /bfi-classroom prefix', () => {
      const filename = 'test-material-prefixed.pdf';
      const filePath = path.join(mockManagedDir, filename);
      fs.writeFileSync(filePath, 'dummy content');

      const result = safeDeleteCourseMaterialFile(`/bfi-classroom/media/course-materials/${filename}`, mockManagedDir);
      assert.equal(result.success, true);
      assert.equal(fs.existsSync(filePath), false);
    });

    test('Rejects path traversal attempts (..)', () => {
      const victimFile = path.join(outsideDir, 'important-system-file.js');
      fs.writeFileSync(victimFile, 'critical code');

      const traversalUrl = '/media/course-materials/../../outside/important-system-file.js';
      const result = safeDeleteCourseMaterialFile(traversalUrl, mockManagedDir);

      assert.equal(result.success, false);
      assert.equal(result.reason, 'PATH_TRAVERSAL_DETECTED');
      assert.ok(fs.existsSync(victimFile), 'Victim file must NOT be deleted');
    });

    test('Rejects sibling directory prefix tricks (course-materials-sibling)', () => {
      const siblingFile = path.join(mockSiblingDir, 'sibling-file.pdf');
      fs.writeFileSync(siblingFile, 'sibling data');

      // Attempting to delete a file in a sibling directory that shares prefix
      const siblingUrl = '/media/course-materials-sibling/sibling-file.pdf';
      const result = safeDeleteCourseMaterialFile(siblingUrl, mockManagedDir);

      assert.equal(result.success, false);
      assert.equal(result.reason, 'NOT_MANAGED_FILE');
      assert.ok(fs.existsSync(siblingFile), 'Sibling file must NOT be deleted');
    });

    test('Rejects symlink escapes', () => {
      const targetFile = path.join(outsideDir, 'secret-config.env');
      fs.writeFileSync(targetFile, 'SECRET=12345');

      const symlinkPath = path.join(mockManagedDir, 'symlink-material.pdf');
      try {
        fs.symlinkSync(targetFile, symlinkPath);
      } catch (e) {
        // Skip if OS permissions restrict symlink creation
        return;
      }

      const result = safeDeleteCourseMaterialFile('/media/course-materials/symlink-material.pdf', mockManagedDir);
      assert.equal(result.success, false);
      assert.equal(result.reason, 'SYMLINK_REJECTED');
      assert.ok(fs.existsSync(targetFile), 'Target of symlink must NOT be deleted');
    });

    test('Leaves external URLs completely untouched', () => {
      const externalUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://vimeo.com/123456789',
        'https://drive.google.com/file/d/abc/view'
      ];
      for (const url of externalUrls) {
        const result = safeDeleteCourseMaterialFile(url, mockManagedDir);
        assert.equal(result.success, false);
        assert.equal(result.reason, 'NOT_MANAGED_FILE');
      }
    });

    test('Leaves private inbox attachments completely untouched', () => {
      const result = safeDeleteCourseMaterialFile('/media/inbox-attachments/confidential.pdf', mockManagedDir);
      assert.equal(result.success, false);
      assert.equal(result.reason, 'NOT_MANAGED_FILE');
    });

    test('Returns FILE_NOT_FOUND when material file does not exist on disk', () => {
      const result = safeDeleteCourseMaterialFile('/media/course-materials/nonexistent-file.pdf', mockManagedDir);
      assert.equal(result.success, false);
      assert.equal(result.reason, 'FILE_NOT_FOUND');
    });
  });
});
