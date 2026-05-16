import express from 'express';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/registry/my-courses (For students to see their courses and batches)
router.get('/my-courses', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // A student might be enrolled in multiple courses. The batch is in student_profiles.
    // Wait, the prompt says "by click on the course they can see their batchmates".
    // Is the batch number same for all courses of a student?
    // Let's get their courses and their single batch number.
    
    const profile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
    const batch_number = profile?.batch_number;

    const enrollments = db.prepare('SELECT course_name FROM student_course_enrollments WHERE user_id = ?').all(req.user.id);

    res.json({ courses: enrollments.map(e => e.course_name), batch_number });
  } catch (error) {
    console.error('Registry my-courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/batchmates?course_name=...&batch_number=...
router.get('/batchmates', authenticateToken, (req, res) => {
  try {
    const { course_name, batch_number } = req.query;

    if (!course_name || !batch_number) {
      return res.status(400).json({ error: 'Missing course or batch' });
    }

    // Students who are in the same course and same batch
    // Batch is in student_profiles, course is in student_course_enrollments
    const batchmates = db.prepare(`
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_picture, u.email,
        p.batch_number, p.bio, p.bfiaa_member, p.full_name, p.profession
      FROM users u
      JOIN student_profiles p ON u.id = p.user_id
      JOIN student_course_enrollments c ON u.id = c.user_id
      WHERE u.role = 'student' AND u.is_active = 1 
        AND p.batch_number = ? AND c.course_name = ?
      ORDER BY u.first_name ASC
    `).all(batch_number, course_name);

    res.json({ batchmates });
  } catch (error) {
    console.error('Registry batchmates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/courses (For Admin/Teacher)
router.get('/courses', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const courses = db.prepare(`
      SELECT DISTINCT course_name 
      FROM student_course_enrollments
      ORDER BY course_name ASC
    `).all();

    res.json({ courses: courses.map(c => c.course_name) });
  } catch (error) {
    console.error('Registry courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/batches?course_name=... (For Admin/Teacher)
router.get('/batches', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { course_name } = req.query;
    if (!course_name) return res.status(400).json({ error: 'Missing course' });

    const batches = db.prepare(`
      SELECT DISTINCT p.batch_number
      FROM student_profiles p
      JOIN student_course_enrollments c ON p.user_id = c.user_id
      WHERE c.course_name = ? AND p.batch_number IS NOT NULL AND p.batch_number != ''
      ORDER BY p.batch_number DESC
    `).all(course_name);

    res.json({ batches: batches.map(b => b.batch_number) });
  } catch (error) {
    console.error('Registry batches error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/search?q=... (For Admin/Teacher to global search)
router.get('/search', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { q } = req.query;
    if (!q || q.trim() === '') {
      return res.json({ batchmates: [] });
    }

    const searchQuery = `%${q}%`;
    const batchmates = db.prepare(`
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_picture, u.email,
        p.batch_number, p.bio, p.bfiaa_member, p.full_name, p.profession,
        (SELECT GROUP_CONCAT(course_name, ', ') FROM student_course_enrollments WHERE user_id = u.id) as courses
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student' AND u.is_active = 1 
        AND (
          u.first_name LIKE ? OR 
          u.last_name LIKE ? OR 
          u.email LIKE ? OR 
          p.full_name LIKE ? OR 
          p.batch_number LIKE ?
        )
      ORDER BY u.first_name ASC
      LIMIT 50
    `).all(searchQuery, searchQuery, searchQuery, searchQuery, searchQuery);

    res.json({ batchmates });
  } catch (error) {
    console.error('Registry search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/teachers (For Instructor Directory)
router.get('/teachers', authenticateToken, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_picture, u.email, u.role
      FROM users u
      WHERE u.role = 'instructor' AND u.is_active = 1
      ORDER BY u.first_name ASC
    `).all();

    res.json({ teachers });
  } catch (error) {
    console.error('Registry teachers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
