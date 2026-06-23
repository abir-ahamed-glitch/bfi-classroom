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

// Route to update a student's Phase 2 attendance (Shooting + Editing parts)
// Only for Online Filmmaking Course. If both parts attended => step4_completed = 1
// IMPORTANT: This must be declared BEFORE the generic PUT /students/:id route.
router.put('/students/:id/phase2-attendance/:courseId', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const studentId = req.params.id;
    const courseId = req.params.courseId;
    const { phase2_shooting_attended, phase2_editing_attended } = req.body;

    // Verify the enrollment exists and belongs to Online Filmmaking Course
    const enrollment = db.prepare(`SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?`).get(courseId, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Course enrollment not found.' });
    }
    if (enrollment.course_name !== 'Online Filmmaking Course') {
      return res.status(400).json({ error: 'Phase 2 attendance is only supported for the Online Filmmaking Course.' });
    }

    const shooting = phase2_shooting_attended ? 1 : 0;
    const editing = phase2_editing_attended ? 1 : 0;
    const step4 = (shooting === 1 && editing === 1) ? 1 : 0;

    db.prepare(`
      UPDATE student_course_enrollments
      SET phase2_shooting_attended = ?,
          phase2_editing_attended = ?,
          step4_completed = ?,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(shooting, editing, step4, courseId, studentId);

    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { studentId: parseInt(studentId, 10) });
    }

    res.json({ success: true, step4_completed: step4 });
  } catch (error) {
    console.error('Error updating Phase 2 attendance:', error);
    res.status(500).json({ error: 'Internal server error while updating Phase 2 attendance.' });
  }
});

// Update a student account
router.put('/students/:id', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { id } = req.params;
    const { 
      firstName, lastName, email, mobileNumber, username, batchNumber, phase1_fee, phase2_fee, courses, snNo, year, course_fees
    } = req.body;

    console.log(`[AdminAPI] PUT /students/${id} called with:`, {
      firstName, lastName, email, username, batchNumber, snNo, year, courses, course_fees
    });

    // Validate Phase 2 fee details restriction: Cannot set Phase 2 details if Phase 1 exam is not passed
    if (course_fees?.['Online Filmmaking Course']?.phase2) {
      const existingEnrollment = db.prepare('SELECT step2_completed, fee_details FROM student_course_enrollments WHERE user_id = ? AND course_name = ?').get(id, 'Online Filmmaking Course');
      const step2Completed = existingEnrollment ? existingEnrollment.step2_completed : 0;
      if (step2Completed !== 1) {
        const p2 = course_fees['Online Filmmaking Course'].phase2;
        
        // Parse existing Phase 2 details
        let existingP2 = null;
        if (existingEnrollment && existingEnrollment.fee_details) {
          try {
            const parsed = JSON.parse(existingEnrollment.fee_details);
            existingP2 = parsed?.phase2;
          } catch (e) {
            console.error('Failed to parse existing fee details:', e);
          }
        }

        // Check if there is any new/modified Phase 2 data compared to what's already saved
        const hasP2Data = p2.full_fee || p2.amount_paid || p2.status || p2.discount || (p2.installments && p2.installments.length > 0);
        
        if (hasP2Data) {
          // Compare p2 to existingP2
          const cleanString = (val) => String(val || '').trim();
          const cleanNum = (val) => parseFloat(String(val || '').replace(/[^\d.]/g, '')) || 0;
          
          const fullFeeChanged = cleanString(p2.full_fee) !== cleanString(existingP2?.full_fee);
          const amountPaidChanged = cleanNum(p2.amount_paid) !== cleanNum(existingP2?.amount_paid);
          const statusChanged = cleanString(p2.status) !== cleanString(existingP2?.status);
          const discountChanged = cleanString(p2.discount) !== cleanString(existingP2?.discount);
          
          // Check installments change
          const instChanged = JSON.stringify(p2.installments || []) !== JSON.stringify(existingP2?.installments || []);

          if (fullFeeChanged || amountPaidChanged || statusChanged || discountChanged || instChanged) {
            return res.status(400).json({ error: 'Cannot set or modify Phase 2 fee details because the student has not passed the Phase 1 exam.' });
          }
        }
      }
    }

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

      // 4. Update fee details for all currently enrolled courses
      const updateFeeStmt = db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE user_id = ? AND course_name = ?');
      const forceStep1Stmt = db.prepare('UPDATE student_course_enrollments SET step1_completed = 1 WHERE user_id = ? AND course_name = ?');
      const forceStep3Stmt = db.prepare('UPDATE student_course_enrollments SET step3_completed = 1 WHERE user_id = ? AND course_name = ?');
      for (const course of newCourses) {
        const feeInfo = course_fees?.[course] ? JSON.stringify(course_fees[course]) : null;
        updateFeeStmt.run(feeInfo, id, course);

        if (course_fees?.[course]) {
          const cfee = course_fees[course];
          
          if (course === 'Online Filmmaking Course') {
            // Phase 1 payment check
            const phase1 = cfee.phase1 || {};
            const amountPaidNum = parseFloat((phase1.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
            const hasPaidInst = (phase1.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
            if (amountPaidNum > 0 || hasPaidInst) {
              forceStep1Stmt.run(id, course);
            }

            // Phase 2 payment check
            const phase2 = cfee.phase2 || {};
            const phase2PaidNum = parseFloat((phase2.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
            const phase2HasPaidInst = (phase2.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
            if (phase2PaidNum > 0 || phase2HasPaidInst) {
              forceStep3Stmt.run(id, course);
            }
          } else {
            // Other courses (Workshops) payment check
            const amountPaidNum = parseFloat((cfee.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
            const hasPaidInst = (cfee.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
            if (amountPaidNum > 0 || hasPaidInst) {
              forceStep1Stmt.run(id, course);
            }
          }
        }
      }
    });

    transaction();

    // Emit live update event to notify the student's portal to refresh
    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { studentId: parseInt(id, 10) });
    }

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

// Route to get a specific student details
router.get('/students/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const student = db.prepare(`
      SELECT 
        u.id, u.username, u.email, u.first_name, u.last_name, u.mobile_number, u.is_active, u.created_at,
        p.student_id, p.batch_number, p.full_name, p.whatsapp_number,
        p.phase1_fee, p.phase2_fee
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student' AND u.id = ?
    `).get(id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(student.id);
    res.json({ student: { ...student, enrollments } });
  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ error: 'Internal server error while fetching student details.' });
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

// Note: The student update logic is handled by the PUT /students/:id route defined above.

// Route to delete a student account
router.delete('/students/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const studentIdNum = parseInt(req.params.id, 10);

    // Verify it's actually a student
    const student = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").get(studentIdNum);
    if (!student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    // Manually clean up all related records in a transaction.
    // This handles databases created before CASCADE rules were in place.
    const deleteStudent = db.transaction((id) => {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM post_likes WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM post_comments WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?').run(id, id);
      db.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM message_reports WHERE reporter_id = ? OR reported_user_id = ?').run(id, id);
      db.prepare('DELETE FROM message_hidden_for_users WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(id, id);
      db.prepare('DELETE FROM social_links WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM awards WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM project_credits WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(id);
      db.prepare('DELETE FROM projects WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM student_experiences WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM community_posts WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    deleteStudent(studentIdNum);

    res.json({ message: 'Student account deleted successfully' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Internal server error while deleting student account.' });
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

    // Validate phase payment restrictions for Online Filmmaking Course
    const enrollment = db.prepare('SELECT course_name, fee_details FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(course_id, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    if (enrollment.course_name === 'Online Filmmaking Course') {
      let feeDetails = {};
      if (enrollment.fee_details) {
        try {
          feeDetails = typeof enrollment.fee_details === 'string' ? JSON.parse(enrollment.fee_details) : enrollment.fee_details;
        } catch (err) {
          console.error(err);
        }
      }

      const phase1 = feeDetails?.phase1 || {};
      const fullFeeNum = parseFloat((phase1.full_fee || '').replace(/[^\d.]/g, '')) || 0;
      const amountPaidNum = parseFloat((phase1.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
      const discountNum = parseFloat((phase1.discount || '').replace(/[^\d.]/g, '')) || 0;
      const remainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);
      
      const phase1PaidAny = amountPaidNum > 0 || (phase1.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
      const phase1FullyPaid = (fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum) ||
        (fullFeeNum > 0 && remainingDue > 0 && (phase1.installments || []).length > 0 && (phase1.installments || []).every(inst => inst.status === 'Paid'));

      const phase2 = feeDetails?.phase2 || {};
      const phase2PaidAny = (parseFloat((phase2.amount_paid || '').replace(/[^\d.]/g, '')) || 0) > 0 ||
        (phase2.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);

      if (step1_completed === 0 && phase1PaidAny) {
        return res.status(400).json({ error: 'Cannot uncheck "Phase 1: Admitted" because a payment has already been made for this phase.' });
      }
      if (step3_completed === 1 && !phase1FullyPaid) {
        return res.status(400).json({ error: 'Cannot check "Phase 2: Admitted" because Phase 1 is not fully paid.' });
      }
      if (step3_completed === 0 && phase2PaidAny) {
        return res.status(400).json({ error: 'Cannot uncheck "Phase 2: Admitted" because a payment has already been made for this phase.' });
      }
    }

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

    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { studentId: parseInt(studentId, 10) });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Internal server error while updating progress.' });
  }
});

// Route to update a student's academic records
router.put('/students/:id/academic-records/:courseId', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const studentId = req.params.id;
    const courseId = req.params.courseId;
    const { attendance_classes, attendance_total, exam_written, assignment_screenplay, assignment_shooting_script } = req.body;

    // Verify the enrollment exists
    const enrollment = db.prepare(`SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?`).get(courseId, studentId);
    
    if (!enrollment) {
      return res.status(404).json({ error: 'Course enrollment not found.' });
    }

    // Custom flow for all courses except Online Filmmaking Course (no attendance, no assignments, score out of 100)
    if (enrollment.course_name !== 'Online Filmmaking Course') {
      const exam = parseInt(exam_written) || 0;
      const completed = exam >= 33 ? 1 : 0;
      
      db.prepare(`
        UPDATE student_course_enrollments
        SET exam_written = ?, 
            assignment_screenplay = 0, 
            assignment_shooting_script = 0,
            step4_completed = ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(exam, completed, courseId, studentId);

      const io = req.app.get('io');
      if (io) {
        io.emit('progression_updated', { studentId: parseInt(studentId, 10) });
      }

      return res.json({ success: true });
    }

    const attendance = parseInt(attendance_classes) || 0;
    const totalAttendance = parseInt(attendance_total) || 22;
    const exam = parseInt(exam_written) || 0;
    const screenplay = parseInt(assignment_screenplay) || 0;
    const shootingScript = parseInt(assignment_shooting_script) || 0;

    const transaction = db.transaction(() => {
      // 1. Update the specific student's record with all the fields (except step2_completed)
      db.prepare(`
        UPDATE student_course_enrollments
        SET attendance_classes = ?, 
            attendance_total = ?,
            exam_written = ?, 
            assignment_screenplay = ?, 
            assignment_shooting_script = ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(attendance, totalAttendance, exam, screenplay, shootingScript, courseId, studentId);

      // 2. Sync the new attendance_total to EVERYONE in the same course
      db.prepare(`
        UPDATE student_course_enrollments
        SET attendance_total = ?,
            updated_at = datetime('now')
        WHERE course_name = 'Online Filmmaking Course'
      `).run(totalAttendance);

      // 3. Recalculate pass/fail for EVERYONE in the course
      const allEnrollments = db.prepare(`
        SELECT id, user_id, attendance_classes, attendance_total, exam_written, assignment_screenplay, assignment_shooting_script, step2_completed
        FROM student_course_enrollments
        WHERE course_name = 'Online Filmmaking Course'
      `).all();

      let targetStudentPassed = 0;

      for (const e of allEnrollments) {
        const attClasses = e.attendance_classes || 0;
        const attTotal = e.attendance_total || 22;
        const eExam = e.exam_written || 0;
        const eScr = e.assignment_screenplay || 0;
        const eShoot = e.assignment_shooting_script || 0;
        
        const attPercentage = attTotal > 0 ? (attClasses / attTotal) * 100 : 0;
        const totalM = eExam + eScr + eShoot;
        const pass = (attPercentage >= 80 && totalM >= 33) ? 1 : 0;

        if (e.id === Number(courseId) && e.user_id === Number(studentId)) {
          targetStudentPassed = pass;
        }

        if (pass === 0) {
          db.prepare(`
            UPDATE student_course_enrollments
            SET step2_completed = 0, step3_completed = 0, step4_completed = 0
            WHERE id = ? AND user_id = ?
          `).run(e.id, e.user_id);
        } else {
          db.prepare(`
            UPDATE student_course_enrollments
            SET step2_completed = 1
            WHERE id = ? AND user_id = ?
          `).run(e.id, e.user_id);
        }
      }
      
      return targetStudentPassed;
    });

    const isPassed = transaction();

    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { bulk: true });
    }

    res.json({ success: true, step2_completed: isPassed });
  } catch (error) {
    console.error('Error updating academic records:', error);
    res.status(500).json({ error: 'Internal server error while updating academic records.' });
  }
});

// Create global announcement
router.post('/announcements', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { title, content, priority = 'normal', targetCourse = null, targetBatch = null, image_url = null, scheduled_at = null } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required.' });
    }

    let scheduledAtValue = null;
    if (scheduled_at) {
      const scheduledDate = new Date(scheduled_at);
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduled_at date.' });
      }
      if (scheduledDate <= new Date()) {
        return res.status(400).json({ error: 'Scheduled time must be in the future.' });
      }
      scheduledAtValue = scheduledDate.toISOString();
    }
    
    const stmt = db.prepare('INSERT INTO announcements (admin_id, title, content, priority, target_course, target_batch, image_url, scheduled_at, scheduled_notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const info = stmt.run(req.user.id, title, content, priority, targetCourse || null, targetBatch || null, image_url || null, scheduledAtValue, 0);
    
    if (!scheduledAtValue) {
      // Insert into notifications table for relevant users
      let targetUsers = [];
      if (!targetCourse && !targetBatch) {
        targetUsers = db.prepare('SELECT id FROM users').all();
      } else {
        let query = `
          SELECT DISTINCT u.id 
          FROM users u
          LEFT JOIN student_course_enrollments e ON u.id = e.user_id
          LEFT JOIN student_profiles p ON u.id = p.user_id
          WHERE u.role = 'student'
        `;
        const params = [];
        if (targetCourse) {
          query += ` AND e.course_name = ?`;
          params.push(targetCourse);
        }
        if (targetBatch) {
          query += ` AND p.batch_number = ?`;
          params.push(targetBatch);
        }
        targetUsers = db.prepare(query).all(...params);
      }

      const targetUserNotifications = [];
      if (targetUsers.length > 0) {
        const insertNotification = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, image_url) VALUES (?, ?, ?, ?, ?, ?)');
        const insertMany = db.transaction((users) => {
          for (const user of users) {
            if (user.id !== req.user.id) {
              const res = insertNotification.run(user.id, 'notice', 'New Notice', title, '/notices', image_url || null);
              targetUserNotifications.push({ userId: user.id, notifId: res.lastInsertRowid });
            }
          }
        });
        insertMany(targetUsers);
      }

      // Broadcast real-time notification to all connected users
      const io = req.app.get('io');
      if (io) {
        io.emit('new_announcement', {
          id: info.lastInsertRowid,
          title,
          priority,
          target_course: targetCourse || null,
          target_batch: targetBatch || null,
          image_url: image_url || null
        });

        const adminUser = db.prepare('SELECT first_name, last_name, profile_picture FROM users WHERE id = ?').get(req.user.id);
        const adminName = adminUser ? `${adminUser.first_name} ${adminUser.last_name}` : 'Admin';
        const adminAvatar = adminUser ? adminUser.profile_picture : null;

        for (const item of targetUserNotifications) {
          io.to(`user:${item.userId}`).emit('notification_received', {
            id: item.notifId,
            type: 'notice',
            title: 'New Notice',
            message: title,
            link: '/notices',
            image_url: image_url || null,
            sender_name: adminName,
            sender_avatar: adminAvatar,
            created_at: new Date().toISOString()
          });
        }
        io.emit('new_notification');
      }
    }

    res.status(201).json({ 
      message: scheduledAtValue ? 'Announcement scheduled successfully.' : 'Announcement created successfully.', 
      id: info.lastInsertRowid,
      scheduled_at: scheduledAtValue
    });
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

// Get all custom subjects
router.get('/custom-subjects', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const subjects = db.prepare('SELECT id, name, sort_order, created_at FROM custom_subjects ORDER BY sort_order ASC, name ASC').all();
    res.json({ subjects });
  } catch (error) {
    console.error('Error fetching custom subjects:', error);
    res.status(500).json({ error: 'Internal server error while fetching custom subjects.' });
  }
});

// Create a new custom subject
router.post('/custom-subjects', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Subject name is required.' });
    }

    const trimmedName = name.trim();

    // Check if duplicate exists in custom_subjects
    const existing = db.prepare('SELECT id FROM custom_subjects WHERE lower(name) = lower(?)').get(trimmedName);
    if (existing) {
      return res.status(400).json({ error: 'A custom subject with this name already exists.' });
    }

    const maxOrderRow = db.prepare('SELECT MAX(sort_order) as maxOrder FROM custom_subjects').get();
    const nextOrder = maxOrderRow && maxOrderRow.maxOrder !== null ? maxOrderRow.maxOrder + 1 : 0;

    const result = db.prepare('INSERT INTO custom_subjects (name, sort_order) VALUES (?, ?)').run(trimmedName, nextOrder);
    res.status(201).json({ 
      subject: {
        id: result.lastInsertRowid,
        name: trimmedName,
        sort_order: nextOrder
      }
    });
  } catch (error) {
    console.error('Error creating custom subject:', error);
    res.status(500).json({ error: 'Internal server error while creating custom subject.' });
  }
});

// Reorder custom subjects
router.put('/custom-subjects/reorder', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { orders } = req.body; // Array of { id, sort_order }
    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Invalid payload. An array of orders is required.' });
    }

    const updateStmt = db.prepare('UPDATE custom_subjects SET sort_order = ? WHERE id = ?');
    const updateTransaction = db.transaction((ordersList) => {
      for (const item of ordersList) {
        updateStmt.run(item.sort_order, item.id);
      }
    });

    updateTransaction(orders);
    res.json({ message: 'Subjects reordered successfully.' });
  } catch (error) {
    console.error('Error reordering custom subjects:', error);
    res.status(500).json({ error: 'Internal server error while reordering custom subjects.' });
  }
});

// Update a custom subject
router.put('/custom-subjects/:id', authenticateToken, requireRole('admin'), sanitizeInput, (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Subject name is required.' });
    }

    const trimmedName = name.trim();

    // Check if custom subject exists
    const subject = db.prepare('SELECT name FROM custom_subjects WHERE id = ?').get(id);
    if (!subject) {
      return res.status(404).json({ error: 'Custom subject not found.' });
    }

    // Check if duplicate exists in custom_subjects (but exclude the current subject's ID)
    const existing = db.prepare('SELECT id FROM custom_subjects WHERE lower(name) = lower(?) AND id != ?').get(trimmedName, id);
    if (existing) {
      return res.status(400).json({ error: 'Another custom subject with this name already exists.' });
    }

    db.prepare('UPDATE custom_subjects SET name = ? WHERE id = ?').run(trimmedName, id);

    // Cascade rename to instructor profiles
    try {
      const profiles = db.prepare('SELECT user_id, subjects FROM instructor_profiles').all();
      const updateStmt = db.prepare('UPDATE instructor_profiles SET subjects = ? WHERE user_id = ?');
      for (const p of profiles) {
        if (p.subjects) {
          try {
            let subjectsArr = JSON.parse(p.subjects);
            if (Array.isArray(subjectsArr) && subjectsArr.includes(subject.name)) {
              const updatedArr = subjectsArr.map(s => s === subject.name ? trimmedName : s);
              updateStmt.run(JSON.stringify(updatedArr), p.user_id);
            }
          } catch (e) {
            console.error(`Failed to cascade rename subjects for instructor ${p.user_id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to update teacher profiles during subject rename cascade:', e);
    }

    res.json({ 
      subject: {
        id: Number(id),
        name: trimmedName
      }
    });
  } catch (error) {
    console.error('Error update custom subject:', error);
    res.status(500).json({ error: 'Internal server error while updating custom subject.' });
  }
});

// Delete a custom subject
router.delete('/custom-subjects/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if custom subject exists
    const subject = db.prepare('SELECT name FROM custom_subjects WHERE id = ?').get(id);
    if (!subject) {
      return res.status(404).json({ error: 'Custom subject not found.' });
    }

    db.prepare('DELETE FROM custom_subjects WHERE id = ?').run(id);

    // Cascade delete to instructor profiles
    try {
      const profiles = db.prepare('SELECT user_id, subjects FROM instructor_profiles').all();
      const updateStmt = db.prepare('UPDATE instructor_profiles SET subjects = ? WHERE user_id = ?');
      for (const p of profiles) {
        if (p.subjects) {
          try {
            let subjectsArr = JSON.parse(p.subjects);
            if (Array.isArray(subjectsArr) && subjectsArr.includes(subject.name)) {
              const updatedArr = subjectsArr.filter(s => s !== subject.name);
              updateStmt.run(JSON.stringify(updatedArr), p.user_id);
            }
          } catch (e) {
            console.error(`Failed to cascade delete subjects for instructor ${p.user_id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to update teacher profiles during subject delete cascade:', e);
    }

    res.json({ message: 'Custom subject deleted successfully.' });
  } catch (error) {
    console.error('Error deleting custom subject:', error);
    res.status(500).json({ error: 'Internal server error while deleting custom subject.' });
  }
});

export function startAnnouncementScheduler(io) {
  // Check every 10 seconds for scheduled announcements that are due to be published
  setInterval(() => {
    try {
      const pendingAnnouncements = db.prepare(`
        SELECT id, admin_id, title, content, priority, target_course, target_batch, image_url, scheduled_at
        FROM announcements
        WHERE scheduled_at IS NOT NULL
          AND datetime(scheduled_at) <= datetime('now')
          AND scheduled_notified = 0
      `).all();

      if (pendingAnnouncements.length > 0) {
        console.log(`[Announcement Scheduler] Publishing ${pendingAnnouncements.length} scheduled announcements...`);
        const updateNotified = db.prepare(`
          UPDATE announcements
          SET scheduled_notified = 1
          WHERE id = ?
        `);

        for (const ann of pendingAnnouncements) {
          // Get target users
          let targetUsers = [];
          if (!ann.target_course && !ann.target_batch) {
            targetUsers = db.prepare('SELECT id FROM users').all();
          } else {
            let query = `
              SELECT DISTINCT u.id 
              FROM users u
              LEFT JOIN student_course_enrollments e ON u.id = e.user_id
              LEFT JOIN student_profiles p ON u.id = p.user_id
              WHERE u.role = 'student'
            `;
            const params = [];
            if (ann.target_course) {
              query += ` AND e.course_name = ?`;
              params.push(ann.target_course);
            }
            if (ann.target_batch) {
              query += ` AND p.batch_number = ?`;
              params.push(ann.target_batch);
            }
            targetUsers = db.prepare(query).all(...params);
          }

          const targetUserNotifications = [];
          if (targetUsers.length > 0) {
            const insertNotification = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, image_url) VALUES (?, ?, ?, ?, ?, ?)');
            const insertMany = db.transaction((users) => {
              for (const user of users) {
                if (user.id !== ann.admin_id) {
                  const res = insertNotification.run(user.id, 'notice', 'New Notice', ann.title, '/notices', ann.image_url || null);
                  targetUserNotifications.push({ userId: user.id, notifId: res.lastInsertRowid });
                }
              }
            });
            insertMany(targetUsers);
          }

          updateNotified.run(ann.id);

          if (io) {
            io.emit('new_announcement', {
              id: ann.id,
              title: ann.title,
              priority: ann.priority,
              target_course: ann.target_course || null,
              target_batch: ann.target_batch || null,
              image_url: ann.image_url || null
            });

            const adminUser = db.prepare('SELECT first_name, last_name, profile_picture FROM users WHERE id = ?').get(ann.admin_id);
            const adminName = adminUser ? `${adminUser.first_name} ${adminUser.last_name}` : 'Admin';
            const adminAvatar = adminUser ? adminUser.profile_picture : null;

            for (const item of targetUserNotifications) {
              io.to(`user:${item.userId}`).emit('notification_received', {
                id: item.notifId,
                type: 'notice',
                title: 'New Notice',
                message: ann.title,
                link: '/notices',
                image_url: ann.image_url || null,
                sender_name: adminName,
                sender_avatar: adminAvatar,
                created_at: new Date().toISOString()
              });
            }
            io.emit('new_notification');
          }
        }
      }
    } catch (error) {
      console.error('[Announcement Scheduler] Error processing scheduled announcements:', error);
    }
  }, 10000);
}

export default router;
