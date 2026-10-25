import Database from 'better-sqlite3';

const db = new Database('server/bfi_classroom.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in database:');
for (const t of tables) {
  try {
    const c = db.prepare(`SELECT count(*) as count FROM ${t.name}`).get().count;
    if (c > 0) console.log(`  ${t.name}: ${c}`);
  } catch (e) {
    /* empty */
  }
}
