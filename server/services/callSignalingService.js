import db from '../db/database.js';

/**
 * server/services/callSignalingService.js
 *
 * Authoritative WebRTC & Group-Call Signaling Governance:
 * 1. Relationship Validation: Enforces recipient eligibility (admins, existing chats, batchmates, instructors).
 * 2. Active Call State Machine: Tracks 1:1 and group calls from 'ringing' to 'connected' and 'ended'.
 * 3. Call-Membership Verification: Drops signaling (offers, answers, ICE candidates) if sender & receiver are not in the same active call.
 * 4. Client Payload Sanitization: Enforces callerId, answererId, and fromId from authenticated socket session; prevents broadcast flooding.
 */

// In-memory call sessions
// callId -> CallSession
const callSessions = new Map();

// userId -> CallSession (current active or ringing call)
const userActiveCall = new Map();

// Pending ringing calls by callerId -> CallSession
const pendingCallsByCaller = new Map();

/**
 * Validate whether caller is permitted to initiate a call to receiver.
 */
export function canCommunicate(callerId, receiverId, database = db) {
  if (!Number.isInteger(callerId) || !Number.isInteger(receiverId)) return false;
  if (callerId <= 0 || receiverId <= 0 || callerId === receiverId) return false;

  try {
    const caller = database.prepare(`
      SELECT id, role, is_active, deleted_at, archived_at
      FROM users WHERE id = ?
    `).get(callerId);

    if (!caller || caller.is_active !== 1 || caller.deleted_at !== null || caller.archived_at !== null) {
      return false;
    }

    const receiver = database.prepare(`
      SELECT id, role, is_active, deleted_at, archived_at
      FROM users WHERE id = ?
    `).get(receiverId);

    if (!receiver || receiver.is_active !== 1 || receiver.deleted_at !== null || receiver.archived_at !== null) {
      return false;
    }

    // Admins can call anyone; anyone can call admins
    if (caller.role === 'admin' || receiver.role === 'admin') {
      return true;
    }

    // Instructors can call instructors
    if (caller.role === 'instructor' && receiver.role === 'instructor') {
      return true;
    }

    // Users with an existing direct message history can call each other
    const hasChatHistory = database.prepare(`
      SELECT 1 FROM messages
      WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
      LIMIT 1
    `).get(callerId, receiverId, receiverId, callerId);

    if (hasChatHistory) {
      return true;
    }

    // Students enrolled in the same batch can call each other
    const sameBatch = database.prepare(`
      SELECT 1
      FROM student_profiles sp1
      JOIN student_profiles sp2 ON sp1.batch_number = sp2.batch_number
      WHERE sp1.user_id = ? AND sp2.user_id = ?
        AND sp1.batch_number IS NOT NULL AND sp1.batch_number != ''
      LIMIT 1
    `).get(callerId, receiverId);

    if (sameBatch) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('[CallSignaling] canCommunicate error:', error);
    return false;
  }
}

/**
 * Initiates a 1:1 call request.
 */
