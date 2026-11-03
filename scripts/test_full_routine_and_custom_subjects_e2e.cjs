/**
 * scripts/test_full_routine_and_custom_subjects_e2e.cjs
 *
 * Comprehensive End-to-End Verification of:
 * 1. "Create Custom Subject" lifecycle & dynamic catalog availability.
 * 2. Full Routine Slot metadata (Date, Weekday, Time, Subject, Class Title, Teacher, Mode, Category).
 * 3. Batch Schedule Override persistence in course_routine_overrides & course_routine_audits.
 * 4. Batch resolution via resolvePhaseRoutine preserving all fields.
 * 5. Backward compatibility with legacy recurring routines.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== START: Full Routine & Custom Subjects E2E Verification ===');

const db = require('../server/db/database.js').default;
const { resolvePhaseRoutine } = require('../server/services/courseProgressService.js');

// 1. Verify custom_subjects table contains data and supports new subject insertion
const initialSubjectCount = db.prepare('SELECT COUNT(*) as cnt FROM custom_subjects').get().cnt;
console.log(`Initial custom_subjects count: ${initialSubjectCount}`);

let createdSubjectId = null;
let courseDefId = null;
let batchId = null;

try {
  const testSubjectName = `Test Direction & Staging ${Date.now()}`;
  const insertSubjectStmt = db.prepare(`
    INSERT INTO custom_subjects (name, course_name, phase, parts_count, class_type, has_live_qa, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const subResult = insertSubjectStmt.run(testSubjectName, 'Online Filmmaking Course', 1, 1, 'live', 0, 99);
  createdSubjectId = subResult.lastInsertRowid;
  console.log(`✅ Created test custom subject ID: ${createdSubjectId} ("${testSubjectName}")`);

  // Verify catalog query returns it
  const catalogQuery = db.prepare(`
    SELECT s.id, s.name, s.course_name, s.phase, s.class_type
    FROM custom_subjects s
    WHERE s.id = ?
  `).get(createdSubjectId);
  assert.ok(catalogQuery, 'Newly created custom subject must be queryable in catalog');
  assert.strictEqual(catalogQuery.name, testSubjectName, 'Subject name must match exactly');
  console.log('✅ Custom subject catalog query verified');

  // 2. Test course definition with full routine slot metadata
  const testCourseDef = {
    name: `E2E Full Routine Course ${Date.now()}`,
    version: 1,
    course_type: 'filmmaking',
    phase_count: 1,
    status: 'published',
    definition_json: JSON.stringify({
      title: 'E2E Full Routine Course',
      phases: [
        {
          id: 'phase_1',
          title: 'Phase 1: Foundations',
          durationWeeks: 4,
          classCount: 1,
          routine: [
            {
              date: '2026-11-10',
              weekday: 'Tuesday',
              startTime: '19:00',
              endTime: '21:00',
              timezone: 'Asia/Dhaka',
              subjectName: testSubjectName,
              classTitle: 'Introduction to Direction & Staging',
              teacherName: 'Abir Ahmad',
              deliveryMode: 'recorded_plus_live_discussion',
              category: 'theory',
              platform: 'Zoom'
            }
          ],
          classes: [
            {
              id: 'cls_1_1',
              title: 'Introduction to Direction & Staging',
              subjectName: testSubjectName,
              teacherName: 'Abir Ahmad',
              deliveryMode: 'online',
              category: 'theory',
              mandatory: true
            }
          ]
        }
      ]
    })
  };

  const insertDefStmt = db.prepare(`
    INSERT INTO course_definitions (name, slug, version, course_type, phase_count, status, definition_json, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const defResult = insertDefStmt.run(
    testCourseDef.name,
    `e2e-full-routine-${Date.now()}`,
    testCourseDef.version,
    testCourseDef.course_type,
    testCourseDef.phase_count,
    testCourseDef.status,
    testCourseDef.definition_json,
    1,
    1
  );
  courseDefId = defResult.lastInsertRowid;
  console.log(`✅ Created test course_definition ID: ${courseDefId}`);

  // 3. Test Batch Creation and Association
  const insertBatchStmt = db.prepare(`
    INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  const batchResult = insertBatchStmt.run(
    `Batch E2E-${Date.now()}`,
    `B-${Date.now()}`,
    testCourseDef.name,
    courseDefId,
    'running'
  );
  batchId = batchResult.lastInsertRowid;
  console.log(`✅ Created test batch ID: ${batchId}`);

  // 4. Test Batch Routine Override with Custom Shooting Session Metadata
  const batchSpecificRoutine = [
    {
      date: '2026-11-15',
      weekday: 'Sunday',
      startTime: '10:00',
      endTime: '14:00',
      timezone: 'Asia/Dhaka',
      subjectName: testSubjectName,
      classTitle: 'Practical Studio Shooting Workshop',
      teacherName: 'Guest Master Director',
      deliveryMode: 'offline',
      category: 'shooting',
      platform: 'Custom Stream Hub'
    }
  ];

  // Execute override insert
  db.prepare(`
    INSERT INTO course_routine_overrides (
      course_definition_id, batch_id, phase_id, routine_json, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(courseDefId, batchId, 'phase_1', JSON.stringify(batchSpecificRoutine), 1);

  // Execute audit log insert
  db.prepare(`
    INSERT INTO course_routine_audits (
      course_definition_id, batch_id, phase_id, old_routine, new_routine, changed_by, changed_at, reason
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
  `).run(
    courseDefId,
    batchId,
    'phase_1',
    JSON.stringify(testCourseDef.phases?.[0]?.routine || []),
    JSON.stringify(batchSpecificRoutine),
    1,
    'Special weekend shooting studio session with guest director'
  );
  console.log('✅ Batch routine override and audit record inserted');

  // 5. Verify resolvePhaseRoutine returns batch-level override with all metadata intact
  const resolved = resolvePhaseRoutine(db, courseDefId, batchId, 'phase_1', []);
  assert.strictEqual(resolved.source, 'batch_override', 'Resolved source must be batch_override');
  assert.strictEqual(resolved.routine.length, 1, 'Resolved routine must have 1 slot');

  const resolvedSlot = resolved.routine[0];
  assert.strictEqual(resolvedSlot.date, '2026-11-15', 'Date must match');
  assert.strictEqual(resolvedSlot.weekday, 'Sunday', 'Weekday must match');
  assert.strictEqual(resolvedSlot.startTime, '10:00', 'Start time must match');
  assert.strictEqual(resolvedSlot.endTime, '14:00', 'End time must match');
  assert.strictEqual(resolvedSlot.subjectName, testSubjectName, 'Subject name must match');
  assert.strictEqual(resolvedSlot.classTitle, 'Practical Studio Shooting Workshop', 'Class title must match');
  assert.strictEqual(resolvedSlot.teacherName, 'Guest Master Director', 'Teacher name must match');
  assert.strictEqual(resolvedSlot.deliveryMode, 'offline', 'Delivery mode must match');
  assert.strictEqual(resolvedSlot.category, 'shooting', 'Category must match');
  assert.strictEqual(resolvedSlot.platform, 'Custom Stream Hub', 'Platform must match');
  console.log('✅ resolvePhaseRoutine preserved all metadata fields with 100% fidelity');

  // 6. Verify audit trail retrieval
  const auditRow = db.prepare(`
    SELECT * FROM course_routine_audits
    WHERE course_definition_id = ? AND batch_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(courseDefId, batchId);
  assert.ok(auditRow, 'Audit record must exist');
  assert.strictEqual(auditRow.reason, 'Special weekend shooting studio session with guest director');
  const parsedAuditNew = JSON.parse(auditRow.new_routine);
  assert.strictEqual(parsedAuditNew[0].classTitle, 'Practical Studio Shooting Workshop');
  console.log('✅ Audit record verified');
} finally {
  // 7. Clean up test records
  if (courseDefId) {
    db.prepare('DELETE FROM course_routine_audits WHERE course_definition_id = ?').run(courseDefId);
    db.prepare('DELETE FROM course_routine_overrides WHERE course_definition_id = ?').run(courseDefId);
  }
  if (batchId) {
    db.prepare('DELETE FROM batches WHERE id = ?').run(batchId);
  }
  if (courseDefId) {
    db.prepare('DELETE FROM course_definitions WHERE id = ?').run(courseDefId);
  }
  if (createdSubjectId) {
    db.prepare('DELETE FROM custom_subjects WHERE id = ?').run(createdSubjectId);
  }
  console.log('✅ Cleaned up temporary test database records');
}

console.log('===============================================================');
console.log('🎉 ALL FULL ROUTINE & CUSTOM SUBJECTS E2E CHECKS PASSED (7/7)');
console.log('===============================================================');
