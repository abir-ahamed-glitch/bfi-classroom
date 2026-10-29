import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/database.js';
import { authenticateToken, requireRole, requireSuperAdmin, requirePermission, requireAnyPermission, isSuperAdmin, sanitizeInput, validateEmail } from '../middleware/auth.js';
import { recordAuditEventFromReq } from '../services/auditLedgerService.js';
import { logTrashAction } from '../utils/trashLogger.js';
import courseProgressService from '../services/courseProgressService.js';
import { resolveDiscountAmount, resolvePhaseFee } from '../utils/feeResolver.js';

const router = express.Router();

// Verification endpoint for Super Admin access
router.get('/super-admin/verify', authenticateToken, requireSuperAdmin, (req, res) => {
  res.json({ success: true, message: 'Super Administrator authorization verified', user: req.user });
});

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
router.post('/students', authenticateToken, requireRole('admin'), requirePermission('students:create'), sanitizeInput, (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email: rawEmail, 
      mobileNumber = '',
      batchNumber = '',
      snNo = '',
      year = '',
      manualUsername = '',
      manualPassword = '',
      courses = [] // ['Online Filmmaking Course', 'Film Appreciation Course', etc.]
    } = req.body;

    if (!firstName || !lastName || !snNo || !batchNumber || !year) {
      return res.status(400).json({ error: 'First name, last name, SN No, Batch, and Year are required.' });
    }

    // Determine Username: Use manual if provided, otherwise generate automatically
    let username = manualUsername.trim();
    if (!username) {
      // Auto-generate logic: firstname.lastname.randomLetters
      const baseUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      username = `${baseUsername}.${randomSuffix}`;
    }

    // Generate a fake email if missing/invalid
    const email = (rawEmail && rawEmail.trim() && validateEmail(rawEmail.trim())) 
      ? rawEmail.trim() 
      : `${username}@bfi-app.org`;

    // Check if email already exists (case-insensitive)
    const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
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
          let type = course === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
          const cd = db.prepare('SELECT course_type FROM course_definitions WHERE name = ? ORDER BY version DESC LIMIT 1').get(course);
          if (cd?.course_type) type = cd.course_type;
          enrollStmt.run(userId, course, type);
        }
      }

      recordAuditEventFromReq(req, {
        action: 'student.create',
        module: 'students',
        resource: `student:${studentId}`,
        targetUserId: userId,
        outcome: 'success',
        details: { firstName, lastName, email, studentId },
        afterState: { id: userId, username, email, studentId },
        throwOnError: true
      });

      return { userId, studentId };
    });

    const { userId, studentId } = transaction();
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
router.post('/students/bulk', authenticateToken, requireRole('admin'), requirePermission('students:create'), sanitizeInput, (req, res) => {
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
      
      const emailInput = studentData.email ? studentData.email.trim() : null;
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

      // Generate credentials
      const baseUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const username = req.query.isRegisteredOnly === 'true' ? `lead_${Date.now()}_${randomSuffix}` : `${baseUsername}.${randomSuffix}`;

      // Generate a fake email if missing/invalid
      const hasRealEmail = emailInput && validateEmail(emailInput);
      const email = hasRealEmail ? emailInput : `${username}@bfi-app.org`;

      let existingUserId = null;
      let duplicateReason = null;

      // Duplicate full-name guard: if no real email, check for same full name
      if (!hasRealEmail) {
        const fullName = `${firstName} ${lastName}`.trim();
        const existingByName = db.prepare(
          `SELECT sp.user_id FROM student_profiles sp WHERE LOWER(TRIM(sp.full_name)) = LOWER(TRIM(?))`
        ).get(fullName);
        if (existingByName) {
          existingUserId = existingByName.user_id;
          duplicateReason = 'Name Match';
        }
      }

      // If not found by name, check by email
      if (!existingUserId) {
        const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
        if (existingUser) {
          existingUserId = existingUser.id;
          duplicateReason = 'Email Match';
        }
      }

      if (existingUserId) {
        // Smart Batch Import: Automatically link existing student to the new batch
        const studentBatch = studentData.batch || batchNumber;
        if (studentBatch && Array.isArray(courses) && courses.length > 0) {
          const getOrdinal = (n) => {
            const num = parseInt(n, 10);
            if (isNaN(num)) return n;
            const s = ['th','st','nd','rd'];
            const v = num % 100;
            return num + (s[(v-20) % 10] || s[v] || s[0]);
          };
          for (const course of courses) {
            let batchId;
            const existingBatch = db.prepare('SELECT id FROM batches WHERE batch_number = ? AND course_name = ?').get(studentBatch, course);
            if (existingBatch) {
              batchId = existingBatch.id;
            } else {
              const batchName = `${getOrdinal(studentBatch)} Batch`;
              const resultBatch = db.prepare(`
                INSERT INTO batches (batch_name, batch_number, course_name, status, created_by)
                VALUES (?, ?, ?, 'completed', ?)
              `).run(batchName, studentBatch, course, req.user.userId || req.user.id);
              batchId = resultBatch.lastInsertRowid;
            }
            db.prepare('INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, ?)').run(batchId, existingUserId);
            let type = course === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
            const cd = db.prepare('SELECT course_type FROM course_definitions WHERE name = ? ORDER BY version DESC LIMIT 1').get(course);
            if (cd?.course_type) type = cd.course_type;
            db.prepare('INSERT OR IGNORE INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, ?, ?)').run(existingUserId, course, type);
          }
          // Update primary batch number in profile
          db.prepare('UPDATE student_profiles SET batch_number = ? WHERE user_id = ?').run(studentBatch, existingUserId);
          
          results.push({ ...studentData, status: 'success', error: `Already registered (Linked to Batch ${studentBatch})`, username: 'Existing User', password: 'N/A', studentId: 'Existing' });
          continue;
        } else {
          // If no batch info provided, fallback to standard skip/error
          if (req.query.skipExisting === 'true') {
            results.push({ ...studentData, status: 'success', error: 'Already registered (Skipped)', username: 'Existing User', password: 'N/A', studentId: 'N/A' });
            continue;
          }
          results.push({ ...studentData, status: 'error', error: `Duplicate (${duplicateReason})` });
          continue;
        }
      }

      // Password: bfi@ + last 6 digits of mobile, or random
      let rawPassword = req.query.isRegisteredOnly === 'true' ? `DISABLED_${Date.now()}` : `bfi@${Math.random().toString().substring(2,8)}`;
      
      if (req.query.isRegisteredOnly !== 'true') {
        if (mobileNumber && mobileNumber.length >= 6) {
          rawPassword = `bfi@${mobileNumber.slice(-6)}`;
        } else if (mobileNumber) {
          rawPassword = `bfi@${mobileNumber}`;
        }
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
              let type = course === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
              const cd = db.prepare('SELECT course_type FROM course_definitions WHERE name = ? ORDER BY version DESC LIMIT 1').get(course);
              if (cd?.course_type) type = cd.course_type;
              enrollStmt.run(userId, course, type);
            }
          }

          // Link student to batch, creating batch record if missing
          if (studentBatch && Array.isArray(courses) && courses.length > 0) {
            const getOrdinal = (n) => {
              const num = parseInt(n, 10);
              if (isNaN(num)) return n;
              const s = ['th','st','nd','rd'];
              const v = num % 100;
              return num + (s[(v-20) % 10] || s[v] || s[0]);
            };

            for (const course of courses) {
              let batchId;
              const existingBatch = db.prepare('SELECT id FROM batches WHERE batch_number = ? AND course_name = ?').get(studentBatch, course);
              if (existingBatch) {
                batchId = existingBatch.id;
              } else {
                const batchName = `${getOrdinal(studentBatch)} Batch`;
                const resultBatch = db.prepare(`
                  INSERT INTO batches (batch_name, batch_number, course_name, status, created_by)
                  VALUES (?, ?, ?, 'completed', ?)
                `).run(batchName, studentBatch, course, req.user.userId || req.user.id);
                batchId = resultBatch.lastInsertRowid;
              }
              db.prepare('INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, ?)').run(batchId, userId);
            }
          }

          return { studentId };
        });

        const { studentId } = transaction();
        
        results.push({
          ...studentData,
          email: email,
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
          INSERT INTO bulk_import_history (filename, batch_number, title, results_json, imported_by)
          VALUES (?, ?, ?, ?, ?)
        `);
        insertHistory.run(
          `BFI_Students_Import_Batch_${batchNumber || 'New'}_${Date.now()}.xlsx`,
          batchNumber || 'Mixed',
          batchNumber ? `${batchNumber} Batch` : 'Mixed Batch',
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

// Bulk upload exam results for a batch
router.post('/batches/:id/results/bulk', authenticateToken, requireRole('admin'), requirePermission('batches:results_upload'), sanitizeInput, (req, res) => {
  const batchId = req.params.id;
  const { results } = req.body;
  if (!Array.isArray(results)) {
    return res.status(400).json({ error: 'Results must be an array' });
  }

  try {
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    let updatedCount = 0;
    const updateEnrollment = db.prepare(`
      UPDATE student_course_enrollments 
      SET exam_written = ?, updated_at = datetime('now')
      WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))
    `);

    const updateProfile = db.prepare(`
      UPDATE student_profiles 
      SET phase1_passed = ?
      WHERE user_id = ?
    `);

    const updateEnrollmentStatus = db.prepare(`
      UPDATE student_course_enrollments
      SET step2_completed = ?, updated_at = datetime('now')
      WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))
    `);

    db.transaction(() => {
      for (const row of results) {
        let student = null;

        if (row.rollNo) {
           student = db.prepare(`
             SELECT u.id 
             FROM users u
             JOIN batch_students bs ON u.id = bs.student_id
             JOIN student_profiles sp ON u.id = sp.user_id
             WHERE bs.batch_id = ? AND (sp.student_id = ? OR sp.student_id LIKE ?)
           `).get(batchId, row.rollNo, `%${row.rollNo}%`);
        }

        if (!student && row.name) {
           student = db.prepare(`
             SELECT u.id 
             FROM users u
             JOIN batch_students bs ON u.id = bs.student_id
             JOIN student_profiles sp ON u.id = sp.user_id
             WHERE bs.batch_id = ? AND LOWER(TRIM(sp.full_name)) = LOWER(TRIM(?))
           `).get(batchId, row.name);
        }

        if (!student && row.name) {
           student = db.prepare(`
             SELECT u.id 
             FROM users u
             JOIN batch_students bs ON u.id = bs.student_id
             JOIN student_profiles sp ON u.id = sp.user_id
             WHERE bs.batch_id = ? AND LOWER(sp.full_name) LIKE LOWER(?)
           `).get(batchId, `%${row.name.trim()}%`);
        }

        if (student) {
           const enrollment = db.prepare(`
             SELECT fee_details FROM student_course_enrollments 
             WHERE user_id = ? AND (batch_id = ? OR (batch_id IS NULL AND course_name = ?))
           `).get(student.id, batch.id, batch.course_name);
           let isUnpaid = false;
           if (enrollment && enrollment.fee_details) {
             let feeDetails = {};
             try { feeDetails = typeof enrollment.fee_details === 'string' ? JSON.parse(enrollment.fee_details) : enrollment.fee_details; } catch(err) { /* ignore json parse err */ }
             
             if (batch.course_name === 'Online Filmmaking Course') {
               const p1 = feeDetails.phase1 || {};
               const amountPaidNum = parseFloat((p1.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
               const installments = p1.installments || [];
               const paidAny = amountPaidNum > 0 || installments.some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) > 0);
               if (!paidAny) isUnpaid = true;
             } else {
               const amountPaidNum = parseFloat((feeDetails.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
               const installments = feeDetails.installments || [];
               const paidAny = amountPaidNum > 0 || installments.some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) > 0);
               if (!paidAny) isUnpaid = true;
             }
           } else {
             // If no fee details yet, consider unpaid
             isUnpaid = true;
           }

           if (!isUnpaid) {
             if (row.obtainedMarks !== '' && row.obtainedMarks !== null) {
                updateEnrollment.run(row.obtainedMarks, student.id, batch.id, batch.course_name);
             }
             if (row.remarks) {
                const passed = row.remarks === 'Pass' ? 1 : 0;
                updateProfile.run(passed, student.id);
                updateEnrollmentStatus.run(passed, student.id, batch.id, batch.course_name);
             }
             updatedCount++;
           }
        }
      }
    })();

    res.json({ success: true, updated: updatedCount });
  } catch (error) {
    console.error('Bulk results upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all registered leads (not admitted)
router.get('/students/leads', authenticateToken, requireRole('admin'), requirePermission('students:view'), (req, res) => {
  try {
    const leads = db.prepare(`
      SELECT 
        u.id as user_id, 
        u.email, 
        u.mobile_number, 
        u.created_at,
        p.full_name, 
        p.gender, 
        p.birthday, 
        p.present_address, 
        p.educational_qualification, 
        p.profession,
        p.whatsapp_number,
        p.batch_number,
        p.student_id
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student'
        AND (p.batch_number IS NULL OR p.batch_number = '')
      ORDER BY u.created_at DESC
    `).all();

    res.status(200).json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error fetching leads' });
  }
});


// Admit a lead student
router.post('/students/leads/:id/admit', authenticateToken, requireRole('admin'), requirePermission('students:create'), sanitizeInput, (req, res) => {
  try {
    const userId = req.params.id;
    const { batchNumber, snNo, month, year, course = 'Online Filmmaking Course' } = req.body;

    if (!batchNumber || !snNo || !year) {
      return res.status(400).json({ error: 'Batch Number, SN No, and Year are required.' });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(userId);
    if (!profile) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }

    // Extract first and last name from full name
    const nameParts = profile.full_name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Student';

    // Generate Username
    let baseUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
    let username = `${baseUsername}.${Math.random().toString(36).substring(2, 6)}`;
    // Ensure unique username
    while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      username = `${baseUsername}.${Math.random().toString(36).substring(2, 6)}`;
    }

    // Generate Password: bfi@ + last 6 digits of mobile (or random if mobile is invalid)
    let rawPassword = '';
    const mobileDigits = (user.mobile_number || '').replace(/\D/g, '');
    if (mobileDigits.length >= 6) {
      rawPassword = `bfi@${mobileDigits.slice(-6)}`;
    } else {
      rawPassword = `bfi@${Math.floor(100000 + Math.random() * 900000)}`;
    }
    const passwordHash = bcrypt.hashSync(rawPassword, 12);

    // Generate Student ID
    const parsedSn = parseInt(snNo, 10);
    const cleanSn = isNaN(parsedSn) ? '00' : String(parsedSn).padStart(2, '0');
    const parsedBatch = parseInt(batchNumber, 10);
    const cleanBatch = isNaN(parsedBatch) ? '00' : String(parsedBatch);
    const parsedYear = parseInt(year, 10);
    const cleanYear = isNaN(parsedYear) ? new Date().getFullYear().toString() : String(parsedYear);
    
    let cleanMonth = '';
    if (month && String(month).trim() !== '') {
      const parsedMonth = parseInt(month, 10);
      cleanMonth = isNaN(parsedMonth) ? '' : String(parsedMonth).padStart(2, '0');
    }

    const studentId = `BFI${cleanSn}${cleanBatch}${cleanMonth}${cleanYear}`;

    // Execute updates
    const transaction = db.transaction(() => {
      // 1. Update user and revoke old sessions
      db.prepare("UPDATE users SET username = ?, password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?").run(username, passwordHash, userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      
      // 2. Ensure a profile row exists (some leads may not have one)
      db.prepare(`INSERT OR IGNORE INTO student_profiles (user_id, full_name) VALUES (?, ?)`).
        run(userId, profile ? profile.full_name : (user.email || String(userId)));
      
      // 3. Update profile with student_id and batch_number
      db.prepare(`UPDATE student_profiles SET student_id = ?, batch_number = ? WHERE user_id = ?`).run(studentId, cleanBatch, userId);
      
      // 4. Link to batch roster (if batch exists for this course)
      const batchRecord = db.prepare('SELECT id FROM batches WHERE batch_number = ? AND course_name = ?').get(cleanBatch, course);
      if (batchRecord) {
        const existsInBatch = db.prepare('SELECT id FROM batch_students WHERE batch_id = ? AND student_id = ?').get(batchRecord.id, userId);
        if (!existsInBatch) {
          db.prepare('INSERT INTO batch_students (batch_id, student_id) VALUES (?, ?)').run(batchRecord.id, userId);
        }
      }

      // 5. Enroll in course (if not already)
      const batchId = batchRecord ? batchRecord.id : null;
      const existingEnrollment = db.prepare(
        'SELECT * FROM student_course_enrollments WHERE user_id = ? AND course_name = ? AND (batch_id = ? OR (batch_id IS NULL AND ? IS NULL))'
      ).get(userId, course, batchId, batchId);
      if (!existingEnrollment) {
        db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_type, batch_id) VALUES (?, ?, ?, ?)').run(userId, course, 'filmmaking', batchId);
      } else if (batchId && !existingEnrollment.batch_id) {
        db.prepare('UPDATE student_course_enrollments SET batch_id = ? WHERE id = ?').run(batchId, existingEnrollment.id);
      }

      recordAuditEventFromReq(req, {
        action: 'student.admit',
        module: 'students',
        resource: `student:${userId}`,
        targetUserId: Number(userId),
        outcome: 'success',
        beforeState: {
          id: user.id,
          username: user.username,
          batch_number: profile?.batch_number || null,
          student_id: profile?.student_id || null
        },
        afterState: {
          id: user.id,
          username,
          batch_number: cleanBatch,
          student_id: studentId,
          course
        },
        details: {
          batchNumber: cleanBatch,
          studentId,
          course
        },
        throwOnError: true
      });
    });


    transaction();

    res.status(200).json({
      message: 'Student admitted successfully.',
      credentials: {
        username,
        password: rawPassword,
        studentId,
        mobileNumber: user.mobile_number
      }
    });

  } catch (error) {
    console.error('Error admitting student:', error);
    res.status(500).json({ error: error.message || 'Internal server error admitting student.' });
  }
});

// Soft Delete a lead student
router.delete('/students/leads/:id', authenticateToken, requireRole('admin'), requirePermission('students:delete'), (req, res) => {
  try {
    const userId = req.params.id;
    if (Number(userId) === 1) {
      return res.status(403).json({ error: 'Cannot delete or alter Super Administrator account.' });
    }

    // Check if the user exists and is indeed a student lead (not admitted)
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Student lead not found.' });
    }

    const profile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(userId);
    if (profile && profile.batch_number && profile.batch_number !== '') {
      return res.status(400).json({ error: 'Cannot delete an admitted student from here.' });
    }

    // Soft Delete instead of physical delete
    db.prepare("UPDATE users SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?").run(req.user.id, userId);
    logTrashAction('leads', userId, `${user.first_name || ''} ${user.last_name || ''}`.trim(), 'deleted', req.user.id);
    
    // Note: We don't need to update cascaded tables because if the user is restored, 
    // we want all their profile and enrollment data to come back with them.
    // The GET queries will filter based on users.deleted_at IS NULL.

    res.status(200).json({ success: true, message: 'Registered student moved to Trash.' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Internal server error while moving lead to trash.' });
  }
});

// Save bulk import history manually (used when importing sequentially from frontend)
router.post('/imports/save-history', authenticateToken, requireRole('admin'), requirePermission('students:create'), sanitizeInput, (req, res) => {
  try {
    const { batchNumber, results } = req.body;
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Results array is required' });
    }
    const insertHistory = db.prepare(`
      INSERT INTO bulk_import_history (filename, batch_number, title, results_json, imported_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertHistory.run(
      `BFI_Students_Import_Batch_${batchNumber || 'New'}_${Date.now()}.xlsx`,
      batchNumber || 'Mixed',
      batchNumber ? `${batchNumber} Batch` : 'Mixed Batch',
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
router.get('/imports/history', authenticateToken, requireRole('admin'), requirePermission('students:view'), (req, res) => {
  try {
    const history = db.prepare(`
      SELECT id, filename, batch_number, title, imported_by, created_at 
      FROM bulk_import_history 
      ORDER BY id DESC LIMIT 50
    `).all();
    res.status(200).json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch import history' });
  }
});

// Rename import history title
router.put('/imports/history/:id/rename', authenticateToken, requireRole('admin'), requirePermission('students:edit'), sanitizeInput, (req, res) => {
  try {
    const { title } = req.body;
    const { id } = req.params;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required' });
    }
    const update = db.prepare('UPDATE bulk_import_history SET title = ? WHERE id = ?');
    const result = update.run(title.trim(), id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'History record not found' });
    }
    res.status(200).json({ success: true, title: title.trim() });
  } catch (error) {
    console.error('Error renaming history title:', error);
    res.status(500).json({ error: 'Failed to rename import history title' });
  }
});

