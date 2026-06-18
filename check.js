import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'server', 'bfi_classroom.db'));
console.log('Student Profile for 14:');
console.log(db.prepare("SELECT * FROM student_profiles WHERE user_id = 14").all());
