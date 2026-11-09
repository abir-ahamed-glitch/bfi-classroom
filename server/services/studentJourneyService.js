import { getEnrollmentProgressSync } from './courseProgressService.js';

function recordedDate(value, localTime = false) {
  if (!value) return null;
  const text = String(value).trim();
  const zoned = /(?:Z|[+-]\d\d:\d\d)$/.test(text)
    ? text : text.replace(' ', 'T') + (localTime ? '+06:00' : 'Z');
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getStudentJourney(db, userId) {
  const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? ORDER BY created_at, id').all(userId);
  return {
    courses: enrollments.map(enrollment => {
      const progress = getEnrollmentProgressSync(enrollment.id, db);
      const events = [];
      const upcoming = [];
      const add = (key, type, title, date = null, localTime = false) => {
        events.push({ id: `${enrollment.id}:${key}`, type, title, occurredAt: recordedDate(date, localTime) });
      };
      add('enrolled', 'enrolled', 'Enrolled', enrollment.created_at);

      if (progress && !progress.isLegacy) {
        const attendance = db.prepare('SELECT class_id, attended_at FROM student_class_attendance WHERE enrollment_id = ? AND attended = 1').all(enrollment.id);
        for (const phase of progress.phases) {
          const label = `Phase ${phase.phaseNumber} · ${phase.title || 'Learning phase'}`;
          const classIds = new Set(phase.classes.map(cls => cls.id));
          const dates = attendance.filter(row => classIds.has(row.class_id)).map(row => recordedDate(row.attended_at, true)).filter(Boolean).sort();
          if (phase.isAdmitted) {
            // Admission records are not evidence of the first class actually starting.
            add(`${phase.id}:admitted`, 'phase_admitted', `${label} admitted`, phase.admittedAt, true);
            if (dates.length) add(`${phase.id}:attendance`, 'attendance', `${label} · Class attendance recorded`, dates[0]);
          } else {
            upcoming.push({ id: `${phase.id}:start`, title: `${label} · Awaiting admission` });
          }
          if (phase.exam.enabled && phase.exam.taken && phase.exam.isPassed) {
            add(`${phase.id}:exam`, 'exam_passed', `${label} · Exam passed`);
          } else if (phase.exam.enabled) {
            upcoming.push({ id: `${phase.id}:exam`, title: `${label} · Pass exam` });
          }
          for (const assignment of phase.assignments) {
            if (['submitted', 'graded', 'returned'].includes(assignment.submissionStatus)) {
              // graded_at records assessment time, not the student's original submission time.
              add(`${phase.id}:${assignment.id}:submission`, 'assignment_submitted', `${assignment.title || 'Assignment'} submitted`);
            } else {
              upcoming.push({ id: `${phase.id}:${assignment.id}:submission`, title: `${label} · ${assignment.title || 'Assignment'} not submitted` });
            }
          }
          if (phase.isPassed) add(`${phase.id}:passed`, 'phase_completed', `${label} completed`);
        }
      } else {
        if (enrollment.step1_completed === 1) add('phase1', 'phase_started', 'Phase 1 started');
        if (enrollment.step2_completed === 1) add('exam', 'exam_passed', 'Phase 1 passed');
        if (enrollment.course_name === 'Online Filmmaking Course') {
          if (enrollment.step3_completed === 1) add('phase2', 'phase_started', 'Phase 2 started');
          else upcoming.push({ id: 'phase2', title: 'Phase 2 · Awaiting admission' });
          if (enrollment.phase2_shooting_attended === 1) add('shooting', 'attendance', 'Shooting session attended');
          if (enrollment.phase2_editing_attended === 1) add('editing', 'attendance', 'Editing session attended');
          if (enrollment.step4_completed === 1) add('complete', 'phase_completed', 'Phase 2 completed');
        }
      }

      const downloads = db.prepare(`
        SELECT MIN(downloaded_at) AS first_download FROM certificate_downloads
        WHERE user_id = ? AND enrollment_id = ?
      `).get(userId, enrollment.id);
      if (downloads.first_download) {
        add('certificate', 'certificate_downloaded', 'Certificate downloaded', downloads.first_download);
      } else {
        upcoming.push({ id: 'certificate', title: progress?.certificateEligible ? 'Certificate available · Open Certificates' : 'Certificate · Complete course requirements' });
      }
      // Undated historical achievements stay visible without fabricating a chronology.
      events.sort((a, b) => {
        if (!a.occurredAt && !b.occurredAt) return 0;
        if (!a.occurredAt) return 1;
        if (!b.occurredAt) return -1;
        return a.occurredAt.localeCompare(b.occurredAt);
      });
      return {
        enrollmentId: enrollment.id,
        courseName: enrollment.course_name,
        batchId: progress?.batchId || enrollment.batch_id || null,
        events,
        upcoming
      };
    })
  };
}
