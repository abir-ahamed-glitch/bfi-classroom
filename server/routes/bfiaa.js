import express from 'express';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get BFIAA members
router.get('/', authenticateToken, (req, res) => {
  try {
    const members = db.prepare(`
      SELECT m.*, u.profile_picture, u.username
      FROM bfiaa_members m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.is_active = 1
      ORDER BY m.member_since DESC
    `).all();

    res.json({ members });
  } catch (error) {
    console.error('BFIAA fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
