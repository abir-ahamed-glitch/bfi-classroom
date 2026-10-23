const path = require('path');

/**
 * Lossless migration to eliminate downstream identity collisions across:
 * 1. batch_course_fees: Replaces table-level UNIQUE(course_name, batch_number) with:
 *    - idx_bcf_batch_id: UNIQUE(batch_id) WHERE batch_id IS NOT NULL
 *    - idx_bcf_legacy_unique: UNIQUE(course_name, batch_number) WHERE batch_id IS NULL
 *    - Adds batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL
 *
 * 2. course_settings: Replaces table-level UNIQUE(course_name, batch_number) with:
 *    - idx_cs_batch_id: UNIQUE(batch_id) WHERE batch_id IS NOT NULL
 *    - idx_cs_legacy_unique: UNIQUE(course_name, batch_number) WHERE batch_id IS NULL
 *    - Adds batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL
 *
 * 3. course_materials:
 *    - Adds batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL
 *    - Adds idx_cm_batch_id on course_materials(batch_id)
 *
 * Requirements:
 * - Pre-commit verification: all row counts and foreign keys audited inside transaction before commit.
 * - Safe legacy fallback: unlinked historical records are untouched.
 * - Idempotent: safe to run repeatedly.
 */
function runDownstreamCollisionMigration(db) {
  let modifiedAny = false;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. MIGRATION: batch_course_fees
  // ───────────────────────────────────────────────────────────────────────────
  const bcfTableCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='batch_course_fees'").get();
  if (bcfTableCheck) {
    const bcfCols = db.prepare('PRAGMA table_info(batch_course_fees)').all();
    const hasBatchIdCol = bcfCols.some(c => c.name === 'batch_id');
    const bcfIndices = db.prepare('PRAGMA index_list(batch_course_fees)').all();
    const hasOldUnique = bcfIndices.some(i => i.unique === 1 && i.origin === 'u');
    const hasNewBatchIndex = bcfIndices.some(i => i.name === 'idx_bcf_batch_id');

    if (!hasBatchIdCol || hasOldUnique || !hasNewBatchIndex) {
      console.log('🔄 Executing lossless migration on batch_course_fees...');
      const preCount = db.prepare('SELECT COUNT(*) as count FROM batch_course_fees').get().count;
      const preFkErrors = db.prepare('PRAGMA foreign_key_check').all();

      db.pragma('foreign_keys = OFF');
      try {
        const tx = db.transaction(() => {
          db.prepare(`
            CREATE TABLE batch_course_fees_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
              course_name TEXT NOT NULL,
              batch_number TEXT NOT NULL,
              phase1_fee INTEGER NOT NULL DEFAULT 0,
              phase2_fee INTEGER NOT NULL DEFAULT 0,
              full_fee INTEGER NOT NULL DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
            )
          `).run();

          if (hasBatchIdCol) {
            db.prepare(`
              INSERT INTO batch_course_fees_new (
                id, batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee, created_at, updated_at
              )
              SELECT
                id, batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee, created_at, updated_at
              FROM batch_course_fees
            `).run();
          } else {
            db.prepare(`
              INSERT INTO batch_course_fees_new (
                id, batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee, created_at, updated_at
              )
              SELECT
                id, NULL, course_name, batch_number, phase1_fee, phase2_fee, full_fee, created_at, updated_at
              FROM batch_course_fees
            `).run();
          }

          const newCount = db.prepare('SELECT COUNT(*) as count FROM batch_course_fees_new').get().count;
          if (newCount !== preCount) {
            throw new Error(`Data integrity error: batch_course_fees_new has ${newCount} rows, expected ${preCount}.`);
          }

          // Temporarily drop any triggers that reference batch_course_fees to prevent SQLite dependency checks during rename
          const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND (sql LIKE '%batch_course_fees%' OR tbl_name = 'batch_course_fees')").all();
          for (const t of triggers) {
            db.prepare(`DROP TRIGGER IF EXISTS "${t.name}"`).run();
          }

          db.prepare('DROP TABLE batch_course_fees').run();
          db.prepare('ALTER TABLE batch_course_fees_new RENAME TO batch_course_fees').run();

          // Restore dropped triggers
          for (const t of triggers) {
            if (t.sql) {
              db.prepare(t.sql).run();
            }
          }

          db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_bcf_batch_id ON batch_course_fees(batch_id) WHERE batch_id IS NOT NULL').run();
          db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_bcf_legacy_unique ON batch_course_fees(course_name, batch_number) WHERE batch_id IS NULL').run();
          db.prepare('CREATE INDEX IF NOT EXISTS idx_bcf_batch_lookup ON batch_course_fees(batch_id)').run();

          // Pre-commit verification inside transaction
          const postCount = db.prepare('SELECT COUNT(*) as count FROM batch_course_fees').get().count;
          if (postCount !== preCount) {
            throw new Error(`Post-rebuild count mismatch on batch_course_fees: expected ${preCount}, found ${postCount}.`);
          }

          const postFkErrors = db.prepare('PRAGMA foreign_key_check(batch_course_fees)').all();
          if (postFkErrors.length > 0) {
            throw new Error(`Foreign key check failed on batch_course_fees: ${JSON.stringify(postFkErrors)}`);
          }
        });

        tx();
        modifiedAny = true;
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }

    // Explicit, audited linking: associate unambiguous legacy fee rows to batches
    try {
      const unlinkedFees = db.prepare(`
        SELECT id, course_name, batch_number 
        FROM batch_course_fees 
        WHERE batch_id IS NULL AND TRIM(batch_number) != 'DEFAULT'
      `).all();

      for (const feeRow of unlinkedFees) {
        const matches = db.prepare(`
          SELECT id FROM batches 
          WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?)
        `).all(feeRow.course_name, feeRow.batch_number);
        if (matches.length === 1) {
          db.prepare('UPDATE batch_course_fees SET batch_id = ? WHERE id = ?').run(matches[0].id, feeRow.id);
        }
      }
    } catch { /* empty */ }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. MIGRATION: course_settings
  // ───────────────────────────────────────────────────────────────────────────
  const csTableCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='course_settings'").get();
  if (csTableCheck) {
    const csCols = db.prepare('PRAGMA table_info(course_settings)').all();
    const hasBatchIdCol = csCols.some(c => c.name === 'batch_id');
    const csIndices = db.prepare('PRAGMA index_list(course_settings)').all();
    const hasOldUnique = csIndices.some(i => i.unique === 1 && i.origin === 'u');
    const hasNewBatchIndex = csIndices.some(i => i.name === 'idx_cs_batch_id');

    if (!hasBatchIdCol || hasOldUnique || !hasNewBatchIndex) {
      console.log('🔄 Executing lossless migration on course_settings...');
      const preCount = db.prepare('SELECT COUNT(*) as count FROM course_settings').get().count;

      db.pragma('foreign_keys = OFF');
      try {
        const tx = db.transaction(() => {
          db.prepare(`
            CREATE TABLE course_settings_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
              course_name TEXT NOT NULL,
              batch_number TEXT NOT NULL DEFAULT 'DEFAULT',
              total_classes INTEGER DEFAULT 22,
              exam_max_score INTEGER DEFAULT 100,
              exam_pass_mark INTEGER DEFAULT 33,
              has_assignment INTEGER DEFAULT 0,
              assignments TEXT DEFAULT '[]',
              has_phase2 INTEGER DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now', 'localtime')),
              updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
          `).run();

          if (hasBatchIdCol) {
            db.prepare(`
              INSERT INTO course_settings_new (
                id, batch_id, course_name, batch_number, total_classes, exam_max_score, exam_pass_mark,
                has_assignment, assignments, has_phase2, created_at, updated_at
              )
              SELECT
                id, batch_id, course_name, batch_number, total_classes, exam_max_score, exam_pass_mark,
                has_assignment, assignments, has_phase2, created_at, updated_at
              FROM course_settings
            `).run();
          } else {
            db.prepare(`
              INSERT INTO course_settings_new (
                id, batch_id, course_name, batch_number, total_classes, exam_max_score, exam_pass_mark,
                has_assignment, assignments, has_phase2, created_at, updated_at
              )
              SELECT
                id, NULL, course_name, batch_number, total_classes, exam_max_score, exam_pass_mark,
                has_assignment, assignments, has_phase2, created_at, updated_at
              FROM course_settings
            `).run();
          }

          const newCount = db.prepare('SELECT COUNT(*) as count FROM course_settings_new').get().count;
          if (newCount !== preCount) {
            throw new Error(`Data integrity error: course_settings_new has ${newCount} rows, expected ${preCount}.`);
          }

          // Temporarily drop any triggers that reference course_settings to prevent SQLite dependency checks during rename
          const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND (sql LIKE '%course_settings%' OR tbl_name = 'course_settings')").all();
          for (const t of triggers) {
            db.prepare(`DROP TRIGGER IF EXISTS "${t.name}"`).run();
          }

          db.prepare('DROP TABLE course_settings').run();
          db.prepare('ALTER TABLE course_settings_new RENAME TO course_settings').run();

          // Restore dropped triggers
          for (const t of triggers) {
            if (t.sql) {
              db.prepare(t.sql).run();
            }
          }

          db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_batch_id ON course_settings(batch_id) WHERE batch_id IS NOT NULL').run();
          db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_legacy_unique ON course_settings(course_name, batch_number) WHERE batch_id IS NULL').run();
          db.prepare('CREATE INDEX IF NOT EXISTS idx_cs_batch_lookup ON course_settings(batch_id)').run();

          // Pre-commit verification inside transaction
          const postCount = db.prepare('SELECT COUNT(*) as count FROM course_settings').get().count;
          if (postCount !== preCount) {
            throw new Error(`Post-rebuild count mismatch on course_settings: expected ${preCount}, found ${postCount}.`);
          }

          const postFkErrors = db.prepare('PRAGMA foreign_key_check(course_settings)').all();
          if (postFkErrors.length > 0) {
            throw new Error(`Foreign key check failed on course_settings: ${JSON.stringify(postFkErrors)}`);
          }
        });

        tx();
        modifiedAny = true;
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. MIGRATION: course_materials
  // ───────────────────────────────────────────────────────────────────────────
  const cmTableCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='course_materials'").get();
  if (cmTableCheck) {
    const cmCols = db.prepare('PRAGMA table_info(course_materials)').all();
    const hasBatchIdCol = cmCols.some(c => c.name === 'batch_id');

    if (!hasBatchIdCol) {
      console.log('🔄 Adding batch_id column to course_materials...');
      const preCount = db.prepare('SELECT COUNT(*) as count FROM course_materials').get().count;

      const tx = db.transaction(() => {
        db.prepare('ALTER TABLE course_materials ADD COLUMN batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_cm_batch_id ON course_materials(batch_id)').run();

        const postCount = db.prepare('SELECT COUNT(*) as count FROM course_materials').get().count;
        if (postCount !== preCount) {
          throw new Error(`Post-alter count mismatch on course_materials: expected ${preCount}, found ${postCount}.`);
        }

        const postFkErrors = db.prepare('PRAGMA foreign_key_check(course_materials)').all();
        if (postFkErrors.length > 0) {
          throw new Error(`Foreign key check failed on course_materials: ${JSON.stringify(postFkErrors)}`);
        }
      });

      tx();
      modifiedAny = true;
    }
  }

  return { applied: modifiedAny };
}

module.exports = {
  runDownstreamCollisionMigration
};
