import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import db from '../db/database.js';
import { authenticateToken, hasPermission } from '../middleware/auth.js';
import { isTeacherAssignedToBatch } from './teacher.js';
import { eligibleStudentAssessmentWindows } from './assessment-windows.js';
import { getEnrollmentProgressSync, updateDefinedProgressSync } from '../services/courseProgressService.js';
import { recordAuditEventFromReq } from '../services/auditLedgerService.js';
import { assessmentTarget } from '../services/assessmentWindows.js';

const router = express.Router();
router.use(authenticateToken);
const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 15 * 1024 * 1024, files: 1, fields: 2}});
const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

function mayRead(user, submission) {
  if (user.role === 'student') return submission.user_id === user.id;
  if (user.role === 'admin') return hasPermission(user, 'students:academic_records');
  if (user.role !== 'instructor') return false;
  const batch = db.prepare("SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL AND (status IS NULL OR status <> 'archived')").get(submission.batch_id);
  return Boolean(batch && isTeacherAssignedToBatch(db, user.id, batch, {allowLegacyCourseAssignment: false}));
}

async function validPdf(bytes) {
  if (bytes.length < 20 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return false;
  let task;
  try {
    task = getDocument({data: new Uint8Array(bytes), isEvalSupported: false, stopAtErrors: true, useSystemFonts: false});
    const doc = await task.promise;
    return doc.numPages > 0 && doc.numPages <= 100;
  } catch { return false; }
  finally { if (task) await task.destroy(); }
}

router.post('/:windowId', (req, res, next) => {
  if (req.user.role !== 'student' || !positiveId(req.params.windowId)) return res.status(404).json({error: 'Assessment not found.'});
  try {
    const window = eligibleStudentAssessmentWindows(req.user.id).find(item => item.id === Number(req.params.windowId));
    if (!window) return res.status(404).json({error: 'Assessment not found.'});
    if (window.availability !== 'open') return res.status(403).json({error: 'Submission is not open.'});
    next();
  } catch { res.status(500).json({error: 'Could not check assessment eligibility.'}); }
}, (req, res, next) => upload.single('file')(req, res, error => error ? res.status(400).json({error: 'Upload one PDF of at most 15 MB.'}) : next()), async (req, res) => {
  const requestKey = req.body?.requestKey;
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey) || !req.file || req.file.mimetype !== 'application/pdf' || !(await validPdf(req.file.buffer))) {
    return res.status(400).json({error: 'Upload a valid, unencrypted PDF of at most 100 pages and 15 MB.'});
  }
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  try {
    const result = db.transaction(() => {
      const window = eligibleStudentAssessmentWindows(req.user.id).find(item => item.id === Number(req.params.windowId));
      if (!window || window.availability !== 'open') return {status: 403, error: 'Submission is not open.'};
      const previous = db.prepare('SELECT id, sha256, version, submitted_at FROM assessment_submissions WHERE window_id = ? AND enrollment_id = ? AND request_key = ?').get(window.id, window.enrollmentId, requestKey);
      if (previous) return previous.sha256 === hash ? {status: 200, record: previous} : {status: 409, error: 'This request ID was used for a different file.'};
      const graded = db.prepare("SELECT 1 FROM assessment_submissions WHERE window_id = ? AND enrollment_id = ? AND status = 'graded'").get(window.id, window.enrollmentId);
      if (graded) return {status: 409, error: 'This assessment has already been graded.'};
      if (window.type === 'exam') {
        const phase = getEnrollmentProgressSync(window.enrollmentId, db)?.phases?.find(item => item.id === window.phaseId);
        if (!phase || phase.exam?.taken) return {status: 409, error: 'This exam has already been graded.'};
      }
      if (window.type === 'assignment') {
        const grade = db.prepare('SELECT marks_obtained, submission_status FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(window.enrollmentId, window.assessmentId);
        if (grade && (grade.marks_obtained != null || grade.submission_status === 'graded')) return {status: 409, error: 'This assignment has already been graded.'};
      }
      const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM assessment_submissions WHERE window_id = ? AND enrollment_id = ?').get(window.id, window.enrollmentId).version;
      const inserted = db.prepare('INSERT INTO assessment_submissions (window_id,enrollment_id,version,pdf_data,sha256,byte_size,request_key) VALUES (?,?,?,?,?,?,?)').run(window.id, window.enrollmentId, version, req.file.buffer, hash, req.file.size, requestKey);
      if (window.type === 'assignment') updateDefinedProgressSync(window.enrollmentId, {assignments: [{assignment_id: window.assessmentId, submission_status: 'submitted'}]}, db);
      recordAuditEventFromReq(req, {action: 'assessment.submitted', module: 'courses', resource: `assessment_submission:${inserted.lastInsertRowid}`, details: {batchId: window.batchId, type: window.type, version}});
      return {status: 201, record: db.prepare('SELECT id, version, submitted_at FROM assessment_submissions WHERE id = ?').get(inserted.lastInsertRowid)};
    }).immediate();
    if (result.error) return res.status(result.status).json({error: result.error});
    res.status(result.status).json(result.record);
  } catch (error) {
    console.error('Assessment submission failed:', error.message);
    res.status(500).json({error: 'Could not save the answer paper.'});
  }
});

