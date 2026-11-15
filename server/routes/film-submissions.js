import express from 'express';
import db from '../db/database.js';
import { isTeacherAssignedToBatch } from './teacher.js';
import { authenticateToken, hasPermission } from '../middleware/auth.js';
import { refreshCoursePhaseResults } from '../services/courseProgressService.js';
import { filmTargets, validateFilmUrl } from '../services/filmSubmissionService.js';
import { recordAuditEventFromReq } from '../services/auditLedgerService.js';

const router = express.Router();
router.use(authenticateToken);
const canReview = user => hasPermission(user, 'students:academic_records');
const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

function assignedFilmBatch(userId, batchId) {
  if (!batchId) return false;
  const batch = db.prepare("SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL AND status <> 'archived'").get(batchId);
  return isTeacherAssignedToBatch(db, userId, batch, { allowLegacyCourseAssignment: false });
}

function listFilmCourse(enrollment) {
  const submissions = db.prepare('SELECT * FROM film_submissions WHERE enrollment_id = ? ORDER BY id DESC').all(enrollment.id);
  const notes = db.prepare(`
    SELECT n.id, n.submission_id, n.video_seconds, n.note, n.created_at,
           trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS author_name
    FROM film_feedback_notes n
    JOIN film_submissions f ON f.id = n.submission_id
    LEFT JOIN users u ON u.id = n.author_id
    WHERE f.enrollment_id = ?
    ORDER BY n.video_seconds, n.id
  `).all(enrollment.id);
  const notesBySubmission = Map.groupBy(notes, note => note.submission_id);
  const phases = filmTargets(db, enrollment);
  const phaseIds = new Set(phases.map(phase => phase.id));
  for (const { phase_id } of submissions) {
    if (!phaseIds.has(phase_id)) {
      phases.push({ id: phase_id, title: 'Previous phase', historical: true });
      phaseIds.add(phase_id);
    }
  }
  return {
    enrollmentId: enrollment.id, courseName: enrollment.course_name, batchId: enrollment.batch_id,
    studentName: db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(enrollment.user_id),
    phases,
    submissions: submissions.map(submission => ({
      ...submission, timestamped_feedback: notesBySubmission.get(submission.id) ?? []
    }))
  };
}

router.get('/', (req, res) => {
  const { user } = req;
  const isInstructor = user.role === 'instructor';
  const canDecide = canReview(user);
  if (user.role !== 'student' && !isInstructor && !canDecide) return res.status(403).json({ error: 'Access denied.' });
  const batchId = req.query.batch_id;
  if (batchId !== undefined && (typeof batchId !== 'string' || !positiveId(batchId))) return res.status(400).json({ error: 'Invalid batch.' });
  res.set('Cache-Control', 'private, no-store');

  let enrollments;
  if (user.role === 'student') {
    enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(user.id);
  } else if (isInstructor) {
    if (batchId && !assignedFilmBatch(user.id, batchId)) return res.status(404).json({ error: 'Batch not found.' });
    const submitted = db.prepare(`
      SELECT e.* FROM student_course_enrollments e
      WHERE (? IS NULL OR e.batch_id = ?)
        AND EXISTS (SELECT 1 FROM film_submissions f WHERE f.enrollment_id = e.id)
    `).all(batchId ?? null, batchId ?? null);
    const batchIds = new Set(submitted.map(enrollment => enrollment.batch_id));
    const allowed = new Set([...batchIds].filter(id => assignedFilmBatch(user.id, id)));
    enrollments = submitted.filter(enrollment => allowed.has(enrollment.batch_id));
  } else if (batchId) {
    enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE batch_id = ?').all(batchId);
  } else {
    enrollments = db.prepare('SELECT e.* FROM student_course_enrollments e WHERE EXISTS (SELECT 1 FROM film_submissions f WHERE f.enrollment_id = e.id)').all();
  }

  const courses = enrollments.map(listFilmCourse).filter(course => course.phases.length || course.submissions.length);
  res.json({ courses, canReview: canDecide, canLeaveFeedback: canDecide || isInstructor });
});

