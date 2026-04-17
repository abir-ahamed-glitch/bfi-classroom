import express from 'express';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();

// Get list of conversations
router.get('/conversations', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    // Get users who have exchanged messages with current user
    const chats = db.prepare(`
      SELECT DISTINCT 
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_user_id,
        u.first_name, u.last_name, u.role, u.username, u.profile_picture,
        (SELECT content FROM messages 
         WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) 
         ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT count(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
      FROM messages m
      JOIN users u ON u.id = (CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END)
      WHERE sender_id = ? OR receiver_id = ?
    `).all(userId, userId, userId, userId, userId, userId, userId);

    res.json({ chats });
  } catch (error) {
    console.error('Conversations fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get messages for specific user
router.get('/messages/:otherId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = req.params.otherId;

    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at ASC
    `).all(userId, otherId, otherId, userId);

    // Mark messages as read
    db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(otherId, userId);

    res.json({ messages });
  } catch (error) {
    console.error('Messages fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send message
router.post('/messages', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { receiver_id, content } = req.body;
    const sender_id = req.user.id;

    if (!content || !receiver_id) {
      return res.status(400).json({ error: 'Missing content or receiver' });
    }

    const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)')
      .run(sender_id, receiver_id, content);

    res.status(201).json({ 
      message: 'Sent', 
      id: result.lastInsertRowid,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user list for starting new conversation
router.get('/users', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const users = db.prepare(`
      SELECT id, first_name, last_name, role, username, profile_picture
      FROM users
      WHERE id != ? AND is_active = 1
      ORDER BY role, first_name
    `).all(userId);

    res.json({ users });
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

