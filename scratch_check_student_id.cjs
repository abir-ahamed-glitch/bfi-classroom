const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const row = db.prepare("SELECT student_id FROM student_profiles WHERE full_name = 'Arabinda Sarker'").get();
console.log("Student ID:", row.student_id);
