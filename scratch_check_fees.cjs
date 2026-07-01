const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

const rows = db.prepare(`
  SELECT 
    u.id, 
    u.first_name, 
    u.last_name, 
    sce.course_name, 
    sce.fee_details 
  FROM users u
  LEFT JOIN student_course_enrollments sce ON sce.user_id = u.id
  WHERE u.first_name LIKE '%Molla%' OR u.last_name LIKE '%Sany%'
`).all();

console.log(JSON.stringify(rows, null, 2));
