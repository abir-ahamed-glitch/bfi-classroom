import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import { MessageSquare, Heart, Image as ImageIcon, Send, Film, Share2, Trash2, Pin, PinOff, Play, Video, GripVertical, X, Pencil, ChevronLeft, ChevronRight, Smile, MoreVertical, Download, Globe, GraduationCap, EyeOff, ChevronDown, ChevronUp, ThumbsUp, MessageCircle, Search, Clock, Flag } from 'lucide-react';
import { AudienceSelector } from '../components/PrivacySelector';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
import { resolveMediaUrl } from '../utils/mediaUtils';
import UserHoverCard from '../components/UserHoverCard';
import { useModal } from '../components/BFIModal';
import PhotoEditorModal from '../components/PhotoEditorModal';
import ReportFormModal from '../components/ReportFormModal';

// Custom Ribbon Badge Award Icon
const LaurelAward = ({ size = 20, style = {} }) => {
  const goldColor = '#d4af37';

  // Generate 120 points for the rosette scalloped border
  const rosettePoints = Array.from({ length: 120 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 120;
    const r = 26 + 2.2 * Math.cos(angle * 16); // 16 scallops
    const x = 50 + r * Math.sin(angle);
    const y = 40 - r * Math.cos(angle);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const rosetteOuterPath = `M ${rosettePoints.join(' L ')} Z`;
  
  // Create a compound path for the scalloped ring (outer scalloped path + inner circular hole)
  const rosetteRingPath = `${rosetteOuterPath} M 50,40 m -19.5,0 a 19.5,19.5 0 1,0 39,0 a 19.5,19.5 0 1,0 -39,0`;

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width={size} height={size} style={style} aria-label="Award-Winning Project">
      {/* Ribbons hanging from behind the rosette */}
      <g fill={goldColor}>
        {/* Left Ribbon */}
        <path d="M 37,58 L 20,88 L 31,81 L 42,88 L 46,60 Z" />
        {/* Right Ribbon (Mirrored) */}
        <path d="M 63,58 L 80,88 L 69,81 L 58,88 L 54,60 Z" />
      </g>

      {/* Scalloped Rosette Ring */}
      <path
        d={rosetteRingPath}
        fill={goldColor}
        fillRule="evenodd"
      />

      {/* Central Star */}
      <polygon
        points="50,26.5 53.5,35.1 62.8,35.8 55.7,41.9 57.9,50.9 50,46 42.1,50.9 44.3,41.9 37.2,35.8 46.5,35.1"
        fill={goldColor}
      />
    </svg>
  );
};

let cachedCommunityPosts = [];
let cachedCommunityScrollY = 0;
let cachedCommunityUserId = null;

const NativeEmojiPicker = memo(({ onEmojiSelect, theme }) => {
  const containerRef = useRef(null);
  const onSelectRef = useRef(onEmojiSelect);

  useEffect(() => {
    onSelectRef.current = onEmojiSelect;
  }, [onEmojiSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
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
  }, [theme]);

  return <div ref={containerRef} />;
}, (prevProps, nextProps) => {
  return prevProps.theme === nextProps.theme;
});

const parseCommentContent = (content) => {
  if (!content) return { text: '', image: '' };
  if (content.startsWith('{') && content.endsWith('}')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.text || parsed.image) {
        return { text: parsed.text || '', image: parsed.image || '' };
      }
    } catch (e) {
      // Failed to parse, fallback to legacy
    }
  }
  if (content.startsWith('data:image/')) {
    return { text: '', image: content };
  }
  return { text: content, image: '' };
};

const REACTION_OPTIONS = [
  { type: 'like', emoji: '👍', label: 'Like', color: 'var(--accent-primary)' },
  { type: 'love', emoji: '❤️', label: 'Love', color: '#ff3054' },
  { type: 'care', emoji: '🥰', label: 'Care', color: '#f5c33b' },
  { type: 'haha', emoji: '😆', label: 'Haha', color: '#f5c33b' },
  { type: 'wow', emoji: '😮', label: 'Wow', color: '#f5c33b' },
  { type: 'sad', emoji: '😢', label: 'Sad', color: '#f5c33b' },
  { type: 'angry', emoji: '😡', label: 'Angry', color: '#e74c3c' }
];

