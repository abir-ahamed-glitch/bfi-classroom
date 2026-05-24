const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'server', 'bfi_classroom.db');
if (!fs.existsSync(dbPath)) {
  console.log('DB not found at', dbPath);
  process.exit(1);
}
const db = new Database(dbPath);

try {
  const hash = bcrypt.hashSync('demo123', 10);
  
  // Delete existing demo user if exists
  db.prepare('DELETE FROM users WHERE username = ?').run('demo_student');

  const insertUser = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, first_name, last_name, profile_picture)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = insertUser.run('demo_student', 'demo@bficlassroom.com', hash, 'student', 'Demo', 'Student', 'avatars/male1.png');
  const userId = result.lastInsertRowid;

  const insertProfile = db.prepare(`
    INSERT INTO student_profiles (user_id, full_name, batch_number, student_id, gender)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertProfile.run(userId, 'Demo Student', '78', 'BFI-78-099', 'Male');

  const insertEnrollment = db.prepare(`
    INSERT INTO course_enrollments (user_id, course_id, status, attendance_classes, attendance_total, exam_written, assignment_screenplay, assignment_shooting_script, final_mark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  insertEnrollment.run(userId, 'online-filmmaking', 'enrolled', 24, 26, 30, 8, 9, 47);

  console.log('Demo user successfully injected!');
  console.log('Email: demo@bficlassroom.com');
  console.log('Password: demo123');

} catch (err) {
  console.error('Error seeding demo user:', err);
}