router.get('/:windowId/history', (req, res) => {
  if (req.user.role !== 'student' || !positiveId(req.params.windowId)) return res.status(404).json({error: 'Assessment not found.'});
  const rows = db.prepare(`SELECT s.id, s.version, s.status, s.submitted_at, s.marks, s.remarks, s.graded_at
    FROM assessment_submissions s JOIN student_course_enrollments e ON e.id=s.enrollment_id
    WHERE s.window_id=? AND e.user_id=? ORDER BY s.version DESC`).all(req.params.windowId, req.user.id);
  if (!rows.length && !eligibleStudentAssessmentWindows(req.user.id).some(item => item.id === Number(req.params.windowId))) return res.status(404).json({error: 'Assessment not found.'});
  res.set('Cache-Control', 'private, no-store');
  res.json({submissions: rows});
});

router.get('/review', (req, res) => {
  if (!['admin', 'instructor'].includes(req.user.role)) return res.status(403).json({error: 'Reviewer access required.'});
  if (!positiveId(req.query.batchId)) return res.status(400).json({error: 'A valid batch is required.'});
  if (!mayRead(req.user, {batch_id: Number(req.query.batchId)})) return res.status(403).json({error: 'Reviewer access required for this batch.'});
  const submissions = db.prepare(`SELECT s.id,s.window_id,s.version,s.status,s.submitted_at,s.marks,s.remarks,s.graded_at,
      e.user_id,e.batch_id,trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS student_name,
      w.phase_id,w.assessment_type,w.assessment_id,
      (s.version = (SELECT MAX(s2.version) FROM assessment_submissions s2 WHERE s2.window_id=s.window_id AND s2.enrollment_id=s.enrollment_id)) AS is_latest
    FROM assessment_submissions s JOIN student_course_enrollments e ON e.id=s.enrollment_id
    JOIN users u ON u.id=e.user_id JOIN assessment_windows w ON w.id=s.window_id
    WHERE e.batch_id=? AND w.batch_id=e.batch_id ORDER BY s.submitted_at DESC,s.id DESC`).all(req.query.batchId);
  res.set('Cache-Control', 'private, no-store');
  res.json({submissions});
});

