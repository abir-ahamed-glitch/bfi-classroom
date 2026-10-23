const Database = require('better-sqlite3');
const path = require('path');

/**
 * Safe, lossless migration to replace table-level UNIQUE(batch_number, course_name)
 * on the `batches` table with scoped partial unique indexes:
 *
 * 1. idx_batches_unlinked_unique:
 *    UNIQUE(batch_number, course_name) WHERE course_definition_id IS NULL
 *    -> Preserves 100% of the legacy uniqueness rule for unlinked courses (e.g. historical OFC/FAC).
 *
 * 2. idx_batches_defined_unique:
 *    UNIQUE(batch_number, course_definition_id) WHERE course_definition_id IS NOT NULL
 *    -> Scoped by definition ID: allows two separate course definitions (or versions)
 *       to both have batch 'AP01' even if their titles match, while forbidding duplicate
 *       batch numbers within the same course definition.
 *
 * 3. idx_batches_defined_name_unique:
 *    UNIQUE(batch_name, course_definition_id) WHERE course_definition_id IS NOT NULL
 *    -> Prevents duplicate batch names within the same course definition.
 *
 * 4. idx_batches_slug:
 *    UNIQUE(slug) WHERE slug IS NOT NULL
 *
 * Requirements:
 * - Audits all existing batch, student, and enrollment references before and after migration.
 * - Zero data deletion or rewrite of historical rows.
 * - Idempotent and safe to run repeatedly.
 */
