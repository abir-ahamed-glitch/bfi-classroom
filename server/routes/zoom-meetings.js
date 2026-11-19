import express from 'express';
import db from '../db/database.js';
import { authenticateToken, hasAnyPermission, isSuperAdmin } from '../middleware/auth.js';
import { getCanonicalPhaseInfo, getEnrollmentProgressSync, resolvePhaseRoutine } from '../services/courseProgressService.js';
import { getTimedSessions, isSessionDate } from '../../src/utils/timetable.js';
import { createParticipantToken, parseZoomMeetingUrl } from '../services/zoomMeetingAuth.js';

const router = express.Router();
router.use(authenticateToken);

router.post('/join', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const {batchId, phaseId, slotId, date} = req.body || {};
  const isStudent = req.user.role === 'student';
  const isAdmin = req.user.role === 'admin';
  if ((!isStudent && !isAdmin) || !Number.isSafeInteger(Number(batchId)) || Number(batchId) < 1 || typeof phaseId !== 'string' || typeof slotId !== 'string' || !isSessionDate(date)) return res.status(404).json({error: 'Class not found.'});
  if (isAdmin && !isSuperAdmin(req.user) && !hasAnyPermission(req.user, 'batches:view', 'courses:view')) return res.status(403).json({error: 'Access denied.'});
  try {
    const batch = db.prepare("SELECT * FROM batches WHERE id=? AND deleted_at IS NULL AND (status IS NULL OR status <> 'archived')").get(batchId);
    if (!batch?.course_definition_id) return res.status(404).json({error: 'Class not found.'});
    const definition = db.prepare('SELECT definition_json FROM course_definitions WHERE id=?').get(batch.course_definition_id);
    if (!definition) return res.status(404).json({error: 'Class not found.'});
    const phases = JSON.parse(definition.definition_json).phases;
    const {matched, isAmbiguous} = getCanonicalPhaseInfo(phases, phaseId);
    if (!matched || isAmbiguous || matched.canonicalId !== phaseId) return res.status(404).json({error: 'Class not found.'});
    if (isStudent) {
      const enrollments = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id=? AND batch_id=? AND course_definition_id=?').all(req.user.id, batch.id, batch.course_definition_id);
      if (enrollments.length !== 1) return res.status(404).json({error: 'Class not found.'});
      const phase = getEnrollmentProgressSync(enrollments[0].id, db)?.phases?.find(item => item.id === phaseId);
      if (!phase?.isAdmitted || phase.isLocked) return res.status(404).json({error: 'Class not found.'});
    }
    const routine = resolvePhaseRoutine(db, batch.course_definition_id, batch.id, phaseId, matched.phase.routine).routine || [];
    const slots = routine.filter(slot => slot.id != null && String(slot.id) === slotId);
    if (slots.length !== 1) return res.status(404).json({error: 'Class not found.'});
    const sessions = getTimedSessions(slots, [date], {startDate: batch.start_date, endDate: batch.end_date}).filter(session => session.date === date && ['scheduled', 'moved'].includes(session.status));
    if (sessions.length !== 1) return res.status(404).json({error: 'Class not found.'});
    const meeting = parseZoomMeetingUrl(sessions[0].meetingUrl);
    if (!meeting) return res.status(404).json({error: 'Zoom meeting is not configured for this class.'});
    if (!process.env.ZOOM_CLIENT_ID || !process.env.ZOOM_CLIENT_SECRET) return res.status(503).json({error: 'Zoom integration is not configured.'});
    const signature = createParticipantToken({clientId: process.env.ZOOM_CLIENT_ID, clientSecret: process.env.ZOOM_CLIENT_SECRET, meetingNumber: meeting.meetingNumber});
    return res.json({...meeting, signature});
  } catch (error) {
    console.error('Zoom join authorization failed:', error.message);
    return res.status(500).json({error: 'Could not authorize this class.'});
  }
});

export default router;
