const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'bfi_classroom.db');
const db = new Database(dbPath);

console.log('Running migration: create batch_moderators table...');

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_moderators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id),
      assigned_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(batch_id, user_id)
    );
  `);
  console.log('Migration successful: batch_moderators table created.');
} catch (err) {
  console.error('Migration error:', err);
  process.exit(1);
} finally {
  db.close();
}
