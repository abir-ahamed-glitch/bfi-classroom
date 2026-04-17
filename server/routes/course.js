import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

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
  'video/mp4',
  'video/webm',
  'video/ogg',
  'image/jpeg',
  'image/png',
  'application/zip',
  'application/x-zip-compressed',
];

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) return cb(null, true);
    cb(new Error('File type not allowed'));
  },
});

// ─── GET: All materials for logged-in student's batch ────────────────────────
router.get('/', authenticateToken, (req, res) => {
  try {
    let batch = 'All';
    if (req.user.role !== 'admin') {
      const student = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
      batch = student?.batch_number || '85th';
    }

    const materials = db.prepare(`
      SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
      FROM course_materials m
      JOIN users u ON m.uploaded_by = u.id
      WHERE m.batch_number = ? OR m.batch_number = 'All'
      ORDER BY m.created_at DESC
    `).all(batch);

    res.json({ materials });
  } catch (error) {
    console.error('Course materials fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET (Admin): All materials across all batches ────────────────────────────
router.get('/admin/all', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const materials = db.prepare(`
      SELECT m.*, u.first_name || ' ' || u.last_name AS instructor_name
      FROM course_materials m
      JOIN users u ON m.uploaded_by = u.id
      ORDER BY m.created_at DESC
    `).all();
    res.json({ materials });
  } catch (error) {
    console.error('Admin course materials fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST: Upload new material ────────────────────────────────────────────────
router.post('/upload', authenticateToken, requireRole('admin'), upload.single('file'), (req, res) => {
  try {
    const { title, description, course_name, batch_number, is_downloadable, external_url, file_type_override } = req.body;

    if (!title || !course_name || !batch_number) {
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
      INSERT INTO course_materials (title, description, file_url, file_type, batch_number, course_name, uploaded_by, is_downloadable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || null,
      file_url,
      file_type,
      batch_number,
      course_name,
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
router.put('/:id', authenticateToken, requireRole('admin'), upload.single('file'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const { title, description, course_name, batch_number, is_downloadable, external_url } = req.body;

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
      SET title = ?, description = ?, file_url = ?, file_type = ?, batch_number = ?, course_name = ?, is_downloadable = ?
      WHERE id = ?
    `).run(
      title || existing.title,
      description !== undefined ? description : existing.description,
      file_url,
      file_type,
      batch_number || existing.batch_number,
      course_name || existing.course_name,
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
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const material = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
    if (!material) return res.status(404).json({ error: 'Material not found' });

    // Delete local file if exists
    if (material.file_url && material.file_url.startsWith('/media/')) {
      const filePath = path.join(__dirname, '../../uploads', material.file_url.replace('/media/', ''));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM course_materials WHERE id = ?').run(id);
    res.json({ message: 'Material deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message || 'Delete failed' });
  }
});

export default router;
