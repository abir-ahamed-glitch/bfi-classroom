import db from '../db/database.js';

/**
 * server/services/callSignalingService.js
 *
 * Authoritative WebRTC & Group-Call Signaling Governance:
 *
 * State machine rules (one consistent policy for all entry points):
 *  - A user who is RINGING (caller or receiver) in a non-expired call is BUSY.
 *    No second call may be sent by or directed at them until the first expires
 *    or is rejected/ended.
 *  - A user who is CONNECTED is BUSY. Same rule.
 *  - A user who is in invitedParticipants of any session (not yet accepted) is
 *    BUSY and cannot receive a group-call invite from a different call.
 *  - cleanupPendingCall only removes userActiveCall entries that still point to
 *    the session being cleaned up, preventing deletion of a newer session's mapping.
 *
 * Functions:
 * 1. canCommunicate: relationship validation via actual active batch membership.
 * 2. userBusyState: single source of truth for whether a user is busy and why.
 * 3. handleCallRequest: initiates a 1:1 call; blocked if caller or receiver busy.
 * 4. handleCallAnswered: transitions ringing → connected; blocked if expired.
 * 5. handleCallRejected: only the exact invited recipient may reject.
 * 6. verifyActivePeer: WebRTC signaling gate (sender & target in same connected session).
 * 7. handleCallEnded: tears down any session the sender belongs to.
 * 8. handleGroupInvite: adds invitee; blocked if invitee already busy in any call.
 * 9. handleGroupAccepted: invitee joins; blocked if capacity exceeded.
 * 10. handleGroupLeft: removes leaver; tears down if ≤1 participant remains.
 * 11. handleUserDisconnect: socket-close cleanup with peer notification.
 * 12. resetCallSignalingState: test/restart helper.
 */

export const PENDING_CALL_TTL_MS = 60 * 1000; // 60-second pending call expiry
export const GROUP_INVITE_TTL_MS = 60 * 1000;  // 60-second group invitation expiry
export const MAX_GROUP_PARTICIPANTS = 9;       // Maximum 9 participants per group call

// In-memory call sessions
// callId -> CallSession
const callSessions = new Map();

// userId -> CallSession (current active or ringing call)
// A user appears here as soon as a call is initiated (as caller OR receiver),
// and is removed when the call ends, is rejected, or expires.
const userActiveCall = new Map();

// Pending ringing calls by callerId -> CallSession
const pendingCallsByCaller = new Map();

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Remove a ringing session from all tracking maps.
 * SAFE: only removes userActiveCall[userId] when it still points to THIS session,
 * preventing accidental deletion of a newer session's pointer.
 */
function cleanupPendingCall(session) {
  if (!session) return;
  callSessions.delete(session.callId);
  pendingCallsByCaller.delete(session.callerId);

  // Guard: only delete the userActiveCall entry if it still references this session.
  if (userActiveCall.get(session.callerId) === session) {
    userActiveCall.delete(session.callerId);
  }
  if (session.targetReceiverId !== undefined &&
      userActiveCall.get(session.targetReceiverId) === session) {
    userActiveCall.delete(session.targetReceiverId);
  }
}

/**
 * Remove a connected session from all tracking maps and return the peer IDs to notify.
 */
function teardownConnectedSession(session) {
  if (!session) return [];
  callSessions.delete(session.callId);
  pendingCallsByCaller.delete(session.callerId);

  const notifyIds = [];
  session.participants.forEach(pid => {
    if (userActiveCall.get(pid) === session) userActiveCall.delete(pid);
    notifyIds.push(pid);
  });
  session.invitedParticipants.forEach(pid => {
    if (userActiveCall.get(pid) === session) userActiveCall.delete(pid);
    notifyIds.push(pid);
  });
  if (session.invitedTimestamps) session.invitedTimestamps.clear();
  return notifyIds;
}

/**
 * Checks whether a pending ringing call session has exceeded its 60-second TTL.
 */
export function isPendingCallExpired(session, now = Date.now()) {
  if (!session || session.state !== 'ringing') return false;
  return (now - session.createdAt) > PENDING_CALL_TTL_MS;
}

/**
 * Checks whether an unaccepted group invitation for inviteeId has exceeded its 60-second TTL.
 */
export function isGroupInviteExpired(session, inviteeId, now = Date.now()) {
  if (!session || !session.invitedParticipants?.has(inviteeId)) return false;
  const meta = session.invitedTimestamps?.get(inviteeId);
  const invitedAt = meta?.invitedAt || session.createdAt;
  return (now - invitedAt) > GROUP_INVITE_TTL_MS;
}

