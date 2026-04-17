import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();

// Get student profile
router.get('/profile', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.mobile_number, u.profile_picture,
             p.student_id, p.batch_number, p.full_name, p.gender, p.birthday, p.present_address, 
             p.permanent_address, p.whatsapp_number, p.bio, p.bfiaa_member,
             p.phase1_admitted, p.phase1_passed, p.phase2_admitted, p.phase2_completed,
             p.phase1_fee, p.phase2_fee
      FROM users u
      LEFT JOIN student_profiles p ON u.id = p.user_id
      WHERE u.id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const enrollments = db.prepare('SELECT * FROM student_course_enrollments WHERE user_id = ?').all(req.user.id);
    const socialLinks = db.prepare('SELECT id, platform, url FROM social_links WHERE user_id = ?').all(req.user.id);
    const experiences = db.prepare('SELECT * FROM student_experiences WHERE user_id = ? ORDER BY start_date DESC').all(req.user.id);

    res.json({ ...user, enrollments, socialLinks, experiences });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update student profile (editable fields)
router.put('/profile', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { 
      gender, birthday, present_address, permanent_address, 
      mobile_number, whatsapp_number, bio, socialLinks 
    } = req.body;

    const transaction = db.transaction(() => {
      // Update users table (mobile)
      if (mobile_number !== undefined) {
        db.prepare('UPDATE users SET mobile_number = ? WHERE id = ?').run(mobile_number, req.user.id);
      }

      // Update student_profiles
      db.prepare(`
        UPDATE student_profiles 
        SET gender = ?, birthday = ?, present_address = ?, permanent_address = ?, whatsapp_number = ?, bio = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(gender, birthday, present_address, permanent_address, whatsapp_number, bio, req.user.id);

      // Update social links (clear and re-insert for simplicity)
      db.prepare('DELETE FROM social_links WHERE user_id = ?').run(req.user.id);
      if (socialLinks && Array.isArray(socialLinks)) {
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
      SELECT p.*, u.first_name, u.last_name, u.profile_picture,
        (SELECT count(*) FROM awards WHERE project_id = p.id) as awards_count
      FROM projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id != ? AND p.privacy_setting = 'public'
      ORDER BY awards_count DESC, p.created_at DESC
      LIMIT 6
    `).all(req.user.id);

    // 3. Stats Check
    const profile = db.prepare('SELECT batch_number, bfiaa_member FROM student_profiles WHERE user_id = ?').get(req.user.id);

    // 4. Global Announcements
    const announcements = db.prepare(`
      SELECT a.id, a.title, a.content, a.priority, a.created_at, u.first_name as admin_name
      FROM announcements a
      JOIN users u ON a.admin_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 3
    `).all();

    res.json({
      pinnedProjects,
      recommendedProjects,
      announcements,
      stats: {
        batch: profile?.batch_number,
        isBfiaaMember: profile?.bfiaa_member === 1
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current, new: newPass } = req.body;
    const userId = req.user.id;

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

export default router;

