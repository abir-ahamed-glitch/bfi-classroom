const fs = require('fs');
const filePath = 'E:\\OFFICE FILES (backup)\\Old hard disk documents\\OLD Documents_Ex Hard Disk\\All important documents\\BFI\\1st Batch\\Result of Examination.doc';

const buffer = fs.readFileSync(filePath);
const text8 = buffer.toString('utf8');

// Extract all strings that look like text or numbers
let strings = text8.match(/[A-Za-z0-9 \.\-]{2,}/g);
if (strings) {
  // Let's filter out some binary junk and just look at the list
  const clean = strings.filter(s => s.trim().length > 1 && !/^[A-Za-z]+$/.test(s) || s.length > 3);
  console.log(clean.join('\n'));
}
