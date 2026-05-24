/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { soundManager } from '../utils/AudioSynthesizer';
import { useModal } from '../components/BFIModal';

const CallContext = createContext(null);

export const useCall = () => useContext(CallContext);

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export const CallProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const { showAlert } = useModal();

  // ── State ──────────────────────────────────────────────────────────────────
  const [callState, setCallState]     = useState('idle');      // 'idle' | 'receiving' | 'calling' | 'connected'
  const [incomingCall, setIncomingCall] = useState(null);      // { callerData, isGroupInvite?, existingParticipants? }
  const [activeCall, setActiveCall]   = useState(null);        // { targetId, targetData, hasVideo, isCaller }
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);      // primary remote stream (backward compat)
  const [isMuted, setIsMuted]         = useState(false);
  const [isVideoOff, setIsVideoOff]   = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);

  // Group call participants: Map<string(id), { id, data, stream }>
  const [participants, setParticipants] = useState(new Map());
  
  // Online status tracking
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  // ── Refs (stale-closure safe) ──────────────────────────────────────────────
  const socketRef        = useRef(null);
  const pcRef            = useRef(null);          // Primary RTCPeerConnection (1:1)
  const peersRef         = useRef(new Map());     // Map<string(userId), RTCPeerConnection> for group
  const localStreamRef   = useRef(null);
  const callStateRef     = useRef('idle');
  const activeCallRef    = useRef(null);
  const incomingCallRef  = useRef(null);
  const participantsRef  = useRef(new Map());
  const callStartTimeRef = useRef(null);          // timestamp when call connected
  const callStatusRef    = useRef('missed');      // 'answered'|'missed'|'declined'

  // Keep refs in sync with state
  callStateRef.current    = callState;
  activeCallRef.current   = activeCall;
  incomingCallRef.current = incomingCall;
  participantsRef.current = participants;

  // ── Helper: get my caller data ────────────────────────────────────────────
  const getMyCallerData = useCallback(() => ({
    id: currentUser?.id,
    name: `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() || currentUser?.username,
    avatar: currentUser?.profile_picture || currentUser?.profilePicture,
  }), [currentUser]);

  // ── Helper: create a peer connection for a specific user (group) ─────────
  const _createPeerForUser = useCallback((targetUserId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('group-ice-candidate', {
          targetId: targetUserId,
          fromId: currentUser?.id,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setParticipants(prev => {
        const next = new Map(prev);
        const existing = next.get(String(targetUserId));
        if (existing) {
          next.set(String(targetUserId), { ...existing, stream });
        }
        return next;
      });
    };

    pc.onconnectionstatechange = () => {
      console.log(`[GroupCall] PC for user ${targetUserId} state:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        // Remove this participant only
        peersRef.current.delete(String(targetUserId));
        setParticipants(prev => {
          const next = new Map(prev);
          next.delete(String(targetUserId));
          return next;
        });
      }
    };

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    peersRef.current.set(String(targetUserId), pc);
    return pc;
  }, [currentUser?.id]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanupCall = useCallback(() => {
    soundManager.stopAll();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // Close all group peer connections
    peersRef.current.forEach(pc => {
      try { pc.close(); } catch { /* ignore */ }
    });
    peersRef.current.clear();
    
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    setCallState('idle');
    setIsMuted(false);
    setIsVideoOff(false);
    setParticipants(new Map());
    setShowAddPerson(false);
  }, []);

  const postCallLog = useCallback(async (call, status, durationSeconds) => {
    if (!call) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch('/api/inbox/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receiver_id: call.targetId,
          call_type: call.hasVideo ? 'video' : 'audio',
          status,
          duration_seconds: Math.round(durationSeconds || 0),
        }),
      });
    } catch (err) {
      console.warn('[Call] Failed to save call log:', err);
    }
  }, []);

  const endCall = useCallback(() => {
    const call = activeCallRef.current;
    const wasConnected = callStateRef.current === 'connected';
    const duration = wasConnected && callStartTimeRef.current
      ? (Date.now() - callStartTimeRef.current) / 1000
      : 0;
    const status = wasConnected ? 'answered' : (callStatusRef.current || 'missed');

    if (call && socketRef.current) {
      socketRef.current.emit('call-ended', { targetId: call.targetId });
      
      // Notify all group participants that we left
      const pIds = Array.from(participantsRef.current.keys()).map(Number);
      if (pIds.length > 0) {
        socketRef.current.emit('group-call-left', {
          participantIds: pIds,
          userId: currentUser?.id,
        });
      }
    }
    // Save call log — only the caller saves it (callee sees it via socket)
    if (call?.isCaller) {
      postCallLog(call, status, duration);
    }
    callStartTimeRef.current = null;
    callStatusRef.current = 'missed';
    cleanupCall();
  }, [cleanupCall, postCallLog, currentUser?.id]);

  const rejectCall = useCallback(() => {
    const incoming = incomingCallRef.current;
    if (incoming && socketRef.current) {
      socketRef.current.emit('call-rejected', { callerId: incoming.callerData.id });
    }
    soundManager.stopAll();
    setIncomingCall(null);
    setCallState('idle');
  }, []);

  // ── Socket Setup (runs ONCE per user login, never re-runs on state changes) ─
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !currentUser?.id) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    // Disconnect old socket if any
    socketRef.current?.disconnect();

    // Derive socket URL: env var if set, otherwise same origin as current page.
    // This ensures it works on localhost AND Cloudflare/localtunnel automatically.
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    console.log('[Call] Connecting socket to:', socketUrl);
    const socket = io(socketUrl, {
      withCredentials: true,
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;


    socket.on('connect', () => {
      console.log('[Call] Socket connected:', socket.id);
    });

    socket.on('connect_error', (err) => {
      console.error('[Call] Socket connection error:', err.message);
    });

    socket.on('online_users_list', (userIds) => {
      setOnlineUsers(new Set(userIds.map(String)));
    });

    socket.on('user_online', (userId) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        newSet.add(String(userId));
        return newSet;
      });
    });

    socket.on('user_offline', (userId) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(String(userId));
        return newSet;
      });
    });

    // ── 1:1 Signaling handlers (all use refs so they never go stale) ──────────

    socket.on('call-request', (data) => {
      console.log('[Call] Incoming call-request', data);
      if (callStateRef.current !== 'idle') {
        socket.emit('call-rejected', { callerId: data.callerData.id });
        return;
      }
      const ringtoneId = parseInt(localStorage.getItem('selectedRingtoneId') || '1', 10);
      soundManager.playRingtone(ringtoneId);
      setIncomingCall(data);
      setCallState('receiving');
    });

    socket.on('call-answered', async (data) => {
      console.log('[Call] call-answered', data);
      if (callStateRef.current !== 'calling') return;
      soundManager.stopAll();
      callStartTimeRef.current = Date.now();
      callStatusRef.current = 'answered';
      setCallState('connected');

      // Add the callee as a participant
      const calleeId = String(activeCallRef.current?.targetId);
      const calleeData = activeCallRef.current?.targetData;
      if (calleeId && calleeData) {
        setParticipants(prev => {
          const next = new Map(prev);
          next.set(calleeId, { id: calleeId, data: calleeData, stream: null });
          return next;
        });
      }

      // Caller creates the offer now that callee answered
      try {
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        socket.emit('webrtc-offer', {
          receiverId: activeCallRef.current.targetId,
          offer,
        });
      } catch (err) {
        console.error('[Call] Error creating offer:', err);
        endCall();
      }
    });

    socket.on('call-rejected', () => {
      console.log('[Call] call-rejected');
      if (callStateRef.current === 'calling') {
        cleanupCall();
        soundManager.playCallEnded();
      }
    });

    socket.on('call-ended', () => {
      console.log('[Call] call-ended');
      // If it's a group call with other participants remaining, just remove this person
      if (participantsRef.current.size > 1) {
        // The specific user who left will be handled by group-call-left
        return;
      }
      cleanupCall();
      soundManager.playCallEnded();
    });

    socket.on('webrtc-offer', async (data) => {
      console.log('[Call] webrtc-offer received');
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        const targetId = activeCallRef.current?.targetId || incomingCallRef.current?.callerData?.id;
        socket.emit('webrtc-answer', { callerId: targetId, answer });
      } catch (err) {
        console.error('[Call] Error handling offer:', err);
      }
    });

    socket.on('webrtc-answer', async (data) => {
      console.log('[Call] webrtc-answer received');
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        console.error('[Call] Error handling answer:', err);
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (!pcRef.current || !data.candidate) return;
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('[Call] Error adding ICE candidate:', err);
      }
    });

    // ── Group Call Signaling ──────────────────────────────────────────────────

    socket.on('group-call-invite', (data) => {
      console.log('[GroupCall] Incoming group-call-invite', data);
      if (callStateRef.current !== 'idle') {
        // Auto-reject if already in a call
        return;
      }
      const ringtoneId = parseInt(localStorage.getItem('selectedRingtoneId') || '1', 10);
      soundManager.playRingtone(ringtoneId);
      setIncomingCall({
        callerData: data.callerData,
        isGroupInvite: true,
        existingParticipants: data.existingParticipants || [],
        hasVideo: data.hasVideo,
      });
      setCallState('receiving');
    });

    socket.on('group-call-accepted', async (data) => {
      console.log('[GroupCall] group-call-accepted', data);
      if (callStateRef.current !== 'connected') return;
      
      const joiner = data.joinerData;
      const joinerId = String(joiner.id);

      // Add joiner to participants
      setParticipants(prev => {
        const next = new Map(prev);
        next.set(joinerId, { id: joinerId, data: joiner, stream: null });
        return next;
      });

      // Create a peer connection for the new joiner
      // We need to use a fresh reference to localStreamRef
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('group-ice-candidate', {
            targetId: joiner.id,
            fromId: currentUser?.id,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        setParticipants(prev => {
          const next = new Map(prev);
          const existing = next.get(joinerId);
          if (existing) {
            next.set(joinerId, { ...existing, stream });
          }
          return next;
        });
      };

      pc.onconnectionstatechange = () => {
        console.log(`[GroupCall] PC for joiner ${joinerId} state:`, pc.connectionState);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          peersRef.current.delete(joinerId);
          setParticipants(prev => {
            const next = new Map(prev);
            next.delete(joinerId);
            return next;
          });
        }
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      peersRef.current.set(joinerId, pc);

      // Create offer for the joiner
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('group-webrtc-offer', {
          receiverId: joiner.id,
          fromId: currentUser?.id,
          offer,
        });
      } catch (err) {
        console.error('[GroupCall] Error creating offer for joiner:', err);
      }
    });

    socket.on('group-call-left', (data) => {
      console.log('[GroupCall] group-call-left', data);
      const leftId = String(data.userId);
      
      // Close and remove the peer connection for this user
      const pc = peersRef.current.get(leftId);
      if (pc) {
        try { pc.close(); } catch { /* ignore */ }
        peersRef.current.delete(leftId);
      }
      
      setParticipants(prev => {
        const next = new Map(prev);
        next.delete(leftId);
        return next;
      });
      
      // If only the primary 1:1 peer remains and they left, end the call
      if (peersRef.current.size === 0 && !pcRef.current) {
        cleanupCall();
        soundManager.playCallEnded();
      }
    });

    socket.on('group-webrtc-offer', async (data) => {
      console.log('[GroupCall] group-webrtc-offer from', data.fromId);
      const fromId = String(data.fromId);
      
      let pc = peersRef.current.get(fromId);
      if (!pc) {
        // Create a new peer connection for this sender
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('group-ice-candidate', {
              targetId: data.fromId,
              fromId: currentUser?.id,
              candidate: event.candidate,
            });
          }
        };

        pc.ontrack = (event) => {
          const stream = event.streams[0];
          setParticipants(prev => {
            const next = new Map(prev);
            const existing = next.get(fromId);
            if (existing) {
              next.set(fromId, { ...existing, stream });
            }
            return next;
          });
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            peersRef.current.delete(fromId);
            setParticipants(prev => {
              const next = new Map(prev);
              next.delete(fromId);
              return next;
            });
          }
        };

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            pc.addTrack(track, localStreamRef.current);
          });
        }

        peersRef.current.set(fromId, pc);
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('group-webrtc-answer', {
          receiverId: data.fromId,
          fromId: currentUser?.id,
          answer,
        });
      } catch (err) {
        console.error('[GroupCall] Error handling group offer:', err);
      }
    });

    socket.on('group-webrtc-answer', async (data) => {
      console.log('[GroupCall] group-webrtc-answer from', data.fromId);
      const fromId = String(data.fromId);
      const pc = peersRef.current.get(fromId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        console.error('[GroupCall] Error handling group answer:', err);
      }
    });

    socket.on('group-ice-candidate', async (data) => {
      const fromId = String(data.fromId);
      const pc = peersRef.current.get(fromId);
      if (!pc || !data.candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('[GroupCall] Error adding group ICE candidate:', err);
      }
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]); // ← ONLY re-run when user changes, not on every state change

  // ── WebRTC Peer Connection (primary 1:1) ───────────────────────────────────
  const setupPeerConnection = useCallback((targetId) => {
    if (pcRef.current) {
      pcRef.current.close();
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          targetId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      // Also update participant stream
      const tid = String(targetId);
      setParticipants(prev => {
        const next = new Map(prev);
        const existing = next.get(tid);
        if (existing) {
          next.set(tid, { ...existing, stream: event.streams[0] });
        }
        return next;
      });
    };

    pc.onconnectionstatechange = () => {
      console.log('[Call] PC state:', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanupCall();
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pcRef.current = pc;
  }, [cleanupCall]);

  // ── Media Stream ──────────────────────────────────────────────────────────
  const getMediaStream = useCallback(async (hasVideo) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: hasVideo, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setIsVideoOff(!hasVideo);
      setIsMuted(false);
      return stream;
    } catch {
      if (hasVideo) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          setLocalStream(stream);
          localStreamRef.current = stream;
          setIsVideoOff(true);
          setIsMuted(false);
          return stream;
        } catch (e) {
          console.error('[Call] Audio also denied:', e);
          return null;
        }
      }
      return null;
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────────
  const initiateCall = useCallback(async (receiverId, receiverData, hasVideo = true) => {
    if (!socketRef.current?.connected) {
      await showAlert('Not connected to server. Please refresh.', { title: 'Connection Error' });
      return;
    }
    if (callStateRef.current !== 'idle') {
      await showAlert('You are already in a call.', { title: 'Active Call' });
      return;
    }

    const stream = await getMediaStream(hasVideo);
    if (!stream) {
      await showAlert('Microphone/Camera permission denied.', { title: 'Permission Required' });
      return;
    }

    setActiveCall({ targetId: receiverId, targetData: receiverData, hasVideo, isCaller: true });
    setCallState('calling');
    soundManager.playDialTone();
    setupPeerConnection(receiverId);

    socketRef.current.emit('call-request', {
      receiverId,
      callerData: {
        id: currentUser.id,
        name: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.username,
        avatar: currentUser.profile_picture,
        hasVideo,
      },
    });
  }, [currentUser, getMediaStream, setupPeerConnection]);

  const answerCall = useCallback(async (hasVideo = true) => {
    if (!incomingCallRef.current || !socketRef.current) return;

    const incoming = incomingCallRef.current;
    const callerId = incoming.callerData.id;
    const stream = await getMediaStream(hasVideo);
    if (!stream) {
      await showAlert('Microphone/Camera permission denied. Cannot answer call.', { title: 'Permission Required' });
      rejectCall();
      return;
    }

    soundManager.stopAll();
    callStartTimeRef.current = Date.now();
    callStatusRef.current = 'answered';

    if (incoming.isGroupInvite) {
      // ── Accepting a group call invite ─────────────────────────────────────
      // Set active call to the inviter
      setActiveCall({
        targetId: callerId,
        targetData: incoming.callerData,
        hasVideo: incoming.hasVideo || hasVideo,
        isCaller: false,
      });
      setCallState('connected');

      // Add all existing participants to our participants map
      const allParticipants = [
        { id: String(callerId), data: incoming.callerData },
        ...(incoming.existingParticipants || []).map(p => ({
          id: String(p.id),
          data: p.data || p,
        })),
      ];
      
      const participantMap = new Map();
      allParticipants.forEach(p => {
        participantMap.set(p.id, { id: p.id, data: p.data, stream: null });
      });
      setParticipants(participantMap);

      // Notify all existing participants that we joined
      const existingIds = allParticipants.map(p => Number(p.id));
      socketRef.current.emit('group-call-accepted', {
        participantIds: existingIds,
        joinerData: {
          id: currentUser.id,
          name: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.username,
          avatar: currentUser.profile_picture || currentUser.profilePicture,
          hasVideo,
        },
      });

      setIncomingCall(null);
    } else {
      // ── Accepting a normal 1:1 call ───────────────────────────────────────
      // Add caller as participant
      setParticipants(prev => {
        const next = new Map(prev);
        next.set(String(callerId), { id: String(callerId), data: incoming.callerData, stream: null });
        return next;
      });

      setActiveCall({
        targetId: callerId,
        targetData: incoming.callerData,
        hasVideo: incoming.callerData.hasVideo || hasVideo,
        isCaller: false,
      });
      setCallState('connected');
      setupPeerConnection(callerId);

      socketRef.current.emit('call-answered', {
        callerId,
        answererData: { id: currentUser.id, hasVideo },
      });

      setIncomingCall(null);
    }
  }, [currentUser, getMediaStream, rejectCall, setupPeerConnection]);

  // ── Add participant to ongoing call ────────────────────────────────────────
  const addParticipant = useCallback((userId, _userData) => {
    if (!socketRef.current?.connected || callStateRef.current !== 'connected') return;

    // Build list of existing participants (including ourselves)
    const existingParticipants = Array.from(participantsRef.current.values()).map(p => ({
      id: Number(p.id),
      data: p.data,
    }));

    socketRef.current.emit('group-call-invite', {
      receiverId: userId,
      callerData: getMyCallerData(),
      existingParticipants,
      hasVideo: activeCallRef.current?.hasVideo || false,
    });

    setShowAddPerson(false);
  }, [getMyCallerData]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoOff(!track.enabled);
    }
  }, []);

  return (
    <CallContext.Provider value={{
      callState,
      incomingCall,
      activeCall,
      localStream,
      remoteStream,
      isMuted,
      isVideoOff,
      initiateCall,
      answerCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleVideo,
      onlineUsers,
      // Group call
      participants,
      showAddPerson,
      setShowAddPerson,
      addParticipant,
    }}>
      {children}
    </CallContext.Provider>
  );
};
