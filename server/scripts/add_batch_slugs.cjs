const Database = require('better-sqlite3');
const db = new Database('E:/Antigravity/Project 2 - BFI Classroom/server/bfi_classroom.db');

try {
  // Add column if it doesn't exist
  db.prepare("ALTER TABLE batches ADD COLUMN slug TEXT").run();
} catch (e) {
  // Ignore if column already exists
}

const batches = db.prepare('SELECT id, batch_name, course_name FROM batches ORDER BY id ASC').all();
const seenSlugs = new Set();

const generateSlug = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const getInitials = (courseName) => {
  return courseName.split(' ').map(w => w[0]).join('').toLowerCase();
};

const updateStmt = db.prepare('UPDATE batches SET slug = ? WHERE id = ?');

db.transaction(() => {
  for (const batch of batches) {
    let slug = generateSlug(batch.batch_name);
    
    // Special handling to make sure ID 54 gets exactly "1stbatch" if it hasn't been taken by ID 33
    if (batch.id === 54 && !seenSlugs.has('1stbatch')) {
      slug = '1stbatch';
    } else if (seenSlugs.has(slug)) {
      // Append course initials
      const initials = getInitials(batch.course_name);
      const newSlug = `${slug}-${initials}`;
      if (!seenSlugs.has(newSlug)) {
        slug = newSlug;
      } else {
        // Just append ID as fallback
        slug = `${slug}-${batch.id}`;
      }
    }
    
    seenSlugs.add(slug);
    updateStmt.run(slug, batch.id);
  }
})();

// Create UNIQUE constraint index for fast lookups
try {
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_slug ON batches(slug)").run();
} catch (e) {}

console.log("Database schema updated and slugs populated successfully.");
