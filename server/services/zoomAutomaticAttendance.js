import { dhakaNow, isSessionDate } from '../../src/utils/timetable.js';

export function configuredZoomAttendanceStart(env) {
  if (env.ZOOM_AUTO_ATTENDANCE_ENABLED !== 'true' || env.ZOOM_WEBHOOK_ENABLED !== 'true'
      || !env.ZOOM_WEBHOOK_SECRET || !env.ZOOM_ACCOUNT_ID || !isSessionDate(env.ZOOM_AUTO_ATTENDANCE_FROM)) return null;
  return env.ZOOM_AUTO_ATTENDANCE_FROM;
}

export function createZoomAutomaticAttendanceRunner(db, approve, startDate, onError) {
  const candidates = db.prepare(`SELECT v.rowid AS cursor, (
    SELECT MIN(r.id) FROM zoom_event_receipts r
    WHERE r.meeting_instance = c.meeting_instance AND r.meeting_id = c.meeting_id
      AND r.participant_id = v.participant_id AND r.status <> 'rejected'
      AND strftime('%Y-%m-%d', r.occurred_at, '+6 hours') = c.class_date
    ) AS receiptId
    FROM zoom_participant_verifications v JOIN zoom_class_bindings c ON c.meeting_instance = v.meeting_instance
    WHERE v.rowid > ? AND c.class_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM student_class_attendance a WHERE a.enrollment_id = v.enrollment_id AND a.class_id = v.class_id)
      AND NOT EXISTS (SELECT 1 FROM course_attendance_excuses e WHERE e.enrollment_id = v.enrollment_id AND e.class_id = v.class_id)
    ORDER BY v.rowid LIMIT 25`);
  let cursor = 0;
  return (now = new Date()) => {
    const rows = candidates.all(cursor, startDate, dhakaNow(now).date);
    for (const row of rows) {
      cursor = row.cursor;
      if (row.receiptId == null) continue;
      try {
        approve.automatic(row.receiptId, now.getTime());
      } catch (error) {
        onError(error);
      }
    }
    if (rows.length < 25) cursor = 0;
  };
}
