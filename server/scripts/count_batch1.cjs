const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');
const students = db.prepare(`
    SELECT sp.full_name 
    FROM student_course_enrollments e
    JOIN batch_students bs ON e.user_id = bs.student_id
    JOIN batches b ON bs.batch_id = b.id
    JOIN student_profiles sp ON e.user_id = sp.user_id
    WHERE b.batch_number IN ('1', '1.0') AND e.step2_completed = 1 AND e.course_name = 'Film Appreciation Course'
`).all();
console.log(students.map(s => s.full_name));
