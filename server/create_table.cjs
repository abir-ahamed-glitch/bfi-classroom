const db = require('better-sqlite3')('./bfi_classroom.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS bulk_import_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    batch_number TEXT,
    results_json TEXT,
    imported_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
  );
`);
console.log('Table created');
