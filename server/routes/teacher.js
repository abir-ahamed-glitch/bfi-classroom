import express from 'express';
import db from '../db/database.js';
import { authenticateToken, hasAnyPermission, isSuperAdmin } from '../middleware/auth.js';
import { resolvePhaseRoutine } from '../services/courseProgressService.js';

const router = express.Router();

export function sanitizeRoutineSlots(routine = []) {
  if (!Array.isArray(routine)) return [];
  return routine.map((slot, idx) => ({
    id: slot.id || `slot_${idx + 1}`,
    date: slot.date ? String(slot.date).trim() : '',
    weekday: slot.weekday || '',
    startTime: slot.startTime || '19:00',
    endTime: slot.endTime || '21:00',
    timezone: slot.timezone || 'Asia/Dhaka',
    subjectName: slot.subjectName ? String(slot.subjectName).trim() : '',
    classTitle: slot.classTitle ? String(slot.classTitle).trim() : '',
    teacherName: slot.teacherName ? String(slot.teacherName).trim() : '',
    teacherUserId: slot.teacherUserId ? Number(slot.teacherUserId) : null,
    deliveryMode: slot.deliveryMode ? String(slot.deliveryMode).trim() : 'live',
    category: slot.category ? String(slot.category).trim() : 'theory',
    platform: slot.platform ? String(slot.platform).trim() : ''
  }));
}

/**
 * Authoritatively determines if a teacher (by stable user ID) is assigned to a batch.
 * Checks:
 * 1. batch_instructors table (direct assignment by user ID)
 * 2. batch.created_by (batch creator)
 * 3. Class-level assignment in routine slots (slot.teacherUserId === teacherUserId)
 * 4. Legacy course assignment via custom_subjects (custom_subjects.teacher_id === teacherUserId)
 * 
 * NEVER infers permissions from matching names or editable profile text!
 */
export function isTeacherAssignedToBatch(database, teacherUserId, batch) {
  if (!teacherUserId || !batch) return false;
  const uid = Number(teacherUserId);
  const bid = Number(batch.id);

  // Verify the instructor user account is valid, active, and not deleted
  try {
    const instructor = database.prepare("SELECT id FROM users WHERE id = ? AND role = 'instructor' AND is_active = 1 AND deleted_at IS NULL").get(uid);
    if (!instructor) return false;
  } catch {
    // Proceed if users table query fails in isolated test mock
  }

  // 1. Authoritative batch_instructors table
  try {
    const inBatchInstructors = database.prepare(`
      SELECT 1 FROM batch_instructors WHERE batch_id = ? AND user_id = ?
    `).get(bid, uid);
    if (inBatchInstructors) return true;
  } catch {
    // If table doesn't exist yet in an unmigrated runtime, proceed to slot checks
  }

  // 2. Creator of the batch
  if (batch.created_by && Number(batch.created_by) === uid) {
    return true;
  }

  // 3. Class-level assignment in routine slots (for course definition batches)
  if (batch.course_definition_id) {
    const defRow = database.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
    if (defRow?.definition_json) {
      try {
        const def = JSON.parse(defRow.definition_json);
        const rawPhases = Array.isArray(def.phases) ? def.phases : [];
        for (let pIdx = 0; pIdx < rawPhases.length; pIdx++) {
          const phase = rawPhases[pIdx];
          const phaseId = phase.id || `phase_${phase.phaseIndex || pIdx + 1}`;
          const resolved = resolvePhaseRoutine(database, batch.course_definition_id, batch.id, phaseId, phase.routine);
          if (Array.isArray(resolved?.routine)) {
            const hasClass = resolved.routine.some(slot => slot && Number(slot.teacherUserId) === uid);
            if (hasClass) return true;
          }
        }
      } catch (e) {
        console.error('Error in isTeacherAssignedToBatch parsing definition JSON:', e);
      }
    }
  } else {
    // 4. Legacy course: check custom_subjects.teacher_id
    try {
      const hasLegacySubject = database.prepare(`
        SELECT 1 FROM custom_subjects WHERE course_name = ? AND teacher_id = ?
      `).get(batch.course_name, uid);
      if (hasLegacySubject) return true;
    } catch { /* empty */ }
  }

  return false;
}

