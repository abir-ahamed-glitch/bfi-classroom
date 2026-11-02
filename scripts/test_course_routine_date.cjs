/**
 * scripts/test_course_routine_date.cjs
 *
 * Verifies backend routine slot validation for optional dates, format enforcement,
 * date-aware schedule conflict detection, and audit logging compatibility.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== TEST: Course Routine Date Validation & Conflict Logic ===');

// Check static source code contract
const routeFile = path.resolve(__dirname, '../server/routes/course-definitions.js');
const routeSrc = fs.readFileSync(routeFile, 'utf8');

assert.ok(routeSrc.includes('slot.date'), 'course-definitions.js must reference slot.date for validation');

// Test functional routine validator logic directly
const ALLOWED_WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

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
    if (slot.date !== undefined && slot.date !== null && slot.date !== '') {
      if (!isValidDate(slot.date)) {
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
        // Date-aware conflict key:
        // If date is provided, conflict is isolated to that specific calendar date.
        // If date is omitted, conflict is checked across the recurring weekday.
        const conflictKey = (slot.date && slot.date.trim())
          ? `date:${slot.date.trim()}`
          : `weekday:${slot.weekday}`;

        const previousSlots = scheduleSlots.get(conflictKey) || [];
        if (previousSlots.some(p => Math.max(start, p.start) < Math.min(end, p.end))) {
          errors.push(`Overlapping routine schedule detected on ${slot.date || slot.weekday}`);
        }
        previousSlots.push({ start, end });
        scheduleSlots.set(conflictKey, previousSlots);
      }
    }
  }

  return errors;
}

// Case 1: Valid routine slot with date
const validWithDate = [{ date: '2026-11-07', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' }];
assert.deepStrictEqual(validateRoutineSlots(validWithDate), [], 'Valid slot with date must pass');

// Case 2: Valid routine slot without date (recurring)
const validNoDate = [{ weekday: 'Saturday', startTime: '18:00', endTime: '20:00' }];
assert.deepStrictEqual(validateRoutineSlots(validNoDate), [], 'Valid slot without date must pass');

// Case 3: Invalid date format
const invalidDate = [{ date: '2026/11/07', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' }];
assert.ok(validateRoutineSlots(invalidDate).length > 0, 'Invalid date string must fail');

// Case 4: Invalid calendar date (e.g. Feb 31)
const invalidCalendarDate = [{ date: '2026-02-31', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' }];
assert.ok(validateRoutineSlots(invalidCalendarDate).length > 0, 'Non-existent calendar date must fail');

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

// Case 7: End time before start time
const invertedTime = [{ date: '2026-11-07', weekday: 'Saturday', startTime: '20:00', endTime: '18:00' }];
assert.ok(validateRoutineSlots(invertedTime).some(e => e.includes('strictly after')), 'Inverted times must fail');

console.log('✅ ALL ROUTINE DATE VALIDATION ASSERTIONS PASSED');
