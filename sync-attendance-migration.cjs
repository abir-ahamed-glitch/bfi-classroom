const Database = require('better-sqlite3');
const db = new Database('./server/bfi_classroom.db');

try {
  const settings = db.prepare('SELECT * FROM course_settings').all();
  console.log(`Found ${settings.length} course settings. Syncing attendance totals...`);

  const transaction = db.transaction(() => {
    for (const s of settings) {
      if (s.batch_number === 'DEFAULT') {
        const res = db.prepare(`
          UPDATE student_course_enrollments
          SET attendance_total = ?,
              updated_at = datetime('now')
          WHERE course_name = ? AND user_id NOT IN (
            SELECT bs.student_id
            FROM batch_students bs
            JOIN batches b ON bs.batch_id = b.id
            JOIN course_settings cs ON cs.course_name = b.course_name AND cs.batch_number = b.batch_number
            WHERE b.course_name = ? AND cs.batch_number != 'DEFAULT'
          )
        `).run(s.total_classes, s.course_name, s.course_name);
        console.log(`Synced default total_classes (${s.total_classes}) for ${s.course_name}: updated ${res.changes} rows`);
      } else {
        const res = db.prepare(`
          UPDATE student_course_enrollments
          SET attendance_total = ?,
              updated_at = datetime('now')
          WHERE course_name = ? AND user_id IN (
            SELECT bs.student_id
            FROM batch_students bs
            JOIN batches b ON bs.batch_id = b.id
            WHERE b.course_name = ? AND b.batch_number = ?
          )
        `).run(s.total_classes, s.course_name, s.course_name, s.batch_number);
        console.log(`Synced custom total_classes (${s.total_classes}) for ${s.course_name} (Batch: ${s.batch_number}): updated ${res.changes} rows`);
      }
    }
  });

  transaction();
  console.log('✅ Attendance total sync migration completed successfully.');
} catch (err) {
  console.error('Migration failed:', err);
}
