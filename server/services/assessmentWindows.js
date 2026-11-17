import { getTimedSessions, isSessionDate } from '../../src/utils/timetable.js';

// Course progress identifies unnamed phases by their declared index or position.
export function canonicalAssessmentPhase(definition, phaseId) {
  if (!Array.isArray(definition?.phases) || typeof phaseId !== 'string') return null;
  const matches = definition.phases.filter((phase, index) => {
    if (!phase || typeof phase !== 'object') return false;
    const explicit = phase.id ? String(phase.id).trim() : '';
    const phaseIndex = phase.phaseIndex != null && Number.isFinite(Number(phase.phaseIndex)) ? Number(phase.phaseIndex) : index + 1;
    return (explicit || `phase_${phaseIndex}`) === phaseId;
  });
  return matches.length === 1 ? matches[0] : null;
}

// Assessment identity is resolved against the course definition, never supplied titles.
export function assessmentTarget(definition, phaseId, type, assessmentId) {
  if (!Array.isArray(definition?.phases) || typeof phaseId !== 'string' || typeof assessmentId !== 'string') return null;
  const phase = canonicalAssessmentPhase(definition, phaseId);
  if (!phase) return null;
  if (type === 'exam' && assessmentId === 'exam' && phase.exam?.enabled) return { title: phase.exam.title || 'Phase exam' };
  if (type !== 'assignment' || !Array.isArray(phase.assignments)) return null;
  const matches = phase.assignments.filter(item => item.id != null && String(item.id) === assessmentId);
  const allMatches = definition.phases.flatMap(item => Array.isArray(item.assignments) ? item.assignments : []).filter(item => item.id != null && String(item.id) === assessmentId);
  return matches.length === 1 && allMatches.length === 1 ? { title: matches[0].title || matches[0].name || 'Assignment' } : null;
}

export function dhakaToUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value + ':00+06:00');
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const roundtrip = new Date(parsed + 6 * 3600000).toISOString().slice(0, 16);
  return roundtrip === value ? date.toISOString() : null;
}

export function assessmentAvailability(window, phase, now = Date.now()) {
  if (!phase?.isAdmitted || phase.isLocked || (window.assessment_type === 'exam' && phase.exam?.eligible !== true)) return 'ineligible';
  const opens = Date.parse(window.opens_at), closes = Date.parse(window.closes_at);
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens >= closes) return 'ineligible';
  if (now < opens) return 'upcoming';
  return now < closes ? 'open' : 'closed';
}

export function matchingAssessmentSession(slots, slotId, date, bounds) {
  if (!Array.isArray(slots) || typeof slotId !== 'string' || !isSessionDate(date)) return null;
  const matching = slots.filter(slot => slot.id != null && String(slot.id) === slotId);
  if (matching.length !== 1) return null;
  const sessions = getTimedSessions(matching, [date], bounds).filter(item => item.date === date && ['scheduled', 'moved'].includes(item.status));
  return sessions.length === 1 ? sessions[0] : null;
}
