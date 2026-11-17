import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveZoomClassBinding } from '../server/services/zoomClassBinding.js';

const event = {meetingId: '123456789', meetingInstance: 'instance-a'};
const binding = {...event, batchId: 30, phaseId: 'phase-2', classId: 'editing', slotId: 'slot-4', date: '2026-11-16'};
const slot = {id: 'slot-4', classId: 'editing', date: binding.date, startTime: '19:00', endTime: '21:00', meetingUrl: 'https://zoom.us/j/123456789'};
const schedule = {batchId: 30, phaseId: 'phase-2', slots: [slot], classes: [{id: 'editing'}]};

test('resolves only the exact meeting instance and current Course Maker occurrence', () => {
  assert.deepEqual(resolveZoomClassBinding(event, [binding], schedule), binding);
  assert.equal(resolveZoomClassBinding({...event, meetingInstance: 'instance-b'}, [binding], schedule), null);
  assert.equal(resolveZoomClassBinding(event, [binding, {...binding, batchId: 31}], schedule), null);
  assert.equal(resolveZoomClassBinding(event, [binding], {...schedule, batchId: 31}), null);
  assert.equal(resolveZoomClassBinding(event, [binding], {...schedule, slots: [slot, slot]}), null);
  assert.equal(resolveZoomClassBinding(event, [binding], {...schedule, classes: [{id: 'shooting'}]}), null);
  assert.equal(resolveZoomClassBinding(event, [binding], {...schedule, slots: [{...slot, meetingUrl: 'https://zoom.us/j/987654321'}]}), null);
  const otherInstance = {...binding, meetingInstance: 'instance-c'};
  assert.equal(resolveZoomClassBinding(event, [binding, otherInstance], schedule), null);
});

test('scheduled occurrences are rejected after cancellation or rescheduling', () => {
  for (const status of ['cancelled', 'rescheduled']) {
    const currentSlot = {...slot, sessionChanges: [{status, originalDate: binding.date, date: '2026-11-17'}]};
    assert.equal(resolveZoomClassBinding(event, [binding], {...schedule, slots: [currentSlot]}), null);
  }
});
