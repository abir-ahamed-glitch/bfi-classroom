const Database = require('../node_modules/better-sqlite3');
const bcrypt = require('../node_modules/bcryptjs');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '../server/staging_classroom.db');
const db = new Database(dbPath);

console.log('[Seed] Seeding navigation fixtures into:', dbPath);

// 1. Course Definition
db.prepare(`
  INSERT OR REPLACE INTO course_definitions (id, slug, version, name, course_type, description, phase_count, status, definition_json, created_by, updated_by, created_at, updated_at)
  VALUES (1, 'online-filmmaking', 1, 'Online Filmmaking Course', 'regular', 'Staging Test Course', 2, 'published', '{}', 1, 1, datetime('now'), datetime('now'))
`).run();

// 2. Batch
db.prepare(`
  INSERT OR REPLACE INTO batches (id, batch_name, batch_number, course_name, status, start_date, end_date, slug, course_definition_id, course_version, created_by, created_at, updated_at)
  VALUES (1, 'Staging Test Batch 1', '01', 'Online Filmmaking Course', 'ongoing', '2026-01-01', '2026-12-31', '1', 1, 1, 1, datetime('now'), datetime('now'))
`).run();

// 3. Announcements
db.prepare(`
  INSERT OR REPLACE INTO announcements (id, admin_id, title, content, priority, target_course, image_url, created_at)
  VALUES (1, 1, 'Staging PDF Notice', 'Synthetic announcement for testing real application PDF viewing.', 'normal', 'All', 'valid-sample.pdf', datetime('now'))
`).run();

db.prepare(`
  INSERT OR REPLACE INTO announcements (id, admin_id, title, content, priority, target_course, image_url, created_at)
  VALUES (2, 1, 'Staging Corrupted PDF Notice', 'Synthetic announcement for testing error handling.', 'normal', 'All', 'corrupt.pdf', datetime('now'))
`).run();

// 4. Update staging admin credentials
const testPass = 'StagingAdmin2026!Secure';
const hash = bcrypt.hashSync(testPass, 10);
db.prepare(`
  UPDATE users 
  SET username = 'admin@staging-admin', email = 'admin@staging-admin', password_hash = ?, two_factor_enabled = 0, is_super_admin = 1, is_active = 1, role = 'admin'
  WHERE id = 2 OR email = 'staging-admin@bfi.local' OR username = 'staging-admin'
`).run(hash);

const credsFile = path.resolve(__dirname, '../server/.staging_admin_credentials.json');
const creds = { username: 'admin@staging-admin', password: testPass, seededAt: new Date().toISOString() };
fs.writeFileSync(credsFile, JSON.stringify(creds, null, 2), { mode: 0o600 });

console.log('[Seed] Staging navigation fixtures successfully seeded.');
