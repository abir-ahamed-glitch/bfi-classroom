import React, { useEffect, useRef, useState } from 'react';
import { useCall } from '../context/CallContext';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { useAuth } from '../context/AuthContext';

/* ─── Shared Icons (inline SVG to avoid extra deps) ──────────────── */
const PhoneIcon     = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>;
const PhoneOffIcon  = ({ size = 24 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.52-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>;
const VideoIcon     = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>;
const VideoOffIcon  = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>;
const MicIcon       = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>;
const MicOffIcon    = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M19 11c0 1.19-.34 2.3-.9 3.28l-1.23-1.23c.27-.62.43-1.31.43-2.05H19zm-7 7c-2.76 0-5-2.24-5-5v-.17L5.47 11.3A8.9 8.9 0 0 0 5 14c0 3.53 2.61 6.43 6 6.92V23h2v-2.08c1.39-.2 2.63-.8 3.65-1.65l-1.65-1.65C14.49 18.56 13.29 19 12 19c-2.76 0-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V23h2v-2.08c.65-.09 1.27-.27 1.85-.52l3.57 3.57 1.28-1.28-4.56-4.56A4.98 4.98 0 0 0 17 12v-.17l-1.28-1.28zm-1.35-1.35L12 10.73V9c0-1.66-1.34-3-3-3-.36 0-.7.07-1.02.18L6.37 4.57C7.5 3.61 8.96 3 10.6 3 12.76 3 14.66 4.06 15.87 5.69L14.65 6.9A3.01 3.01 0 0 0 12 5c-.77 0-1.46.28-2 .73V9c0 1.38.94 2.54 2.2 2.9l.44.44c.07-.11.14-.22.2-.34H13c.13-.29.2-.6.2-.93L17.37 12.37z"/></svg>;
const UserPlusIcon  = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>;

/* Maximum participants in a single group call (including the two original callers) */
const MAX_PARTICIPANTS = 6;

/* ─── Global Styles injected once ─────────────────────────────────── */
const CALL_STYLES = `
  @keyframes call-slide-in {
    from { opacity: 0; transform: translateX(120%) scale(0.9); }
    to   { opacity: 1; transform: translateX(0)    scale(1);   }
  }
  @keyframes call-avatar-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.6); }
    50%       { box-shadow: 0 0 0 18px rgba(99,102,241,0); }
  }
  @keyframes call-ripple {
    0%   { transform: scale(1);   opacity: 0.8; }
    100% { transform: scale(2.2); opacity: 0;   }
  }
  @keyframes call-bg-pulse {
    0%, 100% { background-position: 0% 50%;   }
    50%       { background-position: 100% 50%; }
  }
  @keyframes call-connecting-dot {
    0%, 80%, 100% { transform: scale(0); opacity: 0; }
    40%           { transform: scale(1); opacity: 1; }
  }

  .call-ctrl-btn {
    width: 56px; height: 56px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s ease, filter 0.15s ease;
    position: relative;
    color: white;
  }
  .call-ctrl-btn:hover  { transform: scale(1.1); filter: brightness(1.2); }
  .call-ctrl-btn:active { transform: scale(0.95); }
  .call-ctrl-btn.danger {
    width: 68px; height: 68px;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    box-shadow: 0 8px 24px rgba(239,68,68,0.5);
  }
  .call-ctrl-btn.muted   { background: rgba(239,68,68,0.25); border: 1.5px solid rgba(239,68,68,0.5); }
  .call-ctrl-btn.neutral { background: rgba(255,255,255,0.12); border: 1.5px solid rgba(255,255,255,0.2); backdrop-filter: blur(8px); }

  .call-answer-btn {
    flex: 1; padding: 13px 16px;
    border: none; border-radius: 14px; cursor: pointer;
    font-weight: 700; font-size: 0.95rem;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: transform 0.15s ease, filter 0.15s ease;
    color: white;
  }
  .call-answer-btn:hover  { transform: translateY(-2px); filter: brightness(1.1); }
  .call-answer-btn:active { transform: scale(0.97); }
  .call-answer-btn.accept  {
    background: linear-gradient(135deg, #10b981, #059669);
    box-shadow: 0 6px 18px rgba(16,185,129,0.4);
  }
  .call-answer-btn.decline {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    box-shadow: 0 6px 18px rgba(239,68,68,0.4);
  }
`;

function InjectCallStyles() {
  useEffect(() => {
    if (document.getElementById('bfi-call-styles')) return;
    const el = document.createElement('style');
    el.id = 'bfi-call-styles';
    el.textContent = CALL_STYLES;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
  return null;
}

/* ─── Incoming Call Alert ─────────────────────────────────────────── */
export function IncomingCallAlert() {
  const { callState, incomingCall, answerCall, rejectCall } = useCall();

  if (callState !== 'receiving' || !incomingCall) return null;

  const caller = incomingCall.callerData;
  const isGroup = incomingCall.isGroupInvite;
  const existingNames = (incomingCall.existingParticipants || [])
    .map(p => p.data?.name || p.name || 'Someone').join(', ');
  const avatarSrc = caller.avatar
    ? resolveMediaUrl(caller.avatar)
    : `${import.meta.env.BASE_URL || '/'}avatars/male1.png`;

  return (
    <>
      <InjectCallStyles />
      <div style={{
        position: 'fixed', top: '24px', right: '24px', zIndex: 99999,
        width: '320px',
        background: 'linear-gradient(160deg, rgba(17,24,39,0.97) 0%, rgba(30,27,75,0.97) 100%)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: '20px',
        padding: '20px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.15)',
        animation: 'call-slide-in 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
        fontFamily: 'inherit',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
          {/* Avatar + ripple */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              position: 'absolute', inset: '-6px',
              borderRadius: '50%',
              background: 'rgba(99,102,241,0.3)',
              animation: 'call-ripple 2s infinite',
            }} />
            <img
              src={avatarSrc}
              alt={caller.name}
              style={{
                width: '56px', height: '56px', borderRadius: '50%',
                objectFit: 'cover', position: 'relative', zIndex: 1,
                border: '2.5px solid rgba(99,102,241,0.8)',
                animation: 'call-avatar-pulse 2s infinite',
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(167,139,250,1)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '3px' }}>
              {isGroup ? '👥 Group' : 'Incoming'} {caller.hasVideo ? 'Video' : 'Audio'} Call
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'white', lineHeight: 1.2 }}>
              {caller.name}
            </div>
            {isGroup && existingNames && (
              <div style={{ fontSize: '0.75rem', color: 'rgba(167,139,250,0.75)', marginTop: '2px' }}>
                with {existingNames}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: '#a78bfa',
                  animation: `call-connecting-dot 1.4s ${i * 0.25}s infinite ease-in-out`,
                }} />
              ))}
              <span style={{ fontSize: '0.8rem', color: 'rgba(167,139,250,0.8)' }}>ringing</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="call-answer-btn accept" onClick={() => answerCall(caller.hasVideo)}>
            <PhoneIcon size={18} /> Answer
          </button>
          <button className="call-answer-btn decline" onClick={rejectCall}>
            <PhoneOffIcon size={18} /> Decline
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Active Call Screen ──────────────────────────────────────────── */
/* ─── Add Person Modal ────────────────────────────────────────────── */
function AddPersonModal({ onClose }) {
  const { addParticipant, participants, onlineUsers } = useCall();
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const token = localStorage.getItem('token');
  const atCapacity = participants.size >= MAX_PARTICIPANTS;

  useEffect(() => {
    if (!token) return;
    fetch('/api/inbox/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

  const alreadyIn = new Set([
    String(currentUser?.id),
    ...Array.from(participants.keys()),
  ]);

  const filtered = users.filter(u =>
    !alreadyIn.has(String(u.id)) &&
    (u.name || u.username || '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(160deg,#111827,#1e1b4b)',
        border: '1px solid rgba(99,102,241,0.35)',
        borderRadius: '18px', padding: '24px', width: '320px', maxWidth: '90vw',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: 'white', fontSize: '1rem' }}>Add Person to Call</h3>
          <span style={{ fontSize: '0.75rem', color: 'rgba(167,139,250,0.7)' }}>{participants.size}/{MAX_PARTICIPANTS}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
        </div>
        {atCapacity && (
          <div style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
            color: '#fca5a5', fontSize: '0.82rem', textAlign: 'center',
          }}>
            Maximum {MAX_PARTICIPANTS} participants reached
          </div>
        )}
        <input
          autoFocus
          placeholder="Search users…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 14px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            color: 'white', fontSize: '0.9rem', outline: 'none', marginBottom: '12px',
          }}
        />
        <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '16px', fontSize: '0.85rem' }}>No users found</div>
          )}
          {filtered.map(u => {
            const isOnline = onlineUsers.has(String(u.id));
            const avatar = u.profile_picture ? resolveMediaUrl(u.profile_picture) : `${import.meta.env.BASE_URL || '/'}avatars/male1.png`;
            return (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 12px', borderRadius: '12px',
                background: 'rgba(255,255,255,0.06)', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={avatar} alt={u.name} style={{ width: '38px', height: '38px', borderRadius: '50%', objectFit: 'cover' }} />
                  {isOnline && <div style={{ position: 'absolute', bottom: 0, right: 0, width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', border: '2px solid #111827' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'white', fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.username}</div>
                  <div style={{ color: isOnline ? '#10b981' : 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>{isOnline ? 'Online' : 'Offline'}</div>
                </div>
                <button
                  onClick={() => addParticipant(u.id, u)}
                  disabled={atCapacity}
                  title={atCapacity ? `Max ${MAX_PARTICIPANTS} participants` : 'Invite to call'}
                  style={{
                    background: atCapacity ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                    border: 'none', borderRadius: '8px',
                    color: atCapacity ? 'rgba(255,255,255,0.3)' : 'white',
                    padding: '6px 12px', fontSize: '0.8rem',
                    cursor: atCapacity ? 'not-allowed' : 'pointer', flexShrink: 0,
                  }}
                >Invite</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Participant Video Tile ──────────────────────────────────────── */
function ParticipantTile({ participant }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = participant.stream || null;
  }, [participant.stream]);
  const d = participant.data || {};
  const name = d.name || d.username || 'User';
  const avatar = (d.profile_picture || d.avatar) ? resolveMediaUrl(d.profile_picture || d.avatar) : `${import.meta.env.BASE_URL || '/'}avatars/male1.png`;
  return (
    <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#111', aspectRatio: '4/3' }}>
      {participant.stream
        ? <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <img src={avatar} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.5)' }} />}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 10px', background: 'linear-gradient(transparent,rgba(0,0,0,0.75))', color: 'white', fontSize: '0.8rem', fontWeight: 600 }}>
        {name}
      </div>
    </div>
  );
}

/* ─── Active Call Screen ──────────────────────────────────────────── */
export function ActiveCallScreen() {
  const {
    callState, activeCall,
    localStream, remoteStream,
    isMuted, isVideoOff,
    endCall, toggleMute, toggleVideo,
    participants, showAddPerson, setShowAddPerson,
  } = useCall();

  const localRef  = useRef(null);
  const remoteRef = useRef(null);
  const groupCount = participants.size;
  const isGroup = groupCount > 1;

  // Attach streams whenever they arrive or the video element mounts
  useEffect(() => {
    if (localRef.current) {
      localRef.current.srcObject = localStream || null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current) {
      remoteRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream]);

  if (callState === 'idle' || callState === 'receiving') return null;

  const target     = activeCall?.targetData;
  const avatarSrc  = (target?.profile_picture || target?.avatar)
    ? resolveMediaUrl(target.profile_picture || target.avatar)
    : `${import.meta.env.BASE_URL || '/'}avatars/male1.png`;

  const isCalling   = callState === 'calling';
  const isConnected = callState === 'connected';
  const hasRemote   = !!remoteStream;
  const targetName  = target?.name || (target
    ? (`${target.first_name || target.firstName || ''} ${target.last_name || target.lastName || ''}`.trim() || target.username || 'User')
    : 'User');

  return (
    <>
      <InjectCallStyles />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: '#000',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit',
        userSelect: 'none',
      }}>

        {/* ── Video / Avatar Area ── */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Animated gradient bg */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(270deg, #0f0c29, #302b63, #1a1a2e, #16213e)',
            backgroundSize: '400% 400%',
            animation: 'call-bg-pulse 6s ease infinite',
            zIndex: 0,
          }} />

          {/* ── GROUP: participant grid ── */}
          {isGroup ? (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 2,
              display: 'grid',
              gridTemplateColumns: groupCount <= 2 ? '1fr 1fr' : groupCount <= 4 ? '1fr 1fr' : '1fr 1fr 1fr',
              gap: '4px', padding: '4px',
              alignContent: 'stretch',
            }}>
              {Array.from(participants.values()).map(p => (
                <ParticipantTile key={p.id} participant={p} />
              ))}
            </div>
          ) : (
            /* ── 1:1: single remote video ── */
            <video
              ref={remoteRef}
              autoPlay
              playsInline
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                zIndex: 1,
                opacity: hasRemote ? 1 : 0,
                transition: 'opacity 0.5s ease',
              }}
            />
          )}

          {/* Calling / Connecting overlay — fades out when remote stream arrives */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
            zIndex: 2,
            opacity: hasRemote ? 0 : 1,
            transition: 'opacity 0.5s ease',
            pointerEvents: hasRemote ? 'none' : 'auto',
          }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: '24px' }}>
              {[1, 2].map(i => (
                <div key={i} style={{
                  position: 'absolute',
                  inset: `${-i * 14}px`,
                  borderRadius: '50%',
                  border: `1.5px solid rgba(167,139,250,${0.3 / i})`,
                  animation: `call-ripple ${1.4 + i * 0.4}s ${i * 0.3}s infinite`,
                }} />
              ))}
              <img
                src={avatarSrc}
                alt={targetName}
                style={{
                  width: '120px', height: '120px',
                  borderRadius: '50%', objectFit: 'cover',
                  border: '3px solid rgba(167,139,250,0.6)',
                }}
              />
            </div>
            <h2 style={{ color: 'white', margin: '0 0 8px', fontSize: '1.6rem', fontWeight: 700, textAlign: 'center' }}>
              {targetName}
            </h2>
            <p style={{ color: 'rgba(167,139,250,0.85)', margin: 0, fontSize: '1rem', letterSpacing: '0.04em' }}>
              {isCalling ? 'Calling…' : (isConnected ? 'Connecting…' : '')}
            </p>
          </div>

          {/* ── Local (PiP) video — ALWAYS in DOM, hidden via CSS when video off ── */}
          <div style={{
            position: 'absolute',
            bottom: '100px', right: '16px',
            width: '120px', height: '160px',
            borderRadius: '14px', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            border: '2px solid rgba(255,255,255,0.18)',
            zIndex: 10,
            // Use opacity + pointer-events instead of removing from DOM
            opacity: isVideoOff ? 0 : 1,
            pointerEvents: isVideoOff ? 'none' : 'auto',
            transition: 'opacity 0.3s ease',
            background: '#111',
          }}>
            <video
              ref={localRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)', // mirror effect like a selfie camera
              }}
            />
            {/* "Camera Off" placeholder shown inside the PiP when video is off */}
            {isVideoOff && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#1a1a2e',
                color: 'rgba(167,139,250,0.7)', fontSize: '0.7rem', textAlign: 'center',
              }}>
                <VideoOffIcon size={28} />
              </div>
            )}
          </div>
        </div>

        {/* ── Controls Bar ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '20px 0 38px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px',
          zIndex: 20,
        }}>
          <button
            className={`call-ctrl-btn ${isMuted ? 'muted' : 'neutral'}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
          </button>

          {/* Add Person button — only shown when connected */}
          {callState === 'connected' && (
            <button
              className="call-ctrl-btn neutral"
              onClick={() => participants.size < MAX_PARTICIPANTS && setShowAddPerson(true)}
              title={participants.size >= MAX_PARTICIPANTS ? `Max ${MAX_PARTICIPANTS} participants reached` : 'Add person to call'}
              disabled={participants.size >= MAX_PARTICIPANTS}
              style={{
                background: participants.size >= MAX_PARTICIPANTS ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.25)',
                border: `1.5px solid ${participants.size >= MAX_PARTICIPANTS ? 'rgba(255,255,255,0.1)' : 'rgba(99,102,241,0.5)'}`,
                opacity: participants.size >= MAX_PARTICIPANTS ? 0.45 : 1,
                cursor: participants.size >= MAX_PARTICIPANTS ? 'not-allowed' : 'pointer',
              }}
            >
              <UserPlusIcon size={22} />
            </button>
          )}

          <button
            className="call-ctrl-btn danger"
            onClick={endCall}
            title="End Call"
          >
            <PhoneOffIcon size={26} />
          </button>

          <button
            className={`call-ctrl-btn ${isVideoOff ? 'muted' : 'neutral'}`}
            onClick={toggleVideo}
            title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {isVideoOff ? <VideoOffIcon size={22} /> : <VideoIcon size={22} />}
          </button>
        </div>

        {/* Add Person Modal */}
        {showAddPerson && <AddPersonModal onClose={() => setShowAddPerson(false)} />}
      </div>
    </>
  );
}
