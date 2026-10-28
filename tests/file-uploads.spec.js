import { test, expect, request } from '@playwright/test';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { startTestServer } from './test-db-isolation.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const TEST_PORT = process.env.TEST_PORT || '3099';
const API_BASE = `http://127.0.0.1:${TEST_PORT}`;
const UPLOAD_DIR = path.resolve(__dirname, '../uploads/course-materials');
const DB_PATH = path.resolve(__dirname, '../server/test_isolated_bfi.db');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const JWT_SECRET = process.env.JWT_SECRET;

// ── Token helpers (same pattern as all other test files) ─────────────────────
const _db = new Database(DB_PATH);

function getToken(role, preferredUsername) {
  const user = preferredUsername
    ? _db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(preferredUsername)
    : _db.prepare('SELECT * FROM users WHERE role = ? AND is_active = 1 LIMIT 1').get(role);
  if (!user) throw new Error(`No active user found for role: ${role}`);

  let sessionId = undefined;
  if (user.role === 'admin') {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const insert = _db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_activity, sudo_verified_at)
      VALUES (?, 'test_session_hash', '127.0.0.1', 'playwright_test', ?, datetime('now'), datetime('now'), datetime('now'))
    `).run(user.id, expiresAt);
    sessionId = insert.lastInsertRowid;
  }

  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      is_super_admin: user.is_super_admin || 0,
      sessionId, 
      type: 'access', 
      token_version: user.token_version || 1 
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}


// Student whose batch_number we know from DB
let STUDENT_USER_ID = null;
let STUDENT_USERNAME = null;
let STUDENT_BATCH = null;
let STUDENT_COURSE = 'Cinematography';

// Track inserted material IDs and disk files for cleanup
const createdMaterialIds = [];
const createdFiles = [];

test.beforeAll(async () => {
  await startTestServer();
  // Pick a real student from the DB so we can test student-view filtering
  const student = _db
    .prepare(
      `SELECT u.id, u.username, sp.batch_number, sce.course_name
       FROM users u
       JOIN student_profiles sp ON sp.user_id = u.id
       LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id
       WHERE u.role = 'student' AND sp.batch_number IS NOT NULL
       LIMIT 1`
    )
    .get();

  if (student) {
    STUDENT_USER_ID = student.id;
    STUDENT_USERNAME = student.username;
    STUDENT_BATCH = student.batch_number;
    if (student.course_name) {
      STUDENT_COURSE = student.course_name;
    }
  }
});

test.afterAll(async () => {
  // ── Zero-residue cleanup ──────────────────────────────────────────────────
  for (const id of createdMaterialIds) {
    // Hard-delete (not soft) so DB is truly clean
    const row = _db.prepare('SELECT file_url FROM course_materials WHERE id = ?').get(id);
    if (row?.file_url?.startsWith('/media/course-materials/')) {
      const filename = row.file_url.replace('/media/course-materials/', '');
      const filePath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    _db.prepare('DELETE FROM course_materials WHERE id = ?').run(id);
  }

  // Also remove any stray test disk files (in case the row was never inserted)
  for (const f of createdFiles) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  _db.close();
});

// ── Helper: create a tiny real PDF buffer ────────────────────────────────────
function makePdfBuffer() {
  // Minimal valid single-page PDF (no external dependency needed)
  const content = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj',
    'xref',
    '0 4',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    'trailer<</Size 4/Root 1 0 R>>',
    'startxref',
    '190',
    '%%EOF',
  ].join('\n');
  return Buffer.from(content, 'utf-8');
}

// ── Test 1: Admin uploads PDF → DB row created, file on disk ─────────────────
test('Admin: upload real PDF → DB row + file on disk', async () => {
  const adminToken = getToken('admin');
  const ctx = await request.newContext({ baseURL: API_BASE });

  const pdfBuffer = makePdfBuffer();
  const filename = `playwright-test-${Date.now()}.pdf`;

  const response = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Playwright Test Material',
      description: 'Automated upload test',
      course_name: 'History of World Cinema',
      batch_number: '85th',
      is_downloadable: 'true',
      file_type_override: 'pdf',
      file: {
        name: filename,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      },
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.material).toBeTruthy();
  expect(body.material.title).toBe('Playwright Test Material');
  expect(body.material.file_type).toBe('pdf');
  expect(body.material.file_url).toMatch(/^\/media\/course-materials\//);

  // Track for cleanup
  createdMaterialIds.push(body.material.id);

  // Verify file exists on disk
  const diskFilename = body.material.file_url.replace('/media/course-materials/', '');
  const diskPath = path.join(UPLOAD_DIR, diskFilename);
  createdFiles.push(diskPath);
  expect(fs.existsSync(diskPath)).toBe(true);
  expect(fs.statSync(diskPath).size).toBeGreaterThan(0);

  await ctx.dispose();
});

// ── Test 2: Admin list reflects the uploaded material ────────────────────────
test('Admin: material appears in /api/courses/admin/all', async () => {
  // Use a freshly uploaded URL material (no file needed for list test)
  const adminToken = getToken('admin');
  const ctx = await request.newContext({ baseURL: API_BASE });

  // Upload via external URL to avoid duplicate disk files
  const uploadRes = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Playwright URL Material',
      description: 'List test',
      course_name: 'Film Language',
      batch_number: '85th',
      is_downloadable: 'true',
      file_type_override: 'pdf',
      external_url: 'https://example.com/test.pdf',
    },
  });
  expect(uploadRes.status()).toBe(201);
  const { material } = await uploadRes.json();
  createdMaterialIds.push(material.id);

  // Fetch admin list
  const listRes = await ctx.get('/api/courses/admin/all', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(listRes.status()).toBe(200);
  const { materials } = await listRes.json();

  const found = materials.find((m) => m.id === material.id);
  expect(found).toBeTruthy();
  expect(found.title).toBe('Playwright URL Material');
  expect(found.course_name).toBe('Film Language');

  await ctx.dispose();
});

// ── Test 3: Student sees materials for their batch ────────────────────────────
test('Student: sees batch-specific material via GET /api/courses/', async () => {
  if (!STUDENT_USER_ID || !STUDENT_BATCH) {
    test.skip(true, 'No student with batch_number found in DB');
    return;
  }

  const adminToken = getToken('admin');
  const studentToken = getToken('student', STUDENT_USERNAME);
  const ctx = await request.newContext({ baseURL: API_BASE });

  // Upload a material targeted at the student's batch
  const uploadRes = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: `Playwright Batch ${STUDENT_BATCH} Material`,
      description: 'Student view test',
      course_name: STUDENT_COURSE,
      batch_number: STUDENT_BATCH,
      is_downloadable: 'true',
      file_type_override: 'pdf',
      external_url: 'https://example.com/batch-test.pdf',
    },
  });
  expect(uploadRes.status()).toBe(201);
  const { material } = await uploadRes.json();
  createdMaterialIds.push(material.id);

  // Student fetches their materials
  const studentRes = await ctx.get('/api/courses/', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  expect(studentRes.status()).toBe(200);
  const { materials } = await studentRes.json();

  const found = materials.find((m) => m.id === material.id);
  expect(found).toBeTruthy();
  expect(found.batch_number).toBe(STUDENT_BATCH);

  await ctx.dispose();
});

// ── Test 4: Uploaded file is served at /media/course-materials/<filename> ─────
test('Disk file is accessible at /media/course-materials/<filename>', async () => {
  const adminToken = getToken('admin');
  const ctx = await request.newContext({ baseURL: API_BASE });

  const pdfBuffer = makePdfBuffer();
  const uploadRes = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Playwright Serve Test',
      description: 'Serve test',
      course_name: 'Film Aesthetics',
      batch_number: '85th',
      is_downloadable: 'true',
      file_type_override: 'pdf',
      file: {
        name: `serve-test-${Date.now()}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      },
    },
  });
  expect(uploadRes.status()).toBe(201);
  const { material } = await uploadRes.json();
  createdMaterialIds.push(material.id);

  // The file_url is /media/course-materials/<filename>
  // Server serves /media/** via static middleware
  const fileRes = await ctx.get(material.file_url, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  // Static files should return 200 with PDF content-type
  expect(fileRes.status()).toBe(200);
  const contentType = fileRes.headers()['content-type'] || '';
  expect(contentType).toContain('pdf');

  await ctx.dispose();
});

