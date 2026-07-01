const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');
const batches = db.prepare('SELECT id, batch_name, course_name FROM batches').all();
console.log(batches);
