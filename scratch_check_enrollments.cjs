const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const rows = db.prepare(`
  SELECT 
    u.id, 
    sp.full_name, 
    (SELECT json_group_array(json_object(
      'course_name', e.course_name, 
      'step1_completed', e.step1_completed, 
      'step2_completed', e.step2_completed
    )) 
    FROM student_course_enrollments e 
    WHERE e.user_id = u.id) as enrollments 
  FROM users u 
  JOIN student_profiles sp ON u.id = sp.user_id 
  JOIN batch_students bs ON bs.student_id = u.id 
  JOIN batches b ON b.id = bs.batch_id 
  WHERE b.batch_name = '1st Batch'
`).all();

const arabinda = rows.find(r => r.full_name === 'Arabinda Sarker');
console.log(JSON.stringify(arabinda, null, 2));

const ashfaque = rows.find(r => r.full_name === 'Ashfaque Ahmed');
console.log(JSON.stringify(ashfaque, null, 2));
