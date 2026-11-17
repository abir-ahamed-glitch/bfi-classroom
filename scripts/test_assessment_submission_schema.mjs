import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('assessment submission records are private by identity, versioned, and idempotent', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE app_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE assessment_windows (id INTEGER PRIMARY KEY);
    CREATE TABLE student_course_enrollments (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO assessment_windows VALUES (1);
    INSERT INTO student_course_enrollments VALUES (1);
    INSERT INTO users VALUES (1);`);
  const { ensureAssessmentSubmissions } = require('../server/db/migrations/20261116_assessment_files.cjs');
  ensureAssessmentSubmissions(db); ensureAssessmentSubmissions(db);
  const insert = db.prepare(`INSERT INTO assessment_submissions (window_id,enrollment_id,version,pdf_data,sha256,byte_size,request_key) VALUES (1,1,?,?,?,100,?)`);
  insert.run(1, Buffer.from('file'), 'b'.repeat(64), 'request-1');
  assert.throws(() => insert.run(1, Buffer.from('file'), 'b'.repeat(64), 'request-2'));
  assert.throws(() => insert.run(2, Buffer.from('file'), 'b'.repeat(64), 'request-1'));
  insert.run(2, Buffer.from('file'), 'b'.repeat(64), 'request-2');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assessment_submissions').get().count, 2);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});
