const fs = require('fs');
const Database = require('better-sqlite3');

const sandipList = JSON.parse(fs.readFileSync('E:/Antigravity/Project 2 - BFI Classroom/server/scripts/sandip_list.json', 'utf8'));
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');

let updatedCount = 0;
let notFound = [];

// Helper to normalize names
function normalize(name) {
    return name.toLowerCase()
        .replace(/md\./g, '')
        .replace(/md /g, '')
        .replace(/a\. f\. m\./g, '')
        .replace(/a\. n\. m\./g, '')
        .replace(/a\. h\. m\./g, '')
        .replace(/m\. a\./g, '')
        .replace(/s\. m\./g, '')
        .replace(/kazi/g, '')
        .replace(/engr\./g, '')
        .replace(/abu/g, '')
        .replace(/syed/g, '')
        .replace(/mohammad/g, '')
        .replace(/muhammad/g, '')
        .replace(/[^a-z0-9]/g, '');
}

for (const student of sandipList) {
    const batchNumber = String(student.batch);
    const batchNumberFloat = student.batch + '.0';

    // Get all students in this batch
    const dbStudents = db.prepare(`
        SELECT u.id, sp.full_name, e.course_name, e.id as enrollment_id
        FROM users u
        JOIN batch_students bs ON u.id = bs.student_id
        JOIN batches b ON bs.batch_id = b.id
        JOIN student_profiles sp ON u.id = sp.user_id
        JOIN student_course_enrollments e ON u.id = e.user_id
        WHERE (b.batch_number = ? OR b.batch_number = ?)
          AND e.course_name = 'Film Appreciation Course'
    `).all(batchNumber, batchNumberFloat);

    const targetNorm = normalize(student.name);
    let matchedStudent = null;

    // 1. Exact norm match
    for (const dbStudent of dbStudents) {
        if (normalize(dbStudent.full_name) === targetNorm) {
            matchedStudent = dbStudent;
            break;
        }
    }

    // 2. Contains norm match (if targetNorm is > 5 chars)
    if (!matchedStudent && targetNorm.length > 5) {
        for (const dbStudent of dbStudents) {
            const dbNorm = normalize(dbStudent.full_name);
            if (dbNorm.includes(targetNorm) || targetNorm.includes(dbNorm)) {
                matchedStudent = dbStudent;
                break;
            }
        }
    }

    // 3. Fallback: match by last 2 words (e.g. "Fazlur Rahman")
    if (!matchedStudent) {
        const words = student.name.split(/[\s,()]+/).filter(w => w.length > 2 && w.toLowerCase() !== 'md.' && w.toLowerCase() !== 'md');
        if (words.length >= 2) {
            const lastTwo = words.slice(-2).join('').toLowerCase();
            for (const dbStudent of dbStudents) {
                const dbNorm = normalize(dbStudent.full_name);
                if (dbNorm.includes(lastTwo)) {
                    matchedStudent = dbStudent;
                    break;
                }
            }
        } else if (words.length === 1) {
            const lastOne = words[0].toLowerCase();
            for (const dbStudent of dbStudents) {
                const dbNorm = normalize(dbStudent.full_name);
                if (dbNorm.includes(lastOne)) {
                    matchedStudent = dbStudent;
                    break;
                }
            }
        }
    }

    if (matchedStudent) {
        db.prepare('UPDATE student_course_enrollments SET step2_completed = 1 WHERE id = ?').run(matchedStudent.enrollment_id);
        db.prepare('UPDATE student_profiles SET phase1_passed = 1 WHERE user_id = ?').run(matchedStudent.id);
        updatedCount++;
    } else {
        notFound.push(`${student.name} (Batch ${batchNumber})`);
    }
}

console.log(`Updated ${updatedCount} students to Passed.`);
if (notFound.length > 0) {
    console.log(`Could not find ${notFound.length} students in the database:`);
    console.log(notFound.join('\n'));
}