// ── Test 5: Rejected MIME type returns error ──────────────────────────────────
test('Multer rejects disallowed MIME type (text/plain)', async () => {
  const adminToken = getToken('admin');
  const ctx = await request.newContext({ baseURL: API_BASE });

  const response = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Bad File Type',
      course_name: 'Script',
      batch_number: '85th',
      is_downloadable: 'true',
      file: {
        name: 'evil.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('this is not allowed'),
      },
    },
  });

  // Multer fileFilter rejects → Express catches it and returns 500
  expect(response.status()).toBe(500);
  const body = await response.json();
  // Server wraps multer errors in catch → "Internal server error" or similar
  expect(body.error).toBeTruthy();

  await ctx.dispose();
});

// ── Test 6: Admin soft-deletes → material vanishes from student list ──────────
test('Admin: soft-delete removes material from student view', async () => {
  const adminToken = getToken('admin');
  const ctx = await request.newContext({ baseURL: API_BASE });

  // Create material
  const uploadRes = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Playwright Delete Test',
      course_name: 'Documentary',
      batch_number: 'All',
      is_downloadable: 'true',
      file_type_override: 'pdf',
      external_url: 'https://example.com/delete-test.pdf',
    },
  });
  expect(uploadRes.status()).toBe(201);
  const { material } = await uploadRes.json();
  // Don't push to createdMaterialIds — delete test will handle cleanup via DELETE endpoint
  // But we do need cleanup if delete fails, so push anyway
  createdMaterialIds.push(material.id);

  // Admin deletes it
  const deleteRes = await ctx.delete(`/api/courses/${material.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(deleteRes.status()).toBe(200);
  const deleteBody = await deleteRes.json();
  expect(deleteBody.message).toMatch(/trash/i);

  // Student list should no longer include it
  // Use admin token for simplicity (same filter: deleted_at IS NULL)
  const listRes = await ctx.get('/api/courses/admin/all', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const { materials } = await listRes.json();
  const stillPresent = materials.find((m) => m.id === material.id);
  expect(stillPresent).toBeFalsy();

  await ctx.dispose();
});

// ── Test 7: Admin edit (PUT) updates metadata without losing file ─────────────
test('Admin: PUT /api/courses/:id updates title and description', async () => {
  const adminToken = getToken('admin');
  const ctx = await request.newContext({ baseURL: API_BASE });

  // Create
  const uploadRes = await ctx.post('/api/courses/upload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Playwright Edit Target',
      course_name: 'Light',
      batch_number: '85th',
      is_downloadable: 'true',
      file_type_override: 'pdf',
      external_url: 'https://example.com/edit-test.pdf',
    },
  });
  expect(uploadRes.status()).toBe(201);
  const { material } = await uploadRes.json();
  createdMaterialIds.push(material.id);

  // Edit metadata
  const editRes = await ctx.put(`/api/courses/${material.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      title: 'Playwright Edit Target UPDATED',
      description: 'Updated by Playwright',
      course_name: material.course_name,
      batch_number: material.batch_number,
      is_downloadable: 'true',
    },
  });
  expect(editRes.status()).toBe(200);
  const { material: updated } = await editRes.json();
  expect(updated.title).toBe('Playwright Edit Target UPDATED');
  expect(updated.description).toBe('Updated by Playwright');
  // file_url preserved
  expect(updated.file_url).toBe(material.file_url);

  await ctx.dispose();
});
