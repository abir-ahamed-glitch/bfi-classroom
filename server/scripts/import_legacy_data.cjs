const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, '../bfi_classroom.db'));

const BASE_DIR = 'E:\\OFFICE FILES (backup)\\Old hard disk documents\\OLD Documents_Ex Hard Disk\\All important documents\\BFI';
const PS_SCRIPT = path.join(__dirname, '../../read_doc.ps1');

function readWordDoc(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        console.log(`Reading: ${filePath}`);
        const result = execSync(`powershell -ExecutionPolicy Bypass -File "${PS_SCRIPT}" -FilePath "${filePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return result.toString();
    } catch (e) {
        console.error(`Error reading doc: ${filePath}`);
        return null;
    }
}

function parseResultText(text) {
    const students = [];
    
    const cells = text.split('\x07').map(c => c.replace(/[\r\n]/g, '').trim()).filter(c => c !== '');
    
    // Check if we have enough cells to parse as a table
    if (cells.length > 20) {
        const seenRolls = new Set();
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (/^\d{2,3}$/.test(cell)) {
                const roll = cell;
                const name = cells[i+1];
                if (!name || name.toLowerCase() === 'pass' || name.toLowerCase() === 'fail' || /^\d+$/.test(name)) continue;
                
                if (seenRolls.has(roll)) {
                    i++; // Skip name cell to advance loop
                    continue;
                }
                
                let score = 0;
                let passed = false;
                let foundObtained = false;
                
                for (let j = 2; j <= 4; j++) {
                    if (i+j >= cells.length) break;
                    const val = cells[i+j].toLowerCase();
                    if (val === 'pass' || val === 'fail') {
                        passed = val === 'pass';
                        if (!foundObtained) score = passed ? 60 : 20; // Default fallback if no score found
                        break;
                    }
                    if (/^\d{1,3}$/.test(val)) {
                        if (val === '100' && !foundObtained) {
                           // This is likely 'Total Marks'. Look ahead for the next number.
                           if (i+j+1 < cells.length && /^\d{1,3}$/.test(cells[i+j+1].toLowerCase())) {
                               continue;
                           }
                        }
                        score = parseInt(val, 10);
                        foundObtained = true;
                    }
                }
                
                seenRolls.add(roll);
                students.push({ roll, name, score, passed });
                i += 3; // jump ahead to next potential row
            }
        }
        if (students.length > 0) return students;
    }
    
    // Fallback if not a \x07 separated table
    const regex = /(\d{2,3})[\s\x07\r\n]+([a-zA-Z\.\s\-\(\)]+?)[\s\x07\r\n]+(Pass|Fail|\d{2,3})/gi;
    let match;
    const seenRolls = new Set();
    while ((match = regex.exec(text)) !== null) {
        const roll = match[1].trim();
        const rawName = match[2].trim();
        const name = rawName.replace(/Signature$/, '').trim();
        const scoreRaw = match[3].trim().toLowerCase();
        
        if (name.toLowerCase().includes("name") && name.toLowerCase().includes("remarks")) continue;
        if (name.toLowerCase() === "pass" || name.toLowerCase() === "fail") continue;
        
        if (seenRolls.has(roll)) continue;
        
        let score = 0;
        let passed = false;
        if (scoreRaw === 'pass') {
            score = 60;
            passed = true;
        } else if (scoreRaw === 'fail') {
            score = 20;
            passed = false;
        } else {
            score = parseInt(scoreRaw, 10) || 0;
            passed = score >= 33;
        }
        
        seenRolls.add(roll);
        students.push({ roll, name, score, passed });
    }
    return students;
}

function parseAttendanceText(text) {
    const records = {};
    const regex = /(\d{2,3})[\s\x07\r\n]+([a-zA-Z\.\s\-\(\)]+?)[\s\x07\r\n]+(\d{1,2})[\s\x07\r\n]+(\d{1,2})[\s\x07\r\n]+(\d{1,2})[\s\x07\r\n]+(\d{1,3})%/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const roll = match[1].trim();
        const name = match[2].trim();
        const total = parseInt(match[3], 10);
        const present = parseInt(match[4], 10);
        records[name.toLowerCase()] = { present, total };
    }
    return records;
}

function parseProfileText(text) {
    const profiles = {};
    // This is very unstructured. Let's look for "Phone : 9004422 32 Kazi Sufia Akhtar House#38, Road#9..."
    // Just finding Name and trying to extract chunk around it.
    // For simplicity, we'll store the whole text snippet if we can find the name.
    return profiles;
}

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function processBatch(batchNumber, folderPath) {
    console.log(`\n=== Processing Batch ${batchNumber} ===`);
    const files = fs.readdirSync(folderPath);
    
    const resultFile = files.find(f => f.toLowerCase().includes('result') && f.endsWith('.doc'));
    const attFile = files.find(f => f.toLowerCase().includes('present') && f.endsWith('.doc'));
    
    if (!resultFile) {
        console.log(`No Result file found for Batch ${batchNumber}, skipping.`);
        return;
    }
    
    const resultText = readWordDoc(path.join(folderPath, resultFile));
    if (!resultText) return;
    
    const students = parseResultText(resultText);
    console.log(`Found ${students.length} students in results.`);
    
    let attendance = {};
    if (attFile) {
        const attText = readWordDoc(path.join(folderPath, attFile));
        if (attText) {
            attendance = parseAttendanceText(attText);
            console.log(`Found ${Object.keys(attendance).length} attendance records.`);
        }
    }
    
    const batchName = `${getOrdinal(batchNumber)} Batch`;
    
    // Ensure batch exists
    let batch = db.prepare('SELECT id FROM batches WHERE batch_number = ? AND course_name = ?').get(batchNumber, 'Film Appreciation Course');
    if (!batch) {
        const adminId = 1; // Default admin
        const info = db.prepare("INSERT INTO batches (batch_name, batch_number, course_name, status, created_by) VALUES (?, ?, 'Film Appreciation Course', 'completed', ?)").run(batchName, batchNumber, adminId);
        batch = { id: info.lastInsertRowid };
    }
    
    for (const student of students) {
        // Try to find user
        let profile = db.prepare('SELECT user_id, full_name FROM student_profiles WHERE LOWER(full_name) = ?').get(student.name.toLowerCase());
        let userId;
        
        if (!profile) {
            // Create user
            const baseUsername = student.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const username = `${baseUsername}.${Math.random().toString(36).substring(2, 6)}`;
            const email = `${username}@bfi-app.org`;
            const password = bcrypt.hashSync('bfi@' + Math.floor(100000 + Math.random() * 900000), 12);
            const nameParts = student.name.split(' ');
            const firstName = nameParts[0] || 'Student';
            const lastName = nameParts.slice(1).join(' ') || 'Student';
            
            const uInfo = db.prepare("INSERT INTO users (username, email, password_hash, role, first_name, last_name) VALUES (?, ?, ?, 'student', ?, ?)").run(username, email, password, firstName, lastName);
            userId = uInfo.lastInsertRowid;
            
            // Student ID
            const cleanSn = String(student.roll).padStart(2, '0');
            const cleanBatch = String(batchNumber).padStart(2, '0');
            const studentIdStr = `BFI${cleanSn}${cleanBatch}2005${Math.floor(Math.random() * 1000)}`; 
            
            db.prepare("INSERT INTO student_profiles (user_id, full_name, student_id, batch_number) VALUES (?, ?, ?, ?)").run(userId, student.name, studentIdStr, batchNumber);
        } else {
            userId = profile.user_id;
            // Ensure batch number is set on profile
            db.prepare("UPDATE student_profiles SET batch_number = ? WHERE user_id = ?").run(batchNumber, userId);
        }
        
        // Link to batch roster
        db.prepare("INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (?, ?)").run(batch.id, userId);
        
        // Course enrollment
        let enroll = db.prepare("SELECT id FROM student_course_enrollments WHERE user_id = ? AND course_name = 'Film Appreciation Course'").get(userId);
        if (!enroll) {
            db.prepare("INSERT INTO student_course_enrollments (user_id, course_name, course_type) VALUES (?, 'Film Appreciation Course', 'workshop')").run(userId);
        }
        
        // Attendance
        let attTotal = 0;
        let attPresent = 0;
        
        // Try finding by exact match or substring
        for (const [aName, aData] of Object.entries(attendance)) {
            if (aName.includes(student.name.toLowerCase()) || student.name.toLowerCase().includes(aName)) {
                attTotal = aData.total;
                attPresent = aData.present;
                break;
            }
        }
        
        // Update exam, step2, step4, attendance
        db.prepare(`
            UPDATE student_course_enrollments 
            SET exam_written = ?, step2_completed = ?, step4_completed = ?,
                attendance_total = ?, attendance_classes = ?
            WHERE user_id = ? AND course_name = 'Film Appreciation Course'
        `).run(student.score, student.passed ? 1 : 0, student.passed ? 1 : 0, attTotal, attPresent, userId);
        
        console.log(`Updated: ${student.name} (Score: ${student.score}, Att: ${attPresent}/${attTotal})`);
    }
}

function run() {
    const dirs = fs.readdirSync(BASE_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
        const match = dir.name.match(/^(\d+)(st|nd|rd|th|\-th) Batch/i);
        if (match) {
            const batchNum = parseInt(match[1], 10);
            if (batchNum >= 1 && batchNum <= 22) {
                processBatch(batchNum, path.join(BASE_DIR, dir.name));
            }
        }
    }
    console.log("\nDONE IMPORTING BATCHES 1-22");
}

run();
