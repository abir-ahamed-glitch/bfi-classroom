import db from './server/db/database.js';
console.log(db.prepare("SELECT id, first_name, last_name, role FROM users WHERE role = 'teacher'").all());
