const { execSync } = require('child_process');
const psScript = 'E:/Antigravity/Project 2 - BFI Classroom/read_doc.ps1';
const docPath = 'E:\\OFFICE FILES (backup)\\Old hard disk documents\\OLD Documents_Ex Hard Disk\\All important documents\\BFI\\1st batch\\Result of Examination.doc';

try {
  const result = execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" -FilePath "${docPath}"`, { encoding: 'utf8' });
  console.log('Includes Samad?', result.includes('Samad'));
} catch (e) {
  console.error(e);
}
