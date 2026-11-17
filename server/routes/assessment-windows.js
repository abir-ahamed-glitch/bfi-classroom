import express from 'express';
import db from '../db/database.js';
import { authenticateToken, hasPermission, isSuperAdmin } from '../middleware/auth.js';
import { getEnrollmentProgressSync, resolvePhaseRoutine } from '../services/courseProgressService.js';
import { assessmentTarget, assessmentAvailability, canonicalAssessmentPhase, dhakaToUtc, matchingAssessmentSession } from '../services/assessmentWindows.js';
import { recordAuditEventFromReq } from '../services/auditLedgerService.js';

const router = express.Router();
router.use(authenticateToken);
const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const canEdit = user => user.role === 'admin' && (isSuperAdmin(user) || hasPermission(user, 'batches:edit') || hasPermission(user, 'courses:edit'));

function batchContext(id) {
  const batch = db.prepare(`SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL AND (status IS NULL OR status <> 'archived')`).get(id);
  if (!batch?.course_definition_id) return null;
  const row = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
  if (!row) return null;
  return { batch, definition: JSON.parse(row.definition_json) };
}

function linkedSession(context, phaseId, slotId, date) {
  const phase = canonicalAssessmentPhase(context.definition, phaseId);
  if (!phase) return null;
  const result = resolvePhaseRoutine(db, context.batch.course_definition_id, context.batch.id, phaseId, phase.routine);
  return matchingAssessmentSession(result.routine, slotId, date, {startDate: context.batch.start_date, endDate: context.batch.end_date});
}

export function eligibleStudentAssessmentWindows(userId) {
  const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND batch_id IS NOT NULL AND course_definition_id IS NOT NULL').all(userId);
  const windows = [];
  for (const enrollment of enrollments) {
    if (enrollments.filter(item => item.batch_id === enrollment.batch_id && item.course_definition_id === enrollment.course_definition_id).length !== 1) continue;
    const context = batchContext(enrollment.batch_id);
    if (!context || context.batch.course_definition_id !== enrollment.course_definition_id) continue;
    const progress = getEnrollmentProgressSync(enrollment.id, db);
    for (const row of db.prepare('SELECT * FROM assessment_windows WHERE batch_id = ?').all(enrollment.batch_id)) {
      const target = assessmentTarget(context.definition, row.phase_id, row.assessment_type, row.assessment_id);
      const phase = progress?.phases?.find(item => item.id === row.phase_id);
      const availability = assessmentAvailability(row, phase);
      const session = row.assessment_type === 'exam' ? linkedSession(context, row.phase_id, row.routine_slot_id, row.session_date) : null;
      if (!target || availability === 'ineligible' || (row.assessment_type === 'exam' && (!session || session.startTime !== row.session_start || session.endTime !== row.session_end))) continue;
      windows.push({id: row.id, enrollmentId: enrollment.id, batchId: row.batch_id, phaseId: row.phase_id, type: row.assessment_type, assessmentId: row.assessment_id, title: target.title, opensAt: row.opens_at, closesAt: row.closes_at, availability});
    }
  }
  return windows;
}

router.post('/', (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({error: 'Batch editing permission required.'});
  const { batchId, phaseId, type, assessmentId, routineSlotId, sessionDate, opensAt, closesAt } = req.body ?? {};
  if (!positiveId(batchId) || typeof phaseId !== 'string' || typeof assessmentId !== 'string' || !['exam', 'assignment'].includes(type)) return res.status(400).json({error: 'Invalid assessment.'});
  const opens = dhakaToUtc(opensAt), closes = dhakaToUtc(closesAt);
  if (!opens || !closes || opens >= closes) return res.status(400).json({error: 'Enter a valid opening and later deadline in Bangladesh time.'});
  try {
    const context = batchContext(batchId);
    if (!context) return res.status(404).json({error: 'Defined course batch not found.'});
    if (!assessmentTarget(context.definition, phaseId, type, assessmentId)) return res.status(400).json({error: 'Assessment is missing or ambiguous in the course definition.'});
    const session = type === 'exam' ? linkedSession(context, phaseId, routineSlotId, sessionDate) : null;
    if (type === 'exam' && (!session || !opensAt.startsWith(sessionDate))) {
      return res.status(400).json({error: 'Select a scheduled class and open the exam on its date.'});
    }
    db.transaction(() => {
      db.prepare(`INSERT INTO assessment_windows (batch_id, phase_id, assessment_type, assessment_id, routine_slot_id, session_date, session_start, session_end, opens_at, closes_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(batch_id, phase_id, assessment_type, assessment_id)
        DO UPDATE SET routine_slot_id=excluded.routine_slot_id, session_date=excluded.session_date, session_start=excluded.session_start, session_end=excluded.session_end, opens_at=excluded.opens_at, closes_at=excluded.closes_at, updated_at=datetime('now')`)
        .run(Number(batchId), phaseId, type, assessmentId, type === 'exam' ? routineSlotId : null, type === 'exam' ? sessionDate : null, session?.startTime ?? null, session?.endTime ?? null, opens, closes, req.user.id);
      recordAuditEventFromReq(req, {action: 'assessment.window_update', module: 'courses', resource: `batch:${batchId}`, details: {phaseId, type, assessmentId, opens, closes}});
    })();
    res.json({ok: true});
  } catch (error) {
    console.error('Assessment window save failed:', error.message);
    res.status(500).json({error: 'Could not save the assessment window.'});
  }
});

router.get('/', (req, res) => {
  if (canEdit(req.user)) {
    if (!positiveId(req.query.batchId)) return res.status(400).json({error: 'A valid batch is required.'});
    try {
      const context = batchContext(req.query.batchId);
      if (!context) return res.status(404).json({error: 'Defined course batch not found.'});
      res.set('Cache-Control', 'private, no-store');
      const windows = db.prepare('SELECT * FROM assessment_windows WHERE batch_id = ?').all(req.query.batchId).map(row => {
        const target = assessmentTarget(context.definition, row.phase_id, row.assessment_type, row.assessment_id);
        const session = row.assessment_type === 'exam' && target ? linkedSession(context, row.phase_id, row.routine_slot_id, row.session_date) : null;
        const needsReview = !target || (row.assessment_type === 'exam' && (!session || session.startTime !== row.session_start || session.endTime !== row.session_end));
        return {...row, needsReview};
      });
      return res.json({windows});
    } catch (error) {
      console.error('Assessment window lookup failed:', error.message);
      return res.status(500).json({error: 'Could not load assessments.'});
    }
  }
  if (req.user.role !== 'student') return res.status(403).json({error: 'Student access required.'});
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json({windows: eligibleStudentAssessmentWindows(req.user.id).map(item => {
      const publicWindow = {...item};
      delete publicWindow.enrollmentId;
      return publicWindow;
    })});
  } catch (error) {
    console.error('Assessment window lookup failed:', error.message);
    res.status(500).json({error: 'Could not load assessments.'});
  }
});

export default router;
