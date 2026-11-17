import express from 'express';
import crypto from 'node:crypto';
import { verifyZoomWebhook, createZoomValidationResponse } from '../services/zoomWebhookSecurity.js';

function validEventTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
}

export function createZoomWebhookRouter(db, config = {}) {
  const router = express.Router();
  router.post('/', express.raw({type:'application/json', limit:'128kb'}), (req,res) => {
    res.set('Cache-Control', 'no-store');
    const enabled = config.enabled ?? (process.env.ZOOM_WEBHOOK_ENABLED === 'true');
    const secret = config.secret ?? process.env.ZOOM_WEBHOOK_SECRET;
    const accountId = config.accountId ?? process.env.ZOOM_ACCOUNT_ID;
    if (!enabled || !secret || !accountId) return res.status(503).json({error:'Webhook unavailable.'});
    if (!verifyZoomWebhook({secret, timestamp:req.get('x-zm-request-timestamp'), signature:req.get('x-zm-signature'), rawBody:req.body})) return res.status(401).json({error:'Invalid signature.'});
    let body;
    try { body = JSON.parse(req.body.toString('utf8')); } catch {return res.status(400).json({error:'Invalid payload.'});}
    if (body?.event === 'endpoint.url_validation') {
      try {return res.json(createZoomValidationResponse(secret, body.payload?.plainToken));} catch {return res.status(400).json({error:'Invalid challenge.'});}
    }
    if (!['meeting.participant_joined','meeting.participant_left'].includes(body?.event)) return res.status(204).end();
    if (body.payload?.account_id !== accountId) return res.status(403).json({error:'Unexpected account.'});
    const object = body.payload?.object, participant = object?.participant;
    const meetingId = String(object?.id ?? ''), meetingInstance = object?.uuid, participantId = String(participant?.user_id ?? '');
    const occurred = body.event === 'meeting.participant_joined' ? participant?.join_time : participant?.leave_time;
    if (!/^\d{9,11}$/.test(meetingId) || typeof meetingInstance !== 'string' || !meetingInstance || meetingInstance.length > 200
      || !participantId || participantId.length > 200 || !validEventTime(occurred)
      || !Number.isSafeInteger(body.event_ts)) return res.status(400).json({error:'Invalid event.'});
    const normalizedOccurrence = new Date(occurred).toISOString();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([accountId,body.event,body.event_ts,meetingId,meetingInstance,participantId,normalizedOccurrence])).digest('hex');
    try {
      db.prepare(`INSERT OR IGNORE INTO zoom_event_receipts (event_fingerprint,event_type,event_ts,meeting_id,meeting_instance,participant_id,occurred_at)
        VALUES (?,?,?,?,?,?,?)`).run(fingerprint,body.event,body.event_ts,meetingId,meetingInstance,participantId,normalizedOccurrence);
      return res.json({ok:true});
    } catch (error) {
      console.error('Zoom event receipt failed:', error.message);
      return res.status(500).json({error:'Event could not be saved.'});
    }
  });
  return router;
}
