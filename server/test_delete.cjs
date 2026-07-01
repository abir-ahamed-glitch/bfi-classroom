const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');

const id = 1915; // Example user ID (Abdus Samad's user ID)
try {
  db.prepare('BEGIN TRANSACTION').run();
  
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM post_likes WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM post_comments WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?').run(id, id);
  db.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM message_reports WHERE reporter_id = ? OR reported_user_id = ?').run(id, id);
  db.prepare('DELETE FROM message_hidden_for_users WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(id, id);
  db.prepare('DELETE FROM social_links WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM awards WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM project_credits WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(id);
  db.prepare('DELETE FROM projects WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM student_experiences WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM community_posts WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM student_course_enrollments WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM batch_students WHERE student_id = ?').run(id);
  db.prepare('DELETE FROM bfiaa_members WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  console.log('Success');
  db.prepare('ROLLBACK').run();
} catch (error) {
  console.error('Constraint Failed:', error.message);
  db.prepare('ROLLBACK').run();
}
