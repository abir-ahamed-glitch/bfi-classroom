const db = require('better-sqlite3')('bfi_classroom.db');
const q = `SELECT u.id, u.first_name, u.last_name, u.role, u.username, sp.batch_number 
FROM users u 
LEFT JOIN student_profiles sp ON sp.user_id = u.id 
WHERE u.id != ? AND u.is_active = 1 
AND ( u.role = 'admin' 
  OR (SELECT role FROM users WHERE id = ?) = 'admin' 
  OR EXISTS ( SELECT 1 FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ) 
  OR ( u.role = 'student' AND sp.batch_number IS NOT NULL AND sp.batch_number != '' AND sp.batch_number = (SELECT batch_number FROM student_profiles WHERE user_id = ?) ) )`;
console.log(db.prepare(q).all(14, 14, 14, 14, 14));
