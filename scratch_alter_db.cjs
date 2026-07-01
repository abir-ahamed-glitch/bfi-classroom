const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

try {
  db.exec(`ALTER TABLE student_profiles ADD COLUMN additional_info TEXT;`);
  console.log("Successfully added additional_info to student_profiles.");
} catch (error) {
  if (error.message.includes("duplicate column name")) {
    console.log("Column additional_info already exists.");
  } else {
    console.error("Error altering table:", error);
  }
}
