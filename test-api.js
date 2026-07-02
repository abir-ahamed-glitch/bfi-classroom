import Database from 'better-sqlite3';
const db = new Database('server/bfi_classroom.db');
db.prepare("DELETE FROM announcements WHERE id = 43").run();
db.prepare("DELETE FROM trash_audit_log WHERE entity_id = 43 AND entity_type = 'announcements'").run();
console.log("Cleanup complete");
