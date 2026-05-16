import Database from 'better-sqlite3';


const dbPath = 'e:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db';
const db = new Database(dbPath);

const project = db.prepare("SELECT * FROM projects WHERE title LIKE '%একাত্তরের%'").get();
console.log('Project Data:', JSON.stringify(project, null, 2));
