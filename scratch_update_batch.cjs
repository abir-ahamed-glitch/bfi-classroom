const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

const stmt = db.prepare('UPDATE batches SET course_name = ? WHERE batch_name = ? OR batch_name = ?');
const info = stmt.run('Film Appreciation Course', '43rd Batch', '43th Batch');

console.log('Update complete. Rows modified:', info.changes);
