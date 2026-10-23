const db = require('better-sqlite3')('server/bfi_classroom.db');
const schema = db.prepare(`PRAGMA table_info('student_course_enrollments')`).all();
console.log(schema);
