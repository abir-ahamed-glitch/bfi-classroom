import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { runBatchStatusAutomation } from '../utils/batchStatusAutomation.js';
import { getBatchFee, createFeeResolverContext } from '../utils/feeResolver.js';
import { logTrashAction } from '../utils/trashLogger.js';
import { courseProgressService, getEnrollmentProgressSync, resolvePhaseRoutine } from '../services/courseProgressService.js';

const router = express.Router();


// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 0A — POST /api/admin/batches/run-automation
// Purpose: Manually trigger the batch status automation engine
// NOTE: This route MUST appear before /:id routes or Express will treat
//       'run-automation' as an :id parameter and never reach this handler.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/run-automation', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    console.log(`[BatchAutomation] Manual trigger by admin ${req.user.id}`);

    const result = runBatchStatusAutomation(db, req.user.id);

    return res.json({
      success: true,
      message: result.transitions.length > 0
        ? `${result.transitions.length} batch(es) updated`
        : 'All batches are up to date — no changes needed',
      batches_checked: result.batches_checked,
      transitions: result.transitions,
      errors: result.errors
    });
  } catch (error) {
    console.error('[BatchAutomation] Manual trigger error:', error);
    return res.status(500).json({ error: 'Automation run failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 1 — GET /api/admin/batches
// Purpose: List all batches with student counts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const status = req.query.status && req.query.status !== 'all' ? req.query.status : null;
    const course = req.query.course && req.query.course !== 'all' ? req.query.course : null;
    const rawSearch = req.query.search ? req.query.search.trim() : '';
    const search = rawSearch ? `%${rawSearch}%` : null;
    const page = req.query.page ? Math.max(1, parseInt(req.query.page, 10)) : null;
    const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit, 10)) : null;

    // 1. Fast Conditional ETag Check (< 0.5ms)
    // Uses metadata and index counts to detect database changes instantly without running batch query
    const meta = db.prepare(`
      SELECT 
        COUNT(*) as count, 
        COALESCE(MAX(updated_at), '0') as max_updated,
        COALESCE(MAX(id), 0) as max_id
      FROM batches 
      WHERE deleted_at IS NULL
    `).get();
    const bsMeta = db.prepare(`SELECT COUNT(*) as count FROM batch_students`).get();

    const queryKey = `${status || 'all'}:${course || 'all'}:${rawSearch}:${page || 'all'}:${limit || 'all'}`;
    const currentEtag = `W/"b-${meta.count}-${meta.max_updated}-${meta.max_id}-${bsMeta.count}-${Buffer.from(queryKey).toString('base64url')}"`;

    if (req.headers['if-none-match'] === currentEtag) {
      res.setHeader('ETag', currentEtag);
      return res.status(304).end();
    }
    res.setHeader('ETag', currentEtag);

    // 2. Global status breakdown stats for admin summary cards
    const statsRows = db.prepare(`
      SELECT status, COUNT(*) as cnt
      FROM batches
      WHERE deleted_at IS NULL
      GROUP BY status
    `).all();
    const stats = { total: 0, active: 0, upcoming: 0, completed: 0, archived: 0 };
    for (const r of statsRows) {
      stats.total += r.cnt;
      if (r.status in stats) stats[r.status] = r.cnt;
    }

    // 3. Count total matching filtered rows if pagination requested
    let totalMatching = null;
    if (page !== null || limit !== null) {
      const totalRow = db.prepare(`
        SELECT COUNT(*) as cnt
        FROM batches b
        WHERE 
          b.deleted_at IS NULL
          AND (:status IS NULL OR b.status = :status)
          AND (:course IS NULL OR b.course_name = :course)
          AND (
            :search IS NULL OR 
            b.batch_name LIKE :search OR 
            b.batch_number LIKE :search
          )
      `).get({ status, course, search });
      totalMatching = totalRow ? totalRow.cnt : 0;
    }

    // 4. Query batches (with optional LIMIT & OFFSET)
    let querySql = `
      SELECT 
        b.*,
        COALESCE(bs_cnt.cnt, 0) as student_count
      FROM batches b
      LEFT JOIN (
        SELECT batch_id, COUNT(*) as cnt 
        FROM batch_students 
        GROUP BY batch_id
      ) bs_cnt ON bs_cnt.batch_id = b.id
      WHERE 
        b.deleted_at IS NULL
        AND (:status IS NULL OR b.status = :status)
        AND (:course IS NULL OR b.course_name = :course)
        AND (
          :search IS NULL OR 
          b.batch_name LIKE :search OR 
          b.batch_number LIKE :search
        )
      ORDER BY CAST(b.batch_number AS INTEGER) DESC
    `;

    const queryParams = { status, course, search };
    if (page !== null && limit !== null) {
      querySql += ` LIMIT :limit OFFSET :offset`;
      queryParams.limit = limit;
      queryParams.offset = (page - 1) * limit;
    } else if (limit !== null) {
      querySql += ` LIMIT :limit`;
      queryParams.limit = limit;
    }

    const batches = db.prepare(querySql).all(queryParams);

    // 5. Pre-compute phase 1 completed counts for only the selected batches
    let p1Map = new Map();
    if (batches.length > 0) {
      const batchIds = batches.map(b => b.id);
      const placeholders = batchIds.map(() => '?').join(',');
      const p1Rows = db.prepare(`
        SELECT bs.batch_id, COUNT(DISTINCT bs.student_id) as count
        FROM batch_students bs
        JOIN batches b ON b.id = bs.batch_id
        JOIN student_course_enrollments sce
          ON sce.user_id = bs.student_id
          AND (sce.batch_id = bs.batch_id OR (sce.batch_id IS NULL AND sce.course_name = b.course_name))
        WHERE bs.batch_id IN (${placeholders}) AND sce.step2_completed = 1
        GROUP BY bs.batch_id
      `).all(...batchIds);
      p1Map = new Map(p1Rows.map(r => [r.batch_id, r.count]));
    }

    // 6. Pre-load in-memory fee context to resolve course/batch fees with zero DB queries per batch
    const feeContext = createFeeResolverContext(db);

    for (const batch of batches) {
      batch.phase1_completed_count = p1Map.get(batch.id) || 0;

      const batchFee = getBatchFee(batch.course_name, batch.batch_number, db, batch.id, feeContext);
      batch.course_fee = batchFee ? (batchFee.full_fee || (batchFee.phase1_fee + batchFee.phase2_fee)) : 0;
      batch.phase1_fee = batchFee ? batchFee.phase1_fee : 0;
      batch.phase2_fee = batchFee ? batchFee.phase2_fee : 0;
      batch.is_custom_fee = batchFee ? !!batchFee.is_custom : false;
    }

    // If pagination requested, return pagination envelope with global stats
    if (page !== null || limit !== null || req.query.paginate === 'true') {
      const activeLimit = limit || 24;
      const activePage = page || 1;
      const total = totalMatching !== null ? totalMatching : batches.length;
      return res.json({
        batches,
        total,
        page: activePage,
        limit: activeLimit,
        totalPages: Math.ceil(total / activeLimit),
        hasMore: activePage * activeLimit < total,
        stats
      });
    }

    // Backward-compatible raw array return for unpaginated calls
    res.json(batches);
  } catch (error) {
    console.error('[Batches] GET / error:', error);
    res.status(500).json({ error: 'Internal server error while listing batches.' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 2 — GET /api/admin/batches/:id
// Purpose: Get a single batch's full details
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slugOrId = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE id = ? OR slug = ?').get(slugOrId, slugOrId);
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const batch = db.prepare(`
      SELECT 
        b.*,
        COUNT(bs.id) as student_count
      FROM batches b
      LEFT JOIN batch_students bs ON bs.batch_id = b.id
      WHERE b.id = ?
      GROUP BY b.id
    `).get(batchId);

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const batchFee = getBatchFee(batch.course_name, batch.batch_number, db, batch.id);
    batch.course_fee = batchFee ? (batchFee.full_fee || (batchFee.phase1_fee + batchFee.phase2_fee)) : 0;
    batch.phase1_fee = batchFee ? batchFee.phase1_fee : 0;
    batch.phase2_fee = batchFee ? batchFee.phase2_fee : 0;
    if (batch.course_definition_id) {
      const def = db.prepare('SELECT id, slug, version, name, course_type, phase_count, definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
      if (def) {
        let parsed = {};
        try {
          parsed = JSON.parse(def.definition_json || '{}');
          if (Array.isArray(parsed.phases)) {
            parsed.phases = parsed.phases.map((p, idx) => {
              const phaseId = p.id || `p_${idx + 1}`;
              const resRoutine = resolvePhaseRoutine(db, def.id, batch.id, phaseId, p.routine);
              return {
                ...p,
                routine: resRoutine.routine,
                routineSource: resRoutine.source
              };
            });
          }
        } catch {
          /* empty */
        }
        batch.course_definition = {
          ...def,
          definition: parsed
        };
      }
    }

    res.json(batch);
  } catch (error) {
    console.error('[Batches] GET /:id error:', error);
    res.status(500).json({ error: 'Internal server error while fetching batch details.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 3 — POST /api/admin/batches
// Purpose: Create a new batch
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { batch_name, batch_number, course_name, status, start_date, end_date, description, course_definition_id } = req.body;

    let finalCourseName = course_name;
    let courseDefId = null;
    let courseVersion = null;

    if (course_definition_id) {
      const def = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(course_definition_id);
      if (!def) {
        return res.status(404).json({ error: 'Specified course definition not found.' });
      }
      courseDefId = def.id;
      courseVersion = def.version;
      // Derive course name authoritatively from definition; reject conflicting client title
      if (course_name && typeof course_name === 'string' && course_name.trim() !== '' && course_name.trim() !== def.name.trim()) {
        return res.status(400).json({ 
          error: `Conflicting course_name supplied for course definition ${def.id}. Expected "${def.name}", received "${course_name}".` 
        });
      }
      finalCourseName = def.name;
    }

    if (!batch_name || typeof batch_name !== 'string' || batch_name.trim() === '') {
      return res.status(400).json({ error: 'Batch name is required.' });
    }
    if (!batch_number || typeof batch_number !== 'string' || batch_number.trim() === '') {
      return res.status(400).json({ error: 'Batch number is required.' });
    }
    if (!finalCourseName || typeof finalCourseName !== 'string' || finalCourseName.trim() === '') {
      return res.status(400).json({ error: 'Course name is required.' });
    }

    // Validate unique batch number and name within the same course definition (or legacy unlinked course)
    let existingBatch;
    if (courseDefId) {
      existingBatch = db.prepare(`
        SELECT id FROM batches 
        WHERE course_definition_id = ? AND (batch_number = ? OR LOWER(batch_name) = ?)
      `).get(courseDefId, batch_number, batch_name.toLowerCase());
    } else {
      existingBatch = db.prepare(`
        SELECT id FROM batches 
        WHERE course_definition_id IS NULL AND course_name = ? AND (batch_number = ? OR LOWER(batch_name) = ?)
      `).get(finalCourseName, batch_number, batch_name.toLowerCase());
    }
    if (existingBatch) {
      return res.status(409).json({ error: 'A batch with this name or number already exists for this course' });
    }

    // Validate status
    const validStatuses = ['upcoming', 'active', 'completed', 'archived'];
    const finalStatus = status || 'upcoming';
    if (!validStatuses.includes(finalStatus)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    // Validate date logic
    if (start_date && end_date) {
      if (new Date(start_date) >= new Date(end_date)) {
        return res.status(400).json({ error: 'Start date must be before end date' });
      }
    }

    const result = db.prepare(`
      INSERT INTO batches (
        batch_name, batch_number, course_name, status, start_date, end_date, description, created_by,
        course_definition_id, course_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batch_name, 
      batch_number, 
      finalCourseName, 
      finalStatus, 
      start_date || null, 
      end_date || null, 
      description || null, 
      req.user.id,
      courseDefId,
      courseVersion
    );

    const newBatch = db.prepare('SELECT * FROM batches WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newBatch);
  } catch (error) {
    console.error('[Batches] POST / error:', error);
    res.status(500).json({ error: 'Internal server error while creating batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 4 — PATCH /api/admin/batches/:id
// Purpose: Update an existing batch
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slugOrId = req.params.id;
    console.log(`[PATCH /:id] slugOrId = ${slugOrId}`);
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE id = ? OR slug = ?').get(slugOrId, slugOrId);
    console.log(`[PATCH /:id] batchRecordLookup =`, batchRecordLookup);
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const current = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    console.log(`[PATCH /:id] current =`, current);
    if (!current) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const updates = [];
    const params = {};

    let finalStartDate = req.body.start_date !== undefined ? req.body.start_date : current.start_date;
    let finalEndDate = req.body.end_date !== undefined ? req.body.end_date : current.end_date;

    if (finalStartDate && finalEndDate && new Date(finalStartDate) >= new Date(finalEndDate)) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    if (req.body.course_name !== undefined) {
      if (typeof req.body.course_name !== 'string' || req.body.course_name.trim() === '') {
        return res.status(400).json({ error: 'Course name is required.' });
      }
      updates.push('course_name = :course_name');
      params.course_name = req.body.course_name;
    }

    if (req.body.status !== undefined) {
      const validStatuses = ['upcoming', 'active', 'completed', 'archived'];
      if (!validStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      updates.push('status = :status');
      params.status = req.body.status;
    }

    if (req.body.batch_name !== undefined) {
      if (!req.body.batch_name || typeof req.body.batch_name !== 'string' || req.body.batch_name.trim() === '') {
        return res.status(400).json({ error: 'Invalid batch name.' });
      }
      const targetDefId = req.body.course_definition_id !== undefined ? req.body.course_definition_id : current.course_definition_id;
      const targetCourse = req.body.course_name !== undefined ? req.body.course_name : current.course_name;
      let existingBatch;
      if (targetDefId) {
        existingBatch = db.prepare(`
          SELECT id FROM batches 
          WHERE course_definition_id = ? AND LOWER(batch_name) = ? AND id != ?
        `).get(targetDefId, req.body.batch_name.toLowerCase(), batchId);
      } else {
        existingBatch = db.prepare(`
          SELECT id FROM batches 
          WHERE course_definition_id IS NULL AND course_name = ? AND LOWER(batch_name) = ? AND id != ?
        `).get(targetCourse, req.body.batch_name.toLowerCase(), batchId);
      }
      if (existingBatch) {
        return res.status(409).json({ error: 'A batch with this name already exists for this course' });
      }
      updates.push('batch_name = :batch_name');
      params.batch_name = req.body.batch_name;
    }

    if (req.body.start_date !== undefined) {
      updates.push('start_date = :start_date');
      params.start_date = req.body.start_date || null;
    }

    if (req.body.end_date !== undefined) {
      updates.push('end_date = :end_date');
      params.end_date = req.body.end_date || null;
    }

    if (req.body.description !== undefined) {
      updates.push('description = :description');
      params.description = req.body.description || null;
    }

    if (req.body.course_definition_id !== undefined) {
      if (req.body.course_definition_id === null) {
        updates.push('course_definition_id = NULL');
        updates.push('course_version = NULL');
      } else {
        const def = db.prepare('SELECT id, version, name FROM course_definitions WHERE id = ?').get(req.body.course_definition_id);
        if (!def) {
          return res.status(404).json({ error: 'Specified course definition not found.' });
        }
        if (req.body.course_name !== undefined && req.body.course_name.trim() !== '' && req.body.course_name.trim() !== def.name.trim()) {
          return res.status(400).json({
            error: `Conflicting course_name supplied for course definition ${def.id}. Expected "${def.name}", received "${req.body.course_name}".`
          });
        }
        updates.push('course_definition_id = :course_definition_id');
        updates.push('course_version = :course_version');
        updates.push('course_name = :def_course_name');
        params.course_definition_id = def.id;
        params.course_version = def.version;
        params.def_course_name = def.name;
      }
    } else if (current.course_definition_id && req.body.course_name !== undefined) {
      const def = db.prepare('SELECT id, version, name FROM course_definitions WHERE id = ?').get(current.course_definition_id);
      if (def && req.body.course_name.trim() !== def.name.trim()) {
        return res.status(400).json({
          error: `Conflicting course_name supplied for course definition ${def.id}. Expected "${def.name}", received "${req.body.course_name}".`
        });
      }
    }

    if (req.body.batch_number !== undefined) {
      if (!req.body.batch_number || typeof req.body.batch_number !== 'string' || req.body.batch_number.trim() === '') {
        return res.status(400).json({ error: 'Invalid batch number.' });
      }
      const targetDefId = req.body.course_definition_id !== undefined ? req.body.course_definition_id : current.course_definition_id;
      const targetCourse = req.body.course_name !== undefined ? req.body.course_name : current.course_name;
      let existingBatch;
      if (targetDefId) {
        existingBatch = db.prepare(`
          SELECT id FROM batches 
          WHERE course_definition_id = ? AND batch_number = ? AND id != ?
        `).get(targetDefId, req.body.batch_number.trim(), batchId);
      } else {
        existingBatch = db.prepare(`
          SELECT id FROM batches 
          WHERE course_definition_id IS NULL AND course_name = ? AND batch_number = ? AND id != ?
        `).get(targetCourse, req.body.batch_number.trim(), batchId);
      }
      if (existingBatch) {
        return res.status(409).json({ error: 'A batch with this number already exists for this course' });
      }
      updates.push('batch_number = :batch_number');
      params.batch_number = req.body.batch_number.trim();
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime(\'now\')');
      params.id = batchId;

      db.prepare(`
        UPDATE batches 
        SET ${updates.join(', ')}
        WHERE id = :id
      `).run(params);
    }

    const updatedBatch = db.prepare(`
      SELECT b.*, COUNT(bs.id) as student_count
      FROM batches b
      LEFT JOIN batch_students bs ON bs.batch_id = b.id
      WHERE b.id = ?
      GROUP BY b.id
    `).get(batchId);

    res.json(updatedBatch);
  } catch (error) {
    console.error('[Batches] PATCH /:id error:', error);
    res.status(500).json({ error: 'Internal server error while updating batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 5 — DELETE /api/admin/batches/:id
// Purpose: Delete a batch (strictly controlled)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slugOrId = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE id = ? OR slug = ?').get(slugOrId, slugOrId);
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Soft Delete the batch
    db.prepare("UPDATE batches SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?").run(req.user.id, batchId);
    logTrashAction('batches', batchId, batch.batch_name, 'deleted', req.user.id);
    
    res.json({ success: true, message: 'Batch moved to Trash.' });
  } catch (error) {
    console.error('[Batches] DELETE /:id error:', error);
    res.status(500).json({ error: 'Internal server error while deleting batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 6 — GET /api/admin/batches/:id/students
// Purpose: List all students assigned to a specific batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/students', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const search = req.query.search ? `%${req.query.search}%` : null;

    const rawStudents = db.prepare(`
      SELECT 
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.profile_picture as avatar,
        u.created_at,
        sp.student_id as bfi_id,
        sp.batch_number,
        bs.assigned_at,
        sce.id as enrollment_id,
        sce.course_name,
        sce.step1_completed,
        sce.step2_completed,
        sce.step3_completed,
        sce.step4_completed,
        sce.fee_details
      FROM batch_students bs
      JOIN users u ON u.id = bs.student_id
      JOIN batches b ON b.id = bs.batch_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id  
      LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id AND (sce.batch_id = b.id OR (sce.batch_id IS NULL AND sce.course_name = b.course_name))
      WHERE bs.batch_id = :batchId
        AND (
          :search IS NULL OR
          u.first_name LIKE :search OR 
          u.last_name LIKE :search OR 
          sp.student_id LIKE :search
        )
      ORDER BY u.first_name ASC
    `).all({ batchId, search });

    const students = rawStudents.map(s => {
      let fee_status = null;
      if (s.fee_details) {
        try {
          const parsed = JSON.parse(s.fee_details);
          fee_status = parsed?.status || parsed?.phase1?.status || null;
        } catch (e) {
          // Ignore
        }
      }

      return {
        id: s.user_id, // Map user_id to id for parity with StudentManager
        user_id: s.user_id,
        first_name: s.first_name,
        last_name: s.last_name,
        full_name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
        avatar: s.avatar,
        bfi_id: s.bfi_id,
        batch_number: s.batch_number,
        assigned_at: s.assigned_at,
        created_at: s.created_at,
        phase1_completed: s.step2_completed === 1,
        exam_passed: s.step2_completed === 1,
        phase2_admitted: s.step3_completed === 1,
        phase2_completed: s.step4_completed === 1,
        fee_status,
        enrollment_id: s.enrollment_id,
        course_name: s.course_name
      };
    });

    // Fetch and attach enrollments like StudentManager
    if (students.length > 0) {
      // Ensure all students assigned to this batch have an enrollment record for the batch's course
      const batchRecord = db.prepare('SELECT id, course_name, course_definition_id, course_version FROM batches WHERE id = ?').get(batchId);
      if (batchRecord && batchRecord.course_name) {
        let courseType = batchRecord.course_name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
        if (batchRecord.course_definition_id) {
          const def = db.prepare('SELECT course_type FROM course_definitions WHERE id = ?').get(batchRecord.course_definition_id);
          if (def?.course_type) courseType = def.course_type;
        }
        db.transaction(() => {
          for (const s of students) {
            const hasEnrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))').get(s.user_id, batchId, batchRecord.course_name);
            if (!hasEnrollment) {
              db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version, batch_id) VALUES (?, ?, ?, ?, ?, ?)').run(
                s.user_id, batchRecord.course_name, courseType, batchRecord.course_definition_id || null, batchRecord.course_version || null, batchId
              );
            }
          }
        })();
      }

      const allEnrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id IN (' + students.map(s => s.user_id).join(',') + ')').all();
      
      for (const e of allEnrollments) {
        if (e.course_definition_id) {
          try {
            e.defined_progress = await courseProgressService.getEnrollmentProgress(e.id, null, { batchId });
          } catch (err) {
            console.error(`Error loading defined progress for enrollment ${e.id}:`, err);
          }
        }
      }

      students.forEach(s => {
        s.enrollments = allEnrollments.filter(e => e.user_id === s.user_id);
      });
    } else {
      students.forEach(s => s.enrollments = []);
    }

    res.json(students);
  } catch (error) {
    console.error('[Batches] GET /:id/students error:', error);
    res.status(500).json({ error: 'Internal server error while listing batch students.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 7 — GET /api/admin/batches/:id/available-students
// Purpose: List students not yet assigned to this specific batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/available-students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const search = req.query.search ? `%${req.query.search}%` : null;

    const students = db.prepare(`
      SELECT 
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.profile_picture as avatar,
        sp.student_id as bfi_id,
        sp.batch_number
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN batch_students bs ON bs.student_id = u.id AND bs.batch_id = :batchId
      WHERE u.role = 'student'
        AND bs.id IS NULL  -- not in this batch
        AND (
          :search IS NULL OR
          u.first_name LIKE :search OR 
          u.last_name LIKE :search OR 
          sp.student_id LIKE :search
        )
      ORDER BY u.first_name ASC
    `).all({ batchId, search });

    res.json(students);
  } catch (error) {
    console.error('[Batches] GET /:id/available-students error:', error);
    res.status(500).json({ error: 'Internal server error while listing available students.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 8 — POST /api/admin/batches/:id/students
// Purpose: Assign multiple students to a batch
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const { student_ids } = req.body;

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: 'student_ids must be a non-empty array' });
    }

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status === 'archived') {
      return res.status(400).json({ error: 'Cannot add students to an archived batch' });
    }

    const errors = [];
    let assignedCount = 0;

    const assignTransaction = db.transaction(() => {
      for (const studentId of student_ids) {
        const existingInThisBatch = db.prepare(`
          SELECT b.batch_number 
          FROM batch_students bs 
          JOIN batches b ON b.id = bs.batch_id 
          WHERE bs.student_id = ? AND bs.batch_id = ?
        `).get(studentId, batchId);

        if (existingInThisBatch) {
          errors.push({
            student_id: studentId,
            message: `Already assigned to Batch ${existingInThisBatch.batch_number}`
          });
          continue;
        }

        db.prepare(`
          INSERT OR IGNORE INTO batch_students (batch_id, student_id, assigned_by) 
          VALUES (?, ?, ?)
        `).run(batchId, studentId, req.user.id);

        db.prepare(`
          UPDATE student_profiles 
          SET batch_number = ? 
          WHERE user_id = ?
        `).run(batch.batch_number, studentId);

        // Enroll student in the batch's course if not already enrolled.
        // DO NOT implicitly mutate course_definition_id on existing legacy enrollments to avoid
        // invalidating historical results. Existing legacy enrollments must be preserved as legacy.
        let courseType = batch.course_name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
        if (batch.course_definition_id) {
          const def = db.prepare('SELECT course_type FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
          if (def?.course_type) {
            courseType = def.course_type;
          }
        }

        // 1. Check if the student already has an enrollment for this exact batch
        const existingForThisBatch = db.prepare(
          'SELECT id, course_definition_id, batch_id FROM student_course_enrollments WHERE user_id = ? AND course_name = ? AND batch_id = ?'
        ).get(studentId, batch.course_name, batch.id);

        if (existingForThisBatch) {
          // Already enrolled for this batch — no action needed
        } else {
          // 2. Check if student has an unassigned legacy enrollment (batch_id IS NULL)
          const legacyEnrollment = db.prepare(
            'SELECT id, course_definition_id FROM student_course_enrollments WHERE user_id = ? AND course_name = ? AND batch_id IS NULL'
          ).get(studentId, batch.course_name);

          // Calculate re-enrollment discount if student previously attempted and failed this course
          let initialFeeDetails = null;
          if (batch.course_definition_id) {
            const cDef = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
            if (cDef?.definition_json) {
              try {
                const parsedDef = JSON.parse(cDef.definition_json);
                const reEnrollPolicy = parsedDef.completionPolicy?.reEnrollment;
                if (reEnrollPolicy && reEnrollPolicy.discountEnabled) {
                  const prior = db.prepare(`
                    SELECT id, course_definition_id
                    FROM student_course_enrollments
                    WHERE user_id = ? AND (course_definition_id = ? OR course_name = ?)
                    ORDER BY id DESC LIMIT 1
                  `).get(studentId, batch.course_definition_id, batch.course_name);

                  if (prior) {
                    const priorProgress = getEnrollmentProgressSync(prior.id, db);
                    // Only apply discount if student ACTUALLY failed an attempt, not merely incomplete or in-progress
                    if (priorProgress && priorProgress.failedAnyPhase) {
                      const discountPct = reEnrollPolicy.discountPercentage !== undefined ? Number(reEnrollPolicy.discountPercentage) : 50;
                      const batchFeeObj = getBatchFee(batch.course_name, batch.batch_number, db, batch.id);
                      let fullFee = batchFeeObj ? Number(batchFeeObj.full_fee) : 0;
                      if (!fullFee && parsedDef.phases && Array.isArray(parsedDef.phases)) {
                        fullFee = parsedDef.phases.reduce((sum, p) => sum + (Number(p.feeAmount) || 0), 0);
                      }
                      const discountAmount = Math.max(0, Math.round((fullFee * discountPct) / 100));
                      initialFeeDetails = JSON.stringify({
                        discount: discountAmount,
                        discount_amount: discountAmount,
                        discount_percentage: discountPct,
                        discount_type: 're_enrollment',
                        discount_reason: reEnrollPolicy.discountDescription || 'Re-enrollment discount applied from previous attempt',
                        status: 'Pending'
                      });
                    }
                  }
                }
              } catch { /* empty */ }
            }
          }

          if (legacyEnrollment) {
            if (!legacyEnrollment.course_definition_id && batch.course_definition_id) {
              // Existing legacy enrollment preserved. Conversion requires explicit migration API.
              errors.push({
                student_id: studentId,
                notice: 'Student has an existing legacy enrollment. Preserved as legacy without implicit conversion.'
              });
              // Create distinct batch enrollment with canonical course_name and applied re-enrollment discount
              db.prepare(`
                INSERT INTO student_course_enrollments (
                  user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(studentId, batch.course_name, courseType, batch.course_definition_id || null, batch.course_version || null, batch.id, initialFeeDetails);
            } else {
              // Link unassigned legacy enrollment to this batch
              db.prepare('UPDATE student_course_enrollments SET batch_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(batch.id, legacyEnrollment.id);
            }
          } else {
            // 3. Insert fresh enrollment for this batch with canonical course_name and applied re-enrollment discount
            db.prepare(`
              INSERT INTO student_course_enrollments (
                user_id, course_name, course_type, course_definition_id, course_version, batch_id, fee_details
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(studentId, batch.course_name, courseType, batch.course_definition_id || null, batch.course_version || null, batch.id, initialFeeDetails);
          }
        }

        assignedCount++;
      }
    });

    assignTransaction();

    res.json({
      assigned: assignedCount,
      errors
    });
  } catch (error) {
    console.error('[Batches] POST /:id/students error:', error);
    res.status(500).json({ error: 'Internal server error while assigning students to batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 9 — DELETE /api/admin/batches/:id/students/:studentId
// Purpose: Remove a single student from a batch
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id/students/:studentId', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const studentId = parseInt(req.params.studentId, 10);

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const removeTransaction = db.transaction(() => {
      db.prepare('DELETE FROM batch_students WHERE batch_id = ? AND student_id = ?').run(batchId, studentId);
      const remainingBatch = db.prepare(`
        SELECT b.batch_number 
        FROM batch_students bs 
        JOIN batches b ON bs.batch_id = b.id 
        WHERE bs.student_id = ? AND bs.batch_id != ? 
        LIMIT 1
      `).get(studentId, batchId);
      db.prepare('UPDATE student_profiles SET batch_number = ? WHERE user_id = ?').run(remainingBatch ? remainingBatch.batch_number : null, studentId);
    });

    removeTransaction();

    res.json({ success: true });
  } catch (error) {
    console.error('[Batches] DELETE /:id/students/:studentId error:', error);
    res.status(500).json({ error: 'Internal server error while removing student from batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 9B — POST /api/admin/batches/:id/students/:studentId/admit-phase/:phaseNumber
// Purpose: Admit a student to a specific phase of a batch's course (1–5 phases)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/students/:studentId/admit-phase/:phaseNumber', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id, course_name, course_definition_id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const studentId = parseInt(req.params.studentId, 10);
    const phaseNumber = parseInt(req.params.phaseNumber, 10);

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const enrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))').get(studentId, batchId, batchRecordLookup.course_name);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found for student in this batch' });
    }

    const updatedProgress = await courseProgressService.admitStudentToPhase(enrollment.id, phaseNumber, db, { batchId });
    return res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('[Batches] admit-phase error:', error);
    return res.status(400).json({ error: error.message || 'Failed to admit student to phase.' });
  }
});

// Legacy backward-compatibility alias for Phase 2
router.post('/:id/students/:studentId/admit-phase2', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id, course_name, course_definition_id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const studentId = parseInt(req.params.studentId, 10);

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const enrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))').get(studentId, batchId, batchRecordLookup.course_name);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found for student in this batch' });
    }

    const updatedProgress = await courseProgressService.admitStudentToPhase(enrollment.id, 2, db, { batchId });
    return res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('[Batches] admit-phase2 error:', error);
    return res.status(400).json({ error: error.message || 'Failed to admit student to Phase 2.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 9C — POST /api/admin/batches/:id/students/:studentId/unadmit-phase/:phaseNumber
// Purpose: Undo phase admission with strict payment restriction defense
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/students/:studentId/unadmit-phase/:phaseNumber', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id, course_name, course_definition_id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const studentId = parseInt(req.params.studentId, 10);
    const phaseNumber = parseInt(req.params.phaseNumber, 10);

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const enrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))').get(studentId, batchId, batchRecordLookup.course_name);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found for student in this batch' });
    }

    const updatedProgress = await courseProgressService.unadmitStudentFromPhase(enrollment.id, phaseNumber, db, { batchId });
    return res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('[Batches] unadmit-phase error:', error);
    return res.status(400).json({ error: error.message || 'Failed to undo phase admission.' });
  }
});

router.post('/:id/students/:studentId/unadmit-phase2', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id, course_name, course_definition_id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const studentId = parseInt(req.params.studentId, 10);

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const enrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))').get(studentId, batchId, batchRecordLookup.course_name);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found for student in this batch' });
    }

    const updatedProgress = await courseProgressService.unadmitStudentFromPhase(enrollment.id, 2, db, { batchId });
    return res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('[Batches] unadmit-phase2 error:', error);
    return res.status(400).json({ error: error.message || 'Failed to undo phase admission.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 10 — GET /api/admin/batches/:id/progress
// Purpose: Group-level progress metrics for a batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/progress', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const students = db.prepare(`
      SELECT 
        sce.id as enrollment_id,
        sce.step1_completed,
        sce.step2_completed,
        sce.step3_completed,
        sce.step4_completed,
        sce.attendance_classes,
        sce.attendance_total,
        sce.assignment_scores,
        sce.phase2_shooting_attended,
        sce.phase2_editing_attended,
        sce.exam_written,
        sce.fee_details,
        u.id as student_id
      FROM batch_students bs
      JOIN users u ON u.id = bs.student_id
      LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id AND (sce.batch_id = bs.batch_id OR (sce.batch_id IS NULL AND sce.course_name = ?))
      WHERE bs.batch_id = ?
    `).all(batch.course_name, batchId);

    const totalStudents = students.length;

    // 1. Initialize stats structures
    let courseSettings = null;
    try {
      if (batch.course_definition_id) {
        courseSettings = db.prepare('SELECT * FROM course_settings WHERE batch_id = ?').get(batch.id);
        if (!courseSettings) {
          courseSettings = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(batch.course_name, 'DEFAULT');
        }
      } else {
        courseSettings = db.prepare('SELECT * FROM course_settings WHERE batch_id = ?').get(batch.id);
        if (!courseSettings) {
          courseSettings = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ? AND batch_id IS NULL').get(batch.course_name, batch.batch_number);
        }
        if (!courseSettings) {
          courseSettings = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(batch.course_name, 'DEFAULT');
        }
      }
    } catch (e) { /* ignore db lookup error */ }

    const phase1 = {
      admitted: 0,
      attendance_qualified: 0,
      attendance_not_qualified: 0,
      exam_passed: 0,
      exam_failed: 0,
      completed: 0,
      assignments: {}
    };
    
    let definedAssignments = [];
    if (courseSettings && courseSettings.has_assignment) {
      try {
        definedAssignments = JSON.parse(courseSettings.assignments || '[]');
        definedAssignments.forEach(def => {
          phase1.assignments[def.id] = 0;
        });
      } catch (e) { /* ignore parse error */ }
    }

    const phase2 = {
      admitted: 0,
      shooting_attended: 0,
      editing_attended: 0,
      completed: 0
    };

    const single_phase = {
      admitted: 0,
      attendance: 0,
      assignment_submitted: 0,
      exam_passed: 0,
      exam_failed: 0,
      completed: 0
    };

    const fees = {
      fully_paid: 0,
      partial: 0,
      due: 0,
      total_collected: 0,
      total_outstanding: 0
    };

    // 2. Aggregate student metrics
    let definedPhasesMetrics = [];
    if (batch.course_definition_id) {
      const courseDef = db.prepare('SELECT definition_json, phase_count FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
      if (courseDef?.definition_json) {
        try {
          const defObj = JSON.parse(courseDef.definition_json);
          const phases = defObj.phases || [];

          // Pre-fetch all student_phase_results for this batch
          const phaseResults = db.prepare(`
            SELECT spr.*, sce.user_id, sce.id as enrollment_id
            FROM student_phase_results spr
            JOIN student_course_enrollments sce ON sce.id = spr.enrollment_id
            WHERE sce.batch_id = ?
          `).all(batch.id);

          const sprByPhaseAndEnrollment = new Map();
          for (const pr of phaseResults) {
            sprByPhaseAndEnrollment.set(`${pr.phase_id}_${pr.enrollment_id}`, pr);
          }

          definedPhasesMetrics = phases.map((p, pIdx) => {
            const pId = p.id || `p_${pIdx + 1}`;
            const req = p.requirements || {};
            const minAtt = req.minAttendancePercent || 75;
            const passExamMark = p.exam?.passMarks || 40;

            const metric = {
              phaseId: pId,
              phaseIndex: pIdx + 1,
              title: p.title || `Phase ${pIdx + 1}`,
              admitted: students.length,
              attendance_qualified: 0,
              attendance_not_qualified: 0,
              assignments_completed: 0,
              exam_passed: 0,
              exam_failed: 0,
              completed: 0
            };

            for (const s of students) {
              const pr = sprByPhaseAndEnrollment.get(`${pId}_${s.enrollment_id}`);
              if (pr) {
                if (pr.attendance_percentage >= minAtt) {
                  metric.attendance_qualified++;
                } else {
                  metric.attendance_not_qualified++;
                }

                if (pr.assignments_total > 0 && pr.assignments_completed >= pr.assignments_total) {
                  metric.assignments_completed++;
                }

                if (pr.exam_marks !== null && pr.exam_marks !== undefined) {
                  if (pr.exam_marks >= passExamMark) {
                    metric.exam_passed++;
                  } else {
                    metric.exam_failed++;
                  }
                }

                if (pr.is_passed === 1) {
                  metric.completed++;
                }
              } else {
                metric.attendance_not_qualified++;
              }
            }

            return metric;
          });
        } catch { /* empty */ }
      }
    }

    for (const s of students) {
      // Core progress metrics
      if (batch.course_definition_id && definedPhasesMetrics.length > 0) {
        // Defined course metrics already aggregated in definedPhasesMetrics
      } else if (batch.course_name === 'Online Filmmaking Course') {
        if (s.step1_completed === 1) {
          phase1.admitted++;
          if (s.step2_completed !== 1) {
            phase1.exam_failed++;
          }
        }
        
        const attTotal = s.attendance_total || courseSettings?.total_classes || 22;
        const isQualified = attTotal > 0 && (s.attendance_classes / attTotal >= 0.8);
        if (isQualified) {
          phase1.attendance_qualified++;
        } else {
          phase1.attendance_not_qualified++;
        }

        if (courseSettings && courseSettings.has_assignment) {
          try {
            const scores = JSON.parse(s.assignment_scores || '{}');
            definedAssignments.forEach(def => {
              if (parseFloat(scores[def.id]) > 0) {
                phase1.assignments[def.id]++;
              }
            });
          } catch(e) { /* ignore parse error */ }
        }
        
        if (s.step2_completed === 1) {
          phase1.exam_passed++;
          phase1.completed++;
        }

        if (s.step3_completed === 1) phase2.admitted++;
        if (s.phase2_shooting_attended === 1) phase2.shooting_attended++;
        if (s.phase2_editing_attended === 1) phase2.editing_attended++;
        if (s.step4_completed === 1) phase2.completed++;
      } else {
        // Workshop / Film Appreciation progress metrics
        single_phase.admitted++;
        if (s.attendance_classes > 0) single_phase.attendance++;
        let hasAnyAssignment = false;
        try {
          const scores = JSON.parse(s.assignment_scores || '{}');
          hasAnyAssignment = Object.values(scores).some(v => parseFloat(v) > 0);
        } catch(e) { /* ignore parse error */ }
        if (hasAnyAssignment) single_phase.assignment_submitted++;
        if (s.step2_completed === 1) {
          single_phase.exam_passed++;
          single_phase.completed++;
        } else if (s.exam_written > 0) {
          // Student has a non-zero exam score but did NOT pass
          single_phase.exam_failed++;
        }
      }

      // Safe Fee aggregation
      if (s.fee_details) {
        try {
          const feeDetails = JSON.parse(s.fee_details);
          if (Array.isArray(feeDetails.phases) && feeDetails.phases.length > 0) {
            // Defined course fee details array
            let collected = 0;
            let outstanding = 0;
            let allPaid = true;

            for (const p of feeDetails.phases) {
              const f = parseFloat(p.full_fee || 0);
              const paid = parseFloat(p.amount_paid || 0);
              const d = parseFloat(p.discount || 0);
              collected += paid;
              outstanding += Math.max(0, f - d - paid);
              if (!(p.status === 'Paid Full' || (f > 0 && paid + d >= f))) {
                allPaid = false;
              }
            }

            fees.total_collected += collected;
            fees.total_outstanding += outstanding;

            if (allPaid) {
              fees.fully_paid++;
            } else if (collected > 0) {
              fees.partial++;
            } else {
              fees.due++;
            }
          } else if (batch.course_name === 'Online Filmmaking Course' || feeDetails.phase1 || feeDetails.phase2) {
            // Filmmaking course has phase1 and phase2 fee details
            const p1 = feeDetails.phase1 || {};
            const p2 = feeDetails.phase2 || {};

            const f1 = parseFloat(p1.full_fee || 0);
            const paid1 = parseFloat(p1.amount_paid || 0);
            const d1 = parseFloat(p1.discount || 0);

            const f2 = parseFloat(p2.full_fee || 0);
            const paid2 = parseFloat(p2.amount_paid || 0);
            const d2 = parseFloat(p2.discount || 0);

            const collected = paid1 + paid2;
            const outstanding = Math.max(0, f1 - d1 - paid1) + Math.max(0, f2 - d2 - paid2);

            fees.total_collected += collected;
            fees.total_outstanding += outstanding;

            const isP1Paid = p1.status === 'Paid Full' || (f1 > 0 && paid1 + d1 >= f1);
            const isP2Paid = p2.status === 'Paid Full' || (f2 > 0 && paid2 + d2 >= f2);

            if (isP1Paid && isP2Paid) {
              fees.fully_paid++;
            } else if (collected > 0) {
              fees.partial++;
            } else {
              fees.due++;
            }
          } else {
            // Workshop course fee details (flat object)
            const f = parseFloat(feeDetails.full_fee || 0);
            const paid = parseFloat(feeDetails.amount_paid || 0);
            const d = parseFloat(feeDetails.discount || 0);
            const outstanding = Math.max(0, f - d - paid);

            fees.total_collected += paid;
            fees.total_outstanding += outstanding;

            const status = feeDetails.status;
            if (status === 'Paid Full' || (f > 0 && paid + d >= f)) {
              fees.fully_paid++;
            } else if (paid > 0) {
              fees.partial++;
            } else {
              fees.due++;
            }
          }
        } catch {
          // Safe fallback if parsing fails
        }
      } else {
        fees.due++;
      }
    }

    // Set exam_failed dynamically as required
    if (batch.course_name === 'Online Filmmaking Course') {
      phase1.exam_failed = Math.max(0, totalStudents - phase1.exam_passed);
    }

    // 3. Aggregate Certificates
    let certificatesIssued = 0;
    let certificatesPending = 0;

    if (batch.course_definition_id) {
      // Defined course certificate calculation
      const courseDef = db.prepare('SELECT phase_count FROM course_definitions WHERE id = ?').get(batch.course_definition_id);
      const totalPhases = courseDef?.phase_count || 1;

      const completedStudents = db.prepare(`
        SELECT sce.id, sce.user_id, sce.course_type, sce.fee_details, COUNT(spr.phase_id) as passed_phases
        FROM student_course_enrollments sce
        JOIN batch_students bs ON bs.student_id = sce.user_id AND bs.batch_id = sce.batch_id
        JOIN student_phase_results spr ON spr.enrollment_id = sce.id AND spr.is_passed = 1
        WHERE bs.batch_id = ?
        GROUP BY sce.id
        HAVING passed_phases >= ?
      `).all(batchId, totalPhases);

      for (const cs of completedStudents) {
        let isFeePending = false;
        if (cs.fee_details) {
          try {
            const fd = typeof cs.fee_details === 'string' ? JSON.parse(cs.fee_details) : cs.fee_details;
            if (Array.isArray(fd.phases)) {
              isFeePending = fd.phases.some(p => p.status !== 'Paid Full' && p.status !== 'Waived');
            } else if (fd.status && fd.status !== 'Paid Full' && fd.status !== 'Waived') {
              isFeePending = true;
            }
          } catch { /* empty */ }
        }
        if (isFeePending) {
          certificatesPending++;
        } else {
          certificatesIssued++;
        }
      }
    } else if (batch.course_name === 'Online Filmmaking Course') {
      certificatesIssued = db.prepare(`
        SELECT COUNT(DISTINCT sce.user_id) as count 
        FROM student_course_enrollments sce 
        JOIN batch_students bs ON bs.student_id = sce.user_id 
        WHERE bs.batch_id = ? AND (sce.batch_id = bs.batch_id OR (sce.batch_id IS NULL AND sce.course_name = ?)) AND sce.step4_completed = 1
      `).get(batchId, batch.course_name).count || 0;

      certificatesPending = db.prepare(`
        SELECT COUNT(DISTINCT sce.user_id) as count 
        FROM student_course_enrollments sce 
        JOIN batch_students bs ON bs.student_id = sce.user_id 
        JOIN student_profiles sp ON sp.user_id = sce.user_id
        WHERE bs.batch_id = ? AND (sce.batch_id = bs.batch_id OR (sce.batch_id IS NULL AND sce.course_name = ?)) AND sp.phase2_completed = 1 AND COALESCE(sce.step4_completed, 0) = 0
      `).get(batchId, batch.course_name).count || 0;
    } else {
      certificatesIssued = db.prepare(`
        SELECT COUNT(DISTINCT sce.user_id) as count 
        FROM student_course_enrollments sce 
        JOIN batch_students bs ON bs.student_id = sce.user_id 
        WHERE bs.batch_id = ? AND (sce.batch_id = bs.batch_id OR (sce.batch_id IS NULL AND sce.course_name = ?)) AND sce.step2_completed = 1
      `).get(batchId, batch.course_name).count || 0;
      
      certificatesPending = 0;
    }

    const certificates = {
      issued: certificatesIssued,
      pending: certificatesPending
    };

    // 4. Return formatted response
    const responseData = {
      course_name: batch.course_name,
      course_definition_id: batch.course_definition_id || null,
      is_defined_course: !!batch.course_definition_id,
      total_students: totalStudents,
      fees,
      certificates
    };

    if (batch.course_definition_id && definedPhasesMetrics.length > 0) {
      responseData.defined_phases = definedPhasesMetrics;
      responseData.phase1 = definedPhasesMetrics[0] || phase1;
      responseData.phase2 = definedPhasesMetrics[1] || phase2;
      responseData.single_phase = definedPhasesMetrics[0] || single_phase;
    } else if (batch.course_name === 'Online Filmmaking Course') {
      responseData.phase1 = phase1;
      responseData.phase2 = phase2;
    } else {
      responseData.single_phase = single_phase;
    }

    res.json(responseData);
  } catch (error) {
    console.error('[Batches] GET /:id/progress error:', error);
    res.status(500).json({ error: 'Internal server error while fetching batch progress metrics.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 11 — GET /api/admin/batches/:id/transitions
// Purpose: Retrieve the status transition history for a specific batch
//          Returns transitions ordered newest-first for timeline display
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/transitions', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ? OR CAST(id AS TEXT) = ?').get(String(slug), String(slug));
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;
    if (isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }

    const batch = db.prepare('SELECT id, batch_name FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const transitions = db.prepare(`
      SELECT
        bst.*,
        u.first_name || ' ' || u.last_name AS triggered_by_name
      FROM batch_status_transitions bst
      LEFT JOIN users u ON u.id = bst.triggered_by
      WHERE bst.batch_id = ?
      ORDER BY bst.transitioned_at DESC
    `).all(batchId);

    res.json(transitions);
  } catch (error) {
    console.error('[Batches] GET /:id/transitions error:', error);
    res.status(500).json({ error: 'Internal server error while fetching transition history.' });
  }
});

export default router;
