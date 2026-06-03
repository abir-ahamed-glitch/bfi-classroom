import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
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
router.post('/upload-image', authenticateToken, requireRole('admin'), (req, res) => {
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
router.get('/template', authenticateToken, requireRole('admin'), (req, res) => {
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
router.post('/template', authenticateToken, requireRole('admin'), (req, res) => {
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
function hasPendingDueOrPartialPayment(feeDetailsStr, courseType) {
  if (!feeDetailsStr) return false;
  
  let feeDetails;
  try {
    feeDetails = typeof feeDetailsStr === 'string' ? JSON.parse(feeDetailsStr) : feeDetailsStr;
  } catch (e) {
    console.error('Error parsing fee details in helper:', e);
    return false;
  }

  if (!feeDetails) return false;

  const isUnpaid = (phase) => {
    if (!phase) return false;
    
    // Status checks
    const status = phase.status;
    if (status === 'Paid Full' || status === 'Waived') {
      return false;
    }
    
    // If there are installments, we determine status solely by installments
    if (phase.installments && phase.installments.length > 0) {
      return phase.installments.some(inst => inst.status === 'Pending' || inst.status === 'Due');
    }
    
    if (status === 'Partial' || status === 'Pending' || status === 'Due') {
      return true;
    }
    
    // Fallback numerical check
    const fullFee = parseFloat((phase.full_fee || '').toString().replace(/[^\d.]/g, '')) || 0;
    if (fullFee === 0) return false; // If fee is 0, no payment due
    
    const amountPaid = parseFloat((phase.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
    const discount = parseFloat((phase.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
    const remainingDue = Math.max(0, fullFee - discount - amountPaid);
    
    if (remainingDue > 0) {
      return true;
    }
    
    return false;
  };

  if (courseType === 'filmmaking') {
    // Both Phase 1 and Phase 2 need to be checked for Online Filmmaking Course
    return isUnpaid(feeDetails.phase1) || isUnpaid(feeDetails.phase2);
  } else {
    // Other course types have a flat fee structure
    return isUnpaid(feeDetails);
  }
}

// GET My Certificates details (Student View)
// Returns all completed courses and their certificate data (provided there is no pending payment)
router.get('/my-certificates', authenticateToken, (req, res) => {
  try {
    const student = db.prepare(`
      SELECT p.full_name, p.student_id, p.batch_number
      FROM student_profiles p 
      WHERE p.user_id = ?
    `).get(req.user.id);

    if (!student) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }

    const completions = db.prepare(`
      SELECT * FROM student_course_enrollments 
      WHERE user_id = ? AND step4_completed = 1
    `).all(req.user.id);

    // Map completions to certificates, marking locked ones securely
    const templates = db.prepare('SELECT * FROM certificate_templates').all();
    const templateMap = templates.reduce((acc, t) => ({ ...acc, [t.course_name]: t }), {});

    const certificates = completions.map(course => {
      const isLocked = hasPendingDueOrPartialPayment(course.fee_details, course.course_type);
      if (isLocked) {
        return {
          courseName: course.course_name,
          locked: true
        };
      }
      return {
        courseName: course.course_name,
        studentDetails: {
          fullName: student.full_name,
          studentId: student.student_id,
          batchNumber: student.batch_number,
          completionDate: course.updated_at
        },
        template: templateMap[course.course_name] || { layout_json: '{}', background_url: '' }
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

export default router;
