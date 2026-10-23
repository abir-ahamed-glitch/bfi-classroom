import express from 'express';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * Resolves the authorized batch IDs and legacy scopes for a staff user (admin, moderator, instructor, teacher).
 * Enforces identical unambiguous batch identity and assignment rules as /batchmates.
 */
export function getStaffAuthorizedBatchAccess(user, customDb = db) {
  if (user.role === 'admin') {
    return { isAdmin: true, batchIds: [], legacyScopes: [] };
  }

  const batchIds = new Set();
  const legacyScopes = []; // Array of { course_name, batch_number, batch_id }

  // 1. Batches where staff member is creator
  const createdBatches = customDb.prepare(`
    SELECT id, course_name, batch_number, course_definition_id
    FROM batches
    WHERE created_by = ? AND deleted_at IS NULL
  `).all(user.id);
  for (const b of createdBatches) {
    batchIds.add(b.id);
  }

  // 2. Batches where staff member is assigned in batch_moderators
  const modBatches = customDb.prepare(`
    SELECT b.id, b.course_name, b.batch_number, b.course_definition_id
    FROM batches b
    JOIN batch_moderators bm ON bm.batch_id = b.id
    WHERE bm.user_id = ? AND b.deleted_at IS NULL
  `).all(user.id);
  for (const b of modBatches) {
    batchIds.add(b.id);
  }

  // 3. For instructor/teacher: instructor_profiles.bfi_batch
  if (user.role === 'instructor' || user.role === 'teacher') {
    const profile = customDb.prepare('SELECT bfi_batch FROM instructor_profiles WHERE user_id = ?').get(user.id);
    if (profile && profile.bfi_batch) {
      const b = profile.bfi_batch.trim();

      // 3a. Clearly typed identifier: e.g. "batch_id:123" or "id:123"
      const typedMatch = b.match(/^(?:batch_id|id)\s*:\s*(\d+)$/i);
      if (typedMatch) {
        const parsedId = parseInt(typedMatch[1], 10);
        const batchById = customDb.prepare(`
          SELECT id, course_name, batch_number, course_definition_id
          FROM batches
          WHERE id = ? AND deleted_at IS NULL
        `).get(parsedId);
        if (batchById) {
          batchIds.add(batchById.id);
        }
      } else {
        // 3b. Untyped string: Treated strictly as a batch_number or batch_name across active batches.
        // Never inferred as a database row ID.
        const matches = customDb.prepare(`
          SELECT id, course_name, batch_number, course_definition_id
          FROM batches
          WHERE (TRIM(batch_number) = ? OR TRIM(batch_name) = ?)
            AND deleted_at IS NULL
        `).all(b, b);

        if (matches.length === 1) {
          // Unambiguous match across ALL active batches in the system
          batchIds.add(matches[0].id);
        } else if (matches.length > 1) {
          // Ambiguous across multiple active batches (defined, legacy, or colliding numbers).
          // Deny access completely — do NOT fall back to legacy.
        } else {
          // matches.length === 0: Check if this references an unlinked legacy cohort without a batches table row
          const unlinkedCourses = customDb.prepare(`
            SELECT DISTINCT c.course_name
            FROM student_course_enrollments c
            JOIN student_profiles p ON p.user_id = c.user_id
            WHERE TRIM(p.batch_number) = ?
              AND c.batch_id IS NULL
              AND c.course_definition_id IS NULL
          `).all(b);

          if (unlinkedCourses.length === 1) {
            legacyScopes.push({
              course_name: unlinkedCourses[0].course_name,
              batch_number: b,
              batch_id: null
            });
          }
        }
      }
    }
  }

  // 4. Determine legacyScopes for any authorized legacy batches in batchIds:
  // For each authorized batchId, if it has course_definition_id IS NULL:
  // Allow a name/number legacy scope ONLY if (course_name, batch_number) is UNAMBIGUOUS across active batches
  if (batchIds.size > 0) {
    const placeholders = Array.from(batchIds).map(() => '?').join(',');
    const authorizedBatches = customDb.prepare(`
      SELECT id, course_name, batch_number, course_definition_id
      FROM batches
      WHERE id IN (${placeholders})
    `).all(...batchIds);

    for (const ab of authorizedBatches) {
      if (!ab.course_definition_id && ab.course_name && ab.batch_number) {
        const matchingBatches = customDb.prepare(`
          SELECT id FROM batches
          WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?))
            AND TRIM(batch_number) = TRIM(?)
            AND deleted_at IS NULL
        `).all(ab.course_name, ab.batch_number);

        if (matchingBatches.length === 1) {
          if (!legacyScopes.some(s => s.course_name.trim().toLowerCase() === ab.course_name.trim().toLowerCase() && String(s.batch_number).trim() === String(ab.batch_number).trim())) {
            legacyScopes.push({
              course_name: ab.course_name,
              batch_number: ab.batch_number,
              batch_id: ab.id
            });
          }
        }
      }
    }
  }

  return {
    isAdmin: false,
    batchIds: Array.from(batchIds),
    legacyScopes
  };
}

