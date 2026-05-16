const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

const addColumn = (table, column, type) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`Added ${column} to ${table}`);
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log(`Column ${column} already exists in ${table}`);
    } else {
      console.error(`Error adding ${column} to ${table}:`, err.message);
    }
  }
};

// E2E key backup — allows restoring keys on incognito / new devices
addColumn('users', 'private_key', 'TEXT');

addColumn('student_profiles', 'educational_qualification', 'TEXT');
addColumn('student_profiles', 'profession', 'TEXT');

addColumn('instructor_profiles', 'gender', 'TEXT');
addColumn('instructor_profiles', 'birthday', 'TEXT');
addColumn('instructor_profiles', 'present_address', 'TEXT');
addColumn('instructor_profiles', 'permanent_address', 'TEXT');
addColumn('instructor_profiles', 'educational_qualification', 'TEXT');
addColumn('instructor_profiles', 'profession', 'TEXT');
addColumn('instructor_profiles', 'bfi_batch', 'TEXT');

console.log('Done!');
