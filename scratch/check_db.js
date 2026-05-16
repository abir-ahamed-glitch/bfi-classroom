import Database from 'better-sqlite3';
const db = new Database('server/bfi_classroom.db');
const rows = db.prepare('SELECT id, content, attachment_url, attachment_type FROM messages WHERE attachment_url IS NOT NULL ORDER BY id DESC LIMIT 5').all();
console.log(JSON.stringify(rows, null, 2));
