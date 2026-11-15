const migrationName = '20261115_course_material_bookmarks';

function ensureCourseMaterialBookmarks(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_material_bookmarks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        material_id INTEGER NOT NULL REFERENCES course_materials(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (user_id, material_id)
      );
      CREATE INDEX IF NOT EXISTS idx_course_material_bookmarks_material
        ON course_material_bookmarks (material_id);
    `);
    const result = db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(migrationName);
    return { applied: result.changes > 0 };
  })();
}

module.exports = { ensureCourseMaterialBookmarks };
