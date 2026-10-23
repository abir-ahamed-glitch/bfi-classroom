import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { resolvePhaseRoutine } from '../services/courseProgressService.js';

const router = express.Router();

const ALLOWED_WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALLOWED_DELIVERY_MODES = ['live', 'recorded', 'recorded_plus_live_discussion'];
const ALLOWED_CATEGORIES = ['theory', 'shooting', 'editing', 'practical', 'other'];
const ALLOWED_EXAM_TYPES = ['written', 'practical', 'viva', 'mcq', 'hybrid'];
const ALLOWED_COURSE_TYPES = [
  'workshop',
  'filmmaking',
  'appreciation',
  'certificate',
  'diploma',
  'masterclass',
  'short_course'
];

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function isValidTime(timeStr) {
  if (typeof timeStr !== 'string') return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr.trim());
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.trim().split(':').map(Number);
  return h * 60 + m;
}

function validateCourseDefinitionPayload(data, isPublishing = false) {
  const errors = [];

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length < 2 || name.length > 100) {
    errors.push('Course name must be between 2 and 100 characters.');
  }

  if (data.course_type && !ALLOWED_COURSE_TYPES.includes(data.course_type)) {
    errors.push(`Invalid course type "${data.course_type}". Must be one of: ${ALLOWED_COURSE_TYPES.join(', ')}.`);
  }

  const phaseCount = parseInt(data.phase_count, 10);
  if (isNaN(phaseCount) || phaseCount < 1 || phaseCount > 5) {
    errors.push('phase_count must be between 1 and 5.');
  }

  const phases = Array.isArray(data.phases) ? data.phases : [];
  if (isPublishing && phases.length !== phaseCount) {
    errors.push(`Expected exactly ${phaseCount} phase(s), but received ${phases.length}.`);
  }

  // Duplicate ID & index tracking
  const seenPhaseIds = new Set();
  const seenPhaseIndexes = new Set();
  const seenClassIds = new Set();
  const seenAssignmentIds = new Set();

  phases.forEach((phase, idx) => {
    const phaseNum = idx + 1;
    const phaseId = String(phase.id || `phase_${phaseNum}`).trim();

    // Check duplicate Phase ID
    if (seenPhaseIds.has(phaseId)) {
      errors.push(`Duplicate phase id "${phaseId}" detected.`);
    }
    seenPhaseIds.add(phaseId);

    const phaseIndex = phase.phaseIndex !== undefined ? Number(phase.phaseIndex) : phaseNum;
    if (seenPhaseIndexes.has(phaseIndex)) {
      errors.push(`Duplicate phaseIndex ${phaseIndex} detected.`);
    }
    seenPhaseIndexes.add(phaseIndex);

    const phaseTitle = (phase.title || phase.name || '').trim();
    if (isPublishing && !phaseTitle) {
      errors.push(`Phase ${phaseNum} must have a title.`);
    }

    if (phase.requirements?.attendanceRequired) {
      const minAtt = Number(phase.requirements.minAttendancePercent);
      if (isNaN(minAtt) || minAtt < 1 || minAtt > 100) {
        errors.push(`Phase ${phaseNum}: Minimum attendance percentage must be between 1 and 100.`);
      }
    }

    // Schedule / Routine validation
    if (Array.isArray(phase.routine)) {
      const daySlots = new Map();
      phase.routine.forEach((slot, rIdx) => {
        if (!ALLOWED_WEEKDAYS.includes(slot.weekday)) {
          errors.push(`Phase ${phaseNum}, Routine slot ${rIdx + 1}: Invalid weekday "${slot.weekday}".`);
        }
        if (!isValidTime(slot.startTime) || !isValidTime(slot.endTime)) {
          errors.push(`Phase ${phaseNum}, Routine slot ${rIdx + 1}: Times must be valid 24-hour HH:MM format.`);
        } else {
          const startM = timeToMinutes(slot.startTime);
          const endM = timeToMinutes(slot.endTime);
          if (endM <= startM) {
            errors.push(`Phase ${phaseNum}, Routine slot ${rIdx + 1}: End time (${slot.endTime}) must be strictly after start time (${slot.startTime}).`);
          } else {
            const slotsForDay = daySlots.get(slot.weekday) || [];
            for (const prev of slotsForDay) {
              if (Math.max(startM, prev.start) < Math.min(endM, prev.end)) {
                errors.push(`Phase ${phaseNum}: Overlapping routine schedule detected on ${slot.weekday} (${slot.startTime}-${slot.endTime} overlaps with ${prev.startTime}-${prev.endTime}).`);
                break;
              }
            }
            slotsForDay.push({ start: startM, end: endM, startTime: slot.startTime, endTime: slot.endTime });
            daySlots.set(slot.weekday, slotsForDay);
          }
        }
      });
    }

    // Classes validation
    if (Array.isArray(phase.classes)) {
      if (isPublishing && phase.classes.length === 0) {
        errors.push(`Phase ${phaseNum} must have at least one class before publishing.`);
      }

      if (isPublishing && phase.classCount && Number(phase.classCount) !== phase.classes.length) {
        errors.push(`Phase ${phaseNum}: Configured classCount (${phase.classCount}) does not match number of classes defined (${phase.classes.length}).`);
      }

      phase.classes.forEach((cls, cIdx) => {
        const classId = String(cls.id || `cls_${phaseNum}_${cIdx + 1}`).trim();
        if (seenClassIds.has(classId)) {
          errors.push(`Phase ${phaseNum}: Duplicate class id "${classId}" detected.`);
        }
        seenClassIds.add(classId);

        if (isPublishing && (!cls.title || !cls.title.trim())) {
          errors.push(`Phase ${phaseNum}, Class ${cIdx + 1} must have a title.`);
        }

        if (cls.deliveryMode && !ALLOWED_DELIVERY_MODES.includes(cls.deliveryMode)) {
          errors.push(`Phase ${phaseNum}, Class ${cIdx + 1}: Invalid deliveryMode "${cls.deliveryMode}".`);
        }

        if (cls.category && !ALLOWED_CATEGORIES.includes(cls.category)) {
          errors.push(`Phase ${phaseNum}, Class ${cIdx + 1}: Invalid category "${cls.category}".`);
        }

        if (cls.durationMinutes !== undefined) {
          const dur = Number(cls.durationMinutes);
          if (isNaN(dur) || dur < 15 || dur > 600) {
            errors.push(`Phase ${phaseNum}, Class ${cIdx + 1}: durationMinutes must be between 15 and 600.`);
          }
        }
      });
    }

    // Check assignments
    let assignmentMaxTotal = 0;
    if (Array.isArray(phase.assignments)) {
      phase.assignments.forEach((asg, aIdx) => {
        const asgId = String(asg.id || `asg_${phaseNum}_${aIdx + 1}`).trim();
        if (seenAssignmentIds.has(asgId)) {
          errors.push(`Phase ${phaseNum}: Duplicate assignment id "${asgId}" detected.`);
        }
        seenAssignmentIds.add(asgId);

        if (isPublishing && (!asg.title || !asg.title.trim())) {
          errors.push(`Phase ${phaseNum}, Assignment ${aIdx + 1} must have a title.`);
        }

        if (asg.subject !== undefined && asg.subject !== null && typeof asg.subject !== 'string') {
          errors.push(`Phase ${phaseNum}, Assignment ${aIdx + 1}: Subject must be a string.`);
        }

        const maxM = Number(asg.maxMarks);
        const passM = Number(asg.passMarks);
        if (isNaN(maxM) || maxM <= 0) {
          errors.push(`Phase ${phaseNum}, Assignment ${aIdx + 1}: Max marks must be greater than 0.`);
        } else {
          assignmentMaxTotal += maxM;
        }
        if (isNaN(passM) || passM < 0) {
          errors.push(`Phase ${phaseNum}, Assignment ${aIdx + 1}: Pass marks must be non-negative.`);
        } else if (!isNaN(maxM) && passM > maxM) {
          errors.push(`Phase ${phaseNum}, Assignment ${aIdx + 1}: Pass mark (${passM}) cannot exceed maximum mark (${maxM}).`);
        }
      });
    }

    // Check exam
    if (phase.exam?.enabled) {
      const examMax = Number(phase.exam.maxMarks);
      const examPass = Number(phase.exam.passMarks);
      if (isNaN(examMax) || examMax <= 0) {
        errors.push(`Phase ${phaseNum}: Exam maximum marks must be greater than 0.`);
      }
      if (isNaN(examPass) || examPass < 0) {
        errors.push(`Phase ${phaseNum}: Exam pass marks must be a valid number.`);
      } else if (examPass > examMax) {
        errors.push(`Phase ${phaseNum}: Exam pass mark (${examPass}) cannot exceed maximum mark (${examMax}).`);
      }

      if (phase.exam.type && !ALLOWED_EXAM_TYPES.includes(phase.exam.type)) {
        errors.push(`Phase ${phaseNum}: Invalid exam type "${phase.exam.type}".`);
      }

      if (phase.exam.phasePassThreshold !== undefined && phase.exam.phasePassThreshold !== null && phase.exam.phasePassThreshold !== '') {
        const threshold = Number(phase.exam.phasePassThreshold);
        const includeAsg = phase.exam.includeAssignmentsInTotal !== false;
        const totalPossible = examMax + (includeAsg ? assignmentMaxTotal : 0);

        if (isNaN(threshold) || threshold < 0) {
          errors.push(`Phase ${phaseNum}: Phase pass threshold must be a non-negative number.`);
        } else if (threshold > totalPossible) {
          errors.push(`Phase ${phaseNum}: Phase pass threshold (${threshold}) cannot exceed total possible marks (${totalPossible}).`);
        } else if (!isNaN(examPass) && threshold < examPass) {
          errors.push(`Phase ${phaseNum}: Contradictory grading rules - phase pass threshold (${threshold}) cannot be less than exam pass mark (${examPass}).`);
        }
      }
    }
  });

  if (data.completionPolicy?.reEnrollment?.discountEnabled) {
    const disc = Number(data.completionPolicy.reEnrollment.discountPercentage);
    if (isNaN(disc) || disc < 0 || disc > 100) {
      errors.push('Re-enrollment discount percentage must be between 0 and 100.');
    }
  }

  return errors;
}

