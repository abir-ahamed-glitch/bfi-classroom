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

    // Check if email already exists (case-insensitive)
    const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
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
      const parsedSn = parseInt(snNo, 10);
      const cleanSn = isNaN(parsedSn) ? '00' : String(parsedSn).padStart(2, '0');
      const parsedBatch = parseInt(batchNumber, 10);
      const cleanBatch = isNaN(parsedBatch) ? '00' : String(parsedBatch);
      const parsedYear = parseInt(year, 10);
      const cleanYear = isNaN(parsedYear) ? new Date().getFullYear().toString() : String(parsedYear);
      
      const studentId = `BFI${cleanSn}${cleanBatch}${cleanYear}`;
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
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message.includes('UNIQUE')) {
      if (error.message.includes('email')) {
        return res.status(400).json({ error: 'This email is already in use by another student.' });
      } else if (error.message.includes('username')) {
        return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
      } else if (error.message.includes('student_id')) {
        return res.status(400).json({ error: 'This Student ID already exists. Please check the SN number or Batch number.' });
      }
      return res.status(400).json({ error: 'A duplicate record exists. Email, username, and student ID must be unique.' });
    }
    res.status(500).json({ error: 'Internal server error while creating student account.' });
  }
});

// Route for Bulk Importing Students
router.post('/students/bulk', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { students, batchNumber, courses } = req.body;
    
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: 'No students provided for bulk import.' });
    }

    const results = [];
    
    // We will do this carefully: skip invalid ones, or just try to process all
    for (let i = 0; i < students.length; i++) {
      const studentData = students[i];
      // Expecting { name, email, mobile, address, snNo } roughly
      
      const email = studentData.email ? studentData.email.trim() : null;
      let firstName = 'Student';
      let lastName = '';
      
      if (studentData.name) {
        const parts = studentData.name.trim().split(' ');
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      }
      
      const mobileNumber = studentData.mobile ? String(studentData.mobile).trim() : '';
      const address = studentData.address ? studentData.address.trim() : '';
      const permanentAddress = studentData.permanentAddress ? String(studentData.permanentAddress).trim() : '';
      const gender = studentData.gender ? String(studentData.gender).trim() : '';
      const birthday = studentData.birthday ? String(studentData.birthday).trim() : '';
      const profession = studentData.profession ? String(studentData.profession).trim() : '';
      const education = studentData.education ? String(studentData.education).trim() : '';
      const whatsapp = studentData.whatsapp ? String(studentData.whatsapp).trim() : '';
      
      // Auto-assign SN: if not provided, just use index + 1
      const snNo = studentData.snNo || String(i + 1);

      if (!email || !validateEmail(email)) {
        results.push({ ...studentData, status: 'error', error: 'Invalid or missing email' });
        continue;
      }
      
      const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
      if (existingUser) {
        results.push({ ...studentData, status: 'error', error: 'Email already exists' });
        continue;
      }

      // Generate credentials
      const baseUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const username = `${baseUsername}.${randomSuffix}`;
      
      // Password: bfi@ + last 6 digits of mobile, or random
      let rawPassword = `bfi@${Math.random().toString().substring(2,8)}`;
      if (mobileNumber && mobileNumber.length >= 6) {
        rawPassword = `bfi@${mobileNumber.slice(-6)}`;
      } else if (mobileNumber) {
        rawPassword = `bfi@${mobileNumber}`;
      }

      const passwordHash = bcrypt.hashSync(rawPassword, 12);
      
      try {
        const insertUser = db.prepare(`
          INSERT INTO users (username, email, password_hash, role, first_name, last_name, mobile_number)
          VALUES (?, ?, ?, 'student', ?, ?, ?)
        `);

        const insertProfile = db.prepare(`
          INSERT INTO student_profiles (user_id, full_name, student_id, batch_number, present_address, permanent_address, gender, birthday, profession, educational_qualification, whatsapp_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const transaction = db.transaction(() => {
          const result = insertUser.run(username, email, passwordHash, firstName, lastName, mobileNumber);
          const userId = result.lastInsertRowid;
          
          const parsedSn = parseInt(snNo, 10);
          const cleanSn = isNaN(parsedSn) ? '00' : String(parsedSn).padStart(2, '0');
          const studentBatch = studentData.batch || batchNumber;
          const parsedBatch = parseInt(studentBatch, 10);
          const cleanBatch = isNaN(parsedBatch) ? '00' : String(parsedBatch);
          const studentYear = studentData.year || new Date().getFullYear().toString();
          const parsedYear = parseInt(studentYear, 10);
          const cleanYear = isNaN(parsedYear) ? new Date().getFullYear().toString() : String(parsedYear);
          
          const studentId = `BFI${cleanSn}${cleanBatch}${cleanYear}`;
          const fullName = `${firstName} ${lastName}`;

          insertProfile.run(userId, fullName, studentId, studentBatch || '', address, permanentAddress, gender, birthday, profession, education, whatsapp);

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

          return { studentId };
        });

        const { studentId } = transaction();
        
        results.push({
          ...studentData,
          status: 'success',
          username: username,
          password: rawPassword,
          studentId: studentId
        });

      } catch (err) {
        let errorMessage = err.message;
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message.includes('UNIQUE')) {
          if (err.message.includes('email')) errorMessage = 'Email already exists.';
          else if (err.message.includes('username')) errorMessage = 'Username already exists.';
          else if (err.message.includes('student_id')) errorMessage = 'Student ID already exists.';
          else errorMessage = 'Duplicate record found (email, username, or ID).';
        }
        results.push({ ...studentData, status: 'error', error: errorMessage });
      }
    }
    const saveHistory = req.query.saveHistory !== 'false';
    if (saveHistory) {
      try {
        const insertHistory = db.prepare(`
          INSERT INTO bulk_import_history (filename, batch_number, results_json, imported_by)
          VALUES (?, ?, ?, ?)
        `);
        insertHistory.run(
          `BFI_Students_Import_Batch_${batchNumber || 'New'}_${Date.now()}.xlsx`,
          batchNumber || 'Mixed',
          JSON.stringify(results),
          req.user.userId || req.user.id
        );
      } catch (historyErr) {
        console.error('Failed to save import history:', historyErr);
      }
    }

    res.status(200).json({
      message: `Processed ${students.length} students.`,
      results
    });

  } catch (error) {
    console.error('Error in bulk import:', error);
    res.status(500).json({ error: 'Internal server error during bulk import.' });
  }
});

// Save bulk import history manually (used when importing sequentially from frontend)
router.post('/imports/save-history', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { batchNumber, results } = req.body;
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Results array is required' });
    }
    const insertHistory = db.prepare(`
      INSERT INTO bulk_import_history (filename, batch_number, results_json, imported_by)
      VALUES (?, ?, ?, ?)
    `);
    insertHistory.run(
      `BFI_Students_Import_Batch_${batchNumber || 'New'}_${Date.now()}.xlsx`,
      batchNumber || 'Mixed',
      JSON.stringify(results),
      req.user.userId || req.user.id
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Save history error:', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
});

// Get import history list
router.get('/imports/history', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const history = db.prepare(`
      SELECT id, filename, batch_number, imported_by, created_at 
      FROM bulk_import_history 
      ORDER BY id DESC LIMIT 50
    `).all();
    res.status(200).json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch import history' });
  }
});

// Get specific import details
router.get('/imports/history/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const record = db.prepare('SELECT results_json FROM bulk_import_history WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'History not found' });
    res.status(200).json(JSON.parse(record.results_json));
  } catch (error) {
    console.error('Error fetching history details:', error);
    res.status(500).json({ error: 'Failed to fetch history details' });
  }
});

// Update a student account
router.put('/students/:id', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { id } = req.params;
    const { 
      firstName, lastName, email, mobileNumber, username, batchNumber, phase1_fee, phase2_fee, courses, snNo, year
    } = req.body;

    const transaction = db.transaction(() => {
      // 1. Update users
      db.prepare(`
        UPDATE users 
        SET first_name = ?, last_name = ?, email = ?, mobile_number = ?, username = ?
        WHERE id = ?
      `).run(firstName, lastName, email, mobileNumber, username, id);

      // 2. Update student_profiles
      const fullName = `${firstName} ${lastName}`;
      
      const parsedSn = parseInt(snNo, 10);
      const cleanSn = isNaN(parsedSn) ? '00' : String(parsedSn).padStart(2, '0');
      const parsedBatch = parseInt(batchNumber, 10);
      const cleanBatch = isNaN(parsedBatch) ? '00' : String(parsedBatch);
      const parsedYear = parseInt(year, 10);
      const cleanYear = isNaN(parsedYear) ? new Date().getFullYear().toString() : String(parsedYear);
      
      const studentId = `BFI${cleanSn}${cleanBatch}${cleanYear}`;

      db.prepare(`
        UPDATE student_profiles 
        SET full_name = ?, batch_number = ?, phase1_fee = ?, phase2_fee = ?, student_id = ?
        WHERE user_id = ?
      `).run(fullName, batchNumber || '', phase1_fee || '', phase2_fee || '', studentId, id);

      // 3. Update course enrollments
      const currentEnrollments = db.prepare('SELECT course_name FROM student_course_enrollments WHERE user_id = ?').all(id).map(r => r.course_name);
      
      const newCourses = courses || [];
      const toAdd = newCourses.filter(c => !currentEnrollments.includes(c));
      const toRemove = currentEnrollments.filter(c => !newCourses.includes(c));

      if (toRemove.length > 0) {
        const removeStmt = db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ? AND course_name = ?');
        for (const course of toRemove) {
          removeStmt.run(id, course);
        }
      }

      if (toAdd.length > 0) {
        const addStmt = db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, ?, ?)');
        for (const course of toAdd) {
          const type = course === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
          addStmt.run(id, course, type);
        }
      }
    });

    transaction();
    res.json({ message: 'Student updated successfully' });

  } catch (error) {
    console.error('Error updating student:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message.includes('UNIQUE')) {
      if (error.message.includes('email')) {
        return res.status(400).json({ error: 'This email is already in use by another student.' });
      } else if (error.message.includes('username')) {
        return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
      } else if (error.message.includes('student_id')) {
        return res.status(400).json({ error: 'This Student ID already exists. Please check the SN number or Batch number.' });
      }
      return res.status(400).json({ error: 'A duplicate record exists. Email, username, and student ID must be unique.' });
    }
    res.status(500).json({ error: 'Failed to update student.' });
  }
});

// Route to create a new teacher account
router.post('/teachers', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      mobileNumber = '',
      gender = '',
      manualUsername = '',
      manualPassword = '',
      subjects = [] 
    } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required.' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    // Check if email already exists (case-insensitive)
    const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    // Determine Username
    let username = manualUsername.trim();
    if (!username) {
      const baseUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      username = `${baseUsername}.${randomSuffix}`;
    }

    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUsername) {
      return res.status(400).json({ error: 'Username is already taken. Please choose another one.' });
    }

    // Determine Password
    const rawPassword = manualPassword ? manualPassword : generateRandomString(12);
    const passwordHash = bcrypt.hashSync(rawPassword, 12);

    const insertUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, mobile_number)
      VALUES (?, ?, ?, 'instructor', ?, ?, ?)
    `);

    const insertProfile = db.prepare(`
      INSERT INTO instructor_profiles (user_id, full_name, subjects, whatsapp_number, gender)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      const result = insertUser.run(username, email, passwordHash, firstName, lastName, mobileNumber);
      const userId = result.lastInsertRowid;
      
      const fullName = `${firstName} ${lastName}`;
      const subjectsJson = JSON.stringify(subjects);

      insertProfile.run(userId, fullName, subjectsJson, mobileNumber, gender);

      return { userId };
    });

    transaction();

    res.status(201).json({
      message: 'Teacher account created successfully.',
      teacher: {
        firstName,
        lastName,
        email,
        mobileNumber,
        username,
        rawPassword 
      }
    });

  } catch (error) {
    console.error('Error creating teacher:', error);
    res.status(500).json({ error: 'Internal server error while creating teacher account.' });
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

// Route to list all teachers
router.get('/teachers', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT 
        u.id, u.username, u.email, u.first_name, u.last_name, u.mobile_number, u.is_active, u.created_at,
        p.full_name, p.whatsapp_number, p.subjects, p.gender
      FROM users u
      LEFT JOIN instructor_profiles p ON u.id = p.user_id
      WHERE u.role = 'instructor'
      ORDER BY u.created_at DESC
    `).all();

    // parse JSON subjects
    const parsedTeachers = teachers.map(t => {
      let subjects = [];
      if (t.subjects) {
        try { subjects = JSON.parse(t.subjects); } catch { /* ignore invalid JSON */ }
      }
      return { ...t, subjects };
    });

    res.json({ teachers: parsedTeachers });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ error: 'Internal server error while fetching teachers.' });
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

    // 1. Conflict checks (case-insensitive for email, username)
    const existing = db.prepare('SELECT id, email, username FROM users WHERE (lower(email) = lower(?) OR lower(username) = lower(?)) AND id != ?').get(email, username, studentIdNum);
    if (existing) {
      if (existing.email.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error: 'Email already taken.' });
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

