import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all course settings
router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const settings = db.prepare(`
      SELECT cs.*, b.batch_name, b.course_definition_id
      FROM course_settings cs
      LEFT JOIN batches b ON cs.batch_id = b.id
      ORDER BY cs.course_name ASC, cs.batch_number ASC
    `).all();
    // Parse assignments JSON
    settings.forEach(s => {
      try {
        s.assignments = JSON.parse(s.assignments);
      } catch(e) {
        s.assignments = [];
      }
      s.has_assignment = s.has_assignment === 1;
      s.has_phase2 = s.has_phase2 === 1;
    });
    res.json(settings);
  } catch (err) {
    console.error('Error fetching course settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update or insert a course setting
router.put('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const {
      batch_id,
      course_name,
      batch_number = 'DEFAULT',
      total_classes,
      exam_max_score,
      exam_pass_mark,
      has_assignment,
      assignments,
      has_phase2
    } = req.body;

    let effectiveBatchId = batch_id ? parseInt(batch_id, 10) : null;
    let effectiveCourseName = course_name;
    let effectiveBatchNumber = batch_number;

    if (effectiveBatchId) {
      const bRow = db.prepare('SELECT id, course_name, batch_number FROM batches WHERE id = ?').get(effectiveBatchId);
      if (bRow) {
        effectiveCourseName = bRow.course_name;
        effectiveBatchNumber = bRow.batch_number;
      }
    }

    if (!effectiveBatchId && !effectiveCourseName) {
      return res.status(400).json({ error: 'course_name is required' });
    }

    const has_assignment_int = has_assignment ? 1 : 0;
    const has_phase2_int = has_phase2 ? 1 : 0;
    const assignments_str = JSON.stringify(assignments || []);
    const totalClassesInt = parseInt(total_classes, 10) || 22;
    const examMaxScoreInt = parseInt(exam_max_score, 10) || 100;
    const examPassMarkInt = parseInt(exam_pass_mark, 10) || 33;

    const saveTransaction = db.transaction(() => {
      if (effectiveBatchId) {
        db.prepare(`
          INSERT INTO course_settings 
          (batch_id, course_name, batch_number, total_classes, exam_max_score, exam_pass_mark, has_assignment, assignments, has_phase2, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
          ON CONFLICT(batch_id) WHERE batch_id IS NOT NULL DO UPDATE SET
            total_classes = excluded.total_classes,
            exam_max_score = excluded.exam_max_score,
            exam_pass_mark = excluded.exam_pass_mark,
            has_assignment = excluded.has_assignment,
            assignments = excluded.assignments,
            has_phase2 = excluded.has_phase2,
            course_name = excluded.course_name,
            batch_number = excluded.batch_number,
            updated_at = datetime('now', 'localtime')
        `).run(
          effectiveBatchId,
          effectiveCourseName,
          effectiveBatchNumber,
          totalClassesInt,
          examMaxScoreInt,
          examPassMarkInt,
          has_assignment_int,
          assignments_str,
          has_phase2_int
        );

        db.prepare(`
          UPDATE student_course_enrollments
          SET attendance_total = ?,
              updated_at = datetime('now')
          WHERE batch_id = ?
        `).run(totalClassesInt, effectiveBatchId);
      } else {
        db.prepare(`
          INSERT INTO course_settings 
          (batch_id, course_name, batch_number, total_classes, exam_max_score, exam_pass_mark, has_assignment, assignments, has_phase2, updated_at)
          VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
          ON CONFLICT(course_name, batch_number) WHERE batch_id IS NULL DO UPDATE SET
            total_classes = excluded.total_classes,
            exam_max_score = excluded.exam_max_score,
            exam_pass_mark = excluded.exam_pass_mark,
            has_assignment = excluded.has_assignment,
            assignments = excluded.assignments,
            has_phase2 = excluded.has_phase2,
            updated_at = datetime('now', 'localtime')
        `).run(
          effectiveCourseName,
          effectiveBatchNumber,
          totalClassesInt,
          examMaxScoreInt,
          examPassMarkInt,
          has_assignment_int,
          assignments_str,
          has_phase2_int
        );

        if (effectiveBatchNumber === 'DEFAULT') {
          db.prepare(`
            UPDATE student_course_enrollments
            SET attendance_total = ?,
                updated_at = datetime('now')
            WHERE course_name = ? AND course_definition_id IS NULL AND user_id NOT IN (
              SELECT bs.student_id
              FROM batch_students bs
              JOIN batches b ON bs.batch_id = b.id
              JOIN course_settings cs ON (cs.batch_id = b.id OR (cs.course_name = b.course_name AND cs.batch_number = b.batch_number))
              WHERE b.course_name = ? AND cs.batch_number != 'DEFAULT'
            )
          `).run(totalClassesInt, effectiveCourseName, effectiveCourseName);
        } else {
          db.prepare(`
            UPDATE student_course_enrollments
            SET attendance_total = ?,
                updated_at = datetime('now')
            WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) 
              AND course_definition_id IS NULL 
              AND (
                batch_id IN (
                  SELECT b.id
                  FROM batches b
                  WHERE LOWER(TRIM(b.course_name)) = LOWER(TRIM(?)) 
                    AND TRIM(b.batch_number) = TRIM(?) 
                    AND b.course_definition_id IS NULL
                )
                OR (
                  batch_id IS NULL AND user_id IN (
                    SELECT sp.user_id
                    FROM student_profiles sp
                    WHERE TRIM(sp.batch_number) = TRIM(?)
                    UNION
                    SELECT bs.student_id
                    FROM batch_students bs
                    JOIN batches b2 ON bs.batch_id = b2.id
                    WHERE LOWER(TRIM(b2.course_name)) = LOWER(TRIM(?))
                      AND TRIM(b2.batch_number) = TRIM(?)
                      AND b2.course_definition_id IS NULL
                  )
                )
              )
          `).run(
            totalClassesInt,
            effectiveCourseName,
            effectiveCourseName,
            effectiveBatchNumber,
            effectiveBatchNumber,
            effectiveCourseName,
            effectiveBatchNumber
          );
        }
      }
    });

    saveTransaction();

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving course settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a course setting (cannot delete DEFAULT)
router.delete('/:courseName/:batchNumber', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { courseName, batchNumber } = req.params;
    const batchId = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;
    
    if (batchNumber === 'DEFAULT' && !batchId) {
      return res.status(400).json({ error: 'Cannot delete the default setting for a course.' });
    }

    if (batchId) {
      db.prepare('DELETE FROM course_settings WHERE batch_id = ?').run(batchId);
    } else {
      db.prepare('DELETE FROM course_settings WHERE course_name = ? AND batch_number = ? AND batch_id IS NULL').run(courseName, batchNumber);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting course settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
