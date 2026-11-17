import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('assessment schema migration is idempotent and isolates distinct phase assessments', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE batches (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO batches VALUES (1);
    INSERT INTO users VALUES (1);
  `);
  const { ensureAssessmentSchema } = require('../server/db/migrations/20261115_assessment_submissions.cjs');
  ensureAssessmentSchema(db);
  ensureAssessmentSchema(db);
  const add = db.prepare(`
    INSERT INTO assessment_windows (batch_id, phase_id, assessment_type, assessment_id, opens_at, closes_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  add.run(1, 'theory', 'exam', 'final', '2026-11-15T12:00:00Z', '2026-11-15T15:00:00Z', 1);
  add.run(1, 'theory', 'assignment', 'script', '2026-11-15T12:00:00Z', '2026-11-15T15:00:00Z', 1);
  assert.throws(() => add.run(1, 'theory', 'exam', 'final', '2026-11-15T12:00:00Z', '2026-11-15T15:00:00Z', 1));
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM assessment_windows').get().total, 2);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});
