/**
 * scripts/test_course_maker_batch_connection.cjs
 *
 * Verifies end-to-end synchronization between CourseMaker and Batch Manager:
 * 1. BatchManager.jsx fetches course definitions and merges them into course filter options.
 * 2. BatchFormModal.jsx includes all CourseMaker defined courses (published and draft) as primary options.
 * 3. Empty state in BatchManager allows 1-click batch creation for any selected course.
 * 4. CourseSettingsManager, FeeTracker, and StudentManager dynamically incorporate CourseMaker courses.
 * 5. Functional database test verifying batch creation linked to course_definitions.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== TEST: CourseMaker to Batch Manager Connection ===');

// 1. Static Contract: BatchManager.jsx
const batchManagerFile = path.resolve(__dirname, '../src/pages/admin/BatchManager.jsx');
const bmSrc = fs.readFileSync(batchManagerFile, 'utf8');

assert.ok(bmSrc.includes('/api/admin/course-definitions'), 'BatchManager must fetch from /api/admin/course-definitions');
assert.ok(bmSrc.includes('setDefinedCourses'), 'BatchManager must manage definedCourses state');
assert.ok(bmSrc.includes('definedCourses.forEach'), 'BatchManager courseOptions must merge definedCourses');
assert.ok(bmSrc.includes('initialCourseDef={editingBatch ? null : selectedCourseDef}'), 'BatchManager must pass selectedCourseDef to BatchFormModal');
assert.ok(bmSrc.includes('courseDefinitions={definedCourses}'), 'BatchManager must pass courseDefinitions to BatchFormModal');
assert.ok(bmSrc.includes('Create Batch for ${selectedCourse}'), 'BatchManager empty state must provide 1-click create button for selected course');
assert.ok(bmSrc.includes("badgeClass = 'defined'"), 'BatchManager must assign defined badge for course_definition_id batches');

console.log('✅ BatchManager static assertions passed.');

// 2. Static Contract: BatchFormModal.jsx
const batchModalFile = path.resolve(__dirname, '../src/components/admin/BatchFormModal.jsx');
const modalSrc = fs.readFileSync(batchModalFile, 'utf8');

assert.ok(modalSrc.includes('initialCourseName'), 'BatchFormModal must accept initialCourseName prop');
assert.ok(modalSrc.includes('courseDefinitions: propCourseDefs'), 'BatchFormModal must accept courseDefinitions prop');
assert.ok(modalSrc.includes('/api/admin/course-definitions'), 'BatchFormModal must fetch /api/admin/course-definitions');
assert.ok(modalSrc.includes('Defined Courses (Course Maker)'), 'BatchFormModal must display Defined Courses group');
assert.ok(modalSrc.includes('Connected to CourseMaker:'), 'BatchFormModal must display connection banner when course definition is linked');

console.log('✅ BatchFormModal static assertions passed.');

// 3. Static Contract: Cross-System Consistency (CourseSettings, FeeTracker, StudentManager)
const csFile = path.resolve(__dirname, '../src/pages/admin/CourseSettingsManager.jsx');
const csSrc = fs.readFileSync(csFile, 'utf8');
assert.ok(csSrc.includes('/api/admin/course-definitions'), 'CourseSettingsManager must fetch /api/admin/course-definitions');
assert.ok(csSrc.includes('definedCourses.forEach'), 'CourseSettingsManager must merge definedCourses into course list');

const ftFile = path.resolve(__dirname, '../src/pages/admin/FeeTracker.jsx');
const ftSrc = fs.readFileSync(ftFile, 'utf8');
assert.ok(ftSrc.includes('/api/admin/course-definitions'), 'FeeTracker must fetch /api/admin/course-definitions');
assert.ok(ftSrc.includes('courseDefs.forEach'), 'FeeTracker must merge definedCourses into filter options');

const smFile = path.resolve(__dirname, '../src/pages/admin/StudentManager.jsx');
const smSrc = fs.readFileSync(smFile, 'utf8');
assert.ok(smSrc.includes('/api/admin/course-definitions'), 'StudentManager must fetch /api/admin/course-definitions');
assert.ok(smSrc.includes('courseDefs.forEach'), 'StudentManager must merge definedCourses into availableCourses');

console.log('✅ Cross-system integration static assertions passed.');

// 4. Functional DB Simulation with in-memory SQLite database
const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE course_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    course_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    phase_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    definition_json TEXT
  );

  CREATE TABLE batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_name TEXT NOT NULL,
    batch_number TEXT NOT NULL,
    course_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    course_definition_id INTEGER,
    course_version INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    deleted_at TEXT
  );

  CREATE TABLE batch_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL
  );
`);

// Step A: Admin creates a new course in CourseMaker
const insertDef = db.prepare(`
  INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const newCourse = insertDef.run(
  'documentary-filmmaking',
  1,
  'Documentary Filmmaking Masterclass',
  'filmmaking',
  'published',
  2,
  JSON.stringify({ phases: [{ id: 'p1', name: 'Phase 1' }, { id: 'p2', name: 'Phase 2' }] })
);
const courseDefId = newCourse.lastInsertRowid;
assert.ok(courseDefId > 0, 'Course definition should be inserted with valid ID');

// Step B: Query course definitions as BatchManager does
const defs = db.prepare('SELECT id, name, status, phase_count FROM course_definitions WHERE status != ?').all('archived');
assert.strictEqual(defs.length, 1);
assert.strictEqual(defs[0].name, 'Documentary Filmmaking Masterclass');

// Step C: Verify courseOptions generation logic
const allBatches = db.prepare('SELECT * FROM batches WHERE deleted_at IS NULL').all();
const coursesSet = new Set(['Online Filmmaking Course', 'Film Appreciation Course']);
defs.forEach(d => coursesSet.add(d.name));
allBatches.forEach(b => coursesSet.add(b.course_name));
const courseOptions = Array.from(coursesSet);

assert.ok(courseOptions.includes('Documentary Filmmaking Masterclass'), 'courseOptions must include the newly created course even before batches exist');

// Step D: Create a batch linked to the course definition (as BatchFormModal submits)
const insertBatch = db.prepare(`
  INSERT INTO batches (batch_name, batch_number, course_name, status, course_definition_id, course_version)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const batchResult = insertBatch.run(
  '1st Batch',
  '1',
  'Documentary Filmmaking Masterclass',
  'upcoming',
  courseDefId,
  1
);
assert.ok(batchResult.lastInsertRowid > 0, 'Batch should be created linked to course_definition_id');

// Step E: Query batches for this course in BatchManager
const batchesForCourse = db.prepare(`
  SELECT * FROM batches WHERE deleted_at IS NULL AND course_name = ?
`).all('Documentary Filmmaking Masterclass');

assert.strictEqual(batchesForCourse.length, 1);
assert.strictEqual(batchesForCourse[0].course_definition_id, courseDefId);
assert.strictEqual(batchesForCourse[0].batch_name, '1st Batch');

// Step F: Verify CourseMaker batch count resolution
const linkedBatches = db.prepare(`
  SELECT b.id, b.batch_name, b.batch_number, b.status, b.course_definition_id,
         COUNT(DISTINCT bs.student_id) as student_count
  FROM batches b
  LEFT JOIN batch_students bs ON bs.batch_id = b.id
  WHERE b.course_definition_id = ? AND b.deleted_at IS NULL
  GROUP BY b.id
`).all(courseDefId);

assert.strictEqual(linkedBatches.length, 1);
assert.strictEqual(linkedBatches[0].batch_name, '1st Batch');

db.close();

console.log('✅ Functional database simulation assertions passed.');
console.log('=== ALL COURSE-MAKER TO BATCH MANAGER CONNECTION ASSERTIONS PASSED ===');
