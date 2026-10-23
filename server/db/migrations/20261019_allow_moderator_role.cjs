const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'bfi_classroom.db');
const db = new Database(dbPath);

console.log('Running migration: allow moderator role in users table CHECK constraint...');

db.pragma('foreign_keys = OFF');

try {
  db.transaction(() => {
    const userRow = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get();
    if (!userRow || !userRow.sql) {
      throw new Error('users table not found');
    }

    const currentSql = userRow.sql;
    if (currentSql.includes("'moderator'")) {
      console.log('users table already allows moderator role.');
      return;
    }

    const updatedSql = currentSql.replace(
      "CHECK(role IN ('admin', 'instructor', 'student'))",
      "CHECK(role IN ('admin', 'instructor', 'student', 'moderator'))"
    );

    if (updatedSql === currentSql) {
      console.log('Could not find exact CHECK clause to replace; checking regex...');
      const regexSql = currentSql.replace(
        /CHECK\s*\(\s*role\s+IN\s*\([^\)]+\)\s*\)/i,
        "CHECK(role IN ('admin', 'instructor', 'student', 'moderator'))"
      );
      if (regexSql === currentSql) {
        throw new Error('Failed to locate role CHECK constraint on users table');
      }
      db.prepare(regexSql.replace(/^CREATE TABLE users/i, 'CREATE TABLE users_temp')).run();
    } else {
      db.prepare(updatedSql.replace(/^CREATE TABLE users/i, 'CREATE TABLE users_temp')).run();
    }

    db.prepare('INSERT INTO users_temp SELECT * FROM users').run();
    db.prepare('DROP TABLE users').run();
    db.prepare('ALTER TABLE users_temp RENAME TO users').run();

    console.log('Migration successful: users table now allows "moderator" role.');
  })();
} catch (err) {
  console.error('Migration error:', err);
  process.exit(1);
} finally {
  db.pragma('foreign_keys = ON');
  db.close();
}
