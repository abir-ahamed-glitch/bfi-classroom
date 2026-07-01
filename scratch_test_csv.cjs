const XLSX = require('xlsx');

const filePath = 'E:/OFFICE FILES (backup)/Old hard disk documents/OLD Documents_Ex Hard Disk/All important documents/BFI/1st Batch/Result of Examination (Cleaned for Upload).csv';
const wb = XLSX.readFile(filePath);
const wsname = wb.SheetNames[0];
const ws = wb.Sheets[wsname];
let data2D = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

const mappedResults = [];

const looksLikeName = (val) => {
if (!val || val.length < 3 || val.length > 50) return false;
if (/^\d/.test(val)) return false;
if (/@/.test(val)) return false;
if (/\b(marks|roll|pass|fail|result|exam)\b/i.test(val)) return false;
return /^[a-zA-Z\s.-]+$/.test(val);
};

for (let i = 0; i < data2D.length; i++) {
const row = data2D[i];
if (!row || !Array.isArray(row) || row.length === 0) continue;

const rowText = row.join(' ').toLowerCase();

if (rowText.includes('total marks') || rowText.includes('obtained marks') || rowText.includes('result of the examination')) continue;

let name = '';
let rollNo = '';
let obtainedMarks = null;
let totalMarks = 100;
let remarks = '';

for (let j = 0; j < row.length; j++) {
    const cell = String(row[j] || '').trim();
    if (!cell) continue;
    
    const lowerCell = cell.toLowerCase();

    if (lowerCell === 'pass' || lowerCell === 'fail' || lowerCell === 'passed' || lowerCell === 'failed') {
    remarks = lowerCell.includes('pass') ? 'Pass' : 'Fail';
    continue;
    }

    if (/^\d{1,3}(\.\d+)?$/.test(cell)) {
        const num = parseFloat(cell);
        if (num <= 100 && num >= 0) {
        if (!rollNo && num < 100 && String(num).length <= 2) {
            rollNo = cell;
        } else if (obtainedMarks === null) {
            obtainedMarks = num;
        } else {
            if (obtainedMarks === 100 && num <= 100) {
            totalMarks = 100;
            obtainedMarks = num;
            } else if (num === 100 && obtainedMarks <= 100) {
            totalMarks = 100;
            }
        }
        }
        continue;
    }
    
    if (!name && looksLikeName(cell)) {
    name = cell;
    }
}

if (name && (obtainedMarks !== null || remarks)) {
    if (!remarks && obtainedMarks !== null) {
        remarks = obtainedMarks >= 40 ? 'Pass' : 'Fail';
    }
    
    mappedResults.push({
        name,
        rollNo,
        obtainedMarks: obtainedMarks !== null ? obtainedMarks : '',
        remarks: remarks || 'Unknown'
    });
}
}

console.log("Mapped results length:", mappedResults.length);
if (mappedResults.length > 0) console.log("First item:", mappedResults[0]);
