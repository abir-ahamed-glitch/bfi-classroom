const Database = require('better-sqlite3'); 
const db = new Database('server/bfi_classroom.db'); 
db.exec(`CREATE TABLE IF NOT EXISTS admin_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, full_name TEXT NOT NULL, gender TEXT, birthday TEXT, present_address TEXT, permanent_address TEXT, educational_qualification TEXT, profession TEXT, whatsapp_number TEXT, bio TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);`); 
const admin = db.prepare('SELECT id, first_name, last_name FROM users WHERE role = ? AND username = ?').get('admin', 'admin'); 
if (admin) { 
  db.prepare('INSERT OR IGNORE INTO admin_profiles (user_id, full_name) VALUES (?, ?)').run(admin.id, admin.first_name + ' ' + admin.last_name); 
} 
console.log('Migrated admin_profiles!');
