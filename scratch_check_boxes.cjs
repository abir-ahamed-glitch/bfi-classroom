const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const result1 = db.prepare(`
  UPDATE student_course_enrollments
  SET step1_completed = 1
  WHERE course_name = 'Film Appreciation Course' 
  AND json_extract(fee_details, '$.status') = 'Paid Full'
`).run();

const result2 = db.prepare(`
  UPDATE student_course_enrollments
  SET step2_completed = 1
  WHERE course_name = 'Film Appreciation Course'
  AND exam_written >= 33
`).run();

const result4 = db.prepare(`
  UPDATE student_course_enrollments
  SET step4_completed = 1
  WHERE course_name = 'Film Appreciation Course'
  AND exam_written >= 33
`).run();

console.log(`Updated step1_completed for ${result1.changes} paid students.`);
console.log(`Updated step2_completed for ${result2.changes} passed students.`);
console.log(`Updated step4_completed for ${result4.changes} passed students.`);