// Get specific import details
router.get('/imports/history/:id', authenticateToken, requireRole('admin'), requirePermission('students:view'), (req, res) => {
  try {
    const record = db.prepare('SELECT results_json FROM bulk_import_history WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'History not found' });
    res.status(200).json(JSON.parse(record.results_json));
  } catch (error) {
    console.error('Error fetching history details:', error);
    res.status(500).json({ error: 'Failed to fetch history details' });
  }
});

// Delete import history record
router.delete('/imports/history/:id', authenticateToken, requireRole('admin'), requirePermission('students:delete'), (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM bulk_import_history WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'History record not found' });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting history record:', error);
    res.status(500).json({ error: 'Failed to delete import history record' });
  }
});

// Route to update a student's Phase 2 attendance (Shooting + Editing parts)
// Only for Online Filmmaking Course. If both parts attended => step4_completed = 1
// IMPORTANT: This must be declared BEFORE the generic PUT /students/:id route.
router.put('/students/:id/phase2-attendance/:courseId', authenticateToken, requireRole('admin'), requirePermission('students:academic_records'), (req, res) => {
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
router.put('/students/:id', authenticateToken, requireRole('admin'), requirePermission('students:edit'), sanitizeInput, (req, res) => {
  try {
    const { id } = req.params;
    if (Number(id) === 1) {
      return res.status(403).json({ error: 'Cannot modify Super Administrator account via student endpoints.' });
    }
    const { 
      firstName, lastName, email, mobileNumber, username, batchNumber, phase1_fee, phase2_fee, courses, snNo, year, course_fees,
      enrollment_id, enrollmentId, batch_id, batchId
    } = req.body;

    console.log(`[AdminAPI] PUT /students/${id} called with:`, {
      firstName, lastName, email, username, batchNumber, snNo, year, courses, course_fees, enrollment_id, batch_id
    });

    const targetEnrollmentId = enrollment_id || enrollmentId || null;
    const targetBatchId = batch_id || batchId || null;

    // Helper: Resolve a student's enrollment for a course deterministically
    function resolveEnrollmentForCourse(userId, courseName, reqEnrId, reqBId) {
      const userEnrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ? AND course_name = ?').all(userId, courseName);
      
      if (userEnrollments.length === 0) {
        return { notFound: true, count: 0 };
      }

      // 1. Explicit enrollment ID takes highest priority
      if (reqEnrId) {
        const match = userEnrollments.find(e => e.id === parseInt(reqEnrId, 10));
        if (match) return { enrollment: match, count: userEnrollments.length };
        return {
          error: `Specified enrollment_id ${reqEnrId} does not belong to student ${userId} for course '${courseName}'.`,
          count: userEnrollments.length
        };
      }

      // 2. Batch ID context
      let effectiveBatchId = reqBId ? parseInt(reqBId, 10) : null;
      if (!effectiveBatchId && batchNumber) {
        const b = db.prepare('SELECT id FROM batches WHERE course_name = ? AND (batch_number = ? OR batch_name = ?)').get(courseName, String(batchNumber), String(batchNumber));
        if (b) effectiveBatchId = b.id;
      }

      if (effectiveBatchId) {
        const match = userEnrollments.find(e => e.batch_id === effectiveBatchId);
        if (match) return { enrollment: match, count: userEnrollments.length };
        // If single legacy unassigned enrollment, allow mapping
        const legacyMatch = userEnrollments.find(e => e.batch_id === null);
        if (legacyMatch && userEnrollments.length === 1) {
          return { enrollment: legacyMatch, count: 1 };
        }
        return {
          error: `No enrollment found for student ${userId}, course '${courseName}', in batch ${effectiveBatchId}.`,
          count: userEnrollments.length
        };
      }

      // 3. Fallback when neither enrollment_id nor batch context is provided:
      // If student has exactly 1 enrollment for this course: preserve legacy behavior!
      if (userEnrollments.length === 1) {
        return { enrollment: userEnrollments[0], count: 1 };
      }

      // If student has > 1 enrollments for this course: reject ambiguous operation!
      return {
        ambiguous: true,
        error: `Ambiguous enrollment operation: student has multiple (${userEnrollments.length}) enrollments for course '${courseName}'. Specify enrollment_id or batch_id context to avoid unintended multi-batch modifications.`,
        count: userEnrollments.length
      };
    }

    // Validate Phase 2 fee details restriction: Cannot set Phase 2 details if Phase 1 exam is not passed or Phase 1 fee is not paid
    if (course_fees?.['Online Filmmaking Course']?.phase2) {
      const courseName = 'Online Filmmaking Course';
      const cfee = course_fees[courseName];
      const enrContextId = cfee.enrollment_id || cfee.enrollmentId || targetEnrollmentId;
      const bContextId = cfee.batch_id || cfee.batchId || targetBatchId;

      const resolved = resolveEnrollmentForCourse(id, courseName, enrContextId, bContextId);
      if (resolved.ambiguous || resolved.error) {
        return res.status(400).json({ error: resolved.error });
      }

      const existingEnrollment = resolved.enrollment;
      const step2Completed = existingEnrollment ? existingEnrollment.step2_completed : 0;
      
      let existingFeeDetails = null;
      if (existingEnrollment && existingEnrollment.fee_details) {
        try {
          existingFeeDetails = JSON.parse(existingEnrollment.fee_details);
        } catch (e) {
          console.error('Failed to parse existing fee details:', e);
        }
      }

      const p1Acct = resolvePhaseFee(cfee.phase1 || existingFeeDetails?.phase1 || {}, { courseDefinition: null });
      const isPhase1FullyPaid = p1Acct.isPaid;
      const isPhase1Passed = step2Completed === 1;
      const isOverridden = Boolean(req.body.admin_override);

      if (!isOverridden && (!isPhase1Passed || !isPhase1FullyPaid)) {
        const p2 = cfee.phase2;
        const existingP2 = existingFeeDetails?.phase2;

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

          if (fullFeeChanged || amountPaidChanged || discountChanged || instChanged) {
            const reason = (!isPhase1Passed && !isPhase1FullyPaid)
              ? 'Phase 1 exam has not been passed and Phase 1 fee is not fully paid.'
              : (!isPhase1Passed ? 'Phase 1 exam has not been passed.' : 'Phase 1 fee is not fully paid.');
            return res.status(400).json({ error: `Cannot set or modify Phase 2 fee details because ${reason}` });
          } else {
            // Retain exact existing Phase 2 to prevent any cosmetic/status drift
            course_fees['Online Filmmaking Course'].phase2 = existingP2 || p2;
          }
        }
      }
    }

    // Pre-validate all course removals and updates for ambiguity before opening transaction
    const currentEnrollments = db.prepare('SELECT id, course_name, batch_id FROM student_course_enrollments WHERE user_id = ?').all(id);
    const currentCourseNames = [...new Set(currentEnrollments.map(r => r.course_name))];
    const newCourses = courses || [];
    const toRemove = currentCourseNames.filter(c => !newCourses.includes(c));
    const toAdd = newCourses.filter(c => !currentCourseNames.includes(c));

    for (const course of toRemove) {
      const cfee = course_fees?.[course] || {};
      const enrContextId = cfee.enrollment_id || cfee.enrollmentId || targetEnrollmentId;
      const bContextId = cfee.batch_id || cfee.batchId || targetBatchId;
      const resolved = resolveEnrollmentForCourse(id, course, enrContextId, bContextId);
      if (resolved.ambiguous) {
        return res.status(400).json({ error: resolved.error });
      }
    }

    for (const course of newCourses) {
      const cfee = course_fees?.[course] || {};
      const enrContextId = cfee.enrollment_id || cfee.enrollmentId || targetEnrollmentId;
      const bContextId = cfee.batch_id || cfee.batchId || targetBatchId;
      const resolved = resolveEnrollmentForCourse(id, course, enrContextId, bContextId);
      if (resolved.ambiguous) {
        return res.status(400).json({ error: resolved.error });
      }
    }

    const beforeUser = db.prepare('SELECT id, first_name, last_name, email, mobile_number, username FROM users WHERE id = ?').get(id);
    const beforeProfile = db.prepare('SELECT full_name, batch_number, student_id FROM student_profiles WHERE user_id = ?').get(id);

    const transaction = db.transaction(() => {
      const finalEmail = (email && email.trim() && validateEmail(email.trim())) 
        ? email.trim() 
        : (username ? `${username}@bfi-app.org` : `student.${id}@bfi-app.org`);

      const finalUsername = (username && username.trim()) ? username.trim() : (beforeUser?.username || `student.${id}`);

      // 1. Update users
      db.prepare(`
        UPDATE users 
        SET first_name = ?, last_name = ?, email = ?, mobile_number = ?, username = ?
        WHERE id = ?
      `).run(firstName, lastName, finalEmail, mobileNumber, finalUsername, id);

      // 2. Update student_profiles
      const fullName = `${firstName} ${lastName}`;
      
      const parsedSn = parseInt(snNo, 10);
      const cleanSn = isNaN(parsedSn) ? '00' : String(parsedSn).padStart(2, '0');
      const parsedBatch = parseInt(batchNumber, 10);
      const cleanBatch = isNaN(parsedBatch) ? '00' : String(parsedBatch);
      const parsedYear = parseInt(year, 10);
      const cleanYear = isNaN(parsedYear) ? new Date().getFullYear().toString() : String(parsedYear);
      
      const studentIdStr = `BFI${cleanSn}${cleanBatch}${cleanYear}`;
      
      const { additionalInfo } = req.body;

      db.prepare(`
        UPDATE student_profiles 
        SET full_name = ?, batch_number = ?, phase1_fee = ?, phase2_fee = ?, student_id = ?, additional_info = ?
        WHERE user_id = ?
      `).run(fullName, batchNumber || '', phase1_fee || '', phase2_fee || '', studentIdStr, additionalInfo || '', id);

      // 3. Update course enrollments
      if (toRemove.length > 0) {
        for (const course of toRemove) {
          const cfee = course_fees?.[course] || {};
          const enrContextId = cfee.enrollment_id || cfee.enrollmentId || targetEnrollmentId;
          const bContextId = cfee.batch_id || cfee.batchId || targetBatchId;
          const resolved = resolveEnrollmentForCourse(id, course, enrContextId, bContextId);
          if (resolved.enrollment) {
            db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(resolved.enrollment.id);
          }
        }
      }

      if (toAdd.length > 0) {
        for (const course of toAdd) {
          let type = course === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
          const cfee = course_fees?.[course] || {};
          let bContextId = cfee.batch_id || cfee.batchId || targetBatchId;
          if (!bContextId && batchNumber) {
            const b = db.prepare('SELECT id FROM batches WHERE course_name = ? AND (batch_number = ? OR batch_name = ?)').get(course, String(batchNumber), String(batchNumber));
            if (b) bContextId = b.id;
          }

          let defId = null;
          let version = null;
          if (bContextId) {
            const batchRow = db.prepare(`
              SELECT b.course_definition_id, b.course_version, cd.course_type 
              FROM batches b
              LEFT JOIN course_definitions cd ON cd.id = b.course_definition_id
              WHERE b.id = ?
            `).get(bContextId);
            if (batchRow) {
              defId = batchRow.course_definition_id || null;
              version = batchRow.course_version || null;
              if (batchRow.course_type) type = batchRow.course_type;
            }
          }
          if (!defId) {
            const cd = db.prepare('SELECT id, version, course_type FROM course_definitions WHERE name = ? ORDER BY version DESC LIMIT 1').get(course);
            if (cd) {
              defId = cd.id;
              version = cd.version;
              if (cd.course_type) type = cd.course_type;
            }
          }

          db.prepare(`
            INSERT INTO student_course_enrollments (
              user_id, course_name, course_type, course_definition_id, course_version, batch_id
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(id, course, type, defId, version, bContextId || null);
        }
      }

      // 4. Update fee details and step completions for targeted enrollments
      for (const course of newCourses) {
        const cfee = course_fees?.[course];
        const enrContextId = cfee?.enrollment_id || cfee?.enrollmentId || targetEnrollmentId;
        const bContextId = cfee?.batch_id || cfee?.batchId || targetBatchId;
        const resolved = resolveEnrollmentForCourse(id, course, enrContextId, bContextId);

        if (!resolved.enrollment) continue;
        const enrId = resolved.enrollment.id;

        const feeInfo = cfee ? JSON.stringify(cfee) : null;
        db.prepare('UPDATE student_course_enrollments SET fee_details = ?, updated_at = datetime(\'now\') WHERE id = ?').run(feeInfo, enrId);

        // For legacy enrollments only, update step1_completed / step3_completed based on authoritative cash collected.
        // Defined course enrollments use student_phase_results and courseProgressService.
        if (cfee && !resolved.enrollment.course_definition_id) {
          if (course === 'Online Filmmaking Course') {
            // Phase 1 payment check
            const phase1Acct = resolvePhaseFee(cfee.phase1 || {}, { courseDefinition: null });
            const isPhase1Paid = (phase1Acct.cashCollected > 0 || phase1Acct.isPaid) ? 1 : 0;
            db.prepare('UPDATE student_course_enrollments SET step1_completed = ? WHERE id = ?').run(isPhase1Paid, enrId);

            // Phase 2 payment check
            const phase2Acct = resolvePhaseFee(cfee.phase2 || {}, { courseDefinition: null });
            const isPhase2Paid = (phase2Acct.cashCollected > 0 || phase2Acct.isPaid) ? 1 : 0;
            db.prepare('UPDATE student_course_enrollments SET step3_completed = ? WHERE id = ?').run(isPhase2Paid, enrId);
          } else {
            // Other legacy courses (Workshops) payment check
            const acct = resolvePhaseFee(cfee, { courseDefinition: null });
            const isPaid = (acct.cashCollected > 0 || acct.isPaid) ? 1 : 0;
            db.prepare('UPDATE student_course_enrollments SET step1_completed = ? WHERE id = ?').run(isPaid, enrId);
          }
        }
      }

      recordAuditEventFromReq(req, {
        action: 'student.update',
        module: 'students',
        resource: `student:${id}`,
        targetUserId: Number(id),
        outcome: 'success',
        beforeState: {
          firstName: beforeUser?.first_name || '',
          lastName: beforeUser?.last_name || '',
          email: beforeUser?.email || '',
          mobileNumber: beforeUser?.mobile_number || '',
          username: beforeUser?.username || '',
          batchNumber: beforeProfile?.batch_number || '',
          studentId: beforeProfile?.student_id || ''
        },
        afterState: {
          firstName: firstName || '',
          lastName: lastName || '',
          email: finalEmail,
          mobileNumber: mobileNumber || '',
          username: username || '',
          batchNumber: batchNumber || '',
          studentId: studentIdStr
        },
        details: {
          studentId: studentIdStr,
          courses: newCourses,
          hasFeeUpdate: Boolean(course_fees)
        },
        throwOnError: true
      });

      if (course_fees && Object.keys(course_fees).length > 0) {
        recordAuditEventFromReq(req, {
          action: 'finance.update_student_fees',
          module: 'finance',
          resource: `student:${id}`,
          targetUserId: Number(id),
          outcome: 'success',
          details: {
            studentId: studentIdStr,
            courses: Object.keys(course_fees),
            phase1_fee: phase1_fee || null,
            phase2_fee: phase2_fee || null
          },
          throwOnError: true
        });
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
router.post('/teachers', authenticateToken, requireRole('admin'), requirePermission('teachers:create'), sanitizeInput, (req, res) => {
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
router.get('/students', authenticateToken, requireRole('admin'), requirePermission('students:view'), async (req, res) => {
  try {
    const students = db.prepare(`
      SELECT 
        u.id, u.username, u.email, u.first_name, u.last_name, u.mobile_number, u.is_active, u.created_at,
        p.student_id, p.batch_number, p.full_name, p.whatsapp_number,
        p.phase1_fee, p.phase2_fee
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student' AND p.batch_number IS NOT NULL AND p.batch_number != ''
      ORDER BY u.created_at DESC
    `).all();

    // Fetch enrollments for each student
    const enrolledStudents = [];
    for (const s of students) {
      const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(s.id);
      for (const enr of enrollments) {
        if (enr.course_definition_id) {
          try {
            enr.defined_progress = await courseProgressService.getEnrollmentProgress(enr.id, null, { batchId: enr.batch_id });
          } catch (e) {
            console.error(`Error loading progress for enrollment ${enr.id}:`, e.message);
          }
        }
      }
      enrolledStudents.push({ ...s, enrollments });
    }

    res.json({ students: enrolledStudents });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Internal server error while fetching students.' });
  }
});

// Route to get a specific student details
router.get('/students/:id', authenticateToken, requireRole('admin'), requirePermission('students:view'), async (req, res) => {
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
    for (const enr of enrollments) {
      if (enr.course_definition_id) {
        try {
          const reqBatchId = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;
          enr.defined_progress = await courseProgressService.getEnrollmentProgress(enr.id, null, { batchId: enr.batch_id || reqBatchId });
        } catch (e) {
          console.error(`Error loading defined progress for enrollment ${enr.id}:`, e.message);
        }
      }
    }
    res.json({ student: { ...student, enrollments } });
  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ error: 'Internal server error while fetching student details.' });
  }
});

// Route to list all teachers
router.get('/teachers', authenticateToken, requireRole('admin'), requirePermission('teachers:view'), (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT 
        u.id, u.username, u.email, u.first_name, u.last_name, u.mobile_number, u.is_active, u.created_at, u.profile_picture,
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

// Route to soft-delete a student account
router.delete('/students/:id', authenticateToken, requireRole('admin'), requirePermission('students:delete'), (req, res) => {
  try {
    const studentIdNum = parseInt(req.params.id, 10);
    if (Number(studentIdNum) === 1) {
      return res.status(403).json({ error: 'Cannot delete Super Administrator account.' });
    }

    // Verify it's actually a student
    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentIdNum);
    if (!student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    const deleteStudentTx = db.transaction(() => {
      db.prepare("UPDATE users SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?").run(req.user.id, studentIdNum);
      logTrashAction('students', studentIdNum, `${student.first_name || ''} ${student.last_name || ''}`.trim(), 'deleted', req.user.id);

      recordAuditEventFromReq(req, {
        action: 'student.delete',
        module: 'students',
        resource: `student:${studentIdNum}`,
        targetUserId: studentIdNum,
        outcome: 'success',
        beforeState: { id: student.id, username: student.username, email: student.email },
        details: { fullName: `${student.first_name || ''} ${student.last_name || ''}`.trim() },
        throwOnError: true
      });
    });

    deleteStudentTx();
    res.json({ message: 'Student account moved to Trash' });
  } catch (error) {
    console.error('Error moving student to trash:', error);
    res.status(500).json({ error: 'Internal server error while moving student account to trash.' });
  }
});

// Route to edit a teacher's basic profile details
router.put('/teachers/:id', authenticateToken, requireRole('admin'), requirePermission('teachers:edit'), sanitizeInput, (req, res) => {
  try {
    const teacherIdNum = parseInt(req.params.id, 10);
    if (Number(teacherIdNum) === 1) {
      return res.status(403).json({ error: 'Cannot modify Super Administrator account via teacher endpoints.' });
    }
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

// Route to soft-delete a teacher account
router.delete('/teachers/:id', authenticateToken, requireRole('admin'), requirePermission('teachers:delete'), (req, res) => {
  try {
    const teacherIdNum = parseInt(req.params.id, 10);
    if (Number(teacherIdNum) === 1) {
      return res.status(403).json({ error: 'Cannot delete Super Administrator account.' });
    }

    // Verify it's actually a teacher
    const teacher = db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ? AND role = 'instructor'").get(teacherIdNum);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found.' });
    }

    // Soft delete
    db.prepare("UPDATE users SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?").run(req.user.id, teacherIdNum);
    logTrashAction('teachers', teacherIdNum, `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim(), 'deleted', req.user.id);

    res.json({ message: 'Teacher account moved to Trash' });
  } catch (error) {
    console.error('Error moving teacher to trash:', error);
    res.status(500).json({ error: 'Internal server error while moving teacher account to trash.' });
  }
});

// Route to update a student's course progression (checkmarks)
router.patch('/students/:id/progress', authenticateToken, requireRole('admin'), requirePermission('students:academic_records'), (req, res) => {
  try {
    const { course_id, step1_completed, step2_completed, step3_completed, step4_completed } = req.body;
    const studentId = req.params.id; // user_id

    if (!course_id) return res.status(400).json({ error: 'Course ID (enrollment id) is required.' });

    // Validate phase payment restrictions for Online Filmmaking Course
    const enrollment = db.prepare('SELECT id, course_name, fee_details, course_definition_id FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(course_id, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    if (enrollment.course_definition_id) {
      return res.status(400).json({ error: 'Cannot update progress for defined courses using legacy progress route. Use /defined-progress endpoint.' });
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

      const p1Acct = resolvePhaseFee(feeDetails?.phase1 || {}, { courseDefinition: null });
      const phase1PaidAny = p1Acct.cashCollected > 0 || p1Acct.isPaid;
      const phase1FullyPaid = p1Acct.isPaid;

      const p2Acct = resolvePhaseFee(feeDetails?.phase2 || {}, { courseDefinition: null });
      const phase2PaidAny = p2Acct.cashCollected > 0 || p2Acct.isPaid;

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
    
    const progressTx = db.transaction(() => {
      const result = db.prepare(query).run(...params);
      if (result.changes === 0) {
        throw new Error('Course Enrollment not found for this student.');
      }

      recordAuditEventFromReq(req, {
        action: 'academic.progress_update',
        module: 'academic',
        resource: `enrollment:${course_id}`,
        targetUserId: parseInt(studentId, 10),
        outcome: 'success',
        beforeState: {
          step1_completed: enrollment.step1_completed,
          step2_completed: enrollment.step2_completed,
          step3_completed: enrollment.step3_completed,
          step4_completed: enrollment.step4_completed
        },
        afterState: {
          step1_completed: step1_completed !== undefined ? (step1_completed ? 1 : 0) : enrollment.step1_completed,
          step2_completed: step2_completed !== undefined ? (step2_completed ? 1 : 0) : enrollment.step2_completed,
          step3_completed: step3_completed !== undefined ? (step3_completed ? 1 : 0) : enrollment.step3_completed,
          step4_completed: step4_completed !== undefined ? (step4_completed ? 1 : 0) : enrollment.step4_completed
        },
        details: { course_name: enrollment.course_name, enrollmentId: course_id },
        throwOnError: true
      });
      return result;
    });

    try {
      progressTx();
    } catch (txErr) {
      if (txErr.message.includes('not found')) {
        return res.status(404).json({ error: txErr.message });
      }
      throw txErr;
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
router.put('/students/:id/academic-records/:courseId', authenticateToken, requireRole('admin'), requirePermission('students:academic_records'), (req, res) => {
  try {
    const studentId = req.params.id;
    const courseId = req.params.courseId;
    const { attendance_classes, attendance_total, exam_written, assignment_scores } = req.body;

    // Verify the enrollment exists
    const enrollment = db.prepare(`SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?`).get(courseId, studentId);
    
    if (!enrollment) {
      return res.status(404).json({ error: 'Course enrollment not found.' });
    }

    // Determine batch_number and batch_id
    let batchNumber = 'DEFAULT';
    let targetBatchId = enrollment.batch_id || null;

    if (!targetBatchId) {
      const batchRecord = db.prepare(`
        SELECT b.id, b.batch_number 
        FROM batch_students bs
        JOIN batches b ON bs.batch_id = b.id
        WHERE bs.student_id = ? AND b.course_name = ?
        LIMIT 1
      `).get(studentId, enrollment.course_name);
      
      if (batchRecord && batchRecord.batch_number) {
        targetBatchId = batchRecord.id;
        batchNumber = batchRecord.batch_number;
      }
    } else {
      const bRow = db.prepare('SELECT batch_number FROM batches WHERE id = ?').get(targetBatchId);
      if (bRow?.batch_number) {
        batchNumber = bRow.batch_number;
      }
    }

    // Fetch course settings
    let courseSetting = null;
    if (enrollment.course_definition_id) {
      if (targetBatchId) {
        courseSetting = db.prepare('SELECT * FROM course_settings WHERE batch_id = ?').get(targetBatchId);
      }
      if (!courseSetting) {
        courseSetting = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(enrollment.course_name, 'DEFAULT');
      }
    } else {
      if (targetBatchId) {
        courseSetting = db.prepare('SELECT * FROM course_settings WHERE batch_id = ?').get(targetBatchId);
      }
      if (!courseSetting) {
        courseSetting = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ? AND batch_id IS NULL').get(enrollment.course_name, batchNumber);
      }
      if (!courseSetting) {
        courseSetting = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(enrollment.course_name, 'DEFAULT');
      }
    }

    if (!courseSetting) {
      // Fallback defaults if no setting found
      courseSetting = {
        total_classes: 22,
        exam_max_score: 100,
        exam_pass_mark: 33,
        has_assignment: 0,
        assignments: '[]',
        has_phase2: 0
      };
    }

    const hasPhase2 = courseSetting.has_phase2 === 1;
    const hasAssignment = courseSetting.has_assignment === 1;
    let definedAssignments = [];
    try {
      definedAssignments = JSON.parse(courseSetting.assignments || '[]');
    } catch(e) { /* ignore parse error */ }

    // Phase 2 admission check
    if (hasPhase2) {
      const isPhase2Admitted = enrollment.step3_completed === 1;
      if (!isPhase2Admitted) {
        return res.status(400).json({ error: 'Cannot update academic records because Phase 2: Admitted is not yet completed.' });
      }
    }

    const attendance = parseInt(attendance_classes) || 0;
    const totalAttendance = parseInt(attendance_total) || courseSetting.total_classes;
    const exam = parseInt(exam_written) || 0;
    
    let parsedScores = {};
    if (assignment_scores) {
      parsedScores = typeof assignment_scores === 'string' ? JSON.parse(assignment_scores) : assignment_scores;
    }

    // Validations
    if (attendance > totalAttendance) {
      return res.status(400).json({ error: 'Attended classes cannot exceed total classes.' });
    }
    if (attendance < 0) {
      return res.status(400).json({ error: 'Attended classes cannot be negative.' });
    }
    if (totalAttendance < 1) {
      return res.status(400).json({ error: 'Total classes must be at least 1.' });
    }
    if (exam > courseSetting.exam_max_score) {
      return res.status(400).json({ error: `Written exam score cannot exceed ${courseSetting.exam_max_score}.` });
    }
    if (exam < 0) {
      return res.status(400).json({ error: 'Written exam score cannot be negative.' });
    }

    let assignmentsTotal = 0;
    if (hasAssignment) {
      for (const def of definedAssignments) {
        const score = parseFloat(parsedScores[def.id]) || 0;
        if (score > def.max_score) {
          return res.status(400).json({ error: `${def.name} score cannot exceed ${def.max_score}.` });
        }
        if (score < 0) {
          return res.status(400).json({ error: `${def.name} score cannot be negative.` });
        }
        assignmentsTotal += score;
      }
    }

    const transaction = db.transaction(() => {
      // 1. Update the specific student's record
      db.prepare(`
        UPDATE student_course_enrollments
        SET attendance_classes = ?, 
            attendance_total = ?,
            exam_written = ?, 
            assignment_scores = ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(attendance, totalAttendance, exam, JSON.stringify(parsedScores), courseId, studentId);

      // 2. Sync the new attendance_total to students in the same batch/course
      if (hasPhase2) {
        if (enrollment.batch_id) {
          db.prepare(`
            UPDATE student_course_enrollments
            SET attendance_total = ?,
                updated_at = datetime('now')
            WHERE course_name = ? AND batch_id = ?
          `).run(totalAttendance, enrollment.course_name, enrollment.batch_id);
        } else {
          db.prepare(`
            UPDATE student_course_enrollments
            SET attendance_total = ?,
                updated_at = datetime('now')
            WHERE course_name = ? AND batch_id IS NULL
          `).run(totalAttendance, enrollment.course_name);
        }
      }

      // 3. Recalculate pass/fail for students in the same batch/course
      const allEnrollments = enrollment.batch_id
        ? db.prepare(`
            SELECT id, user_id, attendance_classes, attendance_total, exam_written, assignment_scores, step2_completed
            FROM student_course_enrollments
            WHERE course_name = ? AND batch_id = ?
          `).all(enrollment.course_name, enrollment.batch_id)
        : db.prepare(`
            SELECT id, user_id, attendance_classes, attendance_total, exam_written, assignment_scores, step2_completed
            FROM student_course_enrollments
            WHERE course_name = ? AND batch_id IS NULL
          `).all(enrollment.course_name);

      let targetStudentPassed = 0;

      for (const e of allEnrollments) {
        const attClasses = e.attendance_classes || 0;
        const attTotal = e.attendance_total || courseSetting.total_classes;
        const eExam = e.exam_written || 0;
        
        let eScores = {};
        try {
          eScores = JSON.parse(e.assignment_scores || '{}');
        } catch(err) { /* ignore parse error */ }

        let eAssTotal = 0;
        if (hasAssignment) {
          for (const def of definedAssignments) {
            eAssTotal += parseFloat(eScores[def.id]) || 0;
          }
        }
        
        const attPercentage = attTotal > 0 ? (attClasses / attTotal) * 100 : 0;
        const totalM = eExam + eAssTotal;
        
        // Dynamic pass condition
        let pass = 0;
        if (hasPhase2) {
          pass = (attPercentage >= 80 && totalM >= courseSetting.exam_pass_mark) ? 1 : 0;
        } else {
          // simple pass mark
          pass = totalM >= courseSetting.exam_pass_mark ? 1 : 0;
        }

        if (e.id === Number(courseId) && e.user_id === Number(studentId)) {
          targetStudentPassed = pass;
        }

        if (pass === 0) {
          if (hasPhase2) {
            db.prepare(`
              UPDATE student_course_enrollments
              SET step2_completed = 0, step3_completed = 0, step4_completed = 0
              WHERE id = ? AND user_id = ?
            `).run(e.id, e.user_id);
          } else {
            db.prepare(`
              UPDATE student_course_enrollments
              SET step2_completed = 0
              WHERE id = ? AND user_id = ?
            `).run(e.id, e.user_id);
          }
        } else {
          if (hasPhase2) {
            db.prepare(`
              UPDATE student_course_enrollments
              SET step2_completed = 1
              WHERE id = ? AND user_id = ?
            `).run(e.id, e.user_id);
          } else {
            db.prepare(`
              UPDATE student_course_enrollments
              SET step2_completed = 1, step4_completed = 1
              WHERE id = ? AND user_id = ?
            `).run(e.id, e.user_id);
          }
        }
      }

      recordAuditEventFromReq(req, {
        action: 'academic.update_records',
        module: 'academic',
        resource: `enrollment:${courseId}`,
        targetUserId: Number(studentId),
        outcome: 'success',
        beforeState: {
          attendance_classes: enrollment.attendance_classes,
          attendance_total: enrollment.attendance_total,
          exam_written: enrollment.exam_written
        },
        afterState: {
          attendance_classes: attendance,
          attendance_total: totalAttendance,
          exam_written: exam,
          step2_completed: targetStudentPassed
        },
        details: {
          course_name: enrollment.course_name,
          batch_id: enrollment.batch_id,
          isPassed: targetStudentPassed
        },
        throwOnError: true
      });
      
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

// Route to get a student's defined course progress
router.get('/students/:id/courses/:courseId/defined-progress', authenticateToken, requireRole('admin', 'moderator'), async (req, res) => {
  try {
    if (req.user.role === 'admin' && !isSuperAdmin(req.user)) {
      const hasPerm = db.prepare('SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission = ?').get(req.user.id, 'students:view');
      if (!hasPerm) return res.status(403).json({ error: "Access denied: missing required permission 'students:view'", requiredPermission: 'students:view' });
    }
    const studentId = parseInt(req.params.id, 10);
    const courseId = parseInt(req.params.courseId, 10);

    const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(courseId, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    // Role check for moderator: must be assigned to this batch
    if (req.user.role === 'moderator') {
      if (!enrollment.batch_id) {
        return res.status(403).json({ error: 'Moderators cannot view progress for enrollments not linked to a batch.' });
      }
      const isAssigned = db.prepare('SELECT 1 FROM batch_moderators WHERE batch_id = ? AND user_id = ?').get(enrollment.batch_id, req.user.id);
      if (!isAssigned) {
        return res.status(403).json({ error: 'Moderators can only view progress for batches they are assigned to.' });
      }
    }

    const reqBatchId = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;
    const progress = await courseProgressService.getEnrollmentProgress(courseId, null, { batchId: enrollment.batch_id || reqBatchId });
    res.json({ progress });
  } catch (error) {
    console.error('Error fetching defined course progress:', error);
    res.status(500).json({ error: 'Internal server error while fetching defined course progress.' });
  }
});

// Route to update a student's defined course progress (attendance, assignments, exams) atomically
router.put('/students/:id/courses/:courseId/defined-progress', authenticateToken, requireRole('admin', 'moderator'), async (req, res) => {
  try {
    if (req.user.role === 'admin' && !isSuperAdmin(req.user)) {
      const hasPerm = db.prepare('SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission = ?').get(req.user.id, 'students:academic_records');
      if (!hasPerm) return res.status(403).json({ error: "Access denied: missing required permission 'students:academic_records'", requiredPermission: 'students:academic_records' });
    }
    const studentId = parseInt(req.params.id, 10);
    const courseId = parseInt(req.params.courseId, 10);
    const { attendance, assignments, exam_marks } = req.body;

    const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(courseId, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    if (!enrollment.course_definition_id) {
      return res.status(400).json({ error: 'This enrollment is a legacy course, not a defined course.' });
    }

    // Role check for moderator: must be assigned to this batch
    if (req.user.role === 'moderator') {
      if (!enrollment.batch_id) {
        return res.status(403).json({ error: 'Moderators cannot modify progress for enrollments not linked to a batch.' });
      }
      const isAssigned = db.prepare('SELECT 1 FROM batch_moderators WHERE batch_id = ? AND user_id = ?').get(enrollment.batch_id, req.user.id);
      if (!isAssigned) {
        return res.status(403).json({ error: 'Moderators can only modify progress for batches they are assigned to.' });
      }
    }

    const reqBatchId = req.query.batch_id ? parseInt(req.query.batch_id, 10) : null;
    const batchOpt = { batchId: enrollment.batch_id || reqBatchId };

    // 1. Fetch and validate published course definition
    const defRow = db.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(enrollment.course_definition_id);
    if (!defRow || !defRow.definition_json) {
      return res.status(400).json({ error: 'Course definition not found for this enrollment.' });
    }
    let cDef;
    try {
      cDef = JSON.parse(defRow.definition_json);
    } catch {
      return res.status(500).json({ error: 'Failed to parse course definition.' });
    }

    const phaseMap = new Map();
    const classMap = new Map();
    const asgMap = new Map();

    for (const p of (cDef.phases || [])) {
      phaseMap.set(p.id, p);
      for (const c of (p.classes || [])) {
        classMap.set(c.id, { classObj: c, phase: p });
      }
      for (const a of (p.assignments || [])) {
        asgMap.set(a.id, { asgObj: a, phase: p });
      }
    }

    // 2. Validate phase gates and lock status using preCheckProgress
    const preCheckProgress = await courseProgressService.getEnrollmentProgress(courseId, null, batchOpt);
    const lockedPhaseMap = new Map();
    if (preCheckProgress && Array.isArray(preCheckProgress.phases)) {
      for (const p of preCheckProgress.phases) {
        if (p.isLocked || (p.phaseNumber > 1 && !p.isAdmitted)) {
          lockedPhaseMap.set(p.id, p);
        }
      }
    }

    // 3. Deep validation of attendance items
    if (attendance !== undefined && attendance !== null) {
      if (!Array.isArray(attendance)) {
        return res.status(400).json({ error: 'Attendance payload must be an array.' });
      }
      for (const item of attendance) {
        if (!item.class_id) {
          return res.status(400).json({ error: 'Each attendance item must contain a class_id.' });
        }
        const classEntry = classMap.get(item.class_id);
        if (!classEntry) {
          return res.status(400).json({ error: `Invalid class_id: "${item.class_id}" does not belong to the course definition.` });
        }
        if (lockedPhaseMap.has(classEntry.phase.id)) {
          const lp = lockedPhaseMap.get(classEntry.phase.id);
          const reason = lp.isLocked ? (lp.lockReason || 'Phase is locked by progression policy.') : 'Student has not been admitted to this phase.';
          return res.status(400).json({
            error: `Cannot modify attendance for Phase ${lp.phaseNumber} (${lp.title || 'Phase ' + lp.phaseNumber}): ${reason}`
          });
        }
      }
    }

    // 4. Deep validation of assignment items
    const allowedStatuses = ['pending', 'submitted', 'graded', 'returned'];
    if (assignments !== undefined && assignments !== null) {
      if (!Array.isArray(assignments)) {
        return res.status(400).json({ error: 'Assignments payload must be an array.' });
      }
      for (const item of assignments) {
        if (!item.assignment_id) {
          return res.status(400).json({ error: 'Each assignment item must contain an assignment_id.' });
        }
        const asgEntry = asgMap.get(item.assignment_id);
        if (!asgEntry) {
          return res.status(400).json({ error: `Invalid assignment_id: "${item.assignment_id}" does not belong to the course definition.` });
        }
        if (lockedPhaseMap.has(asgEntry.phase.id)) {
          const lp = lockedPhaseMap.get(asgEntry.phase.id);
          const reason = lp.isLocked ? (lp.lockReason || 'Phase is locked by progression policy.') : 'Student has not been admitted to this phase.';
          return res.status(400).json({
            error: `Cannot grade assignment for Phase ${lp.phaseNumber} (${lp.title || 'Phase ' + lp.phaseNumber}): ${reason}`
          });
        }
        if (item.submission_status && !allowedStatuses.includes(item.submission_status)) {
          return res.status(400).json({ error: `Invalid submission_status: "${item.submission_status}". Allowed: ${allowedStatuses.join(', ')}.` });
        }
        const marksVal = item.marks_obtained !== undefined ? item.marks_obtained : item.marks;
        if (marksVal !== null && marksVal !== undefined && marksVal !== '') {
          const num = Number(marksVal);
          const maxAllowed = asgEntry.asgObj.maxMarks !== undefined ? Number(asgEntry.asgObj.maxMarks) : 100;
          if (isNaN(num) || num < 0 || num > maxAllowed) {
            return res.status(400).json({
              error: `Marks for assignment "${asgEntry.asgObj.title || item.assignment_id}" must be between 0 and ${maxAllowed}. Received: ${marksVal}`
            });
          }
        }
      }
    }

    // 5. Deep validation of exam items
    if (exam_marks !== undefined && exam_marks !== null) {
      const normalizePid = (em) => {
        if (em.phase_id !== undefined && em.phase_id !== null) return String(em.phase_id);
        if (em.phaseNumber !== undefined && em.phaseNumber !== null) return `p_${em.phaseNumber}`;
        return 'p_1';
      };
      const examItems = Array.isArray(exam_marks) ? exam_marks : [exam_marks];
      for (const item of examItems) {
        const pid = normalizePid(item);
        const phaseObj = phaseMap.get(pid);
        if (!phaseObj) {
          return res.status(400).json({ error: `Invalid phase_id for exam: "${pid}" does not exist in course definition.` });
        }
        if (!phaseObj.exam?.enabled) {
          return res.status(400).json({ error: `Phase "${phaseObj.title || pid}" does not have an exam enabled.` });
        }
        if (lockedPhaseMap.has(pid)) {
          const lp = lockedPhaseMap.get(pid);
          const reason = lp.isLocked ? (lp.lockReason || 'Phase is locked by progression policy.') : 'Student has not been admitted to this phase.';
          return res.status(400).json({
            error: `Cannot record exam marks for Phase ${lp.phaseNumber} (${lp.title || 'Phase ' + lp.phaseNumber}): ${reason}`
          });
        }
        const rawMarks = item.marks !== undefined ? item.marks : item.examMarks;
        if (rawMarks !== null && rawMarks !== undefined && rawMarks !== '') {
          const num = Number(rawMarks);
          const maxAllowed = phaseObj.exam?.maxMarks !== undefined ? Number(phaseObj.exam.maxMarks) : 100;
          if (isNaN(num) || num < 0 || num > maxAllowed) {
            return res.status(400).json({
              error: `Exam marks for phase "${phaseObj.title || pid}" must be between 0 and ${maxAllowed}. Received: ${rawMarks}`
            });
          }
        }
      }
    }

    // Capture beforeState for atomic audit logging
    const existingAtt = (Array.isArray(attendance) && attendance.length > 0)
      ? db.prepare(`SELECT class_id, attended FROM student_class_attendance WHERE enrollment_id = ? AND class_id IN (${attendance.map(() => '?').join(',')})`).all(courseId, ...attendance.map(a => a.class_id))
      : [];
    const existingAsg = (Array.isArray(assignments) && assignments.length > 0)
      ? db.prepare(`SELECT assignment_id, marks_obtained, submission_status FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id IN (${assignments.map(() => '?').join(',')})`).all(courseId, ...assignments.map(a => a.assignment_id))
      : [];
    const existingExam = exam_marks
      ? db.prepare('SELECT phase_id, exam_marks FROM student_phase_results WHERE enrollment_id = ?').all(courseId)
      : [];

    const beforeSnapshot = {
      attendance: existingAtt,
      assignments: existingAsg,
      exam_marks: existingExam
    };

    // 6. Execute atomic update across attendance, assignments, and exams in a single transaction with audit log inside
    const updatedProgress = await courseProgressService.updateDefinedProgressAtomic(
      courseId,
      {
        attendance: Array.isArray(attendance) ? attendance : [],
        assignments: Array.isArray(assignments) ? assignments : [],
        exam_marks: exam_marks || [],
        updatedBy: req.user.id
      },
      null,
      {
        ...batchOpt,
        onCommitAudit: (txDb) => {
          recordAuditEventFromReq(req, {
            action: 'academic.defined_progress_update',
            module: 'academic',
            resource: `enrollment:${courseId}`,
            targetUserId: studentId,
            outcome: 'success',
            details: {
              attendanceCount: Array.isArray(attendance) ? attendance.length : 0,
              assignmentCount: Array.isArray(assignments) ? assignments.length : 0,
              examCount: Array.isArray(exam_marks) ? (Array.isArray(exam_marks) ? exam_marks.length : 1) : 0
            },
            beforeState: beforeSnapshot,
            afterState: {
              attendance: Array.isArray(attendance) ? attendance.map(a => ({ class_id: a.class_id, attended: a.attended ? 1 : 0 })) : [],
              assignments: Array.isArray(assignments) ? assignments.map(a => ({ assignment_id: a.assignment_id, marks: a.marks_obtained !== undefined ? a.marks_obtained : a.marks, status: a.submission_status || 'graded' })) : [],
              exam_marks: Array.isArray(exam_marks) ? exam_marks : (exam_marks ? [exam_marks] : [])
            },
            dbInstance: txDb,
            throwOnError: true
          });
        }
      }
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { studentId });
    }

    res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('Error updating defined course progress:', error);
    res.status(500).json({ error: 'Internal server error while updating defined course progress.' });
  }
});

// Route to admit a student to a specific phase (1–5) of a course
router.post('/students/:id/courses/:courseId/phases/:phaseNumber/admit', authenticateToken, requireRole('admin', 'moderator'), async (req, res) => {
  try {
    if (req.user.role === 'admin' && !isSuperAdmin(req.user)) {
      const hasPerm = db.prepare('SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission = ?').get(req.user.id, 'students:academic_records');
      if (!hasPerm) return res.status(403).json({ error: "Access denied: missing required permission 'students:academic_records'", requiredPermission: 'students:academic_records' });
    }
    const studentId = parseInt(req.params.id, 10);
    const enrollmentId = parseInt(req.params.courseId, 10);
    const phaseNumber = parseInt(req.params.phaseNumber, 10);

    const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(enrollmentId, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    if (req.user.role === 'moderator') {
      if (!enrollment.batch_id) {
        return res.status(403).json({ error: 'Moderators cannot modify progress for enrollments not linked to a batch.' });
      }
      const isAssigned = db.prepare('SELECT 1 FROM batch_moderators WHERE batch_id = ? AND user_id = ?').get(enrollment.batch_id, req.user.id);
      if (!isAssigned) {
        return res.status(403).json({ error: 'Moderators can only modify progress for batches they are assigned to.' });
      }
    }

    const updatedProgress = await courseProgressService.admitStudentToPhase(enrollmentId, phaseNumber, db, {
      batchId: enrollment.batch_id,
      onCommitAudit: (txDb, meta) => {
        recordAuditEventFromReq(req, {
          action: 'academic.phase_admit',
          module: 'academic',
          resource: `enrollment:${enrollmentId}`,
          targetUserId: studentId,
          outcome: 'success',
          details: {
            phaseNumber,
            phaseId: meta?.targetPhaseId || meta?.beforeState?.phase_id || `phase_${phaseNumber}`,
            enrollmentId
          },
          beforeState: meta?.beforeState || {
            phaseNumber,
            phase_id: meta?.targetPhaseId || `phase_${phaseNumber}`,
            admitted: 0,
            step3_completed: enrollment.step3_completed ? 1 : 0
          },
          afterState: meta?.afterState || {
            phaseNumber,
            phase_id: meta?.targetPhaseId || `phase_${phaseNumber}`,
            admitted: 1,
            step3_completed: phaseNumber === 2 ? 1 : (enrollment.step3_completed ? 1 : 0)
          },
          dbInstance: txDb,
          throwOnError: true
        });
      }
    });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { studentId });
    }

    res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('Error admitting student to phase:', error);
    const status = (error.message && (error.message.includes('Audit ledger') || error.message.includes('SqliteError') || error.message.includes('constraint'))) ? 500 : 400;
    res.status(status).json({ error: error.message || 'Failed to admit student to phase.' });
  }
});

// Route to undo phase admission (unadmit) with strict payment restriction defense
router.post('/students/:id/courses/:courseId/phases/:phaseNumber/unadmit', authenticateToken, requireRole('admin', 'moderator'), async (req, res) => {
  try {
    if (req.user.role === 'admin' && !isSuperAdmin(req.user)) {
      const hasPerm = db.prepare('SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission = ?').get(req.user.id, 'students:academic_records');
      if (!hasPerm) return res.status(403).json({ error: "Access denied: missing required permission 'students:academic_records'", requiredPermission: 'students:academic_records' });
    }
    const studentId = parseInt(req.params.id, 10);
    const enrollmentId = parseInt(req.params.courseId, 10);
    const phaseNumber = parseInt(req.params.phaseNumber, 10);

    const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(enrollmentId, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    if (req.user.role === 'moderator') {
      if (!enrollment.batch_id) {
        return res.status(403).json({ error: 'Moderators cannot modify progress for enrollments not linked to a batch.' });
      }
      const isAssigned = db.prepare('SELECT 1 FROM batch_moderators WHERE batch_id = ? AND user_id = ?').get(enrollment.batch_id, req.user.id);
      if (!isAssigned) {
        return res.status(403).json({ error: 'Moderators can only modify progress for batches they are assigned to.' });
      }
    }

    const updatedProgress = await courseProgressService.unadmitStudentFromPhase(enrollmentId, phaseNumber, db, {
      batchId: enrollment.batch_id,
      onCommitAudit: (txDb, meta) => {
        recordAuditEventFromReq(req, {
          action: 'academic.phase_unadmit',
          module: 'academic',
          resource: `enrollment:${enrollmentId}`,
          targetUserId: studentId,
          outcome: 'success',
          details: {
            phaseNumber,
            phaseId: meta?.targetPhaseId || meta?.beforeState?.phase_id || `phase_${phaseNumber}`,
            enrollmentId
          },
          beforeState: meta?.beforeState || {
            phaseNumber,
            phase_id: meta?.targetPhaseId || `phase_${phaseNumber}`,
            admitted: 1,
            step3_completed: enrollment.step3_completed ? 1 : 0
          },
          afterState: meta?.afterState || {
            phaseNumber,
            phase_id: meta?.targetPhaseId || `phase_${phaseNumber}`,
            admitted: 0,
            step3_completed: phaseNumber === 2 ? 0 : (enrollment.step3_completed ? 1 : 0)
          },
          dbInstance: txDb,
          throwOnError: true
        });
      }
    });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('progression_updated', { studentId });
    }

    res.json({ success: true, progress: updatedProgress });
  } catch (error) {
    console.error('Error undoing phase admission:', error);
    const status = (error.message && (error.message.includes('Audit ledger') || error.message.includes('SqliteError') || error.message.includes('constraint'))) ? 500 : 400;
    res.status(status).json({ error: error.message || 'Failed to undo phase admission.' });
  }
});

// Explicit Migration Endpoint: Migrate a legacy enrollment to a defined course definition
router.post('/students/:id/courses/:courseId/migrate-to-defined', authenticateToken, requireRole('admin'), requirePermission('students:academic_records'), async (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const enrollmentId = parseInt(req.params.courseId, 10);
    const { target_course_definition_id, target_version, notes, phase_mapping, allow_cross_course_mapping, batch_id: requestedBatchId } = req.body;

    if (!target_course_definition_id) {
      return res.status(400).json({ error: 'target_course_definition_id is required' });
    }

    const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?').get(enrollmentId, studentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    if (enrollment.course_definition_id) {
      return res.status(400).json({ error: 'Enrollment is already bound to a defined course definition.' });
    }

    const targetDef = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(target_course_definition_id);
    if (!targetDef) {
      return res.status(404).json({ error: 'Target course definition not found.' });
    }

    if (targetDef.status !== 'published') {
      return res.status(400).json({ error: 'Target course definition must be published to migrate enrollments.' });
    }

    if (target_version !== undefined && target_version !== null) {
      const requestedVer = parseInt(target_version, 10);
      if (isNaN(requestedVer) || requestedVer !== targetDef.version) {
        return res.status(400).json({ error: `Invalid target_version ${target_version}. Target course definition is at version ${targetDef.version}.` });
      }
    }

    const parsedDef = JSON.parse(targetDef.definition_json || '{}');
    const phases = parsedDef.phases || [];
    if (phases.length === 0) {
      return res.status(400).json({ error: 'Cannot migrate to a course definition with 0 phases.' });
    }

    // Relatedness & explicit mapping validation
    const normalizeName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normSource = normalizeName(enrollment.course_name);
    const normTarget = normalizeName(targetDef.name);

    const isDirectMatch = normSource === normTarget || normSource.includes(normTarget) || normTarget.includes(normSource);
    const isSameType = (enrollment.course_type && targetDef.course_type && enrollment.course_type.toLowerCase() === targetDef.course_type.toLowerCase());
    const isRelated = isDirectMatch || isSameType;

    if (!isRelated && !allow_cross_course_mapping && !phase_mapping) {
      return res.status(400).json({
        error: `Cannot migrate enrollment to unrelated course definition "${targetDef.name}" without an explicit, validated phase_mapping or allow_cross_course_mapping: true.`
      });
    }

    if (phase_mapping && typeof phase_mapping === 'object') {
      const validPhaseIds = new Set(phases.map((p, idx) => p.id || `p_${idx + 1}`));
      for (const targetPhaseId of Object.values(phase_mapping)) {
        if (!validPhaseIds.has(targetPhaseId)) {
          return res.status(400).json({
            error: `Invalid phase_mapping: target phase "${targetPhaseId}" does not exist in target course definition.`
          });
        }
      }
    }

    // Safety checks: reject unmappable legacy progress states
    if (enrollment.step2_completed === 0 && (enrollment.step3_completed === 1 || enrollment.step4_completed === 1)) {
      return res.status(400).json({ error: 'Cannot safely migrate: contradictory legacy progress state (Phase 2 progress recorded without Phase 1 completion).' });
    }

    if (enrollment.step4_completed === 1 && phases.length > 2) {
      return res.status(400).json({ error: 'Cannot safely migrate completed legacy graduate (2 phases completed) to a course definition with more than 2 phases.' });
    }

    if (enrollment.step4_completed === 1 && phases.length < 2) {
      return res.status(400).json({ error: 'Cannot safely migrate completed legacy graduate (2 phases completed) to a course definition with fewer than 2 phases.' });
    }

    // Validate optional batch link
    let targetBatchId = null;
    if (requestedBatchId) {
      const bRow = db.prepare('SELECT id, course_definition_id FROM batches WHERE id = ?').get(requestedBatchId);
      if (!bRow) {
        return res.status(404).json({ error: `Specified batch_id ${requestedBatchId} not found.` });
      }
      if (bRow.course_definition_id && bRow.course_definition_id !== targetDef.id) {
        return res.status(400).json({ error: `Batch ${requestedBatchId} is associated with course definition ${bRow.course_definition_id}, not target ${targetDef.id}.` });
      }
      targetBatchId = bRow.id;
    } else if (enrollment.batch_id) {
      const currentBatch = db.prepare('SELECT id, course_definition_id FROM batches WHERE id = ?').get(enrollment.batch_id);
      if (currentBatch && (!currentBatch.course_definition_id || currentBatch.course_definition_id === targetDef.id)) {
        targetBatchId = currentBatch.id;
      }
    }

    // Preserve complete snapshot of legacy enrollment data before conversion
    const legacySnapshot = {
      enrollment_id: enrollment.id,
      user_id: enrollment.user_id,
      course_name: enrollment.course_name,
      course_type: enrollment.course_type,
      step1_completed: enrollment.step1_completed,
      step2_completed: enrollment.step2_completed,
      step3_completed: enrollment.step3_completed,
      step4_completed: enrollment.step4_completed,
      attendance_classes: enrollment.attendance_classes,
      attendance_total: enrollment.attendance_total,
      assignment_screenplay: enrollment.assignment_screenplay,
      assignment_shooting_script: enrollment.assignment_shooting_script,
      exam_written: enrollment.exam_written,
      assignment_scores: enrollment.assignment_scores,
      phase2_shooting_attended: enrollment.phase2_shooting_attended,
      phase2_editing_attended: enrollment.phase2_editing_attended,
      fee_details: enrollment.fee_details,
      created_at: enrollment.created_at,
      snapshot_timestamp: new Date().toISOString()
    };

    const targetVersion = target_version ? parseInt(target_version, 10) : targetDef.version;

    const migrationTx = db.transaction(() => {
      // 1. Record migration audit with full historical snapshot
      db.prepare(`
        INSERT INTO legacy_enrollment_migrations (
          enrollment_id, student_id, source_course_name, target_course_definition_id,
          target_version, legacy_snapshot_json, migrated_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        enrollment.id,
        studentId,
        enrollment.course_name,
        targetDef.id,
        targetVersion,
        JSON.stringify(legacySnapshot),
        req.user.id,
        notes || (phase_mapping ? `Migrated with phase_mapping: ${JSON.stringify(phase_mapping)}` : 'Explicit admin migration')
      );

      // Determine target phase IDs for phase 1 and phase 2
      const targetP1 = phase_mapping && phase_mapping['1'] ? phase_mapping['1'] : (phases[0]?.id || 'p_1');
      const targetP2 = phase_mapping && phase_mapping['2'] ? phase_mapping['2'] : (phases[1]?.id || 'p_2');

      // 2. Safely initialize student_phase_results mapping legacy pass states if applicable
      if (phases.length >= 1 && enrollment.step2_completed === 1) {
        const attClasses = enrollment.attendance_classes || 0;
        const attTotal = enrollment.attendance_total || 0;
        const attPct = attTotal > 0 ? Math.round((attClasses / attTotal) * 100) : 100.0;
        const examMarks = enrollment.exam_written !== null && enrollment.exam_written !== undefined ? enrollment.exam_written : null;

        db.prepare(`
          INSERT OR REPLACE INTO student_phase_results (
            enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage,
            exam_marks, is_passed, calculated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(enrollment.id, targetP1, attClasses, attTotal, attPct, examMarks, 1);
      }
      if (phases.length >= 2 && enrollment.step4_completed === 1) {
        const p2Attended = (enrollment.phase2_shooting_attended || 0) + (enrollment.phase2_editing_attended || 0);
        db.prepare(`
          INSERT OR REPLACE INTO student_phase_results (
            enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage,
            exam_marks, is_passed, calculated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(enrollment.id, targetP2, p2Attended, 2, 100.0, null, 1);
      }

      // 3. Atomically update the enrollment to the defined course
      db.prepare(`
        UPDATE student_course_enrollments
        SET course_definition_id = ?, course_version = ?, batch_id = COALESCE(?, batch_id), updated_at = datetime('now')
        WHERE id = ?
      `).run(targetDef.id, targetVersion, targetBatchId, enrollment.id);
    });

    migrationTx();

    const updatedProgress = await courseProgressService.getEnrollmentProgress(enrollmentId, null, { batchId: targetBatchId });

    res.json({
      success: true,
      message: 'Enrollment successfully migrated to defined course with legacy snapshot preserved.',
      progress: updatedProgress
    });
  } catch (error) {
    console.error('Error during explicit enrollment migration:', error);
    res.status(500).json({ error: 'Internal server error during enrollment migration.' });
  }
});

// Create global announcement
router.post('/announcements', authenticateToken, requireRole('admin'), requirePermission('notices:create'), sanitizeInput, (req, res) => {
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
    
    const createNoticeTx = db.transaction(() => {
      const stmt = db.prepare('INSERT INTO announcements (admin_id, title, content, priority, target_course, target_batch, image_url, scheduled_at, scheduled_notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const info = stmt.run(req.user.id, title, content, priority, targetCourse || null, targetBatch || null, image_url || null, scheduledAtValue, 0);
      recordAuditEventFromReq(req, {
        action: 'notice.create',
        module: 'notices',
        resource: `notice:${info.lastInsertRowid}`,
        outcome: 'success',
        details: { title, priority, targetCourse, targetBatch },
        throwOnError: true
      });
      return info;
    });
    const info = createNoticeTx();
    
    if (!scheduledAtValue) {
      // Insert into notifications table for relevant users
      let targetUsers = [];
      if (!targetCourse && !targetBatch) {
        // Only admitted students (assigned to a batch)
        targetUsers = db.prepare(`
          SELECT DISTINCT u.id
          FROM users u
          LEFT JOIN student_profiles p ON u.id = p.user_id
          WHERE u.role = 'student'
            AND u.is_active = 1
            AND p.batch_number IS NOT NULL
            AND p.batch_number != ''
        `).all();
      } else {
        let query = `
          SELECT DISTINCT u.id 
          FROM users u
          LEFT JOIN student_course_enrollments e ON u.id = e.user_id
          LEFT JOIN student_profiles p ON u.id = p.user_id
          WHERE u.role = 'student'
            AND u.is_active = 1
            AND p.batch_number IS NOT NULL
            AND p.batch_number != ''
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

// Soft Delete global announcement
router.delete('/announcements/:id', authenticateToken, requireRole('admin'), requirePermission('notices:delete'), (req, res) => {
  try {
    const announcement = db.prepare("SELECT title FROM announcements WHERE id = ?").get(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }

    const deleteNoticeTx = db.transaction(() => {
      const stmt = db.prepare("UPDATE announcements SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?");
      stmt.run(req.user.id, req.params.id);
      logTrashAction('announcements', req.params.id, announcement.title, 'deleted', req.user.id);

      db.prepare("DELETE FROM notifications WHERE link = ? OR link = ?").run(
        `/notices?expand=${req.params.id}`,
        `/notice-board?expand=${req.params.id}`
      );

      recordAuditEventFromReq(req, {
        action: 'notice.delete',
        module: 'notices',
        resource: `notice:${req.params.id}`,
        outcome: 'success',
        details: { title: announcement.title },
        throwOnError: true
      });
    });
    deleteNoticeTx();

    // Emit Socket.io event for real-time notice recall
    const io = req.app.get('io');
    if (io) {
      io.emit('notice_recalled', { noticeId: req.params.id });
    }

    res.json({ message: 'Announcement moved to Trash successfully.' });
  } catch (error) {
    console.error('Error moving announcement to trash:', error);
    res.status(500).json({ error: 'Internal server error while moving announcement to trash.' });
  }
});

// Get all active announcements
router.get('/announcements', authenticateToken, requireRole('admin'), requirePermission('notices:view'), (req, res) => {
  try {
    const announcements = db.prepare(`
      SELECT a.*, u.first_name || ' ' || u.last_name as admin_name 
      FROM announcements a
      JOIN users u ON a.admin_id = u.id
      WHERE a.deleted_at IS NULL AND (a.is_broadcast = 0 OR a.is_broadcast IS NULL)
      ORDER BY a.created_at DESC
    `).all();
    res.json({ announcements });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Internal server error while fetching announcements.' });
  }
});

// Get options for targeting announcements
router.get('/targeting-options', authenticateToken, requireRole('admin'), requireAnyPermission('notices:view', 'communications:view'), (req, res) => {
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
router.get('/custom-subjects', authenticateToken, requireRole('admin'), requirePermission('settings:view'), (req, res) => {
  try {
    const subjects = db.prepare(`
      SELECT 
        s.id, s.name, s.course_name, s.phase, s.parts_count, s.class_type, s.has_live_qa, 
        s.duration_minutes, s.part_durations, s.sort_order, s.created_at, s.teacher_id,
        COALESCE(p.full_name, u.first_name || ' ' || u.last_name) AS teacher_name,
        u.profile_picture AS teacher_avatar
      FROM custom_subjects s
      LEFT JOIN users u ON s.teacher_id = u.id
      LEFT JOIN instructor_profiles p ON u.id = p.user_id
      ORDER BY s.sort_order ASC, s.name ASC
    `).all();
    res.json({ subjects });
  } catch (error) {
    console.error('Error fetching custom subjects:', error);
    res.status(500).json({ error: 'Internal server error while fetching custom subjects.' });
  }
});

// Create a new custom subject
router.post('/custom-subjects', authenticateToken, requireRole('admin'), requirePermission('settings:edit'), sanitizeInput, (req, res) => {
  try {
    const { name, course_name, phase, parts_count, class_type, has_live_qa, duration_minutes, part_durations, teacher_id } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Subject name is required.' });
    }
    if (!course_name || !course_name.trim()) {
      return res.status(400).json({ error: 'Course name is required.' });
    }

    const trimmedName = name.trim();
    const courseNameTrimmed = course_name.trim();
    const phaseVal = phase !== undefined && phase !== null ? Number(phase) : null;
    const partsCountVal = parts_count !== undefined && parts_count !== null ? Math.max(1, Number(parts_count)) : 1;
    const classTypeVal = class_type === 'recorded' ? 'recorded' : 'live';
    const hasLiveQaVal = has_live_qa ? 1 : 0;
    const teacherIdVal = teacher_id !== undefined && teacher_id !== null && teacher_id !== '' ? Number(teacher_id) : null;

    let durationVal = null;
    let partDurationsVal = null;
    if (classTypeVal === 'recorded') {
      if (partsCountVal > 1 && Array.isArray(part_durations)) {
        const parsed = part_durations.slice(0, partsCountVal).map(d => (d !== '' && d !== null && d !== undefined) ? Math.max(1, parseInt(d)) : null);
        partDurationsVal = JSON.stringify(parsed);
        const total = parsed.reduce((sum, d) => sum + (d || 0), 0);
        durationVal = total > 0 ? total : null;
      } else if (partsCountVal === 1 && duration_minutes) {
        durationVal = Math.max(1, parseInt(duration_minutes));
      }
    }

    // Check if duplicate exists in custom_subjects for the same course and phase
    const existing = db.prepare(`
      SELECT id FROM custom_subjects 
      WHERE lower(name) = lower(?) 
        AND course_name = ? 
        AND (phase = ? OR (? IS NULL AND phase IS NULL))
    `).get(trimmedName, courseNameTrimmed, phaseVal, phaseVal);

    if (existing) {
      return res.status(400).json({ error: 'A custom subject with this name already exists for this course/phase.' });
    }

    const maxOrderRow = db.prepare(`
      SELECT MAX(sort_order) as maxOrder FROM custom_subjects 
      WHERE course_name = ? 
        AND (phase = ? OR (? IS NULL AND phase IS NULL))
    `).get(courseNameTrimmed, phaseVal, phaseVal);
    const nextOrder = maxOrderRow && maxOrderRow.maxOrder !== null ? maxOrderRow.maxOrder + 1 : 0;

    const result = db.prepare(`
      INSERT INTO custom_subjects (name, course_name, phase, parts_count, class_type, has_live_qa, duration_minutes, part_durations, sort_order, teacher_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(trimmedName, courseNameTrimmed, phaseVal, partsCountVal, classTypeVal, hasLiveQaVal, durationVal, partDurationsVal, nextOrder, teacherIdVal);

    // If a teacher is assigned, add this subject to the teacher's instructor_profiles.subjects list
    if (teacherIdVal) {
      try {
        const profile = db.prepare('SELECT subjects FROM instructor_profiles WHERE user_id = ?').get(teacherIdVal);
        let subjectsArr = [];
        if (profile && profile.subjects) {
          try { subjectsArr = JSON.parse(profile.subjects); } catch { subjectsArr = []; }
        }
        if (!Array.isArray(subjectsArr)) subjectsArr = [];
        const subjectEntry = partsCountVal > 1
          ? Array.from({ length: partsCountVal }, (_, i) => `${trimmedName} - Part ${i + 1}`)
          : [trimmedName];
        for (const entry of subjectEntry) {
          if (!subjectsArr.includes(entry)) subjectsArr.push(entry);
        }
        const updateStmt = db.prepare('UPDATE instructor_profiles SET subjects = ? WHERE user_id = ?');
        const updateResult = updateStmt.run(JSON.stringify(subjectsArr), teacherIdVal);
        if (updateResult.changes === 0) {
          db.prepare('INSERT INTO instructor_profiles (user_id, subjects) VALUES (?, ?)').run(teacherIdVal, JSON.stringify(subjectsArr));
        }
      } catch (e) {
        console.error('Failed to update teacher profile after subject creation:', e);
      }
    }

    res.status(201).json({ 
      subject: {
        id: result.lastInsertRowid,
        name: trimmedName,
        course_name: courseNameTrimmed,
        phase: phaseVal,
        parts_count: partsCountVal,
        class_type: classTypeVal,
        has_live_qa: hasLiveQaVal,
        duration_minutes: durationVal,
        part_durations: partDurationsVal,
        sort_order: nextOrder,
        teacher_id: teacherIdVal
      }
    });
  } catch (error) {
    console.error('Error creating custom subject:', error);
    res.status(500).json({ error: 'Internal server error while creating custom subject.' });
  }
});

// Reorder custom subjects
router.put('/custom-subjects/reorder', authenticateToken, requireRole('admin'), requirePermission('settings:edit'), (req, res) => {
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
router.put('/custom-subjects/:id', authenticateToken, requireRole('admin'), requirePermission('settings:edit'), sanitizeInput, (req, res) => {
  try {
    const { id } = req.params;
    const { name, parts_count, class_type, has_live_qa, duration_minutes, part_durations, teacher_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Subject name is required.' });
    }

    const trimmedName = name.trim();
    const partsCountVal = parts_count !== undefined && parts_count !== null ? Math.max(1, Number(parts_count)) : 1;
    const classTypeVal = class_type === 'recorded' ? 'recorded' : 'live';
    const hasLiveQaVal = has_live_qa ? 1 : 0;
    const teacherIdVal = teacher_id !== undefined && teacher_id !== null && teacher_id !== '' ? Number(teacher_id) : null;

    let durationVal = null;
    let partDurationsVal = null;
    if (classTypeVal === 'recorded') {
      if (partsCountVal > 1 && Array.isArray(part_durations)) {
        const parsed = part_durations.slice(0, partsCountVal).map(d => (d !== '' && d !== null && d !== undefined) ? Math.max(1, parseInt(d)) : null);
        partDurationsVal = JSON.stringify(parsed);
        const total = parsed.reduce((sum, d) => sum + (d || 0), 0);
        durationVal = total > 0 ? total : null;
      } else if (partsCountVal === 1 && duration_minutes) {
        durationVal = Math.max(1, parseInt(duration_minutes));
      }
    }

    // Check if custom subject exists
    const subject = db.prepare('SELECT name, course_name, phase, parts_count, teacher_id AS old_teacher_id FROM custom_subjects WHERE id = ?').get(id);
    if (!subject) {
      return res.status(404).json({ error: 'Custom subject not found.' });
    }

    // Check if duplicate exists in custom_subjects for the same course and phase (excluding current ID)
    const existing = db.prepare(`
      SELECT id FROM custom_subjects 
      WHERE lower(name) = lower(?) 
        AND course_name = ? 
        AND (phase = ? OR (? IS NULL AND phase IS NULL))
        AND id != ?
    `).get(trimmedName, subject.course_name, subject.phase, subject.phase, id);

    if (existing) {
      return res.status(400).json({ error: 'Another custom subject with this name already exists for this course/phase.' });
    }

    db.prepare('UPDATE custom_subjects SET name = ?, parts_count = ?, class_type = ?, has_live_qa = ?, duration_minutes = ?, part_durations = ?, teacher_id = ? WHERE id = ?').run(trimmedName, partsCountVal, classTypeVal, hasLiveQaVal, durationVal, partDurationsVal, teacherIdVal, id);

    const oldTeacherId = subject.old_teacher_id ? Number(subject.old_teacher_id) : null;
    const teacherChanged = oldTeacherId !== teacherIdVal;

    // Helper to get & parse a teacher's subjects list
    const getSubjectsArr = (userId) => {
      const p = db.prepare('SELECT subjects FROM instructor_profiles WHERE user_id = ?').get(userId);
      if (p && p.subjects) {
        try { return JSON.parse(p.subjects); } catch { return []; }
      }
      return [];
    };

    // Helper to upsert instructor_profiles subjects
    const saveSubjectsArr = (userId, arr) => {
      const r = db.prepare('UPDATE instructor_profiles SET subjects = ? WHERE user_id = ?').run(JSON.stringify(arr), userId);
      if (r.changes === 0) {
        db.prepare('INSERT INTO instructor_profiles (user_id, subjects) VALUES (?, ?)').run(userId, JSON.stringify(arr));
      }
    };

    // Cascade rename & parts_count cleanup to instructor profiles
    try {
      const profiles = db.prepare('SELECT user_id, subjects FROM instructor_profiles').all();
      const updateStmt = db.prepare('UPDATE instructor_profiles SET subjects = ? WHERE user_id = ?');
      for (const p of profiles) {
        if (p.subjects) {
          try {
            let subjectsArr = JSON.parse(p.subjects);
            if (Array.isArray(subjectsArr)) {
              let updated = false;
              let updatedArr = subjectsArr.map(s => {
                if (s === subject.name) {
                  updated = true;
                  return trimmedName;
                }
                if (s.startsWith(subject.name + ' - Part ')) {
                  updated = true;
                  return s.replace(subject.name + ' - Part ', trimmedName + ' - Part ');
                }
                return s;
              });

              // If parts_count decreased, filter out orphaned parts
              if (partsCountVal < subject.parts_count) {
                const prefix = trimmedName + ' - Part ';
                const filteredArr = updatedArr.filter(s => {
                  if (s.startsWith(prefix)) {
                    const partNum = parseInt(s.replace(prefix, '')) || 0;
                    if (partNum > partsCountVal) {
                      updated = true;
                      return false; // drop
                    }
                  }
                  return true;
                });
                updatedArr = filteredArr;
              }

              if (updated) {
                updateStmt.run(JSON.stringify(updatedArr), p.user_id);
              }
            }
          } catch (e) {
            console.error(`Failed to cascade rename subjects for instructor ${p.user_id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to update teacher profiles during subject rename cascade:', e);
    }

    // Handle teacher assignment changes
    if (teacherChanged) {
      try {
        // Remove subject entries from old teacher's list
        if (oldTeacherId) {
          let oldArr = getSubjectsArr(oldTeacherId);
          const oldName = subject.name;
          oldArr = oldArr.filter(s => s !== oldName && !s.startsWith(oldName + ' - Part ') && s !== trimmedName && !s.startsWith(trimmedName + ' - Part '));
          saveSubjectsArr(oldTeacherId, oldArr);
        }
        // Add subject entries to new teacher's list
        if (teacherIdVal) {
          let newArr = getSubjectsArr(teacherIdVal);
          const entries = partsCountVal > 1
            ? Array.from({ length: partsCountVal }, (_, i) => `${trimmedName} - Part ${i + 1}`)
            : [trimmedName];
          for (const entry of entries) {
            if (!newArr.includes(entry)) newArr.push(entry);
          }
          saveSubjectsArr(teacherIdVal, newArr);
        }
      } catch (e) {
        console.error('Failed to update teacher profiles during subject teacher reassignment:', e);
      }
    } else if (teacherIdVal) {
      // Same teacher, but parts_count or name might have changed
      try {
        let currentArr = getSubjectsArr(teacherIdVal);
        const oldName = subject.name;
        
        // Remove ALL old and new references to this subject to start fresh
        currentArr = currentArr.filter(s => s !== oldName && !s.startsWith(oldName + ' - Part ') && s !== trimmedName && !s.startsWith(trimmedName + ' - Part '));
        
        // Re-add the correct entries based on current parts_count
        const entries = partsCountVal > 1
          ? Array.from({ length: partsCountVal }, (_, i) => `${trimmedName} - Part ${i + 1}`)
          : [trimmedName];
          
        for (const entry of entries) {
          if (!currentArr.includes(entry)) currentArr.push(entry);
        }
        
        saveSubjectsArr(teacherIdVal, currentArr);
      } catch (e) {
        console.error('Failed to sync teacher profiles during subject update:', e);
      }
    }

    res.json({ 
      subject: {
        id: Number(id),
        name: trimmedName,
        parts_count: partsCountVal,
        teacher_id: teacherIdVal
      }
    });
  } catch (error) {
    console.error('Error update custom subject:', error);
    res.status(500).json({ error: 'Internal server error while updating custom subject.' });
  }
});

// Delete a custom subject
router.delete('/custom-subjects/:id', authenticateToken, requireRole('admin'), requirePermission('settings:edit'), (req, res) => {
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
            if (Array.isArray(subjectsArr)) {
              const updatedArr = subjectsArr.filter(s => s !== subject.name && !s.startsWith(subject.name + ' - Part '));
              if (updatedArr.length !== subjectsArr.length) {
                updateStmt.run(JSON.stringify(updatedArr), p.user_id);
              }
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

export function startSmsScheduler() {
  if (process.env.IS_STAGING_SERVER === 'true' || process.env.DISABLE_OUTBOUND_NOTIFICATIONS === 'true') {
    console.log('[SMS Scheduler] Staging environment active: outbound SMS background scheduler suppressed.');
    return;
  }
  // Check every 10 seconds for scheduled SMS that are due to be sent
  setInterval(async () => {
    try {
      const pendingSmsList = db.prepare(`
        SELECT id, sender_id, recipients, message, scheduled_at
        FROM scheduled_sms
        WHERE status = 'pending'
          AND datetime(scheduled_at) <= datetime('now')
      `).all();

      if (pendingSmsList.length > 0) {
        console.log(`[SMS Scheduler] Sending ${pendingSmsList.length} scheduled SMS batches...`);

        const apiKey = process.env.SMS_API_KEY;
        if (!apiKey) {
          console.error('[SMS Scheduler] SMS API key not configured on the server.');
          return;
        }

        const updateStatus = db.prepare(`
          UPDATE scheduled_sms
          SET status = ?, error_message = ?
          WHERE id = ?
        `);

        for (const sms of pendingSmsList) {
          let recipients = [];
          try {
            recipients = JSON.parse(sms.recipients);
          } catch (e) {
            console.error('[SMS Scheduler] Failed to parse recipients JSON:', e);
            updateStatus.run('failed', 'Invalid recipients data format', sms.id);
            continue;
          }

          let sentCount = 0;
          let failCount = 0;
          const errors = [];

          for (const recipient of recipients) {
            const { name = '', phone = '' } = recipient;
            const cleanPhone = phone.replace(/[^\d+]/g, '');
            if (!cleanPhone || cleanPhone.length < 7) {
              failCount++;
              errors.push(`${phone}: Invalid phone number`);
              continue;
            }

            const personalizedMsg = sms.message.replace(/\{name\}/gi, name);

            try {
              const response = await fetch('https://login.smsinbd.com/api/external/v1/sms/send', {
                method: 'POST',
                headers: {
                  'X-API-KEY': apiKey,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  sender_id: sms.sender_id,
                  phone: cleanPhone,
                  message: personalizedMsg
                })
              });

              const data = await response.json().catch(() => ({}));
              if (response.ok && (data.status === 'success' || data.success || response.status === 200)) {
                sentCount++;
              } else {
                failCount++;
                errors.push(`${cleanPhone}: ${data.message || 'Failed'}`);
              }
            } catch (err) {
              failCount++;
              errors.push(`${cleanPhone}: ${err.message}`);
            }

            // Small delay between calls to respect rate limits
            await new Promise(r => setTimeout(r, 60));
          }

          if (failCount === 0) {
            updateStatus.run('sent', null, sms.id);
          } else if (sentCount > 0) {
            updateStatus.run('sent', `Partial: ${sentCount} sent, ${failCount} failed. Errors: ${errors.join(', ')}`, sms.id);
          } else {
            updateStatus.run('failed', errors.join(', '), sms.id);
          }
        }
      }
    } catch (error) {
      console.error('[SMS Scheduler] Error processing scheduled SMS:', error);
    }
  }, 10000);
}

export function startAnnouncementScheduler(io) {
  // Also start SMS scheduler
  startSmsScheduler();

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
            // Only admitted students (assigned to a batch)
            targetUsers = db.prepare(`
              SELECT DISTINCT u.id
              FROM users u
              LEFT JOIN student_profiles p ON u.id = p.user_id
              WHERE u.role = 'student'
                AND u.is_active = 1
                AND p.batch_number IS NOT NULL
                AND p.batch_number != ''
            `).all();
          } else {
            let query = `
              SELECT DISTINCT u.id 
              FROM users u
              LEFT JOIN student_course_enrollments e ON u.id = e.user_id
              LEFT JOIN student_profiles p ON u.id = p.user_id
              WHERE u.role = 'student'
                AND u.is_active = 1
                AND p.batch_number IS NOT NULL
                AND p.batch_number != ''
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

// ─── Bulk SMS ─────────────────────────────────────────────────────────────────
// POST /api/admin/sms/bulk
// Body: { recipients: [{name, phone}], message: string, senderId?: string }
// Returns: { sent: number, failed: number, results: [{name, phone, ok, error?}] }
router.post('/sms/bulk', authenticateToken, requireRole('admin'), requirePermission('communications:send'), async (req, res) => {
  try {
    const { recipients, message, senderId } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients provided.' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const apiKey = process.env.SMS_API_KEY;
    const defaultSenderId = process.env.SMS_SENDER_ID || '8809617626169';
    const finalSenderId = (senderId || defaultSenderId).trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'SMS API key not configured on the server.' });
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const { name = '', phone = '' } = recipient;

      // Sanitize phone: keep digits + leading +
      const cleanPhone = phone.replace(/[^\d+]/g, '');
      if (!cleanPhone || cleanPhone.length < 7) {
        results.push({ name, phone, ok: false, error: 'Invalid phone number' });
        failed++;
        continue;
      }

      // Apply merge tags
      const personalizedMsg = message.replace(/\{name\}/gi, name);

      try {
        const response = await fetch('https://login.smsinbd.com/api/external/v1/sms/send', {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sender_id: finalSenderId,
            phone: cleanPhone,
            message: personalizedMsg
          })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && (data.status === 'success' || data.success || response.status === 200)) {
          results.push({ name, phone: cleanPhone, ok: true });
          sent++;
        } else {
          let errMsg = 'Failed to send';
          if (data.message) {
            errMsg = data.message;
          } else if (data.error) {
            if (typeof data.error === 'object') {
              errMsg = data.error.message || data.error.code || JSON.stringify(data.error);
            } else {
              errMsg = data.error;
            }
          } else {
            errMsg = `HTTP ${response.status}`;
          }
          results.push({ name, phone: cleanPhone, ok: false, error: errMsg });
          failed++;
        }
      } catch (fetchErr) {
        results.push({ name, phone: cleanPhone, ok: false, error: fetchErr.message });
        failed++;
      }

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 60));
    }

    res.status(200).json({ sent, failed, results });
  } catch (error) {
    console.error('[SMS Bulk] Error:', error);
    res.status(500).json({ error: 'Internal server error during SMS sending.' });
  }
});

// POST /api/admin/sms/schedule
// Body: { senderId, recipients: [{name, phone}], message, scheduledAt }
router.post('/sms/schedule', authenticateToken, requireRole('admin'), requirePermission('communications:schedule'), async (req, res) => {
  try {
    const { senderId, recipients, message, scheduledAt } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients provided.' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    if (!scheduledAt) {
      return res.status(400).json({ error: 'Scheduled time is required.' });
    }

    const defaultSenderId = process.env.SMS_SENDER_ID || '8809617626169';
    const finalSenderId = (senderId || defaultSenderId).trim();

    // Verify scheduledAt is valid
    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduled time format.' });
    }

    db.prepare(`
      INSERT INTO scheduled_sms (sender_id, recipients, message, scheduled_at, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(finalSenderId, JSON.stringify(recipients), message.trim(), schedDate.toISOString());

    res.status(200).json({ message: 'SMS batch scheduled successfully.' });
  } catch (error) {
    console.error('[SMS Schedule] Error:', error);
    res.status(500).json({ error: 'Internal server error during scheduling.' });
  }
});

// GET /api/admin/sms/scheduled
router.get('/sms/scheduled', authenticateToken, requireRole('admin'), requirePermission('communications:view'), async (req, res) => {
  try {
    const list = db.prepare(`
      SELECT id, sender_id, recipients, message, scheduled_at, status, error_message, created_at
      FROM scheduled_sms
      ORDER BY datetime(scheduled_at) DESC
    `).all();

    // Parse recipients for frontend display
    const formatted = list.map(item => {
      try {
        item.recipients = JSON.parse(item.recipients);
      } catch (e) {
        item.recipients = [];
      }
      return item;
    });

    res.status(200).json(formatted);
  } catch (error) {
    console.error('[SMS Scheduled List] Error:', error);
    res.status(500).json({ error: 'Internal server error fetching scheduled SMS list.' });
  }
});

// DELETE /api/admin/sms/scheduled/:id
router.delete('/sms/scheduled/:id', authenticateToken, requireRole('admin'), requirePermission('communications:delete'), async (req, res) => {
  try {
    const { id } = req.params;
    db.prepare(`
      DELETE FROM scheduled_sms
      WHERE id = ? AND status = 'pending'
    `).run(id);
    res.status(200).json({ message: 'Scheduled SMS canceled successfully.' });
  } catch (error) {
    console.error('[SMS Schedule Cancel] Error:', error);
    res.status(500).json({ error: 'Internal server error canceling scheduled SMS.' });
  }
});

export default router;

