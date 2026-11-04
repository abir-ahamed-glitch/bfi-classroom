import express from 'express';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { resolvePhaseRoutine } from '../services/courseProgressService.js';

const router = express.Router();

function sanitizeRoutineSlots(routine = []) {
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
    deliveryMode: slot.deliveryMode ? String(slot.deliveryMode).trim() : 'live',
    category: slot.category ? String(slot.category).trim() : 'theory',
    platform: slot.platform ? String(slot.platform).trim() : ''
  }));
}

function getInstructorIdentities(userId) {
  const profile = db.prepare('SELECT * FROM instructor_profiles WHERE user_id = ?').get(userId);
  const user = db.prepare('SELECT first_name, last_name, username FROM users WHERE id = ?').get(userId);
  
  const names = [];
  if (profile?.full_name) names.push(profile.full_name.trim().toLowerCase());
  if (user) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase();
    if (fullName) names.push(fullName);
    if (user.username) names.push(user.username.trim().toLowerCase());
  }

  return {
    profile,
    user,
    names: Array.from(new Set(names)),
    bfiBatch: profile?.bfi_batch ? String(profile.bfi_batch).trim() : null
  };
}

// Teacher / Instructor Batch Routine View - Specific Batch (Authoritative, Read-Only)
router.get('/batches/:id/schedule', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'instructor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Instructor access required.' });
    }

    const batchId = Number(req.params.id);
    if (!batchId || isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found.' });
    }

    const { names, bfiBatch } = getInstructorIdentities(req.user.id);

    let phases = [];
    let isTeacherAssigned = req.user.role === 'admin'; // Admins have broad viewing access

    if (!batch.course_definition_id && bfiBatch && (bfiBatch === String(batch.id) || bfiBatch === String(batch.batch_number))) {
      isTeacherAssigned = true;
    } else if (bfiBatch && bfiBatch === String(batch.id)) {
      isTeacherAssigned = true;
    }

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

            const markedSlots = sanitizedSlots.map(slot => {
              const isMy = slot.teacherName && names.includes(slot.teacherName.toLowerCase());
              if (isMy) isTeacherAssigned = true;
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

    if (!isTeacherAssigned && req.user.role === 'instructor') {
      return res.status(403).json({ error: 'Forbidden: You are not assigned to this batch.' });
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

    const { profile, user, names, bfiBatch } = getInstructorIdentities(req.user.id);
    const teacherDisplayName = profile?.full_name || (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Instructor');

    const allBatches = db.prepare(`
      SELECT id, batch_name, batch_number, course_name, course_definition_id
      FROM batches
      WHERE course_definition_id IS NOT NULL
      ORDER BY id DESC
    `).all();

    const assignedBatches = [];
    const myClasses = [];

    for (const batch of allBatches) {
      const defRow = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
      if (!defRow?.definition_json) continue;

      try {
        const def = JSON.parse(defRow.definition_json);
        const rawPhases = Array.isArray(def.phases) ? def.phases : [];
        let batchHasMyClasses = req.user.role === 'admin';

        if (!batch.course_definition_id && bfiBatch && (bfiBatch === String(batch.id) || bfiBatch === String(batch.batch_number))) {
          batchHasMyClasses = true;
        } else if (bfiBatch && bfiBatch === String(batch.id)) {
          batchHasMyClasses = true;
        }

        const batchPhases = [];

        for (let pIdx = 0; pIdx < rawPhases.length; pIdx++) {
          const phase = rawPhases[pIdx];
          const phaseId = phase.id || `phase_${phase.phaseIndex || pIdx + 1}`;
          const resolved = resolvePhaseRoutine(db, batch.course_definition_id, batch.id, phaseId, phase.routine);
          const sanitizedSlots = sanitizeRoutineSlots(resolved.routine);

          const markedSlots = sanitizedSlots.map(slot => {
            const isMy = slot.teacherName && names.includes(slot.teacherName.toLowerCase());
            if (isMy) {
              batchHasMyClasses = true;
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

        if (batchHasMyClasses) {
          assignedBatches.push({
            batchId: batch.id,
            batchName: batch.batch_name,
            batchNumber: batch.batch_number,
            courseName: batch.course_name,
            courseDefinitionId: batch.course_definition_id,
            phases: batchPhases
          });
        }
      } catch (e) {
        console.error(`Error processing batch ${batch.id} schedule for teacher:`, e);
      }
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
