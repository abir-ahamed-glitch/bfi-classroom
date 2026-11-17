import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineSessions, timelineFocus, selectedTimelineSession } from '../src/utils/classTimeline.js';

test('selected class is only identified when slot and date match uniquely', () => {
  const sessions = [{id:'a',date:'2026-11-16'}, {id:'a',date:'2026-11-23'}, {id:'b',date:'2026-11-16'}];
  assert.equal(selectedTimelineSession(sessions, 'a', '2026-11-16'), sessions[0]);
  assert.equal(selectedTimelineSession(sessions, 'missing', '2026-11-16'), null);
  assert.equal(selectedTimelineSession([sessions[0], sessions[0]], 'a', '2026-11-16'), null);
});

test('timeline combines dated and recurring classes with schedule changes', () => {
  const batch = { startDate: '2026-11-01', endDate: '2026-11-15' };
  const slots = [
    { id: 'weekly', weekday: 'Sunday', startTime: '19:00', endTime: '21:00', sessionChanges: [
      { originalDate: '2026-11-08', status: 'rescheduled', date: '2026-11-10', startTime: '18:00', endTime: '20:00' }
    ] },
    { id: 'dated', date: '2026-11-12', startTime: '19:00', endTime: '21:00' }
  ];
  const sessions = timelineSessions(slots, batch, '2026-11-10');
  assert.deepEqual(sessions.map(s => [s.date, s.status]), [
    ['2026-11-01', 'scheduled'], ['2026-11-08', 'rescheduled'],
    ['2026-11-10', 'moved'], ['2026-11-12', 'scheduled'], ['2026-11-15', 'scheduled']
  ]);
});

test('timeline avoids unlimited recurrence when batch dates are missing', () => {
  const sessions = timelineSessions([{ weekday: 'Sunday', startTime: '19:00', endTime: '21:00' }], {}, '2026-11-15');
  assert.ok(sessions.length > 0 && sessions.length < 20);
});

test('timeline focuses an active class or the next available session', () => {
  const sessions = [
    { date: '2026-11-14', endTime: '21:00', status: 'scheduled' },
    { date: '2026-11-15', endTime: '21:00', status: 'cancelled' },
    { date: '2026-11-15', endTime: '22:00', status: 'scheduled' },
    { date: '2026-11-17', endTime: '21:00', status: 'scheduled' }
  ];
  assert.equal(timelineFocus(sessions, '2026-11-15', '20:00'), 2);
  assert.equal(timelineFocus(sessions, '2026-11-16', '20:00'), 3);
});
