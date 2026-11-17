import { resolveVerifiedZoomParticipant } from './zoomIdentityMatch.js';
import { addDays } from '../../src/utils/timetable.js';
import { summarizeZoomAttendance } from './zoomAttendanceEvidence.js';
import { assessZoomAttendanceMinimum, validZoomAttendanceMinimum } from '../../src/utils/zoomAttendancePolicy.js';

function dayBounds(date) {
  return [date, addDays(date, 1)].map(day => new Date(`${day}T00:00:00+06:00`).toISOString());
}

export function isZoomEnrollmentEligible(db, enrollmentId, binding, loadProgress) {
  const enrollment = db.prepare(`SELECT e.id FROM student_course_enrollments e
    JOIN batches b ON b.id = e.batch_id AND b.course_definition_id = e.course_definition_id
    JOIN users u ON u.id = e.user_id
    WHERE e.id = ? AND b.id = ? AND u.role = 'student' AND u.is_active = 1`).get(enrollmentId, binding.batchId);
  if (!enrollment) return false;
  const phase = loadProgress(enrollmentId)?.phases?.find(item => item.id === binding.phaseId);
  return Boolean(phase?.isAdmitted && !phase.isLocked && phase.classes?.some(item => item.id === binding.classId));
}

export function createZoomParticipantStore(db, bindings, isEligible) {
  const receiptById = db.prepare(`SELECT meeting_instance AS meetingInstance, participant_id AS participantId
    FROM zoom_event_receipts WHERE id = ? AND status <> 'rejected'`);
  const byParticipant = db.prepare(`SELECT meeting_instance AS meetingInstance, participant_id AS participantId,
    enrollment_id AS enrollmentId, class_id AS classId, verified_by AS verifiedBy, verified_at AS verifiedAt,
    'operator_verified' AS verification
    FROM zoom_participant_verifications WHERE meeting_instance = ? AND participant_id = ?`);
  const byEnrollment = db.prepare(`SELECT 1 FROM zoom_participant_verifications WHERE meeting_instance = ? AND enrollment_id = ?`);
  const insert = db.prepare(`INSERT INTO zoom_participant_verifications
    (meeting_instance, participant_id, enrollment_id, class_id, verified_by) VALUES (?, ?, ?, ?, ?)`);
  const revokeHistory = db.prepare(`INSERT INTO zoom_participant_revocations
    (meeting_instance, participant_id, enrollment_id, class_id, verified_by, verified_at, revoked_by, reason)
    VALUES (@meetingInstance, @participantId, @enrollmentId, @classId, @verifiedBy, @verifiedAt, @actorId, @reason)`);
  const remove = db.prepare('DELETE FROM zoom_participant_verifications WHERE meeting_instance = ? AND participant_id = ?');
  const list = db.prepare(`SELECT MIN(r.id) AS id, r.participant_id AS participantId, MIN(r.occurred_at) AS firstEventAt,
    v.enrollment_id AS enrollmentId FROM zoom_event_receipts r
    LEFT JOIN zoom_participant_verifications v ON v.meeting_instance = r.meeting_instance AND v.participant_id = r.participant_id
    WHERE r.meeting_instance = ? AND r.meeting_id = ? AND r.occurred_at >= ? AND r.occurred_at < ? AND r.status <> 'rejected'
    GROUP BY r.participant_id ORDER BY id LIMIT 51 OFFSET ?`);
  const roster = db.prepare(`SELECT e.id, u.first_name AS firstName, u.last_name AS lastName, s.student_id AS studentId
    FROM student_course_enrollments e JOIN batches b ON b.id = e.batch_id AND b.course_definition_id = e.course_definition_id
    JOIN users u ON u.id = e.user_id LEFT JOIN student_profiles s ON s.user_id = u.id
    WHERE b.id = ? AND u.role = 'student' AND u.is_active = 1 ORDER BY u.first_name, u.last_name, e.id`);
  const participation = db.prepare(`SELECT participant_id AS participantId, occurred_at AS at,
      CASE event_type WHEN 'meeting.participant_joined' THEN 'join' ELSE 'leave' END AS type
    FROM zoom_event_receipts
    WHERE meeting_instance = ? AND meeting_id = ? AND participant_id = ?
      AND occurred_at >= ? AND occurred_at < ? AND status <> 'rejected'
      AND event_type IN ('meeting.participant_joined', 'meeting.participant_left')
    ORDER BY occurred_at, id LIMIT 2001`);

  function resolveIdentity(receipt, binding) {
    const mapping = byParticipant.get(receipt.meetingInstance, receipt.participantId);
    const identity = resolveVerifiedZoomParticipant(receipt, mapping ? [mapping] : []);
    return identity?.classId === binding.classId && isEligible(identity.enrollmentId, binding) ? identity : null;
  }

  const verify = db.transaction((receiptId, enrollmentId, actorId) => {
    const receipt = receiptById.get(receiptId);
    if (!receipt) return {status: 'missing'};
    const binding = bindings.resolve(receiptId);
    if (!binding) return {status: 'unbound'};
    if (!Number.isSafeInteger(actorId) || actorId < 1 || !Number.isSafeInteger(enrollmentId)
        || enrollmentId < 1 || !isEligible(enrollmentId, binding)) return {status: 'ineligible'};
    const existing = byParticipant.get(receipt.meetingInstance, receipt.participantId);
    if (existing) {
      return {status: existing.enrollmentId === enrollmentId && existing.classId === binding.classId ? 'existing' : 'conflict'};
    }
    if (byEnrollment.get(receipt.meetingInstance, enrollmentId)) return {status: 'conflict'};
    insert.run(receipt.meetingInstance, receipt.participantId, enrollmentId, binding.classId, actorId);
    return {status: 'created'};
  });

  const revoke = db.transaction((receiptId, expectedEnrollmentId, reason, actorId) => {
    if (!Number.isSafeInteger(actorId) || actorId < 1 || !Number.isSafeInteger(expectedEnrollmentId) || expectedEnrollmentId < 1
        || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 240) return {status: 'invalid'};
    const receipt = receiptById.get(receiptId);
    if (!receipt) return {status: 'missing'};
    const previous = byParticipant.get(receipt.meetingInstance, receipt.participantId);
    if (!previous || previous.enrollmentId !== expectedEnrollmentId) return {status: 'conflict'};
    revokeHistory.run({...previous, actorId, reason: reason.trim()});
    remove.run(receipt.meetingInstance, receipt.participantId);
    return {status: 'revoked'};
  });

  return {
    verify: (...args) => verify.immediate(...args),
    revoke: (...args) => revoke.immediate(...args),
    review(receiptId, offset = 0) {
      const binding = bindings.resolve(receiptId);
      if (!binding) return null;
      const participants = list.all(binding.meetingInstance, binding.meetingId, ...dayBounds(binding.date), offset);
      return {participants: participants.slice(0, 50), hasMore: participants.length > 50, enrollments: roster.all(binding.batchId)};
    },
    resolve(receiptId) {
      const receipt = receiptById.get(receiptId);
      const binding = receipt && bindings.resolve(receiptId);
      return binding ? resolveIdentity(receipt, binding) : null;
    },
    evidence(receiptId, {includeClassEnd = false} = {}) {
      const receipt = receiptById.get(receiptId);
      const occurrence = receipt && bindings.resolveOccurrence(receiptId);
      if (!occurrence || !resolveIdentity(receipt, occurrence.binding)) return null;
      const {binding, session: {startTime, endTime}} = occurrence;
      const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      if (![startTime, endTime].every(time => typeof time === 'string' && validTime.test(time)) || startTime >= endTime) return null;
      const start = `${binding.date}T${startTime}:00+06:00`, end = `${binding.date}T${endTime}:00+06:00`;
      const events = participation.all(binding.meetingInstance, binding.meetingId, receipt.participantId, ...dayBounds(binding.date));
      if (events.length === 0 || events.length > 2000) return null;
      if (!validZoomAttendanceMinimum(occurrence.zoomMinSessionPercent)) return null;
      const evidence = {...summarizeZoomAttendance(events, {start, end}), scheduledSeconds: (Date.parse(end) - Date.parse(start)) / 1000};
      const policy = assessZoomAttendanceMinimum(occurrence.zoomMinSessionPercent, evidence);
      if (policy) evidence.policy = policy;
      if (includeClassEnd) evidence.classEndMs = Date.parse(end);
      return evidence;
    }
  };
}
