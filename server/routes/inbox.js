import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';
import { decryptMessageContent, encryptMessageContent } from '../utils/messageCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const DEFAULT_USER_LIMIT = 25;

const uploadDir = path.join(__dirname, '../../uploads/inbox-attachments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed file types for inbox attachments
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/octet-stream' // Allow E2E encrypted files
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.e2e'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error(`File type ${file.mimetype} is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`));
  }
  
  // Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`File extension ${ext} is not allowed`));
  }
  
  cb(null, true);
};

const uploadAttachment = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function mapUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    username: row.username,
    email: row.email,
    profile_picture: row.profile_picture,
    public_key: row.public_key,
    mobile_number: row.mobile_number,
    student_id: row.student_id,
    display_name: `${row.first_name} ${row.last_name}`.trim(),
  };
}

function getUserById(userId) {
  return db.prepare(`
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.role,
      u.username,
      u.email,
      u.profile_picture,
      u.public_key,
      u.mobile_number,
      sp.student_id
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    WHERE u.id = ? AND u.is_active = 1
  `).get(userId);
}

function getVisibleMessageById(messageId, viewerId) {
  const message = db.prepare(`
    SELECT *
    FROM messages m
    WHERE m.id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM message_hidden_for_users hidden
        WHERE hidden.message_id = m.id AND hidden.user_id = ?
      )
  `).get(messageId, viewerId);

  return decryptMessageRow(message);
}

function decryptMessageRow(message) {
  if (!message) return null;

  return {
    ...message,
    content: decryptMessageContent(message.content),
    reply_content: message.reply_content == null ? message.reply_content : decryptMessageContent(message.reply_content),
  };
}

function buildMessageResponse(messages, viewerId) {
  if (!messages.length) return [];

  const ids = messages.map((message) => message.id);
  const placeholders = ids.map(() => '?').join(', ');

  const reactionRows = db.prepare(`
    SELECT
      message_id,
      reaction,
      COUNT(*) AS count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS reacted_by_me
    FROM message_reactions
    WHERE message_id IN (${placeholders})
    GROUP BY message_id, reaction
    ORDER BY message_id ASC, count DESC, reaction ASC
  `).all(viewerId, ...ids);

  const reactionsByMessageId = new Map();
  for (const row of reactionRows) {
    const current = reactionsByMessageId.get(row.message_id) || [];
    current.push({
      reaction: row.reaction,
      count: row.count,
      reacted_by_me: row.reacted_by_me === 1,
    });
    reactionsByMessageId.set(row.message_id, current);
  }

  return messages.map((rawMessage) => {
    const message = decryptMessageRow(rawMessage);
    return {
      ...message,
      is_edited: !!message.edited_at,
      is_forwarded: !!message.forwarded_from_message_id,
      reply_preview: message.reply_to_message_id
      ? {
          id: message.reply_to_message_id,
          content: message.reply_deleted_for_everyone ? 'Message removed' : message.reply_content,
          sender_id: message.reply_sender_id,
          sender_name: message.reply_sender_name,
        }
      : null,
      reactions: reactionsByMessageId.get(message.id) || [],
    };
  });
}

function getConversationMessages(userId, otherId) {
  const rows = db.prepare(`
    SELECT
      m.*,
      reply.content AS reply_content,
      reply.sender_id AS reply_sender_id,
      reply.deleted_for_everyone AS reply_deleted_for_everyone,
      trim(reply_sender.first_name || ' ' || reply_sender.last_name) AS reply_sender_name
    FROM messages m
    LEFT JOIN messages reply ON reply.id = m.reply_to_message_id
    LEFT JOIN users reply_sender ON reply_sender.id = reply.sender_id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      AND NOT EXISTS (
        SELECT 1
        FROM message_hidden_for_users hidden
        WHERE hidden.message_id = m.id AND hidden.user_id = ?
      )
    ORDER BY m.created_at ASC, m.id ASC
  `).all(userId, otherId, otherId, userId, userId);

  return buildMessageResponse(rows, userId);
}

