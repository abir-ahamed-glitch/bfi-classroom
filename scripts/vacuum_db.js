import Database from 'better-sqlite3';

const db = new Database('server/bfi_classroom.db');
console.log('Vacuuming into clean file...');
db.exec("VACUUM INTO 'server/bfi_classroom_clean.db'");
console.log('Done!');
