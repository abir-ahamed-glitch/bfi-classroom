import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { runBatchStatusAutomation } from '../utils/batchStatusAutomation.js';

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
    const status = req.query.status || null;
    const course = req.query.course || null;
    const search = req.query.search ? `%${req.query.search}%` : null;

    const batches = db.prepare(`
      SELECT 
        b.*,
        (SELECT COUNT(*) FROM batch_students WHERE batch_id = b.id) as student_count
      FROM batches b
      WHERE 
        (:status IS NULL OR b.status = :status)
        AND (:course IS NULL OR b.course_name = :course)
        AND (
          :search IS NULL OR 
          b.batch_name LIKE :search OR 
          b.batch_number LIKE :search
        )
      ORDER BY CAST(b.batch_number AS INTEGER) DESC
    `).all({ status, course, search });

    for (const batch of batches) {
      const p1Count = db.prepare(`
        SELECT COUNT(*) as count
        FROM batch_students bs
        JOIN student_course_enrollments sce
          ON sce.user_id = bs.student_id
          AND sce.course_name = ?
        WHERE bs.batch_id = ? AND sce.step2_completed = 1
      `).get(batch.course_name, batch.id).count || 0;

      batch.phase1_completed_count = p1Count;
    }

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
    const batchId = parseInt(req.params.id, 10);
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
    const { batch_name, batch_number, course_name, status, start_date, end_date, description } = req.body;

    if (!batch_name || typeof batch_name !== 'string' || batch_name.trim() === '') {
      return res.status(400).json({ error: 'Batch name is required.' });
    }
    if (!batch_number || typeof batch_number !== 'string' || batch_number.trim() === '') {
      return res.status(400).json({ error: 'Batch number is required.' });
    }
    if (!course_name || typeof course_name !== 'string' || course_name.trim() === '') {
      return res.status(400).json({ error: 'Course name is required.' });
    }

    // Validate unique batch number and name
    const existingBatch = db.prepare('SELECT id FROM batches WHERE batch_number = ? OR LOWER(batch_name) = ?').get(batch_number, batch_name.toLowerCase());
    if (existingBatch) {
      return res.status(409).json({ error: 'A batch with this name or number already exists' });
    }

    // Validate course name
    if (typeof course_name !== 'string' || course_name.trim() === '') {
      return res.status(400).json({ error: 'Course name is required.' });
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
      INSERT INTO batches (batch_name, batch_number, course_name, status, start_date, end_date, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batch_name, 
      batch_number, 
      course_name, 
      finalStatus, 
      start_date || null, 
      end_date || null, 
      description || null, 
      req.user.id
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
    const batchId = parseInt(req.params.id, 10);
    const current = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
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
    const batchId = parseInt(req.params.id, 10);
    const batch = db.prepare(`
      SELECT b.*, COUNT(bs.id) as student_count
      FROM batches b
      LEFT JOIN batch_students bs ON bs.batch_id = b.id
      WHERE b.id = ?
      GROUP BY b.id
    `).get(batchId);

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.student_count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete a batch that has enrolled students. Please remove the students first.' 
      });
    }

    db.prepare('DELETE FROM batches WHERE id = ?').run(batchId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Batches] DELETE /:id error:', error);
    res.status(500).json({ error: 'Internal server error while deleting batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 6 — GET /api/admin/batches/:id/students
// Purpose: List all students assigned to a specific batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
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
      LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id AND sce.course_name = b.course_name
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
      const batchRecord = db.prepare('SELECT course_name FROM batches WHERE id = ?').get(batchId);
      if (batchRecord && batchRecord.course_name) {
        const courseType = batchRecord.course_name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
        const enrollStmt = db.prepare('INSERT OR IGNORE INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, ?, ?)');
        db.transaction(() => {
          for (const s of students) {
            enrollStmt.run(s.user_id, batchRecord.course_name, courseType);
          }
        })();
      }

      const allEnrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id IN (' + students.map(s => s.user_id).join(',') + ')').all();
      
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
// Purpose: List students not yet assigned to any batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/available-students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
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
      LEFT JOIN batch_students bs ON bs.student_id = u.id
      WHERE u.role = 'student'
        AND bs.id IS NULL  -- not in any batch
        AND (
          :search IS NULL OR
          u.first_name LIKE :search OR
          u.last_name LIKE :search OR
          sp.student_id LIKE :search
        )
      ORDER BY u.first_name ASC
    `).all({ search });

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
    const batchId = parseInt(req.params.id, 10);
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
        const existing = db.prepare(`
          SELECT b.batch_number 
          FROM batch_students bs 
          JOIN batches b ON b.id = bs.batch_id 
          WHERE bs.student_id = ?
        `).get(studentId);

        if (existing) {
          errors.push({
            student_id: studentId,
            message: `Already assigned to Batch ${existing.batch_number}`
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

        // Enroll student in the batch's course if not already enrolled
        const courseType = batch.course_name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
        const existingEnrollment = db.prepare('SELECT id FROM student_course_enrollments WHERE user_id = ? AND course_name = ?').get(studentId, batch.course_name);
        if (!existingEnrollment) {
          db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, ?, ?)').run(studentId, batch.course_name, courseType);
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
    const batchId = parseInt(req.params.id, 10);
    const studentId = parseInt(req.params.studentId, 10);

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status === 'completed' || batch.status === 'archived') {
      return res.status(400).json({ error: 'Cannot remove students from a completed or archived batch' });
    }

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const removeTransaction = db.transaction(() => {
      db.prepare('DELETE FROM batch_students WHERE batch_id = ? AND student_id = ?').run(batchId, studentId);
      db.prepare('UPDATE student_profiles SET batch_number = NULL WHERE user_id = ?').run(studentId);
    });

    removeTransaction();

    res.json({ success: true });
  } catch (error) {
    console.error('[Batches] DELETE /:id/students/:studentId error:', error);
    res.status(500).json({ error: 'Internal server error while removing student from batch.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 9B — POST /api/admin/batches/:id/students/:studentId/admit-phase2
// Purpose: Admit a student to Phase 2 of a batch's course
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/students/:studentId/admit-phase2', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    const studentId = parseInt(req.params.studentId, 10);

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const association = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchId, studentId);
    if (!association) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const admitTransaction = db.transaction(() => {
      // Update student_course_enrollments
      db.prepare(`
        UPDATE student_course_enrollments
        SET step3_completed = 1, updated_at = datetime('now')
        WHERE user_id = ? AND course_name = ?
      `).run(studentId, batch.course_name);

      // Update student_profiles
      db.prepare(`
        UPDATE student_profiles
        SET phase2_admitted = 1, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(studentId);
    });

    admitTransaction();

    res.json({ success: true });
  } catch (error) {
    console.error('[Batches] POST /:id/students/:studentId/admit-phase2 error:', error);
    res.status(500).json({ error: 'Internal server error while admitting student to Phase 2.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint 10 — GET /api/admin/batches/:id/progress
// Purpose: Group-level progress metrics for a batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/progress', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const students = db.prepare(`
      SELECT 
        sce.step1_completed,
        sce.step2_completed,
        sce.step3_completed,
        sce.step4_completed,
        sce.attendance_classes,
        sce.attendance_total,
        sce.assignment_screenplay,
        sce.assignment_shooting_script,
        sce.phase2_shooting_attended,
        sce.phase2_editing_attended,
        sce.fee_details,
        u.id as student_id
      FROM batch_students bs
      JOIN users u ON u.id = bs.student_id
      LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id AND sce.course_name = ?
      WHERE bs.batch_id = ?
    `).all(batch.course_name, batchId);

    const totalStudents = students.length;

    // 1. Initialize stats structures
    const phase1 = {
      admitted: 0,
      attendance_qualified: 0,
      attendance_not_qualified: 0,
      screenplay_submitted: 0,
      shooting_script_submitted: 0,
      exam_passed: 0,
      exam_failed: 0,
      completed: 0
    };

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
    for (const s of students) {
      // Core progress metrics
      if (batch.course_name === 'Online Filmmaking Course') {
        if (s.step1_completed === 1) phase1.admitted++;
        
        const isQualified = s.attendance_total > 0 && (s.attendance_classes / s.attendance_total >= 0.8);
        if (isQualified) {
          phase1.attendance_qualified++;
        } else {
          phase1.attendance_not_qualified++;
        }

        if (s.assignment_screenplay > 0) phase1.screenplay_submitted++;
        if (s.assignment_shooting_script > 0) phase1.shooting_script_submitted++;
        
        if (s.step2_completed === 1) {
          phase1.exam_passed++;
          phase1.completed++;
        }

        if (s.step3_completed === 1) phase2.admitted++;
        if (s.phase2_shooting_attended === 1) phase2.shooting_attended++;
        if (s.phase2_editing_attended === 1) phase2.editing_attended++;
        if (s.step4_completed === 1) phase2.completed++;
      } else {
        // Workshop progress metrics
        if (s.step1_completed === 1) single_phase.admitted++;
        if (s.attendance_classes > 0) single_phase.attendance++;
        if (s.assignment_screenplay > 0 || s.assignment_shooting_script > 0) single_phase.assignment_submitted++;
        if (s.step2_completed === 1) {
          single_phase.exam_passed++;
          single_phase.completed++;
        }
      }

      // Safe Fee aggregation
      if (s.fee_details) {
        try {
          const feeDetails = JSON.parse(s.fee_details);
          if (batch.course_name === 'Online Filmmaking Course') {
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
        } catch (e) {
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

    if (batch.course_name === 'Online Filmmaking Course') {
      certificatesIssued = db.prepare(`
        SELECT COUNT(*) as count 
        FROM student_course_enrollments sce 
        JOIN batch_students bs ON bs.student_id = sce.user_id 
        WHERE bs.batch_id = ? AND sce.course_name = ? AND sce.step4_completed = 1
      `).get(batchId, batch.course_name).count || 0;

      certificatesPending = db.prepare(`
        SELECT COUNT(*) as count 
        FROM student_course_enrollments sce 
        JOIN batch_students bs ON bs.student_id = sce.user_id 
        JOIN student_profiles sp ON sp.user_id = sce.user_id
        WHERE bs.batch_id = ? AND sce.course_name = ? AND sp.phase2_completed = 1 AND COALESCE(sce.step4_completed, 0) = 0
      `).get(batchId, batch.course_name).count || 0;
    } else {
      certificatesIssued = db.prepare(`
        SELECT COUNT(*) as count 
        FROM student_course_enrollments sce 
        JOIN batch_students bs ON bs.student_id = sce.user_id 
        WHERE bs.batch_id = ? AND sce.course_name = ? AND sce.step2_completed = 1
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
      total_students: totalStudents,
      fees,
      certificates
    };

    if (batch.course_name === 'Online Filmmaking Course') {
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
    const batchId = parseInt(req.params.id, 10);
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
