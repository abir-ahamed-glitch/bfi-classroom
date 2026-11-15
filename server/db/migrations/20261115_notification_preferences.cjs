const migrationName = '20261115_notification_preferences';
const categories = ['notices', 'materials', 'messages', 'community'];

// Expressions are built from fixed SQL column references supplied by the app.
function notificationCategory(type) {
  return `CASE ${type}
    WHEN 'notice' THEN 'notices'
    WHEN 'broadcast' THEN 'notices'
    WHEN 'course_material' THEN 'materials'
    WHEN 'message' THEN 'messages'
    WHEN 'community' THEN 'community'
  END`;
}

function ensureNotificationPreferences(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS muted_notification_categories (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK(category IN ('notices', 'materials', 'messages', 'community')),
        PRIMARY KEY (user_id, category)
      );
      CREATE TRIGGER IF NOT EXISTS skip_muted_student_notifications
      BEFORE INSERT ON notifications
      WHEN EXISTS (
        SELECT 1 FROM muted_notification_categories AS muted
        JOIN users ON users.id = muted.user_id AND users.role = 'student'
        WHERE muted.user_id = NEW.user_id AND muted.category = ${notificationCategory('NEW.type')}
      )
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);
    const result = db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(migrationName);
    return { applied: result.changes > 0 };
  })();
}

module.exports = { categories, notificationCategory, ensureNotificationPreferences };
