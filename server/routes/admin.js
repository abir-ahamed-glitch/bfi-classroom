import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/database.js';
import { authenticateToken, requireRole, sanitizeInput, validateEmail } from '../middleware/auth.js';

const router = express.Router();

// Utility function to generate a random string
const generateRandomString = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Route to create a new student account
// Accessible only by admins
router.post('/students', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      mobileNumber = '',
      batchNumber = '',
      snNo = '',
      year = '',
      manualUsername = '',
      manualPassword = '',
      courses = [] // ['Online Filmmaking Course', 'Film Appreciation Course', etc.]
    } = req.body;

    if (!firstName || !lastName || !email || !snNo || !batchNumber || !year) {
      return res.status(400).json({ error: 'First name, last name, email, SN No, Batch, and Year are required.' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    // Check if email already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    // Determine Username: Use manual if provided, otherwise generate automatically
    let username = manualUsername.trim();
    if (!username) {
      // Auto-generate logic: firstname.lastname.randomLetters
      const baseUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      username = `${baseUsername}.${randomSuffix}`;
    }

    // Check if username is already taken (very rare for auto, but possible for manual)
    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUsername) {
      return res.status(400).json({ error: 'Username is already taken. Please choose another one.' });
    }

    // Determine Password: Use manual if provided, otherwise generate a secure one (12 chars)
    const rawPassword = manualPassword ? manualPassword : generateRandomString(12);
    
    // Hash the password securely
    const passwordHash = bcrypt.hashSync(rawPassword, 12);

    const insertUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, mobile_number)
      VALUES (?, ?, ?, 'student', ?, ?, ?)
    `);

    const insertProfile = db.prepare(`
      INSERT INTO student_profiles (user_id, full_name, student_id, batch_number)
      VALUES (?, ?, ?, ?)
    `);

    // Execute in a transaction
    const transaction = db.transaction(() => {
      // 1. Create main user record
      const result = insertUser.run(username, email, passwordHash, firstName, lastName, mobileNumber);
      const userId = result.lastInsertRowid;
      
      // 2. Generate custom student ID: BFI + SN + Batch + Year (e.g., BFI01752024)
      const formattedSn = String(snNo).padStart(2, '0');
      const studentId = `BFI${formattedSn}${batchNumber}${year}`;
      const fullName = `${firstName} ${lastName}`;

      // 3. Create student profile record
      insertProfile.run(userId, fullName, studentId, batchNumber);

      // 4. Enroll in courses
      if (Array.isArray(courses) && courses.length > 0) {
        const enrollStmt = db.prepare(`
          INSERT INTO student_course_enrollments (user_id, course_name, course_type)
          VALUES (?, ?, ?)
        `);
        for (const course of courses) {
          const type = course === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
          enrollStmt.run(userId, course, type);
        }
      }

      return { userId, studentId };
    });

    const { studentId } = transaction();

    // SUCCESS - Return the generated credentials to the admin so they can share them
    // Note: In a production app, you might also trigger an email sending service here.
    res.status(201).json({
      message: 'Student account created successfully.',
      student: {
        firstName,
        lastName,
        email,
        mobileNumber,
        studentId,
        username,
        rawPassword // DANGER: Only returned once to the admin!
      }
    });

  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Internal server error while creating student account.' });
  }
});

// Route to list all students (for the admin dashboard)
router.get('/students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const students = db.prepare(`
      SELECT 
        u.id, u.username, u.email, u.first_name, u.last_name, u.mobile_number, u.is_active, u.created_at,
        p.student_id, p.batch_number, p.full_name, p.whatsapp_number,
        p.phase1_fee, p.phase2_fee
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student'
      ORDER BY u.created_at DESC
    `).all();

    // Fetch enrollments for each student
    const enrolledStudents = students.map(s => {
      const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(s.id);
      return { ...s, enrollments };
    });

    res.json({ students: enrolledStudents });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Internal server error while fetching students.' });
  }
});

// Route to edit a student's basic profile details
router.put('/students/:id', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const studentIdNum = parseInt(req.params.id, 10);
    const { firstName, lastName, email, mobileNumber, batchNumber, username, phase1_fee, phase2_fee, courses } = req.body;

    if (!firstName || !lastName || !email || !username) {
      return res.status(400).json({ error: 'Required fields missing.' });
    }

    // 1. Conflict checks
    const existing = db.prepare('SELECT id, email, username FROM users WHERE (email = ? OR username = ?) AND id != ?').get(email, username, studentIdNum);
    if (existing) {
      if (existing.email === email) return res.status(400).json({ error: 'Email already taken.' });
      return res.status(400).json({ error: 'Username already taken.' });
    }

    // Use a transaction for consistency
    const updateTransaction = db.transaction(() => {
      // 2. Update users
      db.prepare(`
        UPDATE users SET first_name = ?, last_name = ?, email = ?, username = ?, mobile_number = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(firstName, lastName, email, username, mobileNumber || '', studentIdNum);

      // 3. Update or Insert profile
      const fullName = `${firstName} ${lastName}`;
      const profileResult = db.prepare(`
        UPDATE student_profiles SET full_name = ?, batch_number = ?, phase1_fee = ?, phase2_fee = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(fullName, batchNumber || '', phase1_fee || '', phase2_fee || '', studentIdNum);
      
      if (profileResult.changes === 0) {
        db.prepare(`
          INSERT INTO student_profiles (user_id, full_name, batch_number, phase1_fee, phase2_fee)
          VALUES (?, ?, ?, ?, ?)
        `).run(studentIdNum, fullName, batchNumber || '', phase1_fee || '', phase2_fee || '');
      }

      // 4. Sync courses (Clear and Re-add is more reliable for simple sync)
      db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ?').run(studentIdNum);
      
      if (Array.isArray(courses) && courses.length > 0) {
        const insertCourse = db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, ?, ?)');
        for (const name of courses) {
          const type = name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
          insertCourse.run(studentIdNum, name, type);
        }
      }
    });

    updateTransaction();
    res.json({ message: 'Success' });

  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Internal server error while updating student account.' });
  }
});

// Route to update a student's course progression (checkmarks)
router.patch('/students/:id/progress', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { course_id, step1_completed, step2_completed, step3_completed, step4_completed } = req.body;
    const studentId = req.params.id; // user_id

    if (!course_id) return res.status(400).json({ error: 'Course ID (enrollment id) is required.' });

    // Build dynamic update to only change provided fields
    let updates = [];
    let params = [];

    if (step1_completed !== undefined) { updates.push('step1_completed = ?'); params.push(step1_completed ? 1 : 0); }
    if (step2_completed !== undefined) { updates.push('step2_completed = ?'); params.push(step2_completed ? 1 : 0); }
    if (step3_completed !== undefined) { updates.push('step3_completed = ?'); params.push(step3_completed ? 1 : 0); }
    if (step4_completed !== undefined) { updates.push('step4_completed = ?'); params.push(step4_completed ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No progression fields provided for update.' });
    }

    params.push(course_id, studentId);
    
    const query = `
      UPDATE student_course_enrollments
      SET ${updates.join(', ')}, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `;
    
    const result = db.prepare(query).run(...params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Course Enrollment not found for this student.' });
    }

    res.json({ message: 'Student progression updated successfully.' });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Internal server error while updating progress.' });
  }
});

// Create global announcement
router.post('/announcements', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { title, content, priority = 'normal' } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required.' });
    }
    
    const stmt = db.prepare('INSERT INTO announcements (admin_id, title, content, priority) VALUES (?, ?, ?, ?)');
    const info = stmt.run(req.user.id, title, content, priority);
    
    res.status(201).json({ message: 'Announcement created successfully.', id: info.lastInsertRowid });
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: 'Internal server error while creating announcement.' });
  }
});

// Delete global announcement
router.delete('/announcements/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM announcements WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ message: 'Announcement deleted successfully.' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: 'Internal server error while deleting announcement.' });
  }
});

export default router;