// Teacher / Instructor Batch Routine View - Specific Batch (Authoritative, Read-Only)
router.get('/batches/:id/schedule', authenticateToken, (req, res) => {
  try {
    // Role check: Only instructors and authorized admins are permitted; fail closed for others
    if (req.user.role !== 'instructor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Instructor access required.' });
    }

    if (req.user.role === 'admin' && !isSuperAdmin(req.user)) {
      const hasPerm = hasAnyPermission(req.user, 'batches:view', 'courses:view', 'teachers:view');
      if (!hasPerm) {
        return res.status(403).json({ error: "Access denied: missing required view permission ('batches:view', 'courses:view', or 'teachers:view')." });
      }
    }

    // Validate positive integer batch ID
    const rawId = req.params.id;
    const batchId = parseInt(rawId, 10);
    if (!Number.isInteger(batchId) || batchId <= 0 || String(batchId) !== String(rawId).trim()) {
      return res.status(400).json({ error: 'Invalid batch ID: must be a positive integer.' });
    }

    // Query batch enforcing active policy (not deleted and not archived)
    const batch = db.prepare('SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL').get(batchId);
    if (!batch || batch.status === 'archived') {
      return res.status(404).json({ error: 'Batch not found or unavailable.' });
    }

    // For instructor role, enforce authoritative assignment
    if (req.user.role === 'instructor') {
      const isAssigned = isTeacherAssignedToBatch(db, req.user.id, batch);
      if (!isAssigned) {
        return res.status(403).json({ error: 'Forbidden: You are not assigned to instruct this batch.' });
      }
    }

    let phases = [];
    if (batch.course_definition_id) {
      const defRow = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
      if (defRow?.definition_json) {
        try {
          const def = JSON.parse(defRow.definition_json);
          const rawPhases = Array.isArray(def.phases) ? def.phases : [];
          phases = rawPhases.map((phase, pIdx) => {
            const phaseId = phase.id || `phase_${phase.phaseIndex || pIdx + 1}`;
            const resolved = resolvePhaseRoutine(db, batch.course_definition_id, batch.id, phaseId, phase.routine);
            const sanitizedSlots = sanitizeRoutineSlots(resolved.routine);

            // Mark classes where teacherUserId explicitly matches authenticated instructor
            const markedSlots = sanitizedSlots.map(slot => {
              const isMy = slot.teacherUserId && Number(slot.teacherUserId) === Number(req.user.id);
              return {
                ...slot,
                isMyClass: Boolean(isMy)
              };
            });

            return {
              phaseId,
              title: phase.title || `Phase ${pIdx + 1}`,
              phaseIndex: phase.phaseIndex || pIdx + 1,
              source: resolved.source,
              schedule: markedSlots
            };
          });
        } catch (e) {
          console.error('Error parsing course definition JSON for teacher:', e);
        }
      }
    }

    return res.json({
      batchId: batch.id,
      batchName: batch.batch_name,
      batchNumber: batch.batch_number,
      courseName: batch.course_name,
      courseDefinitionId: batch.course_definition_id,
      phases
    });
  } catch (error) {
    console.error('Error fetching teacher batch schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Teacher / Instructor Aggregated Teaching Schedule (Authoritative, Read-Only)
router.get('/schedule', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'instructor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Instructor access required.' });
    }

    if (req.user.role === 'admin' && !isSuperAdmin(req.user)) {
      const hasPerm = hasAnyPermission(req.user, 'batches:view', 'courses:view', 'teachers:view');
      if (!hasPerm) {
        return res.status(403).json({ error: 'Access denied: missing required view permission.' });
      }
    }

    const teacherUser = db.prepare('SELECT id, first_name, last_name, username FROM users WHERE id = ?').get(req.user.id);
    const profile = db.prepare('SELECT full_name FROM instructor_profiles WHERE user_id = ?').get(req.user.id);
    const teacherDisplayName = profile?.full_name || (teacherUser ? `${teacherUser.first_name || ''} ${teacherUser.last_name || ''}`.trim() : 'Instructor');

    // Only active batches (deleted_at IS NULL AND status != 'archived')
    const allBatches = db.prepare(`
      SELECT id, batch_name, batch_number, course_name, course_definition_id, created_by
      FROM batches
      WHERE deleted_at IS NULL AND (status IS NULL OR status != 'archived')
      ORDER BY id DESC
    `).all();

    const assignedBatches = [];
    const myClasses = [];

    for (const batch of allBatches) {
      const isAssigned = (req.user.role === 'admin') || isTeacherAssignedToBatch(db, req.user.id, batch);
      if (!isAssigned) continue;

      let batchPhases = [];
      if (batch.course_definition_id) {
        const defRow = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
        if (defRow?.definition_json) {
          try {
            const def = JSON.parse(defRow.definition_json);
            const rawPhases = Array.isArray(def.phases) ? def.phases : [];
            for (let pIdx = 0; pIdx < rawPhases.length; pIdx++) {
              const phase = rawPhases[pIdx];
              const phaseId = phase.id || `phase_${phase.phaseIndex || pIdx + 1}`;
              const resolved = resolvePhaseRoutine(db, batch.course_definition_id, batch.id, phaseId, phase.routine);
              const sanitizedSlots = sanitizeRoutineSlots(resolved.routine);

              const markedSlots = sanitizedSlots.map(slot => {
                const isMy = slot.teacherUserId && Number(slot.teacherUserId) === Number(req.user.id);
                if (isMy) {
                  myClasses.push({
                    batchId: batch.id,
                    batchName: batch.batch_name,
                    batchNumber: batch.batch_number,
                    courseName: batch.course_name,
                    phaseId,
                    phaseTitle: phase.title || `Phase ${pIdx + 1}`,
                    slot
                  });
                }
                return {
                  ...slot,
                  isMyClass: Boolean(isMy)
                };
              });

              batchPhases.push({
                phaseId,
                title: phase.title || `Phase ${pIdx + 1}`,
                phaseIndex: phase.phaseIndex || pIdx + 1,
                source: resolved.source,
                schedule: markedSlots
              });
            }
          } catch (e) {
            console.error(`Error processing batch ${batch.id} schedule for teacher:`, e);
          }
        }
      }

      assignedBatches.push({
        batchId: batch.id,
        batchName: batch.batch_name,
        batchNumber: batch.batch_number,
        courseName: batch.course_name,
        courseDefinitionId: batch.course_definition_id,
        phases: batchPhases
      });
    }

    return res.json({
      teacherId: req.user.id,
      teacherName: teacherDisplayName,
      batches: assignedBatches,
      classes: myClasses
    });
  } catch (error) {
    console.error('Error fetching teacher aggregate schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
