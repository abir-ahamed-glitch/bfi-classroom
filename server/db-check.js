import Database from 'better-sqlite3';
import path from 'path';

const db = new Database('server/bfi_classroom.db');

try {
    const query = `SELECT * FROM users WHERE deleted_at IS NOT NULL AND role = 'student' ORDER BY deleted_at DESC`;
    const items = db.prepare(query).all();
    console.log("Success, items count:", items.length);
} catch(err) {
    console.error("DB Query error:", err);
}
