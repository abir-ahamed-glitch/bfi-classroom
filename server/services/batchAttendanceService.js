import { getCanonicalPhaseInfo, getEnrollmentProgressSync, resolvePhaseRoutine, updateDefinedProgressSync } from './courseProgressService.js';

const legacyCourse = 'Online Filmmaking Course';
const legacyColumns = [
  { id: 'shooting', title: 'Shooting', category: 'shooting', date: null },
  { id: 'editing', title: 'Editing', category: 'editing', date: null }
];

export class AttendanceSheetError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getColumns(classes, routine) {
  const normalize = value => String(value || '').trim().toLowerCase();
  return classes.filter(cls => cls.id != null && cls.id !== '').map(cls => {
    const title = normalize(cls.title);
    const titleIsUnique = title && classes.filter(item => normalize(item.title) === title).length === 1;
    const slots = routine.filter(slot => slot.classId != null
      ? String(slot.classId) === String(cls.id)
      : titleIsUnique && normalize(slot.classTitle) === title);
    const dates = [...new Set(slots.map(slot => slot.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')))];
    return { id: String(cls.id), title: cls.title, category: cls.category || '', date: dates.length === 1 ? dates[0] : null };
  });
}

export function getBatchAttendanceSheet(db, batchId, phaseNumber) {
  const batch = db.prepare('SELECT * FROM batches WHERE (CAST(id AS TEXT) = ? OR slug = ?) AND deleted_at IS NULL').get(String(batchId), String(batchId));
  if (!batch) throw new AttendanceSheetError(404, 'Batch not found.');

  const isLegacy = !batch.course_definition_id;
  let phase = null;
  let columns = legacyColumns;
  if (isLegacy) {
    if (batch.course_name !== legacyCourse || phaseNumber !== 2) {
      throw new AttendanceSheetError(404, 'This batch does not have an attendance sheet for that phase.');
    }
  } else {
    const definition = db.prepare("SELECT definition_json FROM course_definitions WHERE id = ? AND status = 'published'").get(batch.course_definition_id);
    const { mappedPhases } = getCanonicalPhaseInfo(definition ? JSON.parse(definition.definition_json).phases : []);
    const matches = mappedPhases.filter(item => item.phaseNumber === phaseNumber);
    if (matches.length !== 1) throw new AttendanceSheetError(404, 'Course phase not found.');
    [phase] = matches;
    const { routine } = resolvePhaseRoutine(db, batch.course_definition_id, batch.id, phase.canonicalId, phase.phase.routine);
    columns = getColumns(phase.phase.classes || [], routine || []);
  }

  // Unlinked historical enrollments are safe only when this is the student's sole matching batch.
  const enrollments = db.prepare(`
    SELECT e.*, u.first_name, u.last_name, p.student_id AS student_code
    FROM batch_students bs
    JOIN users u ON u.id = bs.student_id AND u.deleted_at IS NULL
    JOIN student_course_enrollments e ON e.user_id = u.id
      AND e.course_definition_id IS @definition
      AND (@definition IS NOT NULL OR e.course_name = @course)
    LEFT JOIN student_profiles p ON p.user_id = u.id
    WHERE bs.batch_id = @batch AND (e.batch_id = @batch OR (
      e.batch_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM batch_students other
        JOIN batches b ON b.id = other.batch_id
        WHERE other.student_id = u.id AND b.id <> @batch
          AND b.course_definition_id IS @definition AND (@definition IS NOT NULL OR b.course_name = @course)
      ) AND NOT EXISTS (
        SELECT 1 FROM student_course_enrollments direct
        WHERE direct.user_id = u.id AND direct.batch_id = @batch
          AND direct.course_definition_id IS @definition AND (@definition IS NOT NULL OR direct.course_name = @course)
      )
    ))
    ORDER BY u.first_name COLLATE NOCASE, u.last_name COLLATE NOCASE, u.id
  `).all({ batch: batch.id, definition: batch.course_definition_id, course: batch.course_name });

  const counts = new Map();
  for (const enrollment of enrollments) counts.set(enrollment.user_id, (counts.get(enrollment.user_id) || 0) + 1);
  const getMarks = db.prepare('SELECT class_id, attended FROM student_class_attendance WHERE enrollment_id = ?');
  const classIds = new Set(columns.map(column => column.id));
  const rows = enrollments.map(enrollment => {
    const progress = isLegacy ? null : getEnrollmentProgressSync(enrollment.id, db, { batchId: batch.id });
    const current = progress?.phases.find(item => item.id === phase.canonicalId);
    let reason = counts.get(enrollment.user_id) > 1 ? 'Multiple enrollments need review.' : null;
    if (!reason) {
      if (current?.isLocked) reason = current.lockReason || 'Phase is locked.';
      else if (isLegacy ? enrollment.step3_completed !== 1 : !current?.isAdmitted) reason = 'Student is not admitted to this phase.';
    }
    const marks = isLegacy
      ? { shooting: enrollment.phase2_shooting_attended === 1, editing: enrollment.phase2_editing_attended === 1 }
      : Object.fromEntries(getMarks.all(enrollment.id).filter(mark => classIds.has(mark.class_id))
        .map(mark => [mark.class_id, mark.attended === 1]));
    return {
      enrollmentId: enrollment.id,
      studentId: enrollment.user_id,
      name: [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ') || `Student #${enrollment.user_id}`,
      studentCode: enrollment.student_code,
      editable: !reason,
      reason,
      marks
    };
  });

  return { batchId: batch.id, phaseNumber, phaseTitle: phase?.phase.title || `Phase ${phaseNumber}`, isLegacy, columns, rows };
}

export function saveBatchAttendanceSheet(db, batchId, phaseNumber, changes, updatedBy, onAudit) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 10000) {
    throw new AttendanceSheetError(400, 'Send between 1 and 10,000 attendance changes.');
  }

  return db.transaction(() => {
    const sheet = getBatchAttendanceSheet(db, batchId, phaseNumber);
    const rows = new Map(sheet.rows.map(row => [row.enrollmentId, row]));
    const classIds = new Set(sheet.columns.map(column => column.id));
    const groups = new Map();
    for (const change of changes) {
      const row = rows.get(change?.enrollmentId);
      if (!row?.editable || !classIds.has(change?.classId) || typeof change.attended !== 'boolean') {
        throw new AttendanceSheetError(400, 'An attendance change is invalid or the student is no longer eligible. Reopen the sheet and try again.');
      }
      if (!groups.has(row.enrollmentId)) groups.set(row.enrollmentId, new Map());
      const marks = groups.get(row.enrollmentId);
      if (marks.has(change.classId)) throw new AttendanceSheetError(400, 'Duplicate attendance change.');
      marks.set(change.classId, change.attended);
    }

    const studentIds = [];
    for (const [enrollmentId, marks] of groups) {
      const row = rows.get(enrollmentId);
      const edits = [...marks].filter(([id, value]) => !Object.hasOwn(row.marks, id) || row.marks[id] !== value);
      if (!edits.length) continue;

      if (sheet.isLegacy) {
        const shooting = marks.get('shooting') ?? row.marks.shooting;
        const editing = marks.get('editing') ?? row.marks.editing;
        db.prepare(`
          UPDATE student_course_enrollments
          SET phase2_shooting_attended = ?, phase2_editing_attended = ?, step4_completed = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(Number(shooting), Number(editing), Number(shooting && editing), enrollmentId);
      } else {
        updateDefinedProgressSync(enrollmentId, {
          updatedBy,
          attendance: edits.map(([class_id, attended]) => ({ class_id, attended }))
        }, db, { batchId: sheet.batchId });
      }
      onAudit(row, Object.fromEntries(edits.map(([id]) => [id, Object.hasOwn(row.marks, id) ? row.marks[id] : null])), Object.fromEntries(edits));
      studentIds.push(row.studentId);
    }
    return studentIds;
  }).immediate();
}
