const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const rows = db.prepare(`
  SELECT u.id, sp.full_name, sp.student_id, sp.batch_number, b.batch_name
  FROM users u
  JOIN student_profiles sp ON u.id = sp.user_id
  LEFT JOIN batch_students bs ON bs.student_id = u.id
  LEFT JOIN batches b ON b.id = bs.batch_id
  WHERE sp.full_name LIKE '%Kazi Sufia Akhtar%'
`).all();

console.log(rows);
