const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const rows = db.prepare("SELECT u.created_at, u.first_name, u.last_name FROM users u JOIN student_profiles sp ON u.id = sp.user_id WHERE sp.full_name = 'Kazi Sufia Akhtar'").all();
console.log(rows);
