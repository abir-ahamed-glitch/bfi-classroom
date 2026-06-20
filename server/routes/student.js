import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput, validatePassword, sensitiveEndpointLimiter } from '../middleware/auth.js';

const router = express.Router();

// Helper function to fetch user profile data (DRY - avoids duplicate queries)
function fetchUserProfileData(userId, includePrivateData = false) {
  const baseUser = db.prepare(`
    SELECT id, username, email, first_name, last_name, mobile_number, profile_picture, role 
    FROM users WHERE id = ?
  `).get(userId);
  
  if (!baseUser) return null;

  let profileData = {};
  if (baseUser.role === 'student') {
    const query = includePrivateData 
      ? `SELECT student_id, batch_number, full_name, gender, birthday, present_address, 
                permanent_address, educational_qualification, profession, whatsapp_number, bio, bfiaa_member,
                phase1_admitted, phase1_passed, phase2_admitted, phase2_completed,
                phase1_fee, phase2_fee
         FROM student_profiles WHERE user_id = ?`
      : `SELECT student_id, batch_number, full_name, gender, birthday, present_address, 
                permanent_address, educational_qualification, profession, whatsapp_number, bio, bfiaa_member,
                phase1_admitted, phase1_passed, phase2_admitted, phase2_completed
         FROM student_profiles WHERE user_id = ?`;
    profileData = db.prepare(query).get(userId) || {};
  } else if (baseUser.role === 'instructor') {
    profileData = db.prepare(`
      SELECT full_name, subjects, whatsapp_number, bio, gender, birthday, present_address, permanent_address, educational_qualification, profession, bfi_batch
      FROM instructor_profiles WHERE user_id = ?
    `).get(userId) || {};
  } else if (baseUser.role === 'admin') {
    profileData = db.prepare(`
      SELECT full_name, whatsapp_number, bio, gender, birthday, present_address, permanent_address, educational_qualification, profession
      FROM admin_profiles WHERE user_id = ?
    `).get(userId) || {};
  }

  return { baseUser, profileData };
}