// Route to edit a teacher's basic profile details
router.put('/teachers/:id', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const teacherIdNum = parseInt(req.params.id, 10);
    const { firstName, lastName, email, mobileNumber, gender, username, subjects } = req.body;

    if (!firstName || !lastName || !email || !username) {
      return res.status(400).json({ error: 'Required fields missing.' });
    }

    const existing = db.prepare('SELECT id, email, username FROM users WHERE (lower(email) = lower(?) OR lower(username) = lower(?)) AND id != ?').get(email, username, teacherIdNum);
    if (existing) {
      if (existing.email.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error: 'Email already taken.' });
      return res.status(400).json({ error: 'Username already taken.' });
    }

    const updateTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE users SET first_name = ?, last_name = ?, email = ?, username = ?, mobile_number = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(firstName, lastName, email, username, mobileNumber || '', teacherIdNum);

      const fullName = `${firstName} ${lastName}`;
      const subjectsJson = JSON.stringify(subjects || []);
      
      const profileResult = db.prepare(`
        UPDATE instructor_profiles SET full_name = ?, subjects = ?, gender = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(fullName, subjectsJson, gender || '', teacherIdNum);
      
      if (profileResult.changes === 0) {
        db.prepare(`
          INSERT INTO instructor_profiles (user_id, full_name, subjects, gender)
          VALUES (?, ?, ?, ?)
        `).run(teacherIdNum, fullName, subjectsJson, gender || '');
      }
    });

    updateTransaction();
    res.json({ message: 'Success' });

  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ error: 'Internal server error while updating teacher account.' });
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
    const { title, content, priority = 'normal', targetCourse = null, targetBatch = null } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required.' });
    }
    
    const stmt = db.prepare('INSERT INTO announcements (admin_id, title, content, priority, target_course, target_batch) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(req.user.id, title, content, priority, targetCourse || null, targetBatch || null);
    
    // Broadcast real-time notification to all connected users
    const io = req.app.get('io');
    if (io) {
      io.emit('new_announcement', {
        id: info.lastInsertRowid,
        title,
        priority,
        target_course: targetCourse || null,
        target_batch: targetBatch || null,
      });
    }

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

// Get all announcements
router.get('/announcements', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const announcements = db.prepare(`
      SELECT a.*, u.first_name || ' ' || u.last_name as admin_name 
      FROM announcements a
      JOIN users u ON a.admin_id = u.id
      ORDER BY a.created_at DESC
    `).all();
    res.json({ announcements });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Internal server error while fetching announcements.' });
  }
});

// Get options for targeting announcements
router.get('/targeting-options', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const courses = db.prepare("SELECT DISTINCT course_name FROM student_course_enrollments WHERE course_name IS NOT NULL AND course_name != ''").all().map(r => r.course_name);
    const batches = db.prepare(`
      SELECT DISTINCT batch_number as batch FROM student_profiles WHERE batch_number IS NOT NULL AND batch_number != ''
    `).all().map(r => r.batch).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}));
    
    const pairs = db.prepare(`
      SELECT DISTINCT c.course_name, p.batch_number
      FROM student_course_enrollments c
      JOIN student_profiles p ON c.user_id = p.user_id
      WHERE c.course_name IS NOT NULL AND c.course_name != ''
        AND p.batch_number IS NOT NULL AND p.batch_number != ''
    `).all();
    
    const courseBatches = {};
    for (const pair of pairs) {
      if (!courseBatches[pair.course_name]) courseBatches[pair.course_name] = [];
      courseBatches[pair.course_name].push(pair.batch_number);
    }

    for (const course in courseBatches) {
      courseBatches[course].sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}));
    }
    
    res.json({ courses, batches, courseBatches });
  } catch (error) {
    console.error('Error fetching targeting options:', error);
    res.status(500).json({ error: 'Internal server error while fetching targeting options.' });
  }
});

export default router;
