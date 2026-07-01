const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');
const batchId = 33; 

const name = 'Md. Riaz-Ur-Rahman';
const rollNo = '01';

let student = db.prepare(`
 SELECT u.id 
 FROM users u
 JOIN batch_students bs ON u.id = bs.student_id
 JOIN student_profiles sp ON u.id = sp.user_id
 WHERE bs.batch_id = ? AND (sp.student_id = ? OR sp.student_id LIKE ?)
`).get(batchId, rollNo, `%${rollNo}%`); // Added % at the end

console.log("Roll No Match:", student);

let student2 = db.prepare(`
 SELECT u.id, sp.full_name 
 FROM users u
 JOIN batch_students bs ON u.id = bs.student_id
 JOIN student_profiles sp ON u.id = sp.user_id
 WHERE bs.batch_id = ? AND LOWER(TRIM(sp.full_name)) = LOWER(TRIM(?))
`).get(batchId, name);

console.log("Name Match Exact:", student2);

// Check if there are invisible characters
const names = db.prepare('SELECT full_name FROM student_profiles WHERE full_name LIKE ?').all('%Riaz%');
console.log("DB Names:", names);
