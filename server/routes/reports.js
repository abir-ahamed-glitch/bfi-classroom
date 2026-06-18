import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticateToken, requireRole, sanitizeInput } from '../middleware/auth.js';
import { decryptMessageContent, encryptMessageContent } from '../utils/messageCrypto.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screenshotDirectory = path.join(__dirname, '..', '..', 'uploads', 'report-screenshots');
const VALID_TYPES = new Set(['message', 'comment', 'post', 'profile']);
const VALID_ACTIONS = new Set(['reviewed', 'resolved', 'dismissed']);
const HISTORY_MARKER = '\n\n[REPORT_HISTORY]';

fs.mkdirSync(screenshotDirectory, { recursive: true });
const reportColumns = db.prepare('PRAGMA table_info(reports)').all();
if (!reportColumns.some((column) => column.name === 'screenshot_path')) {
  db.exec('ALTER TABLE reports ADD COLUMN screenshot_path TEXT');
}

const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `reporter:${req.user.id}`,
  message: { error: 'You have submitted too many reports. Please try again later.' },
});

const screenshotLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `report-screenshot:${req.user.id}`,
  message: { error: 'Too many screenshot uploads. Please try again later.' },
});

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    callback(allowed.has(file.mimetype) ? null : new Error('INVALID_IMAGE'), allowed.has(file.mimetype));
  },
});

function imageExtension(buffer) {
  if (buffer?.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer?.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer?.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buffer?.length >= 4 && buffer.subarray(0, 4).toString() === 'GIF8') return 'gif';
  return null;
}

function parseAdminNote(value) {
  const text = String(value || '');
  const markerIndex = text.indexOf(HISTORY_MARKER);
  if (markerIndex < 0) return { note: text, history: [] };
  try {
    return {
      note: text.slice(0, markerIndex),
      history: JSON.parse(text.slice(markerIndex + HISTORY_MARKER.length)) || [],
    };
  } catch {
    return { note: text.slice(0, markerIndex), history: [] };
  }
}

function serializeAdminNote(note, history) {
  return `${String(note || '').trim()}${HISTORY_MARKER}${JSON.stringify(history)}`;
}

function publicReport(row) {
  const parsed = parseAdminNote(row.admin_note);
  return { ...row, admin_note: parsed.note || null, history_events: parsed.history };
}

function emitReportMessage(io, senderId, receiverId, messageId, content) {
  if (!io) return;
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  const payload = {
    ...row,
    content,
    is_edited: false,
    is_forwarded: false,
    is_pinned: false,
    reactions: [],
    reply_preview: null,
  };
  io.to(`user:${senderId}`).emit('inbox:message', payload);
  io.to(`user:${receiverId}`).emit('inbox:message', payload);
}