export default function Community() {
  const { currentUser } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const navigate = useNavigate();

  // Reactors popup modal state
  const [reactorsModalPostId, setReactorsModalPostId] = useState(null);
  const [reactorsModalCommentId, setReactorsModalCommentId] = useState(null);
  const [reactorsList, setReactorsList] = useState([]);
  const [loadingReactors, setLoadingReactors] = useState(false);
  const [activeReactorTab, setActiveReactorTab] = useState('all');

  // Share dropdown state
  const [activeSharePostId, setActiveSharePostId] = useState(null);

  // "Send to" modal states
  const [shareModalPost, setShareModalPost] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [selectedRecipients, setSelectedRecipients] = useState(new Set());
  const [shareSearchQuery, setShareSearchQuery] = useState('');
  const [shareMessageText, setShareMessageText] = useState('');
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sendingShare, setSendingShare] = useState(false);
  const [postAudience, setPostAudience] = useState('public');
  const [editingPostId, setEditingPostId] = useState(null);
  const [editingPostText, setEditingPostText] = useState('');
  const [editingPostAudience, setEditingPostAudience] = useState('public');
  const [editingPostImages, setEditingPostImages] = useState([]);
  const [activePostMenuId, setActivePostMenuId] = useState(null);
  const [reportPost, setReportPost] = useState(null);
  const [reportComment, setReportComment] = useState(null);
  const [photoEditorMode, setPhotoEditorMode] = useState('new'); // 'new' or 'edit'
  const [selectedProject, setSelectedProject] = useState(null);
  
  // Use cached posts only if the same user is viewing
  const shouldUseCache = currentUser?.id === cachedCommunityUserId;
  const [posts, setPosts] = useState(shouldUseCache ? cachedCommunityPosts : []);
  const [loading, setLoading] = useState(shouldUseCache ? cachedCommunityPosts.length === 0 : true);
  const [content, setContent] = useState('');
  // mediaImages: array of { url: string, editedUrl?: string, caption?: string }
  const [mediaImages, setMediaImages] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProjectTitle, setSelectedProjectTitle] = useState('');
  const [showProjectOptions, setShowProjectOptions] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(null);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerDay, setPickerDay] = useState(new Date().getDate());
  const [pickerHour, setPickerHour] = useState(12);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerPeriod, setPickerPeriod] = useState('PM');
  const [userProjects, setUserProjects] = useState([]);
  const [socket, setSocket] = useState(null);
  const [brokenThumbs, setBrokenThumbs] = useState({});
  const [brokenPostImages, setBrokenPostImages] = useState({});
  const [activeCommentPostId, setActiveCommentPostId] = useState(null);
  const [commentContents, setCommentContents] = useState({}); // postId -> string
  const [commentImages, setCommentImages] = useState({}); // postId -> image base64/url
  const [replyContents, setReplyContents] = useState({}); // commentId -> string
  const [replyImages, setReplyImages] = useState({}); // commentId -> image base64
  const [replyEmojiPickerCommentId, setReplyEmojiPickerCommentId] = useState(null);
  const [activeReplyMentions, setActiveReplyMentions] = useState({}); // commentId -> string (user name)
  const [activeReplyInputCommentId, setActiveReplyInputCommentId] = useState(null);
  const [activeReactionCommentId, setActiveReactionCommentId] = useState(null);
  const [activeReactionPostId, setActiveReactionPostId] = useState(null);
  const [expandedComments, setExpandedComments] = useState({}); // commentId -> boolean
  const [expandedPostComments, setExpandedPostComments] = useState({}); // postId -> boolean
  const hoverTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const isLongPressRef = useRef(false);
  const postHoverTimerRef = useRef(null);
  const postCloseTimerRef = useRef(null);
  const postLongPressTimerRef = useRef(null);
  const isPostLongPressRef = useRef(false);
  const [commentEmojiPickerPostId, setCommentEmojiPickerPostId] = useState(null);
  const [activeCommentMenuId, setActiveCommentMenuId] = useState(null);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [editingCommentImage, setEditingCommentImage] = useState(null);
  const [editingCommentEmojiPickerId, setEditingCommentEmojiPickerId] = useState(null);
  // Photo editor modal state
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [photoEditorIndex, setPhotoEditorIndex] = useState(0);

  // Lightbox state: null | { images: [{url,caption}], idx: number }
  const [lightbox, setLightbox] = useState(null);

  const openLightbox = useCallback((images, idx) => {
    setLightbox({ images, idx });
  }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  const handleDownload = async (imageUrl) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = imageUrl.split('/').pop().split('?')[0] || 'community_attachment.png';
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
  const lightboxNext = useCallback(() =>
    setLightbox(prev => prev && ({ ...prev, idx: Math.min(prev.idx + 1, prev.images.length - 1) }))
  , []);
  const lightboxPrev = useCallback(() =>
    setLightbox(prev => prev && ({ ...prev, idx: Math.max(prev.idx - 1, 0) }))
  , []);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e) => {
      if (e.key === 'ArrowRight') lightboxNext();
      else if (e.key === 'ArrowLeft') lightboxPrev();
      else if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox, lightboxNext, lightboxPrev, closeLightbox]);

  // Drag-and-drop state for image reordering
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // Accept either raw URL strings or already-shaped objects
  const addImages = useCallback((inputs) => {
    setMediaImages(prev => {
      const shaped = inputs.map(item =>
        typeof item === 'string' ? { url: item, editedUrl: undefined, caption: '' } : item
      );
      return [...prev, ...shaped].slice(0, 10);
    });
  }, []);

  const removeImage = useCallback((index) => {
    setMediaImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const openPhotoEditor = useCallback((index, mode = 'new') => {
    setPhotoEditorIndex(index);
    setPhotoEditorMode(mode);
    setPhotoEditorOpen(true);
  }, []);

  const handlePhotoEditorSave = useCallback((updatedImages) => {
    setMediaImages(updatedImages);
    setPhotoEditorOpen(false);
  }, []);

  const removeEditingImage = useCallback((index) => {
    setEditingPostImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditingPhotoEditorSave = useCallback((updatedImages) => {
    setEditingPostImages(updatedImages);
    setPhotoEditorOpen(false);
  }, []);

  const handleDragStart = (index) => { dragItem.current = index; };
  const handleDragEnter = (index) => { dragOverItem.current = index; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    setMediaImages(prev => {
      const arr = [...prev];
      const dragged = arr.splice(dragItem.current, 1)[0];
      arr.splice(dragOverItem.current, 0, dragged);
      return arr;
    });
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleEditingDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    setEditingPostImages(prev => {
      const arr = [...prev];
      const dragged = arr.splice(dragItem.current, 1)[0];
      arr.splice(dragOverItem.current, 0, dragged);
      return arr;
    });
    dragItem.current = null;
    dragOverItem.current = null;
  };


  // YouTube Thumbnail Helper
  const getYoutubeThumbnail = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
    if (!match) return null;
    const id = match[1];
    const rawUrl = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    return `${base}api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
  };

  const getProjectPoster = (proj) => {
    if (brokenThumbs[proj.id]) return null;
    if (proj.thumbnail_url) return resolveMediaUrl(proj.thumbnail_url);
    if (proj.poster_url) return resolveMediaUrl(proj.poster_url);
    return getYoutubeThumbnail(proj.media_link) || null;
  };

  const [playingPostId, setPlayingPostId] = useState(null);
  const socketUrl = import.meta.env.VITE_SOCKET_URL || '';

  const getEmbedUrl = (url, source) => {
    if (!url) return '';
    try {
      if (source === 'youtube' || !source) {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
        return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=1&controls=1&origin=${window.location.origin}` : url;
      }
      if (source === 'vimeo') {
        const match = url.match(/vimeo\.com\/(?:[a-z]*\/)*([0-9]{6,11})[?]?.*/);
        return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=1&muted=1` : url;
      }
      if (source === 'facebook') {
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560&autoplay=true&mute=true`;
      }
    } catch { /* ignore */ }
    return url;
  };

  useEffect(() => {
    fetchPosts();

    // Setup Socket.io for real-time feed
    const token = localStorage.getItem('token');
    const newSocket = io(socketUrl, { 
      withCredentials: true,
      auth: { token }
    });
    setSocket(newSocket);

    newSocket.on('new_post', () => {
      fetchPosts();
    });

    const handleClickOutside = (e) => {
      const path = e.composedPath?.() || [];
      const clickedCommentPickerOrBtn = path.some(el => 
        el instanceof Element && (el.closest('.comment-emoji-picker-container') || el.closest('.comment-icon-btn'))
      );
      const clickedMenuOrRelative = path.some(el => 
        el instanceof Element && (el.closest('.relative-container') || el.closest('.comment-menu-wrapper'))
      );

      if (!clickedMenuOrRelative) {
        setShowProjectOptions(false);
        setActiveCommentMenuId(null);
      }
      if (!clickedCommentPickerOrBtn) {
        setCommentEmojiPickerPostId(null);
        setEditingCommentEmojiPickerId(null);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);

    // Restore scroll position
    if (cachedCommunityPosts.length > 0) {
      window.scrollTo(0, cachedCommunityScrollY);
    }

    const handleScroll = () => {
      cachedCommunityScrollY = window.scrollY;
    };
    window.addEventListener('scroll', handleScroll);

    return () => {
      newSocket.disconnect();
      document.removeEventListener('pointerdown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [socketUrl]);

  useEffect(() => {
    cachedCommunityPosts = posts;
    cachedCommunityUserId = currentUser?.id;
  }, [posts, currentUser?.id]);

  const [fetchingProjects, setFetchingProjects] = useState(false);
  const handleScheduleClick = () => {
    setShowProjectOptions(false);
    const isOpen = !showSchedulePicker;
    setShowSchedulePicker(isOpen);
    
    if (isOpen) {
      const sourceDate = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 60 * 60000);
      setPickerYear(sourceDate.getFullYear());
      setPickerMonth(sourceDate.getMonth());
      setPickerDay(sourceDate.getDate());
      
      let hr = sourceDate.getHours();
      const prd = hr >= 12 ? 'PM' : 'AM';
      hr = hr % 12;
      hr = hr === 0 ? 12 : hr;
      setPickerHour(hr);
      setPickerMinute(sourceDate.getMinutes());
      setPickerPeriod(prd);
    }
  };

  const renderCalendarDays = () => {
    const cells = [];
    const daysInMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
    const firstDayIndex = new Date(pickerYear, pickerMonth, 1).getDay();

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`empty-${i}`} className="calendar-day-empty"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const isSelected = pickerDay === day;
      const isToday = new Date().getDate() === day && new Date().getMonth() === pickerMonth && new Date().getFullYear() === pickerYear;
      
      cells.push(
        <button
          key={`day-${day}`}
          type="button"
          className={`calendar-day-btn ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
          onClick={() => setPickerDay(day)}
        >
          {day}
        </button>
      );
    }
    return cells;
  };

  const handlePrevMonth = () => {
    setPickerMonth(prev => {
      if (prev === 0) {
        setPickerYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setPickerMonth(prev => {
      if (prev === 11) {
        setPickerYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const handleConfirmSchedule = () => {
    let hours24 = pickerHour;
    if (pickerPeriod === 'PM' && hours24 < 12) hours24 += 12;
    if (pickerPeriod === 'AM' && hours24 === 12) hours24 = 0;
    
    const localDate = new Date(pickerYear, pickerMonth, pickerDay, hours24, pickerMinute, 0);
    
    if (localDate <= new Date()) {
      showAlert('Please select a future date and time.', { title: 'Invalid Time' });
      return;
    }
    
    setScheduledAt(localDate.toISOString());
    setShowSchedulePicker(false);
  };

  const handleShareProjectClick = () => {
    setShowSchedulePicker(false);
    if (!showProjectOptions) {
      setFetchingProjects(true);
      fetchUserProjects().finally(() => setFetchingProjects(false));
    }
    setShowProjectOptions(!showProjectOptions);
  };

  const fetchUserProjects = async () => {
    try {
      const res = await fetch('/api/portfolio', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) setUserProjects(await res.json());
    } catch (err) {
      console.error('Fetch user projects failed', err);
    }
  };

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    
    if (files.length > 0) {
      e.preventDefault();
      const readers = files.map(file => new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      }));
      Promise.all(readers).then(urls => {
        addImages(urls);
        setSelectedProjectId(null);
        setSelectedProjectTitle('');
      });
    }
  }, [addImages]);

  const handleCommentPaste = useCallback((e, postId) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    let file = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        file = items[i].getAsFile();
        break;
      }
    }
    
    if (file) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onloadend = () => {
        setCommentImages(prev => ({ ...prev, [postId]: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleReplyPaste = useCallback((e, commentId) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    let file = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        file = items[i].getAsFile();
        break;
      }
    }
    
    if (file) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onloadend = () => {
        setReplyImages(prev => ({ ...prev, [commentId]: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/community/posts', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) setPosts(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const location = useLocation();

  const forceHighlight = useCallback((postId) => {
    const el = document.getElementById(`post-${postId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('highlight-animation');
      // Trigger a reflow to restart CSS animation
      void el.offsetWidth;
      el.classList.add('highlight-animation');
      setTimeout(() => el.classList.remove('highlight-animation'), 3000);
    }
  }, []);

  // Listen to forced highlight event (e.g. from clicking notifications)
  useEffect(() => {
    const handleTriggerHighlight = (e) => {
      if (e.detail) {
        setTimeout(() => forceHighlight(e.detail), 150);
      }
    };
    window.addEventListener('triggerPostHighlight', handleTriggerHighlight);
    return () => window.removeEventListener('triggerPostHighlight', handleTriggerHighlight);
  }, [forceHighlight]);

  // Scroll to targeted post from URL hash on load
  useEffect(() => {
    if (!loading && posts.length > 0 && location.hash) {
      const id = location.hash.substring(1); // e.g. post-123
      if (id.startsWith('post-')) {
        const postId = id.split('post-')[1];
        setTimeout(() => forceHighlight(postId), 300);
      }
    }
  }, [loading, posts.length, location.hash, forceHighlight]);

  // Fetch post or comment reactors list when modal is opened
  useEffect(() => {
    const targetId = reactorsModalPostId || reactorsModalCommentId;
    if (!targetId) {
      setReactorsList([]);
      return;
    }
    const endpoint = reactorsModalPostId
      ? `/api/community/posts/${reactorsModalPostId}/reactors`
      : `/api/community/comments/${reactorsModalCommentId}/reactors`;
    setLoadingReactors(true);
    setActiveReactorTab('all');
    fetch(endpoint, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch reactors');
        return res.json();
      })
      .then(data => {
        setReactorsList(data);
      })
      .catch(err => {
        console.error('Error fetching reactors:', err);
        showAlert('Failed to fetch reactors list.', { title: 'Error' });
        setReactorsModalPostId(null);
        setReactorsModalCommentId(null);
      })
      .finally(() => {
        setLoadingReactors(false);
      });
  }, [reactorsModalPostId, reactorsModalCommentId]);

  // Handle outside clicks to close the share dropdown
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (activeSharePostId && !e.target.closest('.share-btn-container')) {
        setActiveSharePostId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [activeSharePostId]);

  // Handle outside clicks to close the post options dropdown
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (activePostMenuId && !e.target.closest('.post-menu-container')) {
        setActivePostMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [activePostMenuId]);

  // Fetch recipients list when share modal is opened or query changes
  useEffect(() => {
    if (!shareModalPost) {
      setRecipients([]);
      return;
    }
    setLoadingRecipients(true);
    const delayDebounce = setTimeout(() => {
      const url = shareSearchQuery 
        ? `/api/inbox/recipients?q=${encodeURIComponent(shareSearchQuery)}` 
        : '/api/inbox/recipients';
        
      fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch recipients');
          return res.json();
        })
        .then(data => {
          setRecipients(data.users || []);
        })
        .catch(err => {
          console.error('Error fetching recipients:', err);
        })
        .finally(() => {
          setLoadingRecipients(false);
        });
    }, shareSearchQuery ? 300 : 0);

    return () => clearTimeout(delayDebounce);
  }, [shareModalPost, shareSearchQuery]);

  const handlePostSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim() && mediaImages.length === 0 && !selectedProjectId) return;

    // Build the payload: use editedUrl (canvas render) when available, keep caption
    // Single image → plain string for backward-compat; multiple → JSON array of objects
    let mediaUrlPayload = null;
    if (mediaImages.length === 1) {
      const img = mediaImages[0];
      const finalUrl = img.editedUrl ?? img.url;
      // If there's a caption wrap in object, otherwise keep plain string
      mediaUrlPayload = img.caption
        ? JSON.stringify([{ url: finalUrl, caption: img.caption }])
        : finalUrl;
    } else if (mediaImages.length > 1) {
      const shaped = mediaImages.map(img => ({
        url: img.editedUrl ?? img.url,
        caption: img.caption ?? ''
      }));
      mediaUrlPayload = JSON.stringify(shaped);
    }

    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          content, 
          media_url: mediaUrlPayload,
          project_id: selectedProjectId,
          audience: postAudience,
          scheduled_at: scheduledAt
        })
      });

      if (res.ok) {
        const data = await res.json();
        setContent('');
        setMediaImages([]);
        setSelectedProjectId(null);
        setSelectedProjectTitle('');
        setPostAudience('public');
        setScheduledAt(null);
        setShowSchedulePicker(false);
        fetchPosts();
        if (socket && !scheduledAt) socket.emit('new_post', { user: currentUser.username });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const readers = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(urls => {
      addImages(urls);
      setSelectedProjectId(null);
      setSelectedProjectTitle('');
    });
    e.target.value = '';
  };

  const handleEditingFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const readers = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(urls => {
      setEditingPostImages(prev => {
        const shaped = urls.map(url => ({ url, editedUrl: undefined, caption: '' }));
        return [...prev, ...shaped].slice(0, 10);
      });
    });
    e.target.value = '';
  };

  const selectProject = (proj) => {
    setSelectedProjectId(proj.id);
    setSelectedProjectTitle(proj.title);
    setMediaImages([]);
    setShowProjectOptions(false);
  };

  const handleDeletePost = async (postId) => {
    if (!postId) return;
    
    const confirmed = await showConfirm(
      "Are you sure you want to delete this? If it's a shared project, it will also be removed from the community section.",
      { title: 'Delete Post', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/community/posts/${postId}`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (res.ok) {
        setPosts(prev => prev.filter(p => p.id !== postId));
        if (socket) socket.emit('new_post', { action: 'delete', postId });
      } else {
        const err = await res.json();
        await showAlert('Delete failed: ' + (err.error || 'Server error'), { title: 'Error' });
      }
    } catch (err) {
      console.error('Fetch error:', err);
      await showAlert('Connection error: ' + err.message, { title: 'Connection Error' });
    }
  };

  const handleEditPostStart = (post) => {
    setEditingPostId(post.id);
    setEditingPostText(post.content || '');
    setEditingPostAudience(post.audience || 'public');
    
    let rawImages = [];
    if (post.media_type === 'image' && post.media_url) {
      try {
        const parsed = JSON.parse(post.media_url);
        rawImages = Array.isArray(parsed) ? parsed : [post.media_url];
      } catch {
        rawImages = [post.media_url];
      }
    }
    const images = rawImages.map(item =>
      typeof item === 'string'
        ? { url: item, editedUrl: undefined, caption: '' }
        : { url: item.url ?? item, editedUrl: undefined, caption: item.caption ?? '' }
    );
    setEditingPostImages(images);
  };

  const handleEditPostCancel = () => {
    setEditingPostId(null);
    setEditingPostText('');
    setEditingPostAudience('public');
    setEditingPostImages([]);
  };

  const handleEditPostSave = async (postId) => {
    let mediaUrlPayload = null;
    if (editingPostImages.length === 1) {
      const img = editingPostImages[0];
      const finalUrl = img.editedUrl ?? img.url;
      mediaUrlPayload = img.caption
        ? JSON.stringify([{ url: finalUrl, caption: img.caption }])
        : finalUrl;
    } else if (editingPostImages.length > 1) {
      const shaped = editingPostImages.map(img => ({
        url: img.editedUrl ?? img.url,
        caption: img.caption ?? ''
      }));
      mediaUrlPayload = JSON.stringify(shaped);
    }

    try {
      const res = await fetch(`/api/community/posts/${postId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          content: editingPostText,
          audience: editingPostAudience,
          media_url: mediaUrlPayload
        })
      });

      if (res.ok) {
        setEditingPostId(null);
        setEditingPostText('');
        setEditingPostImages([]);
        fetchPosts();
        if (socket) socket.emit('new_post');
      } else {
        const err = await res.json();
        showAlert(err.error || 'Failed to update post', { title: 'Error' });
      }
    } catch (err) {
      console.error(err);
      showAlert('Failed to update post', { title: 'Error' });
    }
  };

  const handlePinPost = async (postId, isCurrentlyPinned) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ pin: !isCurrentlyPinned })
      });
      
      if (res.ok) {
        fetchPosts();
        if (socket) socket.emit('new_post', { action: 'pin', postId });
      } else {
        const err = await res.json();
        await showAlert('Pin failed: ' + (err.error || 'Server error'), { title: 'Error' });
      }
    } catch (err) {
      console.error('Pin failed', err);
      await showAlert('Connection error while pinning', { title: 'Connection Error' });
    }
  };

  const toggleLike = async (postId, reactionType = 'like') => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/like`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}` 
        },
        body: JSON.stringify({ reaction_type: reactionType })
      });
      if (res.ok) {
        const data = await res.json();
        setPosts(posts.map(p => {
          if (p.id === postId) {
            let updatedReactions = [...(p.reactions || [])];
            if (data.liked) {
              if (!updatedReactions.includes(data.reaction_type)) {
                updatedReactions.push(data.reaction_type);
              }
            }
            return {
              ...p,
              is_liked: data.liked,
              user_reaction: data.reaction_type,
              reactions: updatedReactions.filter(Boolean),
              likes_count: data.liked 
                ? (p.is_liked ? p.likes_count : p.likes_count + 1) 
                : (p.is_liked ? p.likes_count - 1 : p.likes_count)
            };
          }
          return p;
        }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCommentSubmit = async (postId) => {
    const postContentText = commentContents[postId] || '';
    const postCommentImage = commentImages[postId] || null;
    if (!postContentText.trim() && !postCommentImage) return;

    let finalContent = '';
    if (postCommentImage && postContentText.trim()) {
      finalContent = JSON.stringify({ text: postContentText.trim(), image: postCommentImage });
    } else if (postCommentImage) {
      finalContent = postCommentImage;
    } else {
      finalContent = postContentText.trim();
    }

    try {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ content: finalContent })
      });
      
      if (res.ok) {
        setCommentContents(prev => ({ ...prev, [postId]: '' }));
        setCommentImages(prev => ({ ...prev, [postId]: null }));
        fetchPosts();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleCommentLike = async (postId, commentId, reactionType = 'like') => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/comments/${commentId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ reaction_type: reactionType })
      });
      if (res.ok) {
        fetchPosts();
      }
    } catch (err) {
      console.error('Error toggling comment like:', err);
    }
  };

  const handleReplySubmit = async (postId, parentCommentId) => {
    const replyText = replyContents[parentCommentId] || '';
    const mention = activeReplyMentions[parentCommentId];
    
    let combinedText = replyText.trim();
    if (mention) {
      combinedText = `${mention} ${combinedText}`.trim();
    }
    
    const replyImage = replyImages[parentCommentId] || null;
    if (!combinedText && !replyImage) return;

    let finalContent = '';
    if (replyImage && combinedText) {
      finalContent = JSON.stringify({ text: combinedText, image: replyImage });
    } else if (replyImage) {
      finalContent = replyImage;
    } else {
      finalContent = combinedText;
    }

    try {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ content: finalContent, parent_id: parentCommentId })
      });
      
      if (res.ok) {
        setReplyContents(prev => ({ ...prev, [parentCommentId]: '' }));
        setReplyImages(prev => ({ ...prev, [parentCommentId]: null }));
        setActiveReplyMentions(prev => ({ ...prev, [parentCommentId]: null }));
        setReplyEmojiPickerCommentId(null);
        fetchPosts();
      }
    } catch (err) {
      console.error('Error submitting reply:', err);
    }
  };

  const handleLikeButtonMouseEnter = (commentId) => {
    if (window.matchMedia('(hover: hover)').matches) {
      clearTimeout(hoverTimerRef.current);
      clearTimeout(closeTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        setActiveReactionCommentId(commentId);
      }, 400);
    }
  };

  const handleLikeButtonMouseLeave = (commentId) => {
    if (window.matchMedia('(hover: hover)').matches) {
      clearTimeout(hoverTimerRef.current);
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setActiveReactionCommentId(current => current === commentId ? null : current);
      }, 600);
    }
  };

  const handlePopupMouseEnter = () => {
    clearTimeout(closeTimerRef.current);
  };

  const handleReactionSelect = (postId, commentId, reactionType) => {
    setActiveReactionCommentId(null);
    clearTimeout(closeTimerRef.current);
    toggleCommentLike(postId, commentId, reactionType);
  };

  const handleLikeButtonClick = (postId, commentId, currentReaction) => {
    if (isLongPressRef.current) return;
    if (currentReaction) {
      toggleCommentLike(postId, commentId, currentReaction);
    } else {
      toggleCommentLike(postId, commentId, 'like');
    }
  };

  const handleLikeButtonTouchStart = (e, postId, commentId, currentReaction) => {
    clearTimeout(longPressTimerRef.current);
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setActiveReactionCommentId(commentId);
      if (navigator.vibrate) {
        try { navigator.vibrate(50); } catch (err) { /* ignore vibration failure */ }
      }
    }, 500);
  };

  const handleLikeButtonTouchEnd = (e, postId, commentId, currentReaction) => {
    clearTimeout(longPressTimerRef.current);
    if (!isLongPressRef.current) {
      handleLikeButtonClick(postId, commentId, currentReaction);
    }
  };

  const handleLikeButtonTouchMove = () => {
    clearTimeout(longPressTimerRef.current);
  };

  // ── Post Reaction Handlers ──
  const handlePostLikeMouseEnter = (postId) => {
    if (window.matchMedia('(hover: hover)').matches) {
      clearTimeout(postHoverTimerRef.current);
      clearTimeout(postCloseTimerRef.current);
      postHoverTimerRef.current = setTimeout(() => {
        setActiveReactionPostId(postId);
      }, 400);
    }
  };

  const handlePostLikeMouseLeave = (postId) => {
    if (window.matchMedia('(hover: hover)').matches) {
      clearTimeout(postHoverTimerRef.current);
      clearTimeout(postCloseTimerRef.current);
      postCloseTimerRef.current = setTimeout(() => {
        setActiveReactionPostId(current => current === postId ? null : current);
      }, 600);
    }
  };

  const handlePostPopupMouseEnter = () => {
    clearTimeout(postCloseTimerRef.current);
  };

  const handlePostReactionSelect = (postId, reactionType) => {
    setActiveReactionPostId(null);
    clearTimeout(postCloseTimerRef.current);
    toggleLike(postId, reactionType);
  };

  const handlePostLikeClick = (postId, currentReaction) => {
    if (isPostLongPressRef.current) return;
    if (currentReaction) {
      toggleLike(postId, currentReaction);
    } else {
      toggleLike(postId, 'like');
    }
  };

  const handlePostLikeTouchStart = (e, postId) => {
    clearTimeout(postLongPressTimerRef.current);
    isPostLongPressRef.current = false;
    postLongPressTimerRef.current = setTimeout(() => {
      isPostLongPressRef.current = true;
      setActiveReactionPostId(postId);
      if (navigator.vibrate) {
        try { navigator.vibrate(50); } catch (err) { /* ignore vibration failure */ }
      }
    }, 500);
  };

  const handlePostLikeTouchEnd = (e, postId, currentReaction) => {
    clearTimeout(postLongPressTimerRef.current);
    if (!isPostLongPressRef.current) {
      handlePostLikeClick(postId, currentReaction);
    }
  };

  const handlePostLikeTouchMove = () => {
    clearTimeout(postLongPressTimerRef.current);
  };

  const handleCommentDelete = async (postId, commentId) => {
    setActiveCommentMenuId(null);
    const confirmed = await showConfirm(
      "Are you sure you want to delete this comment?",
      { title: 'Delete Comment', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/community/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        fetchPosts();
      } else {
        const err = await res.json();
        showAlert(err.error || 'Failed to delete comment', { title: 'Error' });
      }
    } catch (err) {
      console.error(err);
      showAlert('Failed to delete comment', { title: 'Error' });
    }
  };

  const handleCommentEditStart = (comment) => {
    setActiveCommentMenuId(null);
    setEditingCommentId(comment.id);
    const { text, image } = parseCommentContent(comment.content);
    setEditingCommentText(text || comment.content);
    setEditingCommentImage(image || null);
    setEditingCommentEmojiPickerId(null);
  };

  const handleCommentEditCancel = () => {
    setEditingCommentId(null);
    setEditingCommentText('');
    setEditingCommentImage(null);
    setEditingCommentEmojiPickerId(null);
  };

  const handleCommentEditSave = async (postId, comment) => {
    if (!editingCommentText.trim() && !editingCommentImage) return;
    
    let finalContent = editingCommentText.trim();
    if (editingCommentImage) {
      finalContent = JSON.stringify({ text: editingCommentText.trim(), image: editingCommentImage });
    }

    try {
      const res = await fetch(`/api/community/posts/${postId}/comments/${comment.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ content: finalContent })
      });
      if (res.ok) {
        setEditingCommentId(null);
        setEditingCommentText('');
        setEditingCommentImage(null);
        setEditingCommentEmojiPickerId(null);
        fetchPosts();
      } else {
        const err = await res.json();
        showAlert(err.error || 'Failed to update comment', { title: 'Error' });
      }
    } catch (err) {
      console.error(err);
      showAlert('Failed to update comment', { title: 'Error' });
    }
  };

  const handleCommentReport = (postId, comment) => {
    setActiveCommentMenuId(null);
    setReportComment({ ...comment, postId });
  };

  const submitCommentReport = async ({ reason_category, reason_detail, screenshot_path }) => {
    const { text } = parseCommentContent(reportComment.content);
    const res = await fetch('/api/reports/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({
        content_type: 'comment',
        content_id: Number(reportComment.id),
        reason_category,
        reason_detail,
        screenshot_path,
        content_snapshot: text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409) {
        window.dispatchEvent(new CustomEvent('showNotificationToast', {
          detail: { type: 'report', title: 'Already Reported', message: "You've already reported this." },
        }));
        return;
      }
      throw new Error(data.error || 'Failed to report comment');
    }
    window.dispatchEvent(new CustomEvent('showNotificationToast', {
      detail: { type: 'report', title: 'Report Submitted', message: 'Report submitted. Our team will review it.' },
    }));
  };

  const handlePostReport = async ({ reason_category, reason_detail, screenshot_path }) => {
    const response = await fetch('/api/reports/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({
        content_type: 'post',
        content_id: Number(reportPost.id),
        reported_user_id: Number(reportPost.user_id),
        reason_category,
        reason_detail,
        screenshot_path,
        content_snapshot: reportPost.content || '',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) {
        window.dispatchEvent(new CustomEvent('showNotificationToast', {
          detail: { type: 'report', title: 'Already Reported', message: "You've already reported this." },
        }));
        return;
      }
      throw new Error(data.error || 'Unable to submit this report.');
    }
    window.dispatchEvent(new CustomEvent('showNotificationToast', {
      detail: { type: 'report', title: 'Report Submitted', message: 'Report submitted. Our team will review it.' },
    }));
  };

  const handleShareOptionClick = async (post, option) => {
    setActiveSharePostId(null);
    const shareUrl = `${window.location.origin}/community#post-${post.id}`;
    const shareText = `${post.first_name} ${post.last_name} shared on BFI Community:\n\n${post.content ? post.content.substring(0, 100) + '...' : 'Check out this post!'}`;

    const recordShare = async () => {
      try {
        const response = await fetch(`/api/community/posts/${post.id}/share`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        if (response.ok) {
          setPosts(prev => prev.map(p => p.id === post.id ? { ...p, shares_count: (p.shares_count || 0) + 1 } : p));
        }
      } catch (err) {
        console.error('Error tracking post share:', err);
      }
    };

    if (option === 'copy') {
      try {
        await navigator.clipboard.writeText(shareUrl);
        await showAlert('Post link copied to clipboard!', { title: 'Copied!' });
        await recordShare();
      } catch (err) {
        console.error('Copy failed:', err);
        await showAlert('Failed to copy link. Please manually copy the URL.', { title: 'Copy Failed' });
      }
    } else if (option === 'message') {
      setShareModalPost(post);
      setShareSearchQuery('');
      setSelectedRecipients(new Set());
      setShareMessageText('');
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    // SQLite timestamps are typically UTC but lack the Z suffix
    const safeDateStr = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(safeDateStr);
    return isNaN(d) ? '' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  };


  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Community...</h2></div>;

  return (
    <div className="page-container container" style={{ maxWidth: '800px', paddingBottom: '4rem' }}>
      
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>BFI Community</h1>
        <p className="subtitle">Connect, discuss, and share your filmmaking journey.</p>
      </div>

      {/* Post Composer */}
      <div className="glass-panel composer-card" style={{ padding: '1.5rem', marginBottom: '2.5rem', position: 'relative', zIndex: 9999, isolation: 'isolate' }}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div className="avatar composer-avatar" style={{ overflow: 'hidden', background: 'var(--bg-gradient-primary)' }}>
            {currentUser?.profile_picture ? (
              <img src={resolveMediaUrl(currentUser.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
            )}
          </div>
          <textarea 
            className="input-glass"
            placeholder="What's on your mind? Share an idea, question, or image..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{ flex: 1, minHeight: '80px', padding: '1rem', resize: 'vertical' }}
            onPaste={handlePaste}
          />
        </div>
        
        {mediaImages.length > 0 && (
          <div className="media-grid-wrapper" style={{ marginBottom: '1rem', marginLeft: '3.5rem' }}>
            <div className={`media-grid media-grid-${Math.min(mediaImages.length, 4)}`}>
              {mediaImages.map((imgObj, idx) => {
                const displaySrc = imgObj.editedUrl ?? imgObj.url;
                const hasCaption = imgObj.caption?.trim();
                const isEdited = !!imgObj.editedUrl;
                return (
                  <div
                    key={idx}
                    className={`media-grid-item${idx === 0 && mediaImages.length >= 3 ? ' media-grid-item--hero' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd}
                    onDragOver={e => e.preventDefault()}
                  >
                    <img
                      src={displaySrc}
                      alt={`Image ${idx + 1}`}
                      onError={e => { e.target.style.display = 'none'; }}
                    />

                    {/* Remove button */}
                    <button
                      className="media-grid-remove"
                      onClick={e => { e.preventDefault(); removeImage(idx); }}
                      title="Remove image"
                    >
                      <X size={12} />
                    </button>

                    {/* Edit button */}
                    <button
                      className="media-grid-edit"
                      onClick={e => { e.preventDefault(); openPhotoEditor(idx); }}
                      title="Edit photo"
                    >
                      <Pencil size={12} />
                    </button>

                    {/* Drag handle */}
                    <div className="media-grid-drag-handle" title="Drag to reorder">
                      <GripVertical size={14} />
                    </div>

                    {/* Edited badge */}
                    {isEdited && (
                      <div className="media-grid-edited-badge">Edited</div>
                    )}

                    {/* Caption badge */}
                    {hasCaption && (
                      <div className="media-grid-caption-badge">
                        {imgObj.caption}
                      </div>
                    )}

                    {/* Overflow counter */}
                    {idx === 3 && mediaImages.length > 4 && (
                      <div className="media-grid-overflow-badge">+{mediaImages.length - 4}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="media-grid-hint">Drag to reorder · ✕ remove · ✎ edit &amp; caption · Max 10 photos</p>
          </div>
        )}

        {/* Photo Editor Modal */}
        {photoEditorOpen && (
          <PhotoEditorModal
            images={photoEditorMode === 'new' ? mediaImages : editingPostImages}
            initialIndex={photoEditorIndex}
            onSave={photoEditorMode === 'new' ? handlePhotoEditorSave : handleEditingPhotoEditorSave}
            onClose={() => setPhotoEditorOpen(false)}
          />
        )}

        {selectedProjectId && (
          <div className="shared-project-card active" style={{ marginBottom: '1rem', marginLeft: '3.5rem', position: 'relative' }}>
            <Film className="shared-icon" size={20} />
            <div className="shared-details">
              <span className="shared-label">Sharing Project</span>
              <h4 style={{ fontSize: '0.95rem' }}>{selectedProjectTitle}</h4>
            </div>
            <button 
              onClick={() => { setSelectedProjectId(null); setSelectedProjectTitle(''); }} 
              style={{ 
                position: 'absolute', 
                top: '10px', 
                right: '10px', 
                background: 'rgba(225, 29, 72, 0.9)', 
                color: 'white', 
                border: 'none', 
                borderRadius: '50%', 
                width: '24px', 
                height: '24px', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
              }}
            >
              ✕
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginLeft: '3.5rem' }}>
          <div className="relative-container" style={{ display: 'flex', gap: '0.5rem', position: 'relative', zIndex: 10000 }}>
            <div>
              <label 
                className="btn btn-glass" 
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer' }}
                onClick={() => setShowProjectOptions(false)}
              >
                <ImageIcon size={16} /> Image
                <input 
                  type="file" 
                  accept="image/*" 
                  multiple 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }} 
                />
              </label>
            </div>

            <div style={{ position: 'relative' }}>
              <button 
                className={`btn btn-glass ${showProjectOptions ? 'active' : ''}`} 
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                onClick={handleShareProjectClick}
              >
                <Film size={16} /> Share Project
              </button>

              {showProjectOptions && (
                <div className="bfi-community-dropdown project-dropdown animate-fade-in">
                  <div className="dropdown-header">
                    Select a Project to Share
                  </div>
                  <div className="dropdown-scroll custom-scrollbar">
                    {fetchingProjects ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div className="loader-spinner" style={{ width: '20px', height: '20px', margin: '0 auto 0.5rem' }}></div>
                        <span>Loading projects...</span>
                      </div>
                    ) : userProjects.length > 0 ? (
                      userProjects.map(proj => (
                        <button key={proj.id} className="project-option-item" onClick={() => selectProject(proj)}>
                          <div className="proj-mini-thumb">
                            {getProjectPoster(proj) ? (
                              <img 
                                src={getProjectPoster(proj)} 
                                alt="" 
                                onError={() => setBrokenThumbs(prev => ({...prev, [proj.id]: true}))}
                              />
                            ) : (
                              <Film size={14} opacity={0.5} />
                            )}
                          </div>
                          <div className="proj-info">
                            <span className="proj-name">{proj.title}</span>
                            <span className="proj-meta">{proj.genre} • {proj.duration}</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-dropdown" style={{ padding: '2rem', textAlign: 'center', opacity: 0.6 }}>
                        <Film size={32} style={{ marginBottom: '0.75rem', display: 'block', margin: '0 auto' }} />
                        <p style={{ fontSize: '0.85rem' }}>No projects found in your portfolio.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <button 
                className={`btn btn-glass ${scheduledAt ? 'scheduled-active' : ''}`}
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: scheduledAt ? 'var(--primary)' : 'inherit' }}
                onClick={handleScheduleClick}
              >
                <Clock size={16} /> {scheduledAt ? 'Scheduled' : 'Schedule'}
              </button>

              {showSchedulePicker && (
                <div className="bfi-community-dropdown schedule-dropdown animate-fade-in" style={{ width: '280px', padding: '1rem', right: 'auto', left: 0 }}>
                  <div className="dropdown-header" style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', fontWeight: 600, color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', padding: '0 0 0.5rem' }}>
                    <span>Schedule Post</span>
                    <button 
                      type="button" 
                      onClick={() => setShowSchedulePicker(false)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}
                    >
                      &times;
                    </button>
                  </div>
                  
                  {/* Calendar Month Selector */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <button 
                      type="button" 
                      onClick={(e) => { e.stopPropagation(); handlePrevMonth(); }}
                      className="btn btn-glass"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto', minWidth: 'auto' }}
                    >
                      &larr;
                    </button>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {[
                        "January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"
                      ][pickerMonth]} {pickerYear}
                    </span>
                    <button 
                      type="button" 
                      onClick={(e) => { e.stopPropagation(); handleNextMonth(); }}
                      className="btn btn-glass"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto', minWidth: 'auto' }}
                    >
                      &rarr;
                    </button>
                  </div>

                  {/* Calendar Weekday Names */}
                  <div className="calendar-grid" style={{ marginBottom: '0.25rem' }}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                      <div key={day} className="calendar-weekday">{day}</div>
                    ))}
                  </div>

                  {/* Calendar Day Buttons */}
                  <div className="calendar-grid" style={{ marginBottom: '0.75rem' }}>
                    {renderCalendarDays()}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', textAlign: 'center' }}>Time (Local Time)</label>
                    
                    {/* Time Select Boxes */}
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center' }}>
                      <select 
                        value={pickerHour} 
                        onChange={(e) => setPickerHour(parseInt(e.target.value))}
                        className="time-picker-select"
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <span style={{ color: 'var(--text-muted)' }}>:</span>
                      <select 
                        value={pickerMinute} 
                        onChange={(e) => setPickerMinute(parseInt(e.target.value))}
                        className="time-picker-select"
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        {Array.from({ length: 60 }, (_, i) => i).map(m => (
                          <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                        ))}
                      </select>
                      <select 
                        value={pickerPeriod} 
                        onChange={(e) => setPickerPeriod(e.target.value)}
                        className="time-picker-select"
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>

                    {/* Constructed Selected String */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.25rem', lineHeight: 1.4 }}>
                      Selected:<br />
                      <strong style={{ color: 'var(--text-main)' }}>
                        {[
                          "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
                        ][pickerMonth]} {pickerDay}, {pickerYear} @ {pickerHour}:{pickerMinute.toString().padStart(2, '0')} {pickerPeriod}
                      </strong>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      {scheduledAt && (
                        <button 
                          className="btn btn-glass btn-sm" 
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => {
                            setScheduledAt(null);
                            setShowSchedulePicker(false);
                          }}
                        >
                          Clear
                        </button>
                      )}
                      <button 
                        className="btn btn-primary btn-sm" 
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}
                        onClick={handleConfirmSchedule}
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <AudienceSelector value={postAudience} onChange={setPostAudience} />
            <button className="btn btn-primary" onClick={handlePostSubmit} disabled={!content.trim() && mediaImages.length === 0 && !selectedProjectId}>
              <Send size={16} style={{ marginLeft: '-4px' }} /> Post
            </button>
          </div>
        </div>
      </div>

      {/* Feed Area */}
      <div className="feed-container" style={{ position: 'relative', zIndex: 1 }}>
        {posts.map(post => {
          const hasActivePicker = commentEmojiPickerPostId === post.id || (editingCommentId && post.comments?.some(c => c.id === editingCommentId));
          const isOwner = Number(post.user_id) === Number(currentUser?.id) || post.username === currentUser?.username;
          const isAdmin = currentUser?.role === 'admin';
          return (
            <div id={`post-${post.id}`} key={post.id} className={`post-card glass-panel ${post.is_pinned ? 'pinned-post' : ''} ${hasActivePicker ? 'active-picker' : ''}`}>
            
            {/* Post Header */}
            <div className="post-header">
              <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
                <UserHoverCard userId={post.user_id}>
                  <div className="avatar" style={{ 
                    background: post.is_pinned ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {post.profile_picture ? (
                      <img src={resolveMediaUrl(post.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                    )}
                  </div>
                </UserHoverCard>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <UserHoverCard userId={post.user_id}>
                        <h4 className="post-author" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: 0 }}>
                          {post.first_name} {post.last_name}
                          {post.role === 'instructor' && (
                            <span style={{ 
                              fontSize: '0.7rem', 
                              background: 'rgba(225, 29, 72, 0.15)', 
                              color: 'var(--accent-primary)', 
                              padding: '2px 8px', 
                              borderRadius: '12px',
                              border: '1px solid rgba(225, 29, 72, 0.3)',
                              fontWeight: '600',
                              letterSpacing: '0.5px',
                              textTransform: 'uppercase'
                            }}>
                              Teacher
                            </span>
                          )}
                        </h4>
                      </UserHoverCard>
                      {post.is_pinned && <span className="pinned-badge"><Pin size={10} /> Pinned by Admin</span>}
                    </div>
                    
                    {/* Post Options Menu (3-dot) */}
                    {(isOwner || isAdmin || currentUser?.role !== 'admin') && (
                      <div className="post-menu-container" style={{ position: 'relative' }}>
                        <button
                          className={`post-menu-trigger ${activePostMenuId === post.id ? 'active' : ''}`}
                          onClick={() => setActivePostMenuId(activePostMenuId === post.id ? null : post.id)}
                          title="Post Options"
                        >
                          <MoreVertical size={16} />
                        </button>
                        
                        {activePostMenuId === post.id && (
                          <div className="post-menu-dropdown bfi-community-dropdown animate-fade-in" style={{ right: 0, left: 'auto' }}>
                            {isAdmin && (
                              <button
                                className="post-menu-item"
                                onClick={() => {
                                  handlePinPost(post.id, post.is_pinned);
                                  setActivePostMenuId(null);
                                }}
                              >
                                {post.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
                                <span>{post.is_pinned ? 'Unpin Post' : 'Pin Post'}</span>
                              </button>
                            )}
                            {(isOwner || isAdmin) && (
                              <>
                                <button
                                  className="post-menu-item"
                                  onClick={() => {
                                    handleEditPostStart(post);
                                    setActivePostMenuId(null);
                                  }}
                                >
                                  <Pencil size={14} />
                                  <span>Edit Post</span>
                                </button>
                                <button
                                  className="post-menu-item delete"
                                  onClick={() => {
                                    handleDeletePost(post.id);
                                    setActivePostMenuId(null);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete Post</span>
                                </button>
                              </>
                            )}
                            {!isOwner && currentUser?.role !== 'admin' && (
                              <button
                                className="post-menu-item delete"
                                onClick={() => {
                                  setReportPost(post);
                                  setActivePostMenuId(null);
                                }}
                              >
                                <Flag size={14} />
                                <span>Report Post</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="post-time" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {formatTime(post.scheduled_at || post.created_at)}
                    <span style={{ display: 'inline-flex', opacity: 0.6 }} title={`Audience: ${post.audience || 'public'}`}>
                      {post.audience === 'only_me' && <EyeOff size={12} />}
                      {post.audience === 'batchmates' && <GraduationCap size={12} />}
                      {(!post.audience || post.audience === 'public') && <Globe size={12} />}
                    </span>
                    {post.scheduled_at && new Date(post.scheduled_at) > new Date() && (
                      <span className="scheduled-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '1px 6px', fontSize: '0.7rem', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', borderRadius: '4px', fontWeight: '500', border: '1px solid rgba(234, 179, 8, 0.3)' }} title={`Scheduled for ${new Date(post.scheduled_at).toLocaleString()}`}>
                        <Clock size={10} /> Scheduled
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Post Content */}
            <div className="post-body">
              {editingPostId === post.id ? (
                <div className="post-edit-container">
                  <textarea
                    className="input-glass"
                    value={editingPostText}
                    onChange={(e) => setEditingPostText(e.target.value)}
                    style={{ width: '100%', minHeight: '80px', padding: '0.75rem', resize: 'vertical' }}
                  />

                  {editingPostImages.length > 0 && (
                    <div className="media-grid-wrapper" style={{ marginBottom: '0.5rem' }}>
                      <div className={`media-grid media-grid-${Math.min(editingPostImages.length, 4)}`}>
                        {editingPostImages.map((imgObj, idx) => {
                          const displaySrc = imgObj.editedUrl ?? imgObj.url;
                          const hasCaption = imgObj.caption?.trim();
                          const isEdited = !!imgObj.editedUrl;
                          return (
                            <div
                              key={idx}
                              className={`media-grid-item${idx === 0 && editingPostImages.length >= 3 ? ' media-grid-item--hero' : ''}`}
                              draggable
                              onDragStart={() => handleDragStart(idx)}
                              onDragEnter={() => handleDragEnter(idx)}
                              onDragEnd={handleEditingDragEnd}
                              onDragOver={e => e.preventDefault()}
                            >
                              <img
                                src={resolveMediaUrl(displaySrc)}
                                alt={`Image ${idx + 1}`}
                                onError={e => { e.target.style.display = 'none'; }}
                              />

                              {/* Remove button */}
                              <button
                                  className="media-grid-remove"
                                  onClick={e => { e.preventDefault(); removeEditingImage(idx); }}
                                  title="Remove image"
                              >
                                <X size={12} />
                              </button>

                              {/* Edit button */}
                              <button
                                  className="media-grid-edit"
                                  onClick={e => { e.preventDefault(); openPhotoEditor(idx, 'edit'); }}
                                  title="Edit photo"
                              >
                                <Pencil size={12} />
                              </button>

                              {/* Drag handle */}
                              <div className="media-grid-drag-handle" title="Drag to reorder">
                                <GripVertical size={14} />
                              </div>

                              {/* Edited badge */}
                              {isEdited && (
                                <div className="media-grid-edited-badge">Edited</div>
                              )}

                              {/* Caption badge */}
                              {hasCaption && (
                                <div className="media-grid-caption-badge">
                                  {imgObj.caption}
                                </div>
                              )}

                              {/* Overflow counter */}
                              {idx === 3 && editingPostImages.length > 4 && (
                                <div className="media-grid-overflow-badge">+{editingPostImages.length - 4}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="media-grid-hint">Drag to reorder · ✕ remove · ✎ edit &amp; caption · Max 10 photos</p>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Audience:</span>
                      <AudienceSelector value={editingPostAudience} onChange={setEditingPostAudience} />
                      
                      <label 
                        className="btn btn-glass" 
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <ImageIcon size={14} /> Add Image
                        <input 
                          type="file" 
                          accept="image/*" 
                          multiple 
                          onChange={handleEditingFileChange} 
                          style={{ display: 'none' }} 
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-glass" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={handleEditPostCancel}>
                        Cancel
                      </button>
                      <button className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => handleEditPostSave(post.id)}>
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                post.content && <p className="post-text">{post.content}</p>
              )}
              
              {post.media_type === 'image' && post.media_url && (() => {
                let rawImages = [];
                try {
                  const parsed = JSON.parse(post.media_url);
                  rawImages = Array.isArray(parsed) ? parsed : [post.media_url];
                } catch {
                  rawImages = [post.media_url];
                }
                const images = rawImages.map(item =>
                  typeof item === 'string'
                    ? { url: item, caption: '' }
                    : { url: item.url ?? item, caption: item.caption ?? '' }
                );
                return (
                  <div className={`post-media-grid post-media-grid-${Math.min(images.length, 4)}`}>
                    {images.slice(0, 4).map(({ url: imgUrl, caption: imgCaption }, imgIdx) => (
                      <div
                        key={imgIdx}
                        className={`post-media-cell${imgIdx === 0 && images.length >= 3 ? ' post-media-cell--hero' : ''}`}
                        onClick={() => openLightbox(images, imgIdx)}
                        style={{ cursor: 'pointer' }}
                      >
                        {brokenPostImages[`${post.id}_${imgIdx}`] ? (
                          <div className="post-media-broken">
                            <ImageIcon size={20} opacity={0.4} />
                          </div>
                        ) : (
                          <img
                            src={resolveMediaUrl(imgUrl)}
                            alt={imgCaption || `Post image ${imgIdx + 1}`}
                            onError={() => setBrokenPostImages(prev => ({ ...prev, [`${post.id}_${imgIdx}`]: true }))}
                          />
                        )}
                        {/* Caption overlay */}
                        {imgCaption?.trim() && (
                          <div className="post-media-caption">{imgCaption}</div>
                        )}
                        {/* Overflow badge */}
                        {imgIdx === 3 && images.length > 4 && (
                          <div className="post-media-overflow">+{images.length - 4}</div>
                        )}
                        {/* Expand hint on hover */}
                        <div className="post-media-expand-hint">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}


              {post.media_type === 'project' && post.shared_project && (
                <div className="standalone-project-view glass-panel">
                  {post.shared_project.media_link ? (
                    <div className="proj-video-wrapper">
                      {playingPostId === post.id ? (
                        <iframe
                          src={getEmbedUrl(post.shared_project.media_link, post.shared_project.media_source)}
                          frameBorder="0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                        />
                      ) : (
                        <div className="proj-thumbnail-placeholder" onClick={() => setPlayingPostId(post.id)}>
                          {getProjectPoster(post.shared_project) ? (
                            <img
                              src={getProjectPoster(post.shared_project)}
                              alt={post.shared_project.title}
                              onError={() => setBrokenThumbs(prev => ({...prev, [post.shared_project.id]: true}))}
                            />
                          ) : (
                            <div className="placeholder-overlay">
                              <Video size={48} opacity={0.3} />
                            </div>
                          )}
                          <div className="play-overlay">
                            <Play size={48} fill="white" />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : getProjectPoster(post.shared_project) ? (
                    <div 
                      className="proj-poster-wrapper"
                      onClick={() => openLightbox([{ url: getProjectPoster(post.shared_project), caption: post.shared_project.title }], 0)}
                      style={{ cursor: 'pointer' }}
                    >
                      <img
                        src={getProjectPoster(post.shared_project)}
                        alt={post.shared_project.title}
                        onError={() => setBrokenThumbs(prev => ({...prev, [post.shared_project.id]: true}))}
                      />
                    </div>
                  ) : null}
                  <div className="proj-card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <h3 
                        onClick={() => setSelectedProject(post.shared_project)}
                        style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                        className="project-title-link"
                      >
                        {post.shared_project.title}
                        {post.shared_project.awards && post.shared_project.awards.length > 0 ? (
                          <LaurelAward size={28} style={{ display: 'inline-block', verticalAlign: 'middle', filter: 'drop-shadow(0 0 4px rgba(255,165,0,0.5))' }} />
                        ) : null}
                      </h3>
                      {post.shared_project.duration && <span className="duration-tag">{post.shared_project.duration}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{post.shared_project.genre}</span>
                      {post.shared_project.synopsis && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>· {post.shared_project.synopsis.slice(0, 80)}...</span>}
                    </div>
                    {post.shared_project.credits?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {post.shared_project.credits.slice(0, 4).map((c, i) => (
                          <span key={i} className="credit-tag">
                            <strong style={{ color: 'var(--text-primary)' }}>{c.role}:</strong> {c.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Post Actions — Facebook-style layout */}
            <div className="post-actions">
              <div className="post-actions-left">
                <div 
                  style={{ position: 'relative', display: 'inline-block' }}
                  onMouseEnter={() => handlePostLikeMouseEnter(post.id)}
                  onMouseLeave={() => handlePostLikeMouseLeave(post.id)}
                >
                  {activeReactionPostId === post.id && (
                    <div 
                      className="reactions-popup animate-fade-in"
                      onMouseEnter={handlePostPopupMouseEnter}
                      onMouseLeave={() => handlePostLikeMouseLeave(post.id)}
                      style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: '0',
                        borderRadius: '30px',
                        padding: '0.4rem 0.6rem',
                        display: 'flex',
                        gap: '0.5rem',
                        zIndex: 100000
                      }}
                    >
                      {REACTION_OPTIONS.map(opt => (
                        <button
                          key={opt.type}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePostReactionSelect(post.id, opt.type);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'transform 0.15s ease'
                          }}
                          className="reaction-emoji-btn"
                          title={opt.label}
                        >
                          {opt.emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  <button 
                    className="action-btn"
                    onTouchStart={(e) => handlePostLikeTouchStart(e, post.id)}
                    onTouchEnd={(e) => handlePostLikeTouchEnd(e, post.id, post.user_reaction)}
                    onTouchMove={handlePostLikeTouchMove}
                    onClick={() => handlePostLikeClick(post.id, post.user_reaction)}
                    style={{
                      color: post.user_reaction ? (REACTION_OPTIONS.find(o => o.type === post.user_reaction)?.color || 'var(--accent-primary)') : undefined
                    }}
                  >
                    <ThumbsUp size={18} fill={post.user_reaction ? "currentColor" : "none"} />
                    <span 
                      onClick={(e) => {
                        if (post.likes_count > 0) {
                          e.stopPropagation();
                          setReactorsModalPostId(post.id);
                        }
                      }}
                      style={{ cursor: post.likes_count > 0 ? 'pointer' : 'default' }}
                    >
                      {post.likes_count}
                    </span>
                  </button>
                </div>
                <button 
                  className="action-btn"
                  onClick={() => {
                    const input = document.getElementById(`comment-input-${post.id}`);
                    if (input) input.focus();
                  }}
                >
                  <MessageCircle size={18} /> 
                  <span>{post.comments?.length || 0}</span>
                </button>
                <div className="share-btn-container" style={{ position: 'relative', display: 'inline-block' }}>
                  <button 
                    className="action-btn" 
                    onClick={() => setActiveSharePostId(activeSharePostId === post.id ? null : post.id)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                      <path d="M15 8v-4l7 7-7 7v-4.1C10.5 11.6 7 13.5 4 18c0-4.5 3-9 11-10z" />
                    </svg>
                    <span>{post.shares_count || 0}</span>
                  </button>
                  {activeSharePostId === post.id && (
                    <div className="share-dropdown">
                      <button className="share-dropdown-item" onClick={() => handleShareOptionClick(post, 'copy')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        <span>Copy Link</span>
                      </button>
                      <button className="share-dropdown-item" onClick={() => handleShareOptionClick(post, 'message')}>
                        <MessageCircle size={14} style={{ marginRight: '4px' }} />
                        <span>Send in Message</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {post.likes_count > 0 && post.reactions && post.reactions.length > 0 && (
                <div 
                  className="post-reaction-badges"
                  onClick={() => setReactorsModalPostId(post.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {(() => {
                    const matchingOptions = post.reactions
                      .map(t => REACTION_OPTIONS.find(o => o.type === t))
                      .filter(Boolean);
                    return matchingOptions.slice(0, 3).map((o, idx) => (
                      <span 
                        key={o.type} 
                        className="post-reaction-badge"
                        style={{ zIndex: 10 - idx }}
                        title={o.label}
                      >
                        {o.emoji}
                      </span>
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* Comments Section */}
            <div className="comments-section" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(() => {
                  const commentsList = post.comments || [];
                  const parentComments = commentsList.filter(c => !c.parent_id);
                  const replyComments = commentsList.filter(c => c.parent_id);

                  const isPostCommentsExpanded = expandedPostComments[post.id];
                  const hasMoreComments = parentComments.length > 4;
                  const visibleParentComments = (hasMoreComments && !isPostCommentsExpanded)
                    ? parentComments.slice(0, 4)
                    : parentComments;

                  return (
                    <>
                      {visibleParentComments.map(comment => {
                    const thisReplies = replyComments.filter(r => r.parent_id === comment.id);
                    const showReplyInput = activeReplyInputCommentId === comment.id || thisReplies.length > 0;
                    const isExpanded = expandedComments[comment.id] || activeReplyInputCommentId === comment.id;

                    return (
                      <div key={comment.id} className="comment-thread" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {/* Parent Comment */}
                        <div className="comment" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', position: 'relative' }}>
                          {(thisReplies.length > 0 || showReplyInput) && (
                            <div style={{
                              position: 'absolute',
                              left: 'calc(1rem - 1px)',
                              top: '32px',
                              bottom: '-16px',
                              borderLeft: '2px solid var(--comment-line)'
                            }} />
                          )}
                          <UserHoverCard userId={comment.user_id}>
                            <div className="comment-avatar" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%' }}>
                              {comment.profile_picture ? (
                                <img src={resolveMediaUrl(comment.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                              )}
                            </div>
                          </UserHoverCard>
                          <div className="comment-content-box" style={{ position: 'relative', flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <UserHoverCard userId={comment.user_id}>
                                <div className="comment-author" style={{ display: 'inline-block' }}>{comment.first_name} {comment.last_name}</div>
                              </UserHoverCard>

                              {/* Comment Menu wrapper */}
                              <div className="comment-menu-wrapper" style={{ position: 'relative' }}>
                                <button 
                                  type="button"
                                  className="comment-menu-trigger"
                                  onClick={() => setActiveCommentMenuId(activeCommentMenuId === comment.id ? null : comment.id)}
                                  style={{ 
                                    background: 'transparent', 
                                    border: 'none', 
                                    color: 'var(--text-muted)', 
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s ease'
                                  }}
                                >
                                  <MoreVertical size={14} />
                                </button>
                                
                                {activeCommentMenuId === comment.id && (
                                  <div className="comment-dropdown animate-fade-in">
                                    {comment.user_id === currentUser?.id && (
                                      <button 
                                        onClick={() => handleCommentEditStart(comment)}
                                        className="comment-dropdown-item"
                                      >
                                        Edit
                                      </button>
                                    )}
                                    
                                    {(comment.user_id === currentUser?.id || post.user_id === currentUser?.id || currentUser?.role === 'admin') && (
                                      <button 
                                        onClick={() => handleCommentDelete(post.id, comment.id)}
                                        className="comment-dropdown-item comment-delete"
                                      >
                                        Delete
                                      </button>
                                    )}
                                    
                                    {comment.user_id !== currentUser?.id && (
                                      <button 
                                        onClick={() => handleCommentReport(post.id, comment)}
                                        className="comment-dropdown-item"
                                      >
                                        Report
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {editingCommentId === comment.id ? (
                              <div className="comment-edit-area" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem', position: 'relative' }}>
                                {editingCommentImage && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                                      <img src={editingCommentImage} alt="Pasted attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                      <button 
                                        type="button"
                                        onClick={() => setEditingCommentImage(null)}
                                        style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(239, 68, 68, 0.9)', color: 'white', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold' }}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', position: 'relative', width: '100%' }}>
                                  <input 
                                    type="text"
                                    className="input-glass"
                                    value={editingCommentText}
                                    onChange={(e) => setEditingCommentText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleCommentEditSave(post.id, comment);
                                    }}
                                    autoFocus
                                    style={{ width: '100%', fontSize: '0.9rem', padding: '0.4rem 5rem 0.4rem 0.8rem' }}
                                  />
                                  <div style={{ position: 'absolute', right: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'center', zIndex: 10 }}>
                                    {/* Edit Image Upload Button */}
                                    <label 
                                      htmlFor={`comment-edit-image-upload-${comment.id}`} 
                                      style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center', 
                                        width: '30px', 
                                        height: '30px', 
                                        borderRadius: '50%', 
                                        cursor: 'pointer', 
                                        color: 'var(--text-muted)',
                                        transition: 'all 0.2s ease',
                                        background: 'transparent'
                                      }}
                                      className="comment-icon-btn"
                                      title="Add image"
                                    >
                                      <ImageIcon size={16} />
                                    </label>

                                    {/* Edit Emoji Picker Button */}
                                    <button
                                      type="button"
                                      onClick={() => setEditingCommentEmojiPickerId(editingCommentEmojiPickerId === comment.id ? null : comment.id)}
                                      style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center', 
                                        width: '30px', 
                                        height: '30px', 
                                        borderRadius: '50%', 
                                        cursor: 'pointer', 
                                        color: editingCommentEmojiPickerId === comment.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                                        background: 'transparent',
                                        border: 'none',
                                        padding: 0,
                                        outline: 'none'
                                      }}
                                      className="comment-icon-btn"
                                      title="Insert emoji"
                                    >
                                      <Smile size={16} />
                                    </button>
                                  </div>
                                  
                                  <input 
                                    type="file" 
                                    accept="image/*" 
                                    id={`comment-edit-image-upload-${comment.id}`}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                          setEditingCommentImage(reader.result);
                                        };
                                        reader.readAsDataURL(file);
                                      }
                                      e.target.value = '';
                                    }}
                                    style={{ display: 'none' }}
                                  />

                                  {editingCommentEmojiPickerId === comment.id && (
                                    <div 
                                      className="comment-emoji-picker-container animate-fade-in" 
                                      style={{ 
                                        position: 'absolute', 
                                        bottom: '100%', 
                                        right: '0.5rem', 
                                        marginBottom: '0.5rem', 
                                        zIndex: 100000 
                                      }}
                                    >
                                      <NativeEmojiPicker
                                        onEmojiSelect={(emojiData) => {
                                          setEditingCommentText(prev => prev + emojiData.native);
                                        }}
                                        theme={document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'}
                                      />
                                    </div>
                                  )}
                                </div>

                                <div style={{ display: 'flex', gap: '0.4rem', alignSelf: 'flex-end', zIndex: 5 }}>
                                  <button 
                                    className="btn btn-primary" 
                                    onClick={() => handleCommentEditSave(post.id, comment)}
                                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                  >
                                    Save
                                  </button>
                                  <button 
                                    className="btn btn-glass" 
                                    onClick={handleCommentEditCancel}
                                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="comment-text">
                                {(() => {
                                  const { text, image } = parseCommentContent(comment.content);
                                  return (
                                    <>
                                      {text && <div style={{ marginBottom: image ? '0.4rem' : 0 }}>{text}</div>}
                                      {image && (
                                        <img 
                                          src={image} 
                                          alt="Comment image" 
                                          onClick={() => openLightbox([{ url: image, caption: 'Comment Image' }], 0)}
                                          style={{ 
                                            maxWidth: '100%', 
                                            maxHeight: '200px', 
                                            borderRadius: '8px', 
                                            border: '1px solid var(--glass-border)',
                                            display: 'block',
                                            cursor: 'pointer',
                                            marginTop: '0.2rem'
                                          }} 
                                        />
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}

                            {/* Comment Actions Row */}
                            <div className="comment-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.4rem', fontSize: '0.8rem' }}>
                              <div 
                                style={{ position: 'relative', display: 'inline-block' }}
                                onMouseEnter={() => handleLikeButtonMouseEnter(comment.id)}
                                onMouseLeave={() => handleLikeButtonMouseLeave(comment.id)}
                              >
                                {activeReactionCommentId === comment.id && (
                                  <div 
                                    className="reactions-popup animate-fade-in"
                                    onMouseEnter={handlePopupMouseEnter}
                                    onMouseLeave={() => handleLikeButtonMouseLeave(comment.id)}
                                    style={{
                                      position: 'absolute',
                                      bottom: '100%',
                                      left: '0',
                                      borderRadius: '30px',
                                      padding: '0.4rem 0.6rem',
                                      display: 'flex',
                                      gap: '0.5rem',
                                      zIndex: 100000
                                    }}
                                  >
                                    {REACTION_OPTIONS.map(opt => (
                                      <button
                                        key={opt.type}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleReactionSelect(post.id, comment.id, opt.type);
                                        }}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          fontSize: '1.5rem',
                                          cursor: 'pointer',
                                          padding: '2px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          transition: 'transform 0.15s ease'
                                        }}
                                        className="reaction-emoji-btn"
                                        title={opt.label}
                                      >
                                        {opt.emoji}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                
                                <button 
                                  onTouchStart={(e) => handleLikeButtonTouchStart(e, post.id, comment.id, comment.user_reaction)}
                                  onTouchEnd={(e) => handleLikeButtonTouchEnd(e, post.id, comment.id, comment.user_reaction)}
                                  onTouchMove={handleLikeButtonTouchMove}
                                  onClick={() => handleLikeButtonClick(post.id, comment.id, comment.user_reaction)}
                                  style={{ 
                                    background: 'none', 
                                    border: 'none', 
                                    color: comment.user_reaction ? (REACTION_OPTIONS.find(o => o.type === comment.user_reaction)?.color || 'var(--accent-primary)') : 'var(--text-secondary)', 
                                    cursor: 'pointer', 
                                    fontWeight: comment.user_reaction ? '600' : 'normal',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    fontSize: '0.8rem',
                                    userSelect: 'none',
                                    WebkitUserSelect: 'none'
                                  }}
                                >
                                  {comment.user_reaction ? (
                                    <>
                                      <span>{REACTION_OPTIONS.find(o => o.type === comment.user_reaction)?.emoji}</span>
                                      <span>{REACTION_OPTIONS.find(o => o.type === comment.user_reaction)?.label}</span>
                                    </>
                                  ) : (
                                    'Like'
                                  )}
                                </button>
                              </div>
                              <button 
                                onClick={() => {
                                  const willBeOpen = activeReplyInputCommentId !== comment.id;
                                  setActiveReplyInputCommentId(willBeOpen ? comment.id : null);
                                  if (willBeOpen) {
                                    setExpandedComments(prev => ({ ...prev, [comment.id]: true }));
                                  }
                                  setReplyContents(prev => ({
                                    ...prev,
                                    [comment.id]: ''
                                  }));
                                  setActiveReplyMentions(prev => ({
                                    ...prev,
                                    [comment.id]: `${comment.first_name} ${comment.last_name}`
                                  }));
                                  setTimeout(() => {
                                    const input = document.getElementById(`reply-input-${comment.id}`);
                                    if (input) input.focus();
                                  }, 50);
                                }}
                                style={{ 
                                  background: 'none', 
                                  border: 'none', 
                                  color: 'var(--text-secondary)', 
                                  cursor: 'pointer', 
                                  padding: 0,
                                  fontSize: '0.8rem'
                                }}
                              >
                                Reply
                              </button>
                              {comment.likes_count > 0 && (
                                <span 
                                  style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer' }}
                                  onClick={() => { setReactorsModalPostId(null); setReactorsModalCommentId(comment.id); }}
                                >
                                  {(() => {
                                    const rxList = comment.reactions || [];
                                    const matchingOptions = rxList.map(t => REACTION_OPTIONS.find(o => o.type === t)).filter(Boolean);
                                    return matchingOptions.slice(0, 3).map((o, idx) => (
                                      <span key={o.type} style={{ marginRight: idx === matchingOptions.length - 1 ? '4px' : '-4px', fontSize: '0.9rem', zIndex: 3 - idx }}>
                                        {o.emoji}
                                      </span>
                                    ));
                                  })()}
                                  {comment.likes_count}
                                </span>
                              )}
                              <span className="comment-time" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatTime(comment.created_at)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Nesting Replies & Input Area */}
                        {(thisReplies.length > 0 || showReplyInput) && (
                          <div className="comment-replies-container" style={{ marginLeft: '3rem', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative' }}>
                            
                            {/* Collapsed State: View all replies button */}
                            {thisReplies.length > 0 && !isExpanded && (
                              <div className="replies-list collapsed" style={{ position: 'relative' }}>
                                <div 
                                  onClick={() => setExpandedComments(prev => ({ ...prev, [comment.id]: true }))}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: 'var(--text-muted)',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    padding: '0.2rem 0',
                                    position: 'relative',
                                    userSelect: 'none'
                                  }}
                                  className="view-replies-btn"
                                >
                                  {/* L-shaped connector line */}
                                  <div style={{
                                    position: 'absolute',
                                    left: 'calc(-2rem - 1px)',
                                    width: 'calc(1.25rem + 1px)',
                                    top: '-16px',
                                    bottom: '50%',
                                    borderLeft: '2px solid var(--comment-line)',
                                    borderBottom: '2px solid var(--comment-line)',
                                    borderBottomLeftRadius: '8px'
                                  }} />
                              View all {thisReplies.length} {thisReplies.length === 1 ? 'reply' : 'replies'}
                            </div>
                          </div>
                        )}

                        {thisReplies.length > 0 && isExpanded && (
                          <div className="replies-list expanded" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative' }}>
                            {thisReplies.map((reply, idx) => {
                              const isLast = (idx === thisReplies.length - 1) && !showReplyInput;
                              return (
                                <div key={reply.id} className="comment reply" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', position: 'relative' }}>
                                  {/* Vertical line segment container (zero joints) */}
                                  <div style={{
                                    position: 'absolute',
                                    left: 'calc(-2rem - 1px)',
                                    top: '-12px',
                                    bottom: isLast ? 'auto' : '-12px',
                                    height: isLast ? '24px' : 'auto',
                                    borderLeft: '2px solid var(--comment-line)',
                                    pointerEvents: 'none'
                                  }}>
                                    {/* Curved branch */}
                                    <div style={{
                                      position: 'absolute',
                                      left: '-2px',
                                      width: 'calc(2rem + 3px)',
                                      top: '0',
                                      height: '24px',
                                      borderLeft: '2px solid var(--comment-line)',
                                      borderBottom: '2px solid var(--comment-line)',
                                      borderBottomLeftRadius: '8px'
                                    }} />
                                  </div>
                                <UserHoverCard userId={reply.user_id}>
                                  <div className="comment-avatar" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%' }}>
                                    {reply.profile_picture ? (
                                      <img src={resolveMediaUrl(reply.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                      <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                                    )}
                                  </div>
                                </UserHoverCard>
                                <div className="comment-content-box" style={{ position: 'relative', flex: 1, padding: '0.4rem 0.6rem', borderRadius: '8px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <UserHoverCard userId={reply.user_id}>
                                      <div className="comment-author" style={{ display: 'inline-block', fontSize: '0.85rem' }}>{reply.first_name} {reply.last_name}</div>
                                    </UserHoverCard>

                                    {/* Reply Menu wrapper */}
                                    <div className="comment-menu-wrapper" style={{ position: 'relative' }}>
                                      <button 
                                        type="button"
                                        className="comment-menu-trigger"
                                        onClick={() => setActiveCommentMenuId(activeCommentMenuId === reply.id ? null : reply.id)}
                                        style={{ 
                                          background: 'transparent', 
                                          border: 'none', 
                                          color: 'var(--text-muted)', 
                                          cursor: 'pointer',
                                          padding: '2px 4px',
                                          borderRadius: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          transition: 'all 0.2s ease'
                                        }}
                                      >
                                        <MoreVertical size={12} />
                                      </button>
                                      
                                      {activeCommentMenuId === reply.id && (
                                        <div className="comment-dropdown animate-fade-in">
                                          {reply.user_id === currentUser?.id && (
                                            <button 
                                              onClick={() => handleCommentEditStart(reply)}
                                              className="comment-dropdown-item"
                                            >
                                              Edit
                                            </button>
                                          )}
                                          
                                          {(reply.user_id === currentUser?.id || post.user_id === currentUser?.id || currentUser?.role === 'admin') && (
                                            <button 
                                              onClick={() => handleCommentDelete(post.id, reply.id)}
                                              className="comment-dropdown-item comment-delete"
                                            >
                                              Delete
                                            </button>
                                          )}
                                          
                                          {reply.user_id !== currentUser?.id && (
                                            <button 
                                              onClick={() => handleCommentReport(post.id, reply)}
                                              className="comment-dropdown-item"
                                            >
                                              Report
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {editingCommentId === reply.id ? (
                                    <div className="comment-edit-area" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem', position: 'relative' }}>
                                      {editingCommentImage && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <div style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                                            <img src={editingCommentImage} alt="Pasted attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            <button 
                                              type="button"
                                              onClick={() => setEditingCommentImage(null)}
                                              style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(239, 68, 68, 0.9)', color: 'white', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold' }}
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                      <div style={{ display: 'flex', alignItems: 'center', position: 'relative', width: '100%' }}>
                                        <input 
                                          type="text"
                                          className="input-glass"
                                          value={editingCommentText}
                                          onChange={(e) => setEditingCommentText(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCommentEditSave(post.id, reply);
                                          }}
                                          autoFocus
                                          style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 5rem 0.4rem 0.8rem' }}
                                        />
                                        <div style={{ position: 'absolute', right: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'center', zIndex: 10 }}>
                                          {/* Edit Image Upload Button */}
                                          <label 
                                            htmlFor={`comment-edit-image-upload-${reply.id}`} 
                                            style={{ 
                                              display: 'flex', 
                                              alignItems: 'center', 
                                              justifyContent: 'center', 
                                              width: '30px', 
                                              height: '30px', 
                                              borderRadius: '50%', 
                                              cursor: 'pointer', 
                                              color: 'var(--text-muted)',
                                              transition: 'all 0.2s ease',
                                              background: 'transparent'
                                            }}
                                            className="comment-icon-btn"
                                            title="Add image"
                                          >
                                            <ImageIcon size={14} />
                                          </label>

                                          {/* Edit Emoji Picker Button */}
                                          <button
                                            type="button"
                                            onClick={() => setEditingCommentEmojiPickerId(editingCommentEmojiPickerId === reply.id ? null : reply.id)}
                                            style={{ 
                                              display: 'flex', 
                                              alignItems: 'center', 
                                              justifyContent: 'center', 
                                              width: '30px', 
                                              height: '30px', 
                                              borderRadius: '50%', 
                                              cursor: 'pointer', 
                                              color: editingCommentEmojiPickerId === reply.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              outline: 'none'
                                            }}
                                            className="comment-icon-btn"
                                            title="Insert emoji"
                                          >
                                            <Smile size={14} />
                                          </button>
                                        </div>
                                        
                                        <input 
                                          type="file" 
                                          accept="image/*" 
                                          id={`comment-edit-image-upload-${reply.id}`}
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                              const reader = new FileReader();
                                              reader.onloadend = () => {
                                                setEditingCommentImage(reader.result);
                                              };
                                              reader.readAsDataURL(file);
                                            }
                                            e.target.value = '';
                                          }}
                                          style={{ display: 'none' }}
                                        />

                                        {editingCommentEmojiPickerId === reply.id && (
                                          <div 
                                            className="comment-emoji-picker-container animate-fade-in" 
                                            style={{ 
                                              position: 'absolute', 
                                              bottom: '100%', 
                                              right: '0.5rem', 
                                              marginBottom: '0.5rem', 
                                              zIndex: 100000 
                                            }}
                                          >
                                            <NativeEmojiPicker
                                              onEmojiSelect={(emojiData) => {
                                                setEditingCommentText(prev => prev + emojiData.native);
                                              }}
                                              theme={document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'}
                                            />
                                          </div>
                                        )}
                                      </div>

                                      <div style={{ display: 'flex', gap: '0.4rem', alignSelf: 'flex-end', zIndex: 5 }}>
                                        <button 
                                          className="btn btn-primary" 
                                          onClick={() => handleCommentEditSave(post.id, reply)}
                                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                        >
                                          Save
                                        </button>
                                        <button 
                                          className="btn btn-glass" 
                                          onClick={handleCommentEditCancel}
                                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="comment-text" style={{ fontSize: '0.85rem' }}>
                                       {(() => {
                                         const { text, image } = parseCommentContent(reply.content);
                                         
                                         // Find candidates in this thread
                                         const threadCandidates = [
                                           `${comment.first_name} ${comment.last_name}`,
                                           ...thisReplies.map(r => `${r.first_name} ${r.last_name}`)
                                         ];
                                         const uniqueCandidates = [...new Set(threadCandidates)].filter(Boolean);
                                         const sortedCandidates = uniqueCandidates.sort((a, b) => b.length - a.length);
                                         
                                         let mentionBadge = null;
                                         let displayText = text;
                                         
                                         if (text) {
                                           for (const candidate of sortedCandidates) {
                                             if (text === candidate) {
                                               mentionBadge = candidate;
                                               displayText = "";
                                               break;
                                             }
                                             const prefix = `${candidate} `;
                                             if (text.startsWith(prefix)) {
                                               mentionBadge = candidate;
                                               displayText = text.slice(prefix.length);
                                               break;
                                             }
                                           }
                                         }

                                         return (
                                           <>
                                             {text && (
                                               <div style={{ marginBottom: image ? '0.4rem' : 0 }}>
                                                 {mentionBadge ? (
                                                   <>
                                                     <span style={{ 
                                                       color: 'var(--text-primary)', 
                                                       fontWeight: 'bold', 
                                                       marginRight: '0.3rem',
                                                       cursor: 'pointer'
                                                     }}>
                                                       {mentionBadge}
                                                     </span>
                                                     <span style={{ color: 'var(--text-secondary)' }}>{displayText}</span>
                                                   </>
                                                 ) : (
                                                   <span style={{ color: 'var(--text-secondary)' }}>{text}</span>
                                                 )}
                                               </div>
                                             )}
                                             {image && (
                                               <img 
                                                 src={image} 
                                                 alt="Reply image" 
                                                 onClick={() => openLightbox([{ url: image, caption: 'Reply Image' }], 0)}
                                                 style={{ 
                                                   maxWidth: '100%', 
                                                   maxHeight: '150px', 
                                                   borderRadius: '6px', 
                                                   border: '1px solid var(--glass-border)',
                                                   display: 'block',
                                                   cursor: 'pointer',
                                                   marginTop: '0.2rem'
                                                 }} 
                                               />
                                             )}
                                           </>
                                         );
                                       })()}
                                     </div>
                                  )}

                                  {/* Reply Actions Row */}
                                  <div className="comment-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.3rem', fontSize: '0.75rem' }}>
                                    <div 
                                      style={{ position: 'relative', display: 'inline-block' }}
                                      onMouseEnter={() => handleLikeButtonMouseEnter(reply.id)}
                                      onMouseLeave={() => handleLikeButtonMouseLeave(reply.id)}
                                    >
                                      {activeReactionCommentId === reply.id && (
                                        <div 
                                          className="reactions-popup animate-fade-in"
                                          onMouseEnter={handlePopupMouseEnter}
                                          onMouseLeave={() => handleLikeButtonMouseLeave(reply.id)}
                                          style={{
                                            position: 'absolute',
                                            bottom: '100%',
                                            left: '0',
                                            borderRadius: '30px',
                                            padding: '0.4rem 0.6rem',
                                            display: 'flex',
                                            gap: '0.5rem',
                                            zIndex: 100000
                                          }}
                                        >
                                          {REACTION_OPTIONS.map(opt => (
                                            <button
                                              key={opt.type}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleReactionSelect(post.id, reply.id, opt.type);
                                              }}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                fontSize: '1.5rem',
                                                cursor: 'pointer',
                                                padding: '2px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                transition: 'transform 0.15s ease'
                                              }}
                                              className="reaction-emoji-btn"
                                              title={opt.label}
                                            >
                                              {opt.emoji}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                      
                                      <button 
                                        onTouchStart={(e) => handleLikeButtonTouchStart(e, post.id, reply.id, reply.user_reaction)}
                                        onTouchEnd={(e) => handleLikeButtonTouchEnd(e, post.id, reply.id, reply.user_reaction)}
                                        onTouchMove={handleLikeButtonTouchMove}
                                        onClick={() => handleLikeButtonClick(post.id, reply.id, reply.user_reaction)}
                                        style={{ 
                                          background: 'none', 
                                          border: 'none', 
                                          color: reply.user_reaction ? (REACTION_OPTIONS.find(o => o.type === reply.user_reaction)?.color || 'var(--accent-primary)') : 'var(--text-secondary)', 
                                          cursor: 'pointer', 
                                          fontWeight: reply.user_reaction ? '600' : 'normal',
                                          padding: 0,
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '0.2rem',
                                          fontSize: '0.75rem',
                                          userSelect: 'none',
                                          WebkitUserSelect: 'none'
                                        }}
                                      >
                                        {reply.user_reaction ? (
                                          <>
                                            <span>{REACTION_OPTIONS.find(o => o.type === reply.user_reaction)?.emoji}</span>
                                            <span>{REACTION_OPTIONS.find(o => o.type === reply.user_reaction)?.label}</span>
                                          </>
                                        ) : (
                                          'Like'
                                        )}
                                      </button>
                                    </div>
                                    <button 
                                      onClick={() => {
                                        setActiveReplyInputCommentId(comment.id);
                                        setExpandedComments(prev => ({ ...prev, [comment.id]: true }));
                                        setReplyContents(prev => ({
                                          ...prev,
                                          [comment.id]: ''
                                        }));
                                        setActiveReplyMentions(prev => ({
                                          ...prev,
                                          [comment.id]: `${reply.first_name} ${reply.last_name}`
                                        }));
                                        setTimeout(() => {
                                          const input = document.getElementById(`reply-input-${comment.id}`);
                                          if (input) input.focus();
                                        }, 50);
                                      }}
                                      style={{ 
                                        background: 'none', 
                                        border: 'none', 
                                        color: 'var(--text-secondary)', 
                                        cursor: 'pointer', 
                                        padding: 0,
                                        fontSize: '0.75rem'
                                      }}
                                    >
                                      Reply
                                    </button>
                                    {reply.likes_count > 0 && (
                                      <span 
                                        style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.15rem', cursor: 'pointer' }}
                                        onClick={() => { setReactorsModalPostId(null); setReactorsModalCommentId(reply.id); }}
                                      >
                                        {(() => {
                                          const rxList = reply.reactions || [];
                                          const matchingOptions = rxList.map(t => REACTION_OPTIONS.find(o => o.type === t)).filter(Boolean);
                                          return matchingOptions.slice(0, 3).map((o, idx) => (
                                            <span key={o.type} style={{ marginRight: idx === matchingOptions.length - 1 ? '4px' : '-4px', fontSize: '0.85rem', zIndex: 3 - idx }}>
                                              {o.emoji}
                                            </span>
                                          ));
                                        })()}
                                        {reply.likes_count}
                                      </span>
                                    )}
                                    <span className="comment-time" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatTime(reply.created_at)}</span>
                                  </div>
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Reply Input Box */}
                        {showReplyInput && isExpanded && (
                          <div className="reply-input-area" style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', position: 'relative' }}>
                            {replyImages[comment.id] && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ position: 'relative', width: '50px', height: '50px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                                  <img src={replyImages[comment.id]} alt="Reply attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  <button 
                                    type="button"
                                    onClick={() => setReplyImages(prev => ({ ...prev, [comment.id]: null }))}
                                    style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(239, 68, 68, 0.9)', color: 'white', border: 'none', borderRadius: '50%', width: '14px', height: '14px', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold' }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: '100%', position: 'relative' }}>
                              {/* L-shaped connector line for reply input */}
                              <div style={{
                                position: 'absolute',
                                left: 'calc(-2rem - 1px)',
                                width: 'calc(2rem + 1px)',
                                top: replyImages[comment.id] ? '-76px' : '-16px',
                                bottom: '50%',
                                borderLeft: '2px solid var(--comment-line)',
                                borderBottom: '2px solid var(--comment-line)',
                                borderBottomLeftRadius: '8px'
                              }} />
                              <div className="comment-avatar min" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%' }}>
                                {currentUser?.profile_picture ? (
                                  <img src={resolveMediaUrl(currentUser.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                                )}
                              </div>
                              <div 
                                className="input-glass"
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  flex: 1, 
                                  position: 'relative',
                                  padding: '4px 8px',
                                  paddingRight: '4.5rem',
                                  minHeight: '32px',
                                  cursor: 'text',
                                  borderRadius: '8px'
                                }}
                                onClick={() => {
                                  const input = document.getElementById(`reply-input-${comment.id}`);
                                  if (input) input.focus();
                                }}
                              >
                                {activeReplyMentions[comment.id] && (
                                  <span 
                                    style={{
                                      background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
                                      color: 'var(--accent-primary)',
                                      fontWeight: '600',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      userSelect: 'none',
                                      border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)',
                                      marginRight: '6px',
                                      whiteSpace: 'nowrap'
                                    }}
                                  >
                                    {activeReplyMentions[comment.id]}
                                    <span 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveReplyMentions(prev => ({ ...prev, [comment.id]: null }));
                                        setTimeout(() => {
                                          const input = document.getElementById(`reply-input-${comment.id}`);
                                          if (input) input.focus();
                                        }, 10);
                                      }}
                                      style={{ cursor: 'pointer', opacity: 0.6, fontSize: '0.7rem', marginLeft: '0.15rem' }}
                                    >
                                      ✕
                                    </span>
                                  </span>
                                )}
                                <input 
                                  type="text" 
                                  id={`reply-input-${comment.id}`}
                                  placeholder={activeReplyMentions[comment.id] ? '' : 'Write a reply...'} 
                                  value={replyContents[comment.id] || ''}
                                  onChange={(e) => setReplyContents(prev => ({ ...prev, [comment.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Backspace' && !replyContents[comment.id] && activeReplyMentions[comment.id]) {
                                      setActiveReplyMentions(prev => ({ ...prev, [comment.id]: null }));
                                    } else if (e.key === 'Enter') {
                                      handleReplySubmit(post.id, comment.id);
                                    }
                                  }}
                                  onPaste={(e) => handleReplyPaste(e, comment.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ 
                                    flex: 1, 
                                    background: 'transparent',
                                    border: 'none',
                                    outline: 'none',
                                    color: 'inherit',
                                    fontSize: '0.85rem', 
                                    height: '24px',
                                    padding: 0
                                  }} 
                                />
                                <div style={{ position: 'absolute', right: '0.35rem', display: 'flex', gap: '0.2rem', alignItems: 'center', zIndex: 10 }}>
                                  {/* Reply Image Upload Button */}
                                  <label 
                                    htmlFor={`reply-image-upload-${comment.id}`} 
                                    style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'center', 
                                      width: '26px', 
                                      height: '26px', 
                                      borderRadius: '50%', 
                                      cursor: 'pointer', 
                                      color: 'var(--text-muted)',
                                      transition: 'all 0.2s ease',
                                      background: 'transparent'
                                    }}
                                    className="comment-icon-btn"
                                    title="Add image"
                                  >
                                    <ImageIcon size={14} />
                                  </label>

                                  {/* Reply Emoji Picker Button */}
                                  <button
                                    type="button"
                                    onClick={() => setReplyEmojiPickerCommentId(replyEmojiPickerCommentId === comment.id ? null : comment.id)}
                                    style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'center', 
                                      width: '26px', 
                                      height: '26px', 
                                      borderRadius: '50%', 
                                      cursor: 'pointer', 
                                      color: replyEmojiPickerCommentId === comment.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                                      background: 'transparent',
                                      border: 'none',
                                      padding: 0,
                                      outline: 'none'
                                    }}
                                    className="comment-icon-btn"
                                    title="Insert emoji"
                                  >
                                    <Smile size={14} />
                                  </button>
                                </div>
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  id={`reply-image-upload-${comment.id}`}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onloadend = () => {
                                        setReplyImages(prev => ({ ...prev, [comment.id]: reader.result }));
                                      };
                                      reader.readAsDataURL(file);
                                    }
                                    e.target.value = '';
                                  }}
                                  style={{ display: 'none' }}
                                />
                              </div>
                              <button 
                                className="btn btn-primary" 
                                onClick={() => handleReplySubmit(post.id, comment.id)}
                                style={{ padding: '0 0.75rem', height: '32px', fontSize: '0.8rem', borderRadius: '6px' }}
                              >
                                Reply
                              </button>

                              {replyEmojiPickerCommentId === comment.id && (
                                <div 
                                  className="comment-emoji-picker-container animate-fade-in" 
                                  style={{ 
                                    position: 'absolute', 
                                    bottom: '100%', 
                                    right: '4rem', 
                                    marginBottom: '0.5rem', 
                                    zIndex: 100000 
                                  }}
                                >
                                  <NativeEmojiPicker
                                    onEmojiSelect={(emojiData) => {
                                      setReplyContents(prev => ({ ...prev, [comment.id]: (prev[comment.id] || '') + emojiData.native }));
                                    }}
                                    theme={document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                  {hasMoreComments && (
                    <button
                      type="button"
                      className="see-more-comments-btn"
                      onClick={() => setExpandedPostComments(prev => ({ ...prev, [post.id]: !isPostCommentsExpanded }))}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text-secondary)',
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        marginTop: '0.25rem',
                        marginBottom: '0.5rem',
                        transition: 'all 0.2s ease',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                    >
                      {isPostCommentsExpanded ? (
                        <>
                          <ChevronUp size={14} />
                          See less comments
                        </>
                      ) : (
                        <>
                          <ChevronDown size={14} />
                          See more comments ({parentComments.length - 4} remaining)
                        </>
                      )}
                    </button>
                  )}
                </>
              );
                })()}
                
                <div className="comment-input-area" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
                    {commentImages[post.id] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '2.5rem' }}>
                        <div style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                          <img src={commentImages[post.id]} alt="Pasted attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <button 
                            type="button"
                            onClick={() => setCommentImages(prev => ({ ...prev, [post.id]: null }))}
                            style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(239, 68, 68, 0.9)', color: 'white', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', width: '100%', position: 'relative' }}>
                      <div className="comment-avatar min" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {currentUser?.profile_picture ? (
                          <img src={resolveMediaUrl(currentUser.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', flex: 1, position: 'relative' }}>
                        <input 
                          type="text" 
                          id={`comment-input-${post.id}`}
                          className="input-glass" 
                          placeholder="Write a comment..." 
                          value={commentContents[post.id] || ''}
                          onChange={(e) => setCommentContents(prev => ({ ...prev, [post.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if(e.key === 'Enter') handleCommentSubmit(post.id);
                          }}
                          onPaste={(e) => handleCommentPaste(e, post.id)}
                          style={{ flex: 1, paddingRight: '5rem' }} 
                        />
                        <div style={{ position: 'absolute', right: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'center', zIndex: 10 }}>
                          {/* Image Upload Button */}
                          <label 
                            htmlFor={`comment-image-upload-${post.id}`} 
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              width: '30px', 
                              height: '30px', 
                              borderRadius: '50%', 
                              cursor: 'pointer', 
                              color: 'var(--text-muted)',
                              transition: 'all 0.2s ease',
                              background: 'transparent'
                            }}
                            className="comment-icon-btn"
                            title="Add image"
                          >
                            <ImageIcon size={16} />
                          </label>

                          {/* Emoji Picker Button */}
                          <button
                            type="button"
                            onClick={() => setCommentEmojiPickerPostId(commentEmojiPickerPostId === post.id ? null : post.id)}
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              width: '30px', 
                              height: '30px', 
                              borderRadius: '50%', 
                              cursor: 'pointer', 
                              color: commentEmojiPickerPostId === post.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              outline: 'none'
                            }}
                            className="comment-icon-btn"
                            title="Insert emoji"
                          >
                            <Smile size={16} />
                          </button>
                        </div>
                        <input 
                          type="file" 
                          accept="image/*" 
                          id={`comment-image-upload-${post.id}`}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                setCommentImages(prev => ({ ...prev, [post.id]: reader.result }));
                              };
                              reader.readAsDataURL(file);
                            }
                            e.target.value = '';
                          }}
                          style={{ display: 'none' }}
                        />
                      </div>
                      <button className="btn btn-primary" onClick={() => handleCommentSubmit(post.id)}>Comment</button>

                      {commentEmojiPickerPostId === post.id && (
                        <div 
                          className="comment-emoji-picker-container animate-fade-in" 
                          style={{ 
                            position: 'absolute', 
                            bottom: '100%', 
                            right: '4.5rem', 
                            marginBottom: '0.5rem', 
                            zIndex: 100000 
                          }}
                        >
                          <NativeEmojiPicker
                            onEmojiSelect={(emojiData) => {
                              setCommentContents(prev => ({ ...prev, [post.id]: (prev[post.id] || '') + emojiData.native }));
                            }}
                            theme={document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'}
                          />
                        </div>
                      )}
                    </div>
                  </div>
              </div>
          </div>
          );
        })}
        {posts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No posts yet. Be the first to start a discussion!
          </div>
        )}
      </div>

      <style>{`
        .composer-avatar { background: var(--bg-gradient-primary); font-size: 1.2rem; font-weight: bold; }
        
        .feed-container { display: flex; flex-direction: column; gap: 1.5rem; isolation: isolate; }
        .post-card { padding: 1.5rem; transition: transform 0.2s; position: relative; z-index: 1; transform: translate3d(0, 0, 0); }
        .post-card:hover, .post-card:focus-within { z-index: 10; }
        .post-card.active-picker { z-index: 50 !important; }
        
        [data-mode="dark"] .composer-card,
        [data-mode="dark"] .post-card {
          background-image: 
            url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.35' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)' opacity='0.12'/%3E%3C/svg%3E"),
            linear-gradient(#07172d, #07172d) !important;
          background-color: #07172d !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        .pinned-post { border-left: 4px solid var(--accent-primary); background: rgba(var(--accent-primary-rgb), 0.03); }
        .pinned-badge { font-size: 0.7rem; color: var(--accent-primary); display: flex; align-items: center; gap: 4px; font-weight: 600; margin-top: 2px; }
        
        .post-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
        .post-header .avatar { background: var(--bg-tertiary); font-weight: bold; width: 44px; height: 44px; font-size: 1.1rem; }
        .post-author { font-size: 1.05rem; margin: 0; }
        .post-time { font-size: 0.8rem; color: var(--text-muted); }
        
        .post-body { margin-bottom: 1rem; }
        .post-text { font-size: 1rem; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap; margin-bottom: 1rem; }

        /* ── POST MULTI-IMAGE GRID (feed display) ── */
        .post-media-grid {
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 1rem;
          display: grid;
          gap: 3px;
          background: rgba(0,0,0,0.15);
        }
        .post-media-grid-1 { grid-template-columns: 1fr; }
        .post-media-grid-2 { grid-template-columns: 1fr 1fr; }
        .post-media-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; }
        .post-media-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

        .post-media-cell {
          position: relative;
          overflow: hidden;
          background: rgba(0,0,0,0.3);
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .post-media-cell--hero {
          grid-row: span 2;
        }
        .post-media-cell img {
          width: 100%;
          height: 100%;
          max-height: 420px;
          object-fit: cover;
          display: block;
          transition: transform 0.35s ease;
        }
        .post-media-cell--hero img { max-height: none; }
        .post-media-broken {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 120px;
          color: var(--text-muted);
        }
        .post-media-overflow {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: 1.8rem; font-weight: 700;
        }
        .post-media-caption {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,0.75));
          color: #fff;
          font-size: 0.8rem; font-weight: 500; line-height: 1.3;
          padding: 18px 10px 8px;
          pointer-events: none;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          border-radius: 0 0 10px 10px;
        }


        /* ── COMPOSER MULTI-IMAGE GRID (pre-post preview) ── */
        .media-grid-wrapper { max-width: calc(100% - 3.5rem); }
        .media-grid {
          display: grid;
          gap: 4px;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(96, 165, 250, 0.15);
        }
        .media-grid-1 { grid-template-columns: 1fr; }
        .media-grid-2 { grid-template-columns: 1fr 1fr; }
        .media-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; }
        .media-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; }

        .media-grid-item {
          position: relative;
          overflow: hidden;
          background: rgba(0,0,0,0.3);
          min-height: 100px;
          cursor: grab;
          user-select: none;
        }
        .media-grid-item:active { cursor: grabbing; }
        .media-grid-item--hero { grid-row: span 2; }
        .media-grid-item img {
          width: 100%; height: 100%;
          max-height: 280px;
          object-fit: cover;
          display: block;
          pointer-events: none;
          transition: transform 0.3s ease;
        }
        .media-grid-item--hero img { max-height: none; }

        .media-grid-remove {
          position: absolute; top: 8px; right: 8px;
          background: rgba(225, 29, 72, 0.92);
          color: white; border: none; border-radius: 50%;
          width: 24px; height: 24px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.6);
          z-index: 10;
          transition: transform 0.15s, background 0.15s;
          opacity: 0;
        }
        .media-grid-item:hover .media-grid-remove { opacity: 1; }
        .media-grid-remove:hover { transform: scale(1.15); background: #e11d48; }

        /* ── Edit button (pencil) ── */
        .media-grid-edit {
          position: absolute; top: 8px; right: 38px;
          background: rgba(30, 58, 138, 0.92);
          color: white; border: none; border-radius: 50%;
          width: 24px; height: 24px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.6);
          z-index: 10;
          transition: transform 0.15s, background 0.15s;
          opacity: 0;
        }
        .media-grid-item:hover .media-grid-edit { opacity: 1; }
        .media-grid-edit:hover { transform: scale(1.15); background: #1d4ed8; }

        /* ── "Edited" badge (top-left, shows when image has been edited) ── */
        .media-grid-edited-badge {
          position: absolute; bottom: 8px; left: 8px;
          background: rgba(30,58,138,0.85);
          color: #bfdbfe;
          font-size: 0.6rem; font-weight: 700; letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 2px 7px; border-radius: 20px;
          border: 1px solid rgba(147,197,253,0.4);
          pointer-events: none; z-index: 10;
        }

        /* ── Caption overlay bar ── */
        .media-grid-caption-badge {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,0.78));
          color: #fff;
          font-size: 0.72rem; font-weight: 500;
          padding: 14px 8px 7px;
          pointer-events: none; z-index: 9;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          border-radius: 0 0 10px 10px;
        }

        .media-grid-drag-handle {
          position: absolute; top: 8px; left: 8px;
          background: rgba(0,0,0,0.5);
          color: rgba(255,255,255,0.8); border-radius: 6px;
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; z-index: 10;
          transition: opacity 0.15s;
        }
        .media-grid-item:hover .media-grid-drag-handle { opacity: 1; }

        .media-grid-overflow-badge {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: 1.5rem; font-weight: 700;
        }
        .media-grid-hint {
          font-size: 0.72rem; color: var(--text-muted);
          margin-top: 6px; text-align: center;
        }

        
        .standalone-project-view { padding: 0; overflow: hidden; border-radius: 12px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.2); }
        .proj-video-wrapper { width: 100%; aspect-ratio: 16/9; background: #000; }
        .proj-video-wrapper iframe { width: 100%; height: 100%; border: none; display: block; }
        .proj-card-body { padding: 1rem 1.25rem; }
        .duration-tag { font-size: 0.75rem; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--glass-border); }
        .credit-tag { font-size: 0.75rem; padding: 0.15rem 0.5rem; background: rgba(255,255,255,0.05); border-radius: 10px; border: 1px solid var(--glass-border); color: var(--text-secondary); }

        .shared-project-card { display: flex; align-items: center; gap: 1rem; padding: 1rem; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer; transition: all 0.2s; }
        .shared-project-card:hover { border-color: var(--accent-primary); background: rgba(0,0,0,0.4); }
        .shared-project-card.active { border-color: var(--accent-primary); background: rgba(var(--accent-primary-rgb), 0.1); }
        .shared-icon { color: var(--accent-primary); }
        .shared-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); }
        .shared-details h4 { margin: 0; font-size: 1.1rem; }
        
        .post-actions { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--glass-border); padding-top: 1rem; }
        .post-actions-left { display: flex; gap: 0.25rem; align-items: center; }
        .action-btn { background: transparent; border: none; color: var(--text-secondary); display: flex; align-items: center; gap: 0.4rem; cursor: pointer; padding: 0.5rem 0.85rem; border-radius: 6px; font-size: 0.9rem; transition: all 0.2s; user-select: none; -webkit-user-select: none; }
        .action-btn:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .action-btn.liked { color: var(--danger); }
        .post-reaction-badges { display: flex; align-items: center; flex-direction: row-reverse; padding-right: 0.25rem; }
        .post-reaction-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          font-size: 1.15rem;
          margin-left: -6px;
          background: linear-gradient(135deg, #2a3e59 0%, #0c1c30 100%);
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 
            0 3px 6px rgba(0, 0, 0, 0.4), 
            inset 0 1px 2px rgba(255, 255, 255, 0.25),
            inset 0 -2px 4px rgba(0, 0, 0, 0.5);
          position: relative;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }
        .post-reaction-badge:hover {
          transform: scale(1.35) translateY(-3px);
          box-shadow: 
            0 6px 12px rgba(0, 0, 0, 0.5), 
            inset 0 1px 2px rgba(255, 255, 255, 0.35),
            inset 0 -2px 4px rgba(0, 0, 0, 0.5);
          z-index: 50 !important;
        }
        [data-mode="light"] .post-reaction-badge {
          background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
          border: 1px solid rgba(0, 0, 0, 0.12);
          box-shadow: 
            0 3px 6px rgba(0, 0, 0, 0.15), 
            inset 0 1px 2px rgba(255, 255, 255, 0.8),
            inset 0 -2px 4px rgba(0, 0, 0, 0.1);
          text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
        }
        [data-mode="light"] .post-reaction-badge:hover {
          box-shadow: 
            0 6px 12px rgba(0, 0, 0, 0.25), 
            inset 0 1px 2px rgba(255, 255, 255, 0.9),
            inset 0 -2px 4px rgba(0, 0, 0, 0.12);
        }
        .post-reaction-badges > .post-reaction-badge:first-child { margin-left: 0; }
        
        .comments-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 1rem; }
        .comment { display: flex; gap: 1rem; }
        .comment-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold; flex-shrink: 0; }
        .comment-content-box { background: rgba(255,255,255,0.03); padding: 0.75rem 1rem; border-radius: 12px; flex: 1; border: 1px solid var(--glass-border); }
        .comment-author { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; }
        .comment-text { font-size: 0.95rem; color: var(--text-secondary); line-height: 1.4; }
        .comment-time { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.5rem; }
        
        .comment-input-area { display: flex; gap: 1rem; align-items: center; margin-top: 0.5rem; }
        .comment-input-area input { flex: 1; }
        .comment-icon-btn { display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease; cursor: pointer; }
        .comment-icon-btn:hover { background: rgba(255,255,255,0.08) !important; color: var(--text-primary) !important; }
        [data-mode="light"] .comment-icon-btn:hover { background: rgba(0,0,0,0.05) !important; }
        
        .comment-emoji-picker-container {
          background: #07172d;
          border: 1px solid rgba(96, 165, 250, 0.2);
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }
        [data-mode="light"] .comment-emoji-picker-container {
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        }
        
        .comment-dropdown {
          position: absolute;
          right: 0;
          top: 100%;
          min-width: 120px;
          background: #07172d;
          border: 1px solid rgba(96, 165, 250, 0.2);
          border-radius: 8px;
          padding: 4px;
          z-index: 10000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
        
        .comment-dropdown-item {
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          color: #e4e6eb;
          padding: 6px 12px;
          font-size: 0.85rem;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: block;
        }
        
        .comment-dropdown-item:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
        }
        
        .comment-dropdown-item.comment-delete {
          color: #f87171;
        }
        
        .comment-dropdown-item.comment-delete:hover {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        /* ── Light Mode overrides ── */
        [data-mode="light"] .comment-dropdown {
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        [data-mode="light"] .comment-dropdown-item {
          color: #374151;
        }
        
        [data-mode="light"] .comment-dropdown-item:hover {
          background: rgba(0, 0, 0, 0.04);
          color: #111827;
        }
        
        [data-mode="light"] .comment-dropdown-item.comment-delete {
          color: #dc2626;
        }
        
        [data-mode="light"] .comment-dropdown-item.comment-delete:hover {
          background: rgba(220, 38, 38, 0.05);
          color: #b91c1c;
        }

        .bfi-community-dropdown {
          position: absolute;
          top: calc(100% + 12px);
          left: 0;
          min-width: 320px;
          display: flex;
          flex-direction: column;
          background-image: 
            url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.35' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)' opacity='0.12'/%3E%3C/svg%3E"),
            linear-gradient(#07172d, #07172d);
          border: none;
          box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.2), 0 0 16px rgba(96, 165, 250, 0.15), 0 10px 30px rgba(0, 0, 0, 0.35);
          z-index: 1000;
          border-radius: 12px;
          overflow: hidden;
        }
        [data-mode="light"] .bfi-community-dropdown {
          background-image: none !important;
          background: var(--bg-secondary) !important;
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
        }
        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
          margin-top: 0.5rem;
        }
        .calendar-weekday {
          font-size: 0.7rem;
          color: var(--text-muted);
          font-weight: 600;
          text-align: center;
          padding: 2px 0;
        }
        .calendar-day-empty {
          width: 28px;
          height: 28px;
        }
        .calendar-day-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-primary);
          font-size: 0.75rem;
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.2s ease;
          padding: 0;
        }
        .calendar-day-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        [data-mode="light"] .calendar-day-btn:hover {
          background: rgba(0, 0, 0, 0.05);
        }
        .calendar-day-btn.selected {
          background: var(--accent-primary) !important;
          color: #fff !important;
          font-weight: 600;
          box-shadow: 0 0 8px rgba(225, 29, 72, 0.4);
        }
        .calendar-day-btn.today {
          border: 1px solid var(--accent-primary);
        }
        .time-picker-select {
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          border: 1px solid var(--border-color);
          background: var(--bg-card);
          color: var(--text-main);
          font-size: 0.8rem;
          outline: none;
          cursor: pointer;
        }
        .option-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.25rem;
          background: transparent;
          border: none;
          color: var(--text-primary);
          cursor: pointer;
          text-align: left;
          font-size: 0.9rem;
          transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
          width: 100%;
          font-weight: 500;
          border-bottom: 1px solid rgba(96, 165, 250, 0.08);
        }
        [data-mode="light"] .option-item {
          border-bottom: 1px solid rgba(0,0,0,0.04);
        }
        .option-item:last-child {
          border-bottom: none;
        }
        .option-item:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }
        [data-mode="light"] .option-item:hover {
          background: rgba(0, 0, 0, 0.03);
          color: var(--text-primary);
        }
        .btn-glass.active {
          background: rgba(255,255,255,0.1);
          border-color: var(--accent-primary);
          color: var(--text-primary);
        }
        .btn-glass.scheduled-active {
          background: rgba(234, 179, 8, 0.1) !important;
          border-color: #eab308 !important;
          color: #eab308 !important;
        }

        .proj-thumbnail-placeholder {
          position: relative;
          width: 100%;
          aspect-ratio: 16/9;
          background: #000;
          cursor: pointer;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .proj-thumbnail-placeholder img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.5s ease;
        }
        .proj-thumbnail-placeholder .play-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.3s ease;
        }
        .proj-thumbnail-placeholder:hover .play-overlay {
          background: rgba(0,0,0,0.5);
        }
        .proj-thumbnail-placeholder .play-overlay svg {
          color: white;
          filter: drop-shadow(0 0 15px rgba(59, 130, 246, 0.6));
          transition: transform 0.3s ease;
        }
        .proj-thumbnail-placeholder:hover .play-overlay svg {
          transform: scale(1.1);
        }
        .proj-poster-wrapper {
          width: 100%;
          aspect-ratio: 16/9;
          overflow: hidden;
        }
        .proj-poster-wrapper img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .placeholder-overlay {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: var(--bg-tertiary);
          color: var(--text-muted);
        }

        .pin-post-btn, .delete-post-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: var(--text-muted);
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 8px;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .delete-post-btn:hover {
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.3);
        }
        .pin-post-btn:hover, .pin-post-btn.active {
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          border-color: rgba(59, 130, 246, 0.3);
        }
        .pin-post-btn.active { 
          color: white; 
          background: var(--accent-primary); 
          border-color: var(--accent-primary);
          box-shadow: 0 0 10px rgba(var(--accent-primary-rgb), 0.3);
        }

        .project-dropdown {
          width: 320px;
          padding: 0;
          overflow: hidden;
        }
        .dropdown-header {
          padding: 0.85rem 1.25rem;
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
          background: #041025;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          border-bottom: 1px solid rgba(96, 165, 250, 0.1);
        }
        [data-mode="light"] .dropdown-header {
          color: var(--text-primary);
          background: var(--bg-tertiary);
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .dropdown-scroll {
          max-height: 350px;
          overflow-y: auto;
          background: transparent !important;
        }
        .project-option-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          width: 100%;
          background: transparent !important;
          border: none;
          border-bottom: 1px solid rgba(96, 165, 250, 0.08);
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
          color: var(--text-secondary);
        }
        [data-mode="light"] .project-option-item {
          border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        }
        .project-option-item:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          color: var(--text-primary);
        }
        [data-mode="light"] .project-option-item:hover {
          background: rgba(0, 0, 0, 0.03) !important;
          color: var(--text-primary);
        }
        .proj-name {
          font-size: 0.95rem;
          color: var(--text-primary);
          font-weight: 600;
        }
        
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Post image: expand hint on hover ── */
        .post-media-expand-hint {
          position: absolute;
          top: 8px; right: 8px;
          background: rgba(0,0,0,0.6);
          color: #fff;
          border-radius: 6px;
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0;
          transition: opacity 0.18s;
          pointer-events: none;
          backdrop-filter: blur(4px);
        }
        .post-media-cell:hover .post-media-expand-hint { opacity: 1; }

        /* ══════════════════════════════════════
           LIGHTBOX
        ══════════════════════════════════════ */
        .lb-backdrop {
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(0,0,0,0.94);
          backdrop-filter: blur(8px);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          animation: lb-in 0.2s ease;
        }
        @keyframes lb-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* Top bar */
        .lb-topbar {
          position: absolute; top: 0; left: 0; right: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.75rem 1.25rem;
          background: linear-gradient(rgba(0,0,0,0.7), transparent);
          z-index: 10;
        }
        .lb-counter {
          font-size: 0.9rem; font-weight: 600;
          color: rgba(255,255,255,0.85);
          background: rgba(0,0,0,0.45);
          padding: 0.3rem 0.75rem; border-radius: 20px;
          letter-spacing: 0.05em;
        }
        .lb-close {
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff; border-radius: 50%;
          width: 36px; height: 36px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background 0.18s;
        }
        .lb-close:hover { background: rgba(225,29,72,0.7); }
        .lb-download {
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff; border-radius: 50%;
          width: 36px; height: 36px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background 0.18s;
        }
        .lb-download:hover { background: rgba(255,255,255,0.22); }

        /* Main image area */
        .lb-main {
          position: relative;
          width: 100%; flex: 1;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          padding: 3.5rem 4rem;
          box-sizing: border-box;
        }
        .lb-img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: 10px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.7);
          animation: lb-img-in 0.25s ease;
          user-select: none;
        }
        @keyframes lb-img-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }

        /* Nav arrows */
        .lb-arrow {
          position: absolute; top: 50%; transform: translateY(-50%);
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff; border-radius: 50%;
          width: 48px; height: 48px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; z-index: 10;
          transition: background 0.18s, transform 0.18s;
        }
        .lb-arrow:hover {
          background: rgba(255,255,255,0.22);
          transform: translateY(-50%) scale(1.08);
        }
        .lb-arrow:disabled {
          opacity: 0.25;
          cursor: default;
          transform: translateY(-50%);
        }
        .lb-arrow--left  { left: 12px; }
        .lb-arrow--right { right: 12px; }

        /* Caption */
        .lb-caption {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,0.8));
          color: #fff; text-align: center;
          font-size: 0.95rem; font-weight: 500; line-height: 1.4;
          padding: 2.5rem 2rem 1.25rem;
          pointer-events: none;
        }

        /* Thumbnail strip */
        .lb-thumbs {
          flex-shrink: 0;
          display: flex; gap: 8px;
          justify-content: center; align-items: center;
          padding: 0.75rem 1rem 1rem;
          background: linear-gradient(transparent, rgba(0,0,0,0.6));
          width: 100%; max-width: 100%;
          overflow-x: auto;
          box-sizing: border-box;
        }
        .lb-thumb {
          width: 56px; height: 56px; flex-shrink: 0;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          border: 2.5px solid transparent;
          transition: border-color 0.18s, transform 0.18s;
          opacity: 0.65;
        }
        .lb-thumb img {
          width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .lb-thumb.active {
          border-color: #fff;
          opacity: 1;
          transform: scale(1.08);
        }
        .lb-thumb:hover:not(.active) { opacity: 0.9; }

        .reactions-popup {
          background: rgba(7, 23, 45, 0.95);
          border: 1px solid rgba(96, 165, 250, 0.25);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
          transform: translateY(-8px) translateX(-10px);
          animation: reactionsPop 0.25s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
        }
        [data-mode="light"] .reactions-popup {
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(148, 163, 184, 0.35);
          box-shadow: 0 8px 32px 0 rgba(15, 23, 42, 0.15);
        }
        @keyframes reactionsPop {
          from { opacity: 0; transform: translateY(-4px) scale(0.9) translateX(-10px); }
          to { opacity: 1; transform: translateY(-8px) scale(1) translateX(-10px); }
        }
        .reaction-emoji-btn {
          transition: transform 0.15s cubic-bezier(0.18, 0.89, 0.32, 1.28) !important;
        }
        .reaction-emoji-btn:hover {
          transform: scale(1.35) translateY(-4px) !important;
        }

        /* Reactors Modal styles */
        .reactors-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
          animation: reactorsFadeIn 0.25s ease-out;
        }
        .reactors-modal-content {
          width: 90%;
          max-width: 550px;
          max-height: 80vh;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: reactorsScaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        [data-mode="light"] .reactors-modal-content {
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid rgba(0, 0, 0, 0.1);
          box-shadow: 0 20px 40px rgba(0,0,0,0.15);
        }
        @keyframes reactorsFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes reactorsScaleUp {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .reactors-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          position: relative;
        }
        [data-mode="light"] .reactors-modal-header {
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .reactors-modal-title {
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }
        .reactors-modal-close {
          background: rgba(255, 255, 255, 0.05);
          border: none;
          color: var(--text-secondary);
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .reactors-modal-close:hover {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
        }
        [data-mode="light"] .reactors-modal-close {
          background: rgba(0, 0, 0, 0.05);
        }
        [data-mode="light"] .reactors-modal-close:hover {
          background: rgba(0, 0, 0, 0.1);
        }
        
        /* Tabs Container */
        .reactors-modal-tabs {
          display: flex;
          gap: 0.5rem;
          padding: 0 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          overflow-x: auto;
          white-space: nowrap;
          scrollbar-width: none;
        }
        .reactors-modal-tabs::-webkit-scrollbar {
          display: none;
        }
        [data-mode="light"] .reactors-modal-tabs {
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .reactors-tab-btn {
          background: none;
          border: none;
          padding: 1rem 0.75rem;
          color: var(--text-secondary);
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          transition: color 0.2s;
        }
        .reactors-tab-btn:hover {
          color: var(--text-primary);
        }
        .reactors-tab-btn.active {
          color: var(--accent-primary);
          font-weight: 600;
        }
        .reactors-tab-btn.active::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 3px;
          background: var(--accent-primary);
          border-radius: 3px 3px 0 0;
        }
        
        /* Body / Users List */
        .reactors-modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 1rem 1.5rem;
          min-height: 250px;
        }
        .reactor-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .reactor-item:last-child {
          border-bottom: none;
        }
        [data-mode="light"] .reactor-item {
          border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        }
        .reactor-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .reactor-avatar-wrapper {
          position: relative;
          width: 44px;
          height: 44px;
        }
        .reactor-avatar {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          background: var(--bg-tertiary);
        }
        .reactor-badge-overlay {
          position: absolute;
          bottom: -2px;
          right: -2px;
          background: var(--bg-primary);
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          border: 2px solid var(--bg-primary);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        [data-mode="light"] .reactor-badge-overlay {
          border-color: rgba(255, 255, 255, 0.95);
        }
        .reactor-name-role {
          display: flex;
          flex-direction: column;
        }
        .reactor-name {
          font-weight: 500;
          color: var(--text-primary);
          cursor: pointer;
          transition: color 0.15s;
        }
        .reactor-name:hover {
          color: var(--accent-primary);
          text-decoration: underline;
        }
        .reactor-role {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        
        .reactor-action-btn {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }
        .reactor-action-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
        }
        [data-mode="light"] .reactor-action-btn {
          background: rgba(0, 0, 0, 0.04);
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        [data-mode="light"] .reactor-action-btn:hover {
          background: rgba(0, 0, 0, 0.08);
          border-color: rgba(0, 0, 0, 0.12);
        }
        
        .reactors-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--text-secondary);
        }

        /* Share dropdown menu styling */
        .share-dropdown {
          position: absolute;
          bottom: 100%;
          left: 0;
          margin-bottom: 8px;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          z-index: 100;
          min-width: 170px;
          box-shadow: 0 12px 30px rgba(0,0,0,0.4);
          animation: shareDropdownPop 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
        }
        [data-mode="light"] .share-dropdown {
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 12px 30px rgba(0,0,0,0.12);
        }
        @keyframes shareDropdownPop {
          from { opacity: 0; transform: translateY(6px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .share-dropdown-item {
          background: none;
          border: none;
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          color: var(--text-primary);
          font-size: 0.88rem;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.15s, color 0.15s;
        }
        .share-dropdown-item:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--accent-primary);
        }
        [data-mode="light"] .share-dropdown-item:hover {
          background: rgba(0, 0, 0, 0.04);
          color: var(--accent-primary);
        }

        /* "Send to" Modal CSS */
        .share-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
          animation: shareFadeIn 0.25s ease-out;
        }
        .share-modal-content {
          width: 95%;
          max-width: 500px;
          height: 85vh;
          max-height: 700px;
          background: rgba(15, 23, 42, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 24px 48px rgba(0,0,0,0.5);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: shareScaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        [data-mode="light"] .share-modal-content {
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 24px 48px rgba(0,0,0,0.15);
        }
        @keyframes shareFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes shareScaleUp {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .share-modal-header {
          display: flex;
          align-items: center;
          padding: 1rem 1.25rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        [data-mode="light"] .share-modal-header {
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .share-modal-back, .share-modal-close {
          background: none;
          border: none;
          color: var(--text-secondary);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .share-modal-back:hover, .share-modal-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }
        [data-mode="light"] .share-modal-back:hover, [data-mode="light"] .share-modal-close:hover {
          background: rgba(0, 0, 0, 0.05);
        }
        .share-modal-title {
          flex: 1;
          text-align: center;
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }
        
        /* Search Box */
        .share-search-container {
          display: flex;
          align-items: center;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 8px 14px;
          margin: 1rem 1.25rem;
          gap: 8px;
        }
        [data-mode="light"] .share-search-container {
          background: rgba(0, 0, 0, 0.03);
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        .share-search-icon {
          color: var(--text-secondary);
        }
        .share-search-input {
          background: none;
          border: none;
          color: var(--text-primary);
          font-size: 0.9rem;
          width: 100%;
          outline: none;
        }
        
        /* Recipients List */
        .share-modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 0 1.25rem 1rem;
        }
        .share-recipient-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 0.5rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s;
          margin-bottom: 4px;
        }
        .share-recipient-row:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        [data-mode="light"] .share-recipient-row:hover {
          background: rgba(0, 0, 0, 0.03);
        }
        .share-recipient-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .share-recipient-avatar-wrapper {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          background: var(--bg-tertiary);
        }
        .share-recipient-avatar {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .share-recipient-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .share-recipient-name {
          font-weight: 500;
          color: var(--text-primary);
          font-size: 0.92rem;
        }
        .share-recipient-role {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }
        
        /* Checkbox styling */
        .share-checkbox {
          width: 18px;
          height: 18px;
          border-radius: 4px;
          border: 2px solid var(--text-secondary);
          cursor: pointer;
          accent-color: var(--accent-primary);
        }

        /* Modal Footer */
        .share-modal-footer {
          padding: 1rem 1.25rem;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: rgba(10, 15, 30, 0.5);
        }
        [data-mode="light"] .share-modal-footer {
          border-top: 1px solid rgba(0, 0, 0, 0.08);
          background: rgba(0, 0, 0, 0.01);
        }
        .share-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 8px 16px;
        }
        [data-mode="light"] .share-input-wrapper {
          background: rgba(0, 0, 0, 0.03);
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        .share-optional-message {
          background: none;
          border: none;
          color: var(--text-primary);
          font-size: 0.9rem;
          width: 100%;
          outline: none;
        }
        .share-input-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22c55e;
          margin-left: 8px;
        }
        .share-send-btn {
          width: 100%;
          background: var(--accent-primary);
          border: none;
          color: white;
          padding: 10px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: opacity 0.2s, background 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .share-send-btn:hover:not(:disabled) {
          background: var(--accent-hover, #be123c);
        }
        .share-send-btn:disabled {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
          cursor: not-allowed;
        }
        [data-mode="light"] .share-send-btn:disabled {
          background: rgba(0, 0, 0, 0.05);
        }
        .share-loading-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--text-secondary);
        }
        .share-empty-list {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 150px;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .project-title-link {
          transition: color 0.2s ease;
        }
        .project-title-link:hover {
          color: var(--accent-primary);
          text-decoration: underline;
        }
        .project-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1200;
          animation: projectFadeIn 0.25s ease-out;
        }
        .project-modal-content {
          width: 95%;
          max-width: 720px;
          max-height: 90vh;
          background: rgba(15, 23, 42, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 24px 48px rgba(0,0,0,0.6);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: projectScaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        [data-mode="light"] .project-modal-content {
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 24px 48px rgba(0,0,0,0.15);
        }
        @keyframes projectFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes projectScaleUp {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .project-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        [data-mode="light"] .project-modal-header {
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .project-modal-header h3 {
          margin: 0;
          font-size: 1.3rem;
          font-weight: 700;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .project-modal-close {
          background: none;
          border: none;
          color: var(--text-secondary);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .project-modal-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }
        [data-mode="light"] .project-modal-close:hover {
          background: rgba(0, 0, 0, 0.04);
        }
        .project-modal-body {
          padding: 1.5rem;
          overflow-y: auto;
          flex: 1;
        }
        .project-modal-meta {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1.25rem;
          flex-wrap: wrap;
        }
        .project-modal-badge {
          font-size: 0.8rem;
          padding: 0.25rem 0.75rem;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-secondary);
          border-radius: 50px;
          font-weight: 500;
        }
        [data-mode="light"] .project-modal-badge {
          background: rgba(0, 0, 0, 0.03);
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        .project-modal-section-title {
          font-size: 1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          margin-bottom: 0.5rem;
          margin-top: 1.5rem;
        }
        .project-modal-synopsis {
          font-size: 0.95rem;
          line-height: 1.6;
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 1rem;
        }
        [data-mode="light"] .project-modal-synopsis {
          background: rgba(0, 0, 0, 0.01);
          border: 1px solid rgba(0, 0, 0, 0.03);
        }
        .project-modal-credits-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 0.75rem;
        }
        .project-modal-credit-item {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          padding: 0.75rem 1rem;
          display: flex;
          flex-direction: column;
        }
        [data-mode="light"] .project-modal-credit-item {
          background: rgba(0, 0, 0, 0.02);
          border: 1px solid rgba(0, 0, 0, 0.04);
        }
        .project-modal-credit-role {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
        }
        .project-modal-credit-name {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text-primary);
          margin-top: 0.1rem;
        }
        .project-modal-awards-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .project-modal-award-item {
          background: rgba(212, 175, 55, 0.06);
          border: 1px solid rgba(212, 175, 55, 0.2);
          border-radius: 8px;
          padding: 0.75rem 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .project-modal-award-info {
          display: flex;
          flex-direction: column;
        }
        .project-modal-award-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .project-modal-award-details {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
      `}</style>

      {/* ── Lightbox Portal ── */}
      {lightbox && createPortal(
        <div
          className="lb-backdrop"
          onClick={e => { if (e.target === e.currentTarget) closeLightbox(); }}
        >
          {/* Top bar */}
          <div 
            className="lb-topbar"
            onClick={e => { if (e.target === e.currentTarget) closeLightbox(); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div className="lb-counter">
              {lightbox.idx + 1} / {lightbox.images.length}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                className="lb-download" 
                onClick={() => handleDownload(resolveMediaUrl(lightbox.images[lightbox.idx].url))} 
                title="Download Image"
              >
                <Download size={18} />
              </button>
              <button className="lb-close" onClick={closeLightbox} aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Main image area */}
          <div 
            className="lb-main"
            onClick={e => { if (e.target === e.currentTarget) closeLightbox(); }}
          >
            {/* Prev arrow */}
            <button
              className="lb-arrow lb-arrow--left"
              onClick={lightboxPrev}
              disabled={lightbox.idx === 0}
              aria-label="Previous"
            >
              <ChevronLeft size={24} />
            </button>

            {/* Image */}
            <img
              key={lightbox.idx}
              className="lb-img"
              src={resolveMediaUrl(lightbox.images[lightbox.idx].url)}
              alt={lightbox.images[lightbox.idx].caption || `Image ${lightbox.idx + 1}`}
            />

            {/* Next arrow */}
            <button
              className="lb-arrow lb-arrow--right"
              onClick={lightboxNext}
              disabled={lightbox.idx === lightbox.images.length - 1}
              aria-label="Next"
            >
              <ChevronRight size={24} />
            </button>

            {/* Caption */}
            {lightbox.images[lightbox.idx].caption?.trim() && (
              <div className="lb-caption">{lightbox.images[lightbox.idx].caption}</div>
            )}
          </div>

          {/* Thumbnail strip — only when > 1 image */}
          {lightbox.images.length > 1 && (
            <div className="lb-thumbs">
              {lightbox.images.map((img, i) => (
                <div
                  key={i}
                  className={`lb-thumb ${i === lightbox.idx ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); setLightbox(prev => ({ ...prev, idx: i })); }}
                >
                  <img src={resolveMediaUrl(img.url)} alt={`Thumbnail ${i + 1}`} />
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* ── Reactors Modal Portal ── */}
      {(reactorsModalPostId || reactorsModalCommentId) && createPortal(
        <div className="reactors-modal-overlay" onClick={() => { setReactorsModalPostId(null); setReactorsModalCommentId(null); }}>
          <div className="reactors-modal-content" onClick={e => e.stopPropagation()}>
            <div className="reactors-modal-header">
              <h3 className="reactors-modal-title">People who reacted</h3>
              <button className="reactors-modal-close" onClick={() => { setReactorsModalPostId(null); setReactorsModalCommentId(null); }}>
                <X size={16} />
              </button>
            </div>
            
            {loadingReactors ? (
              <div className="reactors-empty" style={{ minHeight: '200px' }}>
                <div className="spinner">Loading...</div>
              </div>
            ) : reactorsList.length === 0 ? (
              <div className="reactors-empty" style={{ minHeight: '200px' }}>
                <p>No reactions yet.</p>
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="reactors-modal-tabs">
                  <button 
                    className={`reactors-tab-btn ${activeReactorTab === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveReactorTab('all')}
                  >
                    All {reactorsList.length}
                  </button>
                  {(() => {
                    const presentTypes = [...new Set(reactorsList.map(r => r.reaction_type))];
                    return presentTypes.map(type => {
                      const opt = REACTION_OPTIONS.find(o => o.type === type);
                      const emoji = opt ? opt.emoji : '👍';
                      const count = reactorsList.filter(r => r.reaction_type === type).length;
                      return (
                        <button
                          key={type}
                          className={`reactors-tab-btn ${activeReactorTab === type ? 'active' : ''}`}
                          onClick={() => setActiveReactorTab(type)}
                        >
                          <span style={{ fontSize: '1rem' }}>{emoji}</span>
                          <span>{count}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
                
                {/* List */}
                <div className="reactors-modal-body custom-scrollbar">
                  {(() => {
                    const filtered = activeReactorTab === 'all' 
                      ? reactorsList 
                      : reactorsList.filter(r => r.reaction_type === activeReactorTab);
                    return filtered.map(reactor => {
                      const opt = REACTION_OPTIONS.find(o => o.type === reactor.reaction_type);
                      const emoji = opt ? opt.emoji : '👍';
                      return (
                        <div key={reactor.user_id} className="reactor-item">
                          <div className="reactor-info">
                            <div className="reactor-avatar-wrapper">
                              {reactor.profile_picture ? (
                                <img 
                                  className="reactor-avatar" 
                                  src={resolveMediaUrl(reactor.profile_picture)} 
                                  alt="" 
                                />
                              ) : (
                                <img 
                                  className="reactor-avatar" 
                                  src={`${import.meta.env.BASE_URL}avatars/male1.png`} 
                                  alt="" 
                                  style={{ opacity: 0.5 }} 
                                />
                              )}
                              <div className="reactor-badge-overlay">
                                {emoji}
                              </div>
                            </div>
                            <div className="reactor-name-role">
                              <span 
                                className="reactor-name"
                                onClick={() => {
                                  setReactorsModalPostId(null);
                                  setReactorsModalCommentId(null);
                                  navigate(`/profile/${reactor.user_id}`);
                                }}
                              >
                                {reactor.first_name} {reactor.last_name}
                              </span>
                              <span className="reactor-role">
                                {reactor.role === 'admin' ? 'Admin' : reactor.role === 'instructor' ? 'Teacher' : 'Student'}
                              </span>
                            </div>
                          </div>
                          
                          {Number(reactor.user_id) !== Number(currentUser?.id) && (
                            <button 
                              className="reactor-action-btn"
                              onClick={() => {
                                setReactorsModalPostId(null);
                                setReactorsModalCommentId(null);
                                navigate('/inbox', { 
                                  state: { 
                                    selectedUser: {
                                      id: reactor.user_id,
                                      first_name: reactor.first_name,
                                      last_name: reactor.last_name,
                                      role: reactor.role,
                                      profile_picture: reactor.profile_picture,
                                      username: reactor.username
                                    } 
                                  } 
                                });
                              }}
                            >
                              <MessageCircle size={14} />
                              <span>Message</span>
                            </button>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── "Send to" Modal Portal ── */}
      {shareModalPost && createPortal(
        <div className="share-modal-overlay" onClick={() => setShareModalPost(null)}>
          <div className="share-modal-content" onClick={e => e.stopPropagation()}>
            <div className="share-modal-header">
              <button className="share-modal-back" onClick={() => setShareModalPost(null)} aria-label="Back">
                <ChevronLeft size={20} />
              </button>
              <h3 className="share-modal-title">Send to</h3>
              <button className="share-modal-close" onClick={() => setShareModalPost(null)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="share-search-container">
              <Search size={16} className="share-search-icon" />
              <input 
                type="text" 
                className="share-search-input" 
                placeholder="Search for people"
                value={shareSearchQuery}
                onChange={e => setShareSearchQuery(e.target.value)}
              />
            </div>

            <div className="share-modal-body custom-scrollbar">
              {loadingRecipients ? (
                <div className="share-loading-spinner">
                  <div className="spinner">Loading...</div>
                </div>
              ) : recipients.length === 0 ? (
                <div className="share-empty-list">
                  <p>No results found</p>
                </div>
              ) : (
                recipients.map(user => {
                  const isChecked = selectedRecipients.has(user.id);
                  return (
                    <div 
                      key={user.id} 
                      className={`share-recipient-row ${isChecked ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedRecipients(prev => {
                          const next = new Set(prev);
                          if (next.has(user.id)) {
                            next.delete(user.id);
                          } else {
                            next.add(user.id);
                          }
                          return next;
                        });
                      }}
                    >
                      <div className="share-recipient-info">
                        <div className="share-recipient-avatar-wrapper">
                          {user.profile_picture ? (
                            <img 
                              className="share-recipient-avatar" 
                              src={resolveMediaUrl(user.profile_picture)} 
                              alt="" 
                            />
                          ) : (
                            <img 
                              className="share-recipient-avatar" 
                              src={`${import.meta.env.BASE_URL}avatars/male1.png`} 
                              alt="" 
                              style={{ opacity: 0.5 }} 
                            />
                          )}
                        </div>
                        <div className="share-recipient-details">
                          <span className="share-recipient-name">
                            {user.first_name} {user.last_name}
                          </span>
                          <span className="share-recipient-role">
                            {user.role === 'admin' ? 'Admin' : user.role === 'instructor' ? 'Teacher' : user.batch_number ? `Student - ${user.batch_number} Batch` : 'Student'}
                          </span>
                        </div>
                      </div>
                      <div className="share-checkbox-wrapper">
                        <input 
                          type="checkbox" 
                          className="share-checkbox" 
                          checked={isChecked} 
                          readOnly 
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="share-modal-footer">
              <div className="share-input-wrapper">
                <input 
                  type="text" 
                  className="share-optional-message"
                  placeholder="Add an optional message here..."
                  value={shareMessageText}
                  onChange={e => setShareMessageText(e.target.value)}
                  disabled={sendingShare}
                />
                <span className="share-input-dot"></span>
              </div>
              <button 
                className="share-send-btn" 
                disabled={selectedRecipients.size === 0 || sendingShare}
                onClick={async () => {
                  setSendingShare(true);
                  const shareUrl = `${window.location.origin}/community#post-${shareModalPost.id}`;
                  const postContentText = shareModalPost.content ? shareModalPost.content.substring(0, 100) + '...' : 'Check out this post!';
                  const fullMessage = shareMessageText.trim() 
                    ? `${shareMessageText.trim()}\n\nCheck out this post on BFI Community:\n${shareUrl}`
                    : `Check out this post on BFI Community:\n${shareUrl}`;

                  try {
                    const sendPromises = [...selectedRecipients].map(async (recipientId) => {
                      return fetch('/api/inbox/messages', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify({
                          receiver_id: recipientId,
                          content: fullMessage
                        })
                      });
                    });
                    
                    await Promise.all(sendPromises);
                    
                    await fetch(`/api/community/posts/${shareModalPost.id}/share`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                      }
                    });

                    setPosts(prev => prev.map(p => p.id === shareModalPost.id ? { ...p, shares_count: (p.shares_count || 0) + 1 } : p));
                    
                    await showAlert('Post shared successfully!', { title: 'Shared' });
                    setShareModalPost(null);
                  } catch (err) {
                    console.error('Error sharing post:', err);
                    await showAlert('Failed to share post with some recipients.', { title: 'Error' });
                  } finally {
                    setSendingShare(false);
                  }
                }}
              >
                {sendingShare ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <ReportFormModal
        open={!!reportComment}
        title="Report this Comment"
        subtitle="Reports are confidential and reviewed by our admin team."
        categories={[
          'Inappropriate or offensive content',
          'Spam or misleading',
          'Harassment or bullying',
          'Misinformation',
          'Nudity or sexual content',
          'Other',
        ]}
        detailLabel="Want to add more context?"
        detailPlaceholder="Describe what happened in your own words (optional, max 500 characters)"
        onClose={() => setReportComment(null)}
        onSubmit={submitCommentReport}
      />
      <ReportFormModal
        open={!!reportPost}
        title="Report this Post"
        subtitle="Reports are anonymous and reviewed by our admin team."
        categories={[
          'Inappropriate or offensive content',
          'Spam or misleading',
          'Harassment or bullying',
          'Misinformation',
          'Nudity or sexual content',
          'Other',
        ]}
        onClose={() => setReportPost(null)}
        onSubmit={handlePostReport}
      />

      {/* ── Project Details Modal Portal ── */}
      {selectedProject && createPortal(
        <div className="project-modal-overlay" onClick={() => setSelectedProject(null)}>
          <div className="project-modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="project-modal-header">
              <h3>
                <Film size={22} className="text-accent" style={{ color: 'var(--accent-primary)' }} />
                {selectedProject.title}
                {selectedProject.awards && selectedProject.awards.length > 0 ? (
                  <LaurelAward size={28} style={{ display: 'inline-block', verticalAlign: 'middle', filter: 'drop-shadow(0 0 4px rgba(255,165,0,0.5))' }} />
                ) : null}
              </h3>
              <button className="project-modal-close" onClick={() => setSelectedProject(null)}>
                <X size={20} />
              </button>
            </div>
            
            <div className="project-modal-body custom-scrollbar">
              {/* Video Player or Poster */}
              {selectedProject.media_link ? (
                <div className="proj-video-wrapper" style={{ marginBottom: '1.5rem', borderRadius: '12px', overflow: 'hidden' }}>
                  <iframe
                    src={getEmbedUrl(selectedProject.media_link, selectedProject.media_source)}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    style={{ width: '100%', height: '360px' }}
                  />
                </div>
              ) : getProjectPoster(selectedProject) ? (
                <div 
                  className="proj-poster-wrapper"
                  onClick={() => openLightbox([{ url: getProjectPoster(selectedProject), caption: selectedProject.title }], 0)}
                  style={{ cursor: 'pointer', marginBottom: '1.5rem', borderRadius: '12px', overflow: 'hidden', display: 'flex', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}
                >
                  <img
                    src={getProjectPoster(selectedProject)}
                    alt={selectedProject.title}
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                    onError={() => setBrokenThumbs(prev => ({...prev, [selectedProject.id]: true}))}
                  />
                </div>
              ) : null}

              {/* Metadata */}
              <div className="project-modal-meta">
                {selectedProject.genre && <span className="project-modal-badge">{selectedProject.genre}</span>}
                {selectedProject.duration && (
                  <span className="project-modal-badge">
                    {selectedProject.duration} {selectedProject.duration.toLowerCase().includes('min') || selectedProject.duration.toLowerCase().includes('hr') ? '' : 'mins'}
                  </span>
                )}
                {selectedProject.release_date && <span className="project-modal-badge">Released: {selectedProject.release_date}</span>}
              </div>

              {/* Synopsis */}
              {selectedProject.synopsis && (
                <>
                  <div className="project-modal-section-title">Synopsis</div>
                  <div className="project-modal-synopsis" style={{ whiteSpace: 'pre-wrap' }}>
                    {selectedProject.synopsis}
                  </div>
                </>
              )}

              {/* Awards List */}
              {selectedProject.awards && selectedProject.awards.length > 0 && (
                <>
                  <div className="project-modal-section-title">Awards & Accolades</div>
                  <div className="project-modal-awards-list">
                    {selectedProject.awards.map((award, index) => (
                      <div key={index} className="project-modal-award-item">
                        <LaurelAward size={36} style={{ filter: 'drop-shadow(0 0 4px rgba(255,165,0,0.4))' }} />
                        <div className="project-modal-award-info">
                          <div className="project-modal-award-title">{award.award_name}</div>
                          <div className="project-modal-award-details">
                            {award.festival_name} {award.award_year && `(${award.award_year})`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Credits */}
              {selectedProject.credits && selectedProject.credits.length > 0 && (
                <>
                  <div className="project-modal-section-title">Credits</div>
                  <div className="project-modal-credits-list">
                    {selectedProject.credits.map((c, i) => (
                      <div key={i} className="project-modal-credit-item">
                        <span className="project-modal-credit-role">{c.role}</span>
                        <span className="project-modal-credit-name">{c.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
