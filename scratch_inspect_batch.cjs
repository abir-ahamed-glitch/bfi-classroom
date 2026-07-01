const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const batchId = 33; 
const students = db.prepare(`
    SELECT u.id, sp.full_name, sp.student_id 
    FROM users u
    JOIN batch_students bs ON u.id = bs.student_id
    JOIN student_profiles sp ON u.id = sp.user_id
    WHERE bs.batch_id = ?
`).all(batchId);

console.log("Students in Batch 33:");
console.table(students);
