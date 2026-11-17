export function createZoomAttendanceApproval(db, participants, writeAttendance) {
  const existingAttendance = db.prepare('SELECT 1 FROM student_class_attendance WHERE enrollment_id = ? AND class_id = ?');
  const existingExcuse = db.prepare('SELECT 1 FROM course_attendance_excuses WHERE enrollment_id = ? AND class_id = ?');

  const approve = db.transaction((receiptId, expected, nowMs) => {
    const automatic = expected === null;
    const identity = participants.resolve(receiptId);
    const evidence = identity && participants.evidence(receiptId, {includeClassEnd: automatic});
    if (!evidence || evidence.incomplete || evidence.seconds <= 0) return 'unusable';
    if (automatic && (!Number.isFinite(nowMs) || !Number.isFinite(evidence.classEndMs)
        || nowMs < evidence.classEndMs || !evidence.policy)) return 'not-ready';
    if (!automatic && (identity.enrollmentId !== expected.enrollmentId || evidence.seconds !== expected.seconds
        || evidence.scheduledSeconds !== expected.scheduledSeconds
        || (evidence.policy?.minimumPercent ?? null) !== (expected.minimumPercent ?? null))) return 'changed';
    if (evidence.policy?.meetsMinimum === false) return 'below-minimum';
    if (existingAttendance.get(identity.enrollmentId, identity.classId)
        || existingExcuse.get(identity.enrollmentId, identity.classId)) return 'existing';
    writeAttendance(identity, evidence, receiptId);
    return 'created';
  });

  const approveReviewed = (receiptId, expected) => approve.immediate(receiptId, expected);
  approveReviewed.automatic = (receiptId, nowMs) => approve.immediate(receiptId, null, nowMs);
  return approveReviewed;
}