/**
 * Sweeps and removes expired group invitations across all active call sessions.
 * Returns the count of pruned invitations.
 */
export function pruneExpiredGroupInvites(now = Date.now()) {
  let prunedCount = 0;
  for (const session of callSessions.values()) {
    if (session.invitedParticipants) {
      const expiredInvitees = [];
      for (const inviteeId of session.invitedParticipants) {
        if (isGroupInviteExpired(session, inviteeId, now)) {
          expiredInvitees.push(inviteeId);
        }
      }
      for (const inviteeId of expiredInvitees) {
        session.invitedParticipants.delete(inviteeId);
        if (session.invitedTimestamps) session.invitedTimestamps.delete(inviteeId);
        prunedCount++;
      }
    }
  }
  return prunedCount;
}

/**
 * Sweeps and removes all expired pending ringing calls and group invitations.
 * Returns the count of sessions/invitations pruned.
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
  const groupPruned = pruneExpiredGroupInvites(now);
  return expired.length + groupPruned;
}

/**
 * Single source of truth: determine whether userId is currently busy.
 *
 * Returns one of:
 *   null                    – user is free
 *   { state, session }      – user is busy (state = 'ringing' | 'connected' | 'invited')
 *
 * Expired ringing sessions and expired group invitations are cleaned up
 * inline on access and treated as free.
 */
export function userBusyState(userId) {
  const session = userActiveCall.get(userId);
  if (session) {
    if (session.state === 'ringing') {
      if (isPendingCallExpired(session)) {
        cleanupPendingCall(session);
      } else {
        return { state: 'ringing', session };
      }
    } else if (session.state === 'connected') {
      return { state: 'connected', session };
    }
  }

  // Check whether user has an unaccepted group-call invite in any session
  for (const s of callSessions.values()) {
    if (s.invitedParticipants && s.invitedParticipants.has(userId)) {
      if (isGroupInviteExpired(s, userId)) {
        s.invitedParticipants.delete(userId);
        if (s.invitedTimestamps) s.invitedTimestamps.delete(userId);
      } else {
        return { state: 'invited', session: s };
      }
    }
  }

  return null;
}

/**
 * Check whether userId has an unexpired pending group-call invite in ANY session.
 */
function isUserPendingGroupInvite(userId) {
  for (const s of callSessions.values()) {
    if (s.invitedParticipants && s.invitedParticipants.has(userId)) {
      if (isGroupInviteExpired(s, userId)) {
        s.invitedParticipants.delete(userId);
        if (s.invitedTimestamps) s.invitedTimestamps.delete(userId);
      } else {
        return true;
      }
    }
  }
  return false;
}

// ─── Relationship validation ─────────────────────────────────────────────────

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

    // Students enrolled in the same active batch can call each other.
    // Uses batch_students and student_course_enrollments (integer batch_id),
    // joined to non-deleted, non-archived batches rows.
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

// ─── State machine handlers ──────────────────────────────────────────────────

/**
 * Initiates a 1:1 call request.
 *
 * Consistent busy rule applied to BOTH caller and receiver:
 *  - CONNECTED → CALLER_BUSY / RECIPIENT_BUSY
 *  - RINGING (non-expired) → CALLER_BUSY / RECIPIENT_BUSY
 *  - RINGING (expired) → cleaned up, treated as free
 *
 * A caller who is already ringing in a non-expired call cannot start a second
 * call; their original ringing session remains answerable.
 *
 * A receiver who already has a non-expired ringing call directed at them
 * cannot receive a second call; the first caller's session is preserved intact.
 */
