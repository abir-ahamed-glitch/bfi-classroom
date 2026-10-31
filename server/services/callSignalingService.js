import db from '../db/database.js';

/**
 * server/services/callSignalingService.js
 *
 * Authoritative WebRTC & Group-Call Signaling Governance:
 * 1. Relationship Validation: Enforces recipient eligibility using actual active batch membership
 *    (batch_students + non-deleted, active batches table rows) or existing chat history, rather
 *    than unverified student profile text.
 * 2. Active Call State Machine: Tracks 1:1 and group calls from 'ringing' to 'connected' and 'ended'.
 * 3. Exact Pending Call Rejection: Only the designated recipient of an active pending call can reject it.
 * 4. Pending Call Expiry: Enforces an authoritative 60-second TTL on ringing calls.
 * 5. Group Call Capacity: Enforces an authoritative maximum ceiling of 9 participants per group call.
 * 6. Call-Membership Verification: Drops signaling (offers, answers, ICE candidates) if sender & receiver
 *    are not actively connected peers in the same session.
 * 7. Client Payload Sanitization: Enforces callerId, answererId, and fromId from authenticated socket session;
 *    prevents broadcast flooding.
 */

export const PENDING_CALL_TTL_MS = 60 * 1000; // 60-second pending call expiry
export const MAX_GROUP_PARTICIPANTS = 9;      // Maximum 9 participants in a group call

// In-memory call sessions
// callId -> CallSession
const callSessions = new Map();

// userId -> CallSession (current active or ringing call)
const userActiveCall = new Map();

// Pending ringing calls by callerId -> CallSession
const pendingCallsByCaller = new Map();

/**
 * Helper to clean up a pending call session from all tracking maps.
 */
function cleanupPendingCall(session) {
  if (!session) return;
  callSessions.delete(session.callId);
  userActiveCall.delete(session.callerId);
  if (session.targetReceiverId) {
    userActiveCall.delete(session.targetReceiverId);
  }
  pendingCallsByCaller.delete(session.callerId);
}

/**
 * Checks whether a pending ringing call session has exceeded its 60-second TTL.
 */
export function isPendingCallExpired(session, now = Date.now()) {
  if (!session || session.state !== 'ringing') return false;
  return (now - session.createdAt) > PENDING_CALL_TTL_MS;
}

/**
 * Sweeps and removes all expired pending ringing calls.
 */
export function pruneExpiredPendingCalls(now = Date.now()) {
  const expired = [];
  for (const session of pendingCallsByCaller.values()) {
    if (isPendingCallExpired(session, now)) {
      expired.push(session);
    }
  }
  for (const session of expired) {
    cleanupPendingCall(session);
  }
  return expired.length;
}

