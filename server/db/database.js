import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { encryptMessageContent, isEncryptedMessageContent } from '../utils/messageCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'bfi_classroom.db');
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
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('admin', 'instructor', 'student')),
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

    -- Student Course Enrollments (Multiple courses per student)
    CREATE TABLE IF NOT EXISTS student_course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_name TEXT NOT NULL,
      course_type TEXT NOT NULL, -- 'filmmaking' (4 steps) or 'workshop' (2 steps)
      step1_completed INTEGER DEFAULT 0,
      step2_completed INTEGER DEFAULT 0,
      step3_completed INTEGER DEFAULT 0,
      step4_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, course_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

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
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
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

    -- Student Experiences (Film/Cultural)
    CREATE TABLE IF NOT EXISTS student_experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      organization TEXT,
      experience_type TEXT CHECK(experience_type IN ('Film', 'Cultural', 'Workshop', 'Award', 'Education', 'Other')),
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
  `);

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

  // Ensure admin profile exists for the seeded admin
  const defaultAdmin = db.prepare('SELECT id, first_name, last_name FROM users WHERE role = ? AND username = ?').get('admin', 'admin');
  if (defaultAdmin) {
    const adminProfileExists = db.prepare('SELECT id FROM admin_profiles WHERE user_id = ?').get(defaultAdmin.id);
    if (!adminProfileExists) {
      db.prepare('INSERT INTO admin_profiles (user_id, full_name) VALUES (?, ?)').run(defaultAdmin.id, `${defaultAdmin.first_name} ${defaultAdmin.last_name}`);
    }
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
    "ALTER TABLE announcements ADD COLUMN target_batch TEXT"
  ];
  for (const migration of announcementMigrations) {
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
}

export default db;
