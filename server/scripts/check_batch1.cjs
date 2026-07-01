const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');
const students = db.prepare(`
    SELECT sp.full_name 
    FROM users u
    JOIN batch_students bs ON u.id = bs.student_id
    JOIN batches b ON bs.batch_id = b.id
    JOIN student_profiles sp ON u.id = sp.user_id
    WHERE b.batch_number IN ('1', '1.0') AND b.course_name = 'Film Appreciation Course'
`).all();
console.log('Total students in DB for Batch 1:', students.length);
console.log(students.map(s => s.full_name));