// ── 1. List Course Definitions ───────────────────────────────────────────────
router.get('/', authenticateToken, (req, res) => {
  try {
    const { status, slug, latest_only } = req.query;
    let query = 'SELECT * FROM course_definitions WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (slug) {
      query += ' AND slug = ?';
      params.push(slug);
    }

    if (latest_only === 'true') {
      query += ' GROUP BY slug HAVING version = MAX(version)';
    }

    query += ' ORDER BY created_at DESC, version DESC';
    const rows = db.prepare(query).all(...params);

    const definitions = rows.map(r => {
      let parsed = {};
      try {
        parsed = JSON.parse(r.definition_json);
        if (Array.isArray(parsed.phases)) {
          parsed.phases = parsed.phases.map((p, idx) => {
            const phaseId = p.id || `p_${idx + 1}`;
            const resRoutine = resolvePhaseRoutine(db, r.id, null, phaseId, p.routine);
            return {
              ...p,
              routine: resRoutine.routine,
              routineSource: resRoutine.source
            };
          });
        }
      } catch {
        parsed = {};
      }
      const linkedBatches = db.prepare(`
        SELECT b.id, b.batch_name, b.batch_number, b.status, b.start_date, b.end_date, b.course_version,
               b.course_definition_id,
               COUNT(DISTINCT bs.student_id) as student_count
        FROM batches b
        LEFT JOIN batch_students bs ON bs.batch_id = b.id
        WHERE b.course_definition_id = ? AND b.deleted_at IS NULL
        GROUP BY b.id
        ORDER BY b.created_at DESC
      `).all(r.id);

      return {
        id: r.id,
        slug: r.slug,
        version: r.version,
        name: r.name,
        course_type: r.course_type,
        description: r.description,
        duration_value: r.duration_value,
        duration_unit: r.duration_unit,
        phase_count: r.phase_count,
        status: r.status,
        created_by: r.created_by,
        updated_by: r.updated_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        definition_json: r.definition_json,
        definition: parsed,
        batches: linkedBatches,
        batch_count: linkedBatches.length,
        linked_batch_count: linkedBatches.length,
        total_students: linkedBatches.reduce((acc, b) => acc + (b.student_count || 0), 0),
        enrollment_count: linkedBatches.reduce((acc, b) => acc + (b.student_count || 0), 0)
      };
    });

    res.json(definitions);
  } catch (err) {
    console.error('Error fetching course definitions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 2a. Get Linked Batches for a Course Definition ──────────────────────────
router.get('/:id/batches', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const def = db.prepare('SELECT id, name FROM course_definitions WHERE id = ?').get(id);
    if (!def) {
      return res.status(404).json({ error: 'Course definition not found' });
    }

    const linkedBatches = db.prepare(`
      SELECT b.id, b.batch_name, b.batch_number, b.status, b.start_date, b.end_date, b.course_version,
             b.course_definition_id,
             COUNT(DISTINCT bs.student_id) as student_count
      FROM batches b
      LEFT JOIN batch_students bs ON bs.batch_id = b.id
      WHERE b.course_definition_id = ? AND b.deleted_at IS NULL
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `).all(def.id);

    res.json(linkedBatches);
  } catch (err) {
    console.error('Error fetching course definition batches:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 2. Get Single Course Definition by ID or Slug ──────────────────────────
router.get('/:idOrSlug', authenticateToken, (req, res) => {
  try {
    const { idOrSlug } = req.params;
    let row;
    if (/^\d+$/.test(idOrSlug)) {
      row = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(idOrSlug);
    } else {
      row = db.prepare(`
        SELECT * FROM course_definitions 
        WHERE slug = ? 
        ORDER BY CASE WHEN status = 'published' THEN 0 ELSE 1 END, version DESC 
        LIMIT 1
      `).get(idOrSlug);
    }

    if (!row) {
      return res.status(404).json({ error: 'Course definition not found' });
    }

    let parsed = {};
    try {
      parsed = JSON.parse(row.definition_json);
    } catch {
      parsed = {};
    }

    const batchIdParam = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;
    if (Array.isArray(parsed.phases)) {
      parsed.phases = parsed.phases.map((p, idx) => {
        const phaseId = p.id || `p_${idx + 1}`;
        const resRoutine = resolvePhaseRoutine(db, row.id, batchIdParam, phaseId, p.routine);
        return {
          ...p,
          routine: resRoutine.routine,
          routineSource: resRoutine.source
        };
      });
    }

    // Load operational routine overrides
    const overrides = db.prepare('SELECT * FROM course_routine_overrides WHERE course_definition_id = ?').all(row.id);
    const routineOverrides = overrides.map(o => {
      let r = [];
      try {
        r = JSON.parse(o.routine_json);
      } catch (err) {
        console.error('Failed to parse routine_json override:', err);
      }
      return {
        batch_id: o.batch_id,
        phase_id: o.phase_id,
        routine: r,
        updated_at: o.updated_at
      };
    });

    const linkedBatches = db.prepare(`
      SELECT b.id, b.batch_name, b.batch_number, b.status, b.start_date, b.end_date, b.course_version,
             b.course_definition_id,
             COUNT(DISTINCT bs.student_id) as student_count
      FROM batches b
      LEFT JOIN batch_students bs ON bs.batch_id = b.id
      WHERE b.course_definition_id = ? AND b.deleted_at IS NULL
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `).all(row.id);

    res.json({
      id: row.id,
      slug: row.slug,
      version: row.version,
      name: row.name,
      course_type: row.course_type,
      description: row.description,
      duration_value: row.duration_value,
      duration_unit: row.duration_unit,
      phase_count: row.phase_count,
      status: row.status,
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      definition: parsed,
      routine_overrides: routineOverrides,
      batches: linkedBatches,
      batch_count: linkedBatches.length,
      linked_batch_count: linkedBatches.length,
      total_students: linkedBatches.reduce((acc, b) => acc + (b.student_count || 0), 0),
      enrollment_count: linkedBatches.reduce((acc, b) => acc + (b.student_count || 0), 0)
    });
  } catch (err) {
    console.error('Error fetching course definition detail:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 3. Create Draft Course Definition ──────────────────────────────────────
router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const errors = validateCourseDefinitionPayload(req.body, false);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const {
      name,
      course_type = 'workshop',
      description = '',
      duration_value = 1,
      duration_unit = 'months',
      phase_count = 1,
      phases = [],
      completionPolicy = {}
    } = req.body;

    const slug = slugify(name);

    // Check if a draft already exists with this slug
    const existingDraft = db.prepare("SELECT * FROM course_definitions WHERE slug = ? AND status = 'draft'").get(slug);
    if (existingDraft) {
      return res.status(409).json({ error: `A draft for "${name}" already exists. Edit the existing draft instead.` });
    }

    // Determine starting version
    const maxVerRow = db.prepare('SELECT MAX(version) as maxVer FROM course_definitions WHERE slug = ?').get(slug);
    const version = (maxVerRow?.maxVer || 0) + 1;

    const fullDefinition = {
      basics: { name, type: course_type, description, duration: { value: duration_value, unit: duration_unit }, phaseCount: phase_count },
      phases,
      completionPolicy
    };

    const stmt = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, description, duration_value, duration_unit, phase_count,
        status, definition_json, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `);

    const result = stmt.run(
      slug,
      version,
      name,
      course_type,
      description,
      duration_value,
      duration_unit,
      phase_count,
      JSON.stringify(fullDefinition),
      req.user.id,
      req.user.id
    );

    res.status(201).json({
      success: true,
      id: result.lastInsertRowid,
      slug,
      version,
      phase_count,
      status: 'draft',
      message: 'Draft course definition created successfully'
    });
  } catch (err) {
    console.error('Error creating course definition:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 4. Update Draft Course Definition ──────────────────────────────────────
router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ error: 'Course definition not found' });
    }

    if (existing.status === 'published') {
      return res.status(400).json({
        error: 'Published course definitions are immutable. Create a new version to modify structure or grading rules.'
      });
    }

    const errors = validateCourseDefinitionPayload(req.body, false);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const {
      name,
      course_type = existing.course_type,
      description = '',
      duration_value = 1,
      duration_unit = 'months',
      phase_count = 1,
      phases = [],
      completionPolicy = {}
    } = req.body;

    const fullDefinition = {
      basics: { name, type: course_type, description, duration: { value: duration_value, unit: duration_unit }, phaseCount: phase_count },
      phases,
      completionPolicy
    };

    db.prepare(`
      UPDATE course_definitions SET
        name = ?,
        course_type = ?,
        description = ?,
        duration_value = ?,
        duration_unit = ?,
        phase_count = ?,
        definition_json = ?,
        updated_by = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      name,
      course_type,
      description,
      duration_value,
      duration_unit,
      phase_count,
      JSON.stringify(fullDefinition),
      req.user.id,
      id
    );

    res.json({ success: true, message: 'Draft updated successfully' });
  } catch (err) {
    console.error('Error updating course definition draft:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 5. Publish Course Definition ───────────────────────────────────────────
router.post('/:id/publish', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ error: 'Course definition not found' });
    }

    if (existing.status === 'published') {
      return res.status(400).json({ error: 'Course definition is already published.' });
    }

    let parsed = {};
    try {
      parsed = JSON.parse(existing.definition_json);
    } catch {
      return res.status(400).json({ error: 'Corrupt definition JSON.' });
    }

    // Run strict publishing validation
    const validationData = {
      name: existing.name,
      phase_count: existing.phase_count,
      phases: parsed.phases || [],
      completionPolicy: parsed.completionPolicy || {}
    };
    const errors = validateCourseDefinitionPayload(validationData, true);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    // Determine version: find maximum version of this slug
    const maxVer = db.prepare('SELECT MAX(version) as maxV FROM course_definitions WHERE slug = ?').get(existing.slug);
    const publishedVersion = Math.max(existing.version, (maxVer?.maxV || 0));

    db.prepare(`
      UPDATE course_definitions SET
        status = 'published',
        version = ?,
        updated_by = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(publishedVersion, req.user.id, id);

    res.json({
      success: true,
      id: existing.id,
      slug: existing.slug,
      version: publishedVersion,
      status: 'published'
    });
  } catch (err) {
    console.error('Error publishing course definition:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 6. Update Weekly Routine with Audit Log ────────────────────────────────
router.put('/:id/routine', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { phase_id, batch_id = null, routine, reason = 'Routine update' } = req.body;

    if (!phase_id || !Array.isArray(routine)) {
      return res.status(400).json({ error: 'phase_id and routine array are required' });
    }

    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A specific reason (at least 3 characters) is required for routine changes.' });
    }

    // Validate batch if supplied
    let targetBatch = null;
    const resolvedBatchId = (batch_id !== null && batch_id !== undefined && batch_id !== 0)
      ? parseInt(batch_id, 10)
      : 0;

    if (resolvedBatchId > 0) {
      targetBatch = db.prepare('SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL').get(resolvedBatchId);
      if (!targetBatch) {
        return res.status(404).json({ error: 'Target batch not found' });
      }
      if (targetBatch.course_definition_id !== parseInt(id, 10)) {
        return res.status(400).json({ error: 'Batch does not belong to this course definition' });
      }
    }

    // Role & permission check: Authorized admins and moderators only
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Only authorized administrators and moderators can modify class routines.' });
    }

    if (req.user.role === 'moderator') {
      if (resolvedBatchId === 0) {
        return res.status(403).json({ error: 'Moderators cannot modify course-level routines. A specific batch_id must be provided.' });
      }
      const isAssigned = db.prepare('SELECT 1 FROM batch_moderators WHERE batch_id = ? AND user_id = ?').get(resolvedBatchId, req.user.id);
      const isCreator = targetBatch && targetBatch.created_by === req.user.id;
      if (!isAssigned && !isCreator) {
        return res.status(403).json({ error: 'You are not authorized to modify the routine for this batch.' });
      }
    }

    const definition = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(id);
    if (!definition) {
      return res.status(404).json({ error: 'Course definition not found' });
    }

    const parsed = JSON.parse(definition.definition_json);
    const phase = (parsed.phases || []).find(p => p.id === phase_id);
    if (!phase) {
      return res.status(404).json({ error: `Phase with id "${phase_id}" not found in definition.` });
    }

    // Validate routine slots
    for (let rIdx = 0; rIdx < routine.length; rIdx++) {
      const slot = routine[rIdx];
      if (!ALLOWED_WEEKDAYS.includes(slot.weekday)) {
        return res.status(400).json({ error: `Invalid weekday "${slot.weekday}" in routine.` });
      }
      if (!isValidTime(slot.startTime) || !isValidTime(slot.endTime)) {
        return res.status(400).json({ error: 'Routine times must be valid 24-hour HH:MM format.' });
      }
      if (timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime)) {
        return res.status(400).json({ error: `End time (${slot.endTime}) must be strictly after start time (${slot.startTime}).` });
      }
    }

    // Determine old routine: check if there was a previous override or take base phase routine
    const existingOverride = db.prepare(`
      SELECT routine_json FROM course_routine_overrides
      WHERE course_definition_id = ? AND batch_id = ? AND phase_id = ?
    `).get(id, resolvedBatchId, phase_id);

    const oldRoutine = existingOverride
      ? JSON.parse(existingOverride.routine_json)
      : (phase.routine || []);

    const tx = db.transaction(() => {
      // 1. Audit log with actor, reason, old/new routine, batch_id
      db.prepare(`
        INSERT INTO course_routine_audits (
          course_definition_id, batch_id, phase_id, old_routine, new_routine, changed_by, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        resolvedBatchId,
        phase_id,
        JSON.stringify(oldRoutine),
        JSON.stringify(routine),
        req.user.id,
        reason.trim()
      );

      // 2. Issue 2: Store operational routine overrides separately!
      // If definition is published, DO NOT mutate definition_json on course_definitions!
      // Keep published grading rules permanently immutable.
      db.prepare(`
        INSERT INTO course_routine_overrides (
          course_definition_id, batch_id, phase_id, routine_json, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(course_definition_id, batch_id, phase_id) DO UPDATE SET
          routine_json = excluded.routine_json,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(id, resolvedBatchId, phase_id, JSON.stringify(routine), req.user.id);

      // If definition is still a draft, update draft definition_json as well
      if (definition.status === 'draft') {
        phase.routine = routine;
        db.prepare(`
          UPDATE course_definitions SET
            definition_json = ?,
            updated_by = ?,
            updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(JSON.stringify(parsed), req.user.id, id);
      }
    });

    tx();

    res.json({
      success: true,
      message: 'Routine updated and audited successfully.',
      is_operational_override: definition.status === 'published'
    });
  } catch (err) {
    console.error('Error updating routine:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 7. Get Routine Audits ──────────────────────────────────────────────────
router.get('/:id/routine-audits', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const audits = db.prepare(`
      SELECT 
        a.id,
        a.course_definition_id,
        a.batch_id,
        a.phase_id,
        a.old_routine,
        a.new_routine,
        a.changed_by,
        a.changed_at,
        a.reason,
        COALESCE(u.first_name || ' ' || u.last_name, u.username) as changed_by_name
      FROM course_routine_audits a
      LEFT JOIN users u ON a.changed_by = u.id
      WHERE a.course_definition_id = ?
      ORDER BY a.changed_at DESC
    `).all(id);

    const parsed = audits.map(a => {
      try { a.old_routine = JSON.parse(a.old_routine); } catch { a.old_routine = []; }
      try { a.new_routine = JSON.parse(a.new_routine); } catch { a.new_routine = []; }
      return a;
    });

    res.json(parsed);
  } catch (err) {
    console.error('Error fetching routine audits:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
