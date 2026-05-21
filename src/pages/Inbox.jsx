import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { soundManager } from '../utils/AudioSynthesizer';

import SkeletonLoader from '../components/SkeletonLoader';
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

  // Smooth progress loop using requestAnimationFrame instead of timeupdate
  const updateProgressLoop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    const validAudioDur = (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration)) ? audio.duration : 0;
    const dur = durationRef.current || validAudioDur || 1;
    const cur = audio.currentTime;
    setCurrentTime(cur);
    setProgress(dur > 0 ? Math.min((cur / dur) * 100, 100) : 0);
    rafRef.current = requestAnimationFrame(updateProgressLoop);
  }, []);

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

export default function Inbox() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { initiateCall, onlineUsers } = useCall();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  
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
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [sidebarSearchResults, setSidebarSearchResults] = useState([]);
  const [searchingSidebarUsers, setSearchingSidebarUsers] = useState(false);
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
  const [showChatInfoPanel, setShowChatInfoPanel] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [chatInfoAccordion, setChatInfoAccordion] = useState(false);
  const [mediaAccordion, setMediaAccordion] = useState(false);
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
        if (msg.message_type === 'call_log' || msg.message_type === 'reaction') {
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

  useEffect(() => {
    fetchConversations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only update the activeChatRef here, keep previousChatIdRef for the scroll effect to compare
    activeChatRef.current = activeChat;
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
    const shouldStickToBottom = forceScrollToBottomRef.current || !showScrollDown || nearBottom || openedDifferentChat;

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
  }, [messages.length, activeChat?.other_user_id]);

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
          if (!response.ok) throw new Error(`Attachment fetch failed (${response.status})`);

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
      setActiveChat(chat);
      setMessages([]); // Clear previous messages to prevent blinking
      localStorage.setItem('inbox_last_active_chat', chat.other_user_id);
      setOpenMenuId(null);
      setReactionBarId(null);
      setEmojiPickerOpen(false);
      setChatSearchOpen(false);
      setChatSearchQuery('');
      setChatSearchIndex(0);
      setShowChatInfoPanel(false); // Always reset info panel when switching chats
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

  const handleFilePick = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const newFiles = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      previewUrl: ((file.type || '').startsWith('image/') || (file.type || '').startsWith('video/') || (file.type || '').startsWith('audio/')) ? URL.createObjectURL(file) : null
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
  const activeChatMuted = activeChatId != null && mutedChats.has(activeChatId);
  const pinnedMessages = useMemo(() => (
    messages
      .filter((message) => message.is_pinned && !message.deleted_for_everyone && message.message_type !== 'reaction')
      .sort((a, b) => getMessageSortTime(a.created_at) - getMessageSortTime(b.created_at))
  ), [messages]);
  const latestPinnedMessage = pinnedMessages[pinnedMessages.length - 1] || null;
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

    return { media, files, links };
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

  const openChatSearch = useCallback(() => {
    setChatSearchOpen(true);
    window.setTimeout(() => chatSearchInputRef.current?.focus(), 60);
  }, []);

  const moveChatSearch = useCallback((direction) => {
    if (!chatSearchResults.length) return;

    setChatSearchIndex((previousIndex) => {
      const nextIndex = (previousIndex + direction + chatSearchResults.length) % chatSearchResults.length;
      window.setTimeout(() => scrollToChatSearchResult(chatSearchResults[nextIndex]), 0);
      return nextIndex;
    });
  }, [chatSearchResults, scrollToChatSearchResult]);

  useEffect(() => {
    if (!chatSearchOpen || !chatSearchResults.length) return;
    scrollToChatSearchResult(chatSearchResults[chatSearchIndex] || chatSearchResults[0]);
  }, [chatSearchOpen, chatSearchResults, chatSearchIndex, scrollToChatSearchResult]);

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
      <div className="page-container container inbox-page" style={{ display: 'flex', paddingBottom: 0 }}>
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFilePick} />

      <div className={`inbox-sidebar glass-panel ${slideDirection === 'exit' ? 'slide-in-from-left' : ''}`} style={{ width: 320, flexShrink: 0 }}>
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
          <button className="new-msg-btn" onClick={() => setComposerMode('new')} title="New Message">
            <Pencil size={18} strokeWidth={3} />
          </button>
        </div>

        <div className="search-bar inbox-search">
          <SearchIcon size={16} className="text-muted" style={{ marginRight: '0.5rem' }} />
          <input
            type="text"
            placeholder="Search by name, username, ID, email, or phone..."
            value={sidebarQuery}
            onChange={(event) => setSidebarQuery(event.target.value)}
          />
        </div>

        <div className="chat-list custom-scrollbar">
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
                    const lm = chat.last_message || '';
                    const metaTime = chat.last_message_at ? ` · ${formatRelativeShortTime(chat.last_message_at)}` : '';
                    // If it looks like a reaction JSON, show a friendly label
                    if (lm.startsWith('{') && lm.includes('"type":"reaction"')) {
                      const reactionPreview = formatReactionPreview(lm, chat.last_message_sender_id, chat);
                      if (reactionPreview) return `${reactionPreview}${metaTime}`;
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
                  <span className="directory-badge">Directory</span>
                </div>
                <p className="chat-preview">
                  {[user.username && `@${user.username}`, user.email, user.student_id, user.mobile_number].filter(Boolean).join(' ╬ô├ç├│ ')}
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

            {chatSearchOpen && (
              <div className="chat-search-panel">
                <Search size={16} className="chat-search-panel-icon" />
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
                  placeholder={`Search in ${activeChat.first_name || 'this chat'}`}
                  aria-label="Search this conversation"
                />
                <span className="chat-search-count">
                  {chatSearchQuery.trim()
                    ? (chatSearchResults.length ? `${chatSearchIndex + 1}/${chatSearchResults.length}` : '0 results')
                    : 'Search messages'}
                </span>
                <button type="button" className="chat-search-nav-btn" onClick={() => moveChatSearch(-1)} disabled={!chatSearchResults.length} title="Previous match">
                  ╬ô├Ñ├ª
                </button>
                <button type="button" className="chat-search-nav-btn" onClick={() => moveChatSearch(1)} disabled={!chatSearchResults.length} title="Next match">
                  ╬ô├Ñ├┤
                </button>
                <button type="button" className="chat-search-close-btn" onClick={() => setChatSearchOpen(false)} title="Close search">
                  <X size={16} />
                </button>
              </div>
            )}

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
                      <button type="button" className="fb-icon-btn heart" onClick={handleSendHeart}>
                        <Heart size={24} fill="#ef4444" color="#ef4444" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>

          </>
        ) : (
          <div className="empty-chat-state text-center text-muted">
            <Send size={48} style={{ opacity: 0.2, margin: '0 auto 1.5rem auto' }} />
            <h2 className="font-display text-primary">Your Inbox</h2>
            <p>Select a conversation from the sidebar or start a new one.</p>
            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setComposerMode('new')}>
              <UserPlus size={16} /> New message
            </button>
          </div>
        )}
      </div>

      <aside className={`chat-details-panel glass-panel ${(!activeChat || !showChatInfoPanel) ? 'collapsed' : ''}`} style={(!activeChat || !showChatInfoPanel) ? { flexShrink: 0, overflow: 'hidden' } : { width: 300, flexShrink: 0 }}>
        {activeChat && (
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
              <button type="button" className="chat-accordion-header" onClick={() => setMediaAccordion(!mediaAccordion)}>
                <span>Media, files and links</span>
                {mediaAccordion ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
              </button>
              {mediaAccordion && (
                <div className="chat-accordion-content">
                  <div className="media-links-panel">
                    {mediaFilesLinks.media.length > 0 && (
                      <section className="media-links-section">
                        <h4>Media</h4>
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
                      </section>
                    )}

                    {mediaFilesLinks.files.length > 0 && (
                      <section className="media-links-section">
                        <h4>Files</h4>
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
                      </section>
                    )}

                    {mediaFilesLinks.links.length > 0 && (
                      <section className="media-links-section">
                        <h4>Links</h4>
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
                      </section>
                    )}

                    {!mediaFilesLinks.media.length && !mediaFilesLinks.files.length && !mediaFilesLinks.links.length && (
                      <div className="empty-results media-links-empty">No media, files or links yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </aside>

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
                        <span className="user-role-badge">{user.role}</span>
                      </div>
                      <div className="user-meta-row"><AtSign size={13} /> {user.username}</div>
                      <div className="user-meta-row"><Hash size={13} /> User ID: {user.id}</div>
                      {user.student_id && <div className="user-meta-row"><IdCard size={13} /> Student ID: {user.student_id}</div>}
                      {user.mobile_number && <div className="user-meta-row"><Phone size={13} /> {user.mobile_number}</div>}
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

      {imageViewer && typeof document !== 'undefined' && createPortal(
        <div className="image-viewer-overlay" onClick={() => setImageViewer(null)}>
          <div className="image-viewer-shell" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="icon-btn image-viewer-close" onClick={() => setImageViewer(null)} aria-label="Close image viewer">
              <X size={18} />
            </button>
            <img src={imageViewer.src} alt={imageViewer.alt} className="image-viewer-photo" />
            {imageViewer.caption && <div className="image-viewer-caption">{imageViewer.caption}</div>}
          </div>
        </div>,
        document.body
      )}

      <style>{`
        /* --- Modern Modal --- */
        .modern-modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: radial-gradient(circle at 10% 10%, rgba(96, 165, 250, 0.1) 0%, rgba(255, 255, 255, 0.02) 40%, transparent 70%), rgba(4, 5, 8, 0.78);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          z-index: 10000;
          padding: 2rem;
          animation: modalFadeIn 0.25s ease-out;
        }
        @keyframes modalFadeIn {
          from { opacity: 0; } to { opacity: 1; }
        }
        .modern-modal-content {
          position: relative;
          width: 100%;
          max-width: 440px;
          background-image: 
            /* 1. Film Reel Watermark SVG (top layer) */
            url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='50' cy='50' r='45' fill='none' stroke='%2360a5fa' stroke-width='2' stroke-opacity='0.08'/%3E%3Ccircle cx='50' cy='50' r='12' fill='none' stroke='%2360a5fa' stroke-width='2' stroke-opacity='0.08'/%3E%3Ccircle cx='50' cy='50' r='4' fill='none' stroke='%2360a5fa' stroke-width='2' stroke-opacity='0.08'/%3E%3Ccircle cx='50' cy='24' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='26' cy='41' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='35' cy='69' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='65' cy='69' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='74' cy='41' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3C/svg%3E"),
            /* 2. Radial spotlight from center-right, dark vignette at edges — velvet/suede felt style */
            radial-gradient(ellipse at 70% 40%, #fdfcf5 0%, #f2edd8 35%, #ddd6c0 65%, #c8c0a8 100%);
          background-size: 180px 180px, auto;
          background-position: bottom -30px right -30px, center;
          background-repeat: no-repeat, no-repeat;
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          overflow: hidden;
          animation: modalScaleIn 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25), inset 0 0 80px rgba(0,0,0,0.06);
          padding: 6px;
        }
        .modern-modal-content::before {
          content: '';
          position: absolute;
          top: 8px;
          left: 8px;
          right: 8px;
          bottom: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          pointer-events: none;
          z-index: 1;
        }
        /* Dense uniform velvet/suede grain texture overlay — high density fine noise like reference image */
        .modern-modal-content::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.09;
          pointer-events: none;
          z-index: 3;
        }
        [data-mode='dark'] .modern-modal-content {
          background-image: 
            /* 1. Film Reel Watermark SVG (top layer) */
            url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='50' cy='50' r='45' fill='none' stroke='%2360a5fa' stroke-width='2' stroke-opacity='0.08'/%3E%3Ccircle cx='50' cy='50' r='12' fill='none' stroke='%2360a5fa' stroke-width='2' stroke-opacity='0.08'/%3E%3Ccircle cx='50' cy='50' r='4' fill='none' stroke='%2360a5fa' stroke-width='2' stroke-opacity='0.08'/%3E%3Ccircle cx='50' cy='24' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='26' cy='41' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='35' cy='69' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='65' cy='69' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='74' cy='41' r='10' fill='none' stroke='%2360a5fa' stroke-width='1.5' stroke-opacity='0.06'/%3E%3C/svg%3E"),
            /* 2. Radial spotlight from center-right, deep vignette at edges — velvet dark felt style */
            radial-gradient(ellipse at 70% 40%, #1a5c43 0%, #0c3524 35%, #041a10 65%, #010806 100%);
          background-size: 180px 180px, auto;
          background-position: bottom -30px right -30px, center;
          background-repeat: no-repeat, no-repeat;
          border: 1px solid var(--glass-border);
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.8), inset 0 0 100px rgba(0, 0, 0, 0.4);
        }
        [data-mode='dark'] .modern-modal-content::after {
          opacity: 0.12;
        }
        [data-mode='dark'] .modern-modal-content::before {
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        @keyframes modalScaleIn {
          from { transform: scale(0.95) translateY(20px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        .modern-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 24px 18px;
          border-bottom: none !important;
          background: transparent;
          position: relative;
          z-index: 2;
        }
        /* Beautiful Golden Film Strip Sprocket Separator Line */
        .modern-modal-header::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 12px;
          right: 12px;
          height: 6px;
          background-image: repeating-linear-gradient(90deg, 
            rgba(255, 255, 255, 0.18) 0px, 
            rgba(255, 255, 255, 0.18) 4px, 
            transparent 4px, 
            transparent 10px
          );
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          pointer-events: none;
        }
        [data-mode='dark'] .modern-modal-header {
          border-bottom: none !important;
        }
        .modern-modal-header h3 {
          margin: 0;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          color: #082e23;
          display: flex;
          align-items: center;
        }
        .modern-modal-header h3::before {
          content: '';
          display: inline-block;
          width: 32px;
          height: 32px;
          background-image: url('/bfi-classroom/bfi-logo.jpg'), linear-gradient(135deg, #ffffff 0%, #fdfcf7 100%);
          background-size: contain, cover;
          background-repeat: no-repeat, no-repeat;
          background-position: center, center;
          background-blend-mode: multiply;
          margin-right: 12px;
          border-radius: 6px;
          flex-shrink: 0;
          padding: 3px;
          box-sizing: border-box;
          border: 1.5px solid rgba(255, 255, 255, 0.20);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.8);
        }
        [data-mode='dark'] .modern-modal-header h3 {
          color: #f7f4eb;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        /* Close button circular reset */
        .icon-btn-ghost {
          background: transparent !important;
          border: none !important;
          outline: none !important;
          color: #64748b !important;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50% !important;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
          padding: 0 !important;
          position: relative;
          z-index: 10;
        }
        .icon-btn-ghost:hover {
          background: rgba(96, 165, 250, 0.12) !important;
          color: #082e23 !important;
          transform: scale(1.05) rotate(90deg);
        }
        [data-mode='dark'] .icon-btn-ghost:hover {
          background: rgba(96, 165, 250, 0.12) !important;
          color: #f7f4eb !important;
        }

        .modern-modal-body {
          padding: 24px 28px;
          color: #1c2e24;
          font-family: Georgia, serif;
          font-size: 1.05rem;
          line-height: 1.65;
          letter-spacing: 0.01em;
          position: relative;
          z-index: 2;
        }
        [data-mode='dark'] .modern-modal-body {
          color: #cbd5e1;
        }
        .modern-modal-footer {
          padding: 16px 28px 20px;
          display: flex; gap: 14px; justify-content: flex-end;
          border-top: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(8, 46, 35, 0.02);
          position: relative;
          z-index: 2;
        }
        [data-mode='dark'] .modern-modal-footer {
          border-top: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(0, 0, 0, 0.35);
        }
        .modern-btn {
          padding: 10px 22px; border-radius: 6px;
          font-family: 'Playfair Display', Georgia, serif;
          text-transform: uppercase;
          font-weight: 700; font-size: 0.85rem;
          letter-spacing: 0.08em; cursor: pointer; border: none;
          transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .modern-btn--primary {
          background: #082e23;
          color: #fdfbf7;
          border: 1px solid #60a5fa;
          box-shadow: 0 4px 10px rgba(8, 46, 35, 0.15);
        }
        [data-mode='dark'] .modern-btn--primary {
          background: #051c15;
          color: #f7f4eb;
          border: 1px solid #60a5fa;
        }
        .modern-btn--primary:hover {
          background: #60a5fa !important;
          color: #051c15 !important;
          border-color: #60a5fa;
          box-shadow: 0 6px 16px rgba(96, 165, 250, 0.3);
        }
        .modern-btn--danger {
          background: #7a1c1c;
          color: #fdfbf7;
          border: 1px solid #60a5fa;
          box-shadow: 0 4px 10px rgba(122, 28, 28, 0.2);
        }
        .modern-btn--danger:hover {
          background: #60a5fa;
          color: #3a0808 !important;
          border-color: #60a5fa;
          box-shadow: 0 6px 16px rgba(96, 165, 250, 0.3);
        }
        .modern-btn--secondary {
          background: transparent; color: #082e23;
          border: 1px solid rgba(8, 46, 35, 0.35);
        }
        [data-mode='dark'] .modern-btn--secondary {
          background: transparent; color: #cbd5e1;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .modern-btn--secondary:hover {
          background: rgba(8, 46, 35, 0.06); color: #082e23;
          border-color: rgba(8, 46, 35, 0.6);
        }
        [data-mode='dark'] .modern-btn--secondary:hover {
          background: rgba(96, 165, 250, 0.08); color: #ffffff;
          border-color: rgba(255, 255, 255, 0.25);
        }
        .modern-btn:hover { transform: translateY(-2px); }
        .modern-btn:active { transform: translateY(0); }

        /* Current app modal style */
        .modern-modal-overlay {
          background: rgba(2, 6, 17, 0.74) !important;
          backdrop-filter: blur(10px) saturate(1.2) !important;
          -webkit-backdrop-filter: blur(10px) saturate(1.2) !important;
        }
        .modern-modal-content {
          padding: 0 !important;
          background-image:
            url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
            linear-gradient(160deg, rgba(8, 24, 44, 0.96) 0%, rgba(4, 13, 26, 0.98) 100%) !important;
          background-size: 256px 256px, auto !important;
          background-repeat: repeat, no-repeat !important;
          background-blend-mode: overlay, normal !important;
          border: 1px solid var(--glass-border) !important;
          border-radius: 14px !important;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
        }
        [data-mode="light"] .modern-modal-content {
          background-image: none !important;
          background: #ffffff !important;
          border-color: rgba(15, 23, 42, 0.12) !important;
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22) !important;
        }
        .modern-modal-content::before,
        .modern-modal-content::after,
        .modern-modal-header::after {
          display: none !important;
        }
        .modern-modal-header {
          padding: 20px 24px !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
          background: rgba(255, 255, 255, 0.02) !important;
        }
        [data-mode="light"] .modern-modal-header {
          background: #ffffff !important;
          border-bottom-color: rgba(15, 23, 42, 0.1) !important;
        }
        .modern-modal-header h3 {
          font-family: var(--font-display) !important;
          font-size: 1.18rem !important;
          letter-spacing: 0 !important;
          color: var(--text-primary) !important;
          text-shadow: none !important;
        }
        .modern-modal-header h3::before {
          border: 1px solid rgba(255, 255, 255, 0.10) !important;
          box-shadow: 0 6px 18px rgba(37, 99, 235, 0.24) !important;
        }
        .modern-modal-body {
          padding: 24px !important;
          color: var(--text-secondary) !important;
          font-family: var(--font-sans) !important;
          font-size: 0.95rem !important;
          line-height: 1.6 !important;
          letter-spacing: 0 !important;
        }
        .modern-modal-footer {
          padding: 16px 24px 22px !important;
          border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
          background: rgba(2, 6, 17, 0.22) !important;
        }
        [data-mode="light"] .modern-modal-footer {
          background: #f8fafc !important;
          border-top-color: rgba(15, 23, 42, 0.1) !important;
        }
        .modern-btn {
          border-radius: 8px !important;
          font-family: var(--font-sans) !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
        }
        .modern-btn--primary {
          background: var(--accent-primary) !important;
          color: #ffffff !important;
          border: 1px solid var(--accent-primary) !important;
          box-shadow: 0 10px 26px rgba(225, 29, 72, 0.24) !important;
        }
        .modern-btn--primary:hover {
          background: var(--accent-primary-hover) !important;
          color: #ffffff !important;
          border-color: var(--accent-primary-hover) !important;
        }
        .modern-btn--secondary {
          background: rgba(255, 255, 255, 0.04) !important;
          color: var(--text-primary) !important;
          border: 1px solid rgba(255, 255, 255, 0.10) !important;
        }
        [data-mode="light"] .modern-btn--secondary {
          background: #eef2f7 !important;
          border-color: rgba(15, 23, 42, 0.1) !important;
          color: #0f172a !important;
        }
        .modern-btn--danger {
          background: rgba(239, 68, 68, 0.12) !important;
          color: #fecaca !important;
          border: 1px solid rgba(239, 68, 68, 0.35) !important;
          box-shadow: none !important;
        }
        [data-mode="light"] .modern-btn--danger {
          background: #fff1f2 !important;
          color: #be123c !important;
          border-color: rgba(225, 29, 72, 0.28) !important;
        }

        /* --- Scroll Down Button --- */
        .scroll-bottom-btn {
          position: absolute;
          bottom: 104px;
          left: 50%;
          transform: translateX(-50%) translateY(0);
          width: 42px;
          height: 42px;
          padding: 0;
          border-radius: 50%;
          background: rgba(255,255,255,0.96);
          border: 1px solid rgba(15,23,42,0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #0084ff;
          cursor: pointer;
          z-index: 1000;
          box-shadow: 0 8px 24px rgba(0,0,0,0.22);
          transition: background 0.22s ease, color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          animation: slideUpScrollBtn 0.3s ease-out;
        }
        [data-mode="light"] .scroll-bottom-btn {
          background: rgba(255,255,255,0.98);
          border-color: rgba(15,23,42,0.08);
          box-shadow: 0 8px 22px rgba(15,23,42,0.16);
        }
        @keyframes slideUpScrollBtn {
          from { transform: translateX(-50%) translateY(30px) scale(0.6); opacity: 0; }
          to { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; }
        }
        .scroll-bottom-btn:hover {
          transform: translateX(-50%) translateY(-3px);
          background: #0084ff;
          color: white;
          border-color: transparent;
          box-shadow: 0 12px 32px rgba(0, 132, 255, 0.4);
        }
        .scroll-bottom-btn:active {
          transform: translateX(-50%) translateY(-1px) scale(0.98);
          transition-duration: 0.12s;
        }
        .scroll-unread-badge {
          position: absolute;
          top: -6px;
          right: -6px;
          background: #1877f2;
          color: white;
          font-size: 0.7rem;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 12px;
          min-width: 20px;
          border: 2px solid var(--bg-primary);
        }

        /* ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Inbox Page Layout Fix ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç */
        html, body {
          overflow: hidden !important;
          /* Prevent browser back/forward swipe gestures on the inbox page */
          overscroll-behavior-x: none !important;
        }
        .main-content {
          height: 100vh !important;
          min-height: 0 !important;
          padding-bottom: 0 !important;
          display: flex;
          flex-direction: column;
          overscroll-behavior: contain;
        }
        .inbox-page.page-container {
          flex: 1;
          height: 100% !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: hidden !important;
          padding-top: 1rem !important;
          /* Prevent ANY horizontal overscroll ╬ô├ç├╢ stops browser back-gesture */
          overscroll-behavior-x: none;
          touch-action: pan-y pinch-zoom;
        }
        @media (max-width: 1024px) {
          .main-content {
            position: fixed !important;
            top: 0 !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            margin-left: 0 !important;
            height: auto !important;
            padding-top: 4rem !important;
            box-sizing: border-box !important;
            z-index: 10;
            overscroll-behavior: none;
          }
          .inbox-page.page-container {
            padding-top: 0 !important;
            touch-action: pan-y pinch-zoom;
          }
        }

        /* ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Mobile Slide Transitions ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç */
        @keyframes slideInFromRight {
          0%   { transform: translateX(100%); opacity: 0.6; }
          100% { transform: translateX(0);    opacity: 1; }
        }
        @keyframes slideOutToRight {
          0%   { transform: translateX(0);    opacity: 1; }
          100% { transform: translateX(100%); opacity: 0.4; }
        }
        @keyframes slideInFromLeft {
          0%   { transform: translateX(-30%); opacity: 0.6; }
          100% { transform: translateX(0);     opacity: 1; }
        }

        @media (max-width: 1024px) {
          .inbox-main.slide-in-from-right {
            animation: slideInFromRight 0.28s cubic-bezier(0.25, 0.8, 0.25, 1) none;
          }
          .inbox-main.slide-out-to-right {
            animation: slideOutToRight 0.22s cubic-bezier(0.25, 0.8, 0.25, 1) forwards;
          }
          .inbox-sidebar.slide-in-from-left {
            animation: slideInFromLeft 0.22s cubic-bezier(0.25, 0.8, 0.25, 1) none;
          }
        }

        /* ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Swipe Back Visual Indicator ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç */
        .swipe-back-indicator {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          width: 56px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          z-index: 200;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }
        .swipe-back-chevron {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 4px 18px rgba(59, 130, 246, 0.45);
          animation: swipeChevronPulse 0.8s ease-in-out infinite;
        }
        @keyframes swipeChevronPulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.12); }
        }
        .swipe-back-label {
          font-size: 0.65rem;
          font-weight: 600;
          color: rgba(255,255,255,0.8);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          white-space: nowrap;
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        /* ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Header Icon Buttons (uniform circles) ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç */
        .hdr-icon-btn {
          display: flex; align-items: center; justify-content: center;
          width: 38px; height: 38px;
          border-radius: 50%; border: none; cursor: pointer;
          transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), filter 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
          color: white;
          flex-shrink: 0;
        }
        .hdr-icon-btn:hover  { transform: translateY(-2px) scale(1.05); }
        .hdr-icon-btn:active { transform: scale(0.93); }
        .hdr-icon-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

        /* Audio call ╬ô├ç├╢ emerald */
        .hdr-icon-btn--call-audio {
          background: linear-gradient(135deg,#10b981,#059669);
          box-shadow: 0 4px 12px rgba(16,185,129,0.4);
        }
        .hdr-icon-btn--call-audio:hover { box-shadow: 0 6px 18px rgba(16,185,129,0.65); }

        /* Video call ╬ô├ç├╢ indigo */
        .hdr-icon-btn--call-video {
          background: linear-gradient(135deg,#6366f1,#4f46e5);
          box-shadow: 0 4px 12px rgba(99,102,241,0.4);
        }
        .hdr-icon-btn--call-video:hover { box-shadow: 0 6px 18px rgba(99,102,241,0.65); }

        /* New Chat ╬ô├ç├╢ slate blue */
        .hdr-icon-btn--new {
          background: linear-gradient(135deg,#38bdf8,#0284c7);
          box-shadow: 0 4px 12px rgba(56,189,248,0.35);
        }
        .hdr-icon-btn--new:hover { box-shadow: 0 6px 18px rgba(56,189,248,0.6); }

        /* Delete Chat ╬ô├ç├╢ rose/red */
        .hdr-icon-btn--delete {
          background: linear-gradient(135deg,#f43f5e,#dc2626);
          box-shadow: 0 4px 12px rgba(244,63,94,0.35);
        }
        .hdr-icon-btn--delete:hover { box-shadow: 0 6px 18px rgba(244,63,94,0.6); }

        /* Chat Info ╬ô├ç├╢ blue */
        .hdr-icon-btn--info {
          background: linear-gradient(135deg,#3b82f6,#2563eb);
          box-shadow: 0 4px 12px rgba(59,130,246,0.35);
        }
        .hdr-icon-btn--info:hover { box-shadow: 0 6px 18px rgba(59,130,246,0.6); }
        .hdr-icon-btn--info.active {
          box-shadow: inset 0 3px 6px rgba(0,0,0,0.2);
          transform: scale(0.96);
        }

        /* Back button (mobile only) */
        .chat-back-btn {
          display: none;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.12);
          color: var(--text-secondary);
          -webkit-tap-highlight-color: transparent;
        }
        .chat-back-btn:hover { background: rgba(255,255,255,0.18); }
        .chat-back-btn:active { transform: scale(0.88); }

        @media (max-width: 1024px) {
          .chat-back-btn { display: flex; }
        }

        /* ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Messenger-style Call Log Bubble ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç */
        /* sits inside .message-wrapper so it's left/right aligned like messages */
        .call-log-bubble {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.10);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-radius: 18px;
          padding: 10px 14px 10px 10px;
          min-width: 200px;
          max-width: 280px;
          position: relative;
          flex-wrap: wrap;
          row-gap: 8px;
        }
        /* dark theme gets slightly lighter background */
        .dark .call-log-bubble {
          background: rgba(255,255,255,0.09);
        }
        .call-log-circle {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .call-log-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .call-log-type {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
        }
        .call-log-meta {
          font-size: 0.75rem;
          color: var(--text-secondary);
          line-height: 1.3;
        }
        .call-log-again-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          width: 100%;
          justify-content: center;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          color: var(--text-primary);
          font-size: 0.78rem;
          font-weight: 600;
          padding: 6px 0;
          cursor: pointer;
          transition: background 0.18s ease;
        }
        .call-log-again-btn:hover {
          background: rgba(255,255,255,0.20);
        }
        .new-msg-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          min-width: 40px;
          background: #0084ff;
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 10px rgba(0, 132, 255, 0.3);
        }
        .new-msg-btn:hover {
          background: #0073e6;
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(0, 132, 255, 0.4);
        }
        .new-msg-btn:active {
          transform: translateY(0) scale(0.96);
        }


        .inbox-sidebar {
          width: 320px;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--glass-border);
          flex-shrink: 0;
          border-radius: 16px 0 0 16px;
          min-height: 0;
          box-shadow: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
        }
        .inbox-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem 1.25rem;
          border-bottom: 1px solid var(--glass-border);
          gap: 1rem;
        }
        .inbox-header h2 {
          display: flex;
          align-items: center;
          font-size: 1.5rem;
          margin: 0;
          color: var(--text-primary);
        }
        .inbox-search {
          margin: 1rem;
          background: rgba(255,255,255,0.03);
          border-radius: 18px;
          display: flex;
          padding: 0.7rem 1rem;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .inbox-search input {
          background: transparent;
          border: none;
          color: var(--text-primary);
          flex: 1;
          outline: none;
        }
        .chat-list {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
          -webkit-overflow-scrolling: touch;
        }
        .chat-item {
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          cursor: pointer;
          width: 100%;
          border: none;
          color: inherit;
          text-align: left;
          background: transparent;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          transition: background 0.2s;
        }
        .chat-item:hover {
          background: rgba(255,255,255,0.03);
        }
        .chat-item.active {
          background: rgba(255,255,255,0.06);
          border-left: 3px solid var(--accent-primary);
        }
        .chat-item.unread {
          background: linear-gradient(90deg, rgba(239,68,68,0.12), rgba(255,255,255,0.02));
          border-left: 3px solid rgba(244,63,94,0.95);
          box-shadow: inset 0 0 0 1px rgba(244,63,94,0.08);
        }
        .chat-item-directory {
          border-left: 3px solid rgba(59,130,246,0.7);
          background: rgba(59,130,246,0.06);
        }
        .chat-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          flex-shrink: 0;
          position: relative;
        }
        .chat-avatar img {
          border-radius: 50%;
        }
        /* Smaller avatar in the active-chat header so it doesn't crowd the buttons */
        .chat-header .chat-avatar {
          width: 36px;
          height: 36px;
        }
        
        .online-dot {
          position: absolute;
          bottom: 0px;
          right: -2px;
          width: 14px;
          height: 14px;
          background: #31a24c;
          border-radius: 50%;
          border: 2.5px solid var(--bg-primary);
          z-index: 2;
        }
        .chat-header .online-dot {
          width: 12px;
          height: 12px;
          border-width: 2px;
          right: -1px;
        }
        .chat-info {
          flex: 1;
          min-width: 0;
        }
        .chat-name-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }
        .chat-name-row h4 {
          margin: 0;
          font-size: 1rem;
          color: var(--text-primary);
        }
        .chat-item.unread .chat-name-row h4,
        .chat-item.unread .chat-preview {
          font-weight: 700;
          color: #fff;
        }
        .chat-status-stack {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
        }
        .muted-chat-indicator {
          color: var(--text-secondary);
          opacity: 0.8;
          flex-shrink: 0;
        }
        .chat-item.muted .chat-preview {
          opacity: 0.72;
        }
        .new-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.14rem 0.48rem;
          border-radius: 999px;
          font-size: 0.68rem;
          font-weight: 700;
          background: rgba(244,63,94,0.18);
          color: #fda4af;
          border: 1px solid rgba(244,63,94,0.24);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .unread-badge {
          background: var(--danger);
          color: white;
          border-radius: 10px;
          padding: 0.1rem 0.4rem;
          font-size: 0.7rem;
          font-weight: bold;
        }
        .reaction-unread-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #1877f2;
          box-shadow: 0 0 0 3px rgba(24,119,242,0.12);
          flex-shrink: 0;
        }
        .directory-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.14rem 0.48rem;
          border-radius: 999px;
          font-size: 0.68rem;
          font-weight: 700;
          background: rgba(59,130,246,0.18);
          color: #bfdbfe;
          border: 1px solid rgba(59,130,246,0.28);
        }
        .chat-preview {
          font-size: 0.85rem;
          color: var(--text-secondary);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .inbox-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          flex-wrap: nowrap;
          border-radius: 0 16px 16px 0;
          border-left: none;
          min-height: 0;
          overflow: hidden;
          box-shadow: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          transition: border-radius 0.3s ease;
          background:
            radial-gradient(circle at top right, rgba(59,130,246,0.08), transparent 28%),
            linear-gradient(180deg, rgba(8,11,18,0.95), rgba(10,14,24,0.98));
          position: relative;
        }
        .inbox-main::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: url('/bfi-classroom/assets/images/chat_bg_film_unique.png');
          background-size: 400px;
          background-repeat: repeat;
          opacity: 0.2;
          pointer-events: none;
          z-index: 0;
          filter: invert(1);
          mix-blend-mode: screen;
        }
        [data-mode="light"] .inbox-main::before {
          filter: none;
          opacity: 0.25;
          mix-blend-mode: multiply;
        }
        .inbox-main.has-details-panel {
          border-radius: 0;
        }
        .chat-details-panel {
          width: 300px;
          flex-shrink: 0;
          border-left: 1px solid var(--glass-border);
          border-radius: 0 16px 16px 0;
          padding: 1.4rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 1.35rem;
          overflow-y: auto;
          overflow-x: hidden;
          background: rgba(8,11,18,0.88);
          box-shadow: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
                      padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                      opacity 0.2s ease,
                      border-left 0.3s ease;
        }
        .chat-details-panel.collapsed {
          width: 0;
          padding-left: 0;
          padding-right: 0;
          opacity: 0;
          border-left-width: 0;
          pointer-events: none;
        }
        .mobile-chat-details-header {
          display: none;
        }
        .chat-details-profile {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 0.4rem;
          padding: 0.25rem 0 0.6rem;
        }
        .chat-details-avatar {
          width: 78px;
          height: 78px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 2rem;
          font-weight: 800;
          overflow: hidden;
          box-shadow: 0 18px 40px rgba(0,0,0,0.22);
        }
        .chat-details-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .chat-details-profile h3 {
          margin: 0.45rem 0 0;
          font-size: 1rem;
          color: var(--text-primary);
        }
        .chat-details-profile p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 0.85rem;
          text-transform: capitalize;
        }
        .chat-details-actions {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.55rem;
        }
        .chat-details-action {
          border: none;
          background: transparent;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
        }
        .chat-details-action span {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
          transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }
        .chat-details-action:hover span,
        .chat-details-action.active span {
          background: rgba(59,130,246,0.16);
          color: #60a5fa;
          transform: translateY(-1px);
        }
        .chat-details-action.active {
          color: #60a5fa;
        }
        .chat-details-section {
          display: flex;
          flex-direction: column;
          padding: 0.4rem 0;
        }
        .chat-accordion {
          border-top: 1px solid var(--glass-border);
        }
        .chat-accordion:last-child {
          border-bottom: 1px solid var(--glass-border);
        }
        .chat-accordion-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: transparent;
          border: none;
          color: var(--text-primary);
          padding: 1.1rem 0.35rem;
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .chat-accordion-header:hover {
          background: rgba(255,255,255,0.03);
        }
        .chat-accordion-content {
          padding: 0 0.35rem 0.8rem 0.35rem;
        }
        .media-links-panel {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .media-links-section {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .media-links-section h4 {
          margin: 0;
          color: var(--text-secondary);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .media-gallery {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.35rem;
        }
        .media-gallery-item {
          position: relative;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 8px;
          background: rgba(148, 163, 184, 0.12);
          cursor: pointer;
          padding: 0;
        }
        .media-gallery-item img,
        .media-gallery-item video {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }
        .media-tile-icon {
          position: absolute;
          left: 50%;
          top: 50%;
          display: inline-flex;
          width: 2rem;
          height: 2rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: rgba(2, 6, 23, 0.7);
          color: #fff;
          transform: translate(-50%, -50%);
        }
        .media-link-list {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .media-link-row {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          min-width: 0;
        }
        .media-link-main {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 0.55rem;
          border: none;
          border-radius: 10px;
          background: rgba(148, 163, 184, 0.1);
          color: var(--text-primary);
          padding: 0.55rem;
          text-align: left;
          text-decoration: none;
          cursor: pointer;
        }
        .media-link-main:hover {
          background: rgba(59, 130, 246, 0.14);
        }
        .media-link-icon {
          flex: 0 0 auto;
          display: inline-flex;
          width: 2rem;
          height: 2rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: rgba(59, 130, 246, 0.16);
          color: #60a5fa;
        }
        .media-link-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }
        .media-link-copy span,
        .media-link-copy small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .media-link-copy span {
          font-size: 0.84rem;
          font-weight: 700;
        }
        .media-link-copy small {
          color: var(--text-secondary);
          font-size: 0.72rem;
        }
        .media-link-download {
          flex: 0 0 auto;
          display: inline-flex;
          width: 2.15rem;
          height: 2.15rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.12);
          color: var(--text-primary);
          text-decoration: none;
        }
        .media-link-download:hover {
          background: rgba(59, 130, 246, 0.18);
          color: #60a5fa;
        }
        .media-links-empty {
          padding: 0.65rem 0.5rem;
          font-size: 0.82rem;
          opacity: 0.72;
        }
        .chat-details-row {
          border: none;
          background: transparent;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          padding: 0.75rem 0.5rem;
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
        }
        .chat-details-row:hover {
          background: rgba(255,255,255,0.06);
        }

        
        [data-mode="light"] .chat-details-panel {
          background: #ffffff;
          border-left: 1px solid rgba(0,0,0,0.08);
        }
        [data-mode="light"] .chat-details-action span {
          background: rgba(0,0,0,0.04);
          color: #09090b;
        }
        [data-mode="light"] .chat-details-action:hover span,
        [data-mode="light"] .chat-details-action.active span {
          background: rgba(59,130,246,0.16);
          color: #3b82f6;
        }
        [data-mode="light"] .chat-details-row:hover {
          background: rgba(0,0,0,0.04);
        }
        [data-mode="light"] .media-gallery-item {
          border-color: rgba(15, 23, 42, 0.12);
          background: rgba(15, 23, 42, 0.06);
        }
        [data-mode="light"] .media-link-main {
          background: rgba(15, 23, 42, 0.05);
        }
        [data-mode="light"] .media-link-main:hover {
          background: rgba(59, 130, 246, 0.12);
        }
        [data-mode="light"] .media-link-download {
          background: rgba(15, 23, 42, 0.06);
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.1rem 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.8);
          backdrop-filter: blur(10px);
          position: relative;
          z-index: 1;
        }
        .chat-search-panel {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0.75rem 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.88);
          position: relative;
          z-index: 1;
        }
        .chat-search-panel-icon {
          color: var(--text-secondary);
          flex-shrink: 0;
        }
        .chat-search-panel input {
          flex: 1;
          min-width: 0;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          color: var(--text-primary);
          outline: none;
          padding: 0.65rem 0.9rem;
          font-size: 0.92rem;
        }
        .chat-search-panel input:focus {
          border-color: rgba(59,130,246,0.48);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
        }
        .chat-search-count {
          color: var(--text-secondary);
          font-size: 0.78rem;
          min-width: 74px;
          text-align: right;
          white-space: nowrap;
        }
        .chat-search-nav-btn,
        .chat-search-close-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .chat-search-nav-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .pinned-message-bar {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 0.7rem;
          width: 100%;
          padding: 0.72rem 1.5rem;
          border: none;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.9);
          color: var(--text-primary);
          cursor: pointer;
          text-align: left;
          position: relative;
          z-index: 1;
        }
        .pinned-message-bar:hover {
          background: rgba(255,255,255,0.055);
        }
        .pinned-message-bar-text {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.12rem;
        }
        .pinned-message-bar-text span {
          color: var(--text-secondary);
          font-size: 0.76rem;
          font-weight: 600;
        }
        .pinned-message-bar-text strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.86rem;
          font-weight: 600;
        }
        [data-mode="light"] .pinned-message-bar {
          background: rgba(255,255,255,0.92);
        }
        .chat-messages {
          flex: 1;
          min-height: 0;
          padding: 1.5rem;
          overflow-y: auto;
          overflow-x: hidden;
          display: flex;
          flex-direction: column;
          gap: 1.4rem;
          overscroll-behavior: contain;
          overscroll-behavior-x: none;
          overflow-anchor: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
          position: relative;
          z-index: 1;
        }
        @keyframes messagePop {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .message-wrapper {
          display: flex;
          flex-direction: column;
          width: 100%;
          transition: opacity 0.3s ease, filter 0.3s ease;
        }
        .message-wrapper.mine {
          align-items: flex-end;
        }
        .message-wrapper.theirs {
          align-items: flex-start;
        }
        .message-wrapper.theirs.with-sender-avatar {
          flex-direction: row;
          align-items: flex-end;
          gap: 0.45rem;
        }
        .message-sender-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          flex: 0 0 28px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .message-shell {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          max-width: min(76%, 640px);
        }
        .message-tools {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          gap: 0.35rem;
          opacity: 0;
          transition: opacity 0.15s ease;
          z-index: 8;
          pointer-events: none;
        }
        .message-shell:hover .message-tools,
        .message-wrapper:hover .message-tools,
        .message-shell.controls-open .message-tools,
        .message-tools:hover,
        .message-tools:focus-within {
          opacity: 1;
          pointer-events: auto;
        }
        .message-tools.mine {
          right: 100%;
          margin-right: 0.5rem;
          width: max-content;
          flex-direction: row-reverse;
          justify-content: flex-start;
        }
        .message-tools.theirs {
          left: 100%;
          margin-left: 0.5rem;
          width: max-content;
          flex-direction: row;
          justify-content: flex-start;
        }
        .mini-action-btn {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(10,14,24,0.94);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .mini-action-btn:hover,
        .mini-action-btn.active {
          color: var(--text-primary);
          border-color: rgba(255,255,255,0.18);
        }
        .reaction-strip {
          position: absolute;
          bottom: calc(100% + 8px);
          display: inline-flex;
          gap: 0.35rem;
          padding: 0.45rem;
          border-radius: 999px;
          background: rgba(10,14,24,0.96);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 18px 40px rgba(0,0,0,0.35);
          width: fit-content;
          max-width: min(420px, 80vw);
          overflow: visible;
          z-index: 95;
          animation: reactionFloatIn 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
        @keyframes reactionFloatIn {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .reaction-strip.mine {
          right: 0;
        }
        .reaction-strip.theirs {
          left: 0;
        }
        .reaction-option {
          position: relative;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 1.2rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.18s ease, box-shadow 0.18s ease;
        }
        .reaction-option:hover,
        .reaction-option.selected {
          background: rgba(255,255,255,0.1);
        }
        .reaction-plus-btn {
          color: var(--text-secondary);
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
        }
        .reaction-emoji-glyph {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          transform: translate3d(0,0,0) scale(1);
          transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.18s ease;
          backface-visibility: hidden;
          will-change: transform;
        }
        .reaction-option:hover .reaction-emoji-glyph,
        .reaction-picker-emoji:hover .reaction-emoji-glyph {
          transform: translate3d(0,-2px,0) scale(1.12);
          filter: drop-shadow(0 4px 7px rgba(15,23,42,0.16));
        }
        .reaction-picker-panel {
          position: absolute;
          bottom: calc(100% + 10px);
          width: min(275px, 78vw);
          max-height: 360px;
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          padding: 0.72rem;
          border-radius: 16px;
          background: rgba(255,255,255,0.98);
          color: #111827;
          border: 1px solid rgba(15,23,42,0.08);
          box-shadow: 0 20px 52px rgba(15,23,42,0.28);
          animation: reactionPickerIn 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
          z-index: 105;
          overflow: hidden;
        }
        .reaction-picker-panel.down {
          top: calc(100% + 10px);
          bottom: auto;
        }
        .reaction-picker-panel.mine {
          right: 0;
        }
        .reaction-picker-panel.theirs {
          left: 0;
        }
        @keyframes reactionPickerIn {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .reaction-search-box {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.5rem 0.65rem;
          border-radius: 999px;
          background: #eef0f4;
          color: #6b7280;
        }
        .reaction-search-box input {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #111827;
          font-size: 0.9rem;
        }
        .reaction-picker-groups {
          overflow-y: auto;
          overflow-x: hidden;
          padding: 0 0.45rem 0.2rem 0;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(148,163,184,0.72) transparent;
        }
        .reaction-picker-groups::-webkit-scrollbar {
          width: 7px;
          height: 0;
        }
        .reaction-picker-groups::-webkit-scrollbar-track {
          background: transparent;
        }
        .reaction-picker-groups::-webkit-scrollbar-thumb {
          background: rgba(148,163,184,0.7);
          border-radius: 999px;
        }
        .reaction-picker-groups::-webkit-scrollbar-thumb:hover {
          background: rgba(100,116,139,0.9);
        }
        .reaction-picker-groups::-webkit-scrollbar-corner {
          background: transparent;
        }
        .reaction-picker-group {
          padding-bottom: 0.7rem;
        }
        .reaction-picker-group:last-child {
          padding-bottom: 0;
        }
        .reaction-picker-group + .reaction-picker-group {
          margin-top: 0.55rem;
        }
        .reaction-picker-title {
          margin-bottom: 0.45rem;
          color: #6b7280;
          font-size: 0.78rem;
          font-weight: 600;
        }
        .reaction-picker-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          column-gap: 0.32rem;
          row-gap: 1.08rem;
          overflow: visible;
        }
        .reaction-picker-emoji {
          position: relative;
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 10px;
          background: transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 1.35rem;
          cursor: pointer;
          transition: background 0.18s ease, box-shadow 0.18s ease;
        }
        .reaction-picker-emoji:hover,
        .reaction-picker-emoji.selected {
          background: #eef4ff;
          box-shadow: 0 6px 16px rgba(37,99,235,0.12);
        }
        .reaction-empty-state {
          padding: 1rem 0.5rem;
          text-align: center;
          color: #6b7280;
          font-size: 0.85rem;
        }
        [data-mode="light"] .reaction-strip {
          background: #ffffff;
          border-color: rgba(15,23,42,0.08);
          box-shadow: 0 16px 36px rgba(15,23,42,0.18);
        }
        [data-mode="light"] .reaction-plus-btn {
          background: rgba(15,23,42,0.04);
          border-color: rgba(15,23,42,0.08);
          color: #4b5563;
        }
        [data-mode="light"] .reaction-option:hover,
        [data-mode="light"] .reaction-option.selected {
          background: rgba(15,23,42,0.06);
        }
        .message-menu {
          position: absolute;
          min-width: 170px;
          background: rgba(10,14,24,0.98);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          box-shadow: 0 18px 45px rgba(0,0,0,0.45);
          overflow: hidden;
          z-index: 90;
        }
        .message-menu.up {
          bottom: -0.2rem;
        }
        .message-menu.down {
          top: 0.2rem;
        }
        .message-menu.mine {
          right: calc(100% + 0.5rem);
        }
        .message-menu.theirs {
          left: calc(100% + 0.5rem);
        }
        .message-menu-item {
          width: 100%;
          border: none;
          background: transparent;
          color: var(--text-primary);
          padding: 0.8rem 0.95rem;
          display: flex;
          align-items: center;
          gap: 0.55rem;
          cursor: pointer;
          text-align: left;
        }
        .message-menu-item:hover {
          background: rgba(255,255,255,0.06);
        }
        .message-menu-item.danger {
          color: #fda4af;
        }
        [data-mode="light"] .message-menu {
          background: #ffffff;
          border-color: rgba(15,23,42,0.12);
          box-shadow: 0 18px 45px rgba(15,23,42,0.18);
        }
        [data-mode="light"] .message-menu-item {
          color: #111827;
        }
        [data-mode="light"] .message-menu-item:hover {
          background: rgba(15,23,42,0.06);
        }
        [data-mode="light"] .message-menu-item.danger {
          color: #dc2626;
        }
        .message-bubble {
          padding: 0.65rem 0.85rem;
          border-radius: 12px;
          position: relative;
          box-shadow: 0 1px 1px rgba(0,0,0,0.15);
          transition: background 0.3s ease, filter 0.3s ease;
          animation: messagePop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .message-bubble.media-only {
          padding: 0;
          background: transparent !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2) !important;
        }
        .message-bubble.media-only .attachment-card {
          margin-bottom: 0;
          border: none;
          background: transparent;
        }
        .message-bubble.media-only .attachment-card.image img {
          border-radius: 12px;
          display: block;
        }
        .message-wrapper.mine .message-bubble.media-only .attachment-image-btn img {
          border-top-right-radius: 4px;
        }
        .message-wrapper.theirs .message-bubble.media-only .attachment-image-btn img {
          border-top-left-radius: 4px;
        }
        .message-bubble.media-only .message-time {
          position: absolute;
          bottom: 8px;
          right: 8px;
          color: rgba(255,255,255,0.95) !important;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
          z-index: 2;
          display: flex;
          align-items: center;
          padding: 2px 4px;
          border-radius: 4px;
          background: radial-gradient(circle at bottom right, rgba(0,0,0,0.4) 0%, transparent 80%);
        }
        .message-bubble.media-only .status-icon svg {
          color: #34b7f1 !important;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4));
        }
        .message-wrapper.mine .message-bubble {
          background: #056162;
          color: #e9edef;
          border-top-right-radius: 4px;
        }
        .message-wrapper.theirs .message-bubble {
          background: #202c33;
          color: #e9edef;
          border-top-left-radius: 4px;
        }
        .deleted-message-shell {
          max-width: min(76%, 420px);
        }
        .deleted-message-bubble {
          font-size: 0.88rem;
          font-style: italic;
          line-height: 1.35;
          box-shadow: none !important;
          opacity: 0.72;
        }
        .message-wrapper.mine .deleted-message-bubble {
          background: rgba(5,97,98,0.2);
          color: rgba(233,237,239,0.58);
          border: 1px solid rgba(233,237,239,0.05);
          border-radius: 18px;
          border-top-right-radius: 6px;
        }
        .message-wrapper.theirs .deleted-message-bubble {
          background: rgba(255,255,255,0.035);
          color: rgba(148,163,184,0.68);
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 18px;
          border-top-left-radius: 6px;
        }
        [data-mode="light"] .message-wrapper.theirs .deleted-message-bubble {
          background: rgba(15,23,42,0.028);
          border-color: rgba(15,23,42,0.045);
          color: rgba(100,116,139,0.62);
        }
        [data-mode="light"] .message-wrapper.mine .deleted-message-bubble {
          background: rgba(187,247,208,0.28);
          border-color: rgba(34,197,94,0.08);
          color: rgba(22,101,52,0.58);
        }
        .message-bubble p {
          margin: 0 0 0.45rem 0;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .chat-search-highlight {
          background: rgba(250,204,21,0.42);
          color: inherit;
          border-radius: 4px;
          padding: 0 0.08rem;
        }
        .message-wrapper.chat-search-match .message-bubble {
          box-shadow: 0 0 0 2px rgba(250,204,21,0.3), 0 14px 32px rgba(0,0,0,0.2);
        }
        .message-wrapper.chat-search-match.current .message-bubble {
          box-shadow: 0 0 0 3px rgba(250,204,21,0.68), 0 18px 42px rgba(250,204,21,0.16);
        }
        .message-wrapper.pinned-message-highlight .message-bubble,
        .message-wrapper.pinned-message-highlight .call-log-bubble {
          box-shadow: 0 0 0 3px rgba(59,130,246,0.78), 0 16px 38px rgba(59,130,246,0.22) !important;
          animation: pinnedMessagePulse 1.15s ease-in-out 2;
        }
        @keyframes pinnedMessagePulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.18); }
        }
        .status-icon {
          display: inline-flex;
          align-items: center;
          vertical-align: middle;
          margin-left: 3px;
        }
        .message-time {
          font-size: 0.72rem;
          color: rgba(255,255,255,0.75);
          display: block;
          text-align: right;
        }
        .message-flag {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.72rem;
          padding: 0.2rem 0.45rem;
          border-radius: 999px;
          background: rgba(255,255,255,0.12);
          color: inherit;
          margin-bottom: 0.45rem;
        }
        .reply-preview {
          border-left: 3px solid rgba(255,255,255,0.4);
          padding-left: 0.65rem;
          margin-bottom: 0.55rem;
        }
        .reply-author {
          font-size: 0.75rem;
          font-weight: 700;
          margin-bottom: 0.15rem;
        }
        .reply-text {
          font-size: 0.82rem;
          opacity: 0.85;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .attachment-card {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          text-decoration: none;
          color: inherit;
          margin-bottom: 0.55rem;
          border-radius: 14px;
          overflow: hidden;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
        }
        .attachment-card.image img {
          width: 100%;
          max-height: 240px;
          object-fit: cover;
          display: block;
        }
        .attachment-card.file {
          padding: 0.75rem 0.9rem;
        }
        .attachment-image-btn {
          padding: 0;
          width: 100%;
          cursor: zoom-in;
        }
        .attachment-card.pending {
          margin: 0;
          max-width: 56px;
          min-width: 56px;
          flex-shrink: 0;
        }
        .attachment-card.pending.image img {
          width: 56px;
          max-height: 56px;
          border-radius: 12px;
        }
        .attachment-card.pending.file {
          padding: 0.45rem;
          justify-content: center;
        }
        .attachment-card.pending.file span {
          display: none;
        }
        .message-reactions {
          position: absolute;
          bottom: -0.95rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          z-index: 3;
          pointer-events: auto;
        }
        .message-reactions.mine {
          right: 0.35rem;
          justify-content: flex-end;
        }
        .message-reactions.theirs {
          left: 0.35rem;
          justify-content: flex-start;
        }
        .reaction-pill {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(10,14,24,0.92);
          color: var(--text-primary);
          border-radius: 999px;
          padding: 0.22rem 0.5rem;
          display: inline-flex;
          gap: 0.35rem;
          align-items: center;
          cursor: pointer;
          font-size: 0.82rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.12);
          transition: background 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
        }
        .reaction-pill:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(0,0,0,0.16);
        }
        .reaction-pill.mine {
          border-color: rgba(255,255,255,0.22);
        }
        .chat-input-area {
          flex-shrink: 0;
          padding: 0.8rem 1.4rem;
          border-top: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.9);
          position: relative;
          z-index: 1;
        }
        [data-mode="light"] .chat-input-area {
          background: #ffffff !important;
          border-top: 1px solid rgba(0,0,0,0.08) !important;
        }
        .inbox-page {
          height: calc(100vh - 4rem) !important;
          height: calc(100dvh - 4rem) !important;
          min-height: 0 !important;
          overflow: hidden !important;
          position: relative !important;
        }

        /* ── FB Messenger Style Input ── */
        .fb-messenger-style {
          display: flex;
          align-items: flex-end;
          gap: 12px;
          width: 100%;
        }
        .fb-icons-left, .fb-icons-right {
          display: flex;
          align-items: center;
          gap: 4px;
          padding-bottom: 2px;
        }
        .fb-icon-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: #0084ff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s;
        }
        .fb-icon-btn:hover {
          background: rgba(0, 132, 255, 0.1);
        }
        .fb-icon-btn.active {
          background: rgba(0, 132, 255, 0.15);
        }
        .gif-btn span {
          background: rgba(0, 132, 255, 0.1);
          color: #0084ff;
          padding: 3px 6px;
          border-radius: 4px;
        }
        
        .fb-input-wrapper {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
        }
        .fb-input-inner {
          display: flex;
          flex-direction: column;
          background: rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 4px 12px;
          width: 100%;
          border: none;
        }
        [data-mode="light"] .fb-input-inner {
          background: #f0f2f5;
        }
        
        .fb-attachment-preview-row {
          display: flex;
          padding: 8px 4px 8px 0; /* left padding moved to sticky wrapper */
          align-items: center;
          overflow-x: auto;
          scrollbar-width: thin;
          scrollbar-color: #65676B transparent;
        }
        
        .fb-add-more-sticky {
          position: sticky;
          left: 0;
          z-index: 50;
          padding-left: 4px;
          padding-right: 8px; /* replaces flex gap */
          padding-top: 8px;
          padding-bottom: 8px;
          margin-top: -8px;
          margin-bottom: -8px;
          background: #f0f2f5;
        }
        [data-mode="dark"] .fb-add-more-sticky {
          background: #3A3B3C;
        }
        
        .fb-attachment-preview-row::-webkit-scrollbar {
          height: 12px;
        }
        .fb-attachment-preview-row::-webkit-scrollbar-track {
          background: transparent;
        }
        .fb-attachment-preview-row::-webkit-scrollbar-thumb {
          background-color: #65676B;
          border-radius: 10px;
          border: 3px solid var(--bg-card, #fff); 
        }
        [data-mode="dark"] .fb-attachment-preview-row::-webkit-scrollbar-thumb {
          border: 3px solid #242526;
        }
        
        .fb-attachment-preview-row::-webkit-scrollbar-button:horizontal:decrement {
          display: block;
          width: 16px;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2365676B"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>');
          background-size: 14px;
          background-repeat: no-repeat;
          background-position: center;
        }
        .fb-attachment-preview-row::-webkit-scrollbar-button:horizontal:increment {
          display: block;
          width: 16px;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2365676B"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>');
          background-size: 14px;
          background-repeat: no-repeat;
          background-position: center;
        }
        .fb-plus-menu-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          border: none;
          background: transparent;
          color: var(--text-primary);
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          font-size: 14px;
          text-align: left;
        }
        .fb-plus-menu-item:hover {
          background: rgba(0, 0, 0, 0.05);
        }
        [data-mode="dark"] .fb-plus-menu-item:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        .fb-attachment-thumbnail-wrapper {
          position: relative;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
          margin-right: 8px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          transform: scale(1);
          opacity: 1;
        }
        .fb-attachment-thumbnail-wrapper.fb-attachment-removing {
          width: 0px;
          margin-right: 0px;
          opacity: 0;
          transform: scale(0.5);
          overflow: hidden;
        }
        .fb-add-more-wrapper {
          margin-right: 0 !important;
        }
        .fb-attachment-thumbnail {
          width: 100%;
          height: 100%;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(0,0,0,0.05);
        }
        [data-mode="dark"] .fb-attachment-thumbnail {
          background: rgba(255,255,255,0.1);
        }
        .fb-add-more-btn:hover {
          background: rgba(0,0,0,0.1) !important;
        }
        [data-mode="dark"] .fb-add-more-btn {
          background: rgba(255,255,255,0.1) !important;
          border-color: rgba(255,255,255,0.1) !important;
        }
        [data-mode="dark"] .fb-add-more-btn:hover {
          background: rgba(255,255,255,0.2) !important;
        }
        .fb-attachment-thumbnail img, .fb-attachment-thumbnail video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .fb-attachment-thumbnail .attachment-card {
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          box-shadow: none !important;
          width: 100%;
          height: 100%;
          background: transparent !important;
        }
        .fb-attachment-close {
          position: absolute;
          top: -6px;
          right: -6px;
          background: white;
          color: black;
          border-radius: 50%;
          border: 1px solid #e4e6eb;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          z-index: 10;
        }

        .fb-input {
          flex: 1;
          border: none;
          background: transparent;
          outline: none;
          font-size: 15px;
          padding: 6px 0;
          color: var(--text-primary);
        }
        .fb-input::placeholder {
          color: var(--text-muted);
        }
        .fb-emoji-wrapper {
          display: flex;
          align-items: center;
          position: relative;
        }
        .fb-emoji-btn {
          background: transparent;
          border: none;
          color: #0084ff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border-radius: 50%;
        }
        .fb-emoji-btn:hover {
          background: rgba(0, 132, 255, 0.1);
        }
        
        .voice-message-player {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 260px;
          max-width: 340px;
          padding: 2px 0 4px;
          color: inherit;
        }
        .voice-message-player.mine {
          color: inherit;
        }
        .voice-message-player.theirs {
          color: inherit;
        }
        .vmp-avatar-container {
          position: relative;
          width: 38px;
          height: 38px;
          flex: 0 0 38px;
        }
        .vmp-avatar-img {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }
        .vmp-mic-badge {
          position: absolute;
          right: -2px;
          bottom: -2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #16a34a;
          background: #1f2937;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        }
        .vmp-play-btn {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 34px;
          color: inherit;
          background: transparent;
          cursor: pointer;
          transition: transform 0.18s ease, background 0.18s ease;
        }
        .vmp-play-btn:hover {
          background: rgba(128, 128, 128, 0.15);
          transform: scale(1.04);
        }
        .vmp-play-btn svg {
          margin-left: 2px;
        }
        .vmp-content {
          min-width: 0;
          flex: 1;
        }
        .vmp-waveform {
          position: relative;
          height: 34px;
          display: flex;
          align-items: center;
        }
        .vmp-bars {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          gap: 2px;
          pointer-events: none;
        }
        .vmp-bars span {
          width: 3px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.35;
        }
        .vmp-bars span.active {
          opacity: 0.8;
        }
        .vmp-slider {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 34px;
          opacity: 0;
          cursor: pointer;
          z-index: 2;
        }
        .vmp-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: -4px;
        }
        .vmp-time {
          font-size: 11px;
          color: currentColor;
          opacity: 0.7;
          line-height: 1;
        }
        .recording-state.whatsapp-voice-recorder {
          display: flex;
          align-items: center;
          gap: 14px;
          background: #ffffff;
          color: #111827;
          padding: 8px 10px 8px 14px;
          border-radius: 999px;
          width: 100%;
          min-height: 48px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
          animation: voiceRecordIn 0.18s ease both;
        }
        [data-mode="dark"] .recording-state.whatsapp-voice-recorder {
          background: #1f2937;
          color: #f9fafb;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        }
        .recording-time-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 58px;
        }
        .recording-pulse {
          width: 9px;
          height: 9px;
          background: #d9043d;
          border-radius: 50%;
          animation: recordingPulse 1.15s ease-in-out infinite;
        }
        .recording-state.paused .recording-pulse {
          background: #22c55e;
          animation: none;
        }
        .recording-time {
          font-size: 15px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .recording-wave-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          height: 30px;
        }
        .recording-wave {
          position: relative;
          width: 148px;
          display: flex;
          align-items: center;
          gap: 2px;
          height: 30px;
        }
        .recording-wave-dot {
          position: absolute;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #34b7f1;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 5;
          pointer-events: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .recording-wave-slider {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
          z-index: 6;
        }
        .recording-wave span {
          width: 3px;
          border-radius: 999px;
          background: #9ca3af;
          transform-origin: center;
          transition: height 0.08s linear, opacity 0.08s linear, background 0.16s ease;
        }
        .recording-wave span.active {
          background: #34b7f1;
        }
        .recording-state.paused .recording-wave span {
          background: #93c5fd;
        }
        .recording-state.paused .recording-wave span.active {
          background: #34b7f1;
        }
        .recording-cancel,
        .recording-pause-btn {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          flex: 0 0 34px;
          transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease;
        }
        .recording-cancel {
          color: #111827;
          background: transparent;
        }
        [data-mode="dark"] .recording-cancel {
          color: #f9fafb;
        }
        .recording-cancel:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          transform: scale(1.04);
        }
        .recording-pause-btn {
          color: #d9043d;
          background: rgba(217, 4, 61, 0.08);
        }
        .recording-state.paused .recording-pause-btn {
          color: #16a34a;
          background: rgba(34, 197, 94, 0.12);
        }
        .recording-pause-btn:hover {
          transform: scale(1.04);
        }
        .voice-send-btn {
          background: #22c55e !important;
          color: #ffffff !important;
          box-shadow: 0 8px 18px rgba(34, 197, 94, 0.28);
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .voice-send-btn:hover {
          background: #16a34a !important;
          transform: scale(1.05);
          box-shadow: 0 10px 22px rgba(34, 197, 94, 0.34);
        }
        @keyframes recordingPulse {
          0%, 100% { opacity: 0.45; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes voiceRecordIn {
          from { opacity: 0; transform: translateY(4px) scale(0.99); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .composer-banner {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.8rem 1rem;
          border-radius: 14px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .composer-banner > div {
          min-width: 0;
          flex: 1;
        }
        .composer-banner-text {
          display: block;
          width: 100%;
          min-width: 0;
          color: var(--text-secondary);
          font-size: 0.85rem;
          margin-top: 0.2rem;
          display: flex;
          gap: 0.9rem;
          align-items: center;
          position: relative;
        }
        .emoji-composer {
          position: relative;
          display: flex;
          align-items: center;
        }
        /* ╬ô├╢├ç╬ô├╢├ç Compact composer icon buttons ╬ô├╢├ç╬ô├╢├ç */
        .composer-icon-cluster {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }
        .composer-icon-btn {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: color 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), background 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
          flex-shrink: 0;
        }
        .composer-icon-btn:hover {
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
          transform: scale(1.1);
        }
        .composer-icon-btn.active {
          color: #6366f1;
          background: rgba(99,102,241,0.12);
        }
        /* ╬ô├╢├ç╬ô├╢├ç New Message button ╬ô├╢├ç╬ô├╢├ç */
        .fb-emoji-picker-container {
          position: absolute;
          bottom: calc(100% + 15px);
          right: -10px;
          z-index: 50;
        }
        .fb-emoji-search {
          display: flex;
          align-items: center;
          background: #f0f2f5;
          border-radius: 20px;
          padding: 6px 12px;
          margin: 12px;
          gap: 8px;
        }
        [data-mode="dark"] .fb-emoji-search {
          background: #3a3b3c;
        }
        .fb-emoji-search input {
          border: none;
          background: transparent;
          outline: none;
          width: 100%;
          font-size: 14px;
          color: #050505;
        }
        [data-mode="dark"] .fb-emoji-search input {
          color: #e4e6eb;
        }
        .fb-emoji-picker-title {
          font-size: 13px;
          color: #050505;
          margin: 0 12px 8px 12px;
          font-weight: 500;
        }
        [data-mode="dark"] .fb-emoji-picker-title {
          color: #e4e6eb;
        }
        .fb-emoji-scroll {
          max-height: 200px;
          overflow-y: auto;
          padding: 0 12px;
        }
        .fb-emoji-grid {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 4px;
        }
        .fb-emoji-chip {
          background: transparent;
          border: none;
          font-size: 20px;
          cursor: pointer;
          border-radius: 4px;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fb-emoji-chip:hover {
          background: rgba(0,0,0,0.05);
        }
        [data-mode="dark"] .fb-emoji-chip:hover {
          background: rgba(255,255,255,0.1);
        }
        .fb-emoji-category-tabs {
          display: flex;
          justify-content: space-between;
          padding: 8px 16px;
          border-top: 1px solid #e4e6eb;
          margin-top: 8px;
        }
        [data-mode="dark"] .fb-emoji-category-tabs {
          border-top-color: #3e4042;
        }
        .fb-emoji-category-tab {
          background: transparent;
          border: none;
          cursor: pointer;
          color: #65676b;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
        }
        [data-mode="dark"] .fb-emoji-category-tab {
          color: #b0b3b8;
        }
        .fb-emoji-category-tab.active {
          color: #0084ff;
        }
        .emoji-chip:hover {
          background: rgba(255,255,255,0.09);
          border-color: rgba(255,255,255,0.12);
        }
        .message-input {
          flex: 1;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: var(--text-primary);
          border-radius: 999px;
          padding: 0.9rem 1.1rem;
          outline: none;
        }
        .message-input:focus {
          border-color: transparent !important;
          box-shadow: none !important;
          outline: none;
        }
        }
        .send-btn {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg, #ef4444, #e11d48);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.2s, opacity 0.2s;
          box-shadow: 0 14px 30px rgba(225,29,72,0.28);
          flex-shrink: 0;
        }
        .send-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        .send-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          box-shadow: none;
        }
        .empty-chat-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .compose-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 2rem;
          animation: modalFadeIn 0.2s ease-out;
        }
        .pinned-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: rgba(3,6,12,0.48);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: modalFadeIn 0.18s ease-out;
        }
        .pinned-modal {
          width: min(560px, 100%);
          max-height: min(74vh, 660px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 18px;
          background: rgba(10,14,24,0.98);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 24px 70px rgba(0,0,0,0.45);
          color: var(--text-primary);
          animation: modalScaleIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .pinned-modal-header {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          min-height: 58px;
          padding: 0 4.25rem;
          border-bottom: 1px solid var(--glass-border);
        }
        .pinned-modal-header h3 {
          margin: 0;
          font-size: 1.1rem;
        }
        .pinned-modal-close {
          position: absolute;
          right: 1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 50%;
          background: rgba(255,255,255,0.09);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .pinned-modal-list {
          overflow-y: auto;
          padding: 0.9rem 1rem 1.1rem;
        }
        .pinned-message-item {
          position: relative;
          display: flex;
          align-items: flex-end;
          gap: 0.65rem;
          padding: 0.85rem 2.75rem 0.85rem 0.2rem;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .pinned-message-item.menu-open {
          z-index: 30;
        }
        .pinned-message-item:last-child {
          border-bottom: none;
        }
        .pinned-message-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
          flex: 0 0 30px;
        }
        .pinned-message-main {
          min-width: 0;
          flex: 1;
        }
        .pinned-message-meta {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.35rem;
          color: var(--text-secondary);
          font-size: 0.78rem;
        }
        .pinned-message-preview {
          display: inline-block;
          max-width: 100%;
          padding: 0.65rem 0.8rem;
          border-radius: 16px;
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.4;
        }
        .pinned-message-preview.mine {
          background: rgba(5,97,98,0.55);
        }
        .pinned-message-actions {
          position: absolute;
          right: 0.2rem;
          top: 50%;
          transform: translateY(-50%);
          z-index: 4;
        }
        .pinned-message-more {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 50%;
          background: #242b38;
          color: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .pinned-message-more:hover,
        .pinned-message-more.active {
          color: #ffffff;
          background: #303849;
        }
        .pinned-message-menu {
          position: absolute;
          right: 0;
          top: calc(100% + 0.45rem);
          min-width: 150px;
          overflow: hidden;
          border-radius: 12px;
          background: #0b111d;
          border: 1px solid rgba(255,255,255,0.16);
          box-shadow: 0 18px 44px rgba(0,0,0,0.42);
          z-index: 60;
          isolation: isolate;
        }
        .pinned-message-menu button {
          width: 100%;
          border: none;
          background: transparent;
          color: var(--text-primary);
          padding: 0.78rem 0.9rem;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .pinned-message-menu button:hover {
          background: rgba(255,255,255,0.08);
        }
        .pinned-empty-state {
          min-height: 180px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          color: var(--text-secondary);
        }
        [data-mode="light"] .pinned-modal {
          background: #ffffff;
          border-color: rgba(15,23,42,0.08);
          box-shadow: 0 24px 70px rgba(15,23,42,0.18);
        }
        [data-mode="light"] .pinned-message-item {
          border-bottom-color: rgba(15,23,42,0.1);
        }
        [data-mode="light"] .pinned-message-preview {
          background: #f1f5f9;
          color: #0f172a;
        }
        [data-mode="light"] .pinned-message-preview.mine {
          background: #dcf8c6;
        }
        [data-mode="light"] .pinned-message-more,
        [data-mode="light"] .pinned-modal-close {
          background: #eef2f7;
          color: #0f172a;
        }
        [data-mode="light"] .pinned-message-more:hover,
        [data-mode="light"] .pinned-message-more.active {
          background: #e2e8f0;
          color: #020617;
        }
        [data-mode="light"] .pinned-message-menu {
          background: #ffffff;
          border-color: rgba(15,23,42,0.16);
          box-shadow: 0 18px 44px rgba(15,23,42,0.18);
        }
        [data-mode="light"] .pinned-message-menu button {
          color: #0f172a;
        }
        [data-mode="light"] .pinned-message-menu button:hover {
          background: rgba(15,23,42,0.06);
        }
        .image-viewer-overlay {
          position: fixed;
          inset: 0;
          z-index: 100000;
          background: rgba(3,6,12,0.88);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
        }
        .image-viewer-shell {
          position: relative;
          width: min(50vw, 720px);
          max-width: 100%;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.9rem;
          padding: 1rem;
          border-radius: 22px;
          background: rgba(8,11,18,0.96);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 28px 70px rgba(0,0,0,0.45);
        }
        .image-viewer-close {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          z-index: 2;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(8,11,18,0.96);
          border: 1px solid rgba(255,255,255,0.16);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 14px 30px rgba(0,0,0,0.42);
        }
        .image-viewer-photo {
          width: 100%;
          max-width: 100%;
          max-height: 50vh;
          border-radius: 18px;
          object-fit: contain;
          background: rgba(255,255,255,0.02);
          box-shadow: 0 24px 60px rgba(0,0,0,0.45);
        }
        .image-viewer-caption {
          max-width: min(720px, 100%);
          text-align: center;
          color: var(--text-secondary);
          font-size: 0.92rem;
          word-break: break-word;
        }
        @media (max-width: 1024px) {
          .image-viewer-overlay {
            align-items: center;
            justify-content: center;
            padding: 1rem;
          }
          .image-viewer-shell {
            width: min(92vw, 430px);
            max-height: 82vh;
            padding: 0.9rem;
            border-radius: 18px;
          }
          .image-viewer-close {
            top: 0.55rem;
            right: 0.55rem;
            width: 42px;
            height: 42px;
          }
          .image-viewer-photo {
            width: 100%;
            max-height: 50vh;
          }
        }
        .compose-modal {
          width: min(720px, 100%);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          border-radius: 24px;
          overflow: hidden;
          background: var(--bg-secondary);
          border: 1px solid var(--glass-border);
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
          animation: modalScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .compose-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--glass-border);
        }
        .forward-preview {
          margin: 1rem 1.5rem 0 1.5rem;
          padding: 0.9rem 1rem;
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
        }
        .forward-preview p {
          margin: 0.55rem 0 0 0;
          color: var(--text-secondary);
        }
        .compose-search {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 1rem 1.5rem;
          padding: 0.85rem 1rem;
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .compose-search input {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text-primary);
          outline: none;
          font-size: 0.95rem;
        }
        .compose-results {
          overflow-y: auto;
          padding: 0 1rem 1rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .user-result-card {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          width: 100%;
          text-align: left;
          padding: 1rem;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px;
          color: inherit;
          cursor: pointer;
          transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), border-color 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), background 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .user-result-card:hover {
          transform: translateY(-1px);
          border-color: rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.05);
        }
        .user-result-main {
          flex: 1;
          min-width: 0;
        }
        .user-result-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.4rem;
        }
        .user-role-badge {
          padding: 0.2rem 0.55rem;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: var(--text-muted);
          font-size: 0.72rem;
          text-transform: capitalize;
        }
        .user-meta-row {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.84rem;
          color: var(--text-secondary);
          margin-top: 0.2rem;
        }
        .empty-results {
          padding: 2.5rem 1rem;
          text-align: center;
          color: var(--text-muted);
        }
        .icon-btn.danger {
          color: #fda4af;
        }
        @media (max-width: 1024px) {
          .inbox-page {
            flex-wrap: nowrap !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
            /* Prevent all horizontal overscroll on mobile inbox */
            overscroll-behavior-x: none;
            touch-action: pan-y pinch-zoom;
            height: 100% !important;
            inline-size: 100vw !important;
            width: 100vw !important;
            min-width: 0 !important;
            max-width: 100vw !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
          }
          .inbox-sidebar {
            width: 100% !important;
            display: ${activeChat ? 'none' : 'flex'} !important;
            border-radius: 16px;
            min-height: 0;
          }
          .inbox-page .inbox-main.glass-panel {
            display: ${activeChat ? 'flex' : 'none'} !important;
            flex-direction: column !important;
            flex-wrap: nowrap !important;
            flex: 0 0 100vw !important;
            border-radius: 0;
            min-height: 0;
            min-width: 0 !important;
            height: 100% !important;
            max-height: 100%;
            inline-size: 100vw !important;
            width: 100vw !important;
            max-inline-size: 100vw !important;
            max-width: 100vw !important;
            position: relative;
            overflow: hidden;
            will-change: transform;
            /* Prevent browser horizontal swipe hijacking */
            overscroll-behavior-x: none;
            touch-action: pan-y pinch-zoom;
            padding: 0 !important; /* Override .glass-panel padding from index.css */
          }
          .inbox-main.has-details-panel {
            border-radius: 0;
          }
          .chat-details-panel {
            position: absolute;
            top: 0;
            bottom: 0;
            right: 0;
            z-index: 100;
            width: 100% !important;
            background: rgba(6, 9, 16, 0.95);
            backdrop-filter: blur(20px);
            border-left: none;
            border-radius: 16px;
            transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          }
          .chat-details-panel.collapsed {
            transform: translateX(100%);
            width: 100% !important; /* Keep width for smooth slide out */
            opacity: 1 !important; /* Keep opacity for smooth slide out */
            pointer-events: none;
          }
          .chat-details-panel:not(.collapsed) {
            transform: translateX(0);
          }
          .mobile-chat-details-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 1rem;
            margin-bottom: 1rem;
            border-bottom: 1px solid var(--glass-border);
          }
          .chat-header {
            inline-size: 100%;
            max-inline-size: 100%;
            box-sizing: border-box;
            flex-shrink: 0;
            /* Suppress blue tap flash on touch */
            -webkit-tap-highlight-color: transparent;
            padding: 0.65rem 0.75rem;
            flex-wrap: nowrap;
            gap: 0.45rem;
          }
          .chat-header-left {
            flex: 1 1 auto !important;
            min-width: 0 !important;
          }
          .chat-header-right {
            display: flex !important;
            gap: 0.25rem !important;
            flex-shrink: 0 !important;
            min-width: max-content !important;
          }
          .chat-header .chat-avatar {
            width: 32px;
            height: 32px;
          }
          .chat-header h3 {
            font-size: 0.9rem !important;
            max-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .hdr-icon-btn {
            width: 30px !important;
            height: 30px !important;
          }
          .hdr-icon-btn svg {
            width: 13px;
            height: 13px;
          }
          .hdr-icon-btn--new,
          .hdr-icon-btn--delete {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
          }
          .chat-messages {
            flex: 1 1 auto;
            min-height: 0;
            max-height: 100%;
            inline-size: 100%;
            width: 100%;
            max-inline-size: 100%;
            max-width: 100%;
            box-sizing: border-box;
            padding: 0.9rem 0.7rem 1rem;
            margin: 0;
            contain: layout paint;
            overscroll-behavior: contain;
            overscroll-behavior-x: none;
            overflow-x: clip !important;
            touch-action: pan-y;
          }
          .chat-search-panel {
            padding: 0.65rem 0.8rem;
            gap: 0.45rem;
          }
          .chat-search-count {
            min-width: auto;
            font-size: 0.72rem;
          }
          .chat-search-nav-btn,
          .chat-search-close-btn {
            width: 30px;
            height: 30px;
          }
          .pinned-message-bar {
            padding: 0.62rem 0.75rem;
            gap: 0.55rem;
          }
          .pinned-modal-overlay {
            align-items: center;
            padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem max(0.75rem, env(safe-area-inset-bottom));
          }
          .pinned-modal {
            width: min(430px, 100%);
            max-height: min(74dvh, 620px);
            border-radius: 18px;
          }
          .pinned-modal-list {
            padding: 0.75rem 0.85rem 1rem;
          }
          .pinned-message-item {
            padding-right: 2.45rem;
          }
          .pinned-message-menu {
            right: 0;
          }
          .message-shell {
            max-width: min(82vw, 360px);
            min-width: 0;
          }
          .message-wrapper {
            inline-size: 100% !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            align-self: stretch;
            box-sizing: border-box;
          }
          .message-wrapper.mine {
            align-items: flex-end !important;
          }
          .message-wrapper.theirs {
            align-items: flex-start !important;
          }
          .message-wrapper.mine .message-shell {
            margin-left: auto;
            margin-right: 0;
          }
          .message-wrapper.theirs .message-shell {
            margin-left: 0;
            margin-right: auto;
          }
          .message-bubble {
            max-width: 100%;
            min-width: 0;
            box-sizing: border-box;
            overflow-wrap: anywhere;
          }
          .message-tools.mine,
          .message-tools.theirs {
            width: max-content;
            max-width: 104px;
          }
          .message-bubble[style] {
            box-sizing: border-box;
          }
          .attachment-card.audio {
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
          }
          .voice-message-player {
            min-width: 0;
            width: min(68vw, 300px);
            max-width: 100%;
            box-sizing: border-box;
          }
          .vmp-avatar-container {
            width: 34px;
            height: 34px;
            flex-basis: 34px;
          }
          .vmp-avatar-img {
            width: 34px;
            height: 34px;
          }
          .vmp-play-btn {
            width: 32px;
            height: 32px;
            flex-basis: 32px;
          }
          .vmp-waveform {
            min-width: 0;
          }
          .vmp-bars {
            gap: 1px;
          }
          .vmp-bars span {
            width: 2px;
          }
          .emoji-picker {
            left: 0;
            right: 0;
            width: 100%;
            max-height: 280px;
          }
          .pending-attachment-chip {
            padding: 0.65rem 0.75rem;
          }
          .composer-preview-slot {
            height: 72px;
          }
          .pending-attachment-info strong {
            font-size: 0.88rem;
          }
          .pending-attachment-info span {
            font-size: 0.8rem;
          }
          .chat-input-area {
            inline-size: 100%;
            max-inline-size: 100%;
            box-sizing: border-box;
            flex-shrink: 0;
            padding: 0.65rem 0.7rem 0.7rem;
            position: relative;
            z-index: 2;
            /* Prevent accidental horizontal overscroll on input area */
            overscroll-behavior-x: none;
            touch-action: pan-y;
          }
          .chat-composer {
            padding: 0.6rem 0.8rem;
          }
          .input-row {
            gap: 0.5rem;
          }

          /* ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Global Mobile Touch Optimizations ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç */
          .chat-item,
          .hdr-icon-btn,
          .send-btn,
          .mini-action-btn,
          .composer-icon-btn,
          .new-msg-btn,
          .reaction-option,
          .emoji-chip,
          .message-menu-item,
          button {
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
          }

          /* Active state feedback for mobile taps */
          .chat-item:active {
            background: rgba(255,255,255,0.08) !important;
            transition: background 0.08s ease;
          }
          .hdr-icon-btn:active {
            transform: scale(0.88) !important;
            transition: transform 0.08s ease;
          }
          .send-btn:active:not(:disabled) {
            transform: scale(0.88) !important;
          }
        }
       `}</style>
    </div>
  );
}
