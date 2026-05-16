import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import { MessageSquare, Heart, Image as ImageIcon, Send, Film, Share2, Trash2, Pin, PinOff, Play, Video } from 'lucide-react';
import { resolveMediaUrl } from '../utils/mediaUtils';
import UserHoverCard from '../components/UserHoverCard';
let cachedCommunityPosts = [];
let cachedCommunityScrollY = 0;
let cachedCommunityUserId = null;

export default function Community() {
  const { currentUser } = useAuth();
  
  // Use cached posts only if the same user is viewing
  const shouldUseCache = currentUser?.id === cachedCommunityUserId;
  const [posts, setPosts] = useState(shouldUseCache ? cachedCommunityPosts : []);
  const [loading, setLoading] = useState(shouldUseCache ? cachedCommunityPosts.length === 0 : true);
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState(''); // Simulated image upload URL
  const [mediaError, setMediaError] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProjectTitle, setSelectedProjectTitle] = useState('');
  const [showImageOptions, setShowImageOptions] = useState(false);
  const [showProjectOptions, setShowProjectOptions] = useState(false);
  const [userProjects, setUserProjects] = useState([]);
  const [socket, setSocket] = useState(null);
  const [brokenThumbs, setBrokenThumbs] = useState({});
  const [brokenPostImages, setBrokenPostImages] = useState({});
  const [activeCommentPostId, setActiveCommentPostId] = useState(null);
  const [commentContent, setCommentContent] = useState('');
  const [showImageLinkInput, setShowImageLinkInput] = useState(false);
  const [tempImageUrl, setTempImageUrl] = useState('');

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
    const newSocket = io(socketUrl, { withCredentials: true });
    setSocket(newSocket);

    newSocket.on('new_post', () => {
      fetchPosts();
    });

    const handleClickOutside = (e) => {
      if (!e.target.closest('.relative-container')) {
        setShowImageOptions(false);
        setShowProjectOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

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
      document.removeEventListener('mousedown', handleClickOutside);
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
    setShowImageOptions(false);
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

  const handlePostSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim() && !mediaUrl && !selectedProjectId) return;

    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          content, 
          media_url: mediaUrl,
          project_id: selectedProjectId
        })
      });

      if (res.ok) {
        setContent('');
        setMediaUrl('');
        setMediaError(false);
        setSelectedProjectId(null);
        setSelectedProjectTitle('');
        fetchPosts();
        if(socket) socket.emit('new_post', { user: currentUser.username });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMediaUrlChange = (url) => {
    setMediaUrl(url);
    setMediaError(false);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        handleMediaUrlChange(reader.result);
        setSelectedProjectId(null);
        setSelectedProjectTitle('');
        setShowImageOptions(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const selectProject = (proj) => {
    setSelectedProjectId(proj.id);
    setSelectedProjectTitle(proj.title);
    setMediaUrl('');
    setShowProjectOptions(false);
  };

  const handleImageLinkSubmit = () => {
    let url = tempImageUrl.trim();
    if (url) {
      // Advanced Google Image link extraction
      try {
        if (url.includes('google.com/imgres')) {
          const urlObj = new URL(url);
          const imgUrl = urlObj.searchParams.get('imgurl');
          if (imgUrl) url = decodeURIComponent(imgUrl);
        } else if (url.includes('google.com/url')) {
          const urlObj = new URL(url);
          const redirectUrl = urlObj.searchParams.get('url');
          if (redirectUrl) url = decodeURIComponent(redirectUrl);
        }
      } catch (e) {
        console.error('URL parsing failed', e);
      }
      
      handleMediaUrlChange(url);
      setSelectedProjectId(null);
      setSelectedProjectTitle('');
      setShowImageLinkInput(false);
      setShowImageOptions(false);
      setTempImageUrl('');
    }
  };

  const handleDeletePost = async (postId) => {
    if (!postId) return;
    
    if (!window.confirm('Are you sure you want to delete this? If it\'s a shared project, it will also be removed from the community section.')) return;

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
        alert('Delete failed: ' + (err.error || 'Server error'));
      }
    } catch (err) {
      console.error('Fetch error:', err);
      alert('Connection error: ' + err.message);
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
        alert('Pin failed: ' + (err.error || 'Server error'));
      }
    } catch (err) {
      console.error('Pin failed', err);
      alert('Connection error while pinning');
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
    if (!commentContent.trim()) return;

    try {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ content: commentContent })
      });
      
      if (res.ok) {
        setCommentContent('');
        fetchPosts();
      }
    } catch (err) {
      console.error(err);
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
        alert('Post link copied to clipboard!');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error sharing:', err);
        try {
          await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
          alert('Post link copied to clipboard!');
        } catch {
          alert('Failed to copy link. Please manually copy the URL.');
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
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2.5rem', position: 'relative', zIndex: 9999, isolation: 'isolate' }}>
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
          />
        </div>
        
        {mediaUrl && (
          <div style={{ position: 'relative', marginBottom: '1rem', marginLeft: '3.5rem', width: 'fit-content', maxWidth: 'calc(100% - 3.5rem)', minWidth: '300px' }}>
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.4)', minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {mediaError ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <ImageIcon size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                  <p>Invalid or blocked image link. Please use a direct link to an image file (jpg, png).</p>
                </div>
              ) : (
                <img 
                  src={mediaUrl} 
                  alt="Attached" 
                  style={{ maxWidth: '100%', maxHeight: '400px', display: 'block' }} 
                  onError={() => setMediaError(true)}
                />
              )}
              <button 
                onClick={(e) => { 
                  e.preventDefault(); 
                  setMediaUrl('');
                  setMediaError(false);
                }} 
                style={{ 
                  position: 'absolute', 
                  top: '12px', 
                  right: '12px', 
                  background: '#e11d48', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '50%', 
                  width: '28px', 
                  height: '28px', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                  zIndex: 20,
                  transition: 'transform 0.2s'
                }}
                className="hover-scale"
              >
                ✕
              </button>
            </div>
          </div>
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
            <div style={{ position: 'relative' }}>
              <button 
                className={`btn btn-glass ${showImageOptions ? 'active' : ''}`} 
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                onClick={() => {
                  setShowImageOptions(!showImageOptions);
                  setShowProjectOptions(false);
                }}
              >
                <ImageIcon size={16} /> Image
              </button>
              
              {showImageOptions && (
                <div className="bfi-community-dropdown animate-fade-in">
                  {!showImageLinkInput ? (
                    <>
                      <label className="option-item">
                        <Send size={14} style={{ transform: 'rotate(-90deg)', color: 'var(--accent-primary)' }} /> 
                        <span>Upload from Device</span>
                        <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
                      </label>
                      <button className="option-item" onClick={() => setShowImageLinkInput(true)}>
                        <ImageIcon size={14} style={{ color: 'var(--accent-primary)' }} /> 
                        <span>Paste Image Link</span>
                      </button>
                    </>
                  ) : (
                    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#0d0d11' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '-0.25rem', lineHeight: '1.4' }}>
                        <strong style={{ color: 'var(--accent-primary)' }}>Tip:</strong> For Google images, right-click and select <span style={{ color: 'white' }}>"Copy Image Address"</span> for best results.
                      </div>
                      <input 
                        type="url" 
                        className="input-glass" 
                        placeholder="Paste image link here..." 
                        value={tempImageUrl}
                        onChange={(e) => setTempImageUrl(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleImageLinkSubmit()}
                        style={{ fontSize: '0.85rem', padding: '0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)' }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleImageLinkSubmit} style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem' }}>Add Image</button>
                        <button className="btn btn-glass" onClick={() => setShowImageLinkInput(false)} style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
          <button className="btn btn-primary" onClick={handlePostSubmit} disabled={!content.trim() && !mediaUrl && !selectedProjectId}>
            <Send size={16} style={{ marginLeft: '-4px' }} /> Post
          </button>
        </div>
      </div>

      {/* Feed Area */}
      <div className="feed-container" style={{ position: 'relative', zIndex: 1 }}>
        {posts.map(post => (
          <div key={post.id} className={`post-card glass-panel ${post.is_pinned ? 'pinned-post' : ''}`}>
            
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
                        <button 
                          className="delete-post-btn" 
                          onClick={() => handleDeletePost(post.id)} 
                          title="Delete Post"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <span className="post-time">{formatTime(post.created_at)}</span>
                </div>
              </div>
            </div>

            {/* Post Content */}
            <div className="post-body">
              {post.content && <p className="post-text">{post.content}</p>}
              
              {post.media_type === 'image' && post.media_url && (
                <div className="post-media" style={{ background: 'rgba(0,0,0,0.2)', minHeight: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {brokenPostImages[post.id] ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', width: '100%' }}>
                      Image could not be loaded. It may have been removed or is protected.
                    </div>
                  ) : (
                    <img 
                      src={resolveMediaUrl(post.media_url)} 
                      alt="Post media" 
                      onError={() => {
                        setBrokenPostImages(prev => ({ ...prev, [post.id]: true }));
                      }}
                    />
                  )}
                </div>
              )}

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
                    <div className="proj-poster-wrapper">
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
                onClick={() => setActiveCommentPostId(activeCommentPostId === post.id ? null : post.id)}
              >
                <MessageSquare size={18} /> 
                {post.comments?.length || 0} Comments
              </button>
              <button className="action-btn" onClick={() => handleSharePost(post)}>
                <Share2 size={18} /> Share
              </button>
            </div>

            {/* Comments Section */}
            {(activeCommentPostId === post.id || post.comments?.length > 0) && (
              <div className="comments-section">
                {post.comments?.map(comment => (
                  <div key={comment.id} className="comment">
                    <UserHoverCard userId={comment.user_id}>
                      <div className="comment-avatar" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {comment.profile_picture ? (
                          <img src={resolveMediaUrl(comment.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                        )}
                      </div>
                    </UserHoverCard>
                    <div className="comment-content-box">
                      <UserHoverCard userId={comment.user_id}>
                        <div className="comment-author" style={{ display: 'inline-block' }}>{comment.first_name} {comment.last_name}</div>
                      </UserHoverCard>
                      <div className="comment-text">{comment.content}</div>
                      <div className="comment-time">{formatTime(comment.created_at)}</div>
                    </div>
                  </div>
                ))}
                
                {activeCommentPostId === post.id && (
                  <div className="comment-input-area">
                    <div className="comment-avatar min" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {currentUser?.profile_picture ? (
                        <img src={resolveMediaUrl(currentUser.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                      )}
                    </div>
                    <input 
                      type="text" 
                      className="input-glass" 
                      placeholder="Write a comment..." 
                      value={commentContent}
                      onChange={(e) => setCommentContent(e.target.value)}
                      onKeyDown={(e) => {
                        if(e.key === 'Enter') handleCommentSubmit(post.id);
                      }}
                    />
                    <button className="btn btn-primary" onClick={() => handleCommentSubmit(post.id)}>Reply</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
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
        .pinned-post { border-left: 4px solid var(--accent-primary); background: rgba(var(--accent-primary-rgb), 0.03); }
        .pinned-badge { font-size: 0.7rem; color: var(--accent-primary); display: flex; align-items: center; gap: 4px; font-weight: 600; margin-top: 2px; }
        
        .post-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
        .post-header .avatar { background: var(--bg-tertiary); font-weight: bold; width: 44px; height: 44px; font-size: 1.1rem; }
        .post-author { font-size: 1.05rem; margin: 0; }
        .post-time { font-size: 0.8rem; color: var(--text-muted); }
        
        .post-body { margin-bottom: 1rem; }
        .post-text { font-size: 1rem; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap; margin-bottom: 1rem; }
        .post-media { border-radius: 12px; overflow: hidden; border: 1px solid var(--glass-border); margin-bottom: 1rem; }
        .post-media img { width: 100%; height: auto; max-height: 500px; object-fit: cover; display: block; }
        
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

        .bfi-community-dropdown {
          position: absolute;
          top: calc(100% + 12px);
          left: 0;
          min-width: 320px;
          display: flex;
          flex-direction: column;
          background: #0d0d11;
          border: 1px solid var(--glass-border);
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          z-index: 1000;
          border-radius: 12px;
          overflow: hidden;
        }
        .option-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.25rem;
          background: transparent;
          border: none;
          color: #e5e7eb;
          cursor: pointer;
          text-align: left;
          font-size: 0.9rem;
          transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
          width: 100%;
          font-weight: 500;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .option-item:last-child {
          border-bottom: none;
        }
        .option-item:hover {
          background: rgba(255, 255, 255, 0.08);
          color: white;
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
        .proj-thumbnail-placeholder:hover img {
          transform: scale(1.05);
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
          color: white;
          background: var(--accent-primary);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .dropdown-scroll {
          max-height: 350px;
          overflow-y: auto;
          background: #0d0d11 !important;
        }
        .project-option-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          width: 100%;
          background: #0d0d11 !important;
          border: none;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
          color: #e5e7eb;
        }
        .project-option-item:hover {
          background: rgba(255,255,255,0.08);
        }
        .proj-name {
          font-size: 0.95rem;
          color: white;
          font-weight: 600;
        }
        
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
