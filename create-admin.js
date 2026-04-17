import bcrypt from 'bcryptjs';
import db from './server/db/database.js';

const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('Usage: node create-admin.js <username> <email> <password>');
  console.log('Example: node create-admin.js admin2 admin2@bfibd.org MySecurePassword!');
  process.exit(1);
}

const [username, email, password] = args;

try {
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  
  if (existingUser) {
    console.error('Error: A user with this email or username already exists.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  
  db.prepare(`
    INSERT INTO users (username, email, password_hash, role, first_name, last_name)
    VALUES (?, ?, ?, 'admin', ?, ?)
  `).run(username, email, hash, 'BFI', 'Admin');

  console.log(`✅ Successfully created new admin account!`);
  console.log(`Username: ${username}`);
  console.log(`Email: ${email}`);
  
} catch (err) {
  console.error('Failed to create admin:', err.message);
}
