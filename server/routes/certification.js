import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET Certificate Template (for Admin)
router.get('/template', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM certificate_templates ORDER BY id DESC LIMIT 1').get();
    
    if (!template) {
      // Return a default empty structure if none exists
      return res.json({
        layout_json: '{}',
        logo_url: '',
        signature_url: '',
        background_url: ''
      });
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST/PUT Certificate Template (for Admin)
router.post('/template', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { layout_json, logo_url, signature_url, background_url } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO certificate_templates (layout_json, logo_url, signature_url, background_url, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      layout_json || '{}', 
      logo_url || '', 
      signature_url || '', 
      background_url || '', 
      req.user.id
    );

    res.json({ message: 'Certificate template saved successfully.' });
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ error: 'Internal server error while saving template.' });
  }
});

// GET My Certificates details (Student View)
// Returns all completed courses and their certificate data
router.get('/my-certificates', authenticateToken, (req, res) => {
  try {
    const student = db.prepare(`
      SELECT p.full_name, p.student_id, p.batch_number
      FROM student_profiles p 
      WHERE p.user_id = ?
    `).get(req.user.id);

    if (!student) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }

    const completions = db.prepare(`
      SELECT * FROM student_course_enrollments 
      WHERE user_id = ? AND step4_completed = 1
    `).all(req.user.id);

    // Fetch the latest template layout
    const template = db.prepare('SELECT * FROM certificate_templates ORDER BY id DESC LIMIT 1').get();

    const certificates = completions.map(course => ({
      courseName: course.course_name,
      studentDetails: {
        fullName: student.full_name,
        studentId: student.student_id,
        batchNumber: student.batch_number,
        completionDate: course.updated_at
      }
    }));

    res.json({
      certificates,
      template: template || { layout_json: '{}', logo_url: '', signature_url: '', background_url: '' }
    });

  } catch (error) {
    console.error('Error fetching student certificates:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Deprecated single route for compatibility
router.get('/my-certificate', authenticateToken, (req, res) => {
  try {
    const student = db.prepare(`
      SELECT p.full_name, p.student_id, p.batch_number, p.phase2_completed 
      FROM student_profiles p 
      WHERE p.user_id = ?
    `).get(req.user.id);

    if (!student || student.phase2_completed !== 1) {
      return res.status(403).json({ error: 'Certificate not unlocked.' });
    }

    const template = db.prepare('SELECT * FROM certificate_templates ORDER BY id DESC LIMIT 1').get();

    res.json({
      studentDetails: {
        fullName: student.full_name,
        studentId: student.student_id,
        batchNumber: student.batch_number,
        issueDate: new Date().toISOString()
      },
      template: template || { layout_json: '{}', logo_url: '', signature_url: '', background_url: '' }
    });
  } catch (err) {
    console.error('Certificate retrieval error:', err);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;
