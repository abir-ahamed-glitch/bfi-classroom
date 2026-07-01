const fs = require('fs');
const Database = require('better-sqlite3');

const sandipList = JSON.parse(fs.readFileSync('E:/Antigravity/Project 2 - BFI Classroom/server/scripts/sandip_list.json', 'utf8'));
let legacyResults = [];
try {
    const raw = fs.readFileSync('E:/Antigravity/Project 2 - BFI Classroom/server/scripts/legacy_results_utf8.json', 'utf8');
    legacyResults = JSON.parse(raw);
} catch (err) {}

const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');

function normalize(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

let marksUpdated = 0;

for (const student of sandipList) {
    const targetNorm = normalize(student.name);
    if (targetNorm.length < 4) continue;

    // Find in legacy results
    let marks = null;
    for (const row of legacyResults) {
        // usually columns are Col1, Col2, Col3...
        // let's search if any column contains the name
        let hasName = false;
        for (const key in row) {
            if (key.startsWith('Col') && row[key]) {
                const cellNorm = normalize(row[key]);
                if (cellNorm.includes(targetNorm) || targetNorm.includes(cellNorm)) {
                    hasName = true;
                    break;
                }
            }
        }
        
        if (hasName) {
            // try to find a number in other columns
            for (const key in row) {
                if (key.startsWith('Col') && row[key]) {
                    const cellTxt = row[key].trim();
                    const num = parseInt(cellTxt, 10);
                    if (!isNaN(num) && num > 30 && num <= 100) {
                        marks = num;
                    }
                }
            }
            if (marks) break;
        }
    }

    if (marks) {
        const batchNumber = String(student.batch);
        const batchNumberFloat = student.batch + '.0';
        
        const dbStudent = db.prepare(`
            SELECT e.id as enrollment_id
            FROM users u
            JOIN batch_students bs ON u.id = bs.student_id
            JOIN batches b ON bs.batch_id = b.id
            JOIN student_profiles sp ON u.id = sp.user_id
            JOIN student_course_enrollments e ON u.id = e.user_id
            WHERE (b.batch_number = ? OR b.batch_number = ?)
              AND LOWER(TRIM(sp.full_name)) LIKE ?
              AND e.course_name = 'Film Appreciation Course'
        `).get(batchNumber, batchNumberFloat, `%${student.name.split(' ')[0]}%`);
        
        if (dbStudent) {
            db.prepare('UPDATE student_course_enrollments SET exam_written = ? WHERE id = ?').run(marks, dbStudent.enrollment_id);
            marksUpdated++;
        }
    }
}

console.log(`Updated exact marks for ${marksUpdated} students.`);
