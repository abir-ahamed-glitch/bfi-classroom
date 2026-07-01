const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const rows = db.prepare(`
  SELECT u.id, sp.full_name, e.exam_written, e.step1_completed, e.step2_completed 
  FROM users u 
  JOIN student_profiles sp ON u.id = sp.user_id 
  JOIN student_course_enrollments e ON u.id = e.user_id 
  WHERE sp.full_name IN ('Arabinda Sarker', 'Ashfaque Ahmed', 'Kazi Sufia Akhtar', 'Masudur Rahman Mollik')
`).all();

console.log(rows);