function sendReportUpdate({ io, admin, recipientId, text, inboxText = text }) {
  if (!recipientId || recipientId === admin.id) return false;
  const notification = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, link, image_url)
    VALUES (?, 'report_update', 'Report Update', ?, '/', ?)
  `).run(recipientId, text, admin.profile_picture || null);
  const createdAt = db.prepare('SELECT created_at FROM notifications WHERE id = ?').get(notification.lastInsertRowid)?.created_at;
  io?.to(`user:${recipientId}`).emit('notification_received', {
    id: notification.lastInsertRowid,
    type: 'report_update',
    title: 'Report Update',
    message: text,
    link: '/',
    image_url: admin.profile_picture || null,
    sender_name: admin.name,
    sender_avatar: admin.profile_picture || null,
    created_at: createdAt,
  });
  io?.emit('new_notification');

  const message = db.prepare(`
    INSERT INTO messages (sender_id, receiver_id, content)
    VALUES (?, ?, ?)
  `).run(admin.id, recipientId, encryptMessageContent(inboxText));
  emitReportMessage(io, admin.id, recipientId, message.lastInsertRowid, inboxText);
  return true;
}

router.post('/upload-screenshot', authenticateToken, screenshotLimiter, (req, res) => {
  screenshotUpload.single('screenshot')(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Screenshot must be under 5MB' });
      return res.status(400).json({ error: 'Only image files are allowed' });
    }
    if (!req.file) return res.status(400).json({ error: 'Only image files are allowed' });
    const extension = imageExtension(req.file.buffer);
    if (!extension) return res.status(400).json({ error: 'Only image files are allowed' });
    const filename = `report-screenshot-${req.user.id}-${Date.now()}.${extension}`;
    fs.writeFileSync(path.join(screenshotDirectory, filename), req.file.buffer);
    return res.status(201).json({ success: true, path: `/uploads/report-screenshots/${filename}` });
  });
});

function getReportTarget(contentType, contentId, reporterId) {
  if (!Number.isInteger(contentId) || contentId <= 0) {
    return { error: 'A valid content id is required.' };
  }

  if (contentType === 'message') {
    const message = db.prepare(`
      SELECT id, sender_id, receiver_id
      FROM messages
      WHERE id = ? AND deleted_for_everyone = 0
    `).get(contentId);
    if (!message || ![message.sender_id, message.receiver_id].includes(reporterId)) {
      return { error: 'Message not found.', status: 404 };
    }
    return {
      reportedUserId: message.sender_id === reporterId ? message.receiver_id : message.sender_id,
    };
  }

  if (contentType === 'comment') {
    const comment = db.prepare('SELECT id, user_id FROM post_comments WHERE id = ?').get(contentId);
    if (!comment) return { error: 'Comment not found.', status: 404 };
    if (comment.user_id === reporterId) return { error: 'You cannot report your own comment.' };
    return { reportedUserId: comment.user_id };
  }

  if (contentType === 'post') {
    const post = db.prepare('SELECT id, user_id FROM community_posts WHERE id = ?').get(contentId);
    if (!post) return { error: 'Post not found.', status: 404 };
    if (post.user_id === reporterId) return { error: 'You cannot report your own post.' };
    return { reportedUserId: post.user_id };
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(contentId);
  if (!user) return { error: 'Profile not found.', status: 404 };
  if (user.id === reporterId) return { error: 'You cannot report your own profile.' };
  return { reportedUserId: user.id };
}

function reportPreview(row) {
  if (row.content_type === 'message') {
    return decryptMessageContent(row.raw_preview || '');
  }
  if (row.content_type === 'profile') {
    return `Profile of ${row.reported_user_name || 'Unknown user'}`;
  }
  return row.raw_preview || '';
}

router.post('/submit', authenticateToken, reportLimiter, sanitizeInput, (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Administrators cannot submit reports.' });
    }

    const contentType = String(req.body.content_type || '').trim().toLowerCase();
    const contentId = Number(req.body.content_id);
    const reasonCategory = String(req.body.reason_category || '').trim();
    const reasonDetail = String(req.body.reason_detail || '').trim();
    const contentSnapshot = String(req.body.content_snapshot || '').trim();
    const screenshotPath = String(req.body.screenshot_path || '').trim();

    if (!VALID_TYPES.has(contentType)) {
      return res.status(400).json({ error: 'Invalid report content type.' });
    }
    if (!reasonCategory) {
      return res.status(400).json({ error: 'Please select a report reason.' });
    }
    if (reasonCategory.length > 120) {
      return res.status(400).json({ error: 'Report reason is too long.' });
    }
    if (reasonDetail.length > 500) {
      return res.status(400).json({ error: 'Report details cannot exceed 500 characters.' });
    }
    if (screenshotPath) {
      const expectedPrefix = `/uploads/report-screenshots/report-screenshot-${req.user.id}-`;
      const filename = path.basename(screenshotPath);
      if (!screenshotPath.startsWith(expectedPrefix)
        || screenshotPath !== `/uploads/report-screenshots/${filename}`
        || !fs.existsSync(path.join(screenshotDirectory, filename))) {
        return res.status(400).json({ error: 'Invalid screenshot attachment.' });
      }
    }

    const target = getReportTarget(contentType, contentId, req.user.id);
    if (target.error) {
      return res.status(target.status || 400).json({ error: target.error });
    }

    const duplicate = db.prepare(`
      SELECT id FROM reports
      WHERE reporter_id = ?
        AND content_type = ?
        AND content_id = ?
        AND status = 'pending'
      LIMIT 1
    `).get(req.user.id, contentType, contentId);

    if (duplicate) {
      return res.status(409).json({ error: 'You have already reported this.' });
    }

    const result = db.prepare(`
      INSERT INTO reports (
        reporter_id, reported_user_id, content_type, content_id,
        reason_category, reason_detail, content_snapshot, screenshot_path, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      req.user.id,
      target.reportedUserId,
      contentType,
      contentId,
      reasonCategory,
      reasonDetail || null,
      contentSnapshot || null,
      screenshotPath || null,
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Report submitted. Our team will review it.',
    });
  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/unread-count', authenticateToken, requireRole('admin'), (_req, res) => {
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM reports WHERE status = 'pending'").get();
    res.json({ count: Number(row?.count || 0) });
  } catch (error) {
    console.error('Report unread count error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/all', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const type = String(req.query.type || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const clauses = [];
    const params = [];

    if (status && status !== 'all') {
      clauses.push('r.status = ?');
      params.push(status);
    }
    if (type && type !== 'all') {
      clauses.push('r.content_type = ?');
      params.push(type);
    }
    if (search) {
      clauses.push(`(
        lower(reporter.first_name || ' ' || reporter.last_name) LIKE ?
        OR lower(reporter.username) LIKE ?
        OR lower(COALESCE(reported.first_name || ' ' || reported.last_name, '')) LIKE ?
        OR lower(COALESCE(reported.username, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    const rows = db.prepare(`
      SELECT
        r.*,
        reporter.first_name || ' ' || reporter.last_name AS reporter_name,
        reporter.username AS reporter_username,
        reporter.profile_picture AS reporter_avatar,
        reported.first_name || ' ' || reported.last_name AS reported_user_name,
        reported.username AS reported_username,
        reported.profile_picture AS reported_user_avatar,
        resolver.first_name || ' ' || resolver.last_name AS resolved_by_name,
        CASE r.content_type
          WHEN 'message' THEN (SELECT content FROM messages WHERE id = r.content_id)
          WHEN 'comment' THEN (SELECT content FROM post_comments WHERE id = r.content_id)
          WHEN 'post' THEN (SELECT content FROM community_posts WHERE id = r.content_id)
          ELSE NULL
        END AS raw_preview
      FROM reports r
      JOIN users reporter ON reporter.id = r.reporter_id
      LEFT JOIN users reported ON reported.id = r.reported_user_id
      LEFT JOIN users resolver ON resolver.id = r.resolved_by
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY datetime(r.created_at) DESC, r.id DESC
    `).all(...params);

    const reports = rows.map((row) => ({
      ...publicReport(row),
      content_preview: reportPreview(row),
      raw_preview: undefined,
    }));

    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed
      FROM reports
    `).get();

    res.json({
      reports,
      counts: {
        pending: Number(counts?.pending || 0),
        reviewed: Number(counts?.reviewed || 0),
        resolved: Number(counts?.resolved || 0),
        dismissed: Number(counts?.dismissed || 0),
      },
    });
  } catch (error) {
    console.error('Fetch reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/admin/:id/action', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const action = String(req.body.action || '').trim().toLowerCase();
    const adminNote = String(req.body.admin_note || '').trim();

    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ error: 'Invalid report id.' });
    }
    if (!VALID_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'Invalid report action.' });
    }
    if (adminNote.length > 1000) {
      return res.status(400).json({ error: 'Admin note cannot exceed 1000 characters.' });
    }

    const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!existing) {
      return res.status(404).json({ error: 'Report not found.' });
    }
    const parsed = parseAdminNote(existing.admin_note);
    if (existing.status === action) {
      return res.json({ report: publicReport(existing) });
    }

    const adminRow = db.prepare(`
      SELECT id, first_name || ' ' || last_name AS name, profile_picture
      FROM users WHERE id = ?
    `).get(req.user.id);
    const now = new Date().toISOString();
    const notifications = [];
    const reporterText = action === 'reviewed'
      ? `Your report (#${reportId}) is being reviewed by our team. We'll update you once a decision is made.`
      : action === 'resolved'
        ? `Your report (#${reportId}) has been resolved. Thank you for helping keep BFI Classroom safe.`
        : `Your report (#${reportId}) was reviewed but did not violate our community guidelines. No action was taken.`;
    const reportedText = action === 'reviewed'
      ? 'A report has been filed against your account and is currently under review by our admin team.'
      : 'A report against your account has been reviewed and resolved. Please ensure your activity follows our community guidelines.';

    const transaction = db.transaction(() => {
      const reporterSent = sendReportUpdate({
        io: null, admin: adminRow, recipientId: existing.reporter_id, text: reporterText,
      });
      if (reporterSent) notifications.push({ recipientId: existing.reporter_id, text: reporterText, inboxText: reporterText });
      if (action !== 'dismissed') {
        const reportedInboxText = action === 'resolved'
          ? `${reportedText}\n\nIf you believe this was a mistake, please contact the institute directly.`
          : reportedText;
        const reportedSent = sendReportUpdate({
          io: null, admin: adminRow, recipientId: existing.reported_user_id, text: reportedText, inboxText: reportedInboxText,
        });
        if (reportedSent) notifications.push({ recipientId: existing.reported_user_id, text: reportedText, inboxText: reportedInboxText });
      }
      const history = [...parsed.history, {
        action,
        admin_name: adminRow?.name || 'Admin',
        at: now,
        notification_recipients: action === 'dismissed' ? ['reporter'] : ['reporter', 'reported user'],
      }];
      db.prepare(`
        UPDATE reports
        SET status = ?, admin_note = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
        WHERE id = ?
      `).run(action, serializeAdminNote(adminNote, history), req.user.id, reportId);
    });
    transaction();

    const io = req.app.get('io');
    notifications.forEach((item) => {
      const latestNotification = db.prepare(`
        SELECT id, created_at FROM notifications
        WHERE user_id = ? AND type = 'report_update'
        ORDER BY id DESC LIMIT 1
      `).get(item.recipientId);
      io?.to(`user:${item.recipientId}`).emit('notification_received', {
        id: latestNotification?.id,
        type: 'report_update',
        title: 'Report Update',
        message: item.text,
        link: '/',
        image_url: adminRow?.profile_picture || null,
        sender_name: adminRow?.name || 'Admin',
        sender_avatar: adminRow?.profile_picture || null,
        created_at: latestNotification?.created_at,
      });
      const latestMessage = db.prepare(`
        SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(req.user.id, item.recipientId);
      if (latestMessage) emitReportMessage(io, req.user.id, item.recipientId, latestMessage.id, item.inboxText);
    });
    if (notifications.length) io?.emit('new_notification');

    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    res.json({ report: publicReport(report) });
  } catch (error) {
    console.error('Report action error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
