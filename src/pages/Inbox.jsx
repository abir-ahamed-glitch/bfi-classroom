import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { resolveMediaUrl } from '../utils/mediaUtils';
import {
  ArrowLeft,
  AtSign,
  Bell,
  BellOff,
  CornerUpLeft,
  File,
  FileText,
  Forward,
  Hash,
  IdCard,
  Image as ImageIcon,
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
  Square,
  Plus,
  Play,
  Pause,
  Loader,
  Pin,
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

const QUICK_REACTIONS = [
  '\u2764\uFE0F',
  '\u{1F44D}',
  '\u{1F602}',
  '\u{1F525}',
  '\u{1F62E}',
  '\u{1F44F}',
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

const VoiceMessagePlayer = ({ src, isMine, avatarUrl }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    fetch(src).then(r => r.arrayBuffer()).then(ab => {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      return actx.decodeAudioData(ab);
    }).then(decoded => {
      if (decoded.duration && decoded.duration !== Infinity) {
        setDuration(decoded.duration);
      }
    }).catch(() => {});
  }, [src]);

  useEffect(() => {
    let interval;
    if (isPlaying) {
      let lastTime = audioRef.current?.currentTime || 0;
      let stallCount = 0;
      interval = setInterval(() => {
        if (audioRef.current) {
          const current = audioRef.current.currentTime;
          setProgress((current / (duration || audioRef.current.duration || 1)) * 100);
          
          if (Math.abs(current - lastTime) < 0.1 && current > 0) {
            stallCount++;
            if (stallCount >= 2) {
              setIsPlaying(false);
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
              setProgress(0);
              stallCount = 0;
            }
          } else {
            stallCount = 0;
          }
          lastTime = current;
        }
      }, 300);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const formatTime = (secs) => {
    const s = Math.round(secs);
    if (isNaN(s) || !isFinite(s)) return '0:00';
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
  };

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
        <div className="vmp-waveform">
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
                audioRef.current.currentTime = (val / 100) * (duration || audioRef.current.duration || 1);
              }
            }}
            style={{ '--progress': `${progress}%` }}
          />
        </div>
        <div className="vmp-meta">
          <span className="vmp-time">
            {isPlaying && audioRef.current ? formatTime(audioRef.current.currentTime) : formatTime(duration || 0)}
          </span>
        </div>
      </div>
      <audio 
        ref={audioRef} 
        src={src} 
        onEnded={handleEnded} 
        style={{ display: 'none' }} 
        onLoadedMetadata={(e) => {
          if (!duration && e.target.duration && e.target.duration !== Infinity) {
            setDuration(e.target.duration);
          }
        }} 
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
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  
  const [decryptedAttachmentUrls, setDecryptedAttachmentUrls] = useState({});
  const [imageViewer, setImageViewer] = useState(null);
  const [showChatInfoPanel, setShowChatInfoPanel] = useState(true);
  const [chatInfoAccordion, setChatInfoAccordion] = useState(true);
  const [mediaAccordion, setMediaAccordion] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([audioBlob], `voice-message.webm`, { type: 'audio/webm', lastModified: Date.now() });
        setAttachedFiles([{ id: Math.random().toString(36).substr(2, 9), file, previewUrl: URL.createObjectURL(audioBlob) }]);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied", err);
      alert("Microphone access is required to send voice messages.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      audioChunksRef.current = [];
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
      clearAttachments();
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
  const activeChatRef = useRef(null);
  const previousChatIdRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const mutedChatsRef = useRef(mutedChats);
  const chatSearchInputRef = useRef(null);
  const chatMessagesRef = useRef(null);
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

  useEffect(() => {
    fetchConversations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    previousChatIdRef.current = activeChatRef.current?.other_user_id ?? null;
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

      if (senderId !== currentUserId && !mutedChatsRef.current.has(partnerId)) {
        soundManager.playMessageReceived();
      }

      setConversations((prev) => {
        const existing = prev.find((chat) => normalizeUserId(chat.other_user_id) === partnerId);
        if (!existing) {
          fetchConversations(partnerId, { silent: true });
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

      setMessages((prev) => {
        if (!isActiveConversation) return prev;
        if (prev.some((item) => item.id === processedMessage.id)) return prev;
        
        // Prevent duplicate if this is our own message and we have an optimistic version waiting
        if (normalizeUserId(processedMessage.sender_id) === normalizeUserId(currentUserId)) {
          const hasOptimistic = prev.some(m => m.is_pending);
          if (hasOptimistic) return prev;
        }
        
        return [...prev, processedMessage];
      });

      if (isActiveConversation && senderId !== currentUserId && activeChatRef.current) {
        selectChat(activeChatRef.current, { silent: true, markAsRead: true });
      }
    });

    socket.on('inbox:message_updated', async (message) => {
      const processedMsgs = await processIncomingMessages([message]);
      const processedMessage = processedMsgs[0];
      setMessages((prev) => prev.map((item) => (item.id === processedMessage.id ? { ...processedMessage, client_id: item.client_id } : item)));
      fetchConversations(activeChatRef.current?.other_user_id, { silent: true });
    });

    socket.on('inbox:message_deleted', ({ id }) => {
      setMessages((prev) => prev.filter((item) => item.id !== id));
      setReplyToMessage((prev) => (prev?.id === id ? null : prev));
      setEditingMessage((prev) => (prev?.id === id ? null : prev));
      fetchConversations(activeChatRef.current?.other_user_id, { silent: true });
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

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    const openedDifferentChat = normalizeUserId(activeChat?.other_user_id) !== normalizeUserId(previousChatIdRef.current);
    const shouldStickToBottom = forceScrollToBottomRef.current || nearBottom || openedDifferentChat;

    if (shouldStickToBottom) {
      let scrollBehavior = 'smooth';
      if (openedDifferentChat) scrollBehavior = 'auto';
      else if (typeof forceScrollToBottomRef.current === 'string') scrollBehavior = forceScrollToBottomRef.current;

      const executeScroll = () => {
        if (!chatMessagesRef.current) return;
        chatMessagesRef.current.scrollTo({
          top: chatMessagesRef.current.scrollHeight,
          behavior: scrollBehavior
        });
      };

      requestAnimationFrame(() => {
        executeScroll();
        if (openedDifferentChat) {
          window.setTimeout(executeScroll, 30);
          window.setTimeout(executeScroll, 120);
        }
      });
    }

    forceScrollToBottomRef.current = false;
  }, [messages, activeChat?.other_user_id]);

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
      fetchConversations(activeChatRef.current.other_user_id, { silent: true });
    }, 30000);

    return () => window.clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.other_user_id]);

  useEffect(() => {
    if (!openMenuId && !reactionBarId && !emojiPickerOpen && !isPlusMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const clickedInsideInteractiveMenu = target.closest(
        '.message-menu, .reaction-strip, .mini-action-btn, .reaction-pill, .emoji-picker, .fb-emoji-picker-container, .fb-emoji-btn, .emoji-toggle-btn, .fb-plus-menu, .collapse-btn',
      );

      if (clickedInsideInteractiveMenu) return;

      setOpenMenuId(null);
      setReactionBarId(null);
      setEmojiPickerOpen(false);
      setIsPlusMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMenuId, reactionBarId, emojiPickerOpen, isPlusMenuOpen]);


  useEffect(() => {
    const encryptedAttachments = messages.filter((message) => message.attachment_url);

    if (!encryptedAttachments.length) {
      setDecryptedAttachmentUrls({});
      return undefined;
    }

    let cancelled = false;
    const generatedUrls = [];

    const decryptAttachments = async () => {
      const privateKey = getMyPrivateKey();

      const nextUrls = {};

      for (const message of encryptedAttachments) {
        try {
          const role = normalizeUserId(message.sender_id) === normalizeUserId(currentUser?.id) ? 'sender' : 'receiver';
          const fileUrl = getAttachmentFileUrl(message.attachment_url);
          const response = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          });
          if (!response.ok) throw new Error(`Attachment fetch failed (${response.status})`);

          const isEncryptedFile = (message.attachment_type || '').startsWith('e2e-file:');
          if (isEncryptedFile && !privateKey) continue;
          const originalType = isEncryptedFile
            ? message.attachment_type.replace(/^e2e-file:/, '') || 'application/octet-stream'
            : message.attachment_type || response.headers.get('content-type') || 'application/octet-stream';
          let blob;
          if (isEncryptedFile) {
            const decryptedBuffer = await decryptFileE2E(await response.text(), privateKey, role);
            if (!decryptedBuffer) continue;
            blob = new Blob([decryptedBuffer], { type: originalType });
          } else {
            blob = await response.blob();
          }
          const objectUrl = URL.createObjectURL(blob);
          generatedUrls.push(objectUrl);
          nextUrls[message.id] = { url: objectUrl, type: originalType };
        } catch (error) {
          console.error('Failed to decrypt attachment', error);
        }
      }

      if (!cancelled) {
        setDecryptedAttachmentUrls(nextUrls);
      }
    };

    decryptAttachments();

    return () => {
      cancelled = true;
      generatedUrls.forEach((url) => URL.revokeObjectURL(url));
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

      // Auto-select first unread chat if no active chat
      if (!activeChat && processedChats.length > 0) {
        const firstUnread = processedChats.find(c => c.unread_count > 0);
        if (firstUnread) {
          selectChat(firstUnread);
        }
      }

      if (preferredUserId) {
        const match = processedChats.find((chat) => normalizeUserId(chat.other_user_id) === normalizeUserId(preferredUserId));
        if (match) {
          setActiveChat((prev) => (
            normalizeUserId(prev?.other_user_id) === normalizeUserId(match.other_user_id)
              ? { ...prev, ...match }
              : match
          ));
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
      setOpenMenuId(null);
      setReactionBarId(null);
      setEmojiPickerOpen(false);
      setChatSearchOpen(false);
      setChatSearchQuery('');
      setChatSearchIndex(0);
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

          const prevMap = new Map(prev.map(m => [m.id, m]));
          const pendingMessages = prev.filter(m => m.is_pending);
          
          const merged = decryptedMessages.map(m => {
            const existing = prevMap.get(m.id);
            // Preserve client_id for stable React keys to prevent blinking
            if (existing && existing.client_id) {
              return { ...m, client_id: existing.client_id };
            }
            return m;
          });

          // Preserve optimistic messages that haven't been confirmed by the server yet
          for (const pending of pendingMessages) {
            if (!merged.some(m => m.id === pending.id)) {
              merged.push(pending);
            }
          }
          
          return merged;
        });
      
        // Trigger a single smooth scroll after state updates
        forceScrollToBottomRef.current = true;
        setTimeout(() => { forceScrollToBottomRef.current = false; }, 500);
      

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
    if (!chatMessagesRef.current) return;
    chatMessagesRef.current.scrollTo({
      top: chatMessagesRef.current.scrollHeight,
      behavior,
    });
  };

  const forceScrollToLatest = (behavior = 'smooth') => {
    forceScrollToBottomRef.current = behavior;
  };

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
      alert(err.message);
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
        alert(`Failed to send ${file.name}: ${err.message}`);
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
      alert(error.message);
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
      alert(error.message);
    }
  };

  const handleReaction = async (message, reaction) => {
    try {
      const myReaction = message.reactions?.find((item) => item.reacted_by_me)?.reaction || null;
      const nextReaction = myReaction === reaction ? '' : reaction;

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

      if (data.updated_message) {
        const processed = (await processIncomingMessages([data.updated_message]))[0];
        setMessages((prev) => prev.map((item) => item.id === message.id ? { ...processed, client_id: item.client_id } : item));
      }
      setReactionBarId(null);
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  };

  const handleDeleteMessage = async (message, mode) => {
    const confirmText = mode === 'everyone'
      ? 'Unsend this message for everyone?'
      : 'Delete this message from your inbox?';

    if (!window.confirm(confirmText)) return;

    try {
      const response = await apiFetch(`/api/inbox/messages/${message.id}?mode=${mode}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to delete message.');

      setMessages((prev) => prev.filter((item) => item.id !== message.id));
      setReplyToMessage((prev) => (prev?.id === message.id ? null : prev));
      setEditingMessage((prev) => (prev?.id === message.id ? null : prev));
      setOpenMenuId(null);
      // Removed fetchConversations to prevent race condition and UI blinking
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  };

  const handleDeleteConversation = async () => {
    if (!activeChat) return;
    if (!window.confirm(`Delete the entire conversation with ${activeChat.first_name} ${activeChat.last_name} from your inbox?`)) {
      return;
    }

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
      alert(error.message);
    } finally {
      setDeletingConversation(false);
    }
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
        } else if (forwardingMessage.attachment_type && !forwardingMessage.attachment_type.startsWith('e2e-file:')) {
           const res = await fetch(resolveMediaUrl(forwardingMessage.attachment_url));
           rawBlob = await res.blob();
        }

        if (rawBlob) {
          const fileToUpload = new File([rawBlob], originalFileName, { type: rawBlob.type });
          const { encryptedFile, keyBuffer, ivBuffer, saltBuffer } = await encryptFileE2E(fileToUpload);

          const formData = new FormData();
          formData.append('file', encryptedFile);

          const uploadResponse = await apiFetch('/api/inbox/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            body: formData,
          });
          const uploadData = await readJson(uploadResponse);
          if (!uploadResponse.ok) throw new Error(uploadData.error || 'Failed to upload forwarded attachment.');

          attachmentUrl = uploadData.file_path;
          attachmentId = uploadData.attachment_id || null;

          const combinedKeys = new Uint8Array([...saltBuffer, ...ivBuffer, ...keyBuffer]);
          const keysBase64 = btoa(String.fromCharCode(...combinedKeys));
          const keysJson = JSON.stringify({ [user.id]: keysBase64 });
          finalAttachmentType = `e2e-file:${fileToUpload.type}|${btoa(fileToUpload.name)}|${keysJson}`;
        }
      }

      const encryptedContent = await encryptStringForUser(forwardingMessage.content || '', user);
      
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

      fetchConversations(user.id, { silent: true });
    } catch (error) {
      console.error(error);
      alert(error.message);
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
    const fileUrl = decryptedAttachment?.url || null;
    const attachmentType = decryptedAttachment?.type || message.attachment_type || '';

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
              onLoad={() => {
                const container = chatMessagesRef.current;
                if (!container) return;
                // If user is near bottom (within 300px), snap to latest after image loads
                const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (distFromBottom < 300) scrollToLatest('smooth');
              }}
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
              onLoadedData={() => {
                if (forceScrollToBottomRef.current) scrollToLatest('smooth');
              }}
            />
          </div>
        );
      }

      if (attachmentType.startsWith('audio/')) {
        const isMine = message.sender_id === currentUser.id || message.sender_id === currentUserIdRef.current;
        return (
          <div className="attachment-card audio" style={{ background: 'transparent', padding: 0, border: 'none', boxShadow: 'none' }}>
            <VoiceMessagePlayer src={fileUrl} isMine={isMine} avatarUrl={isMine ? currentUser?.profile_picture : activeChat?.profile_picture} />
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
      setSlideDirection('enter');
      await selectChat(chat, options);
      requestAnimationFrame(() => {
        setTimeout(() => setSlideDirection(null), 300);
      });
    } else {
      await selectChat(chat, options);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="page-container container inbox-page" style={{ display: 'flex', paddingBottom: 0 }}>
        <div className="inbox-sidebar glass-panel" style={{ flex: 1 }}>
          <SkeletonLoader variant="inbox" count={8} />
        </div>
      </div>
    );
  }


  return (
      <div className="page-container container inbox-page" style={{ display: 'flex', paddingBottom: 0 }}>
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFilePick} />

      <div className={`inbox-sidebar glass-panel ${slideDirection === 'exit' ? 'slide-in-from-left' : ''}`}>
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
          <button className="new-msg-btn" onClick={() => setComposerMode('new')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            New Message
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
                    {isUnreadChat && (
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
                    // If it looks like a reaction JSON, show a friendly label
                    if (lm.startsWith('{') && lm.includes('"type":"reaction"')) {
                      try {
                        const d = JSON.parse(lm);
                        const isMe = normalizeUserId(d.reactorId) === normalizeUserId(currentUser?.id);
                        return isMe ? `You reacted ${d.emoji}` : `Reacted ${d.emoji} to your message`;
                      } catch { /* fall through */ }
                    }

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
        className={`inbox-main glass-panel ${activeChat ? 'has-details-panel' : ''} ${slideDirection === 'enter' ? 'slide-in-from-right' : ''} ${slideDirection === 'exit' ? 'slide-out-to-right' : ''}`}
      >
        {activeChat ? (
          <>
            <div className="chat-header">
              {/* Left: back + avatar + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1, minWidth: 0 }}>
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
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: '0.97rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeChat.first_name} {activeChat.last_name}
                  </h3>
                  <span className="text-muted text-sm">{activeChat.role}</span>
                </div>
              </div>

              {/* Right: 4 uniform circle icon buttons */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
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
                  className="chat-info-toggle-btn"
                  onClick={() => setShowChatInfoPanel(!showChatInfoPanel)}
                >
                  Chat info
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

            <div ref={chatMessagesRef} className="chat-messages custom-scrollbar">
              {messages.map((message) => {
                const isMine = normalizeUserId(message.sender_id) === normalizeUserId(currentUser.id);
                const myReaction = message.reactions?.find((item) => item.reacted_by_me)?.reaction || '';

                if (message.message_type === 'reaction') {
                  return null;
                }

                // ╬ô├╢├ç╬ô├╢├ç Messenger-style Call Log Bubble ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç
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
                    <div id={`msg-${message.id}`} key={message.id} className={`message-wrapper ${isMine ? 'mine' : 'theirs'}`}>
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
                // ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç


                return (
                  <div
                    id={`msg-${message.id}`}
                    key={message.client_id || message.id}
                    className={`message-wrapper ${isMine ? 'mine' : 'theirs'} ${chatSearchResults.includes(message.id) ? 'chat-search-match' : ''} ${chatSearchResults[chatSearchIndex] === message.id ? 'current' : ''}`}
                  >
                    <div className={`message-shell ${openMenuId === message.id || reactionBarId === message.id ? 'controls-open' : ''}`}>
                      <div className={`message-tools ${isMine ? 'mine' : 'theirs'}`}>
                        <button type="button" className="mini-action-btn" onPointerDown={(event) => event.preventDefault()} onClick={() => beginReply(message)} title="Reply">
                          <CornerUpLeft size={14} />
                        </button>
                        <button type="button" className={`mini-action-btn ${reactionBarId === message.id ? 'active' : ''}`} onPointerDown={(event) => event.preventDefault()} onClick={() => {
                          preserveChatScrollPosition();
                          setReactionBarId((prev) => prev === message.id ? null : message.id);
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
                            >
                              {reaction}
                            </button>
                          ))}
                        </div>
                      )}

                        {openMenuId === message.id && (
                          <div className={`message-menu ${isMine ? 'mine' : 'theirs'} ${openMenuDirection}`}>
                            <button type="button" className="message-menu-item" onClick={() => beginReply(message)}>
                              <CornerUpLeft size={14} /> Reply
                            </button>
                          <button type="button" className="message-menu-item" onClick={() => beginForward(message)}>
                            <Forward size={14} /> Forward
                          </button>
                          {isMine && (
                            <button type="button" className="message-menu-item" onClick={() => beginEdit(message)}>
                              <Pencil size={14} /> Edit
                            </button>
                          )}
                          <button type="button" className="message-menu-item danger" onClick={() => handleDeleteMessage(message, 'me')}>
                            <Trash2 size={14} /> Delete for me
                          </button>
                          {isMine && (
                            <button type="button" className="message-menu-item danger" onClick={() => handleDeleteMessage(message, 'everyone')}>
                              <Trash2 size={14} /> Unsend
                            </button>
                          )}
                        </div>
                      )}

                      <div className="message-bubble" style={(message.attachment_type?.startsWith('audio/') || message.attachment_url?.endsWith('.webm')) ? { '--message-mine-bg': '#dcf8c6', '--message-theirs-bg': '#fff', background: isMine ? '#dcf8c6' : '#fff', color: '#000' } : {}}>
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

                        {message.content && <p>{renderMessageContent(message.content)}</p>}

                        <span className="message-time" style={(message.attachment_type?.startsWith('audio/') || message.attachment_url?.endsWith('.webm')) ? { color: 'rgba(0,0,0,0.5)' } : {}}>
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

                      {message.reactions?.length > 0 && (
                        <div className={`message-reactions ${isMine ? 'mine' : 'theirs'}`}>
                          {message.reactions.map((reaction) => (
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
                  {(!newMessage.trim() && attachedFiles.length === 0 && !isRecording) ? (
                    <div className="fb-icons-left">
                      <button type="button" className="fb-icon-btn" title="Voice message" onClick={startRecording}>
                        <Mic size={20} />
                      </button>
                      <button type="button" className="fb-icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach photo">
                        <ImageIcon size={20} />
                      </button>
                      <button type="button" className="fb-icon-btn" title="Choose sticker">
                        <Sticker size={20} />
                      </button>
                      <button type="button" className="fb-icon-btn gif-btn" title="Choose GIF">
                        <span style={{ fontSize: '11px', fontWeight: 'bold' }}>GIF</span>
                      </button>
                    </div>
                  ) : (
                    <div className="fb-icons-left" style={{ position: 'relative' }}>
                      <button 
                        type="button" 
                        className="fb-icon-btn collapse-btn" 
                        style={{ background: '#0084ff', color: 'white', width: '28px', height: '28px', marginLeft: '4px' }} 
                        onClick={() => {
                          if (isRecording) {
                            stopRecording();
                          } else {
                            setIsPlusMenuOpen(!isPlusMenuOpen);
                          }
                        }}
                      >
                        {isRecording ? <Square size={16} fill="currentColor" /> : isPlusMenuOpen ? <X size={20} strokeWidth={3} /> : <Plus size={20} strokeWidth={3} />}
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
                          <button type="button" className="fb-plus-menu-item" onClick={() => setIsPlusMenuOpen(false)}>
                            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#0084ff', background: 'rgba(0,132,255,0.1)', padding: '2px 4px', borderRadius: '4px' }}>GIF</span>
                            <span>Choose a GIF</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Text input / Recording UI */}
                  <div className="chat-composer fb-input-wrapper">
                    {isRecording ? (
                      <div className="recording-state">
                        <div className="recording-pulse" />
                        <span>{formatRecordingTime(recordingTime)}</span>
                        <button type="button" onClick={cancelRecording} className="recording-cancel">
                          <Trash2 size={16} />
                        </button>
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
                    {newMessage.trim() || attachedFiles.length > 0 ? (
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

      {activeChat && showChatInfoPanel && (
        <aside className="chat-details-panel glass-panel">
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
                  <button type="button" className="chat-details-row" onClick={() => alert('Pinned messages feature is currently under maintenance.')}>
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
                  <div className="media-gallery" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', padding: '0.5rem' }}>
                    {messages.filter(m => m.attachment_url && m.attachment_url.match(/\.(jpeg|jpg|gif|png|webp|avif)$/i)).length > 0 ? (
                      messages.filter(m => m.attachment_url && m.attachment_url.match(/\.(jpeg|jpg|gif|png|webp|avif)$/i)).map((m) => {
                         const fileUrl = (m.attachment_name && m.attachment_url.includes('/inbox-attachments/')) 
                          ? `/api/inbox/attachments/${encodeURIComponent(m.attachment_name)}` 
                          : resolveMediaUrl(m.attachment_url);
                         const displayUrl = decryptedAttachmentUrls[fileUrl] || fileUrl;
                         return (
                           <div key={m.id || m.uid} className="media-gallery-item" onClick={() => setImageViewer({ src: displayUrl, alt: 'Media' })} style={{ aspectRatio: '1/1', overflow: 'hidden', borderRadius: '4px', cursor: 'pointer' }}>
                             <img src={displayUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                           </div>
                         );
                      })
                    ) : (
                      <div className="empty-results" style={{ gridColumn: '1 / -1', padding: '0.5rem', fontSize: '0.8rem', opacity: 0.7 }}>No media found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

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

        @media (max-width: 768px) {
          .inbox-main.slide-in-from-right {
            animation: slideInFromRight 0.28s cubic-bezier(0.25, 0.8, 0.25, 1) forwards;
          }
          .inbox-main.slide-out-to-right {
            animation: slideOutToRight 0.22s cubic-bezier(0.25, 0.8, 0.25, 1) forwards;
          }
          .inbox-sidebar.slide-in-from-left {
            animation: slideInFromLeft 0.22s cubic-bezier(0.25, 0.8, 0.25, 1) forwards;
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

        @media (max-width: 768px) {
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
          padding: 1.5rem;
          border-bottom: 1px solid var(--glass-border);
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
          border-radius: 0 16px 16px 0;
          border-left: none;
          min-height: 0;
          overflow: hidden;
          box-shadow: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          background:
            radial-gradient(circle at top right, rgba(59,130,246,0.08), transparent 28%),
            linear-gradient(180deg, rgba(8,11,18,0.95), rgba(10,14,24,0.98));
        }
        .inbox-main.has-details-panel {
          border-radius: 0;
        }
        .chat-details-panel {
          width: 270px;
          flex-shrink: 0;
          border-left: 1px solid var(--glass-border);
          border-radius: 0 16px 16px 0;
          padding: 1.4rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 1.35rem;
          overflow-y: auto;
          background: rgba(8,11,18,0.88);
          box-shadow: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
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
        .chat-info-toggle-btn {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.15);
          color: var(--text-primary);
          padding: 0 0.85rem;
          height: 36px;
          border-radius: 18px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          margin-left: 0.5rem;
        }
        .chat-info-toggle-btn:hover {
          background: rgba(255,255,255,0.18);
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
        [data-mode="light"] .chat-accordion-header:hover,
        [data-mode="light"] .chat-details-row:hover {
          background: rgba(0,0,0,0.04);
        }
        [data-mode="light"] .chat-info-toggle-btn {
          background: rgba(0,0,0,0.04);
          border: 1px solid rgba(0,0,0,0.08);
          color: #09090b;
        }
        [data-mode="light"] .chat-info-toggle-btn:hover {
          background: rgba(0,0,0,0.08);
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.1rem 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.8);
          backdrop-filter: blur(10px);
        }
        .chat-search-panel {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0.75rem 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.88);
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
          overflow-anchor: none;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
        }
        @keyframes messagePop {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .message-wrapper {
          display: flex;
          flex-direction: column;
          transition: opacity 0.3s ease, filter 0.3s ease;
        }
        .message-wrapper.mine {
          align-items: flex-end;
        }
        .message-wrapper.theirs {
          align-items: flex-start;
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
          top: 0.2rem;
          display: flex;
          gap: 0.35rem;
          opacity: 0;
          transition: opacity 0.15s ease;
          z-index: 8;
          pointer-events: none;
        }
        .message-shell:hover .message-tools,
        .message-shell.controls-open .message-tools,
        .message-tools:hover,
        .message-tools:focus-within {
          opacity: 1;
          pointer-events: auto;
        }
        .message-tools.mine {
          right: 0;
          justify-content: flex-end;
        }
        .message-tools.theirs {
          left: 0;
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
          display: inline-flex;
          gap: 0.35rem;
          padding: 0.45rem;
          border-radius: 999px;
          background: rgba(10,14,24,0.96);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 18px 40px rgba(0,0,0,0.35);
          width: fit-content;
          max-width: 100%;
          overflow-x: auto;
        }
        .reaction-strip.mine {
          align-self: flex-end;
        }
        .reaction-strip.theirs {
          align-self: flex-start;
        }
        .reaction-option {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 1rem;
        }
        .reaction-option:hover,
        .reaction-option.selected {
          background: rgba(255,255,255,0.1);
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
          bottom: calc(100% + 0.35rem);
        }
        .message-menu.down {
          top: calc(100% + 0.35rem);
        }
        .message-menu.mine {
          right: 0;
        }
        .message-menu.theirs {
          left: 0;
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
        .message-bubble {
          padding: 0.65rem 0.85rem;
          border-radius: 12px;
          position: relative;
          box-shadow: 0 1px 1px rgba(0,0,0,0.15);
          transition: background 0.3s ease, filter 0.3s ease;
          animation: messagePop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
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
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .message-reactions.mine {
          justify-content: flex-end;
        }
        .message-reactions.theirs {
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
        }
        .reaction-pill.mine {
          border-color: rgba(255,255,255,0.22);
        }
        .chat-input-area {
          flex-shrink: 0;
          padding: 0.8rem 1.4rem;
          border-top: 1px solid var(--glass-border);
          background: rgba(6,9,16,0.9);
        }
        [data-mode="light"] .chat-input-area {
          background: #ffffff !important;
          border-top: 1px solid rgba(0,0,0,0.08) !important;
        }
        .inbox-page {
          height: calc(100vh - 4rem) !important;
          min-height: 0 !important;
          overflow: hidden !important;
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
        
        .recording-state {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          padding: 8px 16px;
          border-radius: 20px;
          width: 100%;
        }
        .recording-pulse {
          width: 8px;
          height: 8px;
          background: #ef4444;
          border-radius: 50%;
          animation: pulse 1s infinite;
        }
        .recording-cancel {
          background: none;
          border: none;
          color: #ef4444;
          cursor: pointer;
          padding: 4px;
          margin-left: auto;
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
        .new-msg-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 600;
          color: #fff;
          background: linear-gradient(135deg, #6366f1, #3b82f6);
          box-shadow: 0 4px 14px rgba(99,102,241,0.35);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .new-msg-btn:hover {
          transform: translateY(-1px) scale(1.03);
          box-shadow: 0 6px 20px rgba(99,102,241,0.55);
        }
        .new-msg-btn:active { transform: scale(0.96); }
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
          background: rgba(0,0,0,0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 1rem;
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
        @media (max-width: 768px) {
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
          border-radius: 20px;
          overflow: hidden;
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
        @media (max-width: 768px) {
          .inbox-page {
            padding-left: 0 !important;
            padding-right: 0 !important;
            /* Prevent all horizontal overscroll on mobile inbox */
            overscroll-behavior-x: none;
            touch-action: pan-y pinch-zoom;
          }
          .inbox-sidebar {
            width: 100%;
            display: ${activeChat ? 'none' : 'flex'};
            border-radius: 16px;
            min-height: 0;
          }
          .inbox-main {
            display: ${activeChat ? 'flex' : 'none'};
            border-radius: 16px;
            min-height: 0;
            max-height: 100%;
            position: relative;
            overflow: hidden;
            will-change: transform;
            /* Prevent browser horizontal swipe hijacking */
            overscroll-behavior-x: none;
            touch-action: pan-y pinch-zoom;
          }
          .inbox-main.has-details-panel {
            border-radius: 16px;
          }
          .chat-details-panel {
            display: none;
          }
          .chat-header {
            flex-shrink: 0;
            /* Suppress blue tap flash on touch */
            -webkit-tap-highlight-color: transparent;
          }
          .chat-messages {
            flex: 1 1 auto;
            min-height: 0;
            max-height: 100%;
            overscroll-behavior: contain;
            overscroll-behavior-x: none;
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
          .message-shell {
            max-width: 100%;
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
            padding: 0.8rem 1.5rem 0.8rem 0.8rem;
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
