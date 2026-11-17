import { getTimedSessions, isSessionDate } from '../../src/utils/timetable.js';
import { parseZoomMeetingUrl } from './zoomMeetingAuth.js';

// Use only server-loaded bindings and the current effective batch schedule.
// A match identifies a class occurrence. It does not identify a student.
export function resolveZoomClassOccurrence(event, bindings, schedule) {
  if (typeof event?.meetingId !== 'string' || !/^\d{9,11}$/.test(event.meetingId)
      || typeof event.meetingInstance !== 'string' || !event.meetingInstance.trim()
      || !Array.isArray(bindings) || !Array.isArray(schedule?.slots) || !Array.isArray(schedule.classes)) return null;

  const matches = bindings.filter(binding => binding?.meetingInstance === event.meetingInstance);
  if (matches.length !== 1) return null;
  const binding = matches[0];
  if (binding.meetingId !== event.meetingId || !Number.isSafeInteger(binding.batchId) || binding.batchId < 1
      || binding.batchId !== schedule.batchId || binding.phaseId !== schedule.phaseId
      || ![binding.phaseId, binding.slotId, binding.classId].every(value => typeof value === 'string' && value.trim())
      || !isSessionDate(binding.date)) return null;

  const sameOccurrence = bindings.filter(candidate => candidate?.batchId === binding.batchId
    && candidate.phaseId === binding.phaseId && candidate.slotId === binding.slotId && candidate.date === binding.date);
  if (sameOccurrence.length !== 1 || schedule.classes.filter(item => item?.id === binding.classId).length !== 1) return null;

  const slots = schedule.slots.filter(slot => slot?.id != null && String(slot.id) === binding.slotId);
  if (slots.length !== 1 || slots[0].classId !== binding.classId) return null;
  const sessions = getTimedSessions(slots, [binding.date], schedule.bounds);
  if (sessions.length !== 1 || sessions[0].status !== 'scheduled'
      || parseZoomMeetingUrl(sessions[0].meetingUrl)?.meetingNumber !== binding.meetingId) return null;
  return {binding, session: sessions[0], zoomMinSessionPercent: schedule.zoomMinSessionPercent};
}

export function resolveZoomClassBinding(event, bindings, schedule) {
  return resolveZoomClassOccurrence(event, bindings, schedule)?.binding ?? null;
}
