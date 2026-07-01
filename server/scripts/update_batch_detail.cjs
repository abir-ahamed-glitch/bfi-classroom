const fs = require('fs');
const path = 'E:/Antigravity/Project 2 - BFI Classroom/src/pages/admin/BatchDetail.jsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(/const { id } = useParams\(\);/g, 'const { slug } = useParams();');
content = content.replace(/fetchBatchDetails\(id\)/g, 'fetchBatchDetails(slug)');
content = content.replace(/fetchBatchStudents\(id\)/g, 'fetchBatchStudents(slug)');
content = content.replace(/fetchProgressStats\(id\)/g, 'fetchProgressStats(slug)');
content = content.replace(/api\/admin\/batches\/\$\{id\}/g, 'api/admin/batches/${slug}');
content = content.replace(/id, /g, 'slug, '); // For dependency arrays like [id, location]
fs.writeFileSync(path, content, 'utf8');
console.log('BatchDetail updated');
