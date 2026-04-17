import express from 'express';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();

// Get all experiences for current user
router.get('/', authenticateToken, (req, res) => {
  try {
    const experiences = db.prepare(`
      SELECT * FROM student_experiences 
      WHERE user_id = ? 
      ORDER BY start_date DESC
    `).all(req.user.id);

    res.json(experiences || []);
  } catch (error) {
    console.error('Fetch experiences error:', error);
    res.status(500).json({ error: 'Internal server error while fetching experiences' });
  }
});

// Create a new experience
router.post('/', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { 
      title, organization, experience_type, start_date, end_date, description 
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Experience title/role is required' });
    }

    const insertExp = db.prepare(`
      INSERT INTO student_experiences (
        user_id, title, organization, experience_type, start_date, end_date, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertExp.run(
      req.user.id, 
      title, 
      organization || '', 
      experience_type || 'Other', 
      start_date || '', 
      end_date || '', 
      description || ''
    );

    res.status(201).json({ 
      message: 'Experience added successfully', 
      id: result.lastInsertRowid 
    });
  } catch (error) {
    console.error('Create experience error:', error);
    res.status(500).json({ error: 'Internal server error while saving experience' });
  }
});

// Delete an experience
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM student_experiences WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Experience not found or unauthorized' });
    }
    
    res.json({ message: 'Experience deleted successfully' });
  } catch (error) {
    console.error('Delete experience error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
