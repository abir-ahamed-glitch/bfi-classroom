const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');
const bcrypt = require('bcryptjs'); // Assuming bcryptjs is installed or we can just insert standard hash
// Wait, we can just insert a plain string since we don't know the password, or insert a dummy hash. Let's just use empty string or random hash.
const passwordHash = '$2a$10$C8qQYqP1K9n.q3G/eG7zUeO/K9q.q3G/eG7zUeO/K9q.q3G/eG7zUeO/'; // Dummy hash

const missingStudents = [
    { name: "Sagir Mostafa", batch: 1 },
    { name: "Md. Rakibul Hasan", batch: 1 },
    { name: "Mridul Chowdhury", batch: 1 },
    { name: "Masudur Rahman Mollik", batch: 1 },
    { name: "Rowshon Jhunu", batch: 1 },
    { name: "Siddiqur Rayhan", batch: 1 },
    { name: "Nikesh Amit", batch: 1 },
    { name: "Syed Umar Chisty", batch: 1 },
    { name: "Kazi Sufia Akhtar", batch: 1 },
    { name: "Abdus Samad (Babu)", batch: 1 },
    { name: "Md. Ohedul Hoque Milon", batch: 9 },
    { name: "Samapto Hossain", batch: 9 },
    { name: "Ashik Ishtiaq", batch: 9 },
    { name: "Md. Moinul Hasan Hira", batch: 9 }
];

let addedCount = 0;

for (const student of missingStudents) {
    // 1. Get batch ID
    const batchInfo = db.prepare('SELECT id, course_name FROM batches WHERE batch_number = ? AND course_name = ? LIMIT 1').get(String(student.batch), 'Film Appreciation Course');
    
    if (!batchInfo) {
        console.error(`Batch ${student.batch} not found!`);
        continue;
    }
    
    // Create random email and phone
    const email = `missing_${student.name.replace(/[^a-zA-Z0-9]/g, '')}_${student.batch}@bfi.edu.bd`.toLowerCase();
    const phone = `000000000${addedCount}`;

    const username = `missing_${addedCount}_${student.batch}`;
    const nameParts = student.name.split(' ');
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Unknown';
    
    // Insert user
    const insertUser = db.prepare(`
        INSERT INTO users (username, email, password_hash, role, first_name, last_name)
        VALUES (?, ?, ?, 'student', ?, ?)
    `);
    const userResult = insertUser.run(username, email, passwordHash, firstName, lastName);
    const userId = userResult.lastInsertRowid;

    // Insert profile
    const insertProfile = db.prepare(`
        INSERT INTO student_profiles (user_id, full_name, phase1_passed)
        VALUES (?, ?, 1)
    `);
    insertProfile.run(userId, student.name);

    // Insert batch_students
    const insertBatchStudent = db.prepare(`
        INSERT INTO batch_students (batch_id, student_id)
        VALUES (?, ?)
    `);
    insertBatchStudent.run(batchInfo.id, userId);

    // Insert enrollment
    const insertEnrollment = db.prepare(`
        INSERT INTO student_course_enrollments (user_id, course_name, course_type, step1_completed, step2_completed)
        VALUES (?, ?, 'Offline', 1, 1)
    `);
    insertEnrollment.run(userId, batchInfo.course_name);

    addedCount++;
    console.log(`Added ${student.name} to Batch ${student.batch}`);
}

console.log(`Successfully added ${addedCount} missing students.`);
