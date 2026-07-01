const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

const rows = db.prepare(`
  SELECT 
    u.id, 
    u.first_name, 
    u.last_name, 
    sp.student_id as bfi_id,
    bs.batch_id
  FROM users u
  LEFT JOIN student_profiles sp ON sp.user_id = u.id
  LEFT JOIN batch_students bs ON bs.student_id = u.id
  WHERE u.first_name LIKE '%kaws%' OR u.last_name LIKE '%kaws%' OR u.email LIKE '%kaws%'
`).all();

console.log(JSON.stringify(rows, null, 2));
