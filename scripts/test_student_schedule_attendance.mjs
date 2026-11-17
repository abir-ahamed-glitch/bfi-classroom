import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapAttendanceToSlots } from '../server/services/studentScheduleAttendance.js';

test('attendance maps only unambiguous dated course classes', () => {
  const slots = [
    { classId: 'a', date: '2026-11-10' },
    { classId: 'b', weekday: 'Saturday' },
    { classId: 'c', date: '2026-11-12' },
    { classId: 'c', date: '2026-11-13' }
  ];
  const classes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const result = mapAttendanceToSlots(slots, classes, [{ class_id: 'a', attended: 1 }, { class_id: 'b', attended: 0 }, { class_id: 'c', attended: 1 }]);
  assert.deepEqual(result, [{ attendance: 'present' }, {}, {}, {}]);
  assert.deepEqual(mapAttendanceToSlots([{ classId: 'a', date: '2026-11-10' }], classes, [{ class_id: 'a', attended: 0 }]), [{ attendance: 'absent' }]);
});
