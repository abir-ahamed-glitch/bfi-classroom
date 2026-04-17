import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import { authenticateToken, authLimiter, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'bfi-classroom-super-secret-key-change-in-production-2024';

// Login route
router.post('/login', authLimiter, sanitizeInput, (req, res) => {
  const { username, password, type = 'student' } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required' });
  }

  try {
    const isEmail = username.includes('@');
    const query = isEmail 
      ? `SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1`
      : `SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1`;
      
    const user = db.prepare(query).get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = bcrypt.compareSync(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Role Based Separation
    if (type === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: This portal is for Administrators only.' });
    }
    
    if (type === 'student' && user.role === 'admin') {
      return res.status(403).json({ error: 'Administrators must log in via the designated Admin Portal.' });
    }

    // Update last login
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    // Generate JWT tokens
    const accessToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: `${user.first_name} ${user.last_name}` },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '1h' }
    );
    
    // In a real app we'd use refresh tokens too
    
    // Get profile data if student
    let profile = null;
    if (user.role === 'student') {
      profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
    } else if (user.role === 'instructor' || user.role === 'admin') {
      profile = { full_name: `${user.first_name} ${user.last_name}` };
    }

    res.json({
      message: 'Login successful',
      token: accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        profilePicture: user.profile_picture,
        batch: profile?.batch_number,
        studentId: profile?.student_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Get current user details
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.role,
        u.first_name,
        u.last_name,
        u.profile_picture,
        sp.batch_number,
        sp.student_id
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.id = ?
    `).get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      profilePicture: user.profile_picture,
      batch: user.batch_number,
      studentId: user.student_id
    });
  } catch (error) {
    console.error('Fetch me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update display name (works for admin and student)
router.put('/update-name', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { first_name, last_name } = req.body;
    if (!first_name?.trim()) {
      return res.status(400).json({ error: 'First name is required.' });
    }
    db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?')
      .run(first_name.trim(), (last_name || '').trim(), req.user.id);

    const updated = db.prepare('SELECT id, username, email, role, first_name, last_name, profile_picture FROM users WHERE id = ?').get(req.user.id);
    res.json({
      message: 'Name updated successfully',
      user: {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        role: updated.role,
        firstName: updated.first_name,
        lastName: updated.last_name,
        profilePicture: updated.profile_picture,
      }
    });
  } catch (error) {
    console.error('Name update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
