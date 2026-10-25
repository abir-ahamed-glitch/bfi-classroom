import { compressImage, isVideoFile } from '../utils/imageCompressor';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveMediaUrl } from '../utils/mediaUtils';
import {
  ArrowLeft,
  AtSign,
  Bell,
  BellOff,
  CornerUpLeft,
  File as FileIcon,
  FileText,
  Forward,
  Hash,
  IdCard,
  Image as ImageIcon,
  Link as LinkIcon,
  MoreVertical,
  Paperclip,
  Pencil,
  Phone,
  Search,
  SearchIcon,
  Send,
  SendHorizontal,
  SmilePlus,
  Trash2,
  UserPlus,
  Video,
  X,
  Mic,
  Plus,
  Play,
  Pause,
  Loader,
  Pin,
  PinOff,
  Flag,
  Info,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  User,
  Heart,
  Smile,
  Sticker,
  CopyPlus,
  Clock,
  Check,
  Download,
  Megaphone,
} from 'lucide-react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { soundManager } from '../utils/AudioSynthesizer';

import SkeletonLoader from '../components/SkeletonLoader';
import './Inbox.css';
import {
  E2E_FILE_PREFIX,
  E2E_PREFIX,
  decryptFileE2E,
  decryptMessageE2E,
  encryptFileE2E,
  encryptMessageE2E,
} from '../utils/e2eCrypto';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
import GifPicker from '../components/GifPicker';
import { MessageWithLinks } from '../components/LinkPreview';


