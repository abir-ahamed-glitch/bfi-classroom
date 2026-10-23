const db = require('better-sqlite3')('server/bfi_classroom.db');
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
console.log(tables);
