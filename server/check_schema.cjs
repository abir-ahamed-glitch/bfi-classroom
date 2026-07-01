const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='batch_students'").get();
console.log(schema);
const fks = db.prepare("PRAGMA foreign_key_list(batch_students)").all();
console.log(fks);
