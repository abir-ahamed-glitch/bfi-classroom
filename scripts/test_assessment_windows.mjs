import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentTarget, assessmentAvailability, dhakaToUtc, matchingAssessmentSession } from '../server/services/assessmentWindows.js';

const definition = { phases: [{ id: 'theory', exam: { enabled: true, title: 'Final' }, assignments: [{ id: 'essay', title: 'Essay' }] }] };

test('assessment identities must refer to one unambiguous defined phase and assessment', () => {
  assert.equal(assessmentTarget(definition, 'theory', 'exam', 'exam').title, 'Final');
  assert.equal(assessmentTarget(definition, 'theory', 'assignment', 'essay').title, 'Essay');
  assert.equal(assessmentTarget(definition, 'theory', 'exam', 'essay'), null);
  assert.equal(assessmentTarget({ phases: [definition.phases[0], definition.phases[0]] }, 'theory', 'exam', 'exam'), null);
  assert.equal(assessmentTarget({ phases: [{ ...definition.phases[0], assignments: [{id: 'essay'}, {id: 'essay'}] }] }, 'theory', 'assignment', 'essay'), null);
  assert.equal(assessmentTarget({ phases: [definition.phases[0], {id: 'practical', assignments: [{id: 'essay'}]}] }, 'theory', 'assignment', 'essay'), null, 'Assignment IDs are shared by grade records across phases');
  assert.equal(assessmentTarget({phases:[{phaseIndex: 1, exam:{enabled:true}}]}, 'phase_1', 'exam', 'exam').title, 'Phase exam');
  assert.equal(assessmentTarget({phases:[{id:'  theory  ', exam:{enabled:true}}]}, 'theory', 'exam', 'exam').title, 'Phase exam');
});

test('exam windows fail closed when their linked routine is missing, ambiguous, cancelled or moved', () => {
  const slot = { id: 'slot-1', date: '2026-11-15', weekday: 'Sunday', startTime: '19:00', endTime: '21:00' };
  assert.ok(matchingAssessmentSession([slot], 'slot-1', '2026-11-15', {}));
  assert.equal(matchingAssessmentSession([slot, slot], 'slot-1', '2026-11-15', {}), null);
  assert.equal(matchingAssessmentSession([], 'slot-1', '2026-11-15', {}), null);
  const changed = { ...slot, sessionChanges: [{originalDate: '2026-11-15', status: 'cancelled'}] };
  assert.equal(matchingAssessmentSession([changed], 'slot-1', '2026-11-15', {}), null);
  const moved = { ...slot, sessionChanges: [{originalDate: '2026-11-15', status: 'rescheduled', date: '2026-11-16', startTime: '19:00', endTime: '21:00'}] };
  assert.equal(matchingAssessmentSession([moved], 'slot-1', '2026-11-15', {}), null);
  assert.equal(matchingAssessmentSession([moved], 'slot-1', '2026-11-16', {}).status, 'moved');
});

test('Dhaka dates are validated and converted independently of host timezone', () => {
  assert.equal(dhakaToUtc('2026-11-15T19:00'), '2026-11-15T13:00:00.000Z');
  assert.equal(dhakaToUtc('2026-02-30T19:00'), null);
  assert.equal(dhakaToUtc('2026-11-15T25:00'), null);
});

test('availability requires admission and exam attendance and uses an inclusive opening and exclusive deadline', () => {
  const row = { opens_at: '2026-11-15T13:00:00.000Z', closes_at: '2026-11-15T14:00:00.000Z', assessment_type: 'exam' };
  const phase = { isAdmitted: true, isLocked: false, exam: {eligible: true} };
  assert.equal(assessmentAvailability(row, phase, Date.parse(row.opens_at)), 'open');
  assert.equal(assessmentAvailability(row, phase, Date.parse(row.closes_at)), 'closed');
  assert.equal(assessmentAvailability(row, {...phase, exam: {eligible: false}}, Date.parse(row.opens_at)), 'ineligible');
  assert.equal(assessmentAvailability(row, {...phase, isAdmitted: false}, Date.parse(row.opens_at)), 'ineligible');
});