function getMessageForViewer(messageId, viewerId, otherId) {
  return getConversationMessages(viewerId, otherId).find((message) => message.id === messageId) || null;
}

function emitMessageEvent(io, senderId, receiverId, eventName, senderPayload, receiverPayload = senderPayload) {
  if (!io) return;
  io.to(`user:${senderId}`).emit(eventName, senderPayload);
  io.to(`user:${receiverId}`).emit(eventName, receiverPayload);
}

function buildAttachmentPayload(file) {
  if (!file) return { attachment_url: null, attachment_type: null };
  return {
    attachment_url: `/api/inbox/attachments/${file.filename}`,
    attachment_type: file.mimetype || 'application/octet-stream',
  };
}

function getAuthorizedAttachment(filename, userId) {
  const safeFilename = path.basename(filename);
  const attachmentUrl = `/api/inbox/attachments/${safeFilename}`;
  // Also support the old prefix just in case there are legacy records in the DB
  const oldAttachmentUrl = `/media/inbox-attachments/${safeFilename}`;

  const message = db.prepare(`
    SELECT id
    FROM messages m
    WHERE (m.attachment_url = ? OR m.attachment_url = ?)
      AND (m.sender_id = ? OR m.receiver_id = ?)
      AND m.deleted_for_everyone = 0
      AND NOT EXISTS (
        SELECT 1
        FROM message_hidden_for_users hidden
        WHERE hidden.message_id = m.id AND hidden.user_id = ?
      )
    LIMIT 1
  `).get(attachmentUrl, oldAttachmentUrl, userId, userId, userId);

  if (!message) return null;

  const filePath = path.join(uploadDir, safeFilename);
  if (!filePath.startsWith(uploadDir)) return null;
  return fs.existsSync(filePath) ? filePath : null;
}

