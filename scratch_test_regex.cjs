const { execSync } = require('child_process');

function readWordDoc(filePath) {
    const result = execSync(`powershell -ExecutionPolicy Bypass -File "E:\\Antigravity\\Project 2 - BFI Classroom\\read_doc.ps1" -FilePath "${filePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return result.toString();
}

const text = readWordDoc("E:\\OFFICE FILES (backup)\\Old hard disk documents\\OLD Documents_Ex Hard Disk\\All important documents\\BFI\\2nd Batch\\Result of Examination.doc");

console.log(JSON.stringify(text));

const regex = /(\d{2})\s+([a-zA-Z\.\s\-\(\)]+?)\s+(Pass|Fail|\d{2,3})(?=\s|$)/gi;
let match;
const students = [];
while ((match = regex.exec(text)) !== null) {
    students.push({ roll: match[1], name: match[2], score: match[3] });
}
console.log(students);
