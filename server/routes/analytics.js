import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { parseFeeDetails, getBatchFee, getFeeStatus, extractFeeAmounts, resolvePhaseFee, createFeeResolverContext, resolveEnrollmentFinancials } from '../utils/feeResolver.js';

const router = express.Router();

const analyticsCache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function getCachedOrCompute(key, computeFn) {
  const cached = analyticsCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }
  const data = computeFn();
  analyticsCache.set(key, { timestamp: now, data });
  return data;
}


function getPendingCertificateRows(feeContext = null) {
  const rows = db.prepare(`
    SELECT
      sce.id AS enrollment_id,
      sce.user_id,
      sce.course_name,
      sce.course_type,
      sce.course_definition_id,
      sce.batch_id,
      sce.fee_details,
      u.first_name,
      u.last_name,
      sp.student_id,
      sp.batch_number
    FROM student_course_enrollments sce
    JOIN users u ON u.id = sce.user_id
    JOIN student_profiles sp ON sp.user_id = u.id
    WHERE sp.phase2_completed = 1
      AND COALESCE(sce.step4_completed, 0) = 0
      AND NOT EXISTS (
        SELECT 1
        FROM student_course_enrollments issued
        WHERE issued.user_id = sce.user_id
          AND LOWER(TRIM(issued.course_name)) = LOWER(TRIM(sce.course_name))
          AND COALESCE(issued.step4_completed, 0) = 1
      )
    ORDER BY datetime(sp.updated_at) DESC, sce.id DESC
  `).all();

  const ctx = feeContext || createFeeResolverContext(db);

  return rows
    .filter((row) => getFeeStatus(parseFeeDetails(row.fee_details), row.course_type, null, {
      courseDefId: row.course_definition_id,
      courseName: row.course_name,
      batchNumber: row.batch_number,
      batchId: row.batch_id,
      feeContext: ctx
    }) === 'paid')
    .map(({ fee_details: _feeDetails, ...row }) => ({
      ...row,
      payment_status: 'Fully Paid',
    }));
}

