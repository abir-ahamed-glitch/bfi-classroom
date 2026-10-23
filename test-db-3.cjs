const db = require('better-sqlite3')('server/bfi_classroom.db');
const schema = db.prepare(`PRAGMA table_info('student_profiles')`).all();
console.log(schema);
