import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { encryptMessageContent, isEncryptedMessageContent } from '../utils/messageCrypto.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runEnrollmentConstraintMigration } = require('./migrations/20261019_enrollment_unique_constraint_fix.cjs');
const { runBatchesConstraintMigration } = require('./migrations/20261022_batches_unique_constraint_fix.cjs');
const { runDownstreamCollisionMigration } = require('./migrations/20261022_downstream_identity_collision_fix.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'bfi_classroom.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase() {
  db.exec(`
    -- Users table (core authentication)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('admin', 'instructor', 'student', 'moderator')),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      profile_picture TEXT,
      mobile_number TEXT,
      two_factor_enabled INTEGER DEFAULT 0,
      two_factor_secret TEXT,
      public_key TEXT,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Student profiles
    CREATE TABLE IF NOT EXISTS student_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      student_id TEXT UNIQUE,
      batch_number TEXT,
      gender TEXT,
      birthday TEXT,
      present_address TEXT,
      permanent_address TEXT,
      educational_qualification TEXT,
      profession TEXT,
      whatsapp_number TEXT,
      bio TEXT,
      privacy_setting TEXT DEFAULT 'private' CHECK(privacy_setting IN ('private', 'unlisted', 'public')),
      bfiaa_member INTEGER DEFAULT 0,
      phase1_admitted INTEGER DEFAULT 0,
      phase1_passed INTEGER DEFAULT 0,
      phase2_admitted INTEGER DEFAULT 0,
      phase2_completed INTEGER DEFAULT 0,
      phase1_fee TEXT DEFAULT '',
      phase2_fee TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Instructor profiles
    CREATE TABLE IF NOT EXISTS instructor_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      subjects TEXT,
      gender TEXT,
      birthday TEXT,
      present_address TEXT,
      permanent_address TEXT,
      educational_qualification TEXT,
      profession TEXT,
      bfi_batch TEXT,
      whatsapp_number TEXT,
      bio TEXT,
      additional_info TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Admin profiles
    CREATE TABLE IF NOT EXISTS admin_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      gender TEXT,
      birthday TEXT,
      present_address TEXT,
      permanent_address TEXT,
      educational_qualification TEXT,
      profession TEXT,
      whatsapp_number TEXT,
      bio TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Student Course Enrollments (Multiple courses per student, batch-scoped)
    CREATE TABLE IF NOT EXISTS student_course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_name TEXT NOT NULL,
      course_type TEXT NOT NULL DEFAULT 'filmmaking', -- 'filmmaking' (4 steps) or 'workshop' (2 steps)
      step1_completed INTEGER DEFAULT 0,
      step2_completed INTEGER DEFAULT 0,
      step3_completed INTEGER DEFAULT 0,
      step4_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      attendance_classes TEXT,
      exam_written INTEGER DEFAULT 0,
      assignment_screenplay INTEGER DEFAULT 0,
      assignment_shooting_script INTEGER DEFAULT 0,
      attendance_total INTEGER DEFAULT 22,
      phase2_shooting_attended INTEGER DEFAULT 0,
      phase2_editing_attended INTEGER DEFAULT 0,
      fee_details TEXT,
      assignment_scores TEXT,
      course_definition_id INTEGER,
      course_version INTEGER,
      batch_id INTEGER REFERENCES batches(id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_user_course_no_batch
      ON student_course_enrollments(user_id, course_name)
      WHERE batch_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_user_course_with_batch
      ON student_course_enrollments(user_id, course_name, batch_id)
      WHERE batch_id IS NOT NULL;

    -- Social media links
    CREATE TABLE IF NOT EXISTS social_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Portfolio projects
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      duration TEXT,
      genre TEXT,
      synopsis TEXT,
      release_date TEXT,
      poster_url TEXT,
      thumbnail_url TEXT,
      media_link TEXT,
      media_source TEXT,
      show_on_dashboard INTEGER DEFAULT 0,
      show_on_community INTEGER DEFAULT 0,
      privacy_setting TEXT DEFAULT 'private' CHECK(privacy_setting IN ('private', 'unlisted', 'public')),
      view_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Project credits (director, producer, actor, etc.)
    CREATE TABLE IF NOT EXISTS project_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Awards
    CREATE TABLE IF NOT EXISTS awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      award_name TEXT NOT NULL,
      festival_name TEXT,
      award_year TEXT,
      category TEXT,
      description TEXT,
      certificate_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      attachment_url TEXT,
      attachment_type TEXT,
      reply_to_message_id INTEGER,
      forwarded_from_message_id INTEGER,
      edited_at TEXT,
      deleted_for_everyone INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_hidden_for_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      hidden_at TEXT DEFAULT (datetime('now')),
      UNIQUE(message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      reporter_id INTEGER NOT NULL,
      reported_user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'dismissed')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(message_id, reporter_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Course materials
    CREATE TABLE IF NOT EXISTS course_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      file_url TEXT,
      file_type TEXT,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      batch_number TEXT,
      course_name TEXT,
      uploaded_by INTEGER NOT NULL,
      is_downloadable INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Community posts
    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT,
      image_url TEXT,
      shared_project_id INTEGER,
      post_type TEXT DEFAULT 'text' CHECK(post_type IN ('text', 'image', 'project_share')),
      likes_count INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      pinned_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (shared_project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    -- Bulk import history
    CREATE TABLE IF NOT EXISTS bulk_import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      batch_number TEXT,
      results_json TEXT,
      imported_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Post comments
    CREATE TABLE IF NOT EXISTS post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      parent_id INTEGER,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
    );

    -- Comment reports
    CREATE TABLE IF NOT EXISTS comment_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      reporter_id INTEGER NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'dismissed')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(comment_id, reporter_id),
      FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      reported_user_id INTEGER,
      content_type TEXT NOT NULL,
      content_id INTEGER,
      reason_category TEXT NOT NULL,
      reason_detail TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_reports_status_created
      ON reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_content
      ON reports(content_type, content_id);
    CREATE INDEX IF NOT EXISTS idx_reports_reporter
      ON reports(reporter_id);

    -- Comment likes
    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction_type TEXT DEFAULT 'like',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id),
      FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Post likes
    CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Friendships
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'blocked')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- BFIAA Members
    CREATE TABLE IF NOT EXISTS bfiaa_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      position TEXT,
      member_since TEXT,
      expiry_date TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      is_read INTEGER DEFAULT 0,
      link TEXT,
      image_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Announcements (Admin to Students)
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
      target_course TEXT,
      target_batch TEXT,
      image_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Session tracking
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Password Reset Tokens (secure, database-backed)
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Profile field privacy settings
    CREATE TABLE IF NOT EXISTS profile_field_privacy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'batchmates', 'only_me')),
      UNIQUE(user_id, field_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Student Experiences (Film/Cultural)
    CREATE TABLE IF NOT EXISTS student_experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      organization TEXT,
      experience_type TEXT,
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Certificate Templates
    CREATE TABLE IF NOT EXISTS certificate_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layout_json TEXT,
      logo_url TEXT,
      signature_url TEXT,
      background_url TEXT,
      updated_by INTEGER,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Certificate Downloads
    CREATE TABLE IF NOT EXISTS certificate_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_name TEXT NOT NULL,
      downloaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Batch-Wise Course Fees
    CREATE TABLE IF NOT EXISTS batch_course_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      course_name TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      phase1_fee INTEGER NOT NULL DEFAULT 0,
      phase2_fee INTEGER NOT NULL DEFAULT 0,
      full_fee INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_student_profiles_batch ON student_profiles(batch_number);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, receiver_id);
    CREATE INDEX IF NOT EXISTS idx_message_hidden_user ON message_hidden_for_users(user_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reports_message ON message_reports(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reports_reporter ON message_reports(reporter_id);
    CREATE INDEX IF NOT EXISTS idx_community_posts_user ON community_posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_experiences_user_id ON student_experiences(user_id);
    CREATE INDEX IF NOT EXISTS idx_course_enrollments_user_id ON student_course_enrollments(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_profile_field_privacy_user ON profile_field_privacy(user_id);

    -- Custom subjects
    CREATE TABLE IF NOT EXISTS custom_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      course_name TEXT NOT NULL,
      phase INTEGER,
      parts_count INTEGER DEFAULT 1,
      class_type TEXT DEFAULT 'live',
      has_live_qa INTEGER DEFAULT 0,
      duration_minutes INTEGER DEFAULT NULL,
      part_durations TEXT DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      teacher_id INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name, course_name, phase),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Batches table
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_name TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      course_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'upcoming',
      start_date DATE,
      end_date DATE,
      description TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      slug TEXT,
      deleted_at TEXT DEFAULT NULL,
      deleted_by_admin_id INTEGER DEFAULT NULL,
      course_definition_id INTEGER,
      course_version INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_slug ON batches(slug) WHERE slug IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_unlinked_unique ON batches(batch_number, course_name) WHERE course_definition_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_defined_unique ON batches(batch_number, course_definition_id) WHERE course_definition_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_defined_name_unique ON batches(batch_name, course_definition_id) WHERE course_definition_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_batches_course_def ON batches(course_definition_id);

    -- Batch students association table
    CREATE TABLE IF NOT EXISTS batch_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id),
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_by INTEGER,
      UNIQUE(batch_id, student_id)
    );
  `);

  // ── Broadcast Messaging System tables ──────────────────────────────────────
  const broadcastMigrations = [
    `CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      sender_id INTEGER NOT NULL,
      audience_type TEXT NOT NULL DEFAULT 'all',
      audience_value TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      priority TEXT NOT NULL DEFAULT 'normal',
      allow_reply INTEGER NOT NULL DEFAULT 0,
      scheduled_at DATETIME,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_recipients INTEGER DEFAULT 0,
      delivered_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      channels TEXT NOT NULL DEFAULT 'inbox,notification,notice'
    )`,
    `CREATE TABLE IF NOT EXISTS broadcast_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL,
      inbox_delivered INTEGER DEFAULT 0,
      notification_delivered INTEGER DEFAULT 0,
      notice_delivered INTEGER DEFAULT 0,
      delivered_at DATETIME,
      failed_reason TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS broadcast_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS broadcast_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES users(id),
      granted_by INTEGER NOT NULL,
      can_send_to TEXT NOT NULL DEFAULT 'all',
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(teacher_id)
    )`,
    // Add is_broadcast and allow_reply to messages for broadcast tracking
    `ALTER TABLE messages ADD COLUMN is_broadcast INTEGER DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN broadcast_id INTEGER`,
    `ALTER TABLE messages ADD COLUMN allow_reply INTEGER DEFAULT 1`,
    `ALTER TABLE announcements ADD COLUMN is_broadcast INTEGER DEFAULT 0`,
    `ALTER TABLE broadcasts ADD COLUMN channels TEXT NOT NULL DEFAULT 'inbox,notification,notice'`,
  ];

  for (const sql of broadcastMigrations) {
    try {
      db.prepare(sql).run();
    } catch (e) {
      // Column/table already exists — ignore
    }
  }

  // One-time migration for batches and batch_students
  try {
    const distinctBatches = db.prepare(`
      SELECT DISTINCT batch_number 
      FROM student_profiles 
      WHERE batch_number IS NOT NULL AND batch_number != ''
    `).all();

    let syncedBatches = 0;
    let syncedStudents = 0;
    let alreadySynced = true;

    const runMigration = db.transaction(() => {
      for (const row of distinctBatches) {
        const batchNum = row.batch_number;
        const existingBatch = db.prepare('SELECT id FROM batches WHERE batch_number = ?').get(batchNum);
        if (!existingBatch) {
          const batchName = `${batchNum}th Batch`;
          db.prepare(`
            INSERT INTO batches (batch_name, batch_number, course_name, status)
            VALUES (?, ?, ?, ?)
          `).run(batchName, batchNum, 'Online Filmmaking Course', 'completed');
          
          syncedBatches++;
          alreadySynced = false;
        }
      }

      const studentsWithBatch = db.prepare(`
        SELECT user_id, batch_number 
        FROM student_profiles 
        WHERE batch_number IS NOT NULL AND batch_number != ''
      `).all();

      for (const student of studentsWithBatch) {
        const batch = db.prepare('SELECT id FROM batches WHERE batch_number = ?').get(student.batch_number);
        if (batch) {
          const existingAssignment = db.prepare(`
            SELECT id FROM batch_students 
            WHERE batch_id = ? AND student_id = ?
          `).get(batch.id, student.user_id);
          
          if (!existingAssignment) {
            db.prepare(`
              INSERT INTO batch_students (batch_id, student_id)
              VALUES (?, ?)
            `).run(batch.id, student.user_id);
            syncedStudents++;
            alreadySynced = false;
          }
        }
      }
    });

    runMigration();

    if (alreadySynced) {
      console.log("[Batch Migration] Already up to date, nothing to sync");
    } else {
      console.log(`[Batch Migration] Synced ${syncedBatches} batches, ${syncedStudents} student assignments from existing data`);
    }

    // Temporary verification check as requested
    const tablesCreated = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('batches', 'batch_students')").all();
    console.log("[Batch Verification] Created tables:", tablesCreated.map(t => t.name));
    const batchCount = db.prepare("SELECT COUNT(*) as count FROM batches").get().count;
    const studentCount = db.prepare("SELECT COUNT(*) as count FROM batch_students").get().count;
    console.log(`[Batch Verification] Current count in batches: ${batchCount}, batch_students: ${studentCount}`);

    // Ensure all batch_students are enrolled in their batch's course
    try {
      const pendingEnrollments = db.prepare(`
        SELECT bs.student_id, b.course_name 
        FROM batch_students bs
        JOIN batches b ON b.id = bs.batch_id
        LEFT JOIN student_course_enrollments sce ON sce.user_id = bs.student_id AND sce.course_name = b.course_name
        WHERE sce.id IS NULL
      `).all();

      if (pendingEnrollments.length > 0) {
        console.log(`[Batch Migration] Backfilling ${pendingEnrollments.length} missing course enrollments for batch students...`);
        const enrollStmt = db.prepare('INSERT INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, ?, ?)');
        db.transaction(() => {
          for (const pe of pendingEnrollments) {
            const courseType = pe.course_name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop';
            enrollStmt.run(pe.student_id, pe.course_name, courseType);
          }
        })();
        console.log(`[Batch Migration] Successfully enrolled batch students.`);
      }
    } catch (e) {
      console.error('[Batch Migration] Error backfilling enrollments:', e);
    }
  } catch (error) {
    console.error('[Batch Migration] Error during migration:', error);
  }

  // Custom subjects course_name and phase migration
  try {
    const info = db.prepare("PRAGMA table_info(custom_subjects)").all();
    const hasCourseName = info.some(col => col.name === 'course_name');
    if (!hasCourseName) {
      console.log('⏳ Migrating custom_subjects table to support course_name and phase...');
      
      // 1. Rename existing table
      db.prepare("ALTER TABLE custom_subjects RENAME TO temp_custom_subjects").run();
      
      // 2. Create new table
      db.prepare(`
        CREATE TABLE custom_subjects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          course_name TEXT NOT NULL,
          phase INTEGER,
          parts_count INTEGER DEFAULT 1,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(name, course_name, phase)
        )
      `).run();
      
      // 3. Copy existing data
      const tempInfo = db.prepare("PRAGMA table_info(temp_custom_subjects)").all();
      const hasSortOrder = tempInfo.some(col => col.name === 'sort_order');
      if (hasSortOrder) {
        db.prepare(`
          INSERT INTO custom_subjects (id, name, course_name, phase, sort_order, created_at)
          SELECT id, name, 'Online Filmmaking Course', 1, sort_order, created_at FROM temp_custom_subjects
        `).run();
      } else {
        db.prepare(`
          INSERT INTO custom_subjects (id, name, course_name, phase, sort_order, created_at)
          SELECT id, name, 'Online Filmmaking Course', 1, 0, created_at FROM temp_custom_subjects
        `).run();
      }
      
      // 4. Drop temporary table
      db.prepare("DROP TABLE temp_custom_subjects").run();
      
      console.log('✅ Migrated custom_subjects: added course_name and phase columns with unique constraint');
    }
  } catch (error) {
    console.error('Failed to migrate custom_subjects table:', error);
  }

  // Seed default admin if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('Admin@BFI2024', 12);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin', 'admin@bfibd.org', hash, 'admin', 'BFI', 'Admin');

    console.log('✅ Database seeded with default admin');
  }

  // Seed default core subjects if missing
  const defaultCoreSubjects = [
    'History of World Cinema', 'Film Language', 'Film Aesthetics', 'Aesthetics of Sound', 
    'Music', 'Cinematography', 'Light', 'Art Direction', 'Acting', 'Dress and Props', 
    'Script', 'Shot Division', 'Documentary', 'Film Criticism', 'How to Read a Film', 
    'Film Production Design'
  ];
  const checkSubject = db.prepare("SELECT id FROM custom_subjects WHERE lower(name) = lower(?) AND course_name = ? AND phase = ?");
  const insertSubject = db.prepare("INSERT INTO custom_subjects (name, course_name, phase) VALUES (?, ?, ?)");
  
  let seededCount = 0;
  for (const subject of defaultCoreSubjects) {
    const exists = checkSubject.get(subject, 'Online Filmmaking Course', 1);
    if (!exists) {
      insertSubject.run(subject, 'Online Filmmaking Course', 1);
      seededCount++;
    }
  }
  if (seededCount > 0) {
    console.log(`✅ Database seeded with ${seededCount} missing default core subjects`);
  }

  // Ensure admin profile exists for the seeded admin
  const defaultAdmin = db.prepare('SELECT id, first_name, last_name FROM users WHERE role = ? AND username = ?').get('admin', 'admin');
  if (defaultAdmin) {
    const adminProfileExists = db.prepare('SELECT id FROM admin_profiles WHERE user_id = ?').get(defaultAdmin.id);
    if (!adminProfileExists) {
      db.prepare('INSERT INTO admin_profiles (user_id, full_name) VALUES (?, ?)').run(defaultAdmin.id, `${defaultAdmin.first_name} ${defaultAdmin.last_name}`);
    }
  }

  // Migrations for notifications
  try {
    db.prepare('ALTER TABLE notifications ADD COLUMN image_url TEXT').run();
    console.log('✅ Migrated notifications table');
  } catch (err) {
    // Ignore error if column already exists
  }

  // Migrations for community_posts
  try {
    db.prepare("ALTER TABLE community_posts ADD COLUMN is_pinned INTEGER DEFAULT 0").run();
    db.prepare("ALTER TABLE community_posts ADD COLUMN pinned_at TEXT").run();
    console.log('✅ Migrated community_posts table');
  } catch {
    // Columns probably already exist
  }

  const messageMigrations = [
    "ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER",
    "ALTER TABLE messages ADD COLUMN forwarded_from_message_id INTEGER",
    "ALTER TABLE messages ADD COLUMN edited_at TEXT",
    "ALTER TABLE messages ADD COLUMN deleted_for_everyone INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN deleted_at TEXT",
    "ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text'",
    "ALTER TABLE messages ADD COLUMN is_pinned INTEGER DEFAULT 0",
  ];

  for (const migration of messageMigrations) {
    try {
      db.prepare(migration).run();
    } catch {
      // Column probably already exists
    }
  }

  const announcementMigrations = [
    "ALTER TABLE announcements ADD COLUMN target_course TEXT",
    "ALTER TABLE announcements ADD COLUMN target_batch TEXT",
    "ALTER TABLE announcements ADD COLUMN image_url TEXT"
  ];
  for (const migration of announcementMigrations) {
    try {
      db.prepare(migration).run();
    } catch {
      // Column probably already exists
    }
  }

  const announcementMigrationsExtra = [
    "ALTER TABLE announcements ADD COLUMN scheduled_at TEXT DEFAULT NULL",
    "ALTER TABLE announcements ADD COLUMN scheduled_notified INTEGER DEFAULT 0"
  ];
  for (const migration of announcementMigrationsExtra) {
    try {
      db.prepare(migration).run();
    } catch {
      // Column probably already exists
    }
  }

  const templateMigrations = [
    "ALTER TABLE certificate_templates ADD COLUMN course_name TEXT"
  ];
  for (const migration of templateMigrations) {
    try {
      db.prepare(migration).run();
    } catch {
      // Column probably already exists
    }
  }

  const enrollmentMigrations = [
    "ALTER TABLE student_course_enrollments ADD COLUMN attendance_classes INTEGER DEFAULT 0",
    "ALTER TABLE student_course_enrollments ADD COLUMN exam_written INTEGER DEFAULT 0",
    "ALTER TABLE student_course_enrollments ADD COLUMN assignment_screenplay INTEGER DEFAULT 0",
    "ALTER TABLE student_course_enrollments ADD COLUMN assignment_shooting_script INTEGER DEFAULT 0",
    "ALTER TABLE student_course_enrollments ADD COLUMN attendance_total INTEGER DEFAULT 22",
    "ALTER TABLE student_course_enrollments ADD COLUMN fee_details TEXT"
  ];
  for (const migration of enrollmentMigrations) {
    try {
      db.prepare(migration).run();
    } catch {
      // Column probably already exists
    }
  }

  // Community posts audience migration
  try {
    db.prepare("ALTER TABLE community_posts ADD COLUMN audience TEXT DEFAULT 'public' CHECK(audience IN ('public', 'batchmates', 'only_me'))").run();
    console.log('✅ Migrated community_posts: added audience column');
  } catch {
    // Column probably already exists
  }

  // Comment parent_id migration
  try {
    db.prepare("ALTER TABLE post_comments ADD COLUMN parent_id INTEGER").run();
    console.log('✅ Migrated post_comments: added parent_id column');
  } catch (error) {
    // Column probably already exists
  }

  // Comment reaction_type migration
  try {
    db.prepare("ALTER TABLE comment_likes ADD COLUMN reaction_type TEXT DEFAULT 'like'").run();
    console.log('✅ Migrated comment_likes: added reaction_type column');
  } catch (error) {
    // Column probably already exists
  }

  // Post likes reaction_type migration
  try {
    db.prepare("ALTER TABLE post_likes ADD COLUMN reaction_type TEXT DEFAULT 'like'").run();
    console.log('✅ Migrated post_likes: added reaction_type column');
  } catch (error) {
    // Column probably already exists
  }

  // Post shares count migration
  try {
    db.prepare("ALTER TABLE community_posts ADD COLUMN shares_count INTEGER DEFAULT 0").run();
    console.log('✅ Migrated community_posts: added shares_count column');
  } catch (error) {
    // Column probably already exists
  }

  // Backfill any NULL reaction_type rows to 'like'
  try {
    const updated1 = db.prepare("UPDATE post_likes SET reaction_type = 'like' WHERE reaction_type IS NULL").run();
    if (updated1.changes > 0) console.log(`✅ Backfilled ${updated1.changes} post_likes rows with reaction_type='like'`);
    const updated2 = db.prepare("UPDATE comment_likes SET reaction_type = 'like' WHERE reaction_type IS NULL").run();
    if (updated2.changes > 0) console.log(`✅ Backfilled ${updated2.changes} comment_likes rows with reaction_type='like'`);
  } catch (error) {
    // Ignore
  }

  // Scheduled posts migration
  try {
    db.prepare("ALTER TABLE community_posts ADD COLUMN scheduled_at TEXT DEFAULT NULL").run();
    console.log('✅ Migrated community_posts: added scheduled_at column');
  } catch (error) {
    // Column probably already exists
  }

  try {
    db.prepare("ALTER TABLE community_posts ADD COLUMN scheduled_notified INTEGER DEFAULT 0").run();
    console.log('✅ Migrated community_posts: added scheduled_notified column');
  } catch (error) {
    // Column probably already exists
  }

  // Fee tracker reminder log migration
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS fee_reminder_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        student_user_id INTEGER NOT NULL,
        sent_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run();
    console.log('✅ Created fee_reminder_log table');
  } catch (error) {
    // Table probably already exists
  }

  // Announcements visible_to_user_id migration
  try {
    db.prepare("ALTER TABLE announcements ADD COLUMN visible_to_user_id INTEGER DEFAULT NULL").run();
    console.log('✅ Migrated announcements: added visible_to_user_id column');
  } catch (error) {
    // Column probably already exists
  }

  // Announcements broadcast_id migration
  try {
    db.prepare("ALTER TABLE announcements ADD COLUMN broadcast_id INTEGER DEFAULT NULL").run();
    console.log('✅ Migrated announcements: added broadcast_id column');
  } catch (error) {
    // Column probably already exists
  }

  // Notifications broadcast_id migration
  try {
    db.prepare("ALTER TABLE notifications ADD COLUMN broadcast_id INTEGER DEFAULT NULL").run();
    console.log('✅ Migrated notifications: added broadcast_id column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects sort_order migration
  try {
    db.prepare("ALTER TABLE custom_subjects ADD COLUMN sort_order INTEGER DEFAULT 0").run();
    console.log('✅ Migrated custom_subjects: added sort_order column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects parts_count migration
  try {
    db.prepare("ALTER TABLE custom_subjects ADD COLUMN parts_count INTEGER DEFAULT 1").run();
    console.log('✅ Migrated custom_subjects: added parts_count column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects class_type migration
  try {
    db.prepare("ALTER TABLE custom_subjects ADD COLUMN class_type TEXT DEFAULT 'live'").run();
    console.log('✅ Migrated custom_subjects: added class_type column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects has_live_qa migration
  try {
    db.prepare('ALTER TABLE custom_subjects ADD COLUMN has_live_qa INTEGER DEFAULT 0').run();
    console.log('✅ Migrated custom_subjects: added has_live_qa column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects duration_minutes migration
  try {
    db.prepare('ALTER TABLE custom_subjects ADD COLUMN duration_minutes INTEGER DEFAULT NULL').run();
    console.log('✅ Migrated custom_subjects: added duration_minutes column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects part_durations migration
  try {
    db.prepare('ALTER TABLE custom_subjects ADD COLUMN part_durations TEXT DEFAULT NULL').run();
    console.log('✅ Migrated custom_subjects: added part_durations column');
  } catch (error) {
    // Column probably already exists
  }

  // Custom subjects teacher_id migration
  try {
    db.prepare('ALTER TABLE custom_subjects ADD COLUMN teacher_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL').run();
    console.log('✅ Migrated custom_subjects: added teacher_id column');
  } catch (error) {
    // Column probably already exists
  }


  const plainMessages = db.prepare(`
    SELECT id, content
    FROM messages
    WHERE content IS NOT NULL
      AND content != ''
      AND content NOT LIKE 'enc:v1:%'
  `).all();

  if (plainMessages.length > 0) {
    const encryptExistingMessage = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
    const encryptExistingMessages = db.transaction(() => {
      for (const message of plainMessages) {
        if (!isEncryptedMessageContent(message.content)) {
          encryptExistingMessage.run(encryptMessageContent(message.content), message.id);
        }
      }
    });

    encryptExistingMessages();
    console.log(`Encrypted ${plainMessages.length} existing inbox messages.`);
  }
  // Batch status transition audit log — append-only, never delete rows
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS batch_status_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        batch_name TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        trigger_type TEXT NOT NULL DEFAULT 'automatic',
        triggered_by INTEGER,
        reason TEXT,
        transitioned_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Index for fast per-batch history lookups
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_batch_status_transitions_batch_id
      ON batch_status_transitions(batch_id, transitioned_at DESC)
    `).run();

    console.log('✅ Ensured batch_status_transitions table and index exist');
  } catch (error) {
    // Table probably already exists — safe to ignore
  }

  // Scheduled SMS table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS scheduled_sms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT NOT NULL,
        recipients TEXT NOT NULL, -- JSON stringified array of {name, phone}
        message TEXT NOT NULL,
        scheduled_at TEXT NOT NULL, -- ISO string
        status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    console.log('✅ Ensured scheduled_sms table exists');
  } catch (error) {
    console.error('Error creating scheduled_sms table:', error);
  }
  // Add title column to bulk_import_history for rename feature
  try {
    db.prepare(`ALTER TABLE bulk_import_history ADD COLUMN title TEXT`).run();
    console.log('✅ Added title column to bulk_import_history');
  } catch (error) {
    // Column already exists — safe to ignore
  }

  // Soft-delete feature: Add deleted_at columns
  const tablesForSoftDelete = [
    'users', 'community_posts', 'course_materials', 'batches', 'announcements', 
    'broadcasts', 'custom_subjects', 'student_experiences', 'projects'
  ];
  for (const table of tablesForSoftDelete) {
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT DEFAULT NULL`).run();
      console.log(`✅ Added deleted_at column to ${table}`);
    } catch (error) {
      // Column already exists — safe to ignore
    }
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN deleted_by_admin_id INTEGER DEFAULT NULL`).run();
      console.log(`✅ Added deleted_by_admin_id column to ${table}`);
    } catch (error) {
      // Column already exists — safe to ignore
    }
  }

  // Create trash_audit_log table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS trash_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        entity_label TEXT NOT NULL,
        action TEXT NOT NULL,
        performed_by_admin_id INTEGER NOT NULL,
        performed_by_admin_name TEXT NOT NULL,
        performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `).run();
    console.log('✅ Ensured trash_audit_log table exists');
  } catch (error) {
    console.error('Error creating trash_audit_log table:', error);
  }

  // Course settings table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS course_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
        course_name TEXT NOT NULL,
        batch_number TEXT NOT NULL DEFAULT 'DEFAULT',
        total_classes INTEGER DEFAULT 22,
        exam_max_score INTEGER DEFAULT 100,
        exam_pass_mark INTEGER DEFAULT 33,
        has_assignment INTEGER DEFAULT 0,
        assignments TEXT DEFAULT '[]',
        has_phase2 INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `).run();
  } catch (error) {
    console.error('Error ensuring course_settings table exists:', error);
    throw error;
  }

  // Create trigger to sync default attendance_total from course_settings on insert
  try {
    db.prepare('DROP TRIGGER IF EXISTS set_default_attendance_total').run();
    db.prepare(`
      CREATE TRIGGER set_default_attendance_total
      AFTER INSERT ON student_course_enrollments
      FOR EACH ROW
      WHEN NEW.attendance_total IS NULL OR NEW.attendance_total = 22
      BEGIN
        UPDATE student_course_enrollments
        SET attendance_total = COALESCE(
          CASE WHEN NEW.batch_id IS NOT NULL THEN (
            SELECT total_classes FROM course_settings WHERE batch_id = NEW.batch_id LIMIT 1
          ) ELSE NULL END,
          CASE WHEN NEW.batch_id IS NULL AND NEW.course_definition_id IS NULL THEN (
            SELECT total_classes FROM course_settings 
            WHERE course_name = NEW.course_name 
              AND batch_id IS NULL
              AND batch_number = (
                SELECT b.batch_number 
                FROM batch_students bs
                JOIN batches b ON bs.batch_id = b.id
                WHERE bs.student_id = NEW.user_id AND b.course_name = NEW.course_name AND b.course_definition_id IS NULL
                LIMIT 1
              )
          ) ELSE NULL END,
          (SELECT total_classes FROM course_settings WHERE course_name = NEW.course_name AND batch_number = 'DEFAULT'),
          22
        )
        WHERE id = NEW.id;
      END;
    `).run();
    console.log('✅ Registered set_default_attendance_total trigger');
  } catch (error) {
    console.error('Error registering set_default_attendance_total trigger:', error);
    throw error;
  }

  // Course Maker schema setup
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        course_type TEXT NOT NULL,
        description TEXT,
        duration_value INTEGER,
        duration_unit TEXT DEFAULT 'months',
        phase_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        definition_json TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        updated_by INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(slug, version)
      );

      CREATE TABLE IF NOT EXISTS course_routine_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_definition_id INTEGER NOT NULL,
        batch_id INTEGER,
        phase_id TEXT NOT NULL,
        old_routine TEXT,
        new_routine TEXT NOT NULL,
        changed_by INTEGER NOT NULL,
        changed_at TEXT DEFAULT (datetime('now', 'localtime')),
        reason TEXT,
        FOREIGN KEY (course_definition_id) REFERENCES course_definitions(id),
        FOREIGN KEY (changed_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS student_phase_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        phase_id TEXT NOT NULL,
        attendance_classes INTEGER DEFAULT 0,
        attendance_total INTEGER DEFAULT 0,
        attendance_percentage REAL DEFAULT 0.0,
        assignments_completed INTEGER DEFAULT 0,
        assignments_total INTEGER DEFAULT 0,
        exam_marks REAL DEFAULT NULL,
        is_passed INTEGER DEFAULT 0,
        calculated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(enrollment_id, phase_id),
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS student_class_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        class_id TEXT NOT NULL,
        attended INTEGER NOT NULL DEFAULT 0,
        attended_at TEXT,
        updated_by INTEGER,
        UNIQUE(enrollment_id, class_id),
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS student_assignment_grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        assignment_id TEXT NOT NULL,
        marks_obtained REAL DEFAULT 0,
        submission_status TEXT DEFAULT 'pending',
        remarks TEXT,
        graded_by INTEGER,
        graded_at TEXT,
        UNIQUE(enrollment_id, assignment_id),
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS course_routine_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_definition_id INTEGER NOT NULL,
        batch_id INTEGER DEFAULT 0,
        phase_id TEXT NOT NULL,
        routine_json TEXT NOT NULL,
        updated_by INTEGER NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (course_definition_id) REFERENCES course_definitions(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_course_routine_overrides
        ON course_routine_overrides(course_definition_id, batch_id, phase_id);

      CREATE TABLE IF NOT EXISTS legacy_enrollment_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        source_course_name TEXT NOT NULL,
        target_course_definition_id INTEGER NOT NULL,
        target_version INTEGER NOT NULL,
        legacy_snapshot_json TEXT NOT NULL,
        migrated_by INTEGER NOT NULL,
        migrated_at TEXT DEFAULT (datetime('now', 'localtime')),
        notes TEXT,
        FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id),
        FOREIGN KEY (target_course_definition_id) REFERENCES course_definitions(id),
        FOREIGN KEY (migrated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS batch_moderators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_by INTEGER REFERENCES users(id),
        assigned_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(batch_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS enrollment_migration_collisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        course_name TEXT NOT NULL,
        batch_id INTEGER,
        primary_enrollment_id INTEGER NOT NULL,
        duplicate_enrollment_id INTEGER NOT NULL,
        resolution_action TEXT NOT NULL,
        merged_details TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );

      CREATE TABLE IF NOT EXISTS archived_duplicate_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_enrollment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        course_name TEXT NOT NULL,
        batch_id INTEGER,
        full_row_json TEXT NOT NULL,
        primary_enrollment_id INTEGER NOT NULL,
        archived_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `);

    for (const col of ['course_definition_id', 'course_version']) {
      try {
        db.prepare(`ALTER TABLE batches ADD COLUMN ${col} INTEGER`).run();
      } catch {
        /* empty */
      }
      try {
        db.prepare(`ALTER TABLE student_course_enrollments ADD COLUMN ${col} INTEGER`).run();
      } catch {
        /* empty */
      }
    }
    try {
      db.prepare(`ALTER TABLE student_course_enrollments ADD COLUMN batch_id INTEGER REFERENCES batches(id)`).run();
    } catch {
      /* empty */
    }
    try {
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_student_course_enrollments_batch ON student_course_enrollments(batch_id)`).run();
    } catch {
      /* empty */
    }
    try {
      db.prepare(`ALTER TABLE student_phase_results ADD COLUMN admitted INTEGER DEFAULT 0`).run();
    } catch {
      /* empty */
    }
    try {
      db.prepare(`ALTER TABLE student_phase_results ADD COLUMN admitted_at TEXT`).run();
    } catch {
      /* empty */
    }

    // Run lossless enrollment constraint migration to guarantee canonical schema
    runEnrollmentConstraintMigration(db);

    // Run lossless batches constraint migration to support same-title definitions
    runBatchesConstraintMigration(db);

    // Run lossless downstream identity collision migration (batch_course_fees, course_settings, course_materials)
    runDownstreamCollisionMigration(db);

    console.log('✅ Course Maker tables and columns verified');
  } catch (err) {
    console.error('Error initializing Course Maker schema:', err);
    throw err;
  }
}

export function getDbPath() {
  return dbPath;
}

export default db;