// Get student or instructor profile
router.get('/profile', authenticateToken, (req, res) => {
  try {
    const data = fetchUserProfileData(req.user.id, true);
    
    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { baseUser, profileData } = data;
    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(req.user.id);
    const socialLinks = db.prepare('SELECT id, platform, url FROM social_links WHERE user_id = ?').all(req.user.id);
    const experiences = db.prepare('SELECT * FROM student_experiences WHERE user_id = ? ORDER BY start_date DESC').all(req.user.id);

    const privacyRows = db.prepare('SELECT field_name, visibility FROM profile_field_privacy WHERE user_id = ?').all(req.user.id);
    const privacySettings = {};
    for (const row of privacyRows) {
      privacySettings[row.field_name] = row.visibility;
    }

    res.json({ ...baseUser, ...profileData, enrollments, socialLinks, experiences, privacySettings });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get another user's profile
router.get('/profile/:userId', authenticateToken, sensitiveEndpointLimiter, (req, res) => {
  try {
    const targetUserId = req.params.userId;

    const data = fetchUserProfileData(targetUserId, false);
    
    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { baseUser, profileData } = data;
    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(targetUserId);
    const socialLinks = db.prepare('SELECT id, platform, url FROM social_links WHERE user_id = ?').all(targetUserId);
    const experiences = db.prepare('SELECT * FROM student_experiences WHERE user_id = ? ORDER BY start_date DESC').all(targetUserId);
    const portfolioQuery = db.prepare(`
      SELECT p.*,
        (SELECT json_group_array(json_object('role', role, 'name', name)) FROM project_credits WHERE project_id = p.id) as credits,
        (SELECT json_group_array(json_object('award_name', award_name, 'festival_name', festival_name, 'award_year', award_year)) FROM awards WHERE project_id = p.id) as awards
      FROM projects p
      WHERE user_id = ? AND privacy_setting = 'public'
      ORDER BY created_at DESC
    `).all(targetUserId);

    const portfolio = portfolioQuery.map(p => ({
      ...p,
      credits: p.credits ? JSON.parse(p.credits) : [],
      awards: p.awards ? JSON.parse(p.awards) : []
    }));

    // Fetch privacy settings for the target user
    const privacyRows = db.prepare('SELECT field_name, visibility FROM profile_field_privacy WHERE user_id = ?').all(targetUserId);
    const privacyMap = {};
    for (const row of privacyRows) {
      privacyMap[row.field_name] = row.visibility;
    }

    // Admin sees everything
    const isAdmin = req.user.role === 'admin';
    if (isAdmin) {
      return res.json({ ...baseUser, ...profileData, enrollments, socialLinks, experiences, portfolio });
    }

    // Check if viewer is a batchmate
    let isBatchmate = false;
    if (baseUser.role === 'student') {
      const targetProfile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(targetUserId);
      const viewerProfile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
      if (targetProfile && viewerProfile && targetProfile.batch_number && viewerProfile.batch_number) {
        // Check if they share any course enrollment
        const sharedCourse = db.prepare(`
          SELECT 1 FROM student_course_enrollments e1
          JOIN student_course_enrollments e2 ON e1.course_name = e2.course_name
          WHERE e1.user_id = ? AND e2.user_id = ? LIMIT 1
        `).get(targetUserId, req.user.id);
        if (sharedCourse && targetProfile.batch_number === viewerProfile.batch_number) {
          isBatchmate = true;
        }
      }
    }

    // Filter fields based on privacy
    const result = { ...baseUser, ...profileData, enrollments };
    const fieldsThatCanBePrivate = [
      'gender', 'birthday', 'present_address', 'permanent_address',
      'educational_qualification', 'profession', 'email', 'mobile_number',
      'whatsapp_number', 'bio'
    ];

    const fieldVisibility = {};
    for (const field of fieldsThatCanBePrivate) {
      const vis = privacyMap[field] || 'public';
      fieldVisibility[field] = vis;
      if (vis === 'only_me') {
        result[field] = null;
      } else if (vis === 'batchmates' && !isBatchmate) {
        result[field] = null;
      }
    }

    // Handle group-level privacy: social_links, experiences, portfolio
    const socialVis = privacyMap['social_links'] || 'public';
    fieldVisibility['social_links'] = socialVis;
    if (socialVis === 'only_me' || (socialVis === 'batchmates' && !isBatchmate)) {
      result.socialLinks = [];
    } else {
      result.socialLinks = socialLinks;
    }

    const expVis = privacyMap['experiences'] || 'public';
    fieldVisibility['experiences'] = expVis;
    if (expVis === 'only_me' || (expVis === 'batchmates' && !isBatchmate)) {
      result.experiences = [];
    } else {
      result.experiences = experiences;
    }

    const portfolioVis = privacyMap['portfolio'] || 'public';
    fieldVisibility['portfolio'] = portfolioVis;
    if (portfolioVis === 'only_me' || (portfolioVis === 'batchmates' && !isBatchmate)) {
      result.portfolio = [];
    } else {
      result.portfolio = portfolio;
    }

    result.fieldVisibility = fieldVisibility;
    res.json(result);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update student profile (editable fields)
router.put('/profile', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { 
      gender, birthday, present_address, permanent_address, educational_qualification, profession, bfi_batch,
      mobile_number, whatsapp_number, bio, socialLinks, profile_picture
    } = req.body;

    const transaction = db.transaction(() => {
      // Update users table (mobile and profile picture)
      if (mobile_number !== undefined) {
        db.prepare('UPDATE users SET mobile_number = ? WHERE id = ?').run(mobile_number, req.user.id);
      }
      if (profile_picture !== undefined) {
        db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?').run(profile_picture, req.user.id);
      }

      const userRole = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id)?.role;

      // Update specific profile
      if (userRole === 'student') {
        db.prepare(`
          UPDATE student_profiles 
          SET gender = ?, birthday = ?, present_address = ?, permanent_address = ?, educational_qualification = ?, profession = ?, whatsapp_number = ?, bio = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(gender, birthday, present_address, permanent_address, educational_qualification, profession, whatsapp_number, bio, req.user.id);
      } else if (userRole === 'instructor') {
        db.prepare(`
          UPDATE instructor_profiles 
          SET whatsapp_number = ?, bio = ?, gender = ?, birthday = ?, present_address = ?, permanent_address = ?, educational_qualification = ?, profession = ?, bfi_batch = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(whatsapp_number, bio, gender, birthday, present_address, permanent_address, educational_qualification, profession, bfi_batch, req.user.id);
      } else if (userRole === 'admin') {
        // Ensure admin profile exists first
        const exists = db.prepare('SELECT id FROM admin_profiles WHERE user_id = ?').get(req.user.id);
        if (exists) {
          db.prepare(`
            UPDATE admin_profiles 
            SET whatsapp_number = ?, bio = ?, gender = ?, birthday = ?, present_address = ?, permanent_address = ?, educational_qualification = ?, profession = ?, updated_at = datetime('now')
            WHERE user_id = ?
          `).run(whatsapp_number, bio, gender, birthday, present_address, permanent_address, educational_qualification, profession, req.user.id);
        } else {
          const userDetails = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(req.user.id);
          db.prepare(`
            INSERT INTO admin_profiles (user_id, full_name, whatsapp_number, bio, gender, birthday, present_address, permanent_address, educational_qualification, profession)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(req.user.id, `${userDetails.first_name} ${userDetails.last_name}`, whatsapp_number, bio, gender, birthday, present_address, permanent_address, educational_qualification, profession);
        }
      }

      // Update social links only when the caller intentionally sends them.
      if (Object.prototype.hasOwnProperty.call(req.body, 'socialLinks')) {
        db.prepare('DELETE FROM social_links WHERE user_id = ?').run(req.user.id);
      }
      if (Array.isArray(socialLinks)) {
        const insertSocial = db.prepare('INSERT INTO social_links (user_id, platform, url) VALUES (?, ?, ?)');
        for (const link of socialLinks) {
          if (link.platform && link.url) {
            insertSocial.run(req.user.id, link.platform, link.url);
          }
        }
      }
    });

    transaction();
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard Data (Recommended projects, stats, pinned content)
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    // 1. My pinned projects
    const pinnedProjects = db.prepare(`
      SELECT p.*, 
        (SELECT group_concat(role || ': ' || name, ', ') FROM project_credits WHERE project_id = p.id) as credits,
        (SELECT count(*) FROM awards WHERE project_id = p.id) as awards_count
      FROM projects p
      WHERE user_id = ? AND show_on_dashboard = 1
    `).all(req.user.id);

    // 2. Recommended Projects from others
    // Priorities: 1. Awards, 2. Full Length, 3. Short/Doc
    const recommendedProjects = db.prepare(`
      SELECT p.*, u.id as user_id, u.first_name, u.last_name, u.profile_picture,
        (SELECT count(*) FROM awards WHERE project_id = p.id) as awards_count
      FROM projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id != ? AND p.privacy_setting = 'public'
      ORDER BY awards_count DESC, p.created_at DESC
      LIMIT 6
    `).all(req.user.id);

    // 3. Stats Check
    let profile = null;
    let instructorProfile = null;
    if (req.user.role === 'instructor') {
      instructorProfile = db.prepare('SELECT subjects FROM instructor_profiles WHERE user_id = ?').get(req.user.id);
    } else {
      profile = db.prepare('SELECT batch_number, bfiaa_member, phase1_admitted, phase1_passed, phase2_admitted, phase2_completed FROM student_profiles WHERE user_id = ?').get(req.user.id);
    }

    // 4. Announcements (Global + Targeted)
    let batchFilter = null;
    if (profile && profile.batch_number) {
      batchFilter = profile.batch_number;
    } else if (instructorProfile && instructorProfile.bfi_batch) {
      batchFilter = instructorProfile.bfi_batch;
    }

    const announcements = db.prepare(`
      SELECT a.id, a.title, a.content, a.priority, a.target_course, a.target_batch, a.image_url, a.created_at, a.scheduled_at, u.first_name as admin_name
      FROM announcements a
      JOIN users u ON a.admin_id = u.id
      WHERE (
        a.visible_to_user_id = ? OR (
          a.visible_to_user_id IS NULL AND (
            (
              (a.target_course IS NULL OR a.target_course = '') AND (a.target_batch IS NULL OR a.target_batch = '')
            ) OR (
              (a.target_course IS NULL OR a.target_course = '' OR EXISTS (
                SELECT 1 FROM student_course_enrollments sce
                WHERE sce.user_id = ? AND sce.course_name = a.target_course
              ))
              AND (
                a.target_batch IS NULL OR a.target_batch = '' OR a.target_batch = ?
              )
            )
          )
        )
      ) AND (a.scheduled_at IS NULL OR datetime(a.scheduled_at) <= datetime('now'))
        AND a.created_at >= datetime('now', '-14 days')
      ORDER BY a.created_at DESC
      LIMIT 20
    `).all(req.user.id, req.user.id, batchFilter);

    // 5. Enrollments
    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(req.user.id);

    res.json({
      pinnedProjects,
      recommendedProjects,
      announcements,
      enrollments,
      stats: {
        batch: profile?.batch_number,
        isBfiaaMember: profile?.bfiaa_member === 1,
        subjects: instructorProfile?.subjects,
        phase1_admitted: profile?.phase1_admitted === 1,
        phase1_passed: profile?.phase1_passed === 1,
        phase2_admitted: profile?.phase2_admitted === 1,
        phase2_completed: profile?.phase2_completed === 1,
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all notices (dedicated endpoint for Notice Board)
router.get('/notices', authenticateToken, (req, res) => {
  try {
    let announcements;

    if (req.user.role === 'admin') {
      // Admins see all announcements
      announcements = db.prepare(`
        SELECT a.id, a.title, a.content, a.priority, a.target_course, a.target_batch, a.image_url, a.created_at, a.scheduled_at, u.first_name as admin_name
        FROM announcements a
        JOIN users u ON a.admin_id = u.id
        ORDER BY a.created_at DESC
        LIMIT 50
      `).all();
    } else {
      // Students/instructors see global + targeted announcements
      let batchFilter = null;
      if (req.user.role === 'student') {
        const profile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
        batchFilter = profile?.batch_number || null;
      } else if (req.user.role === 'instructor') {
        const ip = db.prepare('SELECT bfi_batch FROM instructor_profiles WHERE user_id = ?').get(req.user.id);
        batchFilter = ip?.bfi_batch || null;
      }

      announcements = db.prepare(`
        SELECT a.id, a.title, a.content, a.priority, a.target_course, a.target_batch, a.image_url, a.created_at, a.scheduled_at, u.first_name as admin_name
        FROM announcements a
        JOIN users u ON a.admin_id = u.id
        WHERE (
          a.visible_to_user_id = ? OR (
            a.visible_to_user_id IS NULL AND (
              (
                (a.target_course IS NULL OR a.target_course = '') AND (a.target_batch IS NULL OR a.target_batch = '')
              ) OR (
                (a.target_course IS NULL OR a.target_course = '' OR EXISTS (
                  SELECT 1 FROM student_course_enrollments sce
                  WHERE sce.user_id = ? AND sce.course_name = a.target_course
                ))
                AND (
                  a.target_batch IS NULL OR a.target_batch = '' OR a.target_batch = ?
                )
              )
            )
          )
        ) AND (a.scheduled_at IS NULL OR datetime(a.scheduled_at) <= datetime('now'))
        ORDER BY a.created_at DESC
        LIMIT 50
      `).all(req.user.id, req.user.id, batchFilter);
    }

    res.json({ announcements });
  } catch (error) {
    console.error('Notices fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current, new: newPass } = req.body;
    const userId = req.user.id;

    if (!current || !newPass) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (current === newPass) {
      return res.status(400).json({ error: 'New password must be different from the current password.' });
    }

    if (!validatePassword(newPass)) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
      });
    }

    // Get user from DB
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValid = bcrypt.compareSync(current, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    // Hash and update new password
    const newHash = bcrypt.hashSync(newPass, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get student/alumni directory
router.get('/directory', authenticateToken, (req, res) => {
  try {
    const students = db.prepare(`
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_picture, u.email,
        p.batch_number, p.bio, p.bfiaa_member, p.full_name
      FROM users u
      JOIN student_profiles p ON u.id = p.user_id
      WHERE u.role = 'student' AND u.is_active = 1
      ORDER BY p.batch_number DESC, u.first_name ASC
    `).all();

    res.json({ students });
  } catch (error) {
    console.error('Directory fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get privacy settings for current user
router.get('/privacy', authenticateToken, (req, res) => {
  try {
    const rows = db.prepare('SELECT field_name, visibility FROM profile_field_privacy WHERE user_id = ?').all(req.user.id);
    const privacy = {};
    for (const row of rows) {
      privacy[row.field_name] = row.visibility;
    }
    res.json({ privacy });
  } catch (error) {
    console.error('Privacy fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a single privacy setting
router.put('/privacy', authenticateToken, (req, res) => {
  try {
    const { field_name, visibility } = req.body;
    const validFields = [
      'gender', 'birthday', 'present_address', 'permanent_address',
      'educational_qualification', 'profession', 'email', 'mobile_number',
      'whatsapp_number', 'bio', 'social_links', 'experiences', 'portfolio'
    ];
    const validVisibility = ['public', 'batchmates', 'only_me'];
    
    if (!validFields.includes(field_name) || !validVisibility.includes(visibility)) {
      return res.status(400).json({ error: 'Invalid field or visibility value' });
    }

    db.prepare(`
      INSERT INTO profile_field_privacy (user_id, field_name, visibility)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, field_name) DO UPDATE SET visibility = excluded.visibility
    `).run(req.user.id, field_name, visibility);

    res.json({ message: 'Privacy setting updated' });
  } catch (error) {
    console.error('Privacy update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
