import express from 'express';
import XLSX from 'xlsx';
import db from '../db/database.js';
import { authenticateToken, requireRole, sanitizeInput } from '../middleware/auth.js';
import { encryptMessageContent } from '../utils/messageCrypto.js';
import { parseFeeDetails, getBatchFee, getFeeStatus, extractFeeAmounts } from '../utils/feeResolver.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Collect all pending installments from fee_details
// Returns { is_overdue, next_due_date }
// ─────────────────────────────────────────────────────────────────────────────
function getOverdueInfo(feeDetails, courseType) {
  if (!feeDetails) return { is_overdue: false, next_due_date: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pendingInstallments = [];

  const collectPending = (phase) => {
    if (!phase || !phase.installments) return;
    for (const inst of phase.installments) {
      if ((inst.status || '').toLowerCase() === 'pending' && inst.dueDate) {
        pendingInstallments.push(inst);
      }
    }
  };

  if (courseType === 'filmmaking') {
    collectPending(feeDetails.phase1);
    collectPending(feeDetails.phase2);
  } else {
    // Workshop: feeDetails itself may have installments
    collectPending(feeDetails);
  }

  if (pendingInstallments.length === 0) {
    return { is_overdue: false, next_due_date: null };
  }

  // Parse all due dates and sort
  const dated = pendingInstallments
    .map(inst => ({ ...inst, parsedDate: new Date(inst.dueDate) }))
    .filter(inst => !isNaN(inst.parsedDate.getTime()))
    .sort((a, b) => a.parsedDate - b.parsedDate);

  if (dated.length === 0) {
    return { is_overdue: false, next_due_date: null };
  }

  const is_overdue = dated.some(inst => inst.parsedDate < today);

  // next_due_date = soonest upcoming, or most recently passed if all are past
  const upcoming = dated.filter(inst => inst.parsedDate >= today);
  const next_due_date = upcoming.length > 0
    ? upcoming[0].parsedDate.toISOString().split('T')[0]
    : dated[dated.length - 1].parsedDate.toISOString().split('T')[0];

  return { is_overdue, next_due_date };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Build the full student fee tracker dataset
// ─────────────────────────────────────────────────────────────────────────────
function buildStudentDataset(filters = {}) {
  const enrollments = db.prepare(`
    SELECT 
      sce.user_id,
      sce.course_name,
      sce.course_type,
      sce.fee_details,
      u.first_name,
      u.last_name,
      u.profile_picture,
      sp.student_id,
      sp.batch_number
    FROM student_course_enrollments sce
    JOIN users u ON u.id = sce.user_id
    JOIN student_profiles sp ON sp.user_id = u.id
  `).all();

  let totalCollected = 0;
  let totalOutstanding = 0;
  let paidCount = 0;
  let partialCount = 0;
  let dueCount = 0;
  let overdueCount = 0;

  const students = [];

  for (const row of enrollments) {
    const feeDetails = parseFeeDetails(row.fee_details);
    const batchFee = getBatchFee(row.course_name, row.batch_number);
    const rawStatus = getFeeStatus(feeDetails, row.course_type, batchFee);
    const amounts = extractFeeAmounts(feeDetails, row.course_type, batchFee);
    const overdueInfo = getOverdueInfo(feeDetails, row.course_type);

    const total_fee = Math.round(amounts.total);
    const collected = Math.round(amounts.collected);
    const outstanding = Math.max(0, total_fee - collected);

    // Get explicit status if defined in DB
    let explicitStatus = null;
    if (row.course_type === 'filmmaking' && feeDetails && feeDetails.phase1) {
      explicitStatus = feeDetails.phase1.status;
    } else if (row.course_type !== 'filmmaking' && feeDetails) {
      explicitStatus = feeDetails.status;
    }

    // Map internal status names to display names
    let status;
    const exp = (explicitStatus || '').toLowerCase();
    
    if (exp === 'waived' || exp === 'waived / free') {
      status = 'Waived / Free';
    } else if (total_fee > 0 && outstanding === 0) {
      status = 'Paid Full';
    } else if (exp === 'paid full' || rawStatus === 'paid') {
      status = 'Paid Full';
    } else if (total_fee === 0) {
      status = 'Waived / Free';
    } else if (exp === 'partial' || exp === 'partial payment' || rawStatus === 'partial') {
      status = 'Partial Payment';
    } else if (exp === 'pending') {
      status = 'Pending';
    } else {
      status = 'Due / Unpaid';
    }

    const full_name = `${row.first_name} ${row.last_name}`.trim();

    // Check reminder cooldown (24h)
    const lastReminder = db.prepare(
      `SELECT sent_at FROM fee_reminder_log WHERE student_user_id = ? ORDER BY sent_at DESC LIMIT 1`
    ).get(row.user_id);
    let reminder_sent_today = false;
    if (lastReminder) {
      const sentAt = new Date(lastReminder.sent_at);
      const now = new Date();
      reminder_sent_today = (now - sentAt) < 24 * 60 * 60 * 1000;
    }

    const student = {
      user_id: row.user_id,
      full_name,
      student_id: row.student_id,
      batch_number: row.batch_number,
      course_name: row.course_name,
      course_type: row.course_type,
      profile_picture: row.profile_picture,
      total_fee,
      collected,
      outstanding,
      status,
      is_overdue: overdueInfo.is_overdue,
      next_due_date: overdueInfo.next_due_date,
      reminder_sent_today,
    };

    // Apply filters
    if (filters.status) {
      const f = filters.status.toLowerCase();
      if (f === 'paid' && status !== 'Paid Full') continue;
      if (f === 'partial' && status !== 'Partial Payment') continue;
      if (f === 'pending' && status !== 'Pending') continue;
      if (f === 'waived' && status !== 'Waived / Free') continue;
      if (f === 'due' && status !== 'Due / Unpaid') continue;
      if (f === 'overdue' && !overdueInfo.is_overdue) continue;
    }
    if (filters.course && row.course_name.toLowerCase() !== filters.course.toLowerCase()) continue;
    if (filters.batch && row.batch_number !== filters.batch) continue;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      const matchName = full_name.toLowerCase().includes(s);
      const matchId = (row.student_id || '').toLowerCase().includes(s);
      if (!matchName && !matchId) continue;
    }

    students.push(student);

    // Aggregations (always count, regardless of filters for summary)
    totalCollected += collected;
    totalOutstanding += outstanding;
    if (status === 'Paid Full') paidCount++;
    else if (status === 'Partial Payment') partialCount++;
    else if (status === 'Due / Unpaid' || status === 'Pending') dueCount++;
    if (overdueInfo.is_overdue) overdueCount++;
  }

  return {
    students,
    summary: { totalCollected, totalOutstanding, paidCount, partialCount, dueCount, overdueCount },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/fee-tracker/students
// ─────────────────────────────────────────────────────────────────────────────
router.get('/fee-tracker/students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const filters = {
      status: req.query.status || '',
      course: req.query.course || '',
      batch: req.query.batch || '',
      search: req.query.search || '',
    };

    // For summary, compute unfiltered totals first
    const unfilteredData = buildStudentDataset({});
    const filteredData = buildStudentDataset(filters);

    // Also get distinct batches for the filter dropdown
    const batches = db.prepare(
      `SELECT DISTINCT batch_number FROM student_profiles WHERE batch_number IS NOT NULL AND batch_number != '' ORDER BY batch_number DESC`
    ).all().map(r => r.batch_number);

    res.json({
      students: filteredData.students,
      summary: unfilteredData.summary,
      batches,
    });
  } catch (error) {
    console.error('[FeeTracker] /students error:', error);
    res.status(500).json({ error: 'Failed to fetch fee tracker data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/fee-tracker/send-reminder
// ─────────────────────────────────────────────────────────────────────────────
router.post('/fee-tracker/send-reminder', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { student_id, course_name, due_amount, next_due_date } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'Student ID is required.' });
    }

    // Look up student user_id from student_id string
    const studentProfile = db.prepare(
      'SELECT sp.user_id, u.first_name, u.last_name FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.student_id = ?'
    ).get(student_id);

    // If student_id is actually a user_id number, try that
    const studentUserId = studentProfile
      ? studentProfile.user_id
      : (Number.isInteger(Number(student_id)) ? Number(student_id) : null);

    if (!studentUserId) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    // Check 24-hour cooldown
    const lastReminder = db.prepare(
      `SELECT sent_at FROM fee_reminder_log WHERE student_user_id = ? ORDER BY sent_at DESC LIMIT 1`
    ).get(studentUserId);

    if (lastReminder) {
      const sentAt = new Date(lastReminder.sent_at);
      const now = new Date();
      if ((now - sentAt) < 24 * 60 * 60 * 1000) {
        return res.status(429).json({ error: 'Reminder already sent today. Please wait 24 hours.' });
      }
    }

    // Build message content
    const formattedDue = due_amount ? `৳${Number(due_amount).toLocaleString('en-IN')}` : '৳0';
    const dueDateText = next_due_date ? `This was due on ${next_due_date}. ` : '';
    const messageText = `You have an outstanding balance of ${formattedDue} for ${course_name || 'your course'}. ${dueDateText}Please complete your payment at your earliest convenience.`;

    const io = req.app.get('io');
    const adminUser = db.prepare('SELECT first_name, last_name, profile_picture FROM users WHERE id = ?').get(req.user.id);
    const adminName = adminUser ? `${adminUser.first_name} ${adminUser.last_name}` : 'Admin';
    const adminAvatar = adminUser ? adminUser.profile_picture : null;

    const transaction = db.transaction(() => {
      // 1. In-App Notification
      const notification = db.prepare(`
        INSERT INTO notifications (user_id, type, title, message, link, image_url)
        VALUES (?, 'fee_reminder', 'Payment Reminder', ?, '/notices', ?)
      `).run(studentUserId, messageText, adminAvatar);

      // 2. Inbox Message (encrypted DM from admin)
      db.prepare(`
        INSERT INTO messages (sender_id, receiver_id, content)
        VALUES (?, ?, ?)
      `).run(req.user.id, studentUserId, encryptMessageContent(messageText));

      // 3. Private Notice (announcement visible only to this student)
      db.prepare(`
        INSERT INTO announcements (admin_id, title, content, priority, visible_to_user_id, scheduled_notified)
        VALUES (?, 'Payment Reminder', ?, 'high', ?, 0)
      `).run(req.user.id, messageText, studentUserId);

      // Log the reminder
      db.prepare(
        `INSERT INTO fee_reminder_log (admin_id, student_user_id) VALUES (?, ?)`
      ).run(req.user.id, studentUserId);

      return notification.lastInsertRowid;
    });

    const notifId = transaction();

    // Emit socket events after transaction
    if (io) {
      const createdAt = db.prepare('SELECT created_at FROM notifications WHERE id = ?').get(notifId)?.created_at;
      io.to(`user:${studentUserId}`).emit('notification_received', {
        id: notifId,
        type: 'fee_reminder',
        title: 'Payment Reminder',
        message: messageText,
        link: '/notices',
        image_url: adminAvatar,
        sender_name: adminName,
        sender_avatar: adminAvatar,
        created_at: createdAt,
      });
      io.emit('new_notification');

      // Emit inbox message event
      const lastMsg = db.prepare(
        'SELECT * FROM messages WHERE sender_id = ? AND receiver_id = ? ORDER BY id DESC LIMIT 1'
      ).get(req.user.id, studentUserId);
      if (lastMsg) {
        const payload = {
          ...lastMsg,
          content: messageText,
          is_edited: false,
          is_forwarded: false,
          is_pinned: false,
          reactions: [],
          reply_preview: null,
        };
        io.to(`user:${req.user.id}`).emit('inbox:message', payload);
        io.to(`user:${studentUserId}`).emit('inbox:message', payload);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[FeeTracker] /send-reminder error:', error);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/fee-tracker/export
// ─────────────────────────────────────────────────────────────────────────────
const checkQueryToken = (req, res, next) => {
  if (req.query && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
};

router.get('/fee-tracker/export', checkQueryToken, authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const filters = {
      status: req.query.status || '',
      course: req.query.course || '',
      batch: req.query.batch || '',
      search: req.query.search || '',
    };

    const data = buildStudentDataset(filters);

    // Build worksheet data
    const wsData = [
      ['Student Name', 'Student ID', 'Batch', 'Course', 'Total Fee', 'Collected', 'Outstanding', 'Status', 'Overdue'],
    ];

    for (const s of data.students) {
      wsData.push([
        s.full_name,
        s.student_id || '',
        s.batch_number || '',
        s.course_name,
        s.total_fee,
        s.collected,
        s.outstanding,
        s.status,
        s.is_overdue ? 'Yes' : 'No',
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = [
      { wch: 25 }, // Student Name
      { wch: 15 }, // Student ID
      { wch: 10 }, // Batch
      { wch: 30 }, // Course
      { wch: 12 }, // Total Fee
      { wch: 12 }, // Collected
      { wch: 12 }, // Outstanding
      { wch: 12 }, // Status
      { wch: 10 }, // Overdue
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Fee Tracker');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BFI_Fee_Tracker_${today}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (error) {
    console.error('[FeeTracker] /export error:', error);
    res.status(500).json({ error: 'Failed to export fee tracker data' });
  }
});

export default router;