// GET /api/registry/my-courses (For students to see their courses and batches)
router.get('/my-courses', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const profile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
    const batch_number = profile?.batch_number;

    const enrollments = db.prepare(`
      SELECT c.course_name, c.batch_id, c.course_definition_id,
             b.batch_number, b.batch_name
      FROM student_course_enrollments c
      LEFT JOIN batches b ON c.batch_id = b.id
      WHERE c.user_id = ?
    `).all(req.user.id);

    res.json({
      courses: enrollments.map(e => e.course_name),
      batch_number,
      enrollments: enrollments.map(e => ({
        course_name: e.course_name,
        batch_id: e.batch_id,
        course_definition_id: e.course_definition_id,
        batch_number: e.batch_number || batch_number,
        batch_name: e.batch_name
      }))
    });
  } catch (error) {
    console.error('Registry my-courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/batchmates?course_name=...&batch_number=...&batch_id=...
router.get('/batchmates', authenticateToken, (req, res) => {
  try {
    const { course_name, batch_number, batch_id } = req.query;
    const user = req.user;

    let batchmates;
    if (batch_id) {
      const parsedBatchId = parseInt(batch_id, 10);
      if (isNaN(parsedBatchId)) {
        return res.status(400).json({ error: 'Invalid batch_id' });
      }

      const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(parsedBatchId);
      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      // Check role authorization
      if (user.role === 'admin') {
        // Admin retains legitimate institutional access
      } else if (user.role === 'moderator' || user.role === 'instructor' || user.role === 'teacher') {
        const auth = getStaffAuthorizedBatchAccess(user, db);
        if (!auth.isAdmin && !auth.batchIds.includes(parsedBatchId)) {
          return res.status(403).json({ error: 'Access denied: You are not assigned to this batch or legacy assignment is ambiguous' });
        }
      } else if (user.role === 'student') {
        const isEnrolled = db.prepare(`
          SELECT 1 FROM student_course_enrollments 
          WHERE user_id = ? AND batch_id = ?
          UNION
          SELECT 1 FROM batch_students 
          WHERE student_id = ? AND batch_id = ?
        `).get(user.id, parsedBatchId, user.id, parsedBatchId);

        if (!isEnrolled) {
          return res.status(403).json({ error: 'Access denied: You are not authorized to view batchmates for this batch' });
        }
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }

      batchmates = db.prepare(`
        SELECT DISTINCT
          u.id, u.first_name, u.last_name, u.profile_picture, u.email,
          COALESCE(b.batch_number, p.batch_number) AS batch_number, p.bio, p.bfiaa_member, p.full_name, p.profession
        FROM users u
        LEFT JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN batches b ON b.id = ?
        WHERE u.role = 'student' AND u.is_active = 1 
          AND (
            EXISTS (SELECT 1 FROM student_course_enrollments c WHERE c.user_id = u.id AND c.batch_id = ?)
            OR EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id = u.id AND bs.batch_id = ?)
          )
        ORDER BY u.first_name ASC
      `).all(parsedBatchId, parsedBatchId, parsedBatchId);
    } else {
      if (!course_name || !batch_number) {
        return res.status(400).json({ error: 'Missing course or batch' });
      }

      if (user.role === 'student') {
        // Defined enrollments MUST provide batch_id and cannot use legacy query parameters
        const hasDefinedEnrollment = db.prepare(`
          SELECT 1 FROM student_course_enrollments c
          LEFT JOIN batches b ON b.id = c.batch_id
          WHERE c.user_id = ?
            AND LOWER(TRIM(c.course_name)) = LOWER(TRIM(?))
            AND (c.course_definition_id IS NOT NULL OR b.course_definition_id IS NOT NULL)
        `).get(user.id, course_name);

        if (hasDefinedEnrollment) {
          return res.status(400).json({ error: 'batch_id is required to view batchmates for defined courses' });
        }

        // Must have a genuinely unlinked legacy enrollment matching course_name and batch_number
        const isLegacyAuthorized = db.prepare(`
          SELECT 1
          FROM student_course_enrollments c
          JOIN student_profiles p ON p.user_id = c.user_id
          WHERE c.user_id = ?
            AND c.course_definition_id IS NULL
            AND c.batch_id IS NULL
            AND LOWER(TRIM(c.course_name)) = LOWER(TRIM(?))
            AND TRIM(p.batch_number) = TRIM(?)
        `).get(user.id, course_name, String(batch_number));

        if (!isLegacyAuthorized) {
          return res.status(403).json({ error: 'Access denied: You are not authorized to view batchmates for this course and batch' });
        }
      } else if (user.role === 'admin') {
        // Admin retains legitimate institutional access
      } else if (user.role === 'moderator' || user.role === 'instructor' || user.role === 'teacher') {
        const auth = getStaffAuthorizedBatchAccess(user, db);
        const isAuthorizedScope = !auth.isAdmin && auth.legacyScopes.some(
          s => s.course_name.trim().toLowerCase() === course_name.trim().toLowerCase() &&
               String(s.batch_number).trim() === String(batch_number).trim()
        );

        if (!auth.isAdmin && !isAuthorizedScope) {
          return res.status(403).json({ error: 'Access denied: You are not assigned to this batch or legacy assignment is ambiguous' });
        }
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Students in the genuinely unlinked legacy cohort
      batchmates = db.prepare(`
        SELECT DISTINCT
          u.id, u.first_name, u.last_name, u.profile_picture, u.email,
          p.batch_number, p.bio, p.bfiaa_member, p.full_name, p.profession
        FROM users u
        JOIN student_profiles p ON u.id = p.user_id
        JOIN student_course_enrollments c ON u.id = c.user_id
        WHERE u.role = 'student' AND u.is_active = 1 
          AND c.course_definition_id IS NULL
          AND c.batch_id IS NULL
          AND LOWER(TRIM(c.course_name)) = LOWER(TRIM(?))
          AND TRIM(p.batch_number) = TRIM(?)
        ORDER BY u.first_name ASC
      `).all(course_name, String(batch_number));
    }

    res.json({ batchmates });
  } catch (error) {
    console.error('Registry batchmates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/courses (For Admin/Teacher)
router.get('/courses', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const auth = getStaffAuthorizedBatchAccess(req.user, db);

    if (auth.isAdmin) {
      const courses = db.prepare(`
        SELECT DISTINCT course_name 
        FROM student_course_enrollments
        ORDER BY course_name ASC
      `).all();
      return res.json({ courses: courses.map(c => c.course_name) });
    }

    if (auth.batchIds.length === 0 && auth.legacyScopes.length === 0) {
      return res.json({ courses: [] });
    }

    const courseSet = new Set();

    if (auth.batchIds.length > 0) {
      const placeholders = auth.batchIds.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT DISTINCT course_name 
        FROM batches 
        WHERE id IN (${placeholders}) AND deleted_at IS NULL
      `).all(...auth.batchIds);
      for (const r of rows) {
        if (r.course_name) courseSet.add(r.course_name);
      }
    }

    for (const scope of auth.legacyScopes) {
      if (scope.course_name) courseSet.add(scope.course_name);
    }

    const courses = Array.from(courseSet).sort((a, b) => a.localeCompare(b));
    res.json({ courses });
  } catch (error) {
    console.error('Registry courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/batches?course_name=... (For Admin/Teacher)
router.get('/batches', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { course_name } = req.query;
    if (!course_name) return res.status(400).json({ error: 'Missing course' });

    const auth = getStaffAuthorizedBatchAccess(req.user, db);

    // 1. Batches from batches table (defined courses or tracked batches)
    let definedBatches = db.prepare(`
      SELECT b.id, b.batch_number, b.batch_name, b.course_definition_id
      FROM batches b
      WHERE LOWER(TRIM(b.course_name)) = LOWER(TRIM(?))
        AND b.deleted_at IS NULL
      ORDER BY b.batch_number ASC, b.id ASC
    `).all(course_name);

    if (!auth.isAdmin) {
      definedBatches = definedBatches.filter(b => auth.batchIds.includes(b.id));
    }

    // 2. Legacy unlinked batches from student profiles without a batch row
    let legacyBatches = [];
    if (auth.isAdmin) {
      legacyBatches = db.prepare(`
        SELECT DISTINCT p.batch_number
        FROM student_profiles p
        JOIN student_course_enrollments c ON p.user_id = c.user_id
        WHERE LOWER(TRIM(c.course_name)) = LOWER(TRIM(?))
          AND c.batch_id IS NULL
          AND c.course_definition_id IS NULL
          AND p.batch_number IS NOT NULL AND p.batch_number != ''
      `).all(course_name);
    } else {
      const matchingScopes = auth.legacyScopes.filter(s => s.course_name.trim().toLowerCase() === course_name.trim().toLowerCase());
      legacyBatches = matchingScopes.map(s => ({ batch_number: s.batch_number }));
    }

    const batchList = [];
    for (const b of definedBatches) {
      batchList.push({
        id: b.id,
        batch_number: b.batch_number,
        batch_name: b.batch_name || `Batch ${b.batch_number}`,
        course_definition_id: b.course_definition_id
      });
    }

    for (const lb of legacyBatches) {
      if (!batchList.some(b => b.batch_number === lb.batch_number)) {
        batchList.push({
          id: null,
          batch_number: lb.batch_number,
          batch_name: `${lb.batch_number} Batch`,
          course_definition_id: null
        });
      }
    }

    res.json({
      batches: batchList.map(b => b.batch_number),
      batch_list: batchList
    });
  } catch (error) {
    console.error('Registry batches error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/search?q=... (For Admin/Teacher to global search)
router.get('/search', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { q } = req.query;
    if (!q || q.trim() === '') {
      return res.json({ batchmates: [] });
    }

    const auth = getStaffAuthorizedBatchAccess(req.user, db);

    // Non-admin staff with no authorized batches cannot access any students
    if (!auth.isAdmin && auth.batchIds.length === 0 && auth.legacyScopes.length === 0) {
      return res.json({ batchmates: [] });
    }

    const searchQuery = `%${q}%`;

    let sql = `
      SELECT DISTINCT
        u.id, u.first_name, u.last_name, u.profile_picture, u.email,
        p.batch_number, p.bio, p.bfiaa_member, p.full_name, p.profession,
        (SELECT GROUP_CONCAT(c3.course_name, ', ') FROM student_course_enrollments c3 WHERE c3.user_id = u.id) as courses
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student' AND u.is_active = 1 
        AND (
          u.first_name LIKE ? OR 
          u.last_name LIKE ? OR 
          u.email LIKE ? OR 
          p.full_name LIKE ? OR 
          p.batch_number LIKE ?
        )
    `;

    const params = [searchQuery, searchQuery, searchQuery, searchQuery, searchQuery];

    if (!auth.isAdmin) {
      const batchConditions = [];

      if (auth.batchIds.length > 0) {
        const placeholders = auth.batchIds.map(() => '?').join(',');
        batchConditions.push(`
          EXISTS (
            SELECT 1 FROM student_course_enrollments c_auth 
            WHERE c_auth.user_id = u.id AND c_auth.batch_id IN (${placeholders})
          )
          OR EXISTS (
            SELECT 1 FROM batch_students bs_auth 
            WHERE bs_auth.student_id = u.id AND bs_auth.batch_id IN (${placeholders})
          )
        `);
        params.push(...auth.batchIds, ...auth.batchIds);
      }

      if (auth.legacyScopes.length > 0) {
        for (const scope of auth.legacyScopes) {
          batchConditions.push(`
            EXISTS (
              SELECT 1 FROM student_course_enrollments c_leg
              WHERE c_leg.user_id = u.id
                AND c_leg.course_definition_id IS NULL
                AND c_leg.batch_id IS NULL
                AND LOWER(TRIM(c_leg.course_name)) = LOWER(TRIM(?))
                AND TRIM(p.batch_number) = TRIM(?)
            )
          `);
          params.push(scope.course_name, scope.batch_number);
        }
      }

      if (batchConditions.length === 0) {
        return res.json({ batchmates: [] });
      }

      sql += ` AND (${batchConditions.join(' OR ')})`;
    }

    sql += ` ORDER BY u.first_name ASC LIMIT 50`;

    const batchmates = db.prepare(sql).all(...params);

    res.json({ batchmates });
  } catch (error) {
    console.error('Registry search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/registry/teachers (For Instructor Directory)
router.get('/teachers', authenticateToken, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_picture, u.email, u.role,
        p.subjects
      FROM users u
      LEFT JOIN instructor_profiles p ON u.id = p.user_id
      WHERE u.role = 'instructor' AND u.is_active = 1
      ORDER BY u.first_name ASC
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
    console.error('Registry teachers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