function runBatchesConstraintMigration(db) {
  // 1. Verify batches table exists
  const tableCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='batches'").get();
  if (!tableCheck) {
    return { applied: false, reason: 'batches table does not exist' };
  }

  // 2. Check current indexes
  const indices = db.prepare('PRAGMA index_list(batches)').all();
  const hasOldUniqueConstraint = indices.some(i => i.unique === 1 && i.origin === 'u');
  const hasNewDefinedIndex = indices.some(i => i.name === 'idx_batches_defined_unique');
  const hasNewUnlinkedIndex = indices.some(i => i.name === 'idx_batches_unlinked_unique');

  if (!hasOldUniqueConstraint && hasNewDefinedIndex && hasNewUnlinkedIndex) {
    return { applied: false, reason: 'batches table already has canonical scoped indexes' };
  }

  console.log('🔄 Executing lossless batches unique constraint migration...');

  // 3. Pre-migration audit of existing batches and references
  const preBatchesCount = db.prepare('SELECT COUNT(*) as count FROM batches').get().count;
  const preBatchStudentsCount = db.prepare('SELECT COUNT(*) as count FROM batch_students').get().count;
  const preEnrollmentsWithBatchCount = db.prepare('SELECT COUNT(*) as count FROM student_course_enrollments WHERE batch_id IS NOT NULL').get().count;
  const preFkErrors = db.prepare('PRAGMA foreign_key_check').all();

  if (preFkErrors.length > 0) {
    console.warn('⚠️ Pre-migration foreign key issues detected on batches:', preFkErrors);
  }

  // 4. Atomic table rebuild without table-level UNIQUE(batch_number, course_name)
  db.pragma('foreign_keys = OFF');

  try {
    const tx = db.transaction(() => {
      // Create replacement table with identical columns, defaults, types, and primary key
      db.prepare(`
        CREATE TABLE batches_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_name TEXT NOT NULL,
          batch_number TEXT NOT NULL,
          course_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'upcoming',
          start_date DATE,
          end_date DATE,
          description TEXT,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          slug TEXT,
          deleted_at TEXT DEFAULT NULL,
          deleted_by_admin_id INTEGER DEFAULT NULL,
          course_definition_id INTEGER,
          course_version INTEGER
        )
      `).run();

      // Copy all existing rows losslessly
      db.prepare(`
        INSERT INTO batches_new (
          id, batch_name, batch_number, course_name, status, start_date, end_date,
          description, created_by, created_at, updated_at, slug, deleted_at,
          deleted_by_admin_id, course_definition_id, course_version
        )
        SELECT
          id, batch_name, batch_number, course_name, status, start_date, end_date,
          description, created_by, created_at, updated_at, slug, deleted_at,
          deleted_by_admin_id, course_definition_id, course_version
        FROM batches
      `).run();

      // Integrity check before dropping
      const newCount = db.prepare('SELECT COUNT(*) as count FROM batches_new').get().count;
      if (newCount !== preBatchesCount) {
        throw new Error(`Data migration integrity mismatch: expected ${preBatchesCount} batches in batches_new, but found ${newCount}.`);
      }

      // Temporarily drop any triggers that reference batches to prevent SQLite dependency checks during rename
      const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND (sql LIKE '%batches%' OR tbl_name = 'batches')").all();
      for (const t of triggers) {
        db.prepare(`DROP TRIGGER IF EXISTS "${t.name}"`).run();
      }

      // Drop old table and rename new table
      db.prepare('DROP TABLE batches').run();
      db.prepare('ALTER TABLE batches_new RENAME TO batches').run();

      // Restore dropped triggers
      for (const t of triggers) {
        if (t.sql) {
          db.prepare(t.sql).run();
        }
      }

      // Create new scoped indexes
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_slug ON batches(slug) WHERE slug IS NOT NULL').run();
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_unlinked_unique ON batches(batch_number, course_name) WHERE course_definition_id IS NULL').run();
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_defined_unique ON batches(batch_number, course_definition_id) WHERE course_definition_id IS NOT NULL').run();
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_defined_name_unique ON batches(batch_name, course_definition_id) WHERE course_definition_id IS NOT NULL').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_batches_course_def ON batches(course_definition_id)').run();

      // Pre-commit integrity audit and assertions (INSIDE transaction before commit)
      const postBatchesCount = db.prepare('SELECT COUNT(*) as count FROM batches').get().count;
      const postBatchStudentsCount = db.prepare('SELECT COUNT(*) as count FROM batch_students').get().count;
      const postEnrollmentsWithBatchCount = db.prepare('SELECT COUNT(*) as count FROM student_course_enrollments WHERE batch_id IS NOT NULL').get().count;
      const postFkErrors = db.prepare('PRAGMA foreign_key_check').all();

      if (postBatchesCount !== preBatchesCount) {
        throw new Error(`Post-migration batch count mismatch: expected ${preBatchesCount}, found ${postBatchesCount}.`);
      }
      if (postBatchStudentsCount !== preBatchStudentsCount) {
        throw new Error(`Post-migration batch_students count mismatch: expected ${preBatchStudentsCount}, found ${postBatchStudentsCount}.`);
      }
      if (postEnrollmentsWithBatchCount !== preEnrollmentsWithBatchCount) {
        throw new Error(`Post-migration enrollments count mismatch: expected ${preEnrollmentsWithBatchCount}, found ${postEnrollmentsWithBatchCount}.`);
      }
      if (postFkErrors.length > 0) {
        throw new Error(`Post-migration foreign key check failed: ${JSON.stringify(postFkErrors)}`);
      }
    });

    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const finalBatchesCount = db.prepare('SELECT COUNT(*) as count FROM batches').get().count;
  const finalBatchStudentsCount = db.prepare('SELECT COUNT(*) as count FROM batch_students').get().count;
  const finalEnrollmentsWithBatchCount = db.prepare('SELECT COUNT(*) as count FROM student_course_enrollments WHERE batch_id IS NOT NULL').get().count;

  console.log(`✅ Batches unique constraint migration completed successfully: ${finalBatchesCount} batches verified.`);

  return {
    applied: true,
    preBatchesCount,
    postBatchesCount: finalBatchesCount,
    batchStudentsCount: finalBatchStudentsCount,
    enrollmentsWithBatchCount: finalEnrollmentsWithBatchCount
  };
}

// Standalone execution support
if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../test_isolated_bfi.db');
  const standaloneDb = new Database(dbPath);
  try {
    const result = runBatchesConstraintMigration(standaloneDb);
    console.log('Result:', result);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    standaloneDb.close();
  }
}

module.exports = { runBatchesConstraintMigration };
