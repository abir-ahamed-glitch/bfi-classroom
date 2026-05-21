import Database from 'better-sqlite3';
const db = new Database('server/bfi_classroom.db');
const rows = db.prepare('SELECT * FROM announcements ORDER BY id DESC').all();
console.log(JSON.stringify(rows, null, 2));
