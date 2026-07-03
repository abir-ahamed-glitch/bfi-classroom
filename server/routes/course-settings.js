import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all course settings
router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM course_settings ORDER BY course_name ASC, batch_number ASC').all();
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
      course_name,
      batch_number = 'DEFAULT',
      total_classes,
      exam_max_score,
      exam_pass_mark,
      has_assignment,
      assignments,
      has_phase2
    } = req.body;

    if (!course_name) {
      return res.status(400).json({ error: 'course_name is required' });
    }

    const has_assignment_int = has_assignment ? 1 : 0;
    const has_phase2_int = has_phase2 ? 1 : 0;
    const assignments_str = JSON.stringify(assignments || []);

    const stmt = db.prepare(`
      INSERT INTO course_settings 
      (course_name, batch_number, total_classes, exam_max_score, exam_pass_mark, has_assignment, assignments, has_phase2, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(course_name, batch_number) DO UPDATE SET
        total_classes = excluded.total_classes,
        exam_max_score = excluded.exam_max_score,
        exam_pass_mark = excluded.exam_pass_mark,
        has_assignment = excluded.has_assignment,
        assignments = excluded.assignments,
        has_phase2 = excluded.has_phase2,
        updated_at = datetime('now', 'localtime')
    `);

    const saveTransaction = db.transaction(() => {
      stmt.run(
        course_name,
        batch_number,
        parseInt(total_classes) || 22,
        parseInt(exam_max_score) || 100,
        parseInt(exam_pass_mark) || 33,
        has_assignment_int,
        assignments_str,
        has_phase2_int
      );

      if (batch_number === 'DEFAULT') {
        db.prepare(`
          UPDATE student_course_enrollments
          SET attendance_total = ?,
              updated_at = datetime('now')
          WHERE course_name = ? AND user_id NOT IN (
            SELECT bs.student_id
            FROM batch_students bs
            JOIN batches b ON bs.batch_id = b.id
            JOIN course_settings cs ON cs.course_name = b.course_name AND cs.batch_number = b.batch_number
            WHERE b.course_name = ? AND cs.batch_number != 'DEFAULT'
          )
        `).run(parseInt(total_classes) || 22, course_name, course_name);
      } else {
        db.prepare(`
          UPDATE student_course_enrollments
          SET attendance_total = ?,
              updated_at = datetime('now')
          WHERE course_name = ? AND user_id IN (
            SELECT bs.student_id
            FROM batch_students bs
            JOIN batches b ON bs.batch_id = b.id
            WHERE b.course_name = ? AND b.batch_number = ?
          )
        `).run(parseInt(total_classes) || 22, course_name, course_name, batch_number);
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
    
    if (batchNumber === 'DEFAULT') {
      return res.status(400).json({ error: 'Cannot delete the default setting for a course.' });
    }

    db.prepare('DELETE FROM course_settings WHERE course_name = ? AND batch_number = ?').run(courseName, batchNumber);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting course settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
