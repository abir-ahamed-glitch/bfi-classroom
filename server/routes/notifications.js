import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import preferencesMigration from '../db/migrations/20261115_notification_preferences.cjs';

const router = express.Router();
const { categories, notificationCategory } = preferencesMigration;
const studentOnly = [authenticateToken, requireRole('student')];
const visibleNotification = `NOT EXISTS (
  SELECT 1 FROM muted_notification_categories AS muted
  JOIN users ON users.id = muted.user_id AND users.role = 'student'
  WHERE muted.user_id = notifications.user_id
    AND muted.category = ${notificationCategory('notifications.type')}
)`;

function getPreferences(userId) {
  const muted = new Set(db.prepare('SELECT category FROM muted_notification_categories WHERE user_id = ?')
    .all(userId).map(row => row.category));
  return Object.fromEntries(categories.map(category => [category, !muted.has(category)]));
}

router.get('/preferences', ...studentOnly, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ preferences: getPreferences(req.user.id) });
});

router.patch('/preferences', ...studentOnly, (req, res) => {
  const updates = Object.entries(req.body || {});
  if (!updates.length || updates.some(([category, enabled]) => !categories.includes(category) || typeof enabled !== 'boolean')) {
    return res.status(400).json({ error: 'Provide one or more supported notification preferences as booleans.' });
  }
  db.transaction(() => {
    const mute = db.prepare('INSERT OR IGNORE INTO muted_notification_categories (user_id, category) VALUES (?, ?)');
    const enable = db.prepare('DELETE FROM muted_notification_categories WHERE user_id = ? AND category = ?');
    for (const [category, enabled] of updates) (enabled ? enable : mute).run(req.user.id, category);
  })();
  const preferences = getPreferences(req.user.id);
  req.app.get('io')?.to(`user:${req.user.id}`).emit('notification_preferences_changed');
  res.set('Cache-Control', 'no-store').json({ preferences });
});

// Get all notifications for the authenticated user
router.get('/', authenticateToken, (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications 
      WHERE user_id = ? AND ${visibleNotification}
      ORDER BY created_at DESC 
      LIMIT 100
    `).all(req.user.id);
    res.json({ notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get unread notification count
router.get('/unread-count', authenticateToken, (req, res) => {
  try {
    const result = db.prepare(`
      SELECT COUNT(*) as unreadCount 
      FROM notifications 
      WHERE user_id = ? AND is_read = 0 AND ${visibleNotification}
    `).get(req.user.id);
    res.json({ unreadCount: result.unreadCount });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Mark a single notification as read
router.put('/:id/read', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare(`
      UPDATE notifications 
      SET is_read = 1 
      WHERE id = ? AND user_id = ?
    `).run(id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Mark all notifications as read
router.put('/read-all', authenticateToken, (req, res) => {
  try {
    db.prepare(`
      UPDATE notifications 
      SET is_read = 1 
      WHERE user_id = ? AND is_read = 0 AND ${visibleNotification}
    `).run(req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
