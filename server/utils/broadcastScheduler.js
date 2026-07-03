import db from '../db/database.js';
import { resolveAudience, deliverBroadcast } from '../routes/broadcast.js';

export async function checkScheduledBroadcasts(io) {
  const now = new Date().toISOString();

  const dueBroadcasts = db.prepare(`
    SELECT * FROM broadcasts
    WHERE status = 'scheduled'
      AND deleted_at IS NULL
      AND scheduled_at <= ?
  `).all(now);

  for (const broadcast of dueBroadcasts) {
    console.log(`[BroadcastScheduler] Sending scheduled broadcast #${broadcast.id}: "${broadcast.title}"`);

    const students = resolveAudience(
      broadcast.audience_type,
      broadcast.audience_value,
      null
    );

    db.prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ?`).run(broadcast.id);

    try {
      await deliverBroadcast(broadcast.id, students, io);
    } catch (err) {
      console.error(`[BroadcastScheduler] Error delivering broadcast #${broadcast.id}:`, err);
    }
  }
}