function createMessageRecord({ senderId, receiverId, content, replyToMessageId = null, forwardedFromMessageId = null, attachmentUrl = null, attachmentType = null }) {
  const result = db.prepare(`
    INSERT INTO messages (
      sender_id,
      receiver_id,
      content,
      reply_to_message_id,
      forwarded_from_message_id,
      attachment_url,
      attachment_type
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    senderId,
    receiverId,
    encryptMessageContent(content),
    replyToMessageId,
    forwardedFromMessageId,
    attachmentUrl,
    attachmentType,
  );

  return result.lastInsertRowid;
}

function validateReceiver(senderId, receiverId) {
  if (!Number.isInteger(receiverId)) {
    return { error: 'Missing receiver.' };
  }

  // Removed the restriction allowing users to message themselves
  const receiver = getUserById(receiverId);
  if (!receiver) {
    return { error: 'Receiver not found.' };
  }

  return { receiver };
}

function resolveForwardedSource(forwardedFromMessageId, viewerId) {
  if (!forwardedFromMessageId) return null;

  const source = getVisibleMessageById(forwardedFromMessageId, viewerId);
  if (!source) {
    return { error: 'Original message not found.' };
  }

  return { source };
}

router.get('/conversations', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const chats = db.prepare(`
      SELECT DISTINCT
        CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AS other_user_id,
        u.first_name,
        u.last_name,
        u.role,
        u.username,
        u.email,
        u.profile_picture,
        u.public_key,
        u.mobile_number,
        sp.student_id,
        sp.batch_number,
        (
          SELECT lm.content
          FROM messages lm
          WHERE (
            (lm.sender_id = ? AND lm.receiver_id = u.id)
            OR (lm.sender_id = u.id AND lm.receiver_id = ?)
          )
            AND NOT EXISTS (
              SELECT 1
              FROM message_hidden_for_users hidden
              WHERE hidden.message_id = lm.id AND hidden.user_id = ?
            )
          ORDER BY lm.created_at DESC, lm.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT lm.created_at
          FROM messages lm
          WHERE (
            (lm.sender_id = ? AND lm.receiver_id = u.id)
            OR (lm.sender_id = u.id AND lm.receiver_id = ?)
          )
            AND NOT EXISTS (
              SELECT 1
              FROM message_hidden_for_users hidden
              WHERE hidden.message_id = lm.id AND hidden.user_id = ?
            )
          ORDER BY lm.created_at DESC, lm.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT lm.deleted_for_everyone
          FROM messages lm
          WHERE (
            (lm.sender_id = ? AND lm.receiver_id = u.id)
            OR (lm.sender_id = u.id AND lm.receiver_id = ?)
          )
            AND NOT EXISTS (
              SELECT 1
              FROM message_hidden_for_users hidden
              WHERE hidden.message_id = lm.id AND hidden.user_id = ?
            )
          ORDER BY lm.created_at DESC, lm.id DESC
          LIMIT 1
        ) AS last_message_deleted_for_everyone,
        (
          SELECT lm.sender_id
          FROM messages lm
          WHERE (
            (lm.sender_id = ? AND lm.receiver_id = u.id)
            OR (lm.sender_id = u.id AND lm.receiver_id = ?)
          )
            AND NOT EXISTS (
              SELECT 1
              FROM message_hidden_for_users hidden
              WHERE hidden.message_id = lm.id AND hidden.user_id = ?
            )
          ORDER BY lm.created_at DESC, lm.id DESC
          LIMIT 1
        ) AS last_message_sender_id,
        (
          SELECT COUNT(*)
          FROM messages unread
          WHERE unread.sender_id = u.id
            AND unread.receiver_id = ?
            AND unread.is_read = 0
            AND unread.deleted_for_everyone = 0
            AND NOT EXISTS (
              SELECT 1
              FROM message_hidden_for_users hidden
              WHERE hidden.message_id = unread.id AND hidden.user_id = ?
            )
        ) AS unread_count
      FROM messages m
      JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE (m.sender_id = ? OR m.receiver_id = ?)
        AND NOT EXISTS (
          SELECT 1
          FROM message_hidden_for_users hidden
          WHERE hidden.message_id = m.id AND hidden.user_id = ?
        )
      ORDER BY last_message_at DESC, other_user_id DESC
    `).all(
      userId,
      userId, userId, userId,
      userId, userId, userId,
      userId, userId, userId,
      userId, userId, userId,
      userId, userId,
      userId,
      userId, userId,
      userId,
    );

    res.json({
      chats: chats
        .filter((chat) => chat.last_message_at)
        .map((chat) => {
          let last_message_display = '';
          if (chat.last_message_deleted_for_everyone) {
            last_message_display = chat.last_message_sender_id === userId ? 'You deleted a message' : `${chat.first_name} deleted a message`;
          } else {
            last_message_display = decryptMessageContent(chat.last_message);
          }

          return {
            ...chat,
            last_message: last_message_display,
          };
        }),
    });
  } catch (error) {
    console.error('Conversations fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/messages/:otherId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = Number(req.params.otherId);
    const markAsRead = req.query.markAsRead !== 'false';

    if (!Number.isInteger(otherId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const otherUser = getUserById(otherId);
    if (!otherUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const messages = getConversationMessages(userId, otherId);
    if (markAsRead) {
      db.prepare(`
        UPDATE messages
        SET is_read = 1
        WHERE sender_id = ? AND receiver_id = ? AND deleted_for_everyone = 0
      `).run(otherId, userId);
    }

    const io = req.app.get('io');
    if (io && markAsRead) {
      io.to(`user:${otherId}`).emit('inbox:read', { by_user_id: userId, read_user_id: otherId });
      io.to(`user:${userId}`).emit('inbox:read', { by_user_id: userId, read_user_id: otherId });
    }

    res.json({ messages, other_user: mapUser(otherUser) });
  } catch (error) {
    console.error('Messages fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/attachments/:filename', authenticateToken, (req, res) => {
  try {
    const filePath = getAuthorizedAttachment(req.params.filename, req.user.id);
    if (!filePath) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error('Attachment fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/messages', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = Number(req.body.receiver_id);
    const replyToMessageId = req.body.reply_to_message_id ? Number(req.body.reply_to_message_id) : null;
    const forwardedFromMessageId = req.body.forwarded_from_message_id ? Number(req.body.forwarded_from_message_id) : null;
    const receiverCheck = validateReceiver(senderId, receiverId);
    if (receiverCheck.error) {
      return res.status(receiverCheck.error === 'Receiver not found.' ? 404 : 400).json({ error: receiverCheck.error });
    }

    if (replyToMessageId && !getVisibleMessageById(replyToMessageId, senderId)) {
      return res.status(400).json({ error: 'Reply target not found.' });
    }

    let content = req.body.content?.trim() || '';
    let attachmentUrl = null;
    let attachmentType = null;

    if (forwardedFromMessageId) {
      const forwarded = resolveForwardedSource(forwardedFromMessageId, senderId);
      if (forwarded?.error) {
        return res.status(400).json({ error: forwarded.error });
      }
      if (!content) content = forwarded.source.content;
      if (!attachmentUrl && forwarded.source.attachment_url) {
        attachmentUrl = forwarded.source.attachment_url;
        attachmentType = forwarded.source.attachment_type;
      }
    }

    if (!content && !attachmentUrl) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const messageId = createMessageRecord({
      senderId,
      receiverId,
      content,
      replyToMessageId,
      forwardedFromMessageId,
      attachmentUrl,
      attachmentType,
    });

    const senderMessage = getMessageForViewer(messageId, senderId, receiverId);
    const receiverMessage = getMessageForViewer(messageId, receiverId, senderId);

    emitMessageEvent(req.app.get('io'), senderId, receiverId, 'inbox:message', senderMessage, receiverMessage);

    res.status(201).json({
      message: 'Sent',
      sent_message: senderMessage,
      other_user: mapUser(receiverCheck.receiver),
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/messages/upload', authenticateToken, uploadAttachment.single('attachment'), (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = Number(req.body.receiver_id);
    const replyToMessageId = req.body.reply_to_message_id ? Number(req.body.reply_to_message_id) : null;
    const receiverCheck = validateReceiver(senderId, receiverId);
    if (receiverCheck.error) {
      console.log('Receiver check failed:', receiverCheck.error);
      return res.status(receiverCheck.error === 'Receiver not found.' ? 404 : 400).json({ error: receiverCheck.error });
    }

    if (replyToMessageId && !getVisibleMessageById(replyToMessageId, senderId)) {
      console.log('Reply target not found:', replyToMessageId);
      return res.status(400).json({ error: 'Reply target not found.' });
    }

    const content = req.body.content?.trim() || req.file?.originalname || 'Attachment';
    const attachment = buildAttachmentPayload(req.file);
    const attachmentType = req.body.attachment_type?.trim() || attachment.attachment_type;

    if (!attachment.attachment_url) {
      return res.status(400).json({ error: 'Please choose a file to upload.' });
    }

    const messageId = createMessageRecord({
      senderId,
      receiverId,
      content,
      replyToMessageId,
      attachmentUrl: attachment.attachment_url,
      attachmentType,
    });

    const senderMessage = getMessageForViewer(messageId, senderId, receiverId);
    const receiverMessage = getMessageForViewer(messageId, receiverId, senderId);

    emitMessageEvent(req.app.get('io'), senderId, receiverId, 'inbox:message', senderMessage, receiverMessage);

    res.status(201).json({
      message: 'Attachment sent',
      sent_message: senderMessage,
      other_user: mapUser(receiverCheck.receiver),
    });
  } catch (error) {
    console.error('Upload message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/messages/:id', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const messageId = Number(req.params.id);
    const userId = req.user.id;
    const content = req.body.content?.trim();

    if (!Number.isInteger(messageId) || !content) {
      return res.status(400).json({ error: 'Message id and content are required.' });
    }

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!message || message.deleted_for_everyone) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'Only the sender can edit a message.' });
    }

    db.prepare(`
      UPDATE messages
      SET content = ?, edited_at = datetime('now')
      WHERE id = ?
    `).run(encryptMessageContent(content), messageId);

    const senderMessage = getMessageForViewer(messageId, message.sender_id, message.receiver_id);
    const receiverMessage = getMessageForViewer(messageId, message.receiver_id, message.sender_id);
    emitMessageEvent(req.app.get('io'), message.sender_id, message.receiver_id, 'inbox:message_updated', senderMessage, receiverMessage);

    res.json({ message: 'Updated', updated_message: senderMessage });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/messages/:id/reactions', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const messageId = Number(req.params.id);
    const userId = req.user.id;
    const reaction = req.body.reaction?.trim() || null;

    if (!Number.isInteger(messageId)) {
      return res.status(400).json({ error: 'Invalid message id.' });
    }

    const message = getVisibleMessageById(messageId, userId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (!reaction) {
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(messageId, userId);

      if (message.sender_id !== userId) {
        db.prepare(`
          DELETE FROM messages 
          WHERE message_type = 'reaction' 
            AND sender_id = ? 
            AND receiver_id = ? 
            AND reply_to_message_id = ?
        `).run(userId, message.sender_id, messageId);
      }
    } else {
      db.prepare(`
        INSERT INTO message_reactions (message_id, user_id, reaction)
        VALUES (?, ?, ?)
        ON CONFLICT(message_id, user_id) DO UPDATE SET reaction = excluded.reaction
      `).run(messageId, userId, reaction);

      // If reacting to someone else's message, insert an invisible system message to act as a notification
      if (message.sender_id !== userId) {
        const contentStr = JSON.stringify({ type: 'reaction', emoji: reaction, originalMessageId: messageId, reactorId: userId });
        
        // Clean up any old reaction message before inserting the new one
        db.prepare(`
          DELETE FROM messages 
          WHERE message_type = 'reaction' 
            AND sender_id = ? 
            AND receiver_id = ? 
            AND reply_to_message_id = ?
        `).run(userId, message.sender_id, messageId);

        db.prepare(`
          INSERT INTO messages (sender_id, receiver_id, content, message_type, reply_to_message_id)
          VALUES (?, ?, ?, 'reaction', ?)
        `).run(userId, message.sender_id, encryptMessageContent(contentStr), messageId);

        // Fetch and emit the new system message so the receiver gets the badge instantly if online
        const newMsgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        const newMsgSender = getMessageForViewer(newMsgId, userId, message.sender_id);
        const newMsgReceiver = getMessageForViewer(newMsgId, message.sender_id, userId);

        const io = req.app.get('io');
        if (io) {
          emitMessageEvent(io, userId, message.sender_id, 'inbox:message', newMsgSender, newMsgReceiver);
        }
      }
    }

    const senderMessage = getMessageForViewer(messageId, message.sender_id, message.receiver_id);
    const receiverMessage = getMessageForViewer(messageId, message.receiver_id, message.sender_id);
    emitMessageEvent(req.app.get('io'), message.sender_id, message.receiver_id, 'inbox:message_updated', senderMessage, receiverMessage);

    res.json({
      message: 'Reaction updated',
      updated_message: getMessageForViewer(
        messageId,
        userId,
        message.sender_id === userId ? message.receiver_id : message.sender_id,
      ),
    });
  } catch (error) {
    console.error('Message reaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/messages/:id', authenticateToken, (req, res) => {
  try {
    const messageId = Number(req.params.id);
    const userId = req.user.id;
    const mode = req.query.mode === 'everyone' ? 'everyone' : 'me';

    if (!Number.isInteger(messageId)) {
      return res.status(400).json({ error: 'Invalid message id.' });
    }

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (![message.sender_id, message.receiver_id].includes(userId)) {
      return res.status(403).json({ error: 'You do not have access to this message.' });
    }

    const io = req.app.get('io');

    if (mode === 'everyone') {
      if (message.sender_id !== userId) {
        return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
      }

      db.prepare(`
        UPDATE messages
        SET deleted_for_everyone = 1, deleted_at = datetime('now')
        WHERE id = ?
      `).run(messageId);

      if (io) {
        io.to(`user:${message.sender_id}`).emit('inbox:message_deleted', { id: messageId, mode: 'everyone' });
        io.to(`user:${message.receiver_id}`).emit('inbox:message_deleted', { id: messageId, mode: 'everyone' });
      }

      return res.json({ message: 'Message removed for everyone.' });
    }

    db.prepare(`
      INSERT INTO message_hidden_for_users (message_id, user_id)
      VALUES (?, ?)
      ON CONFLICT(message_id, user_id) DO NOTHING
    `).run(messageId, userId);

    if (io) {
      io.to(`user:${userId}`).emit('inbox:message_deleted', { id: messageId, mode: 'me' });
    }

    return res.json({ message: 'Message removed from your view.' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/conversations/:otherId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = Number(req.params.otherId);

    if (!Number.isInteger(otherId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }

    db.prepare(`
      INSERT INTO message_hidden_for_users (message_id, user_id)
      SELECT m.id, ?
      FROM messages m
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      ON CONFLICT(message_id, user_id) DO NOTHING
    `).run(userId, userId, otherId, otherId, userId);

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('inbox:conversation_deleted', { other_user_id: otherId });
    }

    res.json({ message: 'Conversation removed from your inbox.' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const query = req.query.q?.toString().trim() || '';
    const likeQuery = query ? `%${query}%` : null;

    const users = query
      ? db.prepare(`
          SELECT u.id, u.first_name, u.last_name, u.role, u.username, u.email, u.profile_picture, u.public_key, u.mobile_number, sp.student_id, sp.batch_number
          FROM users u
          LEFT JOIN student_profiles sp ON sp.user_id = u.id
          WHERE u.id != ?
            AND u.is_active = 1
            AND (
              lower(u.username) LIKE lower(?)
              OR lower(trim(u.first_name || ' ' || u.last_name)) LIKE lower(?)
              OR lower(u.first_name) LIKE lower(?)
              OR lower(u.last_name) LIKE lower(?)
              OR lower(u.email) LIKE lower(?)
              OR u.mobile_number LIKE ?
              OR sp.student_id LIKE ?
              OR CAST(u.id AS TEXT) = ?
            )
          ORDER BY
            CASE
              WHEN lower(u.username) = lower(?) THEN 0
              WHEN CAST(u.id AS TEXT) = ? THEN 1
              WHEN sp.student_id = ? THEN 2
              WHEN lower(u.email) = lower(?) THEN 3
              WHEN u.mobile_number = ? THEN 4
              ELSE 5
            END,
            u.first_name ASC,
            u.last_name ASC
          LIMIT ?
        `).all(
          userId,
          likeQuery,
          likeQuery,
          likeQuery,
          likeQuery,
          likeQuery,
          likeQuery,
          likeQuery,
          query,
          query,
          query,
          query,
          query,
          query,
          DEFAULT_USER_LIMIT,
        )
      : db.prepare(`
          SELECT u.id, u.first_name, u.last_name, u.role, u.username, u.email, u.profile_picture, u.public_key, u.mobile_number, sp.student_id, sp.batch_number
          FROM users u
          LEFT JOIN student_profiles sp ON sp.user_id = u.id
          WHERE u.id != ? AND u.is_active = 1
            AND (
              u.role = 'admin'
              OR (SELECT role FROM users WHERE id = ?) = 'admin'
              OR EXISTS (
                SELECT 1 FROM messages m
                WHERE (m.sender_id = ? AND m.receiver_id = u.id)
                   OR (m.sender_id = u.id AND m.receiver_id = ?)
              )
              OR (
                u.role = 'student' 
                AND sp.batch_number IS NOT NULL 
                AND sp.batch_number != '' 
                AND sp.batch_number = (SELECT batch_number FROM student_profiles WHERE user_id = ?)
              )
              OR (
                (SELECT role FROM users WHERE id = ?) = 'teacher' AND u.role = 'teacher'
              )
            )
          ORDER BY
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM messages m
                WHERE (m.sender_id = ? AND m.receiver_id = u.id)
                   OR (m.sender_id = u.id AND m.receiver_id = ?)
              ) THEN 0
              WHEN (SELECT role FROM users WHERE id = ?) = 'student' AND u.role = 'student' AND sp.batch_number = (SELECT batch_number FROM student_profiles WHERE user_id = ?) THEN 1
              WHEN (SELECT role FROM users WHERE id = ?) = 'teacher' AND u.role = 'teacher' THEN 1
              WHEN (SELECT role FROM users WHERE id = ?) = 'admin' THEN 1
              ELSE 2
            END ASC,
            u.id DESC
          LIMIT ?
        `).all(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, DEFAULT_USER_LIMIT);

    res.json({ users });
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/inbox/call-log
 * Saves a call event (audio/video, missed/answered, duration) as a special
 * message visible to BOTH participants so it appears in the chat thread.
 * Body: { receiver_id, call_type: 'audio'|'video', status: 'missed'|'answered'|'declined', duration_seconds: 0 }
 */
router.post('/call-log', authenticateToken, (req, res) => {
  try {
    const senderId   = req.user.id;
    const receiverId = Number(req.body.receiver_id);
    const callType   = ['audio', 'video'].includes(req.body.call_type) ? req.body.call_type : 'audio';
    const status     = ['missed', 'answered', 'declined'].includes(req.body.status) ? req.body.status : 'missed';
    const duration   = Number(req.body.duration_seconds) || 0;

    const receiverCheck = validateReceiver(senderId, receiverId);
    if (receiverCheck.error) {
      return res.status(400).json({ error: receiverCheck.error });
    }

    // Build a human-readable summary stored as content
    const durationLabel = duration > 0
      ? (() => {
          const m = Math.floor(duration / 60);
          const s = duration % 60;
          return m > 0 ? `${m}m ${s}s` : `${s}s`;
        })()
      : null;

    const content = JSON.stringify({ call_type: callType, status, duration_seconds: duration, duration_label: durationLabel });

    // Insert once — both sides will see it
    const result = db.prepare(`
      INSERT INTO messages (sender_id, receiver_id, content, message_type)
      VALUES (?, ?, ?, 'call_log')
    `).run(senderId, receiverId, encryptMessageContent(content));

    const messageId = result.lastInsertRowid;
    const senderMessage  = getMessageForViewer(messageId, senderId,   receiverId);
    const receiverMessage = getMessageForViewer(messageId, receiverId, senderId);

    emitMessageEvent(req.app.get('io'), senderId, receiverId, 'inbox:message', senderMessage, receiverMessage);

    res.status(201).json({ message: 'Call log saved', sent_message: senderMessage });
  } catch (err) {
    console.error('Call log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/inbox/messages/:id/pin
 */
router.post('/messages/:id/pin', authenticateToken, (req, res) => {
  try {
    const messageId = Number(req.params.id);
    const userId = req.user.id;

    const message = db.prepare(`
      SELECT sender_id, receiver_id 
      FROM messages 
      WHERE id = ? AND deleted_for_everyone = 0
    `).get(messageId);

    if (!message || (message.sender_id !== userId && message.receiver_id !== userId)) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    db.prepare('UPDATE messages SET is_pinned = 1 WHERE id = ?').run(messageId);

    const otherId = message.sender_id === userId ? message.receiver_id : message.sender_id;
    const io = req.app.get('io');
    if (io) {
      const pinEvent = { message_id: messageId, is_pinned: 1, other_user_id: otherId };
      io.to(`user:${userId}`).emit('inbox:message_pinned', pinEvent);
      io.to(`user:${otherId}`).emit('inbox:message_pinned', pinEvent);
    }

    res.json({ success: true, message: 'Message pinned' });
  } catch (error) {
    console.error('Pin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/inbox/messages/:id/pin (Unpin)
 */
router.delete('/messages/:id/pin', authenticateToken, (req, res) => {
  try {
    const messageId = Number(req.params.id);
    const userId = req.user.id;

    const message = db.prepare(`
      SELECT sender_id, receiver_id 
      FROM messages 
      WHERE id = ?
    `).get(messageId);

    if (!message || (message.sender_id !== userId && message.receiver_id !== userId)) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    db.prepare('UPDATE messages SET is_pinned = 0 WHERE id = ?').run(messageId);

    const otherId = message.sender_id === userId ? message.receiver_id : message.sender_id;
    const io = req.app.get('io');
    if (io) {
      const unpinEvent = { message_id: messageId, is_pinned: 0, other_user_id: otherId };
      io.to(`user:${userId}`).emit('inbox:message_pinned', unpinEvent);
      io.to(`user:${otherId}`).emit('inbox:message_pinned', unpinEvent);
    }

    res.json({ success: true, message: 'Message unpinned' });
  } catch (error) {
    console.error('Unpin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/inbox/chats/:otherId/pinned
 */
router.get('/chats/:otherId/pinned', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = Number(req.params.otherId);

    const rows = db.prepare(`
      SELECT m.*, 
             u.first_name AS sender_first_name, 
             u.last_name AS sender_last_name,
             u.profile_picture AS sender_profile_picture
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        AND m.is_pinned = 1
        AND m.deleted_for_everyone = 0
      ORDER BY m.created_at DESC
    `).all(userId, otherId, otherId, userId);

    res.json(buildMessageResponse(rows, userId));
  } catch (error) {
    console.error('Pinned fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/inbox/chats/:otherId/media
 */
router.get('/chats/:otherId/media', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = Number(req.params.otherId);

    const rows = db.prepare(`
      SELECT m.*
      FROM messages m
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        AND m.attachment_url IS NOT NULL
        AND (m.attachment_type LIKE 'image/%' OR m.attachment_type LIKE 'e2e-file:image/%')
        AND m.deleted_for_everyone = 0
      ORDER BY m.created_at DESC
    `).all(userId, otherId, otherId, userId);

    res.json(buildMessageResponse(rows, userId));
  } catch (error) {
    console.error('Media fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/inbox/chats/:otherId/files
 */
router.get('/chats/:otherId/files', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = Number(req.params.otherId);

    const rows = db.prepare(`
      SELECT m.*
      FROM messages m
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        AND m.attachment_url IS NOT NULL
        AND m.attachment_type NOT LIKE 'image/%'
        AND m.attachment_type NOT LIKE 'e2e-file:image/%'
        AND m.deleted_for_everyone = 0
      ORDER BY m.created_at DESC
    `).all(userId, otherId, otherId, userId);

    res.json(buildMessageResponse(rows, userId));
  } catch (error) {
    console.error('Files fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/inbox/chats/:otherId/links
 */
router.get('/chats/:otherId/links', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = Number(req.params.otherId);

    // Simple heuristic for messages containing URLs
    const rows = db.prepare(`
      SELECT m.*
      FROM messages m
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%')
        AND m.deleted_for_everyone = 0
      ORDER BY m.created_at DESC
    `).all(userId, otherId, otherId, userId);

    res.json(buildMessageResponse(rows, userId));
  } catch (error) {
    console.error('Links fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
