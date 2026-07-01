import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticateToken, requireRole, sanitizeInput } from '../middleware/auth.js';
import { encryptMessageContent } from '../utils/messageCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ── Upload directory ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/broadcast-attachments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ── Multer config ───────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const broadcastStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `broadcast-${req.user.id}-${Date.now()}-${safeName}`);
  },
});

const broadcastUpload = multer({
  storage: broadcastStorage,
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

// ── broadcastAuth middleware ────────────────────────────────────────────────
function broadcastAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  if (req.user.role === 'admin') return next();

  if (req.user.role === 'instructor') {
    const permission = db.prepare(`
      SELECT * FROM broadcast_permissions
      WHERE teacher_id = ? AND is_active = 1 AND revoked_at IS NULL
    `).get(req.user.id);

    if (!permission) {
      return res.status(403).json({ error: 'You do not have permission to send broadcasts.' });
    }
    req.broadcastPermission = permission;
    return next();
  }

  return res.status(403).json({ error: 'Unauthorized' });
}

// ── resolveAudience helper ──────────────────────────────────────────────────
export function resolveAudience(audienceType, audienceValue, senderPermission) {
  let query = `
    SELECT DISTINCT u.id, u.first_name, u.last_name, sp.batch_number
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    WHERE u.role = 'student' AND u.is_active = 1
  `;
  const params = [];

  if (audienceType === 'batch') {
    query += ` AND sp.batch_number = ?`;
    params.push(audienceValue);
  } else if (audienceType === 'course') {
    query += ` AND EXISTS (
      SELECT 1 FROM student_course_enrollments sce
      WHERE sce.user_id = u.id AND sce.course_name = ?
    )`;
    params.push(audienceValue);
  } else if (audienceType === 'specific') {
    const ids = String(audienceValue || '').split(',').map(Number).filter(Boolean);
    if (ids.length === 0) return [];
    query += ` AND u.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  // 'all' — no additional filter

  if (senderPermission && senderPermission.can_send_to === 'own_batch') {
    const teacherProfile = db.prepare(
      `SELECT batch_number FROM student_profiles WHERE user_id = ?`
    ).get(senderPermission.teacher_id);
    if (teacherProfile?.batch_number) {
      query += ` AND sp.batch_number = ?`;
      params.push(teacherProfile.batch_number);
    }
  }

  return db.prepare(query).all(...params);
}

// ── deliverBroadcast helper ─────────────────────────────────────────────────
export async function deliverBroadcast(broadcastId, students, io) {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);
  if (!broadcast) return;

  const attachments = db.prepare(
    'SELECT * FROM broadcast_attachments WHERE broadcast_id = ?'
  ).all(broadcastId);

  const channels = (broadcast.channels || 'inbox,notification,notice').split(',');
  const sendInbox = channels.includes('inbox');
  const sendNotification = channels.includes('notification');
  const sendNotice = channels.includes('notice');

  let deliveredCount = 0;
  let failedCount = 0;

  for (const student of students) {
    let inboxOk = false;
    let notifOk = false;
    let noticeOk = false;
    let failedReason = null;

    try {
      // ── Channel 1: Inbox message ──────────────────────────────────────────
      if (sendInbox) {
        const messageResult = db.prepare(`
          INSERT INTO messages (sender_id, receiver_id, content, is_broadcast, broadcast_id, allow_reply)
          VALUES (?, ?, ?, 1, ?, ?)
        `).run(
          broadcast.sender_id,
          student.id,
          encryptMessageContent(broadcast.message),
          broadcast.id,
          broadcast.allow_reply
        );
        const messageId = messageResult.lastInsertRowid;

        if (io) {
          io.to(`user:${student.id}`).emit('inbox:message', {
            id: messageId,
            sender_id: broadcast.sender_id,
            receiver_id: student.id,
            content: broadcast.message,
            is_broadcast: 1,
            broadcast_id: broadcast.id,
            allow_reply: broadcast.allow_reply,
            created_at: new Date().toISOString(),
          });
        }
        inboxOk = true;
      }

      // ── Channel 2: Bell notification ──────────────────────────────────────
      if (sendNotification) {
        const notifType = broadcast.priority === 'urgent' ? 'urgent_broadcast' : 'broadcast';
        const truncatedMsg = broadcast.message.length > 120
          ? broadcast.message.substring(0, 120) + '...'
          : broadcast.message;

        const notifResult = db.prepare(
          `INSERT INTO notifications (user_id, type, title, message, link, image_url) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(student.id, notifType, broadcast.title, truncatedMsg, '/inbox', null);
        const notifId = notifResult.lastInsertRowid;

        if (io) {
          io.to(`user:${student.id}`).emit('notification_received', {
            id: notifId,
            type: notifType,
            title: broadcast.title,
            message: truncatedMsg,
            link: '/inbox',
            image_url: null,
            created_at: new Date().toISOString(),
          });
          io.emit('new_notification');
        }
        notifOk = true;
      }

      // ── Channel 3: Notice Board ───────────────────────────────────────────
      if (sendNotice) {
        const noticePriority = broadcast.priority === 'urgent' ? 'high' : 'normal';
        db.prepare(`
          INSERT INTO announcements (admin_id, title, content, priority, visible_to_user_id, is_broadcast)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(broadcast.sender_id, broadcast.title, broadcast.message, noticePriority, student.id);

        if (io) {
          io.to(`user:${student.id}`).emit('new_announcement', {
            title: broadcast.title,
            priority: noticePriority,
            is_broadcast: true,
          });
        }
        noticeOk = true;
      }

      deliveredCount++;
    } catch (error) {
      failedReason = error.message;
      failedCount++;
      console.error(`[Broadcast] Failed delivery to student ${student.id}:`, error.message);
    }

    try {
      db.prepare(`
        INSERT INTO broadcast_recipients
        (broadcast_id, student_id, inbox_delivered, notification_delivered, notice_delivered, delivered_at, failed_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        broadcastId,
        student.id,
        inboxOk ? 1 : 0,
        notifOk ? 1 : 0,
        noticeOk ? 1 : 0,
        (inboxOk || notifOk || noticeOk) ? new Date().toISOString() : null,
        failedReason
      );
    } catch (logErr) {
      console.error(`[Broadcast] Failed to log recipient row for student ${student.id}:`, logErr.message);
    }
  }

  const finalStatus = students.length > 0 && failedCount === students.length ? 'failed' : 'sent';
  db.prepare(`
    UPDATE broadcasts SET
      status = ?,
      sent_at = CURRENT_TIMESTAMP,
      delivered_count = ?,
      failed_count = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(finalStatus, deliveredCount, failedCount, broadcastId);

  console.log(`[Broadcast #${broadcastId}] Complete. Delivered: ${deliveredCount}, Failed: ${failedCount}`);
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── Endpoint 11: Teacher Permission Management (MUST come before /:id routes) ──
router.get('/permissions', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.profile_picture,
        bp.id as permission_id, bp.can_send_to, bp.granted_at, bp.is_active
      FROM users u
      LEFT JOIN broadcast_permissions bp ON bp.teacher_id = u.id AND bp.is_active = 1
      WHERE u.role = 'instructor'
      ORDER BY u.first_name ASC
    `).all();
    res.json({ teachers });
  } catch (error) {
    console.error('[Broadcast] permissions list error:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

router.post('/permissions', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { teacher_id, can_send_to = 'all' } = req.body;
    if (!teacher_id) return res.status(400).json({ error: 'teacher_id is required' });
    if (!['all', 'own_batch'].includes(can_send_to)) {
      return res.status(400).json({ error: 'can_send_to must be "all" or "own_batch"' });
    }
    const teacher = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'instructor'").get(teacher_id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    db.prepare(`
      INSERT INTO broadcast_permissions (teacher_id, granted_by, can_send_to, is_active)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(teacher_id) DO UPDATE SET can_send_to = excluded.can_send_to,
        granted_by = excluded.granted_by, granted_at = CURRENT_TIMESTAMP,
        revoked_at = NULL, is_active = 1
    `).run(teacher_id, req.user.id, can_send_to);

    res.json({ success: true });
  } catch (error) {
    console.error('[Broadcast] grant permission error:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

router.delete('/permissions/:teacherId', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    db.prepare(`
      UPDATE broadcast_permissions
      SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
      WHERE teacher_id = ?
    `).run(req.params.teacherId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Broadcast] revoke permission error:', error);
    res.status(500).json({ error: 'Failed to revoke permission' });
  }
});

// ── Endpoint 1: Resolve Audience preview ─────────────────────────────────────
router.post('/resolve-audience', authenticateToken, broadcastAuth, (req, res) => {
  try {
    const { audience_type, audience_value } = req.body;
    const students = resolveAudience(audience_type, audience_value, req.broadcastPermission || null);
    const preview = students.slice(0, 5).map(s => `${s.first_name} ${s.last_name}`);
    res.json({ count: students.length, preview });
  } catch (error) {
    console.error('[Broadcast] resolve-audience error:', error);
    res.status(500).json({ error: 'Failed to resolve audience' });
  }
});

// ── Endpoint 2: Upload attachment ─────────────────────────────────────────────
router.post('/upload', authenticateToken, broadcastAuth, (req, res) => {
  broadcastUpload.array('files', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const uploaded = req.files.map(file => ({
      file_name: file.originalname,
      file_path: `/uploads/broadcast-attachments/${file.filename}`,
      file_type: file.mimetype,
      file_size: file.size,
    }));
    res.json({ files: uploaded });
  });
});

// ── Endpoint 3: Create / Save Draft ──────────────────────────────────────────
router.post('/', authenticateToken, broadcastAuth, sanitizeInput, (req, res) => {
  try {
    const {
      title, message, audience_type = 'all', audience_value,
      priority = 'normal', allow_reply = false, status = 'draft',
      scheduled_at = null, attachment_files = [],
      channels = 'inbox,notification,notice',
    } = req.body;

    // Validation
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (title.length > 150) return res.status(400).json({ error: 'Title max 150 characters' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
    if (message.length > 5000) return res.status(400).json({ error: 'Message max 5000 characters' });
    if (!['all', 'batch', 'course', 'specific'].includes(audience_type)) {
      return res.status(400).json({ error: 'Invalid audience_type' });
    }
    if (audience_type !== 'all' && !audience_value) {
      return res.status(400).json({ error: 'audience_value required for this audience type' });
    }
    if (scheduled_at && new Date(scheduled_at) <= new Date()) {
      return res.status(400).json({ error: 'scheduled_at must be in the future' });
    }
    if (req.broadcastPermission && req.broadcastPermission.can_send_to === 'own_batch') {
      if (audience_type === 'all' || audience_type === 'course') {
        return res.status(403).json({ error: 'You can only send to your own batch' });
      }
    }

    const result = db.prepare(`
      INSERT INTO broadcasts (title, message, sender_id, audience_type, audience_value, priority, allow_reply, status, scheduled_at, channels)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      message.trim(),
      req.user.id,
      audience_type,
      audience_value || null,
      priority,
      allow_reply ? 1 : 0,
      status,
      scheduled_at || null,
      channels || 'inbox,notification,notice'
    );
    const broadcastId = result.lastInsertRowid;

    if (Array.isArray(attachment_files) && attachment_files.length > 0) {
      const insertAttachment = db.prepare(`
        INSERT INTO broadcast_attachments (broadcast_id, file_name, file_path, file_type, file_size)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const f of attachment_files) {
        if (f.file_name && f.file_path && f.file_type && f.file_size) {
          insertAttachment.run(broadcastId, f.file_name, f.file_path, f.file_type, f.file_size);
        }
      }
    }

    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);
    res.status(201).json({ broadcast });
  } catch (error) {
    console.error('[Broadcast] create error:', error);
    res.status(500).json({ error: 'Failed to create broadcast' });
  }
});

// ── Endpoint 4: Send Broadcast ────────────────────────────────────────────────
router.post('/:id/send', authenticateToken, broadcastAuth, async (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    if (broadcast.status === 'sent') {
      return res.status(400).json({ error: 'This broadcast has already been sent' });
    }
    if (req.user.role !== 'admin' && broadcast.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const students = resolveAudience(
      broadcast.audience_type,
      broadcast.audience_value,
      req.broadcastPermission || null
    );

    if (students.length === 0) {
      return res.status(400).json({ error: 'No students found for the selected audience' });
    }

    db.prepare(`
      UPDATE broadcasts SET status = 'sending', total_recipients = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(students.length, broadcast.id);

    res.json({
      success: true,
      message: `Sending to ${students.length} students...`,
      broadcast_id: broadcast.id,
      total_recipients: students.length,
    });

    const io = req.app.get('io');
    setImmediate(() => {
      deliverBroadcast(broadcast.id, students, io).catch(err =>
        console.error('[Broadcast] deliverBroadcast error:', err)
      );
    });
  } catch (error) {
    console.error('[Broadcast] send error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

// ── Endpoint 5: Schedule Broadcast ───────────────────────────────────────────
router.post('/:id/schedule', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
    const scheduledDate = new Date(scheduled_at);
    const minDate = new Date(Date.now() + 15 * 60 * 1000);
    if (scheduledDate <= minDate) {
      return res.status(400).json({ error: 'scheduled_at must be at least 15 minutes in the future' });
    }
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    if (broadcast.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft broadcasts can be scheduled' });
    }
    db.prepare(`
      UPDATE broadcasts SET status = 'scheduled', scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(scheduled_at, broadcast.id);
    const updated = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcast.id);
    res.json({ broadcast: updated });
  } catch (error) {
    console.error('[Broadcast] schedule error:', error);
    res.status(500).json({ error: 'Failed to schedule broadcast' });
  }
});

// ── Endpoint 6: Cancel Scheduled ─────────────────────────────────────────────
router.post('/:id/cancel', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    if (broadcast.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled broadcasts can be cancelled' });
    }
    db.prepare(`
      UPDATE broadcasts SET status = 'draft', scheduled_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(broadcast.id);
    const updated = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcast.id);
    res.json({ broadcast: updated });
  } catch (error) {
    console.error('[Broadcast] cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel broadcast' });
  }
});

// ── Endpoint 7: Get All Broadcasts ───────────────────────────────────────────
router.get('/', authenticateToken, broadcastAuth, (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params = [];
    let where = 'WHERE 1=1';

    if (req.user.role !== 'admin') {
      where += ' AND b.sender_id = ?';
      params.push(req.user.id);
    }
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND b.title LIKE ?';
      params.push(`%${search}%`);
    }

    const broadcasts = db.prepare(`
      SELECT b.*,
        (u.first_name || ' ' || u.last_name) AS sender_name,
        u.profile_picture AS sender_avatar,
        (SELECT COUNT(*) FROM broadcast_attachments WHERE broadcast_id = b.id) AS attachment_count
      FROM broadcasts b
      JOIN users u ON u.id = b.sender_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), offset);

    const countRow = db.prepare(`SELECT COUNT(*) as c FROM broadcasts b ${where}`).get(...params);
    const total = countRow?.c || 0;

    res.json({ broadcasts, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error('[Broadcast] list error:', error);
    res.status(500).json({ error: 'Failed to fetch broadcasts' });
  }
});

// ── Endpoint 8: Get Single Broadcast + Stats ──────────────────────────────────
router.get('/:id', authenticateToken, broadcastAuth, (req, res) => {
  try {
    const broadcast = db.prepare(`
      SELECT b.*, (u.first_name || ' ' || u.last_name) AS sender_name, u.profile_picture AS sender_avatar
      FROM broadcasts b JOIN users u ON u.id = b.sender_id
      WHERE b.id = ?
    `).get(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });

    const attachments = db.prepare('SELECT * FROM broadcast_attachments WHERE broadcast_id = ?').all(broadcast.id);

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN inbox_delivered = 1 OR notification_delivered = 1 OR notice_delivered = 1 THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN inbox_delivered = 0 AND notification_delivered = 0 AND notice_delivered = 0 THEN 1 ELSE 0 END) as failed,
        SUM(inbox_delivered) as inbox_delivered,
        SUM(notification_delivered) as notif_delivered,
        SUM(notice_delivered) as notice_delivered
      FROM broadcast_recipients WHERE broadcast_id = ?
    `).get(broadcast.id);

    const total = stats.total || 0;
    const delivery_stats = {
      total,
      delivered: stats.delivered || 0,
      failed: stats.failed || 0,
      inbox_rate: total > 0 ? `${Math.round(((stats.inbox_delivered || 0) / total) * 100)}%` : '0%',
      notification_rate: total > 0 ? `${Math.round(((stats.notif_delivered || 0) / total) * 100)}%` : '0%',
      notice_rate: total > 0 ? `${Math.round(((stats.notice_delivered || 0) / total) * 100)}%` : '0%',
      inbox_delivered: stats.inbox_delivered || 0,
      notif_delivered: stats.notif_delivered || 0,
      notice_delivered: stats.notice_delivered || 0,
    };

    const failed_recipients = db.prepare(`
      SELECT br.student_id, br.failed_reason,
        (u.first_name || ' ' || u.last_name) AS name
      FROM broadcast_recipients br
      JOIN users u ON u.id = br.student_id
      WHERE br.broadcast_id = ?
        AND br.inbox_delivered = 0 AND br.notification_delivered = 0 AND br.notice_delivered = 0
    `).all(broadcast.id);

    res.json({ broadcast, attachments, delivery_stats, failed_recipients });
  } catch (error) {
    console.error('[Broadcast] get-one error:', error);
    res.status(500).json({ error: 'Failed to fetch broadcast' });
  }
});

// ── Endpoint 9: Retry Failed Deliveries ──────────────────────────────────────
router.post('/:id/retry', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });

    const failedRecipients = db.prepare(`
      SELECT student_id FROM broadcast_recipients
      WHERE broadcast_id = ?
        AND inbox_delivered = 0 AND notification_delivered = 0 AND notice_delivered = 0
    `).all(broadcast.id);

    if (failedRecipients.length === 0) {
      return res.json({ message: 'No failed recipients to retry' });
    }

    db.prepare(`
      DELETE FROM broadcast_recipients
      WHERE broadcast_id = ?
        AND inbox_delivered = 0 AND notification_delivered = 0 AND notice_delivered = 0
    `).run(broadcast.id);

    const studentIds = failedRecipients.map(r => r.student_id);
    const students = db.prepare(
      `SELECT u.id, u.first_name, u.last_name, sp.batch_number
       FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id IN (${studentIds.map(() => '?').join(',')})`
    ).all(...studentIds);

    res.json({ message: `Retrying delivery to ${students.length} students...` });

    const io = req.app.get('io');
    setImmediate(() => {
      deliverBroadcast(broadcast.id, students, io).catch(err =>
        console.error('[Broadcast] retry error:', err)
      );
    });
  } catch (error) {
    console.error('[Broadcast] retry error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to retry' });
  }
});

// ── Endpoint 10: Delete Draft ─────────────────────────────────────────────────
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    if (broadcast.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft broadcasts can be deleted' });
    }
    const attachments = db.prepare('SELECT * FROM broadcast_attachments WHERE broadcast_id = ?').all(broadcast.id);
    for (const att of attachments) {
      const filePath = path.join(__dirname, '../../', att.file_path.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    db.prepare('DELETE FROM broadcasts WHERE id = ?').run(broadcast.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Broadcast] delete error:', error);
    res.status(500).json({ error: 'Failed to delete broadcast' });
  }
});

export default router;