const NativeEmojiPicker = React.memo(({ onEmojiSelect, theme }) => {
  const containerRef = useRef(null);
  const onSelectRef = useRef(onEmojiSelect);

  // Keep the latest callback without triggering the picker recreation
  useEffect(() => {
    onSelectRef.current = onEmojiSelect;
  }, [onEmojiSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Safety: Clear container to prevent duplicate instances
    containerRef.current.innerHTML = '';
    
    const picker = new Picker({
      data,
      onEmojiSelect: (emoji) => onSelectRef.current?.(emoji),
      theme,
      previewPosition: 'none',
    });
    
    containerRef.current.appendChild(picker);
    
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [theme]); // Only re-run if theme changes

  return <div ref={containerRef} />;
}, (prevProps, nextProps) => {
  // Only re-render if the theme changes; onEmojiSelect is handled via Ref
  return prevProps.theme === nextProps.theme;
});

const VOICE_WAVE_BARS = [10, 14, 8, 18, 12, 22, 9, 16, 28, 12, 20, 32, 14, 24, 11, 18, 26, 12, 30, 16, 22, 10, 18, 14, 24, 12, 20, 9, 16, 12];

const QUICK_REACTIONS = [
  '\u2764\uFE0F',
  '\u{1F44D}',
  '\u{1F602}',
  '\u{1F525}',
  '\u{1F62E}',
  '\u{1F44F}',
];

const DEFAULT_CHAT_QUICK_EMOJI = '\u{1F44D}';

const REACTION_EMOJIS = [
  { emoji: '\u2764\uFE0F', name: 'Red heart', category: 'Your reactions', keywords: ['love', 'heart'] },
  { emoji: '\u{1F606}', name: 'Grinning squinting face', category: 'Your reactions', keywords: ['laugh', 'happy'] },
  { emoji: '\u{1F62E}', name: 'Face with open mouth', category: 'Your reactions', keywords: ['wow', 'surprised'] },
  { emoji: '\u{1F622}', name: 'Crying face', category: 'Your reactions', keywords: ['sad', 'cry'] },
  { emoji: '\u{1F621}', name: 'Pouting face', category: 'Your reactions', keywords: ['angry', 'mad'] },
  { emoji: '\u{1F44D}', name: 'Thumbs up', category: 'Your reactions', keywords: ['like', 'agree'] },
  { emoji: '\u{1F600}', name: 'Grinning face', category: 'Smileys & People', keywords: ['smile', 'happy'] },
  { emoji: '\u{1F603}', name: 'Grinning face with big eyes', category: 'Smileys & People', keywords: ['smile', 'happy'] },
  { emoji: '\u{1F604}', name: 'Grinning face with smiling eyes', category: 'Smileys & People', keywords: ['smile', 'happy'] },
  { emoji: '\u{1F601}', name: 'Beaming face with smiling eyes', category: 'Smileys & People', keywords: ['smile', 'happy'] },
  { emoji: '\u{1F606}', name: 'Grinning squinting face', category: 'Smileys & People', keywords: ['laugh'] },
  { emoji: '\u{1F979}', name: 'Face holding back tears', category: 'Smileys & People', keywords: ['tears', 'touched'] },
  { emoji: '\u{1F605}', name: 'Grinning face with sweat', category: 'Smileys & People', keywords: ['sweat', 'relief'] },
  { emoji: '\u{1F602}', name: 'Face with tears of joy', category: 'Smileys & People', keywords: ['laugh', 'joy'] },
  { emoji: '\u{1F923}', name: 'Rolling on the floor laughing', category: 'Smileys & People', keywords: ['laugh', 'funny'] },
  { emoji: '\u{1F622}', name: 'Crying face', category: 'Smileys & People', keywords: ['sad'] },
  { emoji: '\u{1F60C}', name: 'Relieved face', category: 'Smileys & People', keywords: ['relieved', 'calm'] },
  { emoji: '\u{1F60A}', name: 'Smiling face with smiling eyes', category: 'Smileys & People', keywords: ['smile', 'blush'] },
  { emoji: '\u{1F607}', name: 'Smiling face with halo', category: 'Smileys & People', keywords: ['angel', 'innocent'] },
  { emoji: '\u{1F642}', name: 'Slightly smiling face', category: 'Smileys & People', keywords: ['smile'] },
  { emoji: '\u{1F62E}', name: 'Face with open mouth', category: 'Smileys & People', keywords: ['wow', 'surprised'] },
  { emoji: '\u{1F609}', name: 'Winking face', category: 'Smileys & People', keywords: ['wink'] },
  { emoji: '\u{1F60E}', name: 'Smiling face with sunglasses', category: 'Smileys & People', keywords: ['cool'] },
  { emoji: '\u{1F60D}', name: 'Smiling face with heart-eyes', category: 'Smileys & People', keywords: ['love', 'heart'] },
  { emoji: '\u{1F618}', name: 'Face blowing a kiss', category: 'Smileys & People', keywords: ['kiss', 'love'] },
  { emoji: '\u{1F970}', name: 'Smiling face with hearts', category: 'Smileys & People', keywords: ['love', 'hearts'] },
  { emoji: '\u{1F914}', name: 'Thinking face', category: 'Smileys & People', keywords: ['think', 'curious'] },
  { emoji: '\u{1F928}', name: 'Face with raised eyebrow', category: 'Smileys & People', keywords: ['skeptical', 'doubt'] },
  { emoji: '\u{1F644}', name: 'Face with rolling eyes', category: 'Smileys & People', keywords: ['eyeroll', 'annoyed'] },
  { emoji: '\u{1F62C}', name: 'Grimacing face', category: 'Smileys & People', keywords: ['awkward', 'nervous'] },
  { emoji: '\u{1F634}', name: 'Sleeping face', category: 'Smileys & People', keywords: ['sleep', 'tired'] },
  { emoji: '\u{1F92F}', name: 'Exploding head', category: 'Smileys & People', keywords: ['mind blown', 'shocked'] },
  { emoji: '\u{1F973}', name: 'Partying face', category: 'Smileys & People', keywords: ['party', 'celebrate'] },
  { emoji: '\u{1F97A}', name: 'Pleading face', category: 'Smileys & People', keywords: ['please', 'cute'] },
  { emoji: '\u{1F910}', name: 'Zipper-mouth face', category: 'Smileys & People', keywords: ['secret', 'quiet'] },
  { emoji: '\u{1F92B}', name: 'Shushing face', category: 'Smileys & People', keywords: ['shush', 'quiet'] },
  { emoji: '\u{1F921}', name: 'Clown face', category: 'Smileys & People', keywords: ['silly', 'funny'] },
  { emoji: '\u{1F47B}', name: 'Ghost', category: 'Smileys & People', keywords: ['ghost', 'spooky'] },
  { emoji: '\u{1F480}', name: 'Skull', category: 'Smileys & People', keywords: ['dead', 'skull'] },
  { emoji: '\u{1F44C}', name: 'OK hand', category: 'Gestures', keywords: ['ok', 'perfect'] },
  { emoji: '\u{1F64F}', name: 'Folded hands', category: 'Gestures', keywords: ['thanks', 'pray'] },
  { emoji: '\u{1F44A}', name: 'Oncoming fist', category: 'Gestures', keywords: ['fist', 'respect'] },
  { emoji: '\u{1F91D}', name: 'Handshake', category: 'Gestures', keywords: ['deal', 'agreement'] },
  { emoji: '\u270C\uFE0F', name: 'Victory hand', category: 'Gestures', keywords: ['peace', 'victory'] },
  { emoji: '\u{1F4AA}', name: 'Flexed biceps', category: 'Gestures', keywords: ['strong', 'power'] },
  { emoji: '\u{1F64C}', name: 'Raising hands', category: 'Gestures', keywords: ['hooray', 'celebrate'] },
  { emoji: '\u{1F525}', name: 'Fire', category: 'Symbols', keywords: ['hot', 'great'] },
  { emoji: '\u{1F389}', name: 'Party popper', category: 'Symbols', keywords: ['celebrate', 'congrats'] },
  { emoji: '\u{1F44F}', name: 'Clapping hands', category: 'Symbols', keywords: ['clap', 'applause'] },
  { emoji: '\u2728', name: 'Sparkles', category: 'Symbols', keywords: ['sparkle', 'magic'] },
  { emoji: '\u2B50', name: 'Star', category: 'Symbols', keywords: ['star', 'favorite'] },
  { emoji: '\u{1F4AF}', name: 'Hundred points', category: 'Symbols', keywords: ['perfect', 'hundred'] },
  { emoji: '\u{1F3C6}', name: 'Trophy', category: 'Symbols', keywords: ['winner', 'award'] },
  { emoji: '\u{1F680}', name: 'Rocket', category: 'Symbols', keywords: ['rocket', 'fast'] },
  { emoji: '\u{1F4A1}', name: 'Light bulb', category: 'Symbols', keywords: ['idea', 'smart'] },
  { emoji: '\u{1F3AC}', name: 'Clapper board', category: 'Symbols', keywords: ['film', 'movie'] },
  { emoji: '\u{1F3A5}', name: 'Movie camera', category: 'Symbols', keywords: ['camera', 'film'] },
  { emoji: '\u{1F3B5}', name: 'Musical note', category: 'Symbols', keywords: ['music', 'song'] },
  { emoji: '\u{1F3A8}', name: 'Artist palette', category: 'Symbols', keywords: ['art', 'creative'] },
  { emoji: '\u{1F451}', name: 'Crown', category: 'Symbols', keywords: ['king', 'best'] },
];

const normalizeUserId = (value) => Number(value);
const API_BASE = import.meta.env.VITE_API_URL || '';

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected non-JSON response (${response.status}). Please refresh the app and restart the backend server.`);
  }

  return JSON.parse(text);
}

function buildApiUrl(path) {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

async function apiFetch(path, options = {}) {
  return fetch(buildApiUrl(path), options);
}

function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(value);

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }

  return new Date(`${trimmed.replace(' ', 'T')}Z`);
}

function formatLocalTime(value) {
  const date = parseServerDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMessageSortTime(value) {
  const date = parseServerDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function formatRelativeShortTime(value) {
  const date = parseServerDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(1, Math.floor(diffMs / 1000));
  if (diffSeconds < 60) return 'now';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const VoiceMessagePlayer = ({ src, isMine, avatarUrl }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const durationRef = useRef(0);

  // Keep durationRef in sync with state
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Derive duration via AudioContext decoding (handles Infinity duration from streaming formats)
  useEffect(() => {
    if (!src) return;
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(ab => {
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        return actx.decodeAudioData(ab).then(decoded => {
          actx.close();
          return decoded;
        });
      })
      .then(decoded => {
        if (decoded.duration && decoded.duration !== Infinity) {
          setDuration(decoded.duration);
        }
      })
      .catch(() => {});
  }, [src]);

  const updateProgressLoopRef = useRef(null);

  // Smooth progress loop using requestAnimationFrame instead of timeupdate
  const updateProgressLoop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    const validAudioDur = (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration)) ? audio.duration : 0;
    const dur = durationRef.current || validAudioDur || 1;
    const cur = audio.currentTime;
    setCurrentTime(cur);
    setProgress(dur > 0 ? Math.min((cur / dur) * 100, 100) : 0);
    rafRef.current = requestAnimationFrame(updateProgressLoopRef.current);
  }, []);

  useEffect(() => {
    updateProgressLoopRef.current = updateProgressLoop;
  }, [updateProgressLoop]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setIsPlaying(false));
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateProgressLoop);
  };
  const handlePause = () => {
    setIsPlaying(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  // Clean up RAF on unmount
  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const handleEnded = () => {
    setIsPlaying(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setProgress(0);
    setCurrentTime(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const handleLoadedMetadata = (e) => {
    const audio = e.target;
    if (!audio.duration || audio.duration === Infinity || isNaN(audio.duration)) {
      // Chrome WebM duration bug workaround
      audio.currentTime = 1e8;
      
      const onDurationChange = () => {
        if (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration)) {
          audio.removeEventListener('durationchange', onDurationChange);
          audio.removeEventListener('timeupdate', onDurationChange);
          setDuration(audio.duration);
          audio.currentTime = 0;
        }
      };
      
      audio.addEventListener('durationchange', onDurationChange);
      audio.addEventListener('timeupdate', onDurationChange);
    } else if (audio.duration) {
      setDuration(audio.duration);
    }
  };

  const formatTime = (secs) => {
    const s = Math.round(secs);
    if (isNaN(s) || !isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // Handle fallback time update
  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const validAudioDur = (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration)) ? audio.duration : 0;
    const dur = durationRef.current || validAudioDur || 1;
    const cur = audio.currentTime;
    setCurrentTime(cur);
    setProgress(dur > 0 ? Math.min((cur / dur) * 100, 100) : 0);
  };

  const activeBarIndex = progress > 0 ? Math.floor((progress / 100) * (VOICE_WAVE_BARS.length - 1)) : -1;

  return (
    <div className={`voice-message-player ${isMine ? 'mine' : 'theirs'}`}>
      <div className="vmp-avatar-container">
        <img src={avatarUrl ? avatarUrl : `${import.meta.env.BASE_URL}avatars/male1.png`} className="vmp-avatar-img" alt="" />
        <div className="vmp-mic-badge"><Mic size={10} fill="currentColor" /></div>
      </div>
      <button type="button" className="vmp-play-btn" onClick={togglePlay}>
        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="vmp-content">
        <div className="vmp-waveform" style={{ width: '148px' }}>
          <div className="vmp-bars" aria-hidden="true">
            {VOICE_WAVE_BARS.map((height, index) => (
              <span
                key={`vmp-bar-${index}`}
                className={index <= activeBarIndex ? 'active' : ''}
                style={{ height: `${height}px` }}
              />
            ))}
          </div>

          <input
            type="range"
            className="vmp-slider"
            min="0"
            max="100"
            value={progress}
            onChange={(e) => {
              const val = Number(e.target.value);
              setProgress(val);
              if (audioRef.current) {
                const nextTime = (val / 100) * (duration || audioRef.current.duration || 1);
                audioRef.current.currentTime = nextTime;
                setCurrentTime(nextTime);
              }
            }}
            style={{ '--progress': `${progress}%` }}
            aria-label="Seek voice message"
          />
        </div>
        <div className="vmp-meta">
          <span className="vmp-time">
            {formatTime(isPlaying ? currentTime : duration || currentTime || 0)}
          </span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        style={{ display: 'none' }}
      />
    </div>
  );
};

const getOrdinalSuffix = (i) => {
  if (!i) return '';
  const num = parseInt(i, 10);
  if (isNaN(num)) return i;
  const j = num % 10, k = num % 100;
  if (j === 1 && k !== 11) return num + "st";
  if (j === 2 && k !== 12) return num + "nd";
  if (j === 3 && k !== 13) return num + "rd";
  return num + "th";
};

const getRoleDisplayText = (role, batch, user) => {
  if (role === 'student') return batch ? `Student - ${getOrdinalSuffix(batch)} Batch` : 'Student';
  if (role === 'admin') return (user?.is_super_admin || user?.isSuperAdmin) ? 'Super Admin' : 'Admin';
  if (role === 'instructor') return 'Teacher';
  return role || 'User';
};

export default function Inbox() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { initiateCall, onlineUsers } = useCall();
  const [loading, setLoading] = useState(true);
  const [hasBroadcastPermission, setHasBroadcastPermission] = useState(false);
  const [quickBroadcastOpen, setQuickBroadcastOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ title: '', message: '', audience_type: 'all', audience_value: '', priority: 'normal', allow_reply: false });
  const [quickSending, setQuickSending] = useState(false);
  const [batches, setBatches] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [drafts, setDrafts] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('chat_drafts') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  
  // Auto-save drafts
  useEffect(() => {
    if (activeChat?.other_user_id && typeof newMessage === 'string') {
      try {
        const parsed = JSON.parse(localStorage.getItem('chat_drafts') || '{}');
        const stored = parsed && typeof parsed === 'object' ? parsed : {};
        stored[activeChat.other_user_id] = newMessage;
        localStorage.setItem('chat_drafts', JSON.stringify(stored));
        setDrafts(stored);
      } catch (e) {
        console.error('Failed to save draft', e);
      }
    }
  }, [newMessage, activeChat?.other_user_id]);

  useEffect(() => {
    const checkPermission = async () => {
      if (currentUser?.role !== 'instructor') {
        setHasBroadcastPermission(false);
        return;
      }
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const response = await fetch('/api/admin/broadcast/my-permission', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setHasBroadcastPermission(Boolean(data.hasPermission));
        } else {
          setHasBroadcastPermission(false);
        }
      } catch (err) {
        console.error('Failed to check broadcast permission', err);
        setHasBroadcastPermission(false);
      }
    };
    checkPermission();
  }, [currentUser]);

  useEffect(() => {
    if (quickBroadcastOpen && batches.length === 0) {
      const token = localStorage.getItem('token');
      fetch('/api/admin/batches', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => setBatches(d.batches || []))
        .catch(err => console.error('Failed to fetch batches', err));
    }
  }, [quickBroadcastOpen, batches.length]);
  
  const clearAttachments = () => {
    setAttachedFiles(prev => {
      prev.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
      return [];
    });
  };

  const removeAttachment = (id) => {
    setAttachedFiles(prev => prev.map(f => f.id === id ? { ...f, isRemoving: true } : f));
    setTimeout(() => {
      setAttachedFiles(prev => prev.filter(f => {
        if (f.id === id) {
          if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
          return false;
        }
        return true;
      }));
    }, 200);
  };

  const handleSendQuickBroadcast = async (e) => {
    e.preventDefault();
    if (!quickForm.title.trim() || !quickForm.message.trim()) {
      alert('Title and Message are required.');
      return;
    }
    setQuickSending(true);
    const token = localStorage.getItem('token');
    try {
      // 1. Create draft
      const draftRes = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: quickForm.title,
          message: quickForm.message,
          audience_type: quickForm.audience_type,
          audience_value: quickForm.audience_value || null,
          priority: quickForm.priority,
          allow_reply: quickForm.allow_reply,
          status: 'draft'
        })
      });
      const draftData = await draftRes.json();
      if (!draftData.broadcast) {
        alert(draftData.error || 'Failed to create broadcast');
        setQuickSending(false);
        return;
      }

      // 2. Send broadcast
      const sendRes = await fetch(`/api/admin/broadcast/${draftData.broadcast.id}/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const sendData = await sendRes.json();
      if (sendData.success) {
        alert(`Broadcast successfully sent to ${sendData.total_recipients} students.`);
        setQuickBroadcastOpen(false);
        setQuickForm({ title: '', message: '', audience_type: 'all', audience_value: '', priority: 'normal', allow_reply: false });
      } else {
        alert(sendData.error || 'Failed to send broadcast');
      }
    } catch (err) {
      console.error('Quick broadcast error:', err);
      alert('An error occurred while sending the broadcast.');
    }
    setQuickSending(false);
  };
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [sidebarSearchResults, setSidebarSearchResults] = useState([]);
  const [searchingSidebarUsers, setSearchingSidebarUsers] = useState(false);
  
  // Global message search states
  const [isGlobalMessageSearchActive, setIsGlobalMessageSearchActive] = useState(false);
  const [globalMessageSearchQuery, setGlobalMessageSearchQuery] = useState('');
  const [globalMessageSearchResults, setGlobalMessageSearchResults] = useState([]);
  const [searchingGlobalMessages, setSearchingGlobalMessages] = useState(false);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState(null);
  const [composerMode, setComposerMode] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openMenuDirection, setOpenMenuDirection] = useState('up');
  const [reactionBarId, setReactionBarId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [reactionPickerDirection, setReactionPickerDirection] = useState('up');
  const [reactionSearchQuery, setReactionSearchQuery] = useState('');
  const [recentReactions, setRecentReactions] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('inbox_recent_reactions') || '[]');
      return stored.filter((reaction) => REACTION_EMOJIS.some((item) => item.emoji === reaction)).slice(0, 6);
    } catch {
      return [];
    }
  });
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  
  const [decryptedAttachmentUrls, setDecryptedAttachmentUrls] = useState({});
  const [imageViewer, setImageViewer] = useState(null);
  const [pdfViewer, setPdfViewer] = useState(null);
  const [activeMediaTab, setActiveMediaTab] = useState('media');

  const handleDownload = async (imageUrl) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = imageUrl.split('/').pop().split('?')[0] || 'chat_attachment.png';
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download image', err);
      window.open(imageUrl, '_blank');
    }
  };

  useEffect(() => {
    setActiveMediaTab('media');
  }, [activeChat?.other_user_id]);
  const [showChatInfoPanel, setShowChatInfoPanel] = useState(true);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [chatInfoAccordion, setChatInfoAccordion] = useState(false);
  const [chatOptionsAccordion, setChatOptionsAccordion] = useState(false);
  const [mediaAccordion, setMediaAccordion] = useState(false);
  const [chatEmojiPickerOpen, setChatEmojiPickerOpen] = useState(false);
  const [chatEmojiSearchQuery, setChatEmojiSearchQuery] = useState('');
  const [chatEmojiCategory, setChatEmojiCategory] = useState('Smileys & People');
  const [chatQuickEmojis, setChatQuickEmojis] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('inbox_chat_quick_emojis') || '{}');
      return stored && typeof stored === 'object' ? stored : {};
    } catch {
      return {};
    }
  });
  const [pinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [pinnedMessageMenuId, setPinnedMessageMenuId] = useState(null);
  const [highlightedPinnedMessageId, setHighlightedPinnedMessageId] = useState(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [recordingWaveTick, setRecordingWaveTick] = useState(0);
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState(null);
  const [isRecordingPreviewPlaying, setIsRecordingPreviewPlaying] = useState(false);
  const [recordingPreviewPeaks, setRecordingPreviewPeaks] = useState([]);
  const [recordingPlaybackProgress, setRecordingPlaybackProgress] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingPreviewAudioRef = useRef(null);
  const recordingPreviewFrameRef = useRef(null);
  const recordingPreviewFileRef = useRef(null);
  const recordingPreviewUrlRef = useRef(null);
  const recordingPreviewDurationRef = useRef(0);
  const recordingMimeTypeRef = useRef('audio/webm');
  const recordingStreamRef = useRef(null);
  const recordingAudioContextRef = useRef(null);
  const recordingAnalyserFrameRef = useRef(null);
  const discardRecordingRef = useRef(false);
  const sendRecordingOnStopRef = useRef(false);
  const previewRecordingOnStopRef = useRef(false);

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const startRecordingTimer = () => {
    stopRecordingTimer();
    recordingTimerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
  };

  const cleanupRecordingStream = () => {
    if (recordingAnalyserFrameRef.current) {
      cancelAnimationFrame(recordingAnalyserFrameRef.current);
      recordingAnalyserFrameRef.current = null;
    }
    if (recordingAudioContextRef.current) {
      recordingAudioContextRef.current.close().catch(() => {});
      recordingAudioContextRef.current = null;
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach(track => track.stop());
      recordingStreamRef.current = null;
    }
    setRecordingLevel(0);
    setRecordingWaveTick(0);
  };

  const clearRecordingPreview = () => {
    if (recordingPreviewFrameRef.current) {
      cancelAnimationFrame(recordingPreviewFrameRef.current);
      recordingPreviewFrameRef.current = null;
    }
    if (recordingPreviewAudioRef.current) {
      recordingPreviewAudioRef.current.pause();
      recordingPreviewAudioRef.current.currentTime = 0;
    }
    setRecordingPreviewUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return null;
    });
    recordingPreviewUrlRef.current = null;
    recordingPreviewDurationRef.current = 0;
    setIsRecordingPreviewPlaying(false);
    setRecordingPlaybackProgress(0);
    setRecordingPreviewPeaks([]);
    recordingPreviewFileRef.current = null;
  };

  const getRecordingMimeType = () => recordingMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'audio/webm';

  const createVoiceFileFromChunks = (chunks = audioChunksRef.current) => {
    if (!chunks.length) return null;
    const type = getRecordingMimeType();
    const audioBlob = new Blob(chunks, { type });
    if (!audioBlob.size) return null;
    const audioExtension = type.includes('mp4') ? 'm4a' : 'webm';
    return new File([audioBlob], `voice-message-${Date.now()}.${audioExtension}`, { type, lastModified: Date.now() });
  };

  const analyzeRecordingPreview = async (blob) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !blob?.size) {
      setRecordingPreviewPeaks([]);
      return;
    }

    try {
      const audioContext = new AudioContextClass();
      const decodedBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
      const decodedDuration = decodedBuffer.duration;
      if (decodedDuration && decodedDuration !== Infinity) {
        recordingPreviewDurationRef.current = decodedDuration;
      }
      const channelData = decodedBuffer.getChannelData(0);
      const segmentSize = Math.max(1, Math.floor(channelData.length / VOICE_WAVE_BARS.length));
      const peaks = VOICE_WAVE_BARS.map((_, barIndex) => {
        const start = barIndex * segmentSize;
        const end = Math.min(channelData.length, start + segmentSize);
        let sum = 0;
        for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
          sum += channelData[sampleIndex] * channelData[sampleIndex];
        }
        return Math.min(1, Math.sqrt(sum / Math.max(1, end - start)) * 8);
      });
      const maxPeak = Math.max(...peaks, 0.01);
      setRecordingPreviewPeaks(peaks.map((peak) => Math.max(0.12, peak / maxPeak)));
      await audioContext.close();
    } catch (error) {
      console.warn('Could not analyze voice preview waveform', error);
      setRecordingPreviewPeaks([]);
    }
  };

  const buildRecordingPreview = () => {
    const file = createVoiceFileFromChunks();
    if (!file) return;
    recordingPreviewFileRef.current = file;
    setRecordingPreviewUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      const url = URL.createObjectURL(file);
      recordingPreviewUrlRef.current = url;
      return url;
    });
    analyzeRecordingPreview(file);
  };

  const playRecordingPreview = () => {
    // Use refs instead of closure state to avoid stale closures
    const currentFile = recordingPreviewFileRef.current;
    const currentUrl = recordingPreviewUrlRef.current;
    const audio = recordingPreviewAudioRef.current;

    console.log('[VOICE DEBUG] playRecordingPreview called', {
      isRecordingPreviewPlaying,
      hasUrl: !!currentUrl,
      hasAudioRef: !!audio,
      hasFile: !!currentFile,
      chunksLength: audioChunksRef.current?.length,
    });

    // Toggle: if already playing, just pause
    if (isRecordingPreviewPlaying && audio) {
      audio.pause();
      setIsRecordingPreviewPlaying(false);
      return;
    }

    // Make sure we have audio data (use ref, not closure)
    let file = currentFile;
    if (!file) {
      file = createVoiceFileFromChunks();
      if (!file) {
        console.warn('[VOICE DEBUG] No audio data to preview');
        showModernAlert('No audio has been captured yet.', 'Voice Preview');
        return;
      }
      recordingPreviewFileRef.current = file;
    }

    // Ensure preview URL exists (triggers React to render the <audio> element)
    if (!currentUrl) {
      console.log('[VOICE DEBUG] Creating preview URL from file');
      const newUrl = URL.createObjectURL(file);
      recordingPreviewUrlRef.current = newUrl;
      setRecordingPreviewUrl(newUrl);
      analyzeRecordingPreview(file);
    }

    // Wait for the <audio> element to appear in the DOM and be ready, then play
    let attempts = 0;
    const maxAttempts = 40; // 40 * 50ms = 2 seconds max wait
    const waitAndPlay = () => {
      attempts++;
      const el = recordingPreviewAudioRef.current;
      console.log('[VOICE DEBUG] waitAndPlay attempt', attempts, { hasEl: !!el, readyState: el?.readyState });

      if (!el) {
        if (attempts < maxAttempts) {
          setTimeout(waitAndPlay, 50);
        } else {
          console.error('[VOICE DEBUG] Audio element never appeared in DOM');
          showModernAlert('Voice preview failed to load. Please try again.', 'Voice Preview');
        }
        return;
      }

      // Reset to beginning if needed
      if (el.ended || el.currentTime >= (el.duration || 0)) {
        el.currentTime = 0;
      }
      setRecordingPlaybackProgress(0);

      // Play - the onPlay event handler will set isRecordingPreviewPlaying=true
      el.play()
        .then(() => console.log('[VOICE DEBUG] Play succeeded'))
        .catch((error) => {
          console.error('[VOICE DEBUG] Play failed', error);
          if (el.readyState < 2 && attempts < maxAttempts) {
            setTimeout(waitAndPlay, 50);
          } else {
            setIsRecordingPreviewPlaying(false);
            showModernAlert('Could not play this voice preview. Please record again.', 'Voice Preview Error');
          }
        });
    };

    waitAndPlay();
  };

  const handlePreviewAudioPlay = () => {
    setIsRecordingPreviewPlaying(true);
    const updatePreviewProgress = () => {
      const audio = recordingPreviewAudioRef.current;
      if (!audio) return;
      // Use the decoded duration from AudioContext instead of audio.duration
      // because WebM audio.duration often returns Infinity.
      // Fallback to recordingTime if available.
      const dur = recordingPreviewDurationRef.current || recordingTime || (audio.duration !== Infinity ? audio.duration : 0) || 1;
      setRecordingPlaybackProgress(Math.min(1, audio.currentTime / dur));
      recordingPreviewFrameRef.current = requestAnimationFrame(updatePreviewProgress);
    };
    if (recordingPreviewFrameRef.current) cancelAnimationFrame(recordingPreviewFrameRef.current);
    updatePreviewProgress();
  };

  const handlePreviewAudioStop = () => {
    if (recordingPreviewFrameRef.current) cancelAnimationFrame(recordingPreviewFrameRef.current);
    recordingPreviewFrameRef.current = null;
    setIsRecordingPreviewPlaying(false);
    const audio = recordingPreviewAudioRef.current;
    if (!audio || audio.ended) setRecordingPlaybackProgress(0);
  };

  const startRecordingMonitor = (stream) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    recordingAudioContextRef.current = audioContext;

    const updateLevel = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const normalized = (samples[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const nextLevel = Math.min(1, Math.max(0, (rms - 0.012) * 9));
      setRecordingLevel((previousLevel) => (
        Math.abs(previousLevel - nextLevel) > 0.015 ? nextLevel : previousLevel
      ));
      if (nextLevel > 0.03) {
        setRecordingWaveTick((tick) => (tick + 1) % 1000);
      }
      recordingAnalyserFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  };

  const audioBufferToWav = (buffer) => {
    const numOfChan = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numOfChan * 2;
    const bufferArray = new ArrayBuffer(44 + length);
    const view = new DataView(bufferArray);
    let offset = 0;
    let pos = 0;
    const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

    setUint32(0x46464952); // "RIFF"
    setUint32(36 + length);
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt "
    setUint32(16);
    setUint16(1); // PCM
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16); // 16-bit
    setUint32(0x61746164); // "data"
    setUint32(length);

    const channels = [];
    for (let i = 0; i < numOfChan; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < 44 + length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }
    return new Blob([bufferArray], { type: 'audio/wav' });
  };

  const sendVoiceAttachment = async (originalFile) => {
    if (!activeChat || !originalFile) {
      setIsSendingVoice(false);
      return;
    }
    if (!originalFile.size) {
      showModernAlert('No audio was captured. Please try recording again.', 'Voice Message Error');
      setIsSendingVoice(false);
      return;
    }

    setIsSendingVoice(true);

    let file = originalFile;
    // Transcode WebM to highly-compatible uncompressed WAV (16kHz mono/stereo) so native players NEVER fail
    if (file.type && file.type.includes('webm')) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          // Force 16kHz to keep WAV size very small (~1.9MB/min)
          const actx = new AudioContextClass({ sampleRate: 16000 });
          const decoded = await actx.decodeAudioData(await file.arrayBuffer());
          const wavBlob = audioBufferToWav(decoded);
          const rawName = file.name.replace(/\.[^.]+$/, '');
          file = new File([wavBlob], `${rawName}.wav`, { type: 'audio/wav', lastModified: Date.now() });
        }
      } catch (err) {
        console.warn('Failed to transcode WebM to WAV:', err);
      }
    }

    const optimisticId = `optimistic-voice-${Date.now()}`;
    const optimisticUrl = URL.createObjectURL(file);
    const tempMsg = {
      id: optimisticId,
      client_id: optimisticId,
      sender_id: currentUser.id,
      receiver_id: activeChat.other_user_id,
      content: 'Voice message',
      created_at: new Date().toISOString(),
      is_pending: true,
      message_type: 'file',
      attachment_url: optimisticUrl,
      attachment_type: file.type || 'audio/webm',
      reply_to_message_id: replyToMessage?.id || null,
      reply_preview: replyToMessage ? { ...replyToMessage } : null,
    };

    setMessages((prev) => [...prev, tempMsg]);
    forceScrollToLatest('smooth');

    try {
      const encryptedContent = await encryptStringForUser('Voice message');
      const encryptedFile = await encryptFileE2E(file, getMyPublicKey(), getRecipientPublicKey(activeChat));
      const formData = new FormData();
      formData.append('receiver_id', String(activeChat.other_user_id));
      formData.append('content', encryptedContent);
      formData.append('attachment_type', `e2e-file:${file.type || 'audio/webm'}`);
      if (replyToMessage?.id) {
        formData.append('reply_to_message_id', String(replyToMessage.id));
      }
      formData.append('attachment', encryptedFile, `${file.name}.e2e`);

      const response = await apiFetch('/api/inbox/messages/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to send voice message.');

      if (data.sent_message) {
        const processed = (await processIncomingMessages([data.sent_message]))[0];
        processed.client_id = optimisticId;
        setMessages((prev) => {
          const filtered = prev.filter(m => m.id !== processed.id);
          return filtered.map((m) => m.id === optimisticId ? processed : m);
        });
      }
      setReplyToMessage(null);
    } catch (err) {
      console.error('Voice message send error:', err);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      showModernAlert(err.message, 'Voice Message Error');
    } finally {
      URL.revokeObjectURL(optimisticUrl);
      setIsSendingVoice(false);
    }
  };

  const startRecording = async () => {
    let stream;
    try {
      if (!window.MediaRecorder) {
        showModernAlert('Voice recording is not supported in this browser.', 'Voice Message Error');
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const recorderMimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => (
        MediaRecorder.isTypeSupported?.(type)
      ));
      const recorderOptions = recorderMimeType ? { mimeType: recorderMimeType } : undefined;
      const mimeType = recorderMimeType || 'audio/webm';
      recordingMimeTypeRef.current = mimeType;
      mediaRecorderRef.current = new MediaRecorder(stream, recorderOptions);
      recordingStreamRef.current = stream;
      audioChunksRef.current = [];
      discardRecordingRef.current = false;
      sendRecordingOnStopRef.current = false;
      previewRecordingOnStopRef.current = false;
      clearRecordingPreview();
      setIsSendingVoice(false);
      startRecordingMonitor(stream);
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
          recordingPreviewFileRef.current = createVoiceFileFromChunks();
          if (mediaRecorderRef.current?.state === 'paused') {
            buildRecordingPreview();
          }
        }
      };

      mediaRecorderRef.current.onerror = (event) => {
        console.error('Voice recorder error', event.error || event);
        discardRecordingRef.current = true;
        setIsSendingVoice(false);
        showModernAlert('The voice recorder stopped unexpectedly. Please try again.', 'Voice Message Error');
      };

      mediaRecorderRef.current.onstop = () => {
        try {
          const chunks = audioChunksRef.current;
          const shouldSend = sendRecordingOnStopRef.current;
          const shouldPreview = previewRecordingOnStopRef.current;
          console.log('[VOICE DEBUG] onstop fired', { chunksLength: chunks.length, shouldSend, shouldPreview, discard: discardRecordingRef.current });
          cleanupRecordingStream();
          stopRecordingTimer();

          if (discardRecordingRef.current || chunks.length === 0) {
            console.log('[VOICE DEBUG] onstop: discarding or no chunks');
            clearRecordingPreview();
            setIsRecording(false);
            setIsRecordingPaused(false);
            audioChunksRef.current = [];
            discardRecordingRef.current = false;
            sendRecordingOnStopRef.current = false;
            previewRecordingOnStopRef.current = false;
            setRecordingTime(0);
            return;
          }

          const audioBlob = new Blob(chunks, { type: mimeType });
          console.log('[VOICE DEBUG] onstop: blob created', { blobSize: audioBlob.size, mimeType });
          if (!audioBlob.size) {
            clearRecordingPreview();
            setIsRecording(false);
            setIsRecordingPaused(false);
            setIsSendingVoice(false);
            audioChunksRef.current = [];
            sendRecordingOnStopRef.current = false;
            previewRecordingOnStopRef.current = false;
            setRecordingTime(0);
            showModernAlert('No audio was captured. Please check your microphone and try again.', 'Voice Message Error');
            return;
          }
          const audioExtension = mimeType.includes('mp4') ? 'm4a' : 'webm';
          const file = new File([audioBlob], `voice-message-${Date.now()}.${audioExtension}`, { type: mimeType, lastModified: Date.now() });
          recordingPreviewFileRef.current = file;
          audioChunksRef.current = chunks;
          previewRecordingOnStopRef.current = false;
          sendRecordingOnStopRef.current = false;

          if (shouldPreview) {
            console.log('[VOICE DEBUG] onstop: entering preview branch, file size:', file.size);
            const previewUrl = URL.createObjectURL(file);
            recordingPreviewUrlRef.current = previewUrl;
            setIsRecording(true);
            setIsRecordingPaused(true);
            setIsRecordingPreviewPlaying(false);
            setRecordingPlaybackProgress(0);
            setRecordingPreviewUrl((currentUrl) => {
              if (currentUrl) URL.revokeObjectURL(currentUrl);
              return previewUrl;
            });
            analyzeRecordingPreview(file);
            console.log('[VOICE DEBUG] onstop: preview URL set:', previewUrl, 'file ref set:', !!recordingPreviewFileRef.current);
            return;
          }

          clearRecordingPreview();
          setIsRecording(false);
          setIsRecordingPaused(false);
          audioChunksRef.current = [];

          if (shouldSend) {
            sendVoiceAttachment(file);
          } else {
            setAttachedFiles([{ id: Math.random().toString(36).substr(2, 9), file, previewUrl: URL.createObjectURL(audioBlob) }]);
          }
        } catch (onstopError) {
          console.error('[VOICE DEBUG] CRITICAL: onstop handler error!', onstopError);
          // Try to recover
          setIsRecording(false);
          setIsRecordingPaused(false);
          setIsSendingVoice(false);
        }
      };

      mediaRecorderRef.current.start(250);
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingTime(0);
      startRecordingTimer();
    } catch (err) {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      console.error("Microphone access denied", err);
      showModernAlert("Microphone access is required to send voice messages.", "Microphone Error");
    }
  };

  const stopRecording = (sendAfterStop = false) => {
    console.log('[VOICE DEBUG] stopRecording called', { sendAfterStop, hasRecorder: !!mediaRecorderRef.current, isRecording, isRecordingPaused, recorderState: mediaRecorderRef.current?.state });
    if (mediaRecorderRef.current && isRecording) {
      if (sendAfterStop && isRecordingPaused) {
        sendRecordingPreview();
        return;
      }

      // If the recorder is already inactive (stopped for preview), we cannot
      // call requestData/stop again. Fall back to using the already-collected chunks.
      if (mediaRecorderRef.current.state === 'inactive') {
        const file = recordingPreviewFileRef.current || createVoiceFileFromChunks();
        if (file && sendAfterStop) {
          sendVoiceAttachment(file);
        }
        if (!sendAfterStop) {
          clearRecordingPreview();
          setIsRecording(false);
          setIsRecordingPaused(false);
          setRecordingTime(0);
          audioChunksRef.current = [];
        }
        return;
      }

      setIsSendingVoice(sendAfterStop);
      if (recordingPreviewAudioRef.current) {
        recordingPreviewAudioRef.current.pause();
        setIsRecordingPreviewPlaying(false);
      }
      sendRecordingOnStopRef.current = sendAfterStop;
      previewRecordingOnStopRef.current = false;
      discardRecordingRef.current = false;
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.requestData();
        }
      } catch (error) {
        console.warn('Could not flush voice recorder data before stopping', error);
      }
      mediaRecorderRef.current.stop();
    }
  };

  const sendRecordingPreview = () => {
    const file = recordingPreviewFileRef.current || createVoiceFileFromChunks();
    console.log('[VOICE DEBUG] sendRecordingPreview called', { hasFile: !!file, fileSize: file?.size, chunksLength: audioChunksRef.current?.length });
    if (!file) {
      setIsSendingVoice(false);
      showModernAlert('No audio was captured. Please try recording again.', 'Voice Message Error');
      return;
    }

    if (recordingPreviewAudioRef.current) {
      recordingPreviewAudioRef.current.pause();
      recordingPreviewAudioRef.current.currentTime = 0;
    }
    if (recordingPreviewFrameRef.current) {
      cancelAnimationFrame(recordingPreviewFrameRef.current);
      recordingPreviewFrameRef.current = null;
    }

    sendRecordingOnStopRef.current = false;
    previewRecordingOnStopRef.current = false;
    cleanupRecordingStream();
    clearRecordingPreview();
    stopRecordingTimer();
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
    recordingPreviewFileRef.current = null;
    sendVoiceAttachment(file);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      discardRecordingRef.current = true;
      sendRecordingOnStopRef.current = false;
      previewRecordingOnStopRef.current = false;
      setIsSendingVoice(false);
      clearRecordingPreview();
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      } else {
        cleanupRecordingStream();
        stopRecordingTimer();
        setIsRecording(false);
        setIsRecordingPaused(false);
        setRecordingTime(0);
        audioChunksRef.current = [];
      }
      clearAttachments();
    }
  };

  const toggleRecordingPause = () => {
    const recorder = mediaRecorderRef.current;
    console.log('[VOICE DEBUG] toggleRecordingPause called', { hasRecorder: !!recorder, recorderState: recorder?.state, isRecording, isRecordingPaused });
    if (!recorder || !isRecording) return;

    if (isRecordingPaused) {
      playRecordingPreview();
    } else {
      try {
        if (recorder.state === 'recording') recorder.requestData();
      } catch (error) {
        console.warn('Could not prepare voice preview', error);
      }
      previewRecordingOnStopRef.current = true;
      sendRecordingOnStopRef.current = false;
      discardRecordingRef.current = false;
      if (recorder.state !== 'inactive') recorder.stop();
      setIsRecordingPaused(true);
      setRecordingLevel(0);
      setRecordingWaveTick(0);
      stopRecordingTimer();
    }
  };

  const formatRecordingTime = (secs) => {
    return `${Math.floor(secs/60)}:${(secs%60).toString().padStart(2, '0')}`;
  };
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [mutedChats, setMutedChats] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('inbox_muted_chats') || '[]');
      return new Set(stored.map(Number).filter((id) => Number.isFinite(id)));
    } catch {
      return new Set();
    }
  });
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadCountInScroll, setUnreadCountInScroll] = useState(0);
  const [confirmConfig, setConfirmConfig] = useState(null); // { title, message, onConfirm, type, confirmText }
  const activeChatRef = useRef(null);
  const previousChatIdRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const mutedChatsRef = useRef(mutedChats);
  const chatSearchInputRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const preservedChatScrollTopRef = useRef(null);
  const reactionUpdateMessageIdsRef = useRef(new Set());
  const fileInputRef = useRef(null);
  const messageInputRef = useRef(null);
  const forceScrollToBottomRef = useRef(false);
  const inboxMainRef = useRef(null);
  const [slideDirection, setSlideDirection] = useState(null); // 'enter' | 'exit' | null
  const socketUrl = import.meta.env.VITE_SOCKET_URL || '';

  // ╬ô├╢├ç╬ô├╢├ç Close-chat handler (used by back button AND browser back gesture) ╬ô├╢├ç
  const closeChat = useCallback(() => {
    if (!activeChat) return;
    setSlideDirection('exit');
    setTimeout(() => {
      setActiveChat(null);
      setSlideDirection(null);
    }, 220);
  }, [activeChat]);

  // ╬ô├╢├ç╬ô├╢├ç History API: Android/iOS native back gesture support ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç
  // We push a history entry when a chat opens. The system back gesture
  // fires popstate, which we intercept to close the chat.
  const historyPushedRef = useRef(false);
  const activeChatStateRef = useRef(null);

  // Keep activeChatStateRef in sync
  useEffect(() => {
    activeChatStateRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    if (!activeChat?.other_user_id) return undefined;

    const keepMobileChatInView = () => {
      if (!window.matchMedia?.('(max-width: 1024px)').matches) return;
      if (chatMessagesRef.current) {
        chatMessagesRef.current.scrollLeft = 0;
      }
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
    };

    keepMobileChatInView();
    window.addEventListener('resize', keepMobileChatInView);
    window.addEventListener('orientationchange', keepMobileChatInView);

    return () => {
      window.removeEventListener('resize', keepMobileChatInView);
      window.removeEventListener('orientationchange', keepMobileChatInView);
    };
  }, [activeChat?.other_user_id]);

  // Push history entry when chat opens, pop when it closes
  useEffect(() => {
    if (activeChat && !historyPushedRef.current) {
      // Chat just opened ╬ô├ç├╢ push a history entry
      window.history.pushState(
        { ...( window.history.state || {}), _inboxChat: true },
        '',
        window.location.href
      );
      historyPushedRef.current = true;
    }
    if (!activeChat && historyPushedRef.current) {
      // Chat was closed programmatically (back button in UI) ╬ô├ç├╢
      // the history entry is already consumed by history.back()
      historyPushedRef.current = false;
    }
  }, [activeChat]);

  // Persistent popstate listener (registered once)
  useEffect(() => {
    const onPopState = () => {
      if (historyPushedRef.current && activeChatStateRef.current) {
        historyPushedRef.current = false;
        closeChat();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [closeChat]);

  const getMyPrivateKey = () => {
    if (!currentUser?.id) return null;
    const stored = localStorage.getItem(`e2e_keys_${currentUser.id}`);
    if (stored) {
      try {
        return JSON.parse(stored).privateKeyJwk;
      } catch {
        return null;
      }
    }
    return null;
  };

  const decryptString = async (str) => {
    if (!str || !str.startsWith(E2E_PREFIX)) return str;
    const privKey = getMyPrivateKey();
    if (!privKey) return '[Encrypted message - key unavailable]';
    
    let res = await decryptMessageE2E(str, privKey, 'receiver');
    if (res === '[Encrypted message - key unavailable]') {
      res = await decryptMessageE2E(str, privKey, 'sender');
    }
    return res;
  };

  const getMyPublicKey = () => {
    if (!currentUser?.publicKey) {
      throw new Error('Your encryption key is still being prepared. Please refresh and try again.');
    }
    return JSON.parse(currentUser.publicKey);
  };

  const getRecipientPublicKey = (user = activeChat) => {
    const publicKey = user?.public_key || user?.publicKey;
    if (!publicKey) {
      throw new Error('This user has not opened the app since secure messaging was enabled. They need to log in once before they can receive end-to-end encrypted messages.');
    }
    return typeof publicKey === 'string' ? JSON.parse(publicKey) : publicKey;
  };

  const encryptStringForUser = async (text, user = activeChat) => {
    if (!text) return text;
    return encryptMessageE2E(text, getMyPublicKey(), getRecipientPublicKey(user));
  };

  const processIncomingMessages = async (rawMessages) => {
    const privKey = getMyPrivateKey();
    if (!privKey) return rawMessages;

    return Promise.all(rawMessages.map(async (msg) => {
      try {
        // call_log and reaction content is server-AES-encrypted JSON, not E2E ╬ô├ç├╢ skip decryption
        if (msg.message_type === 'call_log' || msg.message_type === 'reaction' || msg.message_type === 'quick_emoji') {
          return msg;
        }

        const role = normalizeUserId(msg.sender_id) === normalizeUserId(currentUser.id) ? 'sender' : 'receiver';
        const decryptedContent = await decryptMessageE2E(msg.content, privKey, role);
        
        let decryptedReplyPreview = msg.reply_preview;
        if (msg.reply_preview && msg.reply_preview.content && msg.reply_preview.content !== 'Message removed') {
          const replyRole = normalizeUserId(msg.reply_preview.sender_id) === normalizeUserId(currentUser.id) ? 'sender' : 'receiver';
          const decReplyContent = await decryptMessageE2E(msg.reply_preview.content, privKey, replyRole);
          decryptedReplyPreview = { ...msg.reply_preview, content: decReplyContent };
        }

        return {
          ...msg,
          content: decryptedContent,
          reply_preview: decryptedReplyPreview
        };
      } catch (err) {
        console.error('Failed to decrypt message', msg.id, err);
        return { ...msg, content: msg.content || '[Decryption error]' };
      }
    }));
  };


  const processConversations = async (rawChats) => {
    return Promise.all(rawChats.map(async (chat) => {
      try {
        let decLastMsg = chat.last_message;
        if (decLastMsg && decLastMsg.startsWith(E2E_PREFIX)) {
          decLastMsg = await decryptString(decLastMsg);
        }
        return { ...chat, last_message: decLastMsg };
      } catch (err) {
        console.error('Failed to decrypt conversation preview', chat.other_user_id, err);
        return { ...chat, last_message: '[Encrypted message]' };
      }
    }));
  };

  const formatReactionPreview = (content, senderId) => {
    try {
      const data = JSON.parse(content || '');
      if (data?.type !== 'reaction') return null;

      const emoji = data.emoji ? ` ${data.emoji}` : '';
      const targetIsCurrentUser = normalizeUserId(data.originalSenderId) === normalizeUserId(currentUser?.id);
      return normalizeUserId(senderId) === normalizeUserId(currentUser?.id)
        ? `You reacted${emoji} to a message`
        : `Reacted${emoji} to ${targetIsCurrentUser ? 'your message' : 'a message'}`;
    } catch {
      return null;
    }
  };

  const formatDeletedMessageText = (messageOrSenderId) => {
    const senderId = typeof messageOrSenderId === 'object' ? messageOrSenderId?.sender_id : messageOrSenderId;
    return normalizeUserId(senderId) === normalizeUserId(currentUser?.id)
      ? 'You deleted a message'
      : `${activeChatRef.current?.first_name || 'They'} deleted a message`;
  };

  const formatQuickEmojiNotice = (messageOrContent, senderId = null) => {
    try {
      const content = typeof messageOrContent === 'object' ? messageOrContent?.content : messageOrContent;
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      if (parsed?.type !== 'quick_emoji') return null;
      const sourceSenderId = typeof messageOrContent === 'object' ? messageOrContent?.sender_id : senderId;
      const actor = normalizeUserId(sourceSenderId) === normalizeUserId(currentUser?.id)
        ? 'You'
        : (activeChatRef.current?.first_name || 'They');
      return `${actor} set the quick reaction to ${parsed.emoji || DEFAULT_CHAT_QUICK_EMOJI}.`;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (location.state?.selectedUser) {
      const u = location.state.selectedUser;
      const targetUserId = u.id || u.user_id;
      const run = async () => {
        // Fetch conversations first, and if we find the user, select it
        await fetchConversations(targetUserId);
        
        // If not found in conversations, start a new conversation (dummy chat)
        setConversations(prev => {
          const existing = prev.find(chat => normalizeUserId(chat.other_user_id) === normalizeUserId(targetUserId));
          if (!existing) {
            const nextChat = {
              other_user_id: targetUserId,
              first_name: u.first_name,
              last_name: u.last_name,
              role: u.role,
              username: u.username,
              email: u.email,
              profile_picture: u.profile_picture,
              mobile_number: u.mobile_number,
              student_id: u.student_id,
              public_key: u.public_key,
              last_message: '',
              unread_count: 0,
            };
            selectChat(nextChat);
            return [nextChat, ...prev];
          } else {
            selectChat(existing);
            return prev;
          }
        });
      };
      run();
      window.history.replaceState({}, document.title);
    } else {
      fetchConversations();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  useEffect(() => {
    // Only update the activeChatRef here, keep previousChatIdRef for the scroll effect to compare
    activeChatRef.current = activeChat;
    setChatEmojiPickerOpen(false);
    setChatEmojiSearchQuery('');
  }, [activeChat]);

  useEffect(() => {
    currentUserIdRef.current = normalizeUserId(currentUser?.id);
  }, [currentUser?.id]);

  useEffect(() => {
    mutedChatsRef.current = mutedChats;
    localStorage.setItem('inbox_muted_chats', JSON.stringify([...mutedChats]));
  }, [mutedChats]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !currentUser?.id) return undefined;

    const socket = io(socketUrl, {
      withCredentials: true,
      auth: { token },
    });

    socket.on('inbox:message', async (message) => {
      const currentUserId = currentUserIdRef.current;
      const senderId = normalizeUserId(message.sender_id);
      const receiverId = normalizeUserId(message.receiver_id);
      const partnerId = senderId === currentUserId ? receiverId : senderId;
      const activePartnerId = normalizeUserId(activeChatRef.current?.other_user_id);
      const isActiveConversation = activePartnerId === partnerId;

      const processedMsgs = await processIncomingMessages([message]);
      const processedMessage = processedMsgs[0];
      const isReactionNotice = processedMessage.message_type === 'reaction';

      if (senderId !== currentUserId && !mutedChatsRef.current.has(partnerId)) {
        soundManager.playMessageReceived();
      }

      if (isReactionNotice) {
        setConversations((prev) => {
          const existing = prev.find((chat) => normalizeUserId(chat.other_user_id) === partnerId);
          if (!existing) {
            fetchConversations(null, { silent: true });
            return prev;
          }

          const updated = prev.map((chat) => (
            normalizeUserId(chat.other_user_id) === partnerId
              ? {
                      ...chat,
                  last_message: processedMessage.reaction_preview || formatReactionPreview(processedMessage.content, senderId) || 'Reacted to a message',
                  last_message_at: processedMessage.created_at,
                  last_message_is_reaction: true,
                  last_message_type: 'reaction',
                  unread_count: senderId === currentUserId || isActiveConversation
                    ? 0
                    : (chat.unread_count || 0) + 1,
                }
              : chat
          ));

          return [...updated].sort((a, b) => getMessageSortTime(b.last_message_at) - getMessageSortTime(a.last_message_at));
        });
        return;
      }

      if (!isReactionNotice) setConversations((prev) => {
        const existing = prev.find((chat) => normalizeUserId(chat.other_user_id) === partnerId);
        if (!existing) {
          fetchConversations(null, { silent: true });
          return prev;
        }

        const updated = prev.map((chat) => (
          normalizeUserId(chat.other_user_id) === partnerId
            ? {
                ...chat,
                last_message: processedMessage.is_forwarded ? `Forwarded: ${processedMessage.content}` : processedMessage.content,
                last_message_at: processedMessage.created_at,
                unread_count: senderId === currentUserId || isActiveConversation
                  ? 0
                  : (chat.unread_count || 0) + 1,
              }
            : chat
        ));

        return [...updated].sort((a, b) => getMessageSortTime(b.last_message_at) - getMessageSortTime(a.last_message_at));
      });

      if (!isReactionNotice) setMessages((prev) => {
        if (!isActiveConversation) return prev;
        if (normalizeUserId(processedMessage.sender_id) === normalizeUserId(currentUserId)) {
          const optimisticMatch = prev.find(m => m.client_id === processedMessage.client_id || (m.is_pending && m.content === processedMessage.content));
          if (optimisticMatch) return prev;
        }

        // Increment unread count for scroll button if user is scrolled up
        if (showScrollDown) {
          setUnreadCountInScroll(c => c + 1);
        }
        
        return [...prev, processedMessage];
      });

      if (!isReactionNotice && isActiveConversation && senderId !== currentUserId && activeChatRef.current) {
        selectChat(activeChatRef.current, { silent: true, markAsRead: true });
      }
    });

    socket.on('inbox:message_updated', async (message) => {
      if (reactionUpdateMessageIdsRef.current.has(message.id)) {
        reactionUpdateMessageIdsRef.current.delete(message.id);
        setMessages((prev) => prev.map((item) => (
          item.id === message.id
            ? {
                ...item,
                reactions: message.reactions || [],
                is_read: message.is_read,
                is_edited: message.is_edited,
              }
            : item
        )));
        return;
      }

      const processedMsgs = await processIncomingMessages([message]);
      const processedMessage = processedMsgs[0];
      setMessages((prev) => prev.map((item) => (item.id === processedMessage.id ? { ...processedMessage, client_id: item.client_id } : item)));
    });

    socket.on('inbox:reaction_notification', (notice) => {
      const partnerId = normalizeUserId(notice.other_user_id);
      const activePartnerId = normalizeUserId(activeChatRef.current?.other_user_id);
      const isActiveConversation = activePartnerId === partnerId;

      setConversations((prev) => {
        const existing = prev.find((chat) => normalizeUserId(chat.other_user_id) === partnerId);
        if (!existing) {
          fetchConversations(null, { silent: true });
          return prev;
        }

        const updated = prev.map((chat) => (
          normalizeUserId(chat.other_user_id) === partnerId
            ? {
                ...chat,
                last_message: notice.preview || 'Reacted to a message',
                last_message_at: notice.last_message_at || new Date().toISOString(),
                last_message_is_reaction: true,
                last_message_type: 'reaction',
                unread_count: notice.unread && !isActiveConversation
                  ? (chat.unread_count || 0) + 1
                  : chat.unread_count || 0,
              }
            : chat
        ));

        return [...updated].sort((a, b) => getMessageSortTime(b.last_message_at) - getMessageSortTime(a.last_message_at));
      });
    });

    socket.on('inbox:message_deleted', ({ id, mode, sender_id, receiver_id, created_at }) => {
      if (mode === 'everyone') {
        setMessages((prev) => prev.map((item) => (
          item.id === id
            ? { ...item, deleted_for_everyone: 1, content: 'Message removed', attachment_url: null, attachment_type: null, reactions: [] }
            : item
        )));

        const otherUserId = normalizeUserId(sender_id) === normalizeUserId(currentUser?.id) ? receiver_id : sender_id;
        setConversations((prev) => prev.map((chat) => {
          if (normalizeUserId(chat.other_user_id) !== normalizeUserId(otherUserId)) return chat;
          const chatTime = getMessageSortTime(chat.last_message_at);
          const deletedTime = getMessageSortTime(created_at);
          if (chat.last_message_at && deletedTime && Math.abs(chatTime - deletedTime) > 2000) return chat;
          return {
            ...chat,
            last_message: normalizeUserId(sender_id) === normalizeUserId(currentUser?.id)
              ? 'You deleted a message'
              : `${chat.first_name} deleted a message`,
            last_message_at: created_at || chat.last_message_at,
            last_message_is_reaction: false,
            last_message_type: 'deleted',
            last_message_sender_id: sender_id,
          };
        }));
      } else {
        setMessages((prev) => prev.filter((item) => item.id !== id));
      }
      setReplyToMessage((prev) => (prev?.id === id ? null : prev));
      setEditingMessage((prev) => (prev?.id === id ? null : prev));
      // fetchConversations(null, { silent: true });
    });

    socket.on('broadcast_recalled', ({ broadcastId }) => {
      setMessages((prev) => prev.filter((item) => item.broadcast_id !== broadcastId));
      fetchConversations(null, { silent: true });
    });

    socket.on('inbox:message_pinned', ({ message_id, is_pinned }) => {
      setMessages((prev) => prev.map((m) => normalizeUserId(m.id) === normalizeUserId(message_id) ? { ...m, is_pinned: !!is_pinned } : m));
      if (!is_pinned) {
        setPinnedMessageMenuId((currentId) => normalizeUserId(currentId) === normalizeUserId(message_id) ? null : currentId);
      }
    });

    socket.on('inbox:conversation_deleted', ({ other_user_id }) => {
      setConversations((prev) => prev.filter((chat) => normalizeUserId(chat.other_user_id) !== normalizeUserId(other_user_id)));
      if (normalizeUserId(activeChatRef.current?.other_user_id) === normalizeUserId(other_user_id)) {
        setActiveChat(null);
        setMessages([]);
      }
    });

    socket.on('inbox:read', ({ by_user_id }) => {
      const readerId = normalizeUserId(by_user_id);
      setConversations((prev) => prev.map((chat) => (
        normalizeUserId(chat.other_user_id) === readerId ? { ...chat, unread_count: 0 } : chat
      )));
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, socketUrl]);

  useLayoutEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    const isMobileInbox = window.matchMedia?.('(max-width: 1024px)').matches;
    if (isMobileInbox) {
      container.scrollLeft = 0;
      requestAnimationFrame(() => {
        if (chatMessagesRef.current) chatMessagesRef.current.scrollLeft = 0;
      });
    }

    // Use a larger threshold (300px) to handle images and multi-line messages
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 300;
    const openedDifferentChat = normalizeUserId(activeChat?.other_user_id) !== normalizeUserId(previousChatIdRef.current);
    
    // Check if we should scroll to bottom. 
    // !showScrollDown means the user hasn't manually scrolled up away from the bottom.
    const shouldStickToBottom = (forceScrollToBottomRef.current || !showScrollDown || nearBottom || openedDifferentChat) && !pendingScrollMessageId;

    if (shouldStickToBottom) {
      const scrollBehavior = (openedDifferentChat || forceScrollToBottomRef.current === 'auto') ? 'auto' : 'smooth';
      
      const executeScroll = () => {
        const currentContainer = chatMessagesRef.current;
        if (!currentContainer) return;
        
        currentContainer.scrollTo({
          top: currentContainer.scrollHeight,
          behavior: scrollBehavior
        });
      };

      if (scrollBehavior === 'auto') {
        executeScroll(); // Execute synchronously before paint to prevent flashing
      } else {
        requestAnimationFrame(executeScroll);
      }
    }

    // Only update the ref AFTER we've checked it for scrolling
    if (activeChat?.other_user_id) {
      previousChatIdRef.current = activeChat.other_user_id;
    }
    forceScrollToBottomRef.current = false;
  }, [messages.length, activeChat?.other_user_id, pendingScrollMessageId]);

  // Scroll to target search message when it loads
  useEffect(() => {
    if (!pendingScrollMessageId || !messages.length) return;
    
    const hasMessage = messages.some(msg => msg.id === pendingScrollMessageId);
    if (!hasMessage) return;

    const timeoutId = window.setTimeout(() => {
      const messageElement = document.getElementById(`msg-${pendingScrollMessageId}`);
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedPinnedMessageId(pendingScrollMessageId);
        
        const clearHighlightTimeout = window.setTimeout(() => {
          setHighlightedPinnedMessageId(currentId => currentId === pendingScrollMessageId ? null : currentId);
        }, 2600);
        
        setPendingScrollMessageId(null);
        return () => window.clearTimeout(clearHighlightTimeout);
      }
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [messages, pendingScrollMessageId]);

  useEffect(() => {
    const query = sidebarQuery.trim();
    if (!query) {
      setSidebarSearchResults([]);
      setSearchingSidebarUsers(false);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchingSidebarUsers(true);
        const response = await apiFetch(`/api/inbox/users?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await readJson(response);
          setSidebarSearchResults(data.users || []);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to search inbox users', error);
        }
      } finally {
        setSearchingSidebarUsers(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [sidebarQuery]);

  // Debounced search for global messages
  useEffect(() => {
    const query = globalMessageSearchQuery.trim();
    if (!query) {
      setGlobalMessageSearchResults([]);
      setSearchingGlobalMessages(false);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchingGlobalMessages(true);
        const response = await apiFetch(`/api/inbox/search-messages?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await readJson(response);
          setGlobalMessageSearchResults(data.results || []);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to search global messages', error);
        }
      } finally {
        setSearchingGlobalMessages(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [globalMessageSearchQuery]);

  useEffect(() => {
    if (!composerMode) {
      setUserSearch('');
      setUserResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchingUsers(true);
        const query = userSearch.trim();
        const url = query ? `/api/inbox/users?q=${encodeURIComponent(query)}` : '/api/inbox/users';
        const response = await apiFetch(url, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await readJson(response);
          setUserResults(data.users || []);
        } else {
          console.error('User search API returned', response.status, response.statusText);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to search users', error);
        }
      } finally {
        setSearchingUsers(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [composerMode, userSearch]);

  useEffect(() => {
    if (!activeChat?.other_user_id) return undefined;

    // Gentle background sync for conversations only. 
    // Sockets handle primary real-time message sync.
    const intervalId = window.setInterval(() => {
      if (!activeChatRef.current?.other_user_id) return;
      fetchConversations(null, { silent: true });
    }, 30000);

    return () => window.clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.other_user_id]);

  useEffect(() => {
    if (!openMenuId && !reactionBarId && !reactionPickerMessageId && !emojiPickerOpen && !isPlusMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const clickedInsideInteractiveMenu = target.closest(
        '.message-menu, .reaction-strip, .reaction-picker-panel, .mini-action-btn, .reaction-pill, .emoji-picker, .fb-emoji-picker-container, .fb-emoji-btn, .emoji-toggle-btn, .fb-plus-menu, .collapse-btn, .gif-btn, .gif-picker-wrapper',
      );

      if (clickedInsideInteractiveMenu) return;

      setOpenMenuId(null);
      setReactionBarId(null);
      setReactionPickerMessageId(null);
      setReactionPickerDirection('up');
      setReactionSearchQuery('');
      setEmojiPickerOpen(false);
      setIsPlusMenuOpen(false);
      setGifPickerOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMenuId, reactionBarId, reactionPickerMessageId, emojiPickerOpen, isPlusMenuOpen, gifPickerOpen]);


  useEffect(() => {
    const encryptedAttachments = messages.filter((message) => message.attachment_url);

    if (!encryptedAttachments.length) {
      return undefined;
    }

    let cancelled = false;

    const decryptAttachments = async () => {
      let privateKey = getMyPrivateKey();

      if (!privateKey && currentUser) {
        await new Promise(r => setTimeout(r, 500));
        privateKey = getMyPrivateKey();
      }

      // Get the latest state without triggering a re-render
      let currentUrls = {};
      setDecryptedAttachmentUrls(prev => {
        currentUrls = prev;
        return prev;
      });

      const tasks = encryptedAttachments.map(async (message) => {
        if (currentUrls[message.id]) return; // Skip already decrypted attachments

        try {
          const role = normalizeUserId(message.sender_id) === normalizeUserId(currentUser?.id) ? 'sender' : 'receiver';
          const fileUrl = getAttachmentFileUrl(message.attachment_url);

          // Skip fetch for external URLs (like GIFs)
          if (message.attachment_type === 'image/gif' && message.attachment_url.startsWith('http')) {
            if (!cancelled) {
              setDecryptedAttachmentUrls(prev => ({ ...prev, [message.id]: { url: message.attachment_url, type: 'image/gif' } }));
            }
            return;
          }

          const response = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          });
          if (response.status === 204 || !response.ok) {
            if (!cancelled) {
              setDecryptedAttachmentUrls(prev => ({ ...prev, [message.id]: { url: null, type: 'missing', missing: true } }));
            }
            return;
          }

          const isEncryptedFile = (message.attachment_type || '').startsWith('e2e-file:');
          if (isEncryptedFile && !privateKey) return;
          const originalType = isEncryptedFile
            ? message.attachment_type.replace(/^e2e-file:/, '') || 'application/octet-stream'
            : message.attachment_type || response.headers.get('content-type') || 'application/octet-stream';
          let blob;
          if (isEncryptedFile) {
            const decryptedBuffer = await decryptFileE2E(await response.text(), privateKey, role);
            if (!decryptedBuffer) return;
            blob = new Blob([decryptedBuffer], { type: originalType });
          } else {
            blob = await response.blob();
          }
          const objectUrl = URL.createObjectURL(blob);
          
          if (!cancelled) {
            setDecryptedAttachmentUrls(prev => ({ ...prev, [message.id]: { url: objectUrl, type: originalType } }));
          }
        } catch (error) {
          console.error('Failed to decrypt attachment', error);
        }
      });

      await Promise.all(tasks);
    };

    decryptAttachments();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentUser?.id]);

  const fetchConversations = async (preferredUserId = null, options = {}) => {
    try {
      if (!options.silent) setLoading(true);

      const response = await apiFetch('/api/inbox/conversations', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      if (!response.ok) {
        console.error('Conversations API returned', response.status, response.statusText);
        return;
      }

      const data = await readJson(response);
      const rawChats = data.chats || [];

      let processedChats;
      try {
        processedChats = await processConversations(rawChats);
      } catch (decryptErr) {
        console.error('Conversation decryption failed, falling back to raw chats', decryptErr);
        processedChats = rawChats;
      }

      // Ensure newest conversations always appear first
      processedChats.sort((a, b) => getMessageSortTime(b.last_message_at) - getMessageSortTime(a.last_message_at));

      setConversations(processedChats);

      // Persist active chat on refresh (desktop only to prevent hiding the mobile sidebar)
      const isMobileView = window.innerWidth <= 768;
      const savedActiveChatId = localStorage.getItem('inbox_last_active_chat');
      if (!activeChat && processedChats.length > 0 && !isMobileView) {
        const match = savedActiveChatId 
          ? processedChats.find(c => normalizeUserId(c.other_user_id) === normalizeUserId(savedActiveChatId))
          : processedChats.find(c => c.unread_count > 0);
        
        if (match) {
          selectChat(match);
        }
      }

      if (preferredUserId) {
        const match = processedChats.find((chat) => normalizeUserId(chat.other_user_id) === normalizeUserId(preferredUserId));
        if (match) {
          selectChat(match, options);
        }
      }
    } catch (error) {
      console.error('Failed to fetch conversations', error);
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  const selectChat = async (chat, options = {}) => {
    if (!options.silent) {
      forceScrollToBottomRef.current = true;
      
      try {
        const parsed = JSON.parse(localStorage.getItem('chat_drafts') || '{}');
        const drafts = parsed && typeof parsed === 'object' ? parsed : {};
        setNewMessage(location.state?.shareText || drafts[chat.other_user_id] || '');
      } catch (e) {
        setNewMessage(location.state?.shareText || '');
      }

      setActiveChat(chat);
      setMessages([]); // Clear previous messages to prevent blinking
      localStorage.setItem('inbox_last_active_chat', chat.other_user_id);
      setOpenMenuId(null);
      setReactionBarId(null);
      setEmojiPickerOpen(false);
      setChatSearchOpen(false);
      setChatSearchQuery('');
      setChatSearchIndex(0);
      setShowChatInfoPanel(true); // Keep info panel open by default when switching chats
    }

    try {
      const markAsRead = options.markAsRead ?? !options.silent;
      const response = await apiFetch(`/api/inbox/messages/${chat.other_user_id}?markAsRead=${markAsRead ? 'true' : 'false'}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      if (response.ok) {
        const data = await readJson(response);
        const rawMessages = data.messages || [];

        // Always sort ASC (oldest to newest) to ensure consistent order
        const sortedMessages = [...rawMessages].sort((a, b) => {
          const timeA = getMessageSortTime(a.created_at);
          const timeB = getMessageSortTime(b.created_at);
          return timeA - timeB;
        });

        const decryptedMessages = await processIncomingMessages(sortedMessages);
        
        setMessages((prev) => {
          if (!options.silent) return decryptedMessages;

          const newMap = new Map(decryptedMessages.map(m => [m.id, m]));
          const pendingMessages = prev.filter(m => m.is_pending);
          
          // First, keep all existing messages, updating them if the new payload has fresh data
          const merged = prev.map(m => {
            if (newMap.has(m.id)) {
              const newMsg = newMap.get(m.id);
              newMap.delete(m.id); // Mark as processed
              return { ...newMsg, client_id: m.client_id || m.id };
            }
            return m;
          });

          // Add any brand new messages that weren't in prev
          const remainingNew = Array.from(newMap.values());
          const combined = [...merged, ...remainingNew].sort((a, b) => getMessageSortTime(a.created_at) - getMessageSortTime(b.created_at));

          // Preserve optimistic messages that haven't been confirmed by the server yet
          for (const pending of pendingMessages) {
            if (!combined.some(m => m.id === pending.id)) {
              combined.push(pending);
            }
          }
          
          return combined;
        });
      
        if (!options.silent) {
          // Trigger a single instant scroll after state updates for non-silent chat switching
          forceScrollToBottomRef.current = 'auto';
          setTimeout(() => { forceScrollToBottomRef.current = false; }, 500);
        }
      

        if (data.other_user) {
          setActiveChat((prev) => ({
            ...(prev || chat),
            ...data.other_user,
            other_user_id: data.other_user.id,
          }));
        }
        if (markAsRead) {
          setConversations((prev) => prev.map((item) => (
            normalizeUserId(item.other_user_id) === normalizeUserId(chat.other_user_id)
              ? { ...item, unread_count: 0 }
              : item
          )));
        }

        // Focus the text input on desktop only ╬ô├ç├╢ on mobile, opening
        // the keyboard immediately is jarring; let the user tap to type.
        if (!options.silent && window.innerWidth > 768) {
          requestAnimationFrame(() => {
            messageInputRef.current?.focus();
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch messages', error);
    }
  };

  const resetComposerContext = () => {
    setReplyToMessage(null);
    setEditingMessage(null);
    clearAttachments();
    setNewMessage('');
    setEmojiPickerOpen(false);
  };

  const insertEmoji = (emoji) => {
    setNewMessage((prev) => `${prev}${emoji}`);
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  };

  const scrollToLatest = (behavior = 'auto') => {
    const container = chatMessagesRef.current;
    if (!container) return;
    if (window.matchMedia?.('(max-width: 1024px)').matches) {
      container.scrollLeft = 0;
    }

    const targetTop = container.scrollHeight - container.clientHeight;
    if (behavior !== 'smooth') {
      container.scrollTop = targetTop;
      setUnreadCountInScroll(0);
      setShowScrollDown(false);
      return;
    }

    const startTop = container.scrollTop;
    const distance = targetTop - startTop;
    const duration = Math.min(620, Math.max(280, Math.abs(distance) * 0.28));
    const startedAt = performance.now();

    const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      container.scrollTop = startTop + distance * easeOutCubic(progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }

      setUnreadCountInScroll(0);
      setShowScrollDown(false);
    };

    requestAnimationFrame(animate);
  };

  const preserveChatScrollPosition = () => {
    const container = chatMessagesRef.current;
    if (!container) return;

    preservedChatScrollTopRef.current = container.scrollTop;
    requestAnimationFrame(() => {
      if (preservedChatScrollTopRef.current == null || !chatMessagesRef.current) return;
      chatMessagesRef.current.scrollTop = preservedChatScrollTopRef.current;
      preservedChatScrollTopRef.current = null;
    });
  };

  const showModernAlert = (message, title = 'Notice') => {
    setConfirmConfig({
      title,
      message,
      confirmText: 'Got it',
      onConfirm: () => {},
      isAlert: true
    });
  };

  const forceScrollToLatest = (behavior = 'smooth') => {
    forceScrollToBottomRef.current = behavior;
    setUnreadCountInScroll(0);
    setShowScrollDown(false);
  };

  const handleChatScroll = useCallback(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    if (window.matchMedia?.('(max-width: 1024px)').matches && container.scrollLeft !== 0) {
      container.scrollLeft = 0;
    }
    
    // threshold of 150px from bottom to hide the button
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    
    setShowScrollDown(!isNearBottom);
    if (isNearBottom) {
      setUnreadCountInScroll(0);
    }
  }, []);

  const sendJsonMessage = async (overrideContent) => {
    const textToSend = (typeof overrideContent === 'string' ? overrideContent : newMessage).trim();
    if (!textToSend && attachedFiles.length === 0) return;

    // Optimistic Update: Clear input and show message immediately
    const optimisticId = `optimistic-${Date.now()}`;
    if (!editingMessage) {
      const tempMsg = {
        id: optimisticId,
        client_id: optimisticId,
        sender_id: currentUser.id,
        receiver_id: activeChat.other_user_id,
        content: textToSend,
        created_at: new Date().toISOString(),
        is_pending: true,
        reply_to_message_id: replyToMessage?.id || null,
        reply_preview: replyToMessage ? { ...replyToMessage } : null,
      };
      setMessages((prev) => [...prev, tempMsg]);
      setNewMessage('');
      setReplyToMessage(null);
      setEmojiPickerOpen(false);
      forceScrollToLatest('smooth');
    }

    try {
      const encryptedContent = await encryptStringForUser(textToSend);
      const payload = {
        receiver_id: activeChat.other_user_id,
        content: encryptedContent,
        reply_to_message_id: replyToMessage?.id || null,
        forwarded_from_message_id: null,
      };

      if (editingMessage) {
        const response = await apiFetch(`/api/inbox/messages/${editingMessage.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ content: encryptedContent }),
        });

        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || 'Failed to edit message.');

        if (data.updated_message) {
          const processed = (await processIncomingMessages([data.updated_message]))[0];
          setMessages((prev) => prev.map((item) => item.id === editingMessage.id ? { ...processed, client_id: item.client_id } : item));
        }
        resetComposerContext();
        return;
      }

      const response = await apiFetch('/api/inbox/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to send message.');

      if (data.sent_message) {
        const processed = (await processIncomingMessages([data.sent_message]))[0];
        processed.client_id = optimisticId; // Match the key to prevent re-animation
        setMessages((prev) => {
          const filtered = prev.filter(m => m.id !== processed.id);
          return filtered.map((m) => m.id === optimisticId ? processed : m);
        });
      }
      // Removed fetchConversations to prevent race condition and UI blinking
    } catch (err) {
      console.error('Send error:', err);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      showModernAlert(err.message, "Send Error");
    }
  };

  const sendAttachmentMessage = async () => {
    const textToSend = newMessage;
    const filesToSend = [...attachedFiles];
    
    // Clear input and attachments immediately
    setNewMessage('');
    clearAttachments();
    setReplyToMessage(null);
    
    let sentAny = false;
    for (let i = 0; i < filesToSend.length; i++) {
      const { file } = filesToSend[i];
      const textForThis = (i === 0 && textToSend) ? textToSend : file.name;
      
      // Optimistic ID for this file
      const optimisticId = `optimistic-${Date.now()}-${i}`;
      
      // Add optimistic message
      const tempMsg = {
        id: optimisticId,
        client_id: optimisticId,
        sender_id: currentUser.id,
        receiver_id: activeChat.other_user_id,
        content: textForThis,
        created_at: new Date().toISOString(),
        is_pending: true,
        message_type: 'file',
        attachment: { 
          file_name: file.name,
          file_type: file.type,
          is_optimistic: true 
        }
      };
      
      setMessages((prev) => [...prev, tempMsg]);
      forceScrollToLatest('smooth');

      try {
        const encryptedContent = await encryptStringForUser(textForThis);
        let encryptedFile;
        let attachmentType;
        let fileName;

        try {
          encryptedFile = await encryptFileE2E(file, getMyPublicKey(), getRecipientPublicKey(activeChat));
          attachmentType = `e2e-file:${file.type || 'application/octet-stream'}`;
          fileName = `${file.name}.e2e`;
        } catch (e) {
          throw new Error(e.message || 'Could not encrypt attachment for this recipient.');
        }

        const formData = new FormData();
        formData.append('receiver_id', String(activeChat.other_user_id));
        formData.append('content', encryptedContent);
        formData.append('attachment_type', attachmentType);
        if (replyToMessage?.id && i === 0) {
          formData.append('reply_to_message_id', String(replyToMessage.id));
        }
        formData.append('attachment', encryptedFile, fileName);

        const response = await apiFetch('/api/inbox/messages/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: formData,
        });

        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || 'Failed to send attachment.');

        if (data.sent_message) {
          const processed = (await processIncomingMessages([data.sent_message]))[0];
          processed.client_id = optimisticId; // Match the key to prevent re-animation
          setMessages((prev) => {
            const filtered = prev.filter(m => m.id !== processed.id);
            return filtered.map((m) => m.id === optimisticId ? processed : m);
          });
          sentAny = true;
        }
      } catch (err) {
        console.error('Attachment send error:', err);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        console.error(`Failed to send ${file.name}: ${err.message}`);
        showModernAlert(`Failed to send ${file.name}: ${err.message}`, 'Send Error');
      }
    }
    
    if (sentAny) {
      // Removed fetchConversations to prevent race condition and UI blinking
    }
  };

  const handleSendHeart = async (event) => {
    event.preventDefault();
    if (!activeChat) return;
    try {
      await sendJsonMessage('❤️');
    } catch (error) {
      console.error(error);
      showModernAlert(error.message, 'Forwarding Error');
    }
  };

  const handleSendQuickEmoji = async (event) => {
    event.preventDefault();
    if (!activeChat) return;
    try {
      await sendJsonMessage(activeChatQuickEmoji);
    } catch (error) {
      console.error(error);
      showModernAlert(error.message, 'Send Error');
    }
  };

  const addLocalQuickEmojiNotice = (emoji) => {
    if (!activeChat) return;

    const optimisticId = `quick-emoji-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        client_id: optimisticId,
        sender_id: currentUser.id,
        receiver_id: activeChat.other_user_id,
        content: JSON.stringify({ type: 'quick_emoji', emoji }),
        created_at: new Date().toISOString(),
        message_type: 'quick_emoji',
        is_pending: true,
      },
    ]);
    forceScrollToLatest('smooth');
  };

  const sendQuickEmojiNotice = async (emoji) => {
    if (!activeChat) return;

    try {
      const response = await apiFetch('/api/inbox/quick-emoji', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          receiver_id: activeChat.other_user_id,
          emoji,
        }),
      });

      const data = await readJson(response);
      if (!response.ok) {
        if (response.status === 404) {
          addLocalQuickEmojiNotice(emoji);
          return;
        }
        throw new Error(data.error || 'Failed to update chat emoji.');
      }

      if (data.sent_message) {
        const processed = (await processIncomingMessages([data.sent_message]))[0];
        setMessages((prev) => prev.some((item) => item.id === processed.id) ? prev : [...prev, processed]);
        forceScrollToLatest('smooth');
      }
    } catch (error) {
      console.error(error);
      showModernAlert(error.message, 'Emoji Update Error');
    }
  };

  const sendGifMessage = async (gifUrl) => {
    const optimisticId = `optimistic-${Date.now()}`;
    const tempMsg = {
      id: optimisticId,
      client_id: optimisticId,
      sender_id: currentUser.id,
      receiver_id: activeChat.other_user_id,
      content: '',
      created_at: new Date().toISOString(),
      is_pending: true,
      attachment_url: gifUrl,
      attachment_type: 'image/gif',
      reply_to_message_id: replyToMessage?.id || null,
      reply_preview: replyToMessage ? { ...replyToMessage } : null,
    };
    setMessages((prev) => [...prev, tempMsg]);
    setEmojiPickerOpen(false);
    setGifPickerOpen(false);
    forceScrollToLatest('smooth');

    try {
      const encryptedContent = await encryptStringForUser('');
      const payload = {
        receiver_id: activeChat.other_user_id,
        content: encryptedContent,
        attachment_url: gifUrl,
        attachment_type: 'image/gif',
        reply_to_message_id: replyToMessage?.id || null,
        forwarded_from_message_id: null,
      };

      const response = await apiFetch('/api/inbox/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to send GIF.');

      if (data.sent_message) {
        const processed = (await processIncomingMessages([data.sent_message]))[0];
        processed.client_id = optimisticId; // Match the key to prevent re-animation
        setMessages((prev) => {
          const filtered = prev.filter(m => m.id !== processed.id);
          return filtered.map((m) => m.id === optimisticId ? processed : m);
        });
      }
    } catch (err) {
      console.error('Send GIF error:', err);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      showModernAlert(err.message, "Send Error");
    }
  };

  const submitMessage = async (event) => {
    event.preventDefault();
    if (!activeChat) return;
    if (!newMessage.trim() && attachedFiles.length === 0 && !editingMessage) return;

    try {
      if (attachedFiles.length > 0) {
        await sendAttachmentMessage();
      } else {
        await sendJsonMessage();
      }
    } catch (error) {
      console.error(error);
      showModernAlert(error.message, 'Forwarding Error');
    }
  };

  const getReactionName = (reaction) => (
    REACTION_EMOJIS.find((item) => item.emoji === reaction)?.name || 'Reaction'
  );

  const rememberReaction = (reaction) => {
    setRecentReactions((previous) => {
      const next = [reaction, ...previous.filter((item) => item !== reaction)].slice(0, 6);
      localStorage.setItem('inbox_recent_reactions', JSON.stringify(next));
      return next;
    });
  };

  const filteredReactionGroups = useMemo(() => {
    const query = reactionSearchQuery.trim().toLowerCase();
    const searchMatches = (item) => !query || [
      item.name,
      item.category,
      ...(item.keywords || []),
    ].join(' ').toLowerCase().includes(query);

    const groups = [];
    const recentItems = recentReactions
      .map((reaction) => REACTION_EMOJIS.find((item) => item.emoji === reaction))
      .filter(Boolean)
      .filter(searchMatches);

    if (recentItems.length) {
      groups.push({ title: 'Recent reactions', items: recentItems });
    }

    const categories = [...new Set(REACTION_EMOJIS.map((item) => item.category))];
    for (const category of categories) {
      const items = REACTION_EMOJIS
        .filter((item) => item.category === category)
        .filter(searchMatches);

      if (items.length) groups.push({ title: category, items });
    }

    return groups;
  }, [reactionSearchQuery, recentReactions]);

  const applyReactionNoticeToConversations = (notice) => {
    if (!notice?.other_user_id) return;

    const partnerId = normalizeUserId(notice.other_user_id);
    const activePartnerId = normalizeUserId(activeChatRef.current?.other_user_id);
    const isActiveConversation = activePartnerId === partnerId;

    setConversations((prev) => {
      const existing = prev.find((chat) => normalizeUserId(chat.other_user_id) === partnerId);
      if (!existing) {
        fetchConversations(null, { silent: true });
        return prev;
      }

      const updated = prev.map((chat) => (
        normalizeUserId(chat.other_user_id) === partnerId
          ? {
              ...chat,
              last_message: notice.preview || 'Reacted to a message',
              last_message_at: notice.last_message_at || new Date().toISOString(),
              unread_count: notice.unread && !isActiveConversation
                ? (chat.unread_count || 0) + 1
                : chat.unread_count || 0,
            }
          : chat
      ));

      return [...updated].sort((a, b) => getMessageSortTime(b.last_message_at) - getMessageSortTime(a.last_message_at));
    });
  };

  const handleReaction = async (message, reaction) => {
    try {
      const messageReactions = Array.isArray(message.reactions) ? message.reactions : [];
      const myReaction = messageReactions.find((item) => item.reacted_by_me)?.reaction || null;
      const nextReaction = myReaction === reaction ? '' : reaction;

      reactionUpdateMessageIdsRef.current.add(message.id);
      const response = await apiFetch(`/api/inbox/messages/${message.id}/reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ reaction: nextReaction }),
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to update reaction.');

      if (data.reaction_notice) {
        applyReactionNoticeToConversations(data.reaction_notice);
      }

      if (data.updated_message) {
        const updated = data.updated_message;
        setMessages((prev) => prev.map((item) => (
          item.id === message.id
            ? {
                ...item,
                reactions: updated.reactions || [],
                is_read: updated.is_read,
                is_edited: updated.is_edited,
              }
            : item
        )));
      }
      if (nextReaction) rememberReaction(nextReaction);
      setReactionBarId(null);
      setReactionPickerMessageId(null);
      setReactionPickerDirection('up');
      setReactionSearchQuery('');
      window.setTimeout(() => {
        reactionUpdateMessageIdsRef.current.delete(message.id);
      }, 1500);
    } catch (error) {
      reactionUpdateMessageIdsRef.current.delete(message.id);
      console.error(error);
      showModernAlert(error.message, 'Reaction Error');
    }
  };

  const handleDeleteMessage = (message, mode) => {
    const isUnsend = mode === 'everyone';
    const isDeletedBubble = !!message.deleted_for_everyone;
    const title = isUnsend ? 'Unsend Message' : isDeletedBubble ? 'Remove Deleted Message' : 'Delete Message';
    const messageText = isUnsend
      ? 'Unsend this message for everyone? This will remove the message for all participants in the chat.'
      : isDeletedBubble
      ? 'Remove this deleted-message bubble from your inbox? The other participant will still see their own copy.'
      : 'Delete this message from your inbox? Other participants will still be able to see it.';
    const confirmText = isUnsend ? 'Unsend' : isDeletedBubble ? 'Remove' : 'Delete for me';

    setConfirmConfig({
      title,
      message: messageText,
      confirmText,
      type: 'danger',
      onConfirm: async () => {
        preserveChatScrollPosition();
        try {
          const response = await apiFetch(`/api/inbox/messages/${message.id}?mode=${mode}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          });

          const data = await readJson(response);
          if (!response.ok) throw new Error(data.error || 'Failed to delete message.');

          if (isUnsend) {
            setMessages((prev) =>
              prev.map((item) =>
                item.id === message.id
                  ? { ...item, deleted_for_everyone: 1, content: 'Message removed', attachment_url: null, attachment_type: null, reactions: [] }
                  : item
              )
            );
            const otherUserId = normalizeUserId(message.sender_id) === normalizeUserId(currentUser?.id) ? message.receiver_id : message.sender_id;
            setConversations((prev) => prev.map((chat) => {
              if (normalizeUserId(chat.other_user_id) !== normalizeUserId(otherUserId)) return chat;
              const chatTime = getMessageSortTime(chat.last_message_at);
              const deletedTime = getMessageSortTime(message.created_at);
              if (chat.last_message_at && deletedTime && Math.abs(chatTime - deletedTime) > 2000) return chat;
              return {
                ...chat,
                last_message: 'You deleted a message',
                last_message_at: message.created_at || chat.last_message_at,
                last_message_is_reaction: false,
                last_message_type: 'deleted',
                last_message_sender_id: message.sender_id,
              };
            }));
          } else {
            setMessages((prev) => prev.filter((item) => item.id !== message.id));
          }
          
          setReplyToMessage((prev) => (prev?.id === message.id ? null : prev));
          setEditingMessage((prev) => (prev?.id === message.id ? null : prev));
          setOpenMenuId(null);
        } catch (error) {
          console.error(error);
          showModernAlert(error.message, 'Delete Error');
        }
      }
    });
    setOpenMenuId(null);
  };

  const handleTogglePin = async (message) => {
    const isCurrentlyPinned = !!message.is_pinned;
    const url = `/api/inbox/messages/${message.id}/pin`;
    const method = isCurrentlyPinned ? 'DELETE' : 'POST';

    try {
      const response = await apiFetch(url, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to update pin status.');

      setMessages((prev) => prev.map((m) => normalizeUserId(m.id) === normalizeUserId(message.id) ? { ...m, is_pinned: isCurrentlyPinned ? 0 : 1 } : m));
      if (isCurrentlyPinned) {
        setPinnedMessageMenuId(null);
      }
    } catch (error) {
      console.error('Toggle pin error:', error);
      showModernAlert(error.message, 'Pin Error');
    } finally {
      setOpenMenuId(null);
    }
  };

  const handleReportMessage = (message) => {
    setConfirmConfig({
      title: 'Report Message',
      message: 'Are you sure you want to report this message to community moderators? Our team will review the content within 24 hours.',
      confirmText: 'Submit Report',
      type: 'danger',
      onConfirm: async () => {
        try {
          const response = await apiFetch(`/api/inbox/messages/${message.id}/report`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          });

          const data = await readJson(response);
          if (!response.ok) throw new Error(data.error || 'Failed to report message.');

          showModernAlert('Thank you for your report. Our moderation team has been notified and will investigate this message.', 'Report Submitted');
        } catch (error) {
          console.error('Report message error:', error);
          showModernAlert(error.message, 'Report Error');
        }
      }
    });
    setOpenMenuId(null);
  };

  const handleDeleteConversation = () => {
    if (!activeChat) return;
    
    setConfirmConfig({
      title: 'Delete Conversation',
      message: `Are you sure you want to delete the entire conversation with ${activeChat.first_name} ${activeChat.last_name}? This action cannot be undone.`,
      confirmText: 'Delete Everything',
      type: 'danger',
      onConfirm: async () => {
        try {
          setDeletingConversation(true);
          const response = await apiFetch(`/api/inbox/conversations/${activeChat.other_user_id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          });

          const data = await readJson(response);
          if (!response.ok) throw new Error(data.error || 'Failed to delete conversation.');

          setConversations((prev) => prev.filter((chat) => normalizeUserId(chat.other_user_id) !== normalizeUserId(activeChat.other_user_id)));
          setActiveChat(null);
          setMessages([]);
          resetComposerContext();
        } catch (error) {
          console.error(error);
          showModernAlert(error.message, "Delete Error");
        } finally {
          setDeletingConversation(false);
        }
      }
    });
  };

  const beginReply = (message) => {
    preserveChatScrollPosition();
    setReplyToMessage(message);
    setEditingMessage(null);
    setOpenMenuId(null);
    setOpenMenuDirection('up');
  };

  const beginEdit = (message) => {
    preserveChatScrollPosition();
    setEditingMessage(message);
    setReplyToMessage(null);
    clearAttachments();
    setNewMessage(message.content);
    setOpenMenuId(null);
    setOpenMenuDirection('up');
  };

  const beginForward = (message) => {
    preserveChatScrollPosition();
    setForwardingMessage(message);
    setComposerMode('forward');
    setOpenMenuId(null);
    setOpenMenuDirection('up');
  };

  const toggleMessageMenu = (messageId, event) => {
    preserveChatScrollPosition();
    if (openMenuId === messageId) {
      setOpenMenuId(null);
      setOpenMenuDirection('up');
      return;
    }

    const triggerRect = event.currentTarget.getBoundingClientRect();
    const scrollRect = chatMessagesRef.current?.getBoundingClientRect();
    const bounds = scrollRect || {
      top: 0,
      bottom: window.innerHeight,
    };
    const topSpace = triggerRect.top - bounds.top;
    const bottomSpace = bounds.bottom - triggerRect.bottom;
    const nextDirection = bottomSpace < 220 && topSpace > bottomSpace ? 'up' : 'down';

    setOpenMenuDirection(nextDirection);
    setOpenMenuId(messageId);
  };

  const startConversation = async (user) => {
    const existing = conversations.find((chat) => normalizeUserId(chat.other_user_id) === normalizeUserId(user.id));
    const nextChat = existing || {
      other_user_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      username: user.username,
      email: user.email,
      profile_picture: user.profile_picture,
      mobile_number: user.mobile_number,
      student_id: user.student_id,
      public_key: user.public_key,
      last_message: '',
      unread_count: 0,
    };

    setComposerMode(null);
    setForwardingMessage(null);
    await selectChat(nextChat);
  };

  const forwardToUser = async (user) => {
    if (!forwardingMessage) return;

    try {
      setComposerMode(null);

      let attachmentId = null;
      let attachmentUrl = forwardingMessage.attachment_url;
      let finalAttachmentType = forwardingMessage.attachment_type;

      if (forwardingMessage.attachment_url) {
        let rawBlob = null;
        let originalFileName = 'forwarded_file';

        const decryptedUrl = decryptedAttachmentUrls[forwardingMessage.id]?.url;
        if (decryptedUrl) {
           const res = await fetch(decryptedUrl);
           rawBlob = await res.blob();
           originalFileName = decryptedAttachmentUrls[forwardingMessage.id]?.name || 'forwarded_file';
        } else if (forwardingMessage.attachment_type && forwardingMessage.attachment_type.startsWith('e2e-file:')) {
           const fileUrl = getAttachmentFileUrl(forwardingMessage.attachment_url);
           const res = await fetch(fileUrl, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
           if (res.ok) {
             const role = normalizeUserId(forwardingMessage.sender_id) === normalizeUserId(currentUser.id) ? 'sender' : 'receiver';
             const decryptedBuffer = await decryptFileE2E(await res.text(), getMyPrivateKey(), role);
             if (decryptedBuffer) {
               const originalType = forwardingMessage.attachment_type.replace(/^e2e-file:/, '') || 'application/octet-stream';
               rawBlob = new Blob([decryptedBuffer], { type: originalType });
               originalFileName = forwardingMessage.original_file_name || 'forwarded_file';
             }
           }
        } else if (forwardingMessage.attachment_type && !forwardingMessage.attachment_type.startsWith('e2e-file:')) {
           const res = await fetch(resolveMediaUrl(forwardingMessage.attachment_url));
           rawBlob = await res.blob();
        }

        if (!rawBlob) {
          throw new Error('Failed to retrieve or decrypt attachment for forwarding.');
        }
        
        if (!originalFileName.includes('.')) {
          if (rawBlob.type.includes('audio/webm')) originalFileName += '.webm';
          else if (rawBlob.type.includes('audio/mpeg')) originalFileName += '.mpeg';
          else if (rawBlob.type.includes('image/jpeg')) originalFileName += '.jpg';
          else if (rawBlob.type.includes('image/png')) originalFileName += '.png';
          else if (rawBlob.type.includes('application/pdf')) originalFileName += '.pdf';
          else if (rawBlob.type.includes('video/mp4')) originalFileName += '.mp4';
          else originalFileName += '.webm'; // default to webm for audio messages just in case
        }

        if (rawBlob) {
          const fileToUpload = new File([rawBlob], originalFileName, { type: rawBlob.type });
          
          const myPublicKey = getMyPublicKey();
          const recipientPubKey = user?.public_key || user?.publicKey;
          const recipientPublicKey = recipientPubKey ? (typeof recipientPubKey === 'string' ? JSON.parse(recipientPubKey) : recipientPubKey) : null;
          
          const formData = new FormData();

          if (myPublicKey && recipientPublicKey) {
            // Recipient has E2E keys — encrypt the attachment
            const encryptedFileBlob = await encryptFileE2E(fileToUpload, myPublicKey, recipientPublicKey);
            formData.append('file', encryptedFileBlob, `encrypted_${originalFileName}.e2e`);
          } else {
            // Recipient has no E2E keys yet — upload raw attachment
            formData.append('file', fileToUpload, originalFileName);
          }
          
          const uploadRes = await apiFetch('/api/inbox/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            body: formData,
          });
          
          const uploadData = await readJson(uploadRes);
          if (!uploadRes.ok) throw new Error(uploadData.error || 'Failed to upload forwarded attachment');
          
          attachmentUrl = uploadData.attachment_url;
          attachmentId = uploadData.attachment_id;
          finalAttachmentType = (myPublicKey && recipientPublicKey) ? `e2e-file:${rawBlob.type}` : rawBlob.type;
        }
      }
      
      const recipientHasKeys = !!(user?.public_key || user?.publicKey);
      const encryptedContent = recipientHasKeys
        ? await encryptStringForUser(forwardingMessage.content || '', user)
        : (forwardingMessage.content || '');

      const payload = {
        receiver_id: user.id,
        forwarded_from_message_id: forwardingMessage.id,
        content: encryptedContent,
      };

      if (attachmentUrl !== forwardingMessage.attachment_url || attachmentUrl) {
         payload.attachment_url = attachmentUrl;
         payload.attachment_type = finalAttachmentType;
      }
      if (attachmentId) {
         payload.attachment_id = attachmentId;
      }

      const response = await apiFetch('/api/inbox/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to forward message.');

      setForwardingMessage(null);

      if (normalizeUserId(activeChat?.other_user_id) === normalizeUserId(user.id)) {
        const processed = data.sent_message ? (await processIncomingMessages([data.sent_message]))[0] : null;
        forceScrollToLatest();
        if (processed) {
          setMessages((prev) => prev.some((item) => item.id === processed.id) ? prev : [...prev, processed]);
        }
      } else {
        await startConversation(user);
      }

      fetchConversations(null, { silent: true });
    } catch (error) {
      console.error(error);
      showModernAlert(error.message, 'Forwarding Error');
    }
  };

  const handleFilePick = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const hasVideo = files.some(f => isVideoFile(f));
    if (hasVideo) {
      showModernAlert('Direct video uploads are disabled on this platform. Please share video links (YouTube, Vimeo, Google Drive) instead.', 'Video Uploads Disabled');
    }
    const nonVideoFiles = files.filter(f => !isVideoFile(f));
    if (nonVideoFiles.length === 0) {
      if (event.target) event.target.value = '';
      return;
    }
    const newFiles = await Promise.all(nonVideoFiles.map(async (file) => {
      let processedFile = file;
      if (file.type && file.type.startsWith('image/')) {
        processedFile = await compressImage(file, { maxWidth: 1440, quality: 0.82, outputFormat: 'file' });
      }
      return {
        id: Math.random().toString(36).substr(2, 9),
        file: processedFile,
        previewUrl: ((processedFile.type || '').startsWith('image/') || (processedFile.type || '').startsWith('audio/')) ? URL.createObjectURL(processedFile) : null
      };
    }));
    setAttachedFiles(prev => [...prev, ...newFiles]);
    setEditingMessage(null);
    if (event.target) event.target.value = '';
  };

  const getAttachmentFileUrl = (attachmentUrl) => {
    const filename = attachmentUrl?.split('/').pop();
    if (filename && attachmentUrl.includes('/inbox-attachments/')) {
      return `/api/inbox/attachments/${encodeURIComponent(filename)}`;
    }
    return resolveMediaUrl(attachmentUrl);
  };


  const renderAttachment = (message) => {
    if (!message.attachment_url) return null;

    if (message.attachment_type === 'broadcast_attachments') {
      try {
        const atts = JSON.parse(message.attachment_url);
        if (Array.isArray(atts) && atts.length > 0) {
          return (
            <div className="broadcast-inbox-attachments" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {atts.map((att, idx) => {
                const isImage = att.file_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(att.file_name);
                const isPdf = att.file_type === 'application/pdf' || att.file_name?.toLowerCase().endsWith('.pdf');
                const fileUrl = resolveMediaUrl(att.file_path);
                if (isImage) {
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="attachment-card image attachment-image-btn"
                      onClick={() => setImageViewer({
                        src: fileUrl,
                        alt: att.file_name,
                        caption: att.file_name,
                      })}
                      style={{ border: 'none', background: 'none', padding: 0, cursor: 'zoom-in', outline: 'none' }}
                    >
                      <img 
                        src={fileUrl} 
                        alt={att.file_name} 
                        style={{ maxWidth: '240px', borderRadius: '8px', display: 'block', maxHeight: '180px', objectFit: 'contain' }}
                      />
                    </button>
                  );
                } else if (isPdf) {
                  return (
                    <div 
                      key={idx} 
                      className="attachment-card file" 
                      onClick={() => setPdfViewer({ url: fileUrl, name: att.file_name })}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'zoom-in' }}
                    >
                      <FileText size={18} />
                      <span>{att.file_name} (Preview PDF)</span>
                    </div>
                  );
                } else {
                  return (
                    <a key={idx} href={fileUrl} download={att.file_name} target="_blank" rel="noreferrer" className="attachment-card file" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit' }}>
                      <FileText size={18} />
                      <span>{att.file_name}</span>
                    </a>
                  );
                }
              })}
            </div>
          );
        }
      } catch (e) {
        console.error('Failed to parse broadcast attachments:', e);
      }
    }

    const decryptedAttachment = decryptedAttachmentUrls[message.id] || null;
    const rawAttachmentType = message.attachment_type || '';
    const attachmentType = decryptedAttachment?.type || rawAttachmentType;
    const optimisticAudioUrl = rawAttachmentType.startsWith('audio/') && message.attachment_url?.startsWith('blob:')
      ? message.attachment_url
      : null;
    const fileUrl = decryptedAttachment?.url || optimisticAudioUrl || null;

    if (!fileUrl || (attachmentType.startsWith('e2e-file:') && !decryptedAttachment)) {
      return (
        <div className="attachment-card file">
          <FileText size={18} />
          <span>{attachmentType.startsWith('e2e-file:') ? 'Decrypting attachment...' : 'Loading attachment...'}</span>
        </div>
      );
    }

    if (attachmentType.startsWith('image/')) {
      return (
          <button
          type="button"
          className="attachment-card image attachment-image-btn"
          onClick={() => setImageViewer({
            src: fileUrl,
            alt: message.content || 'Attachment',
            caption: message.content || '',
          })}
        >
            <img 
              src={fileUrl} 
              alt={message.content || 'Attachment'} 
            />
          </button>
        );
      }

      if (attachmentType.startsWith('video/')) {
        return (
          <div className="attachment-card video">
            <video
              src={`${fileUrl}#t=0.5`}
              controls
              preload="metadata"
              playsInline
              muted
              style={{
                width: '100%',
                maxWidth: '320px',
                borderRadius: '8px',
                display: 'block',
                background: '#000',
              }}
              onLoadedMetadata={(e) => {
                // Seek to capture a frame as thumbnail
                if (e.target.currentTime === 0) e.target.currentTime = 0.5;
              }}
            />
          </div>
        );
      }

      if (attachmentType.startsWith('audio/')) {
        const isMine = message.sender_id === currentUser.id || message.sender_id === currentUserIdRef.current;
        return (
          <div className="attachment-card audio" style={{ background: 'transparent', padding: 0, border: 'none', boxShadow: 'none' }}>
            <VoiceMessagePlayer key={fileUrl || message.id} src={fileUrl} isMine={isMine} avatarUrl={isMine ? currentUser?.profile_picture : activeChat?.profile_picture} />
          </div>
        );
      }

    const isPdf = attachmentType === 'application/pdf' || 
                  (message.content && message.content.toLowerCase().endsWith('.pdf')) || 
                  (message.attachment_url && message.attachment_url.toLowerCase().endsWith('.pdf'));

    if (isPdf) {
      return (
        <div 
          className="attachment-card file" 
          onClick={() => setPdfViewer({ url: fileUrl, name: message.content || 'attachment.pdf' })}
          style={{ cursor: 'zoom-in', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FileText size={18} />
          <span>{message.content || 'Preview PDF'}</span>
        </div>
      );
    }

    return (
      <a href={fileUrl} download={message.content || true} className="attachment-card file">
        <FileText size={18} />
        <span>{message.content || 'Open attachment'}</span>
      </a>
    );
  };

  const renderPendingAttachmentPreview = (attachment) => {
    const { file, previewUrl } = attachment;
    if (!file) return null;

    if ((file.type || '').startsWith('image/') && previewUrl) {
      return <img src={previewUrl} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    }

    if ((file.type || '').startsWith('video/') && previewUrl) {
      return <video src={previewUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    }

    if ((file.type || '').startsWith('audio/') && previewUrl) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
           <Mic size={20} color="var(--text-primary)" />
        </div>
      );
    }

    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
        <FileText size={20} color="var(--text-primary)" />
      </div>
    );
  };

  const filteredConversations = useMemo(() => {
    const query = sidebarQuery.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((chat) => {
      const haystack = [
        `${chat.first_name || ''} ${chat.last_name || ''}`.trim(),
          chat.username,
          chat.email,
          chat.role,
          chat.student_id,
          chat.mobile_number,
          `${chat.other_user_id}`,
        ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [conversations, sidebarQuery]);

  const sidebarDirectoryResults = useMemo(() => {
    const existingIds = new Set(filteredConversations.map((chat) => normalizeUserId(chat.other_user_id)));
    return sidebarSearchResults.filter((user) => !existingIds.has(normalizeUserId(user.id)));
  }, [filteredConversations, sidebarSearchResults]);


  const activeChatId = activeChat ? normalizeUserId(activeChat.other_user_id) : null;
  const activeChatQuickEmoji = activeChatId != null
    ? (chatQuickEmojis[String(activeChatId)] || DEFAULT_CHAT_QUICK_EMOJI)
    : DEFAULT_CHAT_QUICK_EMOJI;
  useEffect(() => {
    if (activeChatId == null) return;

    const latestQuickEmojiNotice = [...messages].reverse().find((message) => message.message_type === 'quick_emoji');
    if (!latestQuickEmojiNotice?.content) return;

    try {
      const parsed = JSON.parse(latestQuickEmojiNotice.content);
      if (parsed?.type !== 'quick_emoji' || !parsed.emoji) return;

      const key = String(activeChatId);
      if (chatQuickEmojis[key] === parsed.emoji) return;

      setChatQuickEmojis((previous) => {
        const next = { ...previous, [key]: parsed.emoji };
        localStorage.setItem('inbox_chat_quick_emojis', JSON.stringify(next));
        return next;
      });
    } catch {
      // Ignore malformed historical notices.
    }
  }, [activeChatId, messages, chatQuickEmojis]);
  const activeChatMuted = activeChatId != null && mutedChats.has(activeChatId);
  const pinnedMessages = useMemo(() => (
    messages
      .filter((message) => message.is_pinned && !message.deleted_for_everyone && message.message_type !== 'reaction')
      .sort((a, b) => getMessageSortTime(a.created_at) - getMessageSortTime(b.created_at))
  ), [messages]);
  const latestPinnedMessage = pinnedMessages[pinnedMessages.length - 1] || null;
  const filteredChatEmojiGroups = useMemo(() => {
    const query = chatEmojiSearchQuery.trim().toLowerCase();
    const searchMatches = (item) => !query || [
      item.name,
      item.category,
      ...(item.keywords || []),
    ].join(' ').toLowerCase().includes(query);

    return [...new Set(REACTION_EMOJIS.map((item) => item.category))]
      .filter((category) => query || category === chatEmojiCategory)
      .map((category) => ({
        title: category,
        items: REACTION_EMOJIS
          .filter((item) => item.category === category)
          .filter(searchMatches),
      }))
      .filter((group) => group.items.length);
  }, [chatEmojiSearchQuery, chatEmojiCategory]);

  const setActiveChatQuickEmoji = (emoji) => {
    if (activeChatId == null) return;
    const previousEmoji = activeChatQuickEmoji;
    setChatQuickEmojis((previous) => {
      const next = { ...previous, [String(activeChatId)]: emoji };
      localStorage.setItem('inbox_chat_quick_emojis', JSON.stringify(next));
      return next;
    });
    setChatEmojiPickerOpen(false);
    setChatEmojiSearchQuery('');
    if (previousEmoji !== emoji) {
      sendQuickEmojiNotice(emoji);
    }
  };

  const mediaFilesLinks = useMemo(() => {
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    const cleanUrl = (value) => value.replace(/[),.;!?]+$/g, '');
    const seenLinks = new Set();
    const media = [];
    const files = [];
    const links = [];

    messages
      .filter((message) => !message.deleted_for_everyone && message.message_type !== 'reaction' && message.message_type !== 'call_log')
      .forEach((message) => {
        if (message.attachment_url) {
          const decryptedAttachment = decryptedAttachmentUrls[message.id] || null;
          const rawAttachmentType = message.attachment_type || '';
          if (rawAttachmentType.startsWith('e2e-file:') && !decryptedAttachment) return;
          const attachmentType = decryptedAttachment?.type || rawAttachmentType.replace(/^e2e-file:/, '') || 'application/octet-stream';
          const attachmentUrl = decryptedAttachment?.url || getAttachmentFileUrl(message.attachment_url);
          const fallbackName = (() => {
            const rawUrlName = message.attachment_url?.split('/').pop()?.split('?')[0];
            if (!rawUrlName) return null;
            try {
              return decodeURIComponent(rawUrlName);
            } catch {
              return rawUrlName;
            }
          })();
          const attachmentName = decryptedAttachment?.name
            || message.attachment_name
            || (message.content && message.content !== 'Voice message' ? message.content : null)
            || fallbackName
            || (attachmentType.startsWith('audio/') ? 'Voice message' : 'Attachment');
          const item = {
            id: message.id,
            url: attachmentUrl,
            type: attachmentType,
            name: attachmentName,
            createdAt: message.created_at,
          };

          if (attachmentType.startsWith('image/') || attachmentType.startsWith('video/')) {
            media.push(item);
          } else {
            files.push(item);
          }
        }

        const matches = String(message.content || '').match(urlPattern) || [];
        matches.forEach((match) => {
          const url = cleanUrl(match);
          if (!url || seenLinks.has(url)) return;
          seenLinks.add(url);
          let host = url;
          try {
            host = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            host = url;
          }
          links.push({
            id: `${message.id}-${links.length}`,
            url,
            host,
            createdAt: message.created_at,
          });
        });
      });

    return {
      media: [...media].reverse(),
      files: [...files].reverse(),
      links: [...links].reverse()
    };
  }, [decryptedAttachmentUrls, messages]);

  const chatSearchResults = useMemo(() => {
    const query = chatSearchQuery.trim().toLowerCase();
    if (!query) return [];

    return messages
      .filter((message) => message.message_type !== 'reaction' && message.message_type !== 'call_log')
      .filter((message) => {
        const haystack = [
          message.content,
          message.is_forwarded ? 'forwarded' : '',
          message.attachment_url ? 'attachment file media' : '',
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.includes(query);
      })
      .map((message) => message.id);
  }, [messages, chatSearchQuery]);

  useEffect(() => {
    setChatSearchIndex(0);
  }, [chatSearchQuery, activeChatId]);

  useEffect(() => {
    setPinnedMessagesOpen(false);
    setPinnedMessageMenuId(null);
    setHighlightedPinnedMessageId(null);
  }, [activeChatId]);

  useEffect(() => {
    if (chatSearchIndex < chatSearchResults.length) return;
    setChatSearchIndex(0);
  }, [chatSearchIndex, chatSearchResults.length]);

  useEffect(() => {
    if (!chatSearchOpen) {
      setChatSearchQuery('');
      setChatSearchIndex(0);
    }
  }, [chatSearchOpen, activeChatId]);

  const scrollToChatSearchResult = useCallback((messageId) => {
    if (!messageId) return;
    const messageElement = document.getElementById(`msg-${messageId}`);
    messageElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const getPinnedSenderLabel = useCallback((message) => {
    return normalizeUserId(message.sender_id) === normalizeUserId(currentUser?.id)
      ? 'You'
      : `${activeChat?.first_name || ''} ${activeChat?.last_name || ''}`.trim() || 'Them';
  }, [activeChat, currentUser?.id]);

  const getPinnedPreviewText = useCallback((message) => {
    if (message.message_type === 'call_log') return 'Call';
    if (message.attachment_url) {
      const type = message.attachment_type || '';
      if (type.includes('audio')) return message.content && message.content !== 'Voice message' ? message.content : 'Voice message';
      if (type.includes('image')) return message.content || 'Photo';
      if (type.includes('video')) return message.content || 'Video';
      return message.content || 'Attachment';
    }
    return message.content || 'Message';
  }, []);

  const showPinnedMessageInChat = useCallback((messageId) => {
    setPinnedMessagesOpen(false);
    setPinnedMessageMenuId(null);
    window.setTimeout(() => {
      const messageElement = document.getElementById(`msg-${messageId}`);
      messageElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedPinnedMessageId(messageId);
      window.setTimeout(() => {
        setHighlightedPinnedMessageId((currentId) => currentId === messageId ? null : currentId);
      }, 2600);
    }, 60);
  }, []);

  const highlightSearchQuery = (text, query) => {
    if (!text) return '';
    if (!query) return text;
    
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerText.indexOf(lowerQuery);
    
    if (matchIndex === -1) return text;
    
    const start = Math.max(0, matchIndex - 30);
    const end = Math.min(text.length, matchIndex + query.length + 30);
    
    let snippet = text.slice(start, end);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    
    const snippetLower = snippet.toLowerCase();
    const snippetMatchIndex = snippetLower.indexOf(lowerQuery);
    
    if (snippetMatchIndex === -1) return text;
    
    const before = snippet.slice(0, snippetMatchIndex);
    const match = snippet.slice(snippetMatchIndex, snippetMatchIndex + query.length);
    const after = snippet.slice(snippetMatchIndex + query.length);
    
    return (
      <>
        {prefix}
        {before}
        <strong className="global-search-highlight" style={{ color: '#3b82f6', fontWeight: 'bold' }}>{match}</strong>
        {after}
        {suffix}
      </>
    );
  };

  const handleGlobalMessageSearchResultClick = async (result) => {
    const existingChat = conversations.find(
      (c) => normalizeUserId(c.other_user_id) === normalizeUserId(result.user.id)
    );
    
    setSlideDirection('enter');
    setPendingScrollMessageId(result.id);
    
    if (existingChat) {
      await selectChat(existingChat);
    } else {
      await startConversation(result.user);
    }
    
    window.setTimeout(() => setSlideDirection(null), 350);
  };

  const openChatSearch = useCallback(() => {
    setChatSearchOpen(true);
    setShowChatInfoPanel(true);
    window.setTimeout(() => chatSearchInputRef.current?.focus(), 100);
  }, []);

  const moveChatSearch = useCallback((direction) => {
    if (!chatSearchResults.length) return;

    setChatSearchIndex((previousIndex) => {
      const nextIndex = (previousIndex + direction + chatSearchResults.length) % chatSearchResults.length;
      window.setTimeout(() => scrollToChatSearchResult(chatSearchResults[nextIndex]), 0);
      return nextIndex;
    });
  }, [chatSearchResults, scrollToChatSearchResult]);



  const toggleMuteActiveChat = useCallback(() => {
    if (activeChatId == null) return;

    setMutedChats((previousMutedChats) => {
      const nextMutedChats = new Set(previousMutedChats);
      if (nextMutedChats.has(activeChatId)) {
        nextMutedChats.delete(activeChatId);
      } else {
        nextMutedChats.add(activeChatId);
      }
      return nextMutedChats;
    });
  }, [activeChatId]);

  const renderMessageContent = (content) => {
    const text = String(content || '');
    const query = chatSearchQuery.trim();

    if (!chatSearchOpen || !query) return text;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const pieces = [];
    let cursor = 0;
    let matchIndex = lowerText.indexOf(lowerQuery);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        pieces.push({ text: text.slice(cursor, matchIndex), match: false });
      }
      pieces.push({ text: text.slice(matchIndex, matchIndex + query.length), match: true });
      cursor = matchIndex + query.length;
      matchIndex = lowerText.indexOf(lowerQuery, cursor);
    }

    if (cursor < text.length) {
      pieces.push({ text: text.slice(cursor), match: false });
    }

    return (
      <>
        {pieces.map((piece, index) => (
          piece.match
            ? <mark key={`${piece.text}-${index}`} className="chat-search-highlight">{piece.text}</mark>
            : <span key={`${piece.text}-${index}`}>{piece.text}</span>
        ))}
      </>
    );
  };

  const composerTitle = composerMode === 'forward' ? 'Forward Message' : 'Start a New Chat';
  const composerDescription = composerMode === 'forward'
    ? 'Choose who should receive this forwarded message.'
    : 'Search by profile name, username, user ID, student ID, or phone number.';

  // Wrap selectChat to add slide-in animation
  const selectChatWithTransition = useCallback(async (chat, options = {}) => {
    if (!options.silent) {
      // Start animation immediately (don't await) — run in parallel with data fetch
      setSlideDirection('enter');
      // Clear animation class after it finishes (300ms), regardless of fetch status
      const clearAnimation = setTimeout(() => setSlideDirection(null), 350);
      try {
        await selectChat(chat, options);
      } finally {
        // If fetch was fast, clearAnimation already scheduled; if slow, clear now
        clearTimeout(clearAnimation);
        setSlideDirection(null);
      }
    } else {
      await selectChat(chat, options);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectChat]);

  if (loading) {
    return (
      <div className="page-container container inbox-page" style={{ display: 'flex', alignItems: 'stretch', flexDirection: 'row', gap: 0, paddingBottom: 0 }}>
        <div className="inbox-sidebar glass-panel" style={{ flex: 1 }}>
          <SkeletonLoader variant="inbox" count={8} />
        </div>
      </div>
    );
  }


  return (
      <div className={`page-container container inbox-page ${activeChat ? 'has-active-chat' : 'no-active-chat'}`} style={{ display: 'flex', paddingBottom: 0 }}>
      <input ref={fileInputRef} type="file" multiple accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" style={{ display: 'none' }} onChange={handleFilePick} />

      <div className={`inbox-sidebar glass-panel ${slideDirection === 'exit' ? 'slide-in-from-left' : ''}`} style={{ width: 320, flexShrink: 0 }}>
        {isGlobalMessageSearchActive ? (
          <div className="global-message-search-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="global-search-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1.25rem 1.25rem 0.8rem' }}>
              <button 
                type="button" 
                className="global-search-back-btn" 
                onClick={() => {
                  setIsGlobalMessageSearchActive(false);
                  setGlobalMessageSearchQuery('');
                  setGlobalMessageSearchResults([]);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0
                }}
              >
                <X size={20} />
              </button>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Search</h2>
            </div>
            
            <div className="search-bar inbox-search" style={{ margin: '0 1.25rem 0.75rem' }}>
              <SearchIcon size={16} className="text-muted" style={{ marginRight: '0.5rem' }} />
              <input
                type="text"
                placeholder="Search messages..."
                value={globalMessageSearchQuery}
                onChange={(event) => setGlobalMessageSearchQuery(event.target.value)}
                autoFocus
              />
              {globalMessageSearchQuery.trim() && (
                <span className="search-result-count-badge" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginRight: '0.35rem' }}>
                  {searchingGlobalMessages 
                    ? 'searching...' 
                    : globalMessageSearchResults.length > 99 
                      ? '99+ results' 
                      : `${globalMessageSearchResults.length} results`}
                </span>
              )}
              {globalMessageSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setGlobalMessageSearchQuery('');
                    setGlobalMessageSearchResults([]);
                  }}
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="chat-list custom-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
              {searchingGlobalMessages && (
                <div className="empty-results">Searching matching messages...</div>
              )}
              
              {!searchingGlobalMessages && globalMessageSearchQuery.trim() && globalMessageSearchResults.length === 0 && (
                <div className="empty-results">No messages found for that search.</div>
              )}

              {!searchingGlobalMessages && globalMessageSearchResults.map((result) => {
                const isOnline = onlineUsers?.has(String(result.user.id));
                return (
                  <button
                    key={`search-msg-${result.id}`}
                    type="button"
                    className="chat-item chat-item-search-result"
                    onClick={() => handleGlobalMessageSearchResultClick(result)}
                  >
                    <div className="avatar chat-avatar" style={{ background: result.user.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)', position: 'relative', flexShrink: 0 }}>
                      {result.user.profile_picture ? (
                        <img src={resolveMediaUrl(result.user.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                      ) : (
                        <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5, borderRadius: '50%' }} />
                      )}
                      {isOnline && (
                        <span className="online-dot" title="Online" />
                      )}
                    </div>
                    <div className="chat-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="chat-name-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>
                          {result.user.first_name} {result.user.last_name}
                        </h4>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {formatRelativeShortTime(result.created_at)}
                        </span>
                      </div>
                      <p className="chat-preview" style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {highlightSearchQuery(result.content, globalMessageSearchQuery)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div className="inbox-header font-display">
              <h2>
                Messages
                <span 
                  title={onlineUsers?.has(String(currentUser?.id)) ? "Socket Connected" : "Socket Disconnected"}
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: onlineUsers?.has(String(currentUser?.id)) ? '#10b981' : '#ef4444',
                    marginLeft: '8px',
                    marginBottom: '2px'
                  }}
                />
              </h2>
              {(currentUser?.role === 'admin' || (currentUser?.role === 'instructor' && hasBroadcastPermission)) && (
                <button className="new-msg-btn broadcast-btn" onClick={() => setQuickBroadcastOpen(true)} title="Quick Send Broadcast" style={{ marginRight: '8px' }}>
                  <Megaphone size={18} strokeWidth={2.5} />
                </button>
              )}
              <button className="new-msg-btn" onClick={() => setComposerMode('new')} title="New Message">
                <Pencil size={18} strokeWidth={3} />
              </button>
            </div>

            <div className="search-bar inbox-search" style={{ position: 'relative' }}>
              <SearchIcon size={16} className="text-muted" style={{ marginRight: '0.5rem', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Search by name, username, ID, email, or phone..."
                value={sidebarQuery}
                onChange={(event) => setSidebarQuery(event.target.value)}
                style={{ paddingRight: sidebarQuery ? '30px' : undefined }}
              />
              {sidebarQuery && (
                <button
                  type="button"
                  onClick={() => setSidebarQuery('')}
                  className="clear-search-btn"
                  style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="chat-list custom-scrollbar">
              {sidebarQuery.trim() && (
                <button
                  type="button"
                  className="search-messages-trigger"
                  onClick={() => {
                    setGlobalMessageSearchQuery(sidebarQuery);
                    setIsGlobalMessageSearchActive(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.75rem 1.25rem',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: 'none',
                    borderBottom: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    transition: 'background 0.2s',
                  }}
                >
                  <SearchIcon size={15} style={{ color: '#3b82f6', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Search messages for <strong>"{sidebarQuery}"</strong>
                  </span>
                </button>
              )}

              {filteredConversations.map((chat) => (
                (() => {
                  const isActiveChat = normalizeUserId(activeChat?.other_user_id) === normalizeUserId(chat.other_user_id);
                  const isUnreadChat = chat.unread_count > 0 && !isActiveChat;
                  const isReactionPreview = chat.last_message_is_reaction || chat.last_message_type === 'reaction';
                  const isMutedChat = mutedChats.has(normalizeUserId(chat.other_user_id));

                  return (
                <div
                  key={chat.other_user_id}
                  className={`chat-item ${isActiveChat ? 'active' : ''} ${isUnreadChat ? 'unread' : ''} ${isMutedChat ? 'muted' : ''}`}
                  onClick={() => selectChatWithTransition(chat)}
                >
                  <div className="avatar chat-avatar" style={{ background: chat.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)', position: 'relative' }}>
                    {chat.profile_picture ? (
                      <img src={resolveMediaUrl(chat.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                    )}
                    {onlineUsers?.has(String(chat.other_user_id)) && (
                      <span className="online-dot" title="Online" />
                    )}
                  </div>
                  <div className="chat-info">
                    <div className="chat-name-row">
                      <h4>{chat.first_name} {chat.last_name}</h4>
                      <div className="chat-status-stack">
                        {isMutedChat && <BellOff size={14} className="muted-chat-indicator" aria-label="Muted chat" />}
                        {isUnreadChat && isReactionPreview && (
                          <span className="reaction-unread-dot" aria-label="New reaction" />
                        )}
                        {isUnreadChat && !isReactionPreview && (
                          <>
                          <span className="new-indicator">New</span>
                          <span className="unread-badge">{chat.unread_count}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="chat-preview">
                      {(() => {
                        const draftText = (drafts || {})[chat.other_user_id];
                        if (typeof draftText === 'string' && draftText.trim().length > 0) {
                          const metaTime = chat.last_message_at ? ` · ${formatRelativeShortTime(chat.last_message_at)}` : '';
                          return (
                            <>
                              <span style={{ color: '#0084ff', fontWeight: 500 }}>Draft:</span> {draftText.length > 40 ? draftText.substring(0, 40) + '...' : draftText}{metaTime}
                            </>
                          );
                        }

                        const lm = chat.last_message || '';
                        const metaTime = chat.last_message_at ? ` · ${formatRelativeShortTime(chat.last_message_at)}` : '';
                        // If it looks like a reaction JSON, show a friendly label
                        if (lm.startsWith('{') && lm.includes('"type":"reaction"')) {
                          const reactionPreview = formatReactionPreview(lm, chat.last_message_sender_id, chat);
                          if (reactionPreview) return `${reactionPreview}${metaTime}`;
                        }
                        if (lm.startsWith('{') && lm.includes('"type":"quick_emoji"')) {
                          const quickEmojiPreview = formatQuickEmojiNotice(lm, chat.last_message_sender_id);
                          if (quickEmojiPreview) return `${quickEmojiPreview}${metaTime}`;
                        }
                        if (isReactionPreview) return `${lm}${metaTime}`;

                        // If it looks like a call_log JSON, show a friendly label
                        if (lm.startsWith('{') && lm.includes('call_type')) {
                          try {
                            const d = JSON.parse(lm);
                            const icon = d.call_type === 'video' ? 'Γëí╞Æ├┤Γòú' : 'Γëí╞Æ├┤Γéº';
                            const st = d.status === 'answered' ? 'Answered'
                              : d.status === 'declined' ? 'Declined' : 'Missed';
                            return `${icon} ${d.call_type === 'video' ? 'Video' : 'Audio'} call Γö¼Γòû ${st}`;
                          } catch { /* fall through */ }
                        }
                        return lm;
                      })()}
                    </p>
                  </div>
                </div>
                  );
                })()
              ))}

              {sidebarQuery.trim() && sidebarDirectoryResults.map((user) => (
                <button
                  key={`directory-${user.id}`}
                  type="button"
                  className="chat-item chat-item-directory"
                  onClick={() => { setSlideDirection('enter'); startConversation(user); setTimeout(() => setSlideDirection(null), 300); }}
                >
                  <div className="avatar chat-avatar" style={{ background: user.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)' }}>
                    {user.profile_picture ? (
                      <img src={resolveMediaUrl(user.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                    )}
                  </div>
                  <div className="chat-info">
                    <div className="chat-name-row">
                      <h4>{user.first_name} {user.last_name}</h4>
                    </div>
                    <p className="chat-preview" style={{ color: 'var(--text-muted)' }}>
                      {getRoleDisplayText(user.role, user.batch_number)}
                    </p>
                  </div>
                </button>
              ))}

              {sidebarQuery.trim() && searchingSidebarUsers && (
                <div className="empty-results">Searching users...</div>
              )}

              {sidebarQuery.trim() && !searchingSidebarUsers && filteredConversations.length === 0 && sidebarDirectoryResults.length === 0 && (
                <div className="empty-results">No users found for that search.</div>
              )}
            </div>
          </>
        )}
      </div>

      <div
        ref={inboxMainRef}
        className={`inbox-main glass-panel ${activeChat && showChatInfoPanel ? 'has-details-panel' : ''} ${slideDirection === 'enter' ? 'slide-in-from-right' : ''} ${slideDirection === 'exit' ? 'slide-out-to-right' : ''}`}
        style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        {activeChat ? (
          <>
            <div className="chat-header">
              {/* Left: back + avatar + name */}
              <div className="chat-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <button
                  className="hdr-icon-btn chat-back-btn"
                  onClick={() => {
                    // If we pushed a history entry, go back to consume it
                    // (popstate handler will call closeChat)
                    if (historyPushedRef.current) {
                      window.history.back();
                    } else {
                      closeChat();
                    }
                  }}
                  title="Back"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                </button>
                <div className="avatar chat-avatar" style={{ background: activeChat.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)', flexShrink: 0, position: 'relative' }}>
                  {activeChat.profile_picture ? (
                    <img src={resolveMediaUrl(activeChat.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                  )}
                  {onlineUsers?.has(String(activeChat.other_user_id)) && (
                    <span className="online-dot" title="Online" />
                  )}
                </div>
                <div className="chat-header-text" style={{ minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.97rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeChat.first_name} {activeChat.last_name}
                  </h3>
                  <span className="text-muted text-sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeChat.role}</span>
                </div>
              </div>

              {/* Right: 4 uniform circle icon buttons */}
              <div className="chat-header-right" style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                {/* Audio Call */}
                <button
                  className="hdr-icon-btn hdr-icon-btn--call-audio"
                  onClick={() => initiateCall(activeChat.other_user_id, activeChat, false)}
                  title="Audio Call"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                </button>
                {/* Video Call */}
                <button
                  className="hdr-icon-btn hdr-icon-btn--call-video"
                  onClick={() => initiateCall(activeChat.other_user_id, activeChat, true)}
                  title="Video Call"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                </button>
                {/* New Chat */}
                <button
                  className="hdr-icon-btn hdr-icon-btn--new"
                  onClick={() => setComposerMode('new')}
                  title="New Chat"
                >
                  <UserPlus size={16} />
                </button>
                {/* Delete Chat */}
                <button
                  className="hdr-icon-btn hdr-icon-btn--delete"
                  disabled={deletingConversation}
                  onClick={handleDeleteConversation}
                  title={deletingConversation ? 'Deleting╬ô├ç┬¬' : 'Delete Chat'}
                >
                  <Trash2 size={16} />
                </button>
                {/* Chat Info Toggle */}
                <button
                  className={`hdr-icon-btn hdr-icon-btn--info ${showChatInfoPanel ? 'active' : ''}`}
                  onClick={() => setShowChatInfoPanel(!showChatInfoPanel)}
                  title={showChatInfoPanel ? 'Hide Chat Details' : 'View Chat Details'}
                >
                  <Info size={16} />
                </button>
              </div>
            </div>



            {latestPinnedMessage && (
              <button type="button" className="pinned-message-bar" onClick={() => setPinnedMessagesOpen(true)}>
                <Pin size={17} />
                <div className="pinned-message-bar-text">
                  <span>{getPinnedSenderLabel(latestPinnedMessage)}</span>
                  <strong>{getPinnedPreviewText(latestPinnedMessage)}</strong>
                </div>
                <ChevronDown size={16} />
              </button>
            )}

            <div 
              ref={chatMessagesRef} 
              className="chat-messages custom-scrollbar"
              onScroll={handleChatScroll}
            >
              {messages.map((message) => {
                const isMine = normalizeUserId(message.sender_id) === normalizeUserId(currentUser.id);
                const messageReactions = Array.isArray(message.reactions) ? message.reactions : [];
                const myReaction = messageReactions.find((item) => item.reacted_by_me)?.reaction || '';
                const senderAvatarSrc = activeChat?.profile_picture
                  ? resolveMediaUrl(activeChat.profile_picture)
                  : `${import.meta.env.BASE_URL}avatars/male1.png`;

                if (message.message_type === 'reaction') {
                  return null;
                }

                if (message.message_type === 'quick_emoji') {
                  return (
                    <div id={`msg-${message.id}`} key={message.client_id || message.id} className="quick-emoji-notice">
                      {formatQuickEmojiNotice(message)}
                    </div>
                  );
                }

                // ╬ô├╢├ç╬ô├╢├ç Messenger-style Call Log Bubble ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç
                if (message.deleted_for_everyone) {
                  return (
                    <div
                      id={`msg-${message.id}`}
                      key={message.client_id || message.id}
                      className={`message-wrapper ${isMine ? 'mine' : 'theirs'} ${!isMine ? 'with-sender-avatar' : ''} ${highlightedPinnedMessageId === message.id ? 'pinned-message-highlight' : ''}`}
                    >
                      {!isMine && <img className="message-sender-avatar" src={senderAvatarSrc} alt="" />}
                      <div className={`message-shell deleted-message-shell ${openMenuId === message.id ? 'controls-open' : ''}`}>
                        <div className={`message-tools ${isMine ? 'mine' : 'theirs'} deleted-message-tools`}>
                          <button type="button" className={`mini-action-btn ${openMenuId === message.id ? 'active' : ''}`} onPointerDown={(event) => event.preventDefault()} onClick={(event) => toggleMessageMenu(message.id, event)} title="More">
                            <MoreVertical size={14} />
                          </button>
                        </div>
                        {openMenuId === message.id && (
                          <div className={`message-menu ${isMine ? 'mine' : 'theirs'} ${openMenuDirection}`}>
                            <button type="button" className="message-menu-item" onClick={() => handleDeleteMessage(message, 'me')}>
                              <Trash2 size={14} /> Remove
                            </button>
                          </div>
                        )}
                        <div className={`message-bubble deleted-message-bubble ${isMine ? 'mine' : 'theirs'}`}>
                          <span>{formatDeletedMessageText(message)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (message.message_type === 'call_log') {
                  let callData = {};
                  try {
                    // content may be raw JSON or server-encrypted JSON
                    const raw = message.content || '';
                    callData = JSON.parse(raw.startsWith('{') ? raw : '{}');
                  } catch { callData = {}; }

                  const isVideo   = callData.call_type === 'video';
                  const status    = callData.status || 'missed';
                  const duration  = callData.duration_label || null;
                  const callTime  = formatLocalTime(message.created_at);

                  // missed = red arrow, answered = green arrow, declined = orange
                  const iconBg = status === 'answered' ? '#1db954'
                    : status === 'declined' ? '#f59e0b' : '#e53935';

                  const callLabel = status === 'answered'
                    ? (duration ? `${duration}` : 'Answered')
                    : status === 'declined' ? 'Call declined' : 'Missed call';

                  return (
                    <div id={`msg-${message.id}`} key={message.id} className={`message-wrapper ${isMine ? 'mine' : 'theirs'} ${highlightedPinnedMessageId === message.id ? 'pinned-message-highlight' : ''}`}>
                      <div className="call-log-bubble">
                        {/* Icon circle */}
                        <div className="call-log-circle" style={{ background: iconBg }}>
                          {isVideo
                            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                            : <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                          }
                        </div>
                        {/* Text */}
                        <div className="call-log-text">
                          <span className="call-log-type">{isVideo ? 'Video call' : 'Audio call'}</span>
                          <span className="call-log-meta">
                            {callLabel}
                            {callTime && <> Γö¼Γòû {callTime}</>}
                          </span>
                        </div>
                        {/* Call again */}
                        <button
                          type="button"
                          className="call-log-again-btn"
                          onClick={() => initiateCall(
                            normalizeUserId(isMine ? message.receiver_id : message.sender_id),
                            activeChat,
                            isVideo,
                          )}
                          title={isVideo ? 'Video call again' : 'Call again'}
                        >
                          {isVideo
                            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                          }
                          Call again
                        </button>
                      </div>
                    </div>
                  );
                }
                // ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç


                let contentToShow = message.content;
                const actualAttachmentType = decryptedAttachmentUrls[message.id]?.type || (message.attachment_type?.replace('e2e-file:', '') || '');
                const messageAttachmentUrl = typeof message.attachment_url === 'string' ? message.attachment_url : '';
                const isImageOrVideo = messageAttachmentUrl && (actualAttachmentType.startsWith('image/') || actualAttachmentType.startsWith('video/'));
                const isAudioAttachment = messageAttachmentUrl && (actualAttachmentType.startsWith('audio/') || messageAttachmentUrl.endsWith('.webm'));

                if (isImageOrVideo && contentToShow) {
                  const fileExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.webm'];
                  const lowerContent = contentToShow.toLowerCase();
                  if (fileExts.some(ext => lowerContent.endsWith(ext)) && contentToShow.length < 100 && !contentToShow.includes('\n')) {
                     contentToShow = '';
                  }
                }

                if (isAudioAttachment && contentToShow) {
                  const lowerContent = contentToShow.toLowerCase();
                  if (lowerContent === 'voice message' || lowerContent.endsWith('.webm')) {
                    contentToShow = '';
                  }
                }

                const isMediaOnly = message.attachment_url && (actualAttachmentType.startsWith('image/') || actualAttachmentType === 'image/gif') && !contentToShow && !message.is_forwarded && !message.reply_preview;

                return (
                  <div
                    id={`msg-${message.id}`}
                    key={message.client_id || message.id}
                    className={`message-wrapper ${isMine ? 'mine' : 'theirs'} ${!isMine && !isAudioAttachment ? 'with-sender-avatar' : ''} ${highlightedPinnedMessageId === message.id ? 'pinned-message-highlight' : ''} ${chatSearchResults.includes(message.id) ? 'chat-search-match' : ''} ${chatSearchResults[chatSearchIndex] === message.id ? 'current' : ''}`}
                  >
                    {!isMine && !isAudioAttachment && <img className="message-sender-avatar" src={senderAvatarSrc} alt="" />}
                    <div className={`message-shell ${openMenuId === message.id || reactionBarId === message.id ? 'controls-open' : ''}`}>
                      <div className={`message-tools ${isMine ? 'mine' : 'theirs'}`}>
                        <button type="button" className="mini-action-btn" onPointerDown={(event) => event.preventDefault()} onClick={() => beginReply(message)} title="Reply">
                          <CornerUpLeft size={14} />
                        </button>
                        <button type="button" className={`mini-action-btn ${reactionBarId === message.id ? 'active' : ''}`} onPointerDown={(event) => event.preventDefault()} onClick={() => {
                          preserveChatScrollPosition();
                          setReactionBarId((prev) => {
                            const nextId = prev === message.id ? null : message.id;
                            if (nextId !== message.id) {
                              setReactionPickerMessageId(null);
                              setReactionPickerDirection('up');
                              setReactionSearchQuery('');
                            }
                            return nextId;
                          });
                        }} title="React">
                          <SmilePlus size={14} />
                        </button>
                        <button type="button" className={`mini-action-btn ${openMenuId === message.id ? 'active' : ''}`} onPointerDown={(event) => event.preventDefault()} onClick={(event) => toggleMessageMenu(message.id, event)} title="More">
                          <MoreVertical size={14} />
                        </button>
                      </div>

                      {reactionBarId === message.id && (
                        <div className={`reaction-strip ${isMine ? 'mine' : 'theirs'}`}>
                          {QUICK_REACTIONS.map((reaction) => (
                            <button
                              key={reaction}
                              type="button"
                              className={`reaction-option ${myReaction === reaction ? 'selected' : ''}`}
                              onClick={() => handleReaction(message, reaction)}
                              aria-label={getReactionName(reaction)}
                            >
                              <span className="reaction-emoji-glyph">{reaction}</span>
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`reaction-option reaction-plus-btn ${reactionPickerMessageId === message.id ? 'selected' : ''}`}
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              const pickerHeight = 360;
                              const buttonRect = event.currentTarget.getBoundingClientRect();
                              const chatRect = chatMessagesRef.current?.getBoundingClientRect();
                              const boundaryTop = chatRect?.top ?? 0;
                              const boundaryBottom = chatRect?.bottom ?? window.innerHeight;
                              const spaceAbove = buttonRect.top - boundaryTop;
                              const spaceBelow = boundaryBottom - buttonRect.bottom;
                              if (reactionPickerMessageId !== message.id) {
                                setReactionPickerDirection(spaceAbove < pickerHeight + 24 && spaceBelow > spaceAbove ? 'down' : 'up');
                              }
                              setReactionPickerMessageId((prev) => prev === message.id ? null : message.id);
                              setReactionSearchQuery('');
                            }}
                            aria-label="More reactions"
                          >
                            <Plus size={16} />
                          </button>

                          {reactionPickerMessageId === message.id && (
                            <div className={`reaction-picker-panel ${isMine ? 'mine' : 'theirs'} ${reactionPickerDirection}`}>
                              <label className="reaction-search-box">
                                <Search size={16} />
                                <input
                                  value={reactionSearchQuery}
                                  onChange={(event) => setReactionSearchQuery(event.target.value)}
                                  placeholder="Search emoji"
                                />
                              </label>

                              <div className="reaction-picker-groups">
                                {filteredReactionGroups.length > 0 ? (
                                  filteredReactionGroups.map((group) => (
                                    <section key={group.title} className="reaction-picker-group">
                                      <div className="reaction-picker-title">{group.title}</div>
                                      <div className="reaction-picker-grid">
                                        {group.items.map((item) => (
                                          <button
                                            key={`${group.title}-${item.emoji}`}
                                            type="button"
                                            className={`reaction-picker-emoji ${myReaction === item.emoji ? 'selected' : ''}`}
                                            onClick={() => handleReaction(message, item.emoji)}
                                            aria-label={item.name}
                                          >
                                            <span className="reaction-emoji-glyph">{item.emoji}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </section>
                                  ))
                                ) : (
                                  <div className="reaction-empty-state">No reactions found</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                        {openMenuId === message.id && (
                          <div className={`message-menu ${isMine ? 'mine' : 'theirs'} ${openMenuDirection}`}>
                            {isMine ? (
                              <>
                                <button type="button" className="message-menu-item" onClick={() => beginEdit(message)}>
                                  <Pencil size={14} /> {isAudioAttachment ? 'Rename voice' : 'Edit'}
                                </button>
                                <button type="button" className="message-menu-item danger" onClick={() => handleDeleteMessage(message, 'everyone')}>
                                  <Trash2 size={14} /> Unsend
                                </button>
                                <button type="button" className="message-menu-item" onClick={() => beginForward(message)}>
                                  <Forward size={14} /> Forward
                                </button>
                                {isAudioAttachment && (
                                  <button type="button" className="message-menu-item" onClick={() => {
                                    const a = document.createElement('a');
                                    a.href = decryptedAttachmentUrls[message.id]?.url || resolveMediaUrl(messageAttachmentUrl);
                                    let ext = 'wav';
                                    if (message.attachment_type) {
                                      if (message.attachment_type.includes('webm')) ext = 'webm';
                                      else if (message.attachment_type.includes('mp4')) ext = 'm4a';
                                      else if (message.attachment_type.includes('mpeg')) ext = 'mp3';
                                    }
                                    a.download = (message.content || 'voice-message').replace(/\.[^.]+$/, '') + '.' + ext;
                                    a.click();
                                  }}>
                                    <Download size={14} /> Download
                                  </button>
                                )}
                                <button type="button" className="message-menu-item" onClick={() => handleTogglePin(message)}>
                                  {message.is_pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}
                                </button>
                                <button type="button" className="message-menu-item danger" onClick={() => handleReportMessage(message)}>
                                  <Flag size={14} /> Report
                                </button>
                                <button type="button" className="message-menu-item danger" onClick={() => handleDeleteMessage(message, 'me')}>
                                  <Trash2 size={14} /> Delete for me
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="message-menu-item" onClick={() => beginForward(message)}>
                                  <Forward size={14} /> Forward
                                </button>
                                {isAudioAttachment && (
                                  <button type="button" className="message-menu-item" onClick={() => {
                                    const a = document.createElement('a');
                                    a.href = decryptedAttachmentUrls[message.id]?.url || resolveMediaUrl(messageAttachmentUrl);
                                    let ext = 'wav';
                                    if (message.attachment_type) {
                                      if (message.attachment_type.includes('webm')) ext = 'webm';
                                      else if (message.attachment_type.includes('mp4')) ext = 'm4a';
                                      else if (message.attachment_type.includes('mpeg')) ext = 'mp3';
                                    }
                                    a.download = (message.content || 'voice-message').replace(/\.[^.]+$/, '') + '.' + ext;
                                    a.click();
                                  }}>
                                    <Download size={14} /> Download
                                  </button>
                                )}
                                <button type="button" className="message-menu-item" onClick={() => handleTogglePin(message)}>
                                  {message.is_pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}
                                </button>
                                <button type="button" className="message-menu-item danger" onClick={() => handleDeleteMessage(message, 'me')}>
                                  <Trash2 size={14} /> Delete for me
                                </button>
                                <button type="button" className="message-menu-item danger" onClick={() => handleReportMessage(message)}>
                                  <Flag size={14} /> Report
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      <div className={`message-bubble ${isMediaOnly ? 'media-only' : ''}`} style={isAudioAttachment ? { '--message-mine-bg': '#dcf8c6', '--message-theirs-bg': '#fff', background: isMine ? '#dcf8c6' : '#fff', color: '#000' } : {}}>
                        {message.is_forwarded && (
                          <div className="message-flag">
                            <Forward size={12} /> Forwarded message
                          </div>
                        )}

                        {message.reply_preview && (
                          <div className="reply-preview">
                            <div className="reply-author">{message.reply_preview.sender_name || 'Reply'}</div>
                            <div className="reply-text">{message.reply_preview.content}</div>
                          </div>
                        )}

                        {renderAttachment(message)}

                        {contentToShow && <MessageWithLinks content={contentToShow} renderText={renderMessageContent} />}

                        <span className="message-time" style={isAudioAttachment ? { color: 'rgba(0,0,0,0.5)' } : {}}>
                          {formatLocalTime(message.created_at)}
                          {message.is_edited ? ' | edited' : ''}
                          {isMine && (
                            <span className="status-icon">
                              {message.is_pending ? (
                                <Clock size={10} style={{ marginLeft: '4px', opacity: 0.7 }} />
                              ) : (
                                <Check size={10} style={{ marginLeft: '4px', color: '#34b7f1' }} />
                              )}
                            </span>
                          )}
                        </span>
                      </div>

                      {messageReactions.length > 0 && (
                        <div className={`message-reactions ${isMine ? 'mine' : 'theirs'}`}>
                          {messageReactions.map((reaction) => (
                            <button
                              key={`${message.id}-${reaction.reaction}`}
                              type="button"
                              className={`reaction-pill ${reaction.reacted_by_me ? 'mine' : ''}`}
                              onClick={() => handleReaction(message, reaction.reaction)}
                            >
                              <span>{reaction.reaction}</span>
                              <span>{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {showScrollDown && (
              <button
                type="button"
                className="scroll-bottom-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => scrollToLatest('smooth')}
                aria-label="Scroll to latest message"
                title="Scroll to latest message"
              >
                <ChevronDown size={22} strokeWidth={2.6} />
                {unreadCountInScroll > 0 && (
                  <span className="scroll-unread-badge">{unreadCountInScroll}</span>
                )}
              </button>
            )}

            {(() => {
              const lastMessage = messages[messages.length - 1];
              const repliesDisabled = lastMessage && lastMessage.is_broadcast === 1 && lastMessage.allow_reply === 0;
              if (repliesDisabled) {
                return (
                  <div className="replies-disabled-banner" style={{
                    width: '100%',
                    padding: '0.9rem 1.25rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '12px',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '0.88rem',
                    fontStyle: 'italic',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    margin: '10px 0'
                  }}>
                    <Megaphone size={16} style={{ color: '#a78bfa' }} />
                    <span>Replies are disabled for this announcement</span>
                  </div>
                );
              }
              return (
                <form className="chat-input-area" onSubmit={submitMessage}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(replyToMessage || editingMessage) && (
                  <div className="composer-banner">
                    <div>
                      <strong>
                        {editingMessage ? 'Editing message' : 'Replying to message'}
                      </strong>
                  <div className="composer-banner-text">
                        {editingMessage
                          ? editingMessage.content
                          : replyToMessage
                            ? replyToMessage.content
                            : ''}
                      </div>
                    </div>
                    <button type="button" className="icon-btn" onClick={resetComposerContext}>
                      <X size={16} />
                    </button>
                  </div>
                )}

                <div className={`composer-preview-slot ${attachedFiles.length > 0 ? 'has-attachment' : ''}`} style={{ display: 'none' }}>
                  {/* Deprecated external attachment view - hidden but kept for reference */}
                </div>

                <div className="input-row fb-messenger-style">
                  {/* Left icon cluster */}
                  {isRecording ? null : (!newMessage.trim() && attachedFiles.length === 0) ? (
                    <div className="fb-icons-left">
                      <button type="button" className="fb-icon-btn" title="Voice message" onClick={startRecording}>
                        <Mic size={20} />
                      </button>
                      <button type="button" className="fb-icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach photo">
                        <ImageIcon size={20} />
                      </button>
                      {/* Sticker and GIF buttons removed per request */}
                      {gifPickerOpen && (
                        <div style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: '0px', zIndex: 50 }}>
                          <GifPicker onSelect={sendGifMessage} onClose={() => setGifPickerOpen(false)} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="fb-icons-left" style={{ position: 'relative' }}>
                      <button 
                        type="button" 
                        className="fb-icon-btn collapse-btn" 
                        style={{ background: '#0084ff', color: 'white', width: '28px', height: '28px', marginLeft: '4px' }} 
                        onClick={() => {
                          setIsPlusMenuOpen(!isPlusMenuOpen);
                        }}
                      >
                        {isPlusMenuOpen ? <X size={20} strokeWidth={3} /> : <Plus size={20} strokeWidth={3} />}
                      </button>
                      
                      {isPlusMenuOpen && !isRecording && (
                        <div className="fb-plus-menu" style={{
                          position: 'absolute',
                          bottom: '40px',
                          left: '0px',
                          background: 'var(--bg-panel)',
                          borderRadius: '12px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          border: '1px solid var(--border-color)',
                          padding: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          zIndex: 100,
                          width: '240px'
                        }}>
                          <button type="button" className="fb-plus-menu-item" onClick={() => { startRecording(); setIsPlusMenuOpen(false); }}>
                            <Mic size={20} color="#0084ff" />
                            <span>Send a voice clip</span>
                          </button>
                          <button type="button" className="fb-plus-menu-item" onClick={() => { fileInputRef.current?.click(); setIsPlusMenuOpen(false); }}>
                            <ImageIcon size={20} color="#0084ff" />
                            <span>Attach a file up to 100 MB</span>
                          </button>
                          <button type="button" className="fb-plus-menu-item" onClick={() => setIsPlusMenuOpen(false)}>
                            <Sticker size={20} color="#0084ff" />
                            <span>Choose a sticker</span>
                          </button>
                          <button type="button" className="fb-plus-menu-item" onClick={() => { setIsPlusMenuOpen(false); setGifPickerOpen(true); }}>
                            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#0084ff', background: 'rgba(0,132,255,0.1)', padding: '2px 4px', borderRadius: '4px' }}>GIF</span>
                            <span>Choose a GIF</span>
                          </button>
                        </div>
                      )}
                      {gifPickerOpen && !isRecording && (
                        <div style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: '0px', zIndex: 50 }}>
                          <GifPicker onSelect={sendGifMessage} onClose={() => setGifPickerOpen(false)} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Text input / Recording UI */}
                  <div className="chat-composer fb-input-wrapper">
                    {isRecording ? (
                      <div className={`recording-state whatsapp-voice-recorder ${isRecordingPaused ? 'paused' : ''} ${recordingPreviewUrl ? 'has-preview' : ''}`}>
                        {recordingPreviewUrl && (
                          <audio
                            ref={recordingPreviewAudioRef}
                            src={recordingPreviewUrl}
                            preload="auto"
                            onPlay={handlePreviewAudioPlay}
                            onPause={handlePreviewAudioStop}
                            onEnded={handlePreviewAudioStop}
                            onError={() => {
                              setIsRecordingPreviewPlaying(false);
                              showModernAlert('Could not load this voice preview. Please record again.', 'Voice Preview Error');
                            }}
                            style={{ display: 'none' }}
                          />
                        )}
                        <button type="button" onClick={cancelRecording} className="recording-cancel" aria-label="Discard voice message">
                          <Trash2 size={18} />
                        </button>
                        <div className="recording-time-wrap">
                          <span className="recording-pulse" />
                          <span className="recording-time">{formatRecordingTime(recordingTime)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', flex: 1 }}>
                          <button type="button" onClick={toggleRecordingPause} className="recording-pause-btn" aria-label={isRecordingPaused ? 'Play voice preview' : 'Pause voice recording'}>
                            {isRecordingPaused && !isRecordingPreviewPlaying ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
                          </button>
                          <div className="recording-wave-container" style={{ flex: 'none' }}>
                            <div className="recording-wave" aria-hidden="true">
                              {VOICE_WAVE_BARS.map((height, index) => {
                                const normalizedLevel = isRecordingPaused ? 0 : recordingLevel;
                                const previewPeak = recordingPreviewPeaks[index] || 0.18;
                                const previewActiveIndex = Math.floor(recordingPlaybackProgress * (VOICE_WAVE_BARS.length - 1));
                                const previewProximity = isRecordingPreviewPlaying
                                  ? Math.max(0, 1 - Math.abs(index - previewActiveIndex) / 4)
                                  : 0;
                                const ripple = normalizedLevel > 0.03 ? 0.72 + (Math.sin(recordingWaveTick * 0.28 + index) * 0.18) : 0.35;
                                const liveHeight = Math.max(4, Math.round((height - 4) * (0.38 + normalizedLevel * ripple) + 4));
                                const previewHeight = Math.max(4, Math.round((height - 4) * (0.28 + previewPeak * (0.62 + previewProximity * 0.32)) + 4));
                                const reactiveHeight = isRecordingPaused ? previewHeight : liveHeight;
                                const isActive = isRecordingPaused ? index <= previewActiveIndex && isRecordingPreviewPlaying : normalizedLevel > 0.03;
                                return (
                                  <span
                                    key={`recording-bar-${index}`}
                                    className={isActive ? 'active' : ''}
                                    style={{
                                      height: `${reactiveHeight}px`,
                                      opacity: isRecordingPaused ? 0.42 + previewPeak * 0.44 + previewProximity * 0.14 : 0.35 + normalizedLevel * 0.65,
                                    }}
                                  />
                                );
                              })}
                              {isRecordingPaused && (
                                <>
                                  <div className="recording-wave-dot" style={{ left: `${recordingPlaybackProgress * 100}%` }} />
                                  <input
                                    type="range"
                                    className="recording-wave-slider"
                                    min="0"
                                    max="100"
                                    value={recordingPlaybackProgress * 100}
                                    onChange={(e) => {
                                      const val = Number(e.target.value) / 100;
                                      setRecordingPlaybackProgress(val);
                                      if (recordingPreviewAudioRef.current) {
                                        const dur = recordingPreviewDurationRef.current || recordingTime || (recordingPreviewAudioRef.current.duration !== Infinity ? recordingPreviewAudioRef.current.duration : 0) || 1;
                                        recordingPreviewAudioRef.current.currentTime = val * dur;
                                      }
                                    }}
                                    aria-label="Seek voice preview"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="fb-input-inner">
                        {attachedFiles.length > 0 && (
                          <div className="fb-attachment-preview-row">
                            {/* Add More Files Button */}
                            <div className="fb-add-more-sticky">
                              <div className="fb-attachment-thumbnail-wrapper fb-add-more-wrapper" style={{ width: '48px', height: '48px', flexShrink: 0 }}>
                                <div
                                  className="fb-attachment-thumbnail fb-add-more-btn"
                                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'var(--hover-bg, #f0f2f5)',
                                    cursor: 'pointer',
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '12px',
                                    transition: 'background 0.2s ease',
                                  }}
                                  title="Add more files"
                                >
                                  <CopyPlus size={20} color="var(--text-primary)" strokeWidth={2.5} />
                                </div>
                              </div>
                            </div>

                            {attachedFiles.map((att) => (
                              <div key={att.id || Math.random().toString()} className={`fb-attachment-thumbnail-wrapper ${att.isRemoving ? 'fb-attachment-removing' : ''}`}>
                                <div className="fb-attachment-thumbnail">
                                  {renderPendingAttachmentPreview(att)}
                                </div>
                                {!att.isRemoving && (
                                  <button type="button" className="fb-attachment-close" onClick={() => removeAttachment(att.id)}>
                                    <X size={12} strokeWidth={3} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <input
                            ref={messageInputRef}
                            type="text"
                            placeholder={editingMessage ? 'Update your message...' : 'Aa'}
                            className="fb-input"
                            value={newMessage}
                            onChange={(event) => setNewMessage(event.target.value)}
                          />
                          
                          <div className="emoji-composer fb-emoji-wrapper">
                            <button
                              type="button"
                              className={`fb-emoji-btn ${emojiPickerOpen ? 'active' : ''}`}
                              onClick={() => setEmojiPickerOpen((prev) => !prev)}
                              aria-label="Open emoji picker"
                            >
                              <Smile size={20} />
                            </button>
                            {emojiPickerOpen && (
                              <div className="fb-emoji-picker-container" style={{ position: 'absolute', bottom: 'calc(100% + 15px)', right: '-10px', zIndex: 50, willChange: 'transform' }}>
                                <NativeEmojiPicker
                                  onEmojiSelect={(emojiData) => insertEmoji(emojiData.native)}
                                  theme={document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right side action */}
                  <div className="composer-action fb-icons-right">
                    {isRecording ? (
                      <button type="button" className="fb-icon-btn send voice-send-btn" onClick={isRecordingPaused ? sendRecordingPreview : () => stopRecording(true)} disabled={isSendingVoice} aria-label="Send voice message">
                        {isSendingVoice ? <Loader size={20} className="spin" /> : <SendHorizontal size={24} fill="currentColor" />}
                      </button>
                    ) : newMessage.trim() || attachedFiles.length > 0 ? (
                      <button type="submit" className="fb-icon-btn send">
                        <SendHorizontal size={24} fill="currentColor" />
                      </button>
                    ) : (
                      <button type="button" className="fb-icon-btn heart" onClick={handleSendQuickEmoji} aria-label={`Send ${activeChatQuickEmoji}`}>
                        <span className="quick-chat-emoji">{activeChatQuickEmoji}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
              );
            })()}

          </>
        ) : (
          <div className="empty-chat-state text-center text-muted">
            <Send size={48} style={{ opacity: 0.2, margin: '0 auto 1.5rem auto' }} />
            <h2 className="font-display text-primary">Your Inbox</h2>
            <p>Select a conversation from the sidebar or start a new one.</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setUserSearch('');
                setUserResults([]);
                setComposerMode('new');
              }}
            >
              <UserPlus size={16} /> New message
            </button>
          </div>
        )}
      </div>

      <aside className={`chat-details-panel glass-panel ${(!activeChat || !showChatInfoPanel) ? 'collapsed' : ''}`} style={(!activeChat || !showChatInfoPanel) ? { flexShrink: 0, overflow: 'hidden' } : { width: 300, flexShrink: 0 }}>
        {activeChat && (
          chatSearchOpen ? (
            <div className="chat-details-search-view">
              <div className="chat-details-search-header">
                <button
                  className="chat-search-back-btn"
                  onClick={() => setChatSearchOpen(false)}
                  title="Back to Chat Info"
                >
                  <ArrowLeft size={20} />
                </button>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Search</h3>
                <div style={{ width: 32 }}></div>
              </div>
              <div className="chat-details-search-input-wrapper">
                <Search size={15} className="chat-details-search-icon" />
                <input
                  ref={chatSearchInputRef}
                  value={chatSearchQuery}
                  onChange={(event) => setChatSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      moveChatSearch(event.shiftKey ? -1 : 1);
                    }
                    if (event.key === 'Escape') {
                      setChatSearchOpen(false);
                    }
                  }}
                  placeholder="Search in conversation"
                />
                {chatSearchQuery && (
                  <div className="chat-details-search-actions">
                    <span className="chat-search-count-small">
                      {chatSearchResults.length ? `${chatSearchResults.length} results` : '0 results'}
                    </span>
                    <button type="button" onClick={() => { setChatSearchQuery(''); setChatSearchIndex(0); chatSearchInputRef.current?.focus(); }} className="clear-search-btn">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
              
              <div className="chat-details-search-results custom-scrollbar">
                {chatSearchQuery.trim() && chatSearchResults.length > 0 && chatSearchResults.map((messageId, idx) => {
                  const msg = messages.find(m => m.id === messageId);
                  if (!msg) return null;
                  const isMine = normalizeUserId(msg.sender_id) === normalizeUserId(currentUser.id);
                  const sender = isMine ? currentUser : activeChat;
                  
                  const content = msg.content || '';
                  const query = chatSearchQuery.trim();
                  const parts = content.split(new RegExp('(' + query + ')', 'gi'));
                  
                  return (
                    <div 
                      key={`search-res-${messageId}`} 
                      className={`search-result-item ${chatSearchIndex === idx ? 'active' : ''}`}
                      onClick={() => {
                        setChatSearchIndex(idx);
                        scrollToChatSearchResult(messageId);
                      }}
                    >
                      <div className="search-result-avatar">
                        {sender.profile_picture ? (
                          <img src={resolveMediaUrl(sender.profile_picture)} alt="" />
                        ) : (
                          <span>{sender.first_name?.[0] || 'U'}</span>
                        )}
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-name">{sender.first_name} {sender.last_name}</div>
                        <div className="search-result-snippet">
                          {parts.map((part, i) => 
                            part.toLowerCase() === query.toLowerCase() 
                              ? <strong key={i}>{part}</strong> 
                              : part
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {chatSearchQuery.trim() && chatSearchResults.length === 0 && (
                  <div className="empty-results">No messages found for "{chatSearchQuery}"</div>
                )}
              </div>
            </div>
          ) : (
          <>
            <div className="mobile-chat-details-header">
              <button
                className="hdr-icon-btn"
                onClick={() => setShowChatInfoPanel(false)}
                title="Close"
              >
                <X size={20} />
              </button>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Contact Info</h3>
              <div style={{ width: 32 }}></div> {/* Spacer for centering */}
            </div>
            <div className="chat-details-profile">
              <div className="chat-details-avatar" style={{ background: activeChat.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)' }}>
                {activeChat.profile_picture ? (
                  <img src={resolveMediaUrl(activeChat.profile_picture)} alt="" />
                ) : (
                  <span>{activeChat.first_name?.[0] || 'U'}</span>
                )}
              </div>
              <h3>{activeChat.first_name} {activeChat.last_name}</h3>
              <p>{activeChat.role}</p>
            </div>

            <div className="chat-details-actions">
              <button
                type="button"
                className="chat-details-action"
              onClick={() => {
                if (activeChat?.other_user_id) {
                  navigate(`/profile/${activeChat.other_user_id}`);
                }
              }}
              title="Profile"
            >
              <span><User size={18} /></span>
              Profile
            </button>
            <button
              type="button"
              className={`chat-details-action ${activeChatMuted ? 'active' : ''}`}
              onClick={toggleMuteActiveChat}
              title={activeChatMuted ? 'Unmute notifications' : 'Mute notifications'}
            >
              <span>{activeChatMuted ? <BellOff size={18} /> : <Bell size={18} />}</span>
              {activeChatMuted ? 'Muted' : 'Mute'}
            </button>
            <button
              type="button"
              className={`chat-details-action ${chatSearchOpen ? 'active' : ''}`}
              onClick={openChatSearch}
              title="Search in conversation"
            >
              <span><Search size={18} /></span>
              Search
            </button>
          </div>

          <div className="chat-details-section">
            <div className="chat-accordion">
              <button type="button" className="chat-accordion-header" onClick={() => setChatInfoAccordion(!chatInfoAccordion)}>
                <span>Chat info</span>
                {chatInfoAccordion ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
              </button>
              {chatInfoAccordion && (
                <div className="chat-accordion-content">
                  <button type="button" className="chat-details-row" onClick={() => setPinnedMessagesOpen(true)}>
                    <Pin size={16} />
                    View pinned messages
                  </button>
                </div>
              )}
            </div>

            <div className="chat-accordion">
              <button type="button" className="chat-accordion-header" onClick={() => setChatOptionsAccordion(!chatOptionsAccordion)}>
                <span>Chat options</span>
                {chatOptionsAccordion ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
              </button>
              {chatOptionsAccordion && (
                <div className="chat-accordion-content">
                  <button type="button" className="chat-details-row" onClick={() => setChatEmojiPickerOpen(true)}>
                    <span className="chat-details-row-emoji">{activeChatQuickEmoji}</span>
                    Change emoji
                  </button>
                </div>
              )}
            </div>

            <div className="chat-accordion">
              <button type="button" className="chat-accordion-header" onClick={() => setMediaAccordion(!mediaAccordion)}>
                <span>Media, files and links</span>
                {mediaAccordion ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
              </button>
              {mediaAccordion && (
                <div className="chat-accordion-content">
                  <div className="media-links-panel">
                    {/* Premium tab navigation */}
                    <div className="media-tabs-nav">
                      <button 
                        type="button" 
                        className={`media-tab-btn ${activeMediaTab === 'media' ? 'active' : ''}`}
                        onClick={() => setActiveMediaTab('media')}
                      >
                        Media
                      </button>
                      <button 
                        type="button" 
                        className={`media-tab-btn ${activeMediaTab === 'files' ? 'active' : ''}`}
                        onClick={() => setActiveMediaTab('files')}
                      >
                        Files
                      </button>
                      <button 
                        type="button" 
                        className={`media-tab-btn ${activeMediaTab === 'links' ? 'active' : ''}`}
                        onClick={() => setActiveMediaTab('links')}
                      >
                        Links
                      </button>
                    </div>

                    {/* Tab contents */}
                    <div className="media-tabs-content">
                      {activeMediaTab === 'media' && (
                        <div className="media-tab-pane">
                          {mediaFilesLinks.media.length > 0 ? (
                            <div className="media-gallery">
                              {mediaFilesLinks.media.map((item) => (
                                <button
                                  key={`media-${item.id}`}
                                  type="button"
                                  className="media-gallery-item"
                                  onClick={() => {
                                    if (item.type.startsWith('video/')) {
                                      window.open(item.url, '_blank', 'noopener,noreferrer');
                                      return;
                                    }
                                    setImageViewer({ src: item.url, alt: item.name, caption: item.name });
                                  }}
                                  title={item.name}
                                >
                                  {item.type.startsWith('video/') ? (
                                    <>
                                      <video src={`${item.url}#t=0.5`} muted playsInline preload="metadata" />
                                      <span className="media-tile-icon"><Video size={16} /></span>
                                    </>
                                  ) : (
                                    <img src={item.url} alt={item.name} />
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="empty-results media-links-empty">No media shared yet.</div>
                          )}
                        </div>
                      )}

                      {activeMediaTab === 'files' && (
                        <div className="media-tab-pane">
                          {mediaFilesLinks.files.length > 0 ? (
                            <div className="media-link-list">
                              {mediaFilesLinks.files.map((item) => (
                                <div key={`file-${item.id}`} className="media-link-row">
                                  <button
                                    type="button"
                                    className="media-link-main"
                                    onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                                    title={item.name}
                                  >
                                    <span className="media-link-icon">
                                      {item.type.startsWith('audio/') ? <Mic size={16} /> : <FileText size={16} />}
                                    </span>
                                    <span className="media-link-copy">
                                      <span>{item.type.startsWith('audio/') ? 'Voice message' : item.name}</span>
                                      <small>{formatLocalTime(item.createdAt)}</small>
                                    </span>
                                  </button>
                                  <a className="media-link-download" href={item.url} download={item.name} title="Download">
                                    <Download size={15} />
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="empty-results media-links-empty">No files shared yet.</div>
                          )}
                        </div>
                      )}

                      {activeMediaTab === 'links' && (
                        <div className="media-tab-pane">
                          {mediaFilesLinks.links.length > 0 ? (
                            <div className="media-link-list">
                              {mediaFilesLinks.links.map((item) => (
                                <div key={`link-${item.id}`} className="media-link-row">
                                  <a
                                    className="media-link-main"
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={item.url}
                                  >
                                    <span className="media-link-icon"><LinkIcon size={16} /></span>
                                    <span className="media-link-copy">
                                      <span>{item.host}</span>
                                      <small>{item.url}</small>
                                    </span>
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="empty-results media-links-empty">No links shared yet.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
          )
      )}
    </aside>

      {chatEmojiPickerOpen && activeChat && createPortal((
        <div className="chat-emoji-modal-overlay" onClick={() => setChatEmojiPickerOpen(false)}>
          <div className="chat-emoji-modal" onClick={(event) => event.stopPropagation()}>
            <div className="chat-emoji-modal-header">
              <h3>Emoji</h3>
              <button type="button" className="chat-emoji-close" onClick={() => setChatEmojiPickerOpen(false)} aria-label="Close emoji picker">
                <X size={22} />
              </button>
            </div>
            <div className="chat-emoji-current-row">
              <div>
                <span>Current emoji</span>
                <strong>{activeChatQuickEmoji}</strong>
              </div>
              <button type="button" onClick={() => setActiveChatQuickEmoji(DEFAULT_CHAT_QUICK_EMOJI)}>
                <X size={16} />
                Remove
              </button>
            </div>
            <label className="chat-emoji-search">
              <Search size={17} />
              <input
                type="text"
                value={chatEmojiSearchQuery}
                onChange={(event) => setChatEmojiSearchQuery(event.target.value)}
                placeholder="Search emoji"
                autoFocus
              />
            </label>
            <div className="chat-emoji-groups custom-scrollbar">
              {filteredChatEmojiGroups.length > 0 ? (
                filteredChatEmojiGroups.map((group) => (
                  <section key={`chat-emoji-${group.title}`} className="chat-emoji-group">
                    <h4>{group.title}</h4>
                    <div className="chat-emoji-grid">
                      {group.items.map((item) => (
                        <button
                          key={`chat-emoji-${group.title}-${item.emoji}`}
                          type="button"
                          className={`chat-emoji-option ${activeChatQuickEmoji === item.emoji ? 'selected' : ''}`}
                          onClick={() => setActiveChatQuickEmoji(item.emoji)}
                          aria-label={item.name}
                        >
                          {item.emoji}
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="chat-emoji-empty">No emojis found</div>
              )}
            </div>
            <div className="chat-emoji-category-tabs">
              {[
                { label: 'Smileys & People', icon: Smile },
                { label: 'Your reactions', icon: Heart },
                { label: 'Gestures', icon: Sticker },
                { label: 'Symbols', icon: Hash },
              ].map(({ label, icon: Icon }) => (
                <button
                  key={`chat-emoji-tab-${label}`}
                  type="button"
                  className={`chat-emoji-category-tab ${chatEmojiCategory === label && !chatEmojiSearchQuery.trim() ? 'active' : ''}`}
                  onClick={() => {
                    setChatEmojiCategory(label);
                    setChatEmojiSearchQuery('');
                  }}
                  aria-label={label}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      ), document.body)}

      {pinnedMessagesOpen && activeChat && createPortal((
        <div className="pinned-modal-overlay" onClick={() => { setPinnedMessagesOpen(false); setPinnedMessageMenuId(null); }}>
          <div className="pinned-modal" onClick={(event) => { event.stopPropagation(); setPinnedMessageMenuId(null); }}>
            <div className="pinned-modal-header">
              <h3>Pinned messages</h3>
              <button type="button" className="pinned-modal-close" onClick={() => { setPinnedMessagesOpen(false); setPinnedMessageMenuId(null); }} aria-label="Close pinned messages">
                <X size={22} />
              </button>
            </div>
            <div className="pinned-modal-list custom-scrollbar">
              {pinnedMessages.length > 0 ? (
                pinnedMessages.map((message) => {
                  const isMine = normalizeUserId(message.sender_id) === normalizeUserId(currentUser?.id);
                  const avatarSrc = isMine
                    ? (currentUser?.profile_picture ? resolveMediaUrl(currentUser.profile_picture) : `${import.meta.env.BASE_URL}avatars/male1.png`)
                    : (activeChat.profile_picture ? resolveMediaUrl(activeChat.profile_picture) : `${import.meta.env.BASE_URL}avatars/male1.png`);

                  return (
                    <div key={`pinned-${message.id}`} className={`pinned-message-item ${isMine ? 'mine' : 'theirs'} ${pinnedMessageMenuId === message.id ? 'menu-open' : ''}`}>
                      <img className="pinned-message-avatar" src={avatarSrc} alt="" />
                      <div className="pinned-message-main">
                        <div className="pinned-message-meta">
                          <span>{getPinnedSenderLabel(message)}</span>
                          <time>{formatLocalTime(message.created_at)}</time>
                        </div>
                        <div className={`pinned-message-preview ${isMine ? 'mine' : 'theirs'}`}>
                          {getPinnedPreviewText(message)}
                        </div>
                      </div>
                      <div className="pinned-message-actions">
                        <button
                          type="button"
                          className={`pinned-message-more ${pinnedMessageMenuId === message.id ? 'active' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPinnedMessageMenuId((currentId) => currentId === message.id ? null : message.id);
                          }}
                          aria-label="Pinned message options"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {pinnedMessageMenuId === message.id && (
                          <div className="pinned-message-menu" onClick={(event) => event.stopPropagation()}>
                            <button type="button" onClick={() => showPinnedMessageInChat(message.id)}>
                              See in chat
                            </button>
                            <button type="button" onClick={() => handleTogglePin(message)}>
                              Unpin
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="pinned-empty-state">
                  <Pin size={26} />
                  <p>No pinned messages yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {composerMode && (
        <div className="compose-overlay" onClick={() => { setComposerMode(null); setForwardingMessage(null); }}>
          <div className="compose-modal glass-panel" onClick={(event) => event.stopPropagation()}>
            <div className="compose-header">
              <div>
                <h3 style={{ margin: 0 }}>{composerTitle}</h3>
                <p className="text-muted" style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem' }}>{composerDescription}</p>
              </div>
              <button className="icon-btn" onClick={() => { setComposerMode(null); setForwardingMessage(null); }}>
                <ArrowLeft size={18} />
              </button>
            </div>

            {composerMode === 'forward' && forwardingMessage && (
              <div className="forward-preview">
                <div className="message-flag">
                  <Forward size={12} /> Forwarding this message
                </div>
                <p>{forwardingMessage.content}</p>
              </div>
            )}

            <div className="compose-search">
              <Search size={16} className="text-muted" />
              <input
                type="text"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Try: admin, BFI01432017, 14, or a phone number"
              />
            </div>

            <div className="compose-results custom-scrollbar">
              {searchingUsers ? (
                <div className="empty-results">Searching users...</div>
              ) : userResults.length > 0 ? (
                [...userResults].sort((a, b) => {
                  const hasA = conversations.some(c => c.other_user_id === a.id);
                  const hasB = conversations.some(c => c.other_user_id === b.id);
                  return hasB - hasA;
                }).map((user) => (
                  <button
                    key={user.id}
                    className="user-result-card"
                    onClick={() => (composerMode === 'forward' ? forwardToUser(user) : startConversation(user))}
                  >
                    <div className="avatar chat-avatar" style={{ background: user.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)', position: 'relative' }}>
                      {user.profile_picture ? (
                        <img src={resolveMediaUrl(user.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                      )}
                      {onlineUsers?.has(String(user.id)) && (
                        <span className="online-dot" title="Online" />
                      )}
                    </div>
                    <div className="user-result-main">
                      <div className="user-result-title">
                        <strong>{user.first_name} {user.last_name}</strong>
                      </div>
                      <div className="user-meta-row" style={{ color: 'var(--text-muted)' }}>
                        {getRoleDisplayText(user.role, user.batch_number)}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-results">No users found yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmConfig && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay" onClick={() => setConfirmConfig(null)}>
          <div className="modern-modal-content glass-panel shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display">{confirmConfig.title}</h3>
              <button className="icon-btn-ghost" onClick={() => setConfirmConfig(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="modern-modal-body">
              <p>{confirmConfig.message}</p>
            </div>
            <div className="modern-modal-footer">
              {!confirmConfig.isAlert && (
                <button className="modern-btn modern-btn--secondary" onClick={() => setConfirmConfig(null)}>Cancel</button>
              )}
              <button 
                className={`modern-btn ${confirmConfig.type === 'danger' ? 'modern-btn--danger' : 'modern-btn--primary'}`}
                style={confirmConfig.isAlert ? { width: '100%', maxWidth: '200px', margin: '0 auto' } : {}}
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
              >
                {confirmConfig.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {quickBroadcastOpen && typeof document !== 'undefined' && createPortal(
        <div className="quick-broadcast-overlay" onClick={() => setQuickBroadcastOpen(false)}>
          <div className="quick-broadcast-modal" onClick={e => e.stopPropagation()}>
            <div className="quick-broadcast-header">
              <span className="quick-broadcast-title"><Megaphone size={16} /> Quick Send Broadcast</span>
              <button type="button" className="fb-icon-btn" onClick={() => setQuickBroadcastOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSendQuickBroadcast}>
              <div className="quick-broadcast-body" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Title *</label>
                  <input
                    type="text"
                    required
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text-primary)', padding: '0.65rem 0.9rem', fontSize: '0.9rem' }}
                    placeholder="Enter broadcast title..."
                    value={quickForm.title}
                    onChange={e => setQuickForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Message *</label>
                  <textarea
                    required
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text-primary)', padding: '0.65rem 0.9rem', fontSize: '0.9rem', minHeight: 120, resize: 'vertical' }}
                    placeholder="Enter broadcast message content..."
                    value={quickForm.message}
                    onChange={e => setQuickForm(f => ({ ...f, message: e.target.value }))}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Audience *</label>
                  <select
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text-primary)', padding: '0.65rem 0.9rem', fontSize: '0.9rem', cursor: 'pointer' }}
                    value={quickForm.audience_type}
                    onChange={e => setQuickForm(f => ({ ...f, audience_type: e.target.value, audience_value: '' }))}
                  >
                    <option value="all">All Students</option>
                    <option value="batch">Specific Batch</option>
                  </select>
                </div>
                {quickForm.audience_type === 'batch' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Select Batch *</label>
                    <select
                      required
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text-primary)', padding: '0.65rem 0.9rem', fontSize: '0.9rem', cursor: 'pointer' }}
                      value={quickForm.audience_value}
                      onChange={e => setQuickForm(f => ({ ...f, audience_value: e.target.value }))}
                    >
                      <option value="">Choose batch...</option>
                      {batches.map(b => (
                        <option key={b.id} value={b.batch_number}>{b.batch_name || `${b.batch_number}th Batch`}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Priority</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setQuickForm(f => ({ ...f, priority: 'normal' }))}
                      style={{ flex: 1, padding: '0.55rem', border: '1px solid', borderRadius: 10, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.2s', ...(quickForm.priority === 'normal' ? { background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#34d399' } : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }) }}
                    >
                      Normal
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickForm(f => ({ ...f, priority: 'urgent' }))}
                      style={{ flex: 1, padding: '0.55rem', border: '1px solid', borderRadius: 10, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.2s', ...(quickForm.priority === 'urgent' ? { background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' } : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }) }}
                    >
                      🚨 Urgent
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Allow Reply</span>
                    <small style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Students can reply to this message</small>
                  </div>
                  <label className="bc-toggle" style={{ position: 'relative', width: 44, height: 24, flexShrink: 0 }}>
                    <input type="checkbox" checked={quickForm.allow_reply} style={{ opacity: 0, width: 0, height: 0 }}
                      onChange={e => setQuickForm(f => ({ ...f, allow_reply: e.target.checked }))} />
                    <span className="bc-toggle-slider" style={{ position: 'absolute', inset: 0, background: quickForm.allow_reply ? '#7c3aed' : 'rgba(255,255,255,0.12)', borderRadius: 24, cursor: 'pointer', transition: 'background 0.25s' }} />
                    <span style={{ position: 'absolute', width: 18, height: 18, left: quickForm.allow_reply ? 23 : 3, top: 3, background: 'white', borderRadius: '50%', transition: 'transform 0.25s, left 0.25s', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
                  </label>
                </div>
              </div>
              <div className="quick-broadcast-footer" style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" className="modern-btn modern-btn--secondary" onClick={() => setQuickBroadcastOpen(false)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', borderRadius: 10, padding: '0.6rem 1.1rem', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
                <button type="submit" className="modern-btn modern-btn--primary" disabled={quickSending} style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)', border: 'none', color: 'white', borderRadius: 10, padding: '0.6rem 1.25rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {quickSending && <div className="bc-spinner" />} {quickSending ? 'Sending...' : '📣 Send Broadcast'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {imageViewer && typeof document !== 'undefined' && createPortal(
        <div className="image-viewer-overlay" onClick={() => setImageViewer(null)}>
          <div className="image-viewer-shell" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="icon-btn image-viewer-download" onClick={() => handleDownload(imageViewer.src)} title="Download image" aria-label="Download image">
              <Download size={18} />
            </button>
            <button type="button" className="icon-btn image-viewer-close" onClick={() => setImageViewer(null)} aria-label="Close image viewer">
              <X size={18} />
            </button>
            <img src={imageViewer.src} alt={imageViewer.alt} className="image-viewer-photo" />
            {imageViewer.caption && <div className="image-viewer-caption">{imageViewer.caption}</div>}
          </div>
        </div>,
        document.body
      )}

      {pdfViewer && typeof document !== 'undefined' && createPortal(
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem'
          }}
          onClick={() => setPdfViewer(null)}
        >
          <div 
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              padding: '1rem', 
              width: '100%', 
              boxSizing: 'border-box',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 100002
            }}
            onClick={e => e.stopPropagation()}
          >
            <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 600, marginLeft: '1rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '70%' }}>
              {pdfViewer.name}
            </span>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <a 
                href={pdfViewer.url} 
                download={pdfViewer.name} 
                style={{ 
                  background: 'rgba(255,255,255,0.12)', 
                  border: '1px solid rgba(255,255,255,0.18)', 
                  color: '#fff', 
                  borderRadius: '30px', 
                  padding: '0.5rem 1rem', 
                  fontSize: '0.8rem', 
                  fontWeight: 600, 
                  textDecoration: 'none', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  cursor: 'pointer' 
                }}
              >
                <Download size={16} /> Download
              </a>
              <button 
                onClick={() => setPdfViewer(null)} 
                style={{ 
                  background: 'rgba(255,255,255,0.12)', 
                  border: '1px solid rgba(255,255,255,0.18)', 
                  color: '#fff', 
                  borderRadius: '50%', 
                  width: '36px', 
                  height: '36px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  cursor: 'pointer' 
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <iframe 
            src={pdfViewer.url} 
            title={pdfViewer.name} 
            onClick={e => e.stopPropagation()}
            style={{ 
              width: '85%', 
              height: '80vh', 
              border: '1px solid rgba(255,255,255,0.15)', 
              borderRadius: '8px', 
              boxShadow: '0 24px 80px rgba(0,0,0,0.7)', 
              backgroundColor: '#323639',
              marginTop: '4rem'
            }} 
          />
        </div>,
        document.body
      )}

      
    </div>
  );
}
