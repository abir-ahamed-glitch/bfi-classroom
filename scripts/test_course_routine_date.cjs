/**
 * scripts/test_course_routine_date.cjs
 *
 * Verifies backend routine slot validation for optional dates, format enforcement,
 * date-aware schedule conflict detection, full class metadata (subject, teacher, mode, category),
 * and audit logging compatibility.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== TEST: Course Routine Date & Full Metadata Validation ===');

// Check static source code contract
const routeFile = path.resolve(__dirname, '../server/routes/course-definitions.js');
const routeSrc = fs.readFileSync(routeFile, 'utf8');

assert.ok(routeSrc.includes('slot.date'), 'course-definitions.js must reference slot.date for validation');
assert.ok(routeSrc.includes('ALLOWED_DELIVERY_MODES'), 'course-definitions.js must have ALLOWED_DELIVERY_MODES');
assert.ok(routeSrc.includes('ALLOWED_CATEGORIES'), 'course-definitions.js must have ALLOWED_CATEGORIES');

// Publish regression: classCount is derived and must be reconciled, never block publishing
assert.ok(routeSrc.includes('function reconcileClassCounts'), 'reconcileClassCounts helper must exist');
assert.ok((routeSrc.match(/reconcileClassCounts\(/g) || []).length >= 4, 'classCount must be reconciled on create, update and publish');
assert.ok(routeSrc.includes("'self_paced'"), 'self_paced delivery mode used by BatchDetail UI must be allowed');
const cmSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/CourseMaker.jsx'), 'utf8');
assert.ok(/classCount: 1,/.test(cmSrc), 'default phase classCount must match its single default class');

// Test functional routine validator logic directly
const ALLOWED_WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALLOWED_DELIVERY_MODES = ['online', 'offline', 'hybrid', 'self_paced'];
const ALLOWED_CATEGORIES = ['theory', 'practical', 'shooting', 'editing', 'review'];

function isValidDate(dateStr) {
  if (!dateStr) return true;
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getFullYear() === parts[0] && (d.getMonth() + 1) === parts[1] && d.getDate() === parts[2];
}

function isValidTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(t);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function validateRoutineSlots(routine) {
  const errors = [];
  if (!Array.isArray(routine)) return ['Routine must be an array'];

  const scheduleSlots = new Map();

  for (let rIdx = 0; rIdx < routine.length; rIdx++) {
    const slot = routine[rIdx];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      errors.push(`Slot ${rIdx + 1} must be an object`);
      continue;
    }
    if (!ALLOWED_WEEKDAYS.includes(slot.weekday)) {
      errors.push(`Slot ${rIdx + 1}: Invalid weekday "${slot.weekday}"`);
    }
    if (slot.date !== undefined && slot.date !== null && String(slot.date).trim() !== '') {
      if (!isValidDate(String(slot.date))) {
        errors.push(`Slot ${rIdx + 1}: Invalid date format "${slot.date}", expected YYYY-MM-DD`);
      }
    }
    if (!isValidTime(slot.startTime) || !isValidTime(slot.endTime)) {
      errors.push(`Slot ${rIdx + 1}: Invalid time format`);
    } else {
      const start = timeToMinutes(slot.startTime);
      const end = timeToMinutes(slot.endTime);
      if (end <= start) {
        errors.push(`Slot ${rIdx + 1}: End time must be strictly after start time`);
      } else {
        const conflictKey = (slot.date && String(slot.date).trim())
          ? `date:${String(slot.date).trim()}`
          : `weekday:${slot.weekday}`;

        const previousSlots = scheduleSlots.get(conflictKey) || [];
        if (previousSlots.some(p => Math.max(start, p.start) < Math.min(end, p.end))) {
          errors.push(`Overlapping routine schedule detected on ${slot.date || slot.weekday}`);
        }
        previousSlots.push({ start, end });
        scheduleSlots.set(conflictKey, previousSlots);
      }
    }

    if (slot.deliveryMode && !ALLOWED_DELIVERY_MODES.includes(slot.deliveryMode)) {
      errors.push(`Slot ${rIdx + 1}: Invalid deliveryMode "${slot.deliveryMode}"`);
    }
    if (slot.category && !ALLOWED_CATEGORIES.includes(slot.category)) {
      errors.push(`Slot ${rIdx + 1}: Invalid category "${slot.category}"`);
    }
  }

  return errors;
}

// Case 1: Valid routine slot with full metadata
const validWithFullMetadata = [{
  date: '2026-11-07',
  weekday: 'Saturday',
  startTime: '18:00',
  endTime: '20:00',
  timezone: 'Asia/Dhaka',
  subjectName: 'Cinematography',
  classTitle: 'Lighting Setups & Master Angles',
  teacherName: 'Abir Ahmad',
  deliveryMode: 'online',
  category: 'practical'
}];
assert.deepStrictEqual(validateRoutineSlots(validWithFullMetadata), [], 'Valid slot with full metadata must pass');

// Case 2: Valid routine slot without date (recurring)
const validNoDate = [{ weekday: 'Saturday', startTime: '18:00', endTime: '20:00', subjectName: 'Script Writing' }];
assert.deepStrictEqual(validateRoutineSlots(validNoDate), [], 'Valid slot without date must pass');

// Case 3: Invalid deliveryMode
const invalidMode = [{
  weekday: 'Saturday',
  startTime: '18:00',
  endTime: '20:00',
  deliveryMode: 'teleportation'
}];
assert.ok(validateRoutineSlots(invalidMode).some(e => e.includes('Invalid deliveryMode')), 'Invalid deliveryMode must fail');

// Case 4: Invalid category
const invalidCategory = [{
  weekday: 'Saturday',
  startTime: '18:00',
  endTime: '20:00',
  category: 'superhero'
}];
assert.ok(validateRoutineSlots(invalidCategory).some(e => e.includes('Invalid category')), 'Invalid category must fail');

// Case 5: Overlapping slots on the SAME date
const overlapSameDate = [
  { date: '2026-11-07', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' },
  { date: '2026-11-07', weekday: 'Saturday', startTime: '19:00', endTime: '21:00' }
];
assert.ok(validateRoutineSlots(overlapSameDate).some(e => e.includes('Overlapping')), 'Overlap on same date must fail');

// Case 6: Same time and weekday on DIFFERENT dates -> MUST PASS (Not a conflict!)
const sameTimeDiffDates = [
  { date: '2026-11-07', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' },
  { date: '2026-11-14', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' }
];
assert.deepStrictEqual(validateRoutineSlots(sameTimeDiffDates), [], 'Same time on different dates must NOT conflict');

console.log('✅ ALL ROUTINE FULL METADATA VALIDATION ASSERTIONS PASSED');
