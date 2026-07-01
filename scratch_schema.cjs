const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.sql).join('\n\n'));