const saveFilmFeedback = db.transaction((user, submissionId, videoSeconds, note) => {
  const submission = db.prepare(`
    SELECT f.id, e.batch_id
    FROM film_submissions f
    JOIN student_course_enrollments e ON e.id = f.enrollment_id
    WHERE f.id = ?
  `).get(submissionId);
  if (!submission || (!canReview(user) && !assignedFilmBatch(user.id, submission.batch_id))) return null;

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO film_feedback_notes (submission_id, author_id, video_seconds, note)
    VALUES (?, ?, ?, ?)
  `).run(submission.id, user.id, videoSeconds, note);
  return db.prepare(`
    SELECT n.id, n.submission_id, n.video_seconds, n.note, n.created_at,
           trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS author_name
    FROM film_feedback_notes n JOIN users u ON u.id = n.author_id
    WHERE n.id = ?
  `).get(lastInsertRowid);
});

router.post('/:id/feedback', (req, res) => {
  if (req.user.role !== 'instructor' && !canReview(req.user)) return res.status(403).json({ error: 'Reviewer access required.' });
  const { videoSeconds, note } = req.body ?? {};
  if (!positiveId(req.params.id) || !Number.isInteger(videoSeconds) || videoSeconds < 0 || videoSeconds > 359999
      || typeof note !== 'string' || !note.trim() || note.trim().length > 2000) {
    return res.status(400).json({ error: 'Enter a valid video time and a note of up to 2,000 characters.' });
  }
  try {
    const saved = saveFilmFeedback.immediate(req.user, req.params.id, videoSeconds, note.trim());
    if (!saved) return res.status(404).json({ error: 'Submission not found.' });
    res.status(201).json(saved);
  } catch (error) {
    console.error('Film feedback failed:', error.message);
    res.status(500).json({ error: 'Could not save the feedback note.' });
  }
});

router.post('/', (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can submit films.' });
  const { enrollmentId, phaseId, title, videoUrl, notes = '' } = req.body;
  if (!positiveId(enrollmentId) || typeof phaseId !== 'string' || typeof title !== 'string' || !title.trim() || title.length > 160 || typeof notes !== 'string' || notes.length > 2000 || typeof videoUrl !== 'string' || videoUrl.length > 2048) return res.status(400).json({ error: 'Check the course, title and notes.' });
  const url = validateFilmUrl(videoUrl);
  if (!url) return res.status(400).json({ error: 'Enter a valid HTTPS YouTube or Vimeo video link.' });
  const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(enrollmentId, req.user.id);
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' });
  const phase = filmTargets(db, enrollment).find(item => item.id === phaseId);
  if (!phase?.eligible) return res.status(403).json({ error: phase?.blockedReason || 'You must be admitted to this phase before submitting.' });
  const result = db.transaction(() => {
    const previous = db.prepare('SELECT revision, status FROM film_submissions WHERE enrollment_id = ? AND phase_id = ? ORDER BY revision DESC LIMIT 1').get(enrollmentId, phaseId);
    if (previous && previous.status !== 'changes_requested') return null;
    const id = db.prepare('INSERT INTO film_submissions (enrollment_id, phase_id, revision, title, video_url, notes) VALUES (?, ?, ?, ?, ?, ?)').run(enrollmentId, phaseId, (previous?.revision || 0) + 1, title.trim(), url, notes.trim()).lastInsertRowid;
    return db.prepare('SELECT * FROM film_submissions WHERE id = ?').get(id);
  })();
  if (!result) return res.status(409).json({ error: 'Your current film is under review or already accepted.' });
  req.app.get('io')?.emit('progression_updated', { studentId: req.user.id });
  res.status(201).json(result);
});

router.patch('/:id/review', (req, res) => {
  if (!canReview(req.user)) return res.status(403).json({ error: 'Academic records permission required.' });
  const { status, feedback = '' } = req.body;
  if (!positiveId(req.params.id) || !['accepted', 'changes_requested'].includes(status) || typeof feedback !== 'string' || feedback.length > 2000 || (status === 'changes_requested' && !feedback.trim())) return res.status(400).json({ error: 'Choose a review outcome and provide feedback when requesting changes.' });
  const submission = db.prepare('SELECT f.*, e.user_id FROM film_submissions f JOIN student_course_enrollments e ON e.id = f.enrollment_id WHERE f.id = ?').get(req.params.id);
  if (!submission) return res.status(404).json({ error: 'Submission not found.' });
  try {
    const changed = db.transaction(() => {
      if (status === 'accepted' && submission.status === 'under_review') {
        const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ?').get(submission.enrollment_id);
        const phase = filmTargets(db, enrollment).find(item => item.id === submission.phase_id);
        if (phase?.ordered && !phase.eligible) {
          throw Object.assign(new Error(phase.blockedReason), { status: 409 });
        }
      }
      const result = db.prepare("UPDATE film_submissions SET status = ?, feedback = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'under_review'").run(status, feedback.trim(), req.user.id, submission.id);
      if (!result.changes) return false;
      if (status === 'accepted') refreshCoursePhaseResults(submission.enrollment_id, db);
      recordAuditEventFromReq(req, { action: 'academic.film_review', module: 'academic', targetUserId: submission.user_id, resource: `film:${submission.id}`, details: { enrollmentId: submission.enrollment_id, phaseId: submission.phase_id, status }, beforeState: { status: submission.status }, afterState: { status, feedback: feedback.trim() } });
      return true;
    })();
    if (!changed) return res.status(409).json({ error: 'This submission has already been reviewed. Refresh the page.' });
    req.app.get('io')?.emit('progression_updated', { studentId: submission.user_id });
    res.json({ success: true });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message });
    console.error('Film review failed:', error.message);
    res.status(500).json({ error: 'Could not save review.' });
  }
});

export default router;
