import db from './server/db/database.js';

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
  console.log('✅ Created fee_reminder_log table manually');
} catch (error) {
  console.log('Error creating fee_reminder_log:', error);
}

try {
  db.prepare("ALTER TABLE announcements ADD COLUMN visible_to_user_id INTEGER DEFAULT NULL").run();
  console.log('✅ Migrated announcements: added visible_to_user_id column');
} catch (error) {
  console.log('Column visible_to_user_id already exists or error:', error);
}
