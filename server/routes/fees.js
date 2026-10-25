import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole, requirePermission } from '../middleware/auth.js';
import { recordAuditEventFromReq } from '../services/auditLedgerService.js';

const router = express.Router();

// GET all batch-wise course fees
router.get('/batch-fees', authenticateToken, requireRole('admin'), requirePermission('finance:view'), (req, res) => {
  try {
    const fees = db.prepare(`
      SELECT bcf.*, b.course_definition_id, b.batch_name
      FROM batch_course_fees bcf
      LEFT JOIN batches b ON bcf.batch_id = b.id
      ORDER BY bcf.course_name ASC, bcf.batch_number DESC
    `).all();
    res.json(fees);
  } catch (error) {
    console.error('[Fees API] Error fetching batch fees:', error);
    res.status(500).json({ error: 'Failed to fetch batch fees' });
  }
});

// GET available batches for a course (drawn from defined batches table and active enrollments)
router.get('/batch-fees/available-batches', authenticateToken, requireRole('admin'), requirePermission('finance:view'), (req, res) => {
  try {
    const { course_name, course_definition_id, format } = req.query;
    if (!course_name && !course_definition_id) {
      return res.status(400).json({ error: 'Course name or course definition ID is required.' });
    }

    let definedBatches = [];
    if (course_definition_id) {
      definedBatches = db.prepare(`
        SELECT id AS batch_id, batch_name, batch_number, course_name, course_definition_id
        FROM batches
        WHERE course_definition_id = ?
        ORDER BY batch_number DESC
      `).all(course_definition_id);
    } else if (course_name) {
      definedBatches = db.prepare(`
        SELECT id AS batch_id, batch_name, batch_number, course_name, course_definition_id
        FROM batches
        WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?))
        ORDER BY batch_number DESC
      `).all(course_name);
    }

    const legacyBatches = db.prepare(`
      SELECT DISTINCT sp.batch_number 
      FROM student_course_enrollments sce
      JOIN student_profiles sp ON sp.user_id = sce.user_id
      WHERE LOWER(TRIM(sce.course_name)) = LOWER(TRIM(?)) 
        AND sce.batch_id IS NULL
        AND sce.course_definition_id IS NULL
        AND sp.batch_number IS NOT NULL AND sp.batch_number != ''
      ORDER BY sp.batch_number DESC
    `).all(course_name || '').map(r => r.batch_number);

    if (format === 'detailed') {
      return res.json({
        defined_batches: definedBatches,
        legacy_batches: legacyBatches
      });
    }

    // Default string array format for existing callers
    const combined = Array.from(new Set([
      ...definedBatches.map(b => b.batch_number),
      ...legacyBatches
    ]));

    res.json(combined);
  } catch (error) {
    console.error('[Fees API] Error fetching available batches:', error);
    res.status(500).json({ error: 'Failed to fetch available batches' });
  }
});

// POST (create or update) batch-wise course fee
router.post('/batch-fees', authenticateToken, requireRole('admin'), requirePermission('finance:edit'), (req, res) => {
  try {
    const { batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee } = req.body;

    let effectiveBatchId = batch_id ? parseInt(batch_id, 10) : null;
    let effectiveCourseName = course_name;
    let effectiveBatchNumber = batch_number;

    if (effectiveBatchId) {
      const bRow = db.prepare('SELECT id, course_name, batch_number FROM batches WHERE id = ?').get(effectiveBatchId);
      if (bRow) {
        effectiveCourseName = bRow.course_name;
        effectiveBatchNumber = bRow.batch_number;
      }
    } else if (effectiveCourseName && effectiveBatchNumber) {
      const matchingBatches = db.prepare(
        'SELECT id FROM batches WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?)'
      ).all(effectiveCourseName, String(effectiveBatchNumber));
      if (matchingBatches.length === 1) {
        effectiveBatchId = matchingBatches[0].id;
      }
    }

    if (!effectiveBatchId && (!effectiveCourseName || !effectiveBatchNumber)) {
      return res.status(400).json({ error: 'Course name and batch number are required.' });
    }

    const p1 = parseInt(phase1_fee, 10) || 0;
    const p2 = parseInt(phase2_fee, 10) || 0;
    const f = parseInt(full_fee, 10) || 0;

    const saveFeeTx = db.transaction(() => {
      if (effectiveBatchId) {
        db.prepare(`
          INSERT INTO batch_course_fees (batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(batch_id) WHERE batch_id IS NOT NULL DO UPDATE SET
            phase1_fee = excluded.phase1_fee,
            phase2_fee = excluded.phase2_fee,
            full_fee = excluded.full_fee,
            course_name = excluded.course_name,
            batch_number = excluded.batch_number,
            updated_at = datetime('now')
        `).run(effectiveBatchId, effectiveCourseName, effectiveBatchNumber, p1, p2, f);
      } else {
        db.prepare(`
          INSERT INTO batch_course_fees (batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee, updated_at)
          VALUES (NULL, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(course_name, batch_number) WHERE batch_id IS NULL DO UPDATE SET
            phase1_fee = excluded.phase1_fee,
            phase2_fee = excluded.phase2_fee,
            full_fee = excluded.full_fee,
            updated_at = datetime('now')
        `).run(effectiveCourseName, effectiveBatchNumber, p1, p2, f);
      }

      recordAuditEventFromReq(req, {
        action: 'fee.create_or_update',
        module: 'fees',
        resource: `fee:${effectiveBatchId || effectiveCourseName}`,
        outcome: 'success',
        details: { batch_id: effectiveBatchId, course_name: effectiveCourseName, phase1_fee: p1, phase2_fee: p2, full_fee: f },
        afterState: { batch_id: effectiveBatchId, course_name: effectiveCourseName, phase1_fee: p1, phase2_fee: p2, full_fee: f },
        throwOnError: true
      });
    });

    saveFeeTx();
    res.json({ message: 'Batch fee updated successfully.' });
  } catch (error) {
    console.error('[Fees API] Error saving batch fee:', error);
    res.status(500).json({ error: 'Failed to save batch fee' });
  }
});

// DELETE a batch-wise course fee
router.delete('/batch-fees/:id', authenticateToken, requireRole('admin'), requirePermission('finance:edit'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM batch_course_fees WHERE id = ?').get(id);
    const deleteFeeTx = db.transaction(() => {
      db.prepare('DELETE FROM batch_course_fees WHERE id = ?').run(id);
      recordAuditEventFromReq(req, {
        action: 'fee.delete',
        module: 'fees',
        resource: `fee:${id}`,
        outcome: 'success',
        beforeState: existing || null,
        details: { id },
        throwOnError: true
      });
    });
    deleteFeeTx();
    res.json({ message: 'Batch fee deleted successfully.' });
  } catch (error) {
    console.error('[Fees API] Error deleting batch fee:', error);
    res.status(500).json({ error: 'Failed to delete batch fee' });
  }
});

export default router;