function getMissingAttendanceRows() {
  return db.prepare(`
    SELECT
      sce.id AS enrollment_id,
      sce.user_id,
      sce.course_name,
      sce.phase2_shooting_attended,
      sce.phase2_editing_attended,
      u.first_name,
      u.last_name,
      sp.student_id,
      sp.batch_number
    FROM student_course_enrollments sce
    JOIN users u ON u.id = sce.user_id
    JOIN student_profiles sp ON sp.user_id = u.id
    -- Future refinement: limit this audit to students who have actually reached Phase 2.
    WHERE sce.course_name = 'Online Filmmaking Course'
      AND (
        COALESCE(sce.phase2_shooting_attended, 0) = 0
        OR COALESCE(sce.phase2_editing_attended, 0) = 0
      )
    ORDER BY sp.student_id ASC
  `).all();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/urgent
// Returns counts for the 4 urgent action cards
// ─────────────────────────────────────────────────────────────────────────────
router.get('/urgent', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    // 1. Completed and fully paid courses that have not reached certificate issuance.
    const pendingCertificates = getPendingCertificateRows();

    // 2. Currently enrolled students missing either Phase 2 attendance value.
    const missingAttendance = getMissingAttendanceRows();

    // 3. Inactive students: last_login is NULL or older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().split('T')[0];

    const inactiveStudents = db.prepare(`
      SELECT COUNT(*) as count
      FROM users
      WHERE role = 'student'
        AND (last_login IS NULL OR last_login < ?)
    `).get(cutoff);

    res.json({
      pendingCertApprovals: pendingCertificates.length,
      missingAttendance: missingAttendance.length,
      inactiveStudents: inactiveStudents.count || 0,
      unreadReports: 0, // placeholder — reports feature not yet implemented
    });
  } catch (error) {
    console.error('[Analytics] /urgent error:', error);
    res.status(500).json({ error: 'Failed to fetch urgent stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/stats
// Returns the 9 overall institute statistics
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const data = getCachedOrCompute('stats', () => {
      // Total registered students
      const totalRegistered = db.prepare(`
        SELECT COUNT(*) as count FROM users WHERE role = 'student'
      `).get();

      // Currently enrolled / admitted (global)
      const allEnrollments = db.prepare(`
        SELECT id, user_id, course_name, course_type, course_definition_id, batch_id, step1_completed, step2_completed, step3_completed, step4_completed, fee_details
        FROM student_course_enrollments
      `).all();

      const enrolledUserIds = new Set();
      const passedUserIds = new Set();
      const passedPhase1UserIds = new Set();

      const definedDefs = db.prepare('SELECT id, phase_count, definition_json FROM course_definitions').all();
      const defMap = new Map(definedDefs.map(d => [d.id, d.phase_count]));
      const defDetailsMap = new Map();
      for (const d of definedDefs) {
        let parsed = null;
        try {
          parsed = typeof d.definition_json === 'string' ? JSON.parse(d.definition_json) : d.definition_json;
        } catch {}
        defDetailsMap.set(d.id, { ...d, parsed });
      }

      // Pre-compute passed phases per enrollment in ONE single query
      const passedPhasesRows = db.prepare(`
        SELECT enrollment_id, COUNT(*) as cnt
        FROM student_phase_results
        WHERE is_passed = 1
        GROUP BY enrollment_id
      `).all();
      const passedPhasesMap = new Map();
      for (const r of passedPhasesRows) {
        passedPhasesMap.set(r.enrollment_id, r.cnt);
      }

      const feeContext = createFeeResolverContext(db);

      for (const e of allEnrollments) {
        let isEnrolled = false;

        if (e.course_definition_id) {
          isEnrolled = true;
          const totalPhases = defMap.get(e.course_definition_id) || 1;
          const passedPhases = passedPhasesMap.get(e.id) || 0;
          if (passedPhases >= totalPhases) {
            passedUserIds.add(e.user_id);
          }
          if (passedPhases >= 1) {
            passedPhase1UserIds.add(e.user_id);
          }
        } else {
          if (e.course_name === 'Online Filmmaking Course') {
            if (e.step1_completed === 1) isEnrolled = true;
          } else {
            const feeDetails = parseFeeDetails(e.fee_details);
            const status = getFeeStatus(feeDetails, e.course_type, null, {
              courseDefId: e.course_definition_id,
              courseName: e.course_name,
              batchId: e.batch_id,
              feeContext
            });
            if (status === 'paid' || status === 'partial') isEnrolled = true;
          }

          if (e.step4_completed === 1) passedUserIds.add(e.user_id);
          if (e.step2_completed === 1) passedPhase1UserIds.add(e.user_id);
        }

        if (isEnrolled) enrolledUserIds.add(e.user_id);
      }

      // Total Passed Students (unique student count who completed any course)
      const totalPassed = passedUserIds.size;

      // Certificates issued (total count of step4_completed rows)
      const legacyCertificates = db.prepare(`
        SELECT COUNT(*) as count
        FROM student_course_enrollments
        WHERE step4_completed = 1 AND course_definition_id IS NULL
      `).get();

      let definedCertsCount = 0;
      for (const e of allEnrollments) {
        if (e.course_definition_id) {
          const requiredPhases = defMap.get(e.course_definition_id) || 1;
          if ((passedPhasesMap.get(e.id) || 0) >= requiredPhases) {
            definedCertsCount++;
          }
        }
      }
      const certificatesIssued = { count: (legacyCertificates?.count || 0) + definedCertsCount };

      // Failed / Dropped (global)
      const failedOrDropped = Math.max(
        0,
        (totalRegistered.count || 0) - passedPhase1UserIds.size
      );

      // Course-specific statistics for active courses
      const activeCourses = db.prepare(`
        SELECT course_name,
               CASE WHEN MAX(CASE WHEN course_type = 'filmmaking' THEN 1 ELSE 0 END) = 1
                    THEN 'filmmaking'
                    ELSE COALESCE(MAX(course_type), 'short')
               END AS course_type,
               MAX(course_definition_id) as course_definition_id
        FROM student_course_enrollments
        WHERE course_name IS NOT NULL AND TRIM(course_name) != ''
        GROUP BY course_name
      `).all();

      // Pre-query phase stats for all courses in one query
      const phaseStatsRows = db.prepare(`
        SELECT 
          sce.course_name,
          spr.phase_id,
          COUNT(DISTINCT spr.enrollment_id) as students_evaluated,
          SUM(CASE WHEN spr.is_passed = 1 THEN 1 ELSE 0 END) as passed_count,
          AVG(spr.attendance_percentage) as avg_attendance,
          SUM(spr.assignments_completed) as total_assignments_completed
        FROM student_phase_results spr
        JOIN student_course_enrollments sce ON sce.id = spr.enrollment_id
        GROUP BY sce.course_name, spr.phase_id
      `).all();
      const phaseStatsMap = new Map();
      for (const r of phaseStatsRows) {
        phaseStatsMap.set(`${r.course_name}:::${r.phase_id}`, r);
      }

      // Pre-query course completed counts for defined courses
      const courseCompletedMap = new Map();
      for (const [defId, totalPhases] of defMap.entries()) {
        const rows = db.prepare(`
          SELECT sce.course_name, COUNT(DISTINCT spr.enrollment_id) as cnt
          FROM student_phase_results spr
          JOIN student_course_enrollments sce ON sce.id = spr.enrollment_id
          WHERE sce.course_definition_id = ? AND spr.is_passed = 1
          GROUP BY sce.course_name, spr.enrollment_id
          HAVING COUNT(*) >= ?
        `).all(defId, totalPhases);
        for (const r of rows) {
          courseCompletedMap.set(r.course_name, (courseCompletedMap.get(r.course_name) || 0) + 1);
        }
      }

      // Pre-query admitted student counts per course
      const admittedRows = db.prepare(`
        SELECT course_name, COUNT(DISTINCT user_id) as count
        FROM student_course_enrollments
        GROUP BY course_name
      `).all();
      const admittedMap = new Map(admittedRows.map(r => [r.course_name, r.count]));

      // Pre-query filmmaking stats
      const filmmakingStatsRows = db.prepare(`
        SELECT
          course_name,
          COUNT(DISTINCT CASE WHEN step1_completed = 1 THEN user_id END) as totalAdmitted,
          COUNT(DISTINCT CASE WHEN step1_completed = 1 AND attendance_total > 0 AND (CAST(attendance_classes AS REAL) / CAST(attendance_total AS REAL)) >= 0.8 THEN user_id END) as classAttendance1stPhase,
          COUNT(DISTINCT CASE WHEN step1_completed = 1 AND (attendance_total = 0 OR (CAST(attendance_classes AS REAL) / CAST(attendance_total AS REAL)) < 0.8) THEN user_id END) as classAttendance1stPhaseNotQualified,
          COUNT(DISTINCT CASE WHEN step1_completed = 1 AND assignment_screenplay > 0 THEN user_id END) as screenplayCount,
          COUNT(DISTINCT CASE WHEN step1_completed = 1 AND assignment_shooting_script > 0 THEN user_id END) as shootingScriptCount,
          COUNT(DISTINCT CASE WHEN step2_completed = 1 THEN user_id END) as passedPhase1Exam,
          COUNT(DISTINCT CASE WHEN step2_completed = 1 THEN user_id END) as completedPhase1,
          COUNT(DISTINCT CASE WHEN step3_completed = 1 THEN user_id END) as totalAdmittedPhase2,
          COUNT(DISTINCT CASE WHEN step3_completed = 1 AND phase2_shooting_attended = 1 THEN user_id END) as shootingAttendedCount,
          COUNT(DISTINCT CASE WHEN step3_completed = 1 AND phase2_editing_attended = 1 THEN user_id END) as editingAttendedCount,
          COUNT(DISTINCT CASE WHEN step4_completed = 1 THEN user_id END) as completedPhase2,
          COUNT(DISTINCT CASE WHEN step4_completed = 1 THEN user_id END) as submittedFilm
        FROM student_course_enrollments
        GROUP BY course_name
      `).all();
      const filmmakingMap = new Map(filmmakingStatsRows.map(r => [r.course_name, r]));

      // Pre-query short courses stats
      const shortCourseStatsRows = db.prepare(`
        SELECT
          course_name,
          COUNT(DISTINCT CASE WHEN step1_completed = 1 THEN user_id END) as totalAdmitted,
          COUNT(DISTINCT CASE WHEN step4_completed = 1 THEN user_id END) as completedCourse
        FROM student_course_enrollments
        GROUP BY course_name
      `).all();
      const shortCourseMap = new Map(shortCourseStatsRows.map(r => [r.course_name, r]));

      const coursesStats = activeCourses.map(c => {
        const courseName = c.course_name;
        const courseType = c.course_type;
        const courseDefId = c.course_definition_id;

        if (courseDefId) {
          const defRow = defDetailsMap.get(courseDefId);
          const parsedDef = defRow?.parsed;
          const totalAdmitted = admittedMap.get(courseName) || 0;

          const phasesList = parsedDef?.phases || [];
          const definedPhases = phasesList.map((phase, pIdx) => {
            const phaseId = phase.id || `p_${pIdx + 1}`;
            const phaseNum = pIdx + 1;
            const statRow = phaseStatsMap.get(`${courseName}:::${phaseId}`);

            return {
              phaseNumber: phaseNum,
              phaseName: phase.title || `Phase ${phaseNum}`,
              studentsEvaluated: statRow?.students_evaluated || 0,
              passedCount: statRow?.passed_count || 0,
              avgAttendance: Math.round(statRow?.avg_attendance || 0),
              totalAssignmentsCompleted: statRow?.total_assignments_completed || 0
            };
          });

          const completedCourse = courseCompletedMap.get(courseName) || 0;

          return {
            courseName,
            courseType,
            isDefined: true,
            courseDefinitionId: courseDefId,
            stats: {
              totalAdmitted,
              completedCourse,
              definedPhases
            }
          };
        }

        if (courseType === 'filmmaking') {
          const stats = filmmakingMap.get(courseName) || {
            totalAdmitted: 0,
            classAttendance1stPhase: 0,
            classAttendance1stPhaseNotQualified: 0,
            screenplayCount: 0,
            shootingScriptCount: 0,
            passedPhase1Exam: 0,
            completedPhase1: 0,
            totalAdmittedPhase2: 0,
            shootingAttendedCount: 0,
            editingAttendedCount: 0,
            completedPhase2: 0,
            submittedFilm: 0
          };
          return {
            courseName,
            courseType,
            stats
          };
        } else {
          const stats = shortCourseMap.get(courseName) || {
            totalAdmitted: 0,
            completedCourse: 0
          };
          return {
            courseName,
            courseType,
            stats
          };
        }
      });

      const totalAdmittedPhase2Count = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM student_course_enrollments WHERE step3_completed = 1`).get().count || 0;

      return {
        totalRegistered: totalRegistered.count || 0,
        totalAdmitted: enrolledUserIds.size,
        currentlyEnrolled: enrolledUserIds.size,
        passedPhase1Exam: passedPhase1UserIds.size,
        failedOrDropped,
        completedPhase1: passedPhase1UserIds.size,
        totalAdmittedPhase2: totalAdmittedPhase2Count,
        completedPhase2: certificatesIssued.count || 0,
        submittedFilm: certificatesIssued.count || 0,
        certificatesIssued: certificatesIssued.count || 0,
        institute: {
          totalRegistered: totalRegistered.count || 0,
          totalAdmittedEnrolled: enrolledUserIds.size,
          totalPassed,
          failedOrDropped,
          certificatesIssued: certificatesIssued.count || 0
        },
        courses: coursesStats
      };
    });

    res.json(data);
  } catch (error) {
    console.error('[Analytics] /stats error:', error);
    res.status(500).json({ error: 'Failed to fetch institute stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
router.get('/students/all', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        sp.gender,
        u.created_at AS registration_date
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.role = 'student'
      ORDER BY datetime(u.created_at) DESC, u.id DESC
    `).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/all error:', error);
    res.status(500).json({ error: 'Failed to fetch registered students' });
  }
});

// GET /api/analytics/students/attendance
router.get('/students/attendance', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        sce.id AS enrollment_id,
        sce.user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        sce.attendance_classes,
        sce.attendance_total
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step1_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      ORDER BY u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    const mapped = rows.map(r => {
      const total = r.attendance_total != null ? r.attendance_total : 22;
      const attended = r.attendance_classes != null ? r.attendance_classes : 0;
      const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
      const status = pct >= 80 ? 'Qualified' : 'Not Qualified';
      return {
        ...r,
        attendance_percentage: pct,
        attendance_status: status
      };
    });
    res.json(mapped);
  } catch (error) {
    console.error('[Analytics] /students/attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch student attendance list' });
  }
});

