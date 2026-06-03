import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import { MessageSquare, Heart, Image as ImageIcon, Send, Film, Share2, Trash2, Pin, PinOff, Play, Video, GripVertical, X, Pencil, ChevronLeft, ChevronRight, Smile, MoreVertical, Download, Globe, GraduationCap, EyeOff, ChevronDown } from 'lucide-react';
import { AudienceSelector } from '../components/PrivacySelector';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
import { resolveMediaUrl } from '../utils/mediaUtils';
import UserHoverCard from '../components/UserHoverCard';
import { useModal } from '../components/BFIModal';
import PhotoEditorModal from '../components/PhotoEditorModal';
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
  const [postAudience, setPostAudience] = useState('public');
  const [editingPostId, setEditingPostId] = useState(null);
  const [editingPostText, setEditingPostText] = useState('');
  const [editingPostAudience, setEditingPostAudience] = useState('public');
  
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
  const [expandedComments, setExpandedComments] = useState({}); // commentId -> boolean
  const hoverTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const isLongPressRef = useRef(false);
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

  const openPhotoEditor = useCallback((index) => {
    setPhotoEditorIndex(index);
    setPhotoEditorOpen(true);
  }, []);

  const handlePhotoEditorSave = useCallback((updatedImages) => {
    setMediaImages(updatedImages);
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
        return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1&controls=1&origin=${window.location.origin}` : url;
      }
      if (source === 'vimeo') {
        const match = url.match(/vimeo\.com\/(?:[a-z]*\/)*([0-9]{6,11})[?]?.*/);
        return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=1` : url;
      }
      if (source === 'facebook') {
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560&autoplay=true`;
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
  const handleShareProjectClick = () => {
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
          audience: postAudience
        })
      });

      if (res.ok) {
        setContent('');
        setMediaImages([]);
        setSelectedProjectId(null);
        setSelectedProjectTitle('');
        setPostAudience('public');
        fetchPosts();
        if(socket) socket.emit('new_post', { user: currentUser.username });
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
  };

  const handleEditPostCancel = () => {
    setEditingPostId(null);
    setEditingPostText('');
    setEditingPostAudience('public');
  };

  const handleEditPostSave = async (postId) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          content: editingPostText,
          audience: editingPostAudience
        })
      });

      if (res.ok) {
        setEditingPostId(null);
        setEditingPostText('');
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

  const toggleLike = async (postId) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        setPosts(posts.map(p => {
          if (p.id === postId) {
            return {
              ...p,
              is_liked: !p.is_liked,
              likes_count: p.is_liked ? p.likes_count - 1 : p.likes_count + 1
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
        try { navigator.vibrate(50); } catch (err) {}
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

  const handleCommentReport = async (postId, commentId) => {
    setActiveCommentMenuId(null);
    const confirmed = await showConfirm(
      "Do you want to report this comment for moderation?",
      { title: 'Report Comment', confirmLabel: 'Report', cancelLabel: 'Cancel' }
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/community/posts/${postId}/comments/${commentId}/report`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        showAlert('Thank you for reporting. Our moderation team will review this comment.', { title: 'Comment Reported' });
      } else {
        showAlert('Failed to report comment', { title: 'Error' });
      }
    } catch (err) {
      console.error(err);
      showAlert('Failed to report comment', { title: 'Error' });
    }
  };

  const handleSharePost = async (post) => {
    const shareData = {
      title: 'BFI Community Post',
      text: `${post.first_name} ${post.last_name} shared on BFI Community:\n\n${post.content ? post.content.substring(0, 100) + '...' : 'Check out this post!'}`,
      url: window.location.origin + '/community'
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
        await showAlert('Post link copied to clipboard!', { title: 'Copied!' });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error sharing:', err);
        try {
          await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
          await showAlert('Post link copied to clipboard!', { title: 'Copied!' });
        } catch {
          await showAlert('Failed to copy link. Please manually copy the URL.', { title: 'Copy Failed' });
        }
      }
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
            images={mediaImages}
            initialIndex={photoEditorIndex}
            onSave={handlePhotoEditorSave}
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
                    
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {currentUser?.role === 'admin' && (
                        <button 
                          className={`pin-post-btn ${post.is_pinned ? 'active' : ''}`}
                          onClick={() => handlePinPost(post.id, post.is_pinned)}
                          title={post.is_pinned ? "Unpin Post" : "Pin Post"}
                        >
                          {post.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                      )}
                      
                      {(Number(post.user_id) === Number(currentUser?.id) || post.username === currentUser?.username || currentUser?.role === 'admin') && (
                        <>
                          <button 
                            className="edit-post-btn" 
                            onClick={() => handleEditPostStart(post)}
                            title="Edit Post"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                              transition: 'all 0.2s',
                              opacity: 0.7
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}
                          >
                            <Pencil size={14} />
                          </button>
                          <button 
                            className="delete-post-btn" 
                            onClick={() => handleDeletePost(post.id)} 
                            title="Delete Post"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="post-time" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {formatTime(post.created_at)}
                    <span style={{ display: 'inline-flex', opacity: 0.6 }} title={`Audience: ${post.audience || 'public'}`}>
                      {post.audience === 'only_me' && <EyeOff size={12} />}
                      {post.audience === 'batchmates' && <GraduationCap size={12} />}
                      {(!post.audience || post.audience === 'public') && <Globe size={12} />}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Post Content */}
            <div className="post-body">
              {editingPostId === post.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem', marginBottom: '1rem' }}>
                  <textarea
                    className="input-glass"
                    value={editingPostText}
                    onChange={(e) => setEditingPostText(e.target.value)}
                    style={{ width: '100%', minHeight: '80px', padding: '0.75rem', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Audience:</span>
                      <AudienceSelector value={editingPostAudience} onChange={setEditingPostAudience} />
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
                      <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{post.shared_project.title}</h3>
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

            {/* Post Actions */}
            <div className="post-actions">
              <button 
                className={`action-btn ${post.is_liked ? 'liked' : ''}`}
                onClick={() => toggleLike(post.id)}
              >
                <Heart size={18} fill={post.is_liked ? "currentColor" : "none"} /> 
                {post.likes_count} Likes
              </button>
              <button 
                className="action-btn"
                onClick={() => {
                  const input = document.getElementById(`comment-input-${post.id}`);
                  if (input) input.focus();
                }}
              >
                <MessageSquare size={18} /> 
                {post.comments?.length || 0} Comments
              </button>
              <button className="action-btn" onClick={() => handleSharePost(post)}>
                <Share2 size={18} /> Share
              </button>
            </div>

            {/* Comments Section */}
            <div className="comments-section" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(() => {
                  const commentsList = post.comments || [];
                  const parentComments = commentsList.filter(c => !c.parent_id);
                  const replyComments = commentsList.filter(c => c.parent_id);

                  return parentComments.map(comment => {
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
                              left: '15px',
                              width: '2px',
                              top: '32px',
                              bottom: '-16px',
                              background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
                              borderRadius: '1px'
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
                                        onClick={() => handleCommentReport(post.id, comment.id)}
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
                                <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
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
                                    left: '-33px',
                                    width: '21px',
                                    top: '-16px',
                                    bottom: '50%',
                                    borderLeft: '2px solid color-mix(in srgb, var(--text-muted) 20%, transparent)',
                                    borderBottom: '2px solid color-mix(in srgb, var(--text-muted) 20%, transparent)',
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
                                  {/* Vertical line segment */}
                                  <div style={{
                                    position: 'absolute',
                                    left: '-33px',
                                    width: '2px',
                                    top: '0',
                                    bottom: isLast ? 'auto' : '-12px',
                                    height: isLast ? '12px' : 'auto',
                                    background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
                                    borderRadius: '1px'
                                  }} />
                                  {/* Horizontal line for this reply */}
                                  <div style={{
                                    position: 'absolute',
                                    left: '-33px',
                                    width: '33px',
                                    top: '12px',
                                    borderBottom: '2px solid color-mix(in srgb, var(--text-muted) 20%, transparent)'
                                  }} />
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
                                              onClick={() => handleCommentReport(post.id, reply.id)}
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
                                                       color: 'var(--accent-primary)', 
                                                       fontWeight: 'bold', 
                                                       background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', 
                                                       border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)',
                                                       padding: '0.1rem 0.35rem', 
                                                       borderRadius: '4px',
                                                       marginRight: '0.35rem',
                                                       fontSize: '0.8rem',
                                                       display: 'inline-block'
                                                     }}>
                                                       {mentionBadge}
                                                     </span>
                                                     {displayText}
                                                   </>
                                                 ) : (
                                                   text
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
                                      <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
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
                              {thisReplies.length > 0 ? (
                                <>
                                  {/* Vertical line segment for Reply Input */}
                                  <div style={{
                                    position: 'absolute',
                                    left: '-33px',
                                    width: '2px',
                                    top: replyImages[comment.id] ? '-76px' : '-16px',
                                    bottom: '50%',
                                    background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
                                    borderRadius: '1px'
                                  }} />
                                  {/* Horizontal connector line for Reply Input */}
                                  <div style={{
                                    position: 'absolute',
                                    left: '-33px',
                                    width: '33px',
                                    top: '50%',
                                    borderBottom: '2px solid color-mix(in srgb, var(--text-muted) 20%, transparent)'
                                  }} />
                                </>
                              ) : (
                                /* L-shaped connector line for single reply input */
                                <div style={{
                                  position: 'absolute',
                                  left: '-33px',
                                  width: '33px',
                                  top: replyImages[comment.id] ? '-76px' : '-16px',
                                  bottom: '50%',
                                  borderLeft: '2px solid color-mix(in srgb, var(--text-muted) 20%, transparent)',
                                  borderBottom: '2px solid color-mix(in srgb, var(--text-muted) 20%, transparent)',
                                  borderBottomLeftRadius: '8px'
                                }} />
                              )}
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
                  });
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
                      <button className="btn btn-primary" onClick={() => handleCommentSubmit(post.id)}>Reply</button>

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
        
        .post-actions { display: flex; gap: 0.5rem; border-top: 1px solid var(--glass-border); padding-top: 1rem; }
        .action-btn { background: transparent; border: none; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.9rem; transition: all 0.2s; }
        .action-btn:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .action-btn.liked { color: var(--danger); }
        
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
    </div>
  );
}
