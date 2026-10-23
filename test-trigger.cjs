const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS set_default_attendance_total
    AFTER INSERT ON student_course_enrollments
    FOR EACH ROW
    WHEN NEW.attendance_total = 22
    BEGIN
      UPDATE student_course_enrollments
      SET attendance_total = COALESCE(
        (SELECT total_classes FROM course_settings WHERE course_name = NEW.course_name AND batch_number = (
          SELECT b.batch_number 
          FROM batch_students bs
          JOIN batches b ON bs.batch_id = b.id
          WHERE bs.student_id = NEW.user_id AND b.course_name = NEW.course_name
          LIMIT 1
        )),
        (SELECT total_classes FROM course_settings WHERE course_name = NEW.course_name AND batch_number = 'DEFAULT'),
        22
      )
      WHERE id = NEW.id;
    END;
  `);
  console.log('✅ Trigger created successfully.');
} catch (err) {
  console.error('Trigger creation failed:', err);
}
