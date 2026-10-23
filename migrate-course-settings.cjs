const db = require('better-sqlite3')('server/bfi_classroom.db');

try {
  // 1. Create course_settings table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS course_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_name TEXT NOT NULL,
      batch_number TEXT NOT NULL DEFAULT 'DEFAULT',
      total_classes INTEGER DEFAULT 22,
      exam_max_score INTEGER DEFAULT 100,
      exam_pass_mark INTEGER DEFAULT 33,
      has_assignment INTEGER DEFAULT 0,
      assignments TEXT DEFAULT '[]',
      has_phase2 INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(course_name, batch_number)
    )
  `).run();
  console.log("Created course_settings table.");

  // 2. Add assignment_scores column if not exists
  const tableInfo = db.prepare("PRAGMA table_info('student_course_enrollments')").all();
  if (!tableInfo.find(c => c.name === 'assignment_scores')) {
    db.prepare(`ALTER TABLE student_course_enrollments ADD COLUMN assignment_scores TEXT DEFAULT '{}'`).run();
    console.log("Added assignment_scores column to student_course_enrollments.");
  } else {
    console.log("assignment_scores column already exists.");
  }

  // 3. Migrate data
  // For online filmmaking course, read assignment_screenplay and assignment_shooting_script and move to assignment_scores
  const enrollmentsToMigrate = db.prepare(`SELECT id, assignment_screenplay, assignment_shooting_script FROM student_course_enrollments WHERE course_name = 'Online Filmmaking Course' AND assignment_scores = '{}'`).all();
  
  const updateStmt = db.prepare(`UPDATE student_course_enrollments SET assignment_scores = ? WHERE id = ?`);
  let migrationCount = 0;
  for (const e of enrollmentsToMigrate) {
    const scores = {
      screenplay: e.assignment_screenplay || 0,
      shooting_script: e.assignment_shooting_script || 0
    };
    updateStmt.run(JSON.stringify(scores), e.id);
    migrationCount++;
  }
  console.log(`Migrated ${migrationCount} enrollments to use assignment_scores.`);

  // 4. Insert Defaults
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO course_settings 
    (course_name, batch_number, total_classes, exam_max_score, exam_pass_mark, has_assignment, assignments, has_phase2)
    VALUES (?, 'DEFAULT', ?, ?, ?, ?, ?, ?)
  `);

  insertSetting.run(
    'Online Filmmaking Course', 22, 80, 33, 1,
    JSON.stringify([
      { id: 'screenplay', name: 'Screenplay', max_score: 10 },
      { id: 'shooting_script', name: 'Shooting Script', max_score: 10 }
    ]),
    1
  );

  insertSetting.run(
    'Film Appreciation Course', 22, 100, 33, 0,
    '[]',
    0
  );

  console.log("Inserted default course settings.");

} catch (e) {
  console.error("Migration error:", e);
}