/**
 * Validate whether caller is permitted to initiate a call to receiver.
 * Enforces actual active batch membership rather than free-form profile text.
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

    // Instructor and student in the same assigned batch
    if ((caller.role === 'instructor' && receiver.role === 'student') ||
        (caller.role === 'student' && receiver.role === 'instructor')) {
      const instructorId = caller.role === 'instructor' ? callerId : receiverId;
      const studentId = caller.role === 'student' ? callerId : receiverId;
      const instructorBatchMatch = database.prepare(`
        SELECT 1
        FROM batch_students bs
        JOIN batches b ON b.id = bs.batch_id
        LEFT JOIN batch_moderators bm ON bm.batch_id = b.id
        WHERE bs.student_id = ?
          AND (b.created_by = ? OR bm.user_id = ?)
          AND b.deleted_at IS NULL
          AND (b.status IS NULL OR LOWER(b.status) != 'archived')
        LIMIT 1
      `).get(studentId, instructorId, instructorId);
      if (instructorBatchMatch) return true;
    }

    // Students enrolled in the same active batch can call each other
    // Enforces actual active batch membership via batch_students or student_course_enrollments
    // joined to non-deleted, non-archived batches, rather than free-form student_profiles.batch_number text.
    const sameBatch = database.prepare(`
      SELECT 1
      FROM (
        SELECT batch_id FROM batch_students WHERE student_id = ? AND batch_id IS NOT NULL
        UNION
        SELECT batch_id FROM student_course_enrollments WHERE user_id = ? AND batch_id IS NOT NULL
      ) s1
      JOIN (
        SELECT batch_id FROM batch_students WHERE student_id = ? AND batch_id IS NOT NULL
        UNION
        SELECT batch_id FROM student_course_enrollments WHERE user_id = ? AND batch_id IS NOT NULL
      ) s2 ON s1.batch_id = s2.batch_id
      JOIN batches b ON b.id = s1.batch_id
      WHERE b.deleted_at IS NULL
        AND (b.status IS NULL OR LOWER(b.status) != 'archived')
      LIMIT 1
    `).get(callerId, callerId, receiverId, receiverId);

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

  // Prune any globally expired ringing calls first
  pruneExpiredPendingCalls();

  // Check if caller is already in an active connected call
  const existingCall = userActiveCall.get(callerId);
  if (existingCall) {
    if (existingCall.state === 'connected') {
      return { ok: false, error: 'You are already in an active call.', code: 'CALLER_BUSY' };
    }
    // Clean up stale expired ringing call
    if (existingCall.state === 'ringing' && isPendingCallExpired(existingCall)) {
      cleanupPendingCall(existingCall);
    }
  }

  // Check if receiver is already in a connected call
  const receiverActive = userActiveCall.get(receiverId);
  if (receiverActive) {
    if (receiverActive.state === 'connected') {
      return { ok: false, error: 'Recipient is currently busy on another call.', code: 'RECIPIENT_BUSY' };
    }
    if (receiverActive.state === 'ringing' && isPendingCallExpired(receiverActive)) {
      cleanupPendingCall(receiverActive);
    }
  }

  // Clear any existing pending ringing call initiated by this caller
  const stale = pendingCallsByCaller.get(callerId);
  if (stale) {
    cleanupPendingCall(stale);
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
  userActiveCall.set(receiverId, session);
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

  // Enforce 60-second TTL
  if (isPendingCallExpired(session)) {
    cleanupPendingCall(session);
    return { ok: false, error: 'Call invitation has expired.', code: 'CALL_EXPIRED' };
  }

  session.state = 'connected';
  session.participants.add(answererId);
  session.invitedParticipants.delete(answererId);
  session.lastActivity = Date.now();

  userActiveCall.set(callerId, session);
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
 * Enforces that only the designated recipient of that exact pending call can reject it.
 */
export function handleCallRejected(rejecterId, data) {
  const callerId = Number(data?.callerId);
  if (!callerId) return { ok: false, error: 'Missing callerId.' };

  const session = pendingCallsByCaller.get(callerId);
  if (!session || session.targetReceiverId !== rejecterId || session.state !== 'ringing') {
    return { ok: false, error: 'No matching pending call found for this recipient to reject.' };
  }

  // Enforce 60-second TTL
  if (isPendingCallExpired(session)) {
    cleanupPendingCall(session);
    return { ok: false, error: 'Call invitation has expired.', code: 'CALL_EXPIRED' };
  }

  cleanupPendingCall(session);

  return {
    ok: true,
    callerId,
    sanitizedPayload: {
      callId: session.callId,
      callerId,
      rejecterId,
      reason: data?.reason || 'Call rejected'
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
    session.invitedParticipants.forEach(pid => userActiveCall.delete(pid));
    pendingCallsByCaller.delete(session.callerId);
  } else if (targetId) {
    // Check if there was a pending call between sender and target
    const pending = pendingCallsByCaller.get(senderId) || pendingCallsByCaller.get(targetId);
    if (pending && (pending.callerId === senderId || pending.targetReceiverId === senderId)) {
      cleanupPendingCall(pending);
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
 * Enforces maximum 9-person group call ceiling.
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

  // Enforce max 9-person group call ceiling
  const totalParticipants = session.participants.size + session.invitedParticipants.size;
  if (totalParticipants >= MAX_GROUP_PARTICIPANTS) {
    return {
      ok: false,
      error: `Group call has reached the maximum capacity of ${MAX_GROUP_PARTICIPANTS} participants.`,
      code: 'MAX_PARTICIPANTS_REACHED'
    };
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
 * Enforces maximum 9-person group call ceiling.
 */
export function handleGroupAccepted(joinerId, data) {
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

  // Enforce max 9-person group limit on accept
  if (session.participants.size >= MAX_GROUP_PARTICIPANTS) {
    session.invitedParticipants.delete(joinerId);
    return {
      ok: false,
      error: `Group call has reached the maximum capacity of ${MAX_GROUP_PARTICIPANTS} participants.`,
      code: 'MAX_PARTICIPANTS_REACHED'
    };
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
    const otherId = session.callerId === userId ? session.targetReceiverId : session.callerId;
    cleanupPendingCall(session);
    if (otherId) peersToNotify.push(otherId);
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
