const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/shahi/.gemini/antigravity/brain/3146111d-1480-4fa0-9c13-e46c8140edbc/';
const files = fs.readdirSync(dir).filter(f => f.startsWith('media__') && f.endsWith('.png'));
let html = '<html><body style="background: white; margin: 0; padding: 20px;">';
html += '<h1>Images</h1>';
for (const f of files) {
  html += `<h2>${f}</h2>`;
  html += `<img src="file:///${path.join(dir, f).replace(/\\/g, '/')}" style="max-width: 1000px; border: 1px solid red; margin-bottom: 20px;" />`;
}
html += '</body></html>';
fs.writeFileSync('e:/Antigravity/Project 2 - BFI Classroom/view_images.html', html);
