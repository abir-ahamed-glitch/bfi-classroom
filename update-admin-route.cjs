const fs = require('fs');
const path = require('path');

const adminFilePath = path.join(__dirname, 'server', 'routes', 'admin.js');
let content = fs.readFileSync(adminFilePath, 'utf8');

const startMarker = `// Route to update a student's academic records`;
const endMarker = `// Create global announcement`;

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find markers.');
  process.exit(1);
}

const replacement = `// Route to update a student's academic records
router.put('/students/:id/academic-records/:courseId', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const studentId = req.params.id;
    const courseId = req.params.courseId;
    const { attendance_classes, attendance_total, exam_written, assignment_scores } = req.body;

    // Verify the enrollment exists
    const enrollment = db.prepare(\`SELECT * FROM student_course_enrollments WHERE id = ? AND user_id = ?\`).get(courseId, studentId);
    
    if (!enrollment) {
      return res.status(404).json({ error: 'Course enrollment not found.' });
    }

    // Determine batch_number
    let batchNumber = 'DEFAULT';
    const batchRecord = db.prepare(\`
      SELECT b.batch_number 
      FROM batch_students bs
      JOIN batches b ON bs.batch_id = b.id
      WHERE bs.student_id = ? AND b.course_name = ?
    \`).get(studentId, enrollment.course_name);
    
    if (batchRecord && batchRecord.batch_number) {
      batchNumber = batchRecord.batch_number;
    }

    // Fetch course settings
    let courseSetting = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(enrollment.course_name, batchNumber);
    if (!courseSetting) {
      courseSetting = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(enrollment.course_name, 'DEFAULT');
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
    } catch(e) {}

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
      return res.status(400).json({ error: \`Written exam score cannot exceed \${courseSetting.exam_max_score}.\` });
    }
    if (exam < 0) {
      return res.status(400).json({ error: 'Written exam score cannot be negative.' });
    }

    let assignmentsTotal = 0;
    if (hasAssignment) {
      for (const def of definedAssignments) {
        const score = parseFloat(parsedScores[def.id]) || 0;
        if (score > def.max_score) {
          return res.status(400).json({ error: \`\${def.name} score cannot exceed \${def.max_score}.\` });
        }
        if (score < 0) {
          return res.status(400).json({ error: \`\${def.name} score cannot be negative.\` });
        }
        assignmentsTotal += score;
      }
    }

    const transaction = db.transaction(() => {
      // 1. Update the specific student's record
      db.prepare(\`
        UPDATE student_course_enrollments
        SET attendance_classes = ?, 
            attendance_total = ?,
            exam_written = ?, 
            assignment_scores = ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      \`).run(attendance, totalAttendance, exam, JSON.stringify(parsedScores), courseId, studentId);

      // 2. Sync the new attendance_total to EVERYONE in the same course (only if it's phase2 course logic)
      if (hasPhase2) {
        db.prepare(\`
          UPDATE student_course_enrollments
          SET attendance_total = ?,
              updated_at = datetime('now')
          WHERE course_name = ?
        \`).run(totalAttendance, enrollment.course_name);
      }

      // 3. Recalculate pass/fail for EVERYONE in the course (or just this student if it's not a synced course)
      const allEnrollments = db.prepare(\`
        SELECT id, user_id, attendance_classes, attendance_total, exam_written, assignment_scores, step2_completed
        FROM student_course_enrollments
        WHERE course_name = ?
      \`).all(enrollment.course_name);

      let targetStudentPassed = 0;

      for (const e of allEnrollments) {
        const attClasses = e.attendance_classes || 0;
        const attTotal = e.attendance_total || courseSetting.total_classes;
        const eExam = e.exam_written || 0;
        
        let eScores = {};
        try {
          eScores = JSON.parse(e.assignment_scores || '{}');
        } catch(err) {}

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
            db.prepare(\`
              UPDATE student_course_enrollments
              SET step2_completed = 0, step3_completed = 0, step4_completed = 0
              WHERE id = ? AND user_id = ?
            \`).run(e.id, e.user_id);
          } else {
            db.prepare(\`
              UPDATE student_course_enrollments
              SET step2_completed = 0
              WHERE id = ? AND user_id = ?
            \`).run(e.id, e.user_id);
          }
        } else {
          if (hasPhase2) {
            db.prepare(\`
              UPDATE student_course_enrollments
              SET step2_completed = 1
              WHERE id = ? AND user_id = ?
            \`).run(e.id, e.user_id);
          } else {
            db.prepare(\`
              UPDATE student_course_enrollments
              SET step2_completed = 1, step4_completed = 1
              WHERE id = ? AND user_id = ?
            \`).run(e.id, e.user_id);
          }
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

`;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync(adminFilePath, newContent, 'utf8');
console.log('Successfully updated admin.js PUT academic-records route.');

