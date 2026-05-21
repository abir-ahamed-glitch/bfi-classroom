import db from './server/db/database.js';

const first_name = 'Abir';
const last_name = 'Ahmad';
const normalizedUsername = 'admin@abir';
const normalizedEmail = 'testnew@bfibd.org';
const id = 1;

db.prepare('UPDATE users SET first_name = ?, last_name = ?, username = ?, email = COALESCE(?, email) WHERE id = ?')
  .run(first_name.trim(), (last_name || '').trim(), normalizedUsername, normalizedEmail || null, id);

const user = db.prepare('SELECT id, username, email FROM users WHERE role = ?').get('admin');
console.log('Admin user after update:', user);
