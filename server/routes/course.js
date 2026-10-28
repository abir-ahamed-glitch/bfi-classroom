import { validateExtensionAndMime, validateMagicBytes, COURSE_ATTACHMENT_ALLOWED_TYPES } from '../utils/file-validator.js';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logTrashAction } from '../utils/trashLogger.js';
import db from '../db/database.js';
import { authenticateToken, requireRole, requireAnyPermission, isSuperAdmin, hasAnyPermission } from '../middleware/auth.js';
import { optimizeUploadedImage } from '../utils/imageOptimizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Setup multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads/course-materials');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const allowedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/zip',
  'application/x-zip-compressed',
];

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit (video uploads are disabled)
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('video/')) {
      return cb(new Error('Direct video uploads are disabled on this platform. Please select "External URL" and paste a YouTube, Vimeo, or Google Drive link instead.'));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.ogg'].includes(ext)) {
      return cb(new Error('Direct video uploads are disabled on this platform. Please select "External URL" and paste a YouTube, Vimeo, or Google Drive link instead.'));
    }
    const check = validateExtensionAndMime(file.originalname, file.mimetype, COURSE_ATTACHMENT_ALLOWED_TYPES);
    if (!check.valid) {
      return cb(new Error(check.error));
    }
    cb(null, true);
  },
});

