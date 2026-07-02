import db from '../db/database.js';
import { EventEmitter } from 'events';

export const trashEvents = new EventEmitter();

/**
 * Log a soft-delete, restore, or permanent delete action to the trash_audit_log
 * 
 * @param {string} entityType - e.g., 'student', 'batch', 'announcement'
 * @param {number} entityId - The ID of the affected record
 * @param {string} entityLabel - A human-readable snapshot name for the record
 * @param {string} action - 'deleted', 'restored', 'permanently_deleted'
 * @param {number} adminId - The ID of the admin who performed the action
 * @param {string} notes - Optional notes or reason
 */
export function logTrashAction(entityType, entityId, entityLabel, action, adminId, notes = null) {
  try {
    const admin = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(adminId);
    const adminName = admin ? `${admin.first_name || ''} ${admin.last_name || ''}`.trim() : 'Unknown Admin';
    
    // Ensure label isn't too long or empty
    const safeLabel = entityLabel ? String(entityLabel).substring(0, 255) : 'Unknown Item';

    const stmt = db.prepare(`
      INSERT INTO trash_audit_log 
      (entity_type, entity_id, entity_label, action, performed_by_admin_id, performed_by_admin_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(entityType, entityId, safeLabel, action, adminId, adminName, notes);
    
    // Emit event so server.js can broadcast via Socket.IO
    trashEvents.emit('update', { entityType, entityId, action });
  } catch (error) {
    console.error(`Failed to log trash action (${action}) for ${entityType} ${entityId}:`, error);
  }
}
