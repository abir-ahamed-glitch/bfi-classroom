import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { logTrashAction } from '../utils/trashLogger.js';

const router = express.Router();

const ENTITY_TABLES = {
  'students': { table: 'users', where: "role = 'student'" },
  'teachers': { table: 'users', where: "role = 'instructor'" },
  'leads': { table: 'users', where: "role = 'student'" },
  'batches': { table: 'batches', where: '1=1' },
  'announcements': { table: 'announcements', where: '1=1' },
  'broadcasts': { table: 'broadcasts', where: '1=1' },
  'posts': { table: 'community_posts', where: '1=1' },
  'materials': { table: 'course_materials', where: '1=1' },
  'projects': { table: 'projects', where: '1=1' },
};

function getLabelForEntity(entity, record) {
  if (!record) return 'Unknown Item';
  switch (entity) {
    case 'students':
    case 'leads':
    case 'teachers':
      return `${record.first_name || ''} ${record.last_name || ''}`.trim();
    case 'batches':
      return record.batch_name;
    case 'announcements':
    case 'broadcasts':
    case 'materials':
    case 'projects':
      return record.title;
    case 'posts':
      return String(record.content || '').substring(0, 50) + '...';
    default:
      return 'Unknown Item';
  }
}

// GET /api/admin/trash/audit-log
// Fetch all audit log records
router.get('/audit-log', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const items = db.prepare(`SELECT * FROM trash_audit_log ORDER BY performed_at DESC`).all();
    for (const item of items) {
      const config = ENTITY_TABLES[item.entity_type];
      if (config) {
        const record = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(item.entity_id);
        if (record) {
          item.original_data = record;
        }
      }
    }
    res.json({ items });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Internal server error while fetching audit log.' });
  }
});

// GET /api/admin/trash/admins
// Fetch list of admins for filtering dropdown
router.get('/admins', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const admins = db.prepare(`SELECT id, first_name, last_name FROM users WHERE role = 'admin'`).all();
    res.json({ admins });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Internal server error while fetching admins.' });
  }
});

// GET /api/admin/trash/:entity
// Fetch all soft-deleted items for a given entity
router.get('/:entity', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { entity } = req.params;
    const config = ENTITY_TABLES[entity];

    if (!config) {
      return res.status(400).json({ error: 'Invalid entity type for trash.' });
    }

    let query = `SELECT * FROM ${config.table} WHERE deleted_at IS NOT NULL AND ${config.where} ORDER BY deleted_at DESC`;
    const items = db.prepare(query).all();

    res.json({ items });
  } catch (error) {
    console.error('Error fetching trash items:', error);
    import('fs').then(fs => fs.writeFileSync('trash-error.log', error.stack || error.toString()));
    res.status(500).json({ error: 'Internal server error while fetching trash.' });
  }
});

// POST /api/admin/trash/restore/:entity/:id
// Restore a soft-deleted item
router.post('/restore/:entity/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { entity, id } = req.params;
    const config = ENTITY_TABLES[entity];

    if (!config) {
      return res.status(400).json({ error: 'Invalid entity type.' });
    }

    const record = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
    if (!record) return res.status(404).json({ error: 'Record not found.' });

    db.prepare(`UPDATE ${config.table} SET deleted_at = NULL, deleted_by_admin_id = NULL WHERE id = ?`).run(id);
    logTrashAction(entity, id, getLabelForEntity(entity, record), 'restored', req.user.id);

    res.json({ message: 'Item restored successfully.' });
  } catch (error) {
    console.error('Error restoring item:', error);
    res.status(500).json({ error: 'Internal server error while restoring item.' });
  }
});

// POST /api/admin/trash/bulk-restore/:entity
// Restore multiple soft-deleted items
router.post('/bulk-restore/:entity', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { entity } = req.params;
    const { ids } = req.body;
    const config = ENTITY_TABLES[entity];

    if (!config) return res.status(400).json({ error: 'Invalid entity type.' });
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided.' });

    const transaction = db.transaction(() => {
      for (const id of ids) {
        const record = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
        if (record) {
          db.prepare(`UPDATE ${config.table} SET deleted_at = NULL, deleted_by_admin_id = NULL WHERE id = ?`).run(id);
          logTrashAction(entity, id, getLabelForEntity(entity, record), 'restored', req.user.id);
        }
      }
    });

    transaction();
    res.json({ message: `${ids.length} items restored successfully.` });
  } catch (error) {
    console.error('Error in bulk restore:', error);
    res.status(500).json({ error: 'Bulk restore failed.' });
  }
});

// DELETE /api/admin/trash/permanent/:entity/:id
// Permanently delete an item from the database
router.delete('/permanent/:entity/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { entity, id } = req.params;
    const config = ENTITY_TABLES[entity];

    if (!config) {
      return res.status(400).json({ error: 'Invalid entity type.' });
    }

    const record = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
    if (!record) return res.status(404).json({ error: 'Record not found.' });

    db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(id);
    logTrashAction(entity, id, getLabelForEntity(entity, record), 'permanently_deleted', req.user.id);

    res.json({ message: 'Item permanently deleted.' });
  } catch (error) {
    console.error('Error permanently deleting item:', error);
    res.status(500).json({ error: 'Internal server error while permanently deleting item.' });
  }
});

// DELETE /api/admin/trash/bulk-permanent/:entity
// Permanently delete multiple items
router.delete('/bulk-permanent/:entity', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { entity } = req.params;
    const { ids } = req.body;
    const config = ENTITY_TABLES[entity];

    if (!config) return res.status(400).json({ error: 'Invalid entity type.' });
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided.' });

    const transaction = db.transaction(() => {
      for (const id of ids) {
        const record = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
        if (record) {
          db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(id);
          logTrashAction(entity, id, getLabelForEntity(entity, record), 'permanently_deleted', req.user.id);
        }
      }
    });

    transaction();
    res.json({ message: `${ids.length} items permanently deleted.` });
  } catch (error) {
    console.error('Error in bulk permanent delete:', error);
    res.status(500).json({ error: 'Bulk permanent delete failed.' });
  }
});

export default router;
