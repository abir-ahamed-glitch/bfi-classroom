import db from '../server/db/database.js';
const rows = db.prepare("SELECT title, media_link, thumbnail_url, poster_url FROM projects LIMIT 20;").all();
console.log(JSON.stringify(rows, null, 2));
process.exit(0);
