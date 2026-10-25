import db from '../db/database.js';
import { resolveAudience, deliverBroadcast } from '../routes/broadcast.js';
import { recordAuditLog } from '../services/auditLedgerService.js';

export async function checkScheduledBroadcasts(io) {
  const now = new Date().toISOString();

  const dueBroadcasts = db.prepare(`
    SELECT * FROM broadcasts
    WHERE status = 'scheduled'
      AND deleted_at IS NULL
      AND scheduled_at <= ?
  `).all(now);

  for (const broadcast of dueBroadcasts) {
    console.log(`[BroadcastScheduler] Processing scheduled broadcast #${broadcast.id}: "${broadcast.title}"`);

    const students = resolveAudience(
      broadcast.audience_type,
      broadcast.audience_value,
      null
    );

    let accepted = false;
    try {
      const acceptTx = db.transaction(() => {
        const updateRes = db.prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`).run(broadcast.id);
        if (updateRes.changes === 0) {
          return false;
        }

        recordAuditLog({
          actorId: broadcast.sender_id,
          action: 'broadcast.send_scheduled',
          module: 'broadcasts',
          resource: `broadcast:${broadcast.id}`,
          outcome: 'success',
          beforeState: { id: broadcast.id, status: 'scheduled' },
          afterState: { id: broadcast.id, status: 'sending' },
          details: {
            title: broadcast.title,
            audience_type: broadcast.audience_type,
            recipientCount: students.length,
            scheduled_at: broadcast.scheduled_at
          },
          throwOnError: true
        });
        return true;
      });
      accepted = acceptTx();
    } catch (schedAuditErr) {
      console.error(`[BroadcastScheduler] Audit or state transition failure for broadcast #${broadcast.id}, rolling back send acceptance:`, schedAuditErr.message);
      // Status remains 'scheduled', unrecorded send is NOT started
      continue;
    }

    if (!accepted) {
      continue;
    }

    // Durable acceptance committed; proceed to background delivery (delivery outcomes logged separately)
    try {
      await deliverBroadcast(broadcast.id, students, io);
    } catch (err) {
      console.error(`[BroadcastScheduler] Error delivering broadcast #${broadcast.id}:`, err);
    }
  }
}
