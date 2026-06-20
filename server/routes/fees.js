import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET all batch-wise course fees
router.get('/batch-fees', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const fees = db.prepare('SELECT * FROM batch_course_fees ORDER BY course_name ASC, batch_number DESC').all();
    res.json(fees);
  } catch (error) {
    console.error('[Fees API] Error fetching batch fees:', error);
    res.status(500).json({ error: 'Failed to fetch batch fees' });
  }
});

// GET available batches for a course (drawn from active enrollments)
router.get('/batch-fees/available-batches', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { course_name } = req.query;
    if (!course_name) {
      return res.status(400).json({ error: 'Course name is required.' });
    }

    const batches = db.prepare(`
      SELECT DISTINCT sp.batch_number 
      FROM student_profiles sp
      JOIN student_course_enrollments sce ON sce.user_id = sp.user_id
      WHERE sce.course_name = ? AND sp.batch_number IS NOT NULL AND sp.batch_number != ''
      ORDER BY sp.batch_number DESC
    `).all(course_name).map(r => r.batch_number);

    res.json(batches);
  } catch (error) {
    console.error('[Fees API] Error fetching available batches:', error);
    res.status(500).json({ error: 'Failed to fetch available batches' });
  }
});

// POST (create or update) batch-wise course fee
router.post('/batch-fees', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { course_name, batch_number, phase1_fee, phase2_fee, full_fee } = req.body;

    if (!course_name || !batch_number) {
      return res.status(400).json({ error: 'Course name and batch number are required.' });
    }

    const p1 = parseInt(phase1_fee, 10) || 0;
    const p2 = parseInt(phase2_fee, 10) || 0;
    const f = parseInt(full_fee, 10) || 0;

    // Upsert into batch_course_fees
    db.prepare(`
      INSERT INTO batch_course_fees (course_name, batch_number, phase1_fee, phase2_fee, full_fee, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(course_name, batch_number) DO UPDATE SET
        phase1_fee = excluded.phase1_fee,
        phase2_fee = excluded.phase2_fee,
        full_fee = excluded.full_fee,
        updated_at = datetime('now')
    `).run(course_name, batch_number, p1, p2, f);

    res.json({ message: 'Batch fee updated successfully.' });
  } catch (error) {
    console.error('[Fees API] Error saving batch fee:', error);
    res.status(500).json({ error: 'Failed to save batch fee' });
  }
});

// DELETE a batch-wise course fee
router.delete('/batch-fees/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM batch_course_fees WHERE id = ?').run(id);
    res.json({ message: 'Batch fee deleted successfully.' });
  } catch (error) {
    console.error('[Fees API] Error deleting batch fee:', error);
    res.status(500).json({ error: 'Failed to delete batch fee' });
  }
});

export default router;
