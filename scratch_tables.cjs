const Database = require('better-sqlite3');
const db = new Database('server/bfi_database.sqlite');
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
