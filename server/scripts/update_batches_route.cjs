const fs = require('fs');
const path = 'E:/Antigravity/Project 2 - BFI Classroom/server/routes/batches.js';
let content = fs.readFileSync(path, 'utf8');

const replacement = `const slug = req.params.id;
    const batchRecordLookup = db.prepare('SELECT id FROM batches WHERE slug = ?').get(slug);
    if (!batchRecordLookup) return res.status(404).json({ error: 'Batch not found' });
    const batchId = batchRecordLookup.id;`;

content = content.replace(/const batchId = parseInt\(req\.params\.id, 10\);/g, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log('batches.js updated.');
