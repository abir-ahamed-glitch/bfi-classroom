import { addDays, dhakaNow, getTimedSessions, isSessionDate } from '../../src/utils/timetable.js';
import { resolveZoomClassBinding, resolveZoomClassOccurrence } from './zoomClassBinding.js';
import { parseZoomMeetingUrl } from './zoomMeetingAuth.js';

export function createZoomBindingStore(db, loadSchedule) {
  const receiptById = db.prepare(`SELECT meeting_id AS meetingId, meeting_instance AS meetingInstance, occurred_at AS occurredAt
    FROM zoom_event_receipts WHERE id = ? AND status <> 'rejected'`);
  const columns = `meeting_id AS meetingId, meeting_instance AS meetingInstance, batch_id AS batchId,
    phase_id AS phaseId, class_id AS classId, slot_id AS slotId, class_date AS date`;
  const byInstance = db.prepare(`SELECT ${columns} FROM zoom_class_bindings WHERE meeting_instance = ?`);
  const byOccurrence = db.prepare(`SELECT ${columns} FROM zoom_class_bindings
    WHERE batch_id = ? AND phase_id = ? AND slot_id = ? AND class_date = ?`);
  const insert = db.prepare(`INSERT INTO zoom_class_bindings
    (meeting_id, meeting_instance, batch_id, phase_id, class_id, slot_id, class_date, bound_by)
    VALUES (@meetingId, @meetingInstance, @batchId, @phaseId, @classId, @slotId, @date, @actorId)`);
  const listReceipts = db.prepare(`SELECT MIN(id) AS receiptId, meeting_instance AS meetingInstance,
    MIN(occurred_at) AS firstEventAt FROM zoom_event_receipts
    WHERE meeting_id = ? AND occurred_at >= ? AND occurred_at < ? AND status <> 'rejected'
    GROUP BY meeting_instance ORDER BY firstEventAt DESC, receiptId DESC LIMIT 25`);

  function validate(receipt, binding) {
    if (dhakaNow(new Date(receipt.occurredAt)).date !== binding.date) return null;
    return resolveZoomClassOccurrence(receipt, [binding], loadSchedule(binding.batchId, binding.phaseId));
  }

  function resolveOccurrence(receiptId) {
    const receipt = receiptById.get(receiptId);
    const binding = receipt && byInstance.get(receipt.meetingInstance);
    return binding ? validate(receipt, binding) : null;
  }

  const bind = db.transaction((receiptId, target, actorId) => {
    const receipt = receiptById.get(receiptId);
    if (!receipt) return {status: 'missing'};
    const {batchId, phaseId, classId, slotId, date} = target ?? {};
    if (!Number.isSafeInteger(actorId) || actorId < 1 || !Number.isSafeInteger(batchId) || batchId < 1
        || ![phaseId, classId, slotId, date].every(value => typeof value === 'string' && value.trim())) return {status: 'invalid'};

    const binding = {meetingId: receipt.meetingId, meetingInstance: receipt.meetingInstance, batchId, phaseId, classId, slotId, date};
    const existing = byInstance.get(receipt.meetingInstance);
    if (existing && Object.keys(binding).some(key => binding[key] !== existing[key])) return {status: 'conflict'};
    if (!existing && byOccurrence.get(batchId, phaseId, slotId, date)) return {status: 'conflict'};
    if (!validate(receipt, binding)) return {status: 'invalid'};
    if (existing) return {status: 'existing', binding};
    insert.run({...binding, actorId});
    return {status: 'created', binding};
  });

  return {
    bind: (...args) => bind.immediate(...args),
    options(batchId, phaseId, date) {
      if (!isSessionDate(date)) return null;
      const schedule = loadSchedule(batchId, phaseId);
      if (!schedule) return null;
      const from = new Date(`${date}T00:00:00+06:00`).toISOString();
      const to = new Date(`${addDays(date, 1)}T00:00:00+06:00`).toISOString();
      return getTimedSessions(schedule.slots, [date], schedule.bounds).flatMap(slot => {
        const meetingId = parseZoomMeetingUrl(slot.meetingUrl)?.meetingNumber;
        if (slot.status !== 'scheduled' || !meetingId || slot.id == null || typeof slot.classId !== 'string') return [];
        const slotId = String(slot.id);
        const occurrence = byOccurrence.get(batchId, phaseId, slotId, date);
        const receipts = listReceipts.all(meetingId, from, to).flatMap(receipt => {
          const binding = {meetingId, meetingInstance: receipt.meetingInstance, batchId, phaseId, classId: slot.classId, slotId, date};
          const existing = byInstance.get(receipt.meetingInstance);
          if (existing && (!occurrence || occurrence.meetingInstance !== existing.meetingInstance)) return [];
          if (occurrence && occurrence.meetingInstance !== receipt.meetingInstance) return [];
          if (!resolveZoomClassBinding(binding, [binding], schedule)) return [];
          return [{id: receipt.receiptId, firstEventAt: receipt.firstEventAt, bound: Boolean(existing)}];
        });
        return [{slotId, classId: slot.classId, title: slot.classTitle || slot.subjectName || slot.classId,
          startTime: slot.startTime, meetingId, receipts}];
      });
    },
    resolve(receiptId) {
      return resolveOccurrence(receiptId)?.binding ?? null;
    },
    resolveOccurrence
  };
}
