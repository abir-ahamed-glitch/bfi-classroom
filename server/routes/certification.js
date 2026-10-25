import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole, requireAnyPermission } from '../middleware/auth.js';
import { optimizeUploadedImage } from '../utils/imageOptimizer.js';
import courseProgressService from '../services/courseProgressService.js';
import { resolvePhaseFee } from '../utils/feeResolver.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Setup multer for certificate uploads
const uploadDir = path.join(__dirname, '../../uploads/certificates');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `template-${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      return cb(null, true);
    }
    cb(new Error(`Only images are allowed. File type ${file.mimetype} with ext ${ext} rejected.`));
  },
});

// POST Upload Certificate Template Image
router.post('/upload-image', authenticateToken, requireRole('admin'), requireAnyPermission('settings:edit', 'courses:edit'), (req, res) => {
  upload.single('file')(req, res, function (err) {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }
      const file_url = `/media/certificates/${req.file.filename}`;
      res.status(200).json({ url: file_url });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message || 'Upload failed' });
    }
  });
});
router.get('/template', authenticateToken, requireRole('admin'), requireAnyPermission('settings:view', 'courses:view'), (req, res) => {
  try {
    const { courseName } = req.query;
    if (!courseName) return res.status(400).json({ error: 'courseName is required' });

    const template = db.prepare('SELECT * FROM certificate_templates WHERE course_name = ? ORDER BY id DESC LIMIT 1').get(courseName);
    
    if (!template) {
      return res.json({
        layout_json: '{}',
        background_url: '',
        course_name: courseName
      });
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST/PUT Certificate Template (for Admin)
router.post('/template', authenticateToken, requireRole('admin'), requireAnyPermission('settings:edit', 'courses:edit'), (req, res) => {
  try {
    const { layout_json, background_url, course_name } = req.body;
    if (!course_name) return res.status(400).json({ error: 'course_name is required' });
    
    const existing = db.prepare('SELECT id FROM certificate_templates WHERE course_name = ?').get(course_name);
    
    if (existing) {
      db.prepare(`
        UPDATE certificate_templates 
        SET layout_json = ?, background_url = ?, updated_by = ?, updated_at = datetime('now')
        WHERE course_name = ?
      `).run(layout_json || '{}', background_url || '', req.user.id, course_name);
    } else {
      db.prepare(`
        INSERT INTO certificate_templates (layout_json, background_url, course_name, updated_by)
        VALUES (?, ?, ?, ?)
      `).run(layout_json || '{}', background_url || '', course_name, req.user.id);
    }

    res.json({ message: 'Certificate template saved successfully.' });
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ error: 'Internal server error while saving template.' });
  }
});

// Helper function to check if a student has any pending/due or partial payment for a specific course
export function hasPendingDueOrPartialPayment(
  feeDetailsStr,
  courseType,
  courseName = null,
  batchNumber = null,
  courseDefId = null,
  customDb = null,
  enrollment = null,
  options = {}
) {
  const activeDb = customDb || db;
  let phaseCount = 1;
  let def = options.courseDefinition || null;

  if (courseDefId && !def) {
    try {
      const defRow = activeDb.prepare('SELECT phase_count, definition_json FROM course_definitions WHERE id = ?').get(courseDefId);
      if (defRow?.definition_json) {
        def = typeof defRow.definition_json === 'string' ? JSON.parse(defRow.definition_json) : defRow.definition_json;
        phaseCount = defRow.phase_count || (Array.isArray(def.phases) ? def.phases.length : 1);
      }
    } catch { /* empty */ }
  } else if (def && Array.isArray(def.phases)) {
    phaseCount = def.phases.length;
  } else if (courseType === 'filmmaking' || (courseName && courseName.toLowerCase().includes('filmmaking'))) {
    phaseCount = 2;
  }

  for (let idx = 0; idx < phaseCount; idx++) {
    const feeRes = resolvePhaseFee({
      feeDetailsRaw: feeDetailsStr,
      phaseIndex: idx,
      enrollment,
      courseDefinition: def,
      courseDefId,
      courseName,
      courseType,
      batchNumber,
      customDb: activeDb
    });
    if (!feeRes.isPaid || feeRes.remainingDue > 0) {
      return true; // Pending, partial, or unpaid fee exists
    }
  }

  return false;
}

// GET My Certificates details (Student View)
// Returns all completed courses and their certificate data (provided there is no pending payment)
router.get('/my-certificates', authenticateToken, async (req, res) => {
  try {
    const student = db.prepare(`
      SELECT p.full_name, p.student_id, p.batch_number
      FROM student_profiles p 
      WHERE p.user_id = ?
    `).get(req.user.id);

    if (!student) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }

    const allEnrollments = db.prepare(`
      SELECT * FROM student_course_enrollments 
      WHERE user_id = ?
    `).all(req.user.id);

    const completions = [];
    for (const enr of allEnrollments) {
      if (enr.course_definition_id) {
        const certCheck = await courseProgressService.evaluateCertificateEligibility(enr.id);
        const progress = await courseProgressService.getEnrollmentProgress(enr.id);
        const allPhasesPassed = progress && Array.isArray(progress.phases) && progress.phases.length > 0 && progress.phases.every(p => p.isPassed || p.requirements?.completionRequired === false);
        if (certCheck.eligible || allPhasesPassed) {
          completions.push({
            ...enr,
            reEnrollmentDiscountPercentage: certCheck.reEnrollmentDiscountPercentage
          });
        }
      } else {
        if (enr.step4_completed === 1) {
          completions.push(enr);
        }
      }
    }

    // Map completions to certificates, marking locked ones securely
    const templates = db.prepare('SELECT * FROM certificate_templates').all();
    const templateMap = templates.reduce((acc, t) => ({ ...acc, [t.course_name]: t }), {});

    const certificates = completions.map(course => {
      let batchNumber = student.batch_number;
      if (course.batch_id) {
        const b = db.prepare('SELECT batch_number FROM batches WHERE id = ?').get(course.batch_id);
        if (b && b.batch_number) batchNumber = b.batch_number;
      }
      const isLocked = hasPendingDueOrPartialPayment(
        course.fee_details, 
        course.course_type, 
        course.course_name, 
        batchNumber, 
        course.course_definition_id,
        db,
        course
      );
      if (isLocked) {
        return {
          enrollmentId: course.id,
          batchId: course.batch_id || null,
          courseName: course.course_name,
          locked: true,
          reEnrollmentDiscountPercentage: course.reEnrollmentDiscountPercentage || 0
        };
      }
      return {
        enrollmentId: course.id,
        batchId: course.batch_id || null,
        courseName: course.course_name,
        studentDetails: {
          fullName: student.full_name,
          studentId: student.student_id,
          batchNumber,
          completionDate: course.updated_at
        },
        template: templateMap[course.course_name] || { layout_json: '{}', background_url: '' },
        reEnrollmentDiscountPercentage: course.reEnrollmentDiscountPercentage || 0
      };
    });

    res.json({ certificates });

  } catch (error) {
    console.error('Error fetching student certificates:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Deprecated single route for compatibility
router.get('/my-certificate', authenticateToken, (req, res) => {
  res.status(404).json({ error: 'Deprecated. Use /my-certificates' });
});

// POST Log Certificate Download
router.post('/log-download', authenticateToken, (req, res) => {
  try {
    const { courseName } = req.body;
    if (!courseName) {
      return res.status(400).json({ error: 'Course name is required.' });
    }

    db.prepare(`
      INSERT INTO certificate_downloads (user_id, course_name)
      VALUES (?, ?)
    `).run(req.user.id, courseName);

    const io = req.app.get('io');
    if (io) {
      io.emit('certificate_downloaded', { userId: req.user.id, courseName });
    }

    res.json({ message: 'Certificate download logged successfully.' });
  } catch (error) {
    console.error('Error logging certificate download:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