export function handleCallRequest(callerId, data, database = db) {
  const receiverId = Number(data?.receiverId);
  if (!canCommunicate(callerId, receiverId, database)) {
    return { ok: false, error: 'Recipient is not eligible to receive calls from this account.', code: 'CALL_DISALLOWED' };
  }

  // Check if caller is already in an active connected call
  const existingCall = userActiveCall.get(callerId);
  if (existingCall && existingCall.state === 'connected') {
    return { ok: false, error: 'You are already in an active call.', code: 'CALLER_BUSY' };
  }

  // Clear any stale ringing call initiated by caller
  const stale = pendingCallsByCaller.get(callerId);
  if (stale) {
    callSessions.delete(stale.callId);
    userActiveCall.delete(callerId);
    pendingCallsByCaller.delete(callerId);
  }

  const callId = `call_${callerId}_${receiverId}_${Date.now()}`;
  const session = {
    callId,
    callerId,
    targetReceiverId: receiverId,
    state: 'ringing',
    participants: new Set([callerId]),
    invitedParticipants: new Set([receiverId]),
    hasVideo: Boolean(data?.hasVideo),
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  callSessions.set(callId, session);
  userActiveCall.set(callerId, session);
  pendingCallsByCaller.set(callerId, session);

  const sanitizedPayload = {
    ...data,
    callId,
    callerId,
    callerData: {
      ...(data?.callerData || {}),
      id: callerId
    }
  };

  return { ok: true, session, sanitizedPayload, receiverId };
}

/**
 * Answering a 1:1 call request.
 */
export function handleCallAnswered(answererId, data) {
  const callerId = Number(data?.callerId);
  if (!callerId) return { ok: false, error: 'Missing callerId.' };

  const session = pendingCallsByCaller.get(callerId);
  if (!session || session.targetReceiverId !== answererId || session.state !== 'ringing') {
    return { ok: false, error: 'No active ringing call found from this caller.' };
  }

  session.state = 'connected';
  session.participants.add(answererId);
  session.invitedParticipants.delete(answererId);
  session.lastActivity = Date.now();

  userActiveCall.set(answererId, session);
  pendingCallsByCaller.delete(callerId);

  const sanitizedPayload = {
    ...data,
    callId: session.callId,
    answererId,
    answererData: {
      ...(data?.answererData || {}),
      id: answererId
    }
  };

  return { ok: true, session, sanitizedPayload, callerId };
}

/**
 * Rejecting a 1:1 call request.
 */
export function handleCallRejected(rejecterId, data) {
  const callerId = Number(data?.callerId);
  if (!callerId) return { ok: false };

  const session = pendingCallsByCaller.get(callerId);
  if (session && session.targetReceiverId === rejecterId) {
    callSessions.delete(session.callId);
    userActiveCall.delete(callerId);
    userActiveCall.delete(rejecterId);
    pendingCallsByCaller.delete(callerId);
  }

  return {
    ok: true,
    callerId,
    sanitizedPayload: {
      ...data,
      rejecterId
    }
  };
}

/**
 * Verifies that sender and receiver are active peers in the same connected call session.
 */
export function verifyActivePeer(senderId, targetId) {
  if (!Number.isInteger(senderId) || !Number.isInteger(targetId)) return false;
  const session = userActiveCall.get(senderId);
  if (!session || session.state !== 'connected') return false;
  return session.participants.has(senderId) && session.participants.has(targetId);
}

/**
 * Handles ending a call (either 1:1 or group).
 */
export function handleCallEnded(senderId, data) {
  const session = userActiveCall.get(senderId);
  const targetId = Number(data?.targetId);
  const peersToNotify = new Set();

  if (session) {
    session.participants.forEach(pid => {
      if (pid !== senderId) peersToNotify.add(pid);
    });

    session.invitedParticipants.forEach(pid => peersToNotify.add(pid));

    // Tear down session
    callSessions.delete(session.callId);
    session.participants.forEach(pid => userActiveCall.delete(pid));
    pendingCallsByCaller.delete(session.callerId);
  } else if (targetId) {
    // Check if there was a pending call between sender and target
    const pending = pendingCallsByCaller.get(senderId) || pendingCallsByCaller.get(targetId);
    if (pending && (pending.callerId === senderId || pending.targetReceiverId === senderId)) {
      callSessions.delete(pending.callId);
      userActiveCall.delete(pending.callerId);
      userActiveCall.delete(pending.targetReceiverId);
      pendingCallsByCaller.delete(pending.callerId);
      peersToNotify.add(targetId);
    }
  }

  return {
    ok: true,
    peersToNotify: Array.from(peersToNotify),
    sanitizedPayload: {
      fromId: senderId,
      targetId
    }
  };
}

/**
 * Group Call: Inviting a new participant into an ongoing call.
 */
export function handleGroupInvite(inviterId, data, database = db) {
  const receiverId = Number(data?.receiverId);
  if (!receiverId || !canCommunicate(inviterId, receiverId, database)) {
    return { ok: false, error: 'Recipient is not eligible to join this call.', code: 'INVITE_DISALLOWED' };
  }

  const session = userActiveCall.get(inviterId);
  if (!session || session.state !== 'connected') {
    return { ok: false, error: 'You are not in an active connected call to invite others.', code: 'NOT_IN_CALL' };
  }

  if (session.participants.has(receiverId)) {
    return { ok: false, error: 'User is already in this call.', code: 'ALREADY_PARTICIPANT' };
  }

  session.invitedParticipants.add(receiverId);
  session.lastActivity = Date.now();

  // Authoritatively construct existing participants list from active session
  const existingParticipants = Array.from(session.participants).map(pid => ({
    id: pid,
    data: pid === inviterId ? data?.callerData : undefined
  }));

  const sanitizedPayload = {
    ...data,
    callId: session.callId,
    receiverId,
    callerData: {
      ...(data?.callerData || {}),
      id: inviterId
    },
    existingParticipants,
    hasVideo: session.hasVideo || Boolean(data?.hasVideo)
  };

  return { ok: true, receiverId, sanitizedPayload, session };
}

/**
 * Group Call: Accepting an invitation to an ongoing call.
 */
export function handleGroupAccepted(joinerId, data) {
  // Find session where joiner has a pending invitation
  let session = null;
  for (const s of callSessions.values()) {
    if (s.invitedParticipants.has(joinerId)) {
      session = s;
      break;
    }
  }

  if (!session || session.state !== 'connected') {
    return { ok: false, error: 'No active group call invitation found for your account.' };
  }

  session.participants.add(joinerId);
  session.invitedParticipants.delete(joinerId);
  session.lastActivity = Date.now();
  userActiveCall.set(joinerId, session);

  // Authoritative peers to notify (all other existing participants in this session)
  const peersToNotify = Array.from(session.participants).filter(pid => pid !== joinerId);

  const sanitizedPayload = {
    ...data,
    callId: session.callId,
    participantIds: Array.from(session.participants),
    joinerData: {
      ...(data?.joinerData || {}),
      id: joinerId
    }
  };

  return { ok: true, session, peersToNotify, sanitizedPayload };
}

/**
 * Group Call: Participant leaving an ongoing group call.
 */
export function handleGroupLeft(leaverId, _data) {
  const session = userActiveCall.get(leaverId);
  if (!session) return { ok: false };

  session.participants.delete(leaverId);
  userActiveCall.delete(leaverId);
  session.lastActivity = Date.now();

  const remainingParticipants = Array.from(session.participants);

  if (remainingParticipants.length <= 1) {
    // If 1 or 0 participants left, tear down group call
    callSessions.delete(session.callId);
    remainingParticipants.forEach(pid => userActiveCall.delete(pid));
  }

  return {
    ok: true,
    peersToNotify: remainingParticipants,
    sanitizedPayload: {
      callId: session.callId,
      participantIds: remainingParticipants,
      userId: leaverId
    }
  };
}

/**
 * Clean up active sessions on socket disconnect when all sockets for a user close.
 */
export function handleUserDisconnect(userId) {
  const session = userActiveCall.get(userId);
  if (!session) return null;

  const peersToNotify = [];

  if (session.state === 'ringing') {
    if (session.callerId === userId) {
      callSessions.delete(session.callId);
      userActiveCall.delete(session.callerId);
      pendingCallsByCaller.delete(session.callerId);
      if (session.targetReceiverId) peersToNotify.push(session.targetReceiverId);
    }
  } else if (session.state === 'connected') {
    session.participants.delete(userId);
    userActiveCall.delete(userId);
    peersToNotify.push(...Array.from(session.participants));

    if (session.participants.size <= 1) {
      callSessions.delete(session.callId);
      session.participants.forEach(pid => userActiveCall.delete(pid));
    }
  }

  return peersToNotify.length ? { peersToNotify, fromId: userId } : null;
}

/**
 * Reset all active calls (useful for testing or server restart).
 */
export function resetCallSignalingState() {
  callSessions.clear();
  userActiveCall.clear();
  pendingCallsByCaller.clear();
}