// ─── GET: All materials for logged-in student's batch ────────────────────────
router.get('/', authenticateToken, (req, res) => {
  try {
    const requestedBatchId = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;

    if (req.user.role === 'admin') {
      if (!isSuperAdmin(req.user) && !hasAnyPermission(req.user, 'courses:view', 'batches:view')) {
        return res.status(403).json({ error: "Access denied: missing required permission 'courses:view' or 'batches:view'" });
      }
      if (requestedBatchId) {
        const materials = db.prepare(`
          SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
          FROM course_materials m
          JOIN users u ON m.uploaded_by = u.id
          WHERE m.deleted_at IS NULL AND m.batch_id = ?
          ORDER BY m.created_at DESC
        `).all(requestedBatchId);
        return res.json({ materials });
      }
      const materials = db.prepare(`
        SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
        FROM course_materials m
        JOIN users u ON m.uploaded_by = u.id
        WHERE m.deleted_at IS NULL
        ORDER BY m.created_at DESC
      `).all();
      return res.json({ materials });
    }

    // For students: collect all enrolled batch IDs and profile batch number
    const enrolledBatches = db.prepare(`
      SELECT DISTINCT batch_id FROM (
        SELECT batch_id FROM student_course_enrollments WHERE user_id = ? AND batch_id IS NOT NULL
        UNION
        SELECT batch_id FROM batch_students WHERE student_id = ? AND batch_id IS NOT NULL
      )
    `).all(req.user.id, req.user.id).map(r => r.batch_id);

    const studentProfile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
    const legacyBatch = studentProfile?.batch_number || null;

    let materials;
    if (requestedBatchId) {
      // Authorize every requested batch_id against student's actual enrollment or batch membership
      if (!enrolledBatches.includes(requestedBatchId)) {
        return res.status(403).json({ error: 'Access denied: You are not enrolled in this batch.' });
      }

      // Check if requested batch is a defined course batch or legacy unlinked batch
      const targetBatch = db.prepare('SELECT id, course_definition_id, course_name, batch_number FROM batches WHERE id = ?').get(requestedBatchId);

      if (targetBatch && targetBatch.course_definition_id) {
        // Defined course: strictly materials assigned to this specific batch_id!
        materials = db.prepare(`
          SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
          FROM course_materials m
          JOIN users u ON m.uploaded_by = u.id
          WHERE m.deleted_at IS NULL AND m.batch_id = ?
          ORDER BY m.created_at DESC
        `).all(requestedBatchId);
      } else {
        // Legacy unlinked batch: materials specifically linked to this batch_id, OR legacy unlinked materials
        // for this exact course and batch number
        const bName = targetBatch ? targetBatch.course_name : null;
        const bNum = targetBatch ? targetBatch.batch_number : (legacyBatch || 'All');
        materials = db.prepare(`
          SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
          FROM course_materials m
          JOIN users u ON m.uploaded_by = u.id
          WHERE m.deleted_at IS NULL AND (
            m.batch_id = ?
            OR (
              m.batch_id IS NULL
              AND (? IS NULL OR m.course_name = ?)
              AND (m.batch_number = ? OR m.batch_number = 'All')
            )
          )
          ORDER BY m.created_at DESC
        `).all(requestedBatchId, bName, bName, bNum);
      }
    } else if (enrolledBatches.length > 0) {
      const placeholders = enrolledBatches.map(() => '?').join(',');

      // Retrieve genuinely unlinked legacy courses enrolled by the student
      const legacyCourses = db.prepare(`
        SELECT DISTINCT course_name FROM student_course_enrollments 
        WHERE user_id = ? AND batch_id IS NULL AND course_definition_id IS NULL
      `).all(req.user.id).map(r => r.course_name);

      if (legacyCourses.length > 0 && legacyBatch) {
        const coursePlaceholders = legacyCourses.map(() => '?').join(',');
        materials = db.prepare(`
          SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
          FROM course_materials m
          JOIN users u ON m.uploaded_by = u.id
          WHERE m.deleted_at IS NULL AND (
            m.batch_id IN (${placeholders})
            OR (
              m.batch_id IS NULL
              AND m.course_name IN (${coursePlaceholders})
              AND (m.batch_number = ? OR m.batch_number = 'All')
            )
          )
          ORDER BY m.created_at DESC
        `).all(...enrolledBatches, ...legacyCourses, legacyBatch);
      } else {
        materials = db.prepare(`
          SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
          FROM course_materials m
          JOIN users u ON m.uploaded_by = u.id
          WHERE m.deleted_at IS NULL AND m.batch_id IN (${placeholders})
          ORDER BY m.created_at DESC
        `).all(...enrolledBatches);
      }
    } else {
      // Student has no batch_id enrollments; only unlinked legacy enrollments
      const legacyCourses = db.prepare(`
        SELECT DISTINCT course_name FROM student_course_enrollments 
        WHERE user_id = ? AND batch_id IS NULL AND course_definition_id IS NULL
      `).all(req.user.id).map(r => r.course_name);

      if (legacyCourses.length > 0) {
        const coursePlaceholders = legacyCourses.map(() => '?').join(',');
        materials = db.prepare(`
          SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
          FROM course_materials m
          JOIN users u ON m.uploaded_by = u.id
          WHERE m.deleted_at IS NULL 
            AND m.batch_id IS NULL
            AND m.course_name IN (${coursePlaceholders})
            AND (m.batch_number = ? OR m.batch_number = 'All')
          ORDER BY m.created_at DESC
        `).all(...legacyCourses, legacyBatch || '85th');
      } else {
        materials = [];
      }
    }

    res.json({ materials });
  } catch (error) {
    console.error('Course materials fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET (Admin): All materials across all batches ────────────────────────────
router.get('/admin/all', authenticateToken, requireRole('admin'), requireAnyPermission('courses:view', 'batches:view'), (req, res) => {
  try {
    const requestedBatchId = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;
    let materials;
    if (requestedBatchId) {
      materials = db.prepare(`
        SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name, b.course_definition_id, b.batch_name
        FROM course_materials m
        JOIN users u ON m.uploaded_by = u.id
        LEFT JOIN batches b ON m.batch_id = b.id
        WHERE m.deleted_at IS NULL AND (m.batch_id = ? OR (m.batch_id IS NULL AND m.batch_number = (SELECT batch_number FROM batches WHERE id = ?)))
        ORDER BY m.created_at DESC
      `).all(requestedBatchId, requestedBatchId);
    } else {
      materials = db.prepare(`
        SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name, b.course_definition_id, b.batch_name
        FROM course_materials m
        JOIN users u ON m.uploaded_by = u.id
        LEFT JOIN batches b ON m.batch_id = b.id
        WHERE m.deleted_at IS NULL
        ORDER BY m.created_at DESC
      `).all();
    }
    res.json({ materials });
  } catch (error) {
    console.error('Admin course materials fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST: Upload new material ────────────────────────────────────────────────
router.post('/upload', authenticateToken, requireRole('admin'), requireAnyPermission('courses:edit', 'batches:edit'), upload.single('file'), async (req, res) => {
  try {
    if (req.file) {
      // SEC-03: Magic bytes inspection & automatic cleanup of rejected uploads
      const buffer = Buffer.alloc(64);
      const fd = fs.openSync(req.file.path, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 64, 0);
      fs.closeSync(fd);
      const ext = path.extname(req.file.originalname).toLowerCase();
      const magic = validateMagicBytes(buffer.subarray(0, bytesRead), ext);
      if (!magic.valid) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({ error: magic.error });
      }
    }
    const { title, description, course_name, batch_number, batch_id, is_downloadable, external_url, file_type_override } = req.body;

    let effectiveBatchId = batch_id ? parseInt(batch_id, 10) : null;
    let effectiveCourseName = course_name;
    let effectiveBatchNumber = batch_number;

    if (effectiveBatchId) {
      const bRow = db.prepare('SELECT id, course_name, batch_number FROM batches WHERE id = ?').get(effectiveBatchId);
      if (bRow) {
        if (!effectiveCourseName) effectiveCourseName = bRow.course_name;
        if (!effectiveBatchNumber) effectiveBatchNumber = bRow.batch_number;
      }
    }

    if (!title || !effectiveCourseName || !effectiveBatchNumber) {
      return res.status(400).json({ error: 'Title, course name, and batch number are required.' });
    }

    let file_url = external_url || null;
    let file_type = file_type_override || 'pdf';

    if (req.file) {
      file_url = `/media/course-materials/${req.file.filename}`;
      const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
      if (['mp4', 'webm', 'ogg'].includes(ext)) file_type = 'video';
      else if (['doc', 'docx'].includes(ext)) file_type = 'doc';
      else if (ext === 'pdf') file_type = 'pdf';
      else file_type = ext || 'file';
    }

    const result = db.prepare(`
      INSERT INTO course_materials (title, description, file_url, file_type, batch_id, batch_number, course_name, uploaded_by, is_downloadable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || null,
      file_url,
      file_type,
      effectiveBatchId,
      effectiveBatchNumber,
      effectiveCourseName,
      req.user.id,
      is_downloadable === 'false' || is_downloadable === false ? 0 : 1
    );

    const material = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Material uploaded successfully', material });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// ─── PUT: Update material metadata ───────────────────────────────────────────
router.put('/:id', authenticateToken, requireRole('admin'), requireAnyPermission('courses:edit', 'batches:edit'), upload.single('file'), async (req, res) => {
  try {
    if (req.file) {
      // SEC-03: Magic bytes inspection & automatic cleanup of rejected uploads
      const buffer = Buffer.alloc(64);
      const fd = fs.openSync(req.file.path, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 64, 0);
      fs.closeSync(fd);
      const ext = path.extname(req.file.originalname).toLowerCase();
      const magic = validateMagicBytes(buffer.subarray(0, bytesRead), ext);
      if (!magic.valid) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({ error: magic.error });
      }
    }
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const { title, description, course_name, batch_number, batch_id, is_downloadable, external_url } = req.body;

    let effectiveBatchId = batch_id !== undefined ? (batch_id ? parseInt(batch_id, 10) : null) : existing.batch_id;
    let effectiveCourseName = course_name || existing.course_name;
    let effectiveBatchNumber = batch_number || existing.batch_number;

    if (batch_id && parseInt(batch_id, 10)) {
      const bRow = db.prepare('SELECT id, course_name, batch_number FROM batches WHERE id = ?').get(parseInt(batch_id, 10));
      if (bRow) {
        if (!course_name) effectiveCourseName = bRow.course_name;
        if (!batch_number) effectiveBatchNumber = bRow.batch_number;
      }
    }

    let file_url = existing.file_url;
    let file_type = existing.file_type;

    if (req.file) {
      // Delete old file if it was a local upload
      if (existing.file_url && existing.file_url.startsWith('/media/')) {
        const oldPath = path.join(__dirname, '../../uploads', existing.file_url.replace('/media/', ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      file_url = `/media/course-materials/${req.file.filename}`;
      const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
      if (['mp4', 'webm', 'ogg'].includes(ext)) file_type = 'video';
      else if (['doc', 'docx'].includes(ext)) file_type = 'doc';
      else if (ext === 'pdf') file_type = 'pdf';
      else file_type = ext || 'file';
    } else if (external_url) {
      file_url = external_url;
      file_type = req.body.file_type_override || existing.file_type;
    }

    db.prepare(`
      UPDATE course_materials
      SET title = ?, description = ?, file_url = ?, file_type = ?, batch_id = ?, batch_number = ?, course_name = ?, is_downloadable = ?
      WHERE id = ?
    `).run(
      title || existing.title,
      description !== undefined ? description : existing.description,
      file_url,
      file_type,
      effectiveBatchId,
      effectiveBatchNumber,
      effectiveCourseName,
      is_downloadable === 'false' || is_downloadable === false ? 0 : 1,
      id
    );

    const updated = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
    res.json({ message: 'Material updated successfully', material: updated });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: error.message || 'Update failed' });
  }
});

// ─── DELETE: Remove a material ────────────────────────────────────────────────
router.delete('/:id', authenticateToken, requireRole('admin'), requireAnyPermission('courses:delete', 'batches:delete'), (req, res) => {
  try {
    const { id } = req.params;
    const material = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
    if (!material) return res.status(404).json({ error: 'Material not found' });

    db.prepare("UPDATE course_materials SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?").run(req.user.id, id);
    logTrashAction('materials', id, material.title, 'deleted', req.user.id);
    res.json({ message: 'Material moved to Trash' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message || 'Delete failed' });
  }
});

export default router;
