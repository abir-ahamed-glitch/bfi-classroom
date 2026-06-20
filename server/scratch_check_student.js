import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('bfi_classroom.db');
const db = new Database(dbPath);

const row = db.prepare(`
  SELECT sce.*, u.first_name, u.last_name 
  FROM student_course_enrollments sce 
  JOIN users u ON u.id = sce.user_id 
  JOIN student_profiles sp ON sp.user_id = u.id 
  WHERE sp.student_id = ?
`).get('BFI06752024');

console.log(JSON.stringify(row, null, 2));
