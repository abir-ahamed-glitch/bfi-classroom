const db = require('better-sqlite3')('./server/db/database.sqlite');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('student_profiles', 'instructor_profiles')").all());
