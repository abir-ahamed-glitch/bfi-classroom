const db = require('better-sqlite3')('bfi_classroom.db');
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
  if (t.name.includes('exam') || t.name.includes('result') || t.name.includes('enroll') || t.name.includes('student')) {
    console.log(t.sql);
  }
}
