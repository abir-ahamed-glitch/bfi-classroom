// Matching is only a preliminary safety gate; callers must independently verify
// authorization, enrollment and class membership before any attendance writes.
export function resolveVerifiedZoomParticipant(event, mappings) {
  if (!event || typeof event.meetingInstance !== 'string' || !event.meetingInstance || typeof event.participantId !== 'string' || !event.participantId || !Array.isArray(mappings)) return null;
  const matches = mappings.filter(mapping => mapping?.meetingInstance === event.meetingInstance && mapping?.participantId === event.participantId);
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (match.verification !== 'operator_verified' || !Number.isSafeInteger(match.enrollmentId) || match.enrollmentId < 1 || typeof match.classId !== 'string' || !match.classId.trim()) return null;
  return {enrollmentId:match.enrollmentId, classId:match.classId};
}