// GET /api/analytics/students/assignments
router.get('/students/assignments', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        sce.id AS enrollment_id,
        sce.user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        sce.assignment_screenplay,
        sce.assignment_shooting_script
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step1_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      ORDER BY u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch student assignments list' });
  }
});

// GET /api/analytics/students/phase2-attendance
router.get('/students/phase2-attendance', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        sce.id AS enrollment_id,
        sce.user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        sce.phase2_shooting_attended,
        sce.phase2_editing_attended
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step3_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      ORDER BY u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/phase2-attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch student phase 2 attendance list' });
  }
});

// GET /api/analytics/students/admitted
router.get('/students/admitted', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        MAX(sce.updated_at) AS admitted_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step1_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      GROUP BY u.id
      ORDER BY datetime(admitted_date) DESC, u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/admitted error:', error);
    res.status(500).json({ error: 'Failed to fetch admitted students' });
  }
});

// GET /api/analytics/students/admitted-phase2
router.get('/students/admitted-phase2', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        MAX(sce.updated_at) AS admitted_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step3_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      GROUP BY u.id
      ORDER BY datetime(admitted_date) DESC, u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/admitted-phase2 error:', error);
    res.status(500).json({ error: 'Failed to fetch admitted phase 2 students' });
  }
});

// GET /api/analytics/students/enrolled
router.get('/students/enrolled', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        sce.id AS enrollment_id,
        sce.user_id,
        sce.course_name,
        sce.course_type,
        sce.step1_completed,
        sce.fee_details,
        sce.created_at AS enrolled_date,
        u.first_name,
        u.last_name,
        sp.student_id,
        sp.batch_number
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      ${course ? 'WHERE sce.course_name = ?' : ''}
    `;
    const rawEnrollments = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();

    const enrolledMap = new Map();

    for (const e of rawEnrollments) {
      let isEnrolled = false;
      const feeDetails = parseFeeDetails(e.fee_details);
      const status = getFeeStatus(feeDetails, e.course_type);
      const hasPaid = status === 'paid' || status === 'partial';

      if (e.course_definition_id) {
        isEnrolled = true;
      } else if (e.course_name === 'Online Filmmaking Course') {
        if (e.step1_completed === 1) isEnrolled = true;
      } else {
        if (hasPaid) isEnrolled = true;
      }

      if (isEnrolled) {
        if (!enrolledMap.has(e.user_id)) {
          enrolledMap.set(e.user_id, {
            user_id: e.user_id,
            first_name: e.first_name,
            last_name: e.last_name,
            name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
            student_id: e.student_id,
            batch_number: e.batch_number,
            course_name: new Set([e.course_name]),
            enrolled_date: e.enrolled_date
          });
        } else {
          const student = enrolledMap.get(e.user_id);
          student.course_name.add(e.course_name);
          if (new Date(e.enrolled_date) < new Date(student.enrolled_date)) {
            student.enrolled_date = e.enrolled_date;
          }
        }
      }
    }

    const rows = Array.from(enrolledMap.values()).map(s => ({
      ...s,
      course_name: Array.from(s.course_name).join(', ')
    })).sort((a, b) => new Date(b.enrolled_date) - new Date(a.enrolled_date));

    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/enrolled error:', error);
    res.status(500).json({ error: 'Failed to fetch enrolled students' });
  }
});

// GET /api/analytics/students/passed-exam
router.get('/students/passed-exam', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        MAX(sce.exam_written) AS exam_score,
        MAX(sce.updated_at) AS pass_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step2_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      GROUP BY u.id
      ORDER BY datetime(pass_date) DESC, u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/passed-exam error:', error);
    res.status(500).json({ error: 'Failed to fetch students who passed' });
  }
});

// GET /api/analytics/students/failed-exam
router.get('/students/failed-exam', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        GROUP_CONCAT(DISTINCT sce.course_name) AS course_name,
        u.created_at AS registration_date
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id
      WHERE u.role = 'student'
        AND NOT EXISTS (
          SELECT 1
          FROM student_course_enrollments passed
          WHERE passed.user_id = u.id AND passed.step2_completed = 1
        )
      GROUP BY u.id
      ORDER BY datetime(u.created_at) DESC, u.id DESC
    `).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/failed-exam error:', error);
    res.status(500).json({ error: 'Failed to fetch students who did not pass' });
  }
});

