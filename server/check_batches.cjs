const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='batches'").get();
console.log(schema);
