import db from './server/db/database.js';
const user = db.prepare('SELECT id, username, email FROM users WHERE role = ?').get('admin');
console.log('Admin user:', user);
