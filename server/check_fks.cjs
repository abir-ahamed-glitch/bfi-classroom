const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
const referencing = [];
for (const table of tables) {
  const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
  for (const fk of fks) {
    if (fk.table === 'users' && fk.on_delete !== 'CASCADE') {
      referencing.push(table);
    }
  }
}
console.log(referencing);
