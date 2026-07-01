const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const psScript = 'E:/Antigravity/Project 2 - BFI Classroom/read_doc.ps1';
const dir = 'E:\\OFFICE FILES (backup)\\Old hard disk documents\\OLD Documents_Ex Hard Disk\\All important documents\\BFI\\1st batch';

const files = fs.readdirSync(dir).filter(f => f.endsWith('.doc'));

for (const file of files) {
  const docPath = path.join(dir, file);
  try {
    const result = execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" -FilePath "${docPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (result.includes('Samad')) {
      console.log('Found in:', file);
      const lines = result.split('\n');
      for (const line of lines) {
        if (line.includes('Samad')) {
           console.log('Line:', line.trim());
        }
      }
    }
  } catch (e) {
  }
}
