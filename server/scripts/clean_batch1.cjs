const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');

const validNames = [
  'Md. Riaz-Ur-Rahman',
  'Md. Nazmus Sakib',
  'Md. Fazlur Rahman',
  'Ashfaque Ahmed',
  'Rabiul Hassan',
  'Mehedee Hassan',
  'Dalia Rahman',
  'A. H. M. Sabir',
  'Sumit Kumar Mondal',
  'Shabin Ashfarah Khondaker',
  'Abu Musaddek Mohammad Masum',
  'Sayedul Haque',
  'Md. Imtiazul Islam',
  'Abu Hasim Masuduzzaman',
  'Ahmed Rubyat Iftekhar',
  'Amely Roy (Boishakhi)',
  'Md. Yeasin Khan',
  'Mohammed Jahangir Hossain',
  'Rajib Bin Mahmud',
  'Shahriar Salam',
  'Md. Mohashin Ahamed (Akash)',
  'Khandoker Yead Morshad',
  'Md. Anwar Ul Azim Shiron',
  'Md. Asraful Akter Emon',
  'Syed Tanvinur Rahman',
  'Arabinda Sarker',
  'Md. Monirul Islam Khan'
].map(n => n.toLowerCase());

// Get batch 1 ID
const batch = db.prepare("SELECT id FROM batches WHERE batch_number IN ('1', '1.0')").get();
if (!batch) {
    console.log("Batch 1 not found");
    process.exit(1);
}

// Get all students in batch 1
const students = db.prepare(`
    SELECT p.id as profile_id, p.user_id, p.full_name, p.student_id 
    FROM student_profiles p 
    WHERE p.batch_number IN ('1', '1.0')
`).all();

let removedCount = 0;
let keptCount = 0;

for (const student of students) {
    if (student.full_name.toLowerCase() === 'fail') {
        // Delete this mistake completely
        db.prepare("DELETE FROM student_course_enrollments WHERE user_id = ?").run(student.user_id);
        db.prepare("DELETE FROM batch_students WHERE student_id = ?").run(student.user_id);
        db.prepare("DELETE FROM student_profiles WHERE user_id = ?").run(student.user_id);
        db.prepare("DELETE FROM users WHERE id = ?").run(student.user_id);
        console.log("Deleted mistake student 'Fail'");
        continue;
    }
    
    // Check if name is in valid list
    const nameLower = student.full_name.toLowerCase();
    const isValid = validNames.some(v => nameLower.includes(v) || v.includes(nameLower));
    
    if (isValid) {
        keptCount++;
    } else {
        console.log(`Removing from Batch 1: ${student.full_name}`);
        // Remove from batch
        db.prepare("DELETE FROM batch_students WHERE batch_id = ? AND student_id = ?").run(batch.id, student.user_id);
        db.prepare("UPDATE student_profiles SET batch_number = '' WHERE user_id = ?").run(student.user_id);
        removedCount++;
    }
}

console.log(`\nKept: ${keptCount}`);
console.log(`Removed: ${removedCount}`);
