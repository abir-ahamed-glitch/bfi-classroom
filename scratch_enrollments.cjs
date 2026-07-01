const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');
const enrollments = db.prepare('SELECT * FROM student_course_enrollments LIMIT 5').all();
console.table(enrollments);