export function handleCallRequest(callerId, data, database = db) {
  const receiverId = Number(data?.receiverId);
  if (!canCommunicate(callerId, receiverId, database)) {
    return { ok: false, error: 'Recipient is not eligible to receive calls from this account.', code: 'CALL_DISALLOWED' };
  }

  // Prune globally expired ringing calls first
  pruneExpiredPendingCalls();

  // ── Caller busy check ──────────────────────────────────────────────────
  const callerBusy = userBusyState(callerId);
  if (callerBusy) {
    const code = callerBusy.state === 'connected' ? 'CALLER_BUSY' : 'CALLER_RINGING';
    return { ok: false, error: 'You are already in an active or ringing call.', code };
  }

  // ── Receiver busy check ────────────────────────────────────────────────
  const receiverBusy = userBusyState(receiverId);
  if (receiverBusy) {
    const code = receiverBusy.state === 'connected' ? 'RECIPIENT_BUSY' : 'RECIPIENT_RINGING';
    return { ok: false, error: 'Recipient is currently busy on another call.', code };
  }

  // Safety net: clear any expired-and-already-pruned residual (belt-and-suspenders)
  const stale = pendingCallsByCaller.get(callerId);
  if (stale) {
    // Only reachable if the stale session expired between pruneExpiredPendingCalls()
    // above and this point (race is possible only in multi-threaded environments;
    // Node.js is single-threaded so this is purely defensive).
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
 * Only the designated recipient of the matching non-expired ringing call may answer.
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
 * Rejecting a 1:1 call request or declining a group call invitation.
 * Only the exact invited recipient may reject; third parties are silently dropped.
 * Expired sessions are cleaned up and returned as CALL_EXPIRED / INVITE_EXPIRED.
 */
export function handleCallRejected(rejecterId, data) {
  const callerId = Number(data?.callerId);
  const callId = data?.callId;

  // 1. Check for a matching 1:1 ringing call
  if (callerId) {
    const session = pendingCallsByCaller.get(callerId);
    if (session && session.targetReceiverId === rejecterId && session.state === 'ringing') {
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
  }

  // 2. Fallback: check if rejecterId is declining an invited group call with exact callId
  if (callId && typeof callId === 'string' && callId.trim()) {
    const s = callSessions.get(callId);
    if (s && s.state === 'connected' && s.invitedParticipants?.has(rejecterId)) {
      const result = handleGroupInviteDeclined(rejecterId, { callId: s.callId, reason: data?.reason });
      if (result.ok) {
        result.isGroupInvite = true;
        return result;
      }
      return result;
    }
  }

  return { ok: false, error: 'No matching pending call found for this recipient to reject.' };
}

/**
 * Verifies that sender and receiver are active peers in the same connected call session.
 * Used to gate all WebRTC signaling (offer, answer, ICE candidate).
 */
export function verifyActivePeer(senderId, targetId) {
  if (!Number.isInteger(senderId) || !Number.isInteger(targetId)) return false;
  const session = userActiveCall.get(senderId);
  if (!session || session.state !== 'connected') return false;
  return session.participants.has(senderId) && session.participants.has(targetId);
}

/**
 * Handles ending a call (1:1 or group).
 * Tears down the session the sender is in, notifying all other participants.
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

    // Use safe teardown
    if (session.state === 'ringing') {
      cleanupPendingCall(session);
    } else {
      teardownConnectedSession(session);
    }
  } else if (targetId) {
    // Sender may have already been cleaned up; look for a pending call they initiated
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
 * Group Call: Invite a new participant into an ongoing call.
 *
 * Enforces:
 *  - Inviter must be in a connected call (NOT_IN_CALL)
 *  - Invitee must be eligible (canCommunicate)
 *  - Invitee must not already be in this call (ALREADY_PARTICIPANT)
 *  - Invitee must not be ringing, connected, or pending-invited in ANY other call (INVITEE_BUSY)
 *  - Total capacity must not exceed MAX_GROUP_PARTICIPANTS (MAX_PARTICIPANTS_REACHED)
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

  // Invitee busy check: ringing, connected in any call, or already pending-invited in another call
  const inviteeBusy = userBusyState(receiverId);
  if (inviteeBusy) {
    return {
      ok: false,
      error: 'Recipient is currently busy on another call.',
      code: 'INVITEE_BUSY'
    };
  }
  if (isUserPendingGroupInvite(receiverId)) {
    return {
      ok: false,
      error: 'Recipient already has a pending group call invitation.',
      code: 'INVITEE_BUSY'
    };
  }

  // Enforce max capacity
  const totalParticipants = session.participants.size + session.invitedParticipants.size;
  if (totalParticipants >= MAX_GROUP_PARTICIPANTS) {
    return {
      ok: false,
      error: `Group call has reached the maximum capacity of ${MAX_GROUP_PARTICIPANTS} participants.`,
      code: 'MAX_PARTICIPANTS_REACHED'
    };
  }

  session.invitedParticipants.add(receiverId);
  if (!session.invitedTimestamps) session.invitedTimestamps = new Map();
  session.invitedTimestamps.set(receiverId, {
    invitedAt: Date.now(),
    inviterId
  });
  session.lastActivity = Date.now();

  // Authoritatively construct existing participants list from session
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
 * Group Call: Accept an invitation to an ongoing call.
 * Enforces exact callId matching, max capacity on accept, and validates 60s invitation TTL.
 */
export function handleGroupAccepted(joinerId, data) {
  const callId = data?.callId;
  if (!callId || typeof callId !== 'string' || !callId.trim()) {
    return { ok: false, error: 'Missing or invalid callId.', code: 'INVALID_CALL_ID' };
  }

  const session = callSessions.get(callId);
  if (!session || session.state !== 'connected') {
    return { ok: false, error: 'No active group call found for this callId.', code: 'CALL_NOT_FOUND' };
  }

  if (!session.invitedParticipants?.has(joinerId)) {
    return { ok: false, error: 'No matching pending group invitation found for your account in this call.', code: 'NOT_INVITED' };
  }

  // Enforce group invitation expiry
  if (isGroupInviteExpired(session, joinerId)) {
    session.invitedParticipants.delete(joinerId);
    if (session.invitedTimestamps) session.invitedTimestamps.delete(joinerId);
    return { ok: false, error: 'Group call invitation has expired.', code: 'INVITE_EXPIRED' };
  }

  // Enforce max 9-person group limit on accept
  if (session.participants.size >= MAX_GROUP_PARTICIPANTS) {
    session.invitedParticipants.delete(joinerId);
    if (session.invitedTimestamps) session.invitedTimestamps.delete(joinerId);
    return {
      ok: false,
      error: `Group call has reached the maximum capacity of ${MAX_GROUP_PARTICIPANTS} participants.`,
      code: 'MAX_PARTICIPANTS_REACHED'
    };
  }

  session.participants.add(joinerId);
  session.invitedParticipants.delete(joinerId);
  if (session.invitedTimestamps) session.invitedTimestamps.delete(joinerId);
  session.lastActivity = Date.now();
  userActiveCall.set(joinerId, session);

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
 * Group Call: Decline an invitation to an ongoing group call.
 * Authenticated invitee can decline their exact pending invitation.
 * Requires exact callId matching; removes only the decliner from invitedParticipants
 * without ending the group call or altering other sessions.
 */
export function handleGroupInviteDeclined(declinerId, data) {
  const callId = data?.callId;
  if (!callId || typeof callId !== 'string' || !callId.trim()) {
    return { ok: false, error: 'Missing or invalid callId.', code: 'INVALID_CALL_ID' };
  }

  const session = callSessions.get(callId);
  if (!session || session.state !== 'connected') {
    return { ok: false, error: 'No active connected call found for this callId.', code: 'CALL_NOT_FOUND' };
  }

  if (!session.invitedParticipants?.has(declinerId)) {
    return { ok: false, error: 'No matching pending group invitation found for this user in this call.', code: 'NOT_INVITED' };
  }

  // Enforce expiry check
  if (isGroupInviteExpired(session, declinerId)) {
    session.invitedParticipants.delete(declinerId);
    if (session.invitedTimestamps) session.invitedTimestamps.delete(declinerId);
    return { ok: false, error: 'Group call invitation has expired.', code: 'INVITE_EXPIRED' };
  }

  session.invitedParticipants.delete(declinerId);
  if (session.invitedTimestamps) session.invitedTimestamps.delete(declinerId);
  session.lastActivity = Date.now();

  const peersToNotify = Array.from(session.participants);

  return {
    ok: true,
    session,
    peersToNotify,
    isGroupInvite: true,
    sanitizedPayload: {
      callId: session.callId,
      declinerId,
      reason: data?.reason || 'Group invitation declined'
    }
  };
}

/**
 * Group Call: Cancel a pending invitation sent to a user.
 * Authenticated active participant in the group call can cancel an invitation.
 * Requires exact callId matching; removes the invitee from invitedParticipants and notifies them to dismiss ringing UI.
 */
export function handleGroupInviteCancelled(cancellerId, data) {
  const callId = data?.callId;
  if (!callId || typeof callId !== 'string' || !callId.trim()) {
    return { ok: false, error: 'Missing or invalid callId.', code: 'INVALID_CALL_ID' };
  }

  const receiverId = Number(data?.receiverId);
  if (!receiverId || !Number.isInteger(receiverId)) {
    return { ok: false, error: 'Missing or invalid receiverId.', code: 'INVALID_RECEIVER_ID' };
  }

  // Resolve session from callSessions.get(callId) first
  const session = callSessions.get(callId);
  if (!session || session.state !== 'connected') {
    return { ok: false, error: 'No active connected call found for this callId.', code: 'CALL_NOT_FOUND' };
  }

  // Check if canceller is active in another call vs this call
  const activeCall = userActiveCall.get(cancellerId);
  if (activeCall && activeCall !== session) {
    return { ok: false, error: 'Mismatched callId: you are active in a different call.', code: 'CALL_MISMATCH' };
  }

  if (!session.participants?.has(cancellerId)) {
    return { ok: false, error: 'You are not an active participant in this call.', code: 'NOT_IN_CALL' };
  }

  if (!session.invitedParticipants?.has(receiverId)) {
    return { ok: false, error: 'No pending invitation found for this user in this call.', code: 'NOT_INVITED' };
  }

  session.invitedParticipants.delete(receiverId);
  if (session.invitedTimestamps) session.invitedTimestamps.delete(receiverId);
  session.lastActivity = Date.now();

  return {
    ok: true,
    session,
    receiverId,
    sanitizedPayload: {
      callId: session.callId,
      receiverId,
      cancelledBy: cancellerId
    }
  };
}

/**
 * Group Call: Participant leaving an ongoing group call.
 * Tears down the group call when ≤1 participant remains.
 */
export function handleGroupLeft(leaverId, _data) {
  const session = userActiveCall.get(leaverId);
  if (!session) {
    // If leaverId was an invited participant who hasn't accepted yet, cancel invite
    for (const s of callSessions.values()) {
      if (s.invitedParticipants && s.invitedParticipants.has(leaverId)) {
        s.invitedParticipants.delete(leaverId);
        if (s.invitedTimestamps) s.invitedTimestamps.delete(leaverId);
        s.lastActivity = Date.now();
        return {
          ok: true,
          peersToNotify: Array.from(s.participants),
          sanitizedPayload: {
            callId: s.callId,
            participantIds: Array.from(s.participants),
            userId: leaverId
          }
        };
      }
    }
    return { ok: false };
  }

  session.participants.delete(leaverId);
  if (userActiveCall.get(leaverId) === session) {
    userActiveCall.delete(leaverId);
  }
  session.lastActivity = Date.now();

  const remainingParticipants = Array.from(session.participants);

  if (remainingParticipants.length <= 1) {
    callSessions.delete(session.callId);
    pendingCallsByCaller.delete(session.callerId);
    remainingParticipants.forEach(pid => {
      if (userActiveCall.get(pid) === session) userActiveCall.delete(pid);
    });
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
 * Notifies remaining peers of the disconnection.
 */
export function handleUserDisconnect(userId) {
  const session = userActiveCall.get(userId);
  if (!session) {
    // If disconnecting user had a pending group invite, prune it
    for (const s of callSessions.values()) {
      if (s.invitedParticipants && s.invitedParticipants.has(userId)) {
        s.invitedParticipants.delete(userId);
        if (s.invitedTimestamps) s.invitedTimestamps.delete(userId);
      }
    }
    return null;
  }

  const peersToNotify = [];

  if (session.state === 'ringing') {
    const otherId = session.callerId === userId ? session.targetReceiverId : session.callerId;
    cleanupPendingCall(session);
    if (otherId) peersToNotify.push(otherId);
  } else if (session.state === 'connected') {
    session.participants.delete(userId);
    if (userActiveCall.get(userId) === session) {
      userActiveCall.delete(userId);
    }
    peersToNotify.push(...Array.from(session.participants));

    if (session.participants.size <= 1) {
      callSessions.delete(session.callId);
      pendingCallsByCaller.delete(session.callerId);
      session.participants.forEach(pid => {
        if (userActiveCall.get(pid) === session) userActiveCall.delete(pid);
      });
    }
  }

  return peersToNotify.length ? { peersToNotify, fromId: userId } : null;
}

/**
 * Reset all active call state. Used in test teardown and server restart.
 */
export function resetCallSignalingState() {
  callSessions.clear();
  userActiveCall.clear();
  pendingCallsByCaller.clear();
}

/**
 * Read-only test interface for test state inspection without exposing mutable Map references.
 */
export const __testing = Object.freeze({
  getSession: (callId) => callSessions.get(callId),
  hasSession: (callId) => callSessions.has(callId),
  listSessionIds: () => Array.from(callSessions.keys()),
  getActiveCall: (userId) => userActiveCall.get(userId),
  getPendingCall: (callerId) => pendingCallsByCaller.get(callerId),
  reset: () => resetCallSignalingState()
});