router.patch('/:id/grade', (req, res) => {
  if (!['admin', 'instructor'].includes(req.user.role)) return res.status(403).json({error: 'Reviewer access required.'});
  if (!positiveId(req.params.id) || typeof req.body?.marks !== 'number' || !Number.isFinite(req.body.marks)
    || (req.body.remarks != null && (typeof req.body.remarks !== 'string' || req.body.remarks.length > 2000))) return res.status(400).json({error: 'Enter valid marks and remarks.'});
  try {
    const result = db.transaction(() => {
      const row = db.prepare(`SELECT s.id,s.enrollment_id,s.window_id,s.version,s.status,e.user_id,e.batch_id,w.phase_id,w.assessment_type,w.assessment_id,c.definition_json
        FROM assessment_submissions s JOIN student_course_enrollments e ON e.id=s.enrollment_id JOIN assessment_windows w ON w.id=s.window_id
        JOIN batches b ON b.id=e.batch_id AND b.course_definition_id=e.course_definition_id
        JOIN course_definitions c ON c.id=e.course_definition_id
        WHERE s.id=? AND e.batch_id=w.batch_id`).get(req.params.id);
      if (!row || !mayRead(req.user, row)) return {status: 404, error: 'Submission not found.'};
      if (!assessmentTarget(JSON.parse(row.definition_json), row.phase_id, row.assessment_type, row.assessment_id)) return {status: 409, error: 'This assessment is no longer uniquely defined.'};
      const latest = db.prepare('SELECT MAX(version) AS version FROM assessment_submissions WHERE window_id=? AND enrollment_id=?').get(row.window_id,row.enrollment_id).version;
      if (row.version !== latest || row.status === 'graded') return {status: 409, error: 'Only the latest ungraded submission can be graded.'};
      const progress = getEnrollmentProgressSync(row.enrollment_id, db);
      const phase = progress?.phases?.find(item => item.id === row.phase_id);
      const assessment = row.assessment_type === 'exam' ? phase?.exam : phase?.assignments?.find(item => String(item.id) === row.assessment_id);
      const max = Number(assessment?.maxMarks);
      if (!assessment || !Number.isFinite(max) || req.body.marks < 0 || req.body.marks > max || !phase.isAdmitted || phase.isLocked || (row.assessment_type === 'exam' && !phase.exam.eligible)) return {status: 400, error: 'Marks exceed the assessment limit or the student is not eligible.'};
      if ((row.assessment_type === 'exam' && assessment.taken) || (row.assessment_type === 'assignment' && assessment.marksObtained != null)) return {status: 409, error: 'Marks already exist; use academic records to review them.'};
      const payload = row.assessment_type === 'exam'
        ? {exam_marks: [{phase_id: row.phase_id, marks: req.body.marks}], updatedBy: req.user.id}
        : {assignments: [{assignment_id: row.assessment_id, marks: req.body.marks, submission_status: 'graded', remarks: req.body.remarks || ''}], updatedBy: req.user.id};
      updateDefinedProgressSync(row.enrollment_id, payload, db);
      db.prepare("UPDATE assessment_submissions SET status='graded',marks=?,remarks=?,graded_by=?,graded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(req.body.marks, req.body.remarks || null, req.user.id, row.id);
      recordAuditEventFromReq(req, {action: 'assessment.graded', module: 'courses', resource: `assessment_submission:${row.id}`, details: {batchId: row.batch_id, phaseId: row.phase_id, marks: req.body.marks}});
      return {status: 200};
    }).immediate();
    return result.error ? res.status(result.status).json({error: result.error}) : res.json({ok: true});
  } catch (error) {
    console.error('Assessment grading failed:', error.message);
    return res.status(500).json({error: 'Could not save assessment marks.'});
  }
});

router.get('/files/:id', (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({error: 'Submission not found.'});
  const row = db.prepare(`SELECT s.id, e.user_id, e.batch_id FROM assessment_submissions s JOIN student_course_enrollments e ON e.id=s.enrollment_id WHERE s.id=?`).get(req.params.id);
  if (!row || !mayRead(req.user, row)) return res.status(404).json({error: 'Submission not found.'});
  const pdf = db.prepare('SELECT pdf_data FROM assessment_submissions WHERE id=?').get(row.id);
  if (!pdf) return res.status(404).json({error: 'File unavailable.'});
  res.set({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="answer-paper.pdf"'});
  res.send(pdf.pdf_data);
});

export default router;
