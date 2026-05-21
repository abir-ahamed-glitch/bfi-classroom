const Database = require('better-sqlite3');
const db = new Database('./bfi_classroom.db');
const users = db.prepare(`
  SELECT u.username, u.email, u.mobile_number, u.first_name, u.last_name, p.student_id 
  FROM users u 
  JOIN student_profiles p ON u.id = p.user_id 
  WHERE p.batch_number = '53'
`).all();

const results = users.map(u => {
  let pw = 'bfi@' + (u.mobile_number ? String(u.mobile_number).slice(-6) : 'random');
  return {
    originalRow: { Name: u.first_name + ' ' + u.last_name, Email: u.email, Mobile: u.mobile_number },
    status: 'success',
    username: u.username,
    password: pw,
    studentId: u.student_id
  };
});

db.prepare(`
  INSERT INTO bulk_import_history (filename, batch_number, results_json, imported_by) 
  VALUES (?, ?, ?, ?)
`).run('BFI_Students_Import_Batch_53_Recovered.xlsx', '53', JSON.stringify(results), null);

console.log('Recovered ' + results.length + ' students.');