// GET /api/analytics/students/completed-phase1
router.get('/students/completed-phase1', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        MAX(sce.updated_at) AS completion_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step2_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      GROUP BY u.id
      ORDER BY datetime(completion_date) DESC, u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/completed-phase1 error:', error);
    res.status(500).json({ error: 'Failed to fetch Phase 1 completions' });
  }
});

// GET /api/analytics/students/completed-phase2
router.get('/students/completed-phase2', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        MAX(sce.updated_at) AS completion_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step3_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      GROUP BY u.id
      ORDER BY datetime(completion_date) DESC, u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/completed-phase2 error:', error);
    res.status(500).json({ error: 'Failed to fetch Phase 2 completions' });
  }
});

// GET /api/analytics/students/submitted-film
router.get('/students/submitted-film', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        MAX(sce.updated_at) AS submission_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step3_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      GROUP BY u.id
      ORDER BY datetime(submission_date) DESC, u.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /students/submitted-film error:', error);
    res.status(500).json({ error: 'Failed to fetch film submissions' });
  }
});

// GET /api/analytics/students/certificates-issued
router.get('/students/certificates-issued', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const course = req.query.course;
    const queryStr = `
      SELECT
        sce.id AS enrollment_id,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        sp.student_id,
        sp.batch_number,
        sce.course_name,
        sce.updated_at AS issued_date
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE sce.step4_completed = 1 ${course ? 'AND sce.course_name = ?' : ''}
      ORDER BY datetime(sce.updated_at) DESC, sce.id DESC
    `;
    const rows = course ? db.prepare(queryStr).all(course) : db.prepare(queryStr).all();

    const rowsWithDownloads = rows.map(r => {
      const downloads = db.prepare(`
        SELECT downloaded_at FROM certificate_downloads
        WHERE user_id = ? AND course_name = ?
        ORDER BY datetime(downloaded_at) DESC
      `).all(r.user_id, r.course_name);
      return {
        ...r,
        downloads,
        downloads_count: downloads.length
      };
    });

    res.json(rowsWithDownloads);
  } catch (error) {
    console.error('[Analytics] /students/certificates-issued error:', error);
    res.status(500).json({ error: 'Failed to fetch issued certificates' });
  }
});

