import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'server', 'bfi_classroom.db');
const db = new Database(dbPath);

console.log('--- ALL PROJECTS ---');
const projects = db.prepare('SELECT id, title, poster_url, thumbnail_url, media_link FROM projects').all();
console.log(JSON.stringify(projects, null, 2));

console.log('--- ALL USERS ---');
const users = db.prepare('SELECT id, username, profile_picture FROM users').all();
console.log(JSON.stringify(users, null, 2));