// GET /api/analytics/students-per-batch
// Returns grouped bar chart data: total enrolled vs. completed per batch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/students-per-batch', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        sp.batch_number,
        COUNT(DISTINCT sp.user_id) as total_enrolled,
        COUNT(DISTINCT CASE WHEN sce.step4_completed = 1 THEN sp.user_id END) as completed
      FROM student_profiles sp
      LEFT JOIN student_course_enrollments sce ON sce.user_id = sp.user_id
      WHERE sp.batch_number IS NOT NULL AND sp.batch_number != ''
      GROUP BY sp.batch_number
      ORDER BY CAST(sp.batch_number AS INTEGER) ASC
    `).all();

    const data = rows.map(row => ({
      batch: row.batch_number ? `${row.batch_number}th` : 'N/A',
      batchRaw: row.batch_number,
      totalEnrolled: row.total_enrolled || 0,
      completed: row.completed || 0,
    }));

    res.json(data);
  } catch (error) {
    console.error('[Analytics] /students-per-batch error:', error);
    res.status(500).json({ error: 'Failed to fetch batch data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/funnel
// Returns funnel chart data: Registered → Admitted → Exam Passed → Phase 2 → Film → Certified
// ─────────────────────────────────────────────────────────────────────────────
router.get('/funnel', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const registered = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`).get();
    const admitted = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM student_course_enrollments WHERE step1_completed = 1`).get();
    const examPassed = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM student_course_enrollments WHERE step2_completed = 1`).get();
    const phase2 = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM student_course_enrollments WHERE step3_completed = 1`).get();
    const filmSubmitted = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM student_course_enrollments WHERE step3_completed = 1`).get();
    const certified = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM student_course_enrollments WHERE step4_completed = 1`).get();

    res.json([
      { stage: 'Registered', value: registered.count || 0 },
      { stage: 'Admitted', value: admitted.count || 0 },
      { stage: 'Exam Passed', value: examPassed.count || 0 },
      { stage: 'Phase 2', value: phase2.count || 0 },
      { stage: 'Film Submitted', value: filmSubmitted.count || 0 },
      { stage: 'Certified', value: certified.count || 0 },
    ]);
  } catch (error) {
    console.error('[Analytics] /funnel error:', error);
    res.status(500).json({ error: 'Failed to fetch funnel data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/fee-status
// Returns pie chart data + totals from fee_details JSON
// ─────────────────────────────────────────────────────────────────────────────
router.get('/fee-status', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const enrollments = db.prepare(`
      SELECT sce.fee_details, sce.course_type, sce.course_name, sce.course_definition_id, sce.batch_id, sp.batch_number
      FROM student_course_enrollments sce
      LEFT JOIN student_profiles sp ON sp.user_id = sce.user_id
    `).all();

    let paid = 0, partial = 0, unpaid = 0;
    let totalGrossAmount = 0, totalDiscountAmount = 0, totalNetPayable = 0;
    let collectedAmount = 0, outstandingAmount = 0;

    for (const row of enrollments) {
      const feeDetails = parseFeeDetails(row.fee_details);
      const batchFee = getBatchFee(row.course_name, row.batch_number, db, row.batch_id);
      const feeOpts = {
        courseDefId: row.course_definition_id,
        courseName: row.course_name,
        batchNumber: row.batch_number,
        batchId: row.batch_id
      };
      const status = getFeeStatus(feeDetails, row.course_type, batchFee, feeOpts);
      const amounts = extractFeeAmounts(feeDetails, row.course_type, batchFee, feeOpts);

      if (status === 'paid') paid++;
      else if (status === 'partial') partial++;
      else unpaid++;

      totalGrossAmount += amounts.gross;
      totalDiscountAmount += amounts.discount;
      totalNetPayable += amounts.netPayable;
      collectedAmount += amounts.collected;
      outstandingAmount += amounts.outstanding;
    }

    res.json({
      slices: [
        { name: 'Fully Paid', value: paid, color: '#22c55e' },
        { name: 'Partially Paid', value: partial, color: '#f59e0b' },
        { name: 'Unpaid', value: unpaid, color: '#ef4444' },
      ],
      totalAmount: Math.round(totalGrossAmount),
      grossAmount: Math.round(totalGrossAmount),
      discountAmount: Math.round(totalDiscountAmount),
      netPayable: Math.round(totalNetPayable),
      collectedAmount: Math.round(collectedAmount),
      outstandingAmount: Math.round(outstandingAmount),
    });
  } catch (error) {
    console.error('[Analytics] /fee-status error:', error);
    res.status(500).json({ error: 'Failed to fetch fee status data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/login-activity
// Returns last 30 days of unique student login counts per day
// ─────────────────────────────────────────────────────────────────────────────
router.get('/login-activity', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        DATE(last_login) as login_date,
        COUNT(*) as count
      FROM users
      WHERE role = 'student'
        AND last_login IS NOT NULL
        AND last_login >= DATE('now', '-30 days')
      GROUP BY DATE(last_login)
      ORDER BY login_date ASC
    `).all();

    // Build a full 30-day series, filling gaps with 0
    const today = new Date();
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const match = rows.find(r => r.login_date === dateStr);
      series.push({
        date: dateStr,
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        logins: match ? match.count : 0,
      });
    }

    res.json(series);
  } catch (error) {
    console.error('[Analytics] /login-activity error:', error);
    res.status(500).json({ error: 'Failed to fetch login activity' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/recent-activity
// Returns the last 15 notable platform events
// ─────────────────────────────────────────────────────────────────────────────
router.get('/recent-activity', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const events = [];

    // New student registrations (most recent 5)
    const newStudents = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.created_at
      FROM users u
      WHERE u.role = 'student'
      ORDER BY u.created_at DESC
      LIMIT 5
    `).all();
    for (const s of newStudents) {
      events.push({
        type: 'student_registered',
        icon: 'UserPlus',
        color: '#38bdf8',
        description: `${s.first_name} ${s.last_name} registered as a new student`,
        timestamp: s.created_at,
      });
    }

    // Certificates issued (step4_completed = 1, recent)
    const certs = db.prepare(`
      SELECT sce.updated_at, u.first_name, u.last_name, sce.course_name
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      WHERE sce.step4_completed = 1
      ORDER BY sce.updated_at DESC
      LIMIT 5
    `).all();
    for (const c of certs) {
      events.push({
        type: 'certificate_issued',
        icon: 'Award',
        color: '#f59e0b',
        description: `Certificate issued to ${c.first_name} ${c.last_name} for ${c.course_name}`,
        timestamp: c.updated_at,
      });
    }

    // Bulk imports
    const imports = db.prepare(`
      SELECT id, filename, batch_number, created_at
      FROM bulk_import_history
      ORDER BY created_at DESC
      LIMIT 3
    `).all();
    for (const imp of imports) {
      events.push({
        type: 'bulk_import',
        icon: 'FileSpreadsheet',
        color: '#a78bfa',
        description: `Bulk import completed for Batch ${imp.batch_number || 'N/A'} (${imp.filename || 'file'})`,
        timestamp: imp.created_at,
      });
    }

    // New announcements
    const announcements = db.prepare(`
      SELECT id, title, created_at
      FROM announcements
      ORDER BY created_at DESC
      LIMIT 4
    `).all();
    for (const a of announcements) {
      events.push({
        type: 'announcement',
        icon: 'Megaphone',
        color: '#f97316',
        description: `New announcement published: "${a.title}"`,
        timestamp: a.created_at,
      });
    }

    // Sort all events by timestamp descending and take top 15
    events.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

    res.json(events.slice(0, 15));
  } catch (error) {
    console.error('[Analytics] /recent-activity error:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/pending-certificates
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pending-certificates', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    res.json(getPendingCertificateRows());
  } catch (error) {
    console.error('[Analytics] /pending-certificates error:', error);
    res.status(500).json({ error: 'Failed to fetch pending certificates' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/inactive-students
// ─────────────────────────────────────────────────────────────────────────────
router.get('/inactive-students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().split('T')[0];

    const rows = db.prepare(`
      SELECT 
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.last_login,
        sp.student_id,
        sp.batch_number
      FROM users u
      JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.role = 'student'
        AND (u.last_login IS NULL OR u.last_login < ?)
      ORDER BY u.last_login ASC
    `).all(cutoff);
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /inactive-students error:', error);
    res.status(500).json({ error: 'Failed to fetch inactive students' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/failed-students
// ─────────────────────────────────────────────────────────────────────────────
router.get('/failed-students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        u.id as user_id,
        u.first_name,
        u.last_name,
        sp.student_id,
        sp.batch_number,
        (
          SELECT GROUP_CONCAT(course_name, ', ') 
          FROM student_course_enrollments 
          WHERE user_id = u.id
        ) as enrolled_courses
      FROM users u
      JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.role = 'student'
        AND NOT EXISTS (
          SELECT 1 
          FROM student_course_enrollments 
          WHERE user_id = u.id AND step2_completed = 1
        )
      ORDER BY sp.student_id ASC
    `).all();
    res.json(rows);
  } catch (error) {
    console.error('[Analytics] /failed-students error:', error);
    res.status(500).json({ error: 'Failed to fetch failed students' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/missing-attendance
// ─────────────────────────────────────────────────────────────────────────────
router.get('/missing-attendance', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    res.json(getMissingAttendanceRows());
  } catch (error) {
    console.error('[Analytics] /missing-attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch missing attendance' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/unpaid-students
// ─────────────────────────────────────────────────────────────────────────────
router.get('/unpaid-students', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const targetStatus = req.query.status || 'unpaid';
    const enrollments = db.prepare(`
      SELECT 
        sce.id as enrollment_id,
        sce.user_id,
        sce.course_name,
        sce.course_type,
        sce.course_name,
        sce.course_definition_id,
        sce.batch_id,
        sce.fee_details,
        u.first_name,
        u.last_name,
        sp.student_id,
        sp.batch_number
      FROM student_course_enrollments sce
      JOIN users u ON u.id = sce.user_id
      JOIN student_profiles sp ON sp.user_id = u.id
    `).all();

    const unpaidStudents = [];
    for (const row of enrollments) {
      const feeDetails = parseFeeDetails(row.fee_details);
      const batchFee = getBatchFee(row.course_name, row.batch_number, db, row.batch_id);
      const feeOpts = {
        courseDefId: row.course_definition_id,
        courseName: row.course_name,
        batchNumber: row.batch_number,
        batchId: row.batch_id
      };
      const status = getFeeStatus(feeDetails, row.course_type, batchFee, feeOpts);
      if (status === targetStatus) {
        const amounts = extractFeeAmounts(feeDetails, row.course_type, batchFee, feeOpts);
        const p1Res = resolvePhaseFee({
          feeDetailsRaw: feeDetails,
          phaseIndex: 0,
          courseDefId: row.course_definition_id,
          courseName: row.course_name,
          courseType: row.course_type,
          batchNumber: row.batch_number,
          batchId: row.batch_id,
          batchFee
        });
        const p2Res = resolvePhaseFee({
          feeDetailsRaw: feeDetails,
          phaseIndex: 1,
          courseDefId: row.course_definition_id,
          courseName: row.course_name,
          courseType: row.course_type,
          batchNumber: row.batch_number,
          batchId: row.batch_id,
          batchFee
        });
        unpaidStudents.push({
          enrollment_id: row.enrollment_id,
          user_id: row.user_id,
          course_name: row.course_name,
          first_name: row.first_name,
          last_name: row.last_name,
          student_id: row.student_id,
          batch_number: row.batch_number,
          phase1_fee: Math.round(p1Res.grossFee),
          phase2_fee: Math.round(p2Res.grossFee),
          total_due: Math.round(amounts.outstanding),
          cash_collected: Math.round(amounts.collected),
          gross_fee: Math.round(amounts.gross)
        });
      }
    }
    res.json(unpaidStudents);
  } catch (error) {
    console.error('[Analytics] /unpaid-students error:', error);
    res.status(500).json({ error: 'Failed to fetch unpaid students' });
  }
});

export default router;
