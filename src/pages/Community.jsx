import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import { MessageSquare, Heart, Image as ImageIcon, Send, Film, Share2 } from 'lucide-react';

export default function Community() {
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState(''); // Simulated image upload URL
  const [socket, setSocket] = useState(null);

  // For comments
  const [activeCommentPostId, setActiveCommentPostId] = useState(null);
  const [commentContent, setCommentContent] = useState('');
  const socketUrl = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

  useEffect(() => {
    fetchPosts();

    // Setup Socket.io for real-time feed
    const newSocket = io(socketUrl, { withCredentials: true });
    setSocket(newSocket);

    newSocket.on('new_post', () => {
      // In a real app we'd fetch the fully formatted post or standardise it,
      // here we just trigger a refetch to ensure consistent joined data (user details)
      fetchPosts();
    });

    return () => newSocket.disconnect();
  }, [socketUrl]);

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
    if (!content.trim() && !mediaUrl) return;

    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ content, media_url: mediaUrl })
      });

      if (res.ok) {
        setContent('');
        setMediaUrl('');
        fetchPosts(); // Trigger re-render (socket handles others)
        if(socket) socket.emit('new_post', { user: currentUser.username });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleLike = async (postId) => {
    try {
      const res = await fetch(`/api/community/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        // Optimistic update
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
        fetchPosts(); // Refresh to get the comment with user info
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
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
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div className="avatar composer-avatar">{currentUser?.firstName?.[0] || 'U'}</div>
          <textarea 
            className="input-glass"
            placeholder="What's on your mind? Share an idea, question, or image..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{ flex: 1, minHeight: '80px', padding: '1rem', resize: 'vertical' }}
          />
        </div>
        
        {mediaUrl && (
          <div style={{ position: 'relative', marginBottom: '1rem', marginLeft: '3.5rem' }}>
            <img src={mediaUrl} alt="Attached" style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px', border: '1px solid var(--glass-border)' }} />
            <button onClick={() => setMediaUrl('')} style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }}>x</button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginLeft: '3.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className="btn btn-glass" 
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
              onClick={() => {
                const url = prompt('Enter Image URL to attach:');
                if (url) setMediaUrl(url);
              }}
            >
              <ImageIcon size={16} /> Image
            </button>
            <button className="btn btn-glass" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} disabled title="Share Portfolio via the Portfolio Panel">
              <Film size={16} /> Share Project
            </button>
          </div>
          <button className="btn btn-primary" onClick={handlePostSubmit} disabled={!content.trim() && !mediaUrl}>
            <Send size={16} style={{ marginLeft: '-4px' }} /> Post
          </button>
        </div>
      </div>

      {/* Feed Area */}
      <div className="feed-container">
        {posts.map(post => (
          <div key={post.id} className="post-card glass-panel">
            
            {/* Post Header */}
            <div className="post-header">
              <div className="avatar">{post.first_name?.[0] || 'U'}</div>
              <div>
                <h4 className="post-author">{post.first_name} {post.last_name}</h4>
                <span className="post-time">{formatTime(post.created_at)}</span>
              </div>
            </div>

            {/* Post Content */}
            <div className="post-body">
              {post.content && <p className="post-text">{post.content}</p>}
              
              {post.media_type === 'image' && post.media_url && (
                <div className="post-media">
                  <img src={post.media_url} alt="Post media" />
                </div>
              )}

              {post.media_type === 'project' && post.shared_project && (
                <div className="shared-project-card">
                  <Film className="shared-icon" size={24} />
                  <div className="shared-details">
                    <span className="shared-label">Shared a Project</span>
                    <h4>{post.shared_project.title}</h4>
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
              <button className="action-btn">
                <Share2 size={18} /> Share
              </button>
            </div>

            {/* Comments Section */}
            {(activeCommentPostId === post.id || post.comments?.length > 0) && (
              <div className="comments-section">
                {post.comments?.map(comment => (
                  <div key={comment.id} className="comment">
                    <div className="comment-avatar">{comment.first_name?.[0] || 'U'}</div>
                    <div className="comment-content-box">
                      <div className="comment-author">{comment.first_name} {comment.last_name}</div>
                      <div className="comment-text">{comment.content}</div>
                      <div className="comment-time">{formatTime(comment.created_at)}</div>
                    </div>
                  </div>
                ))}
                
                {activeCommentPostId === post.id && (
                  <div className="comment-input-area">
                    <div className="comment-avatar min">{currentUser?.firstName?.[0] || 'U'}</div>
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
        
        .feed-container { display: flex; flex-direction: column; gap: 1.5rem; }
        .post-card { padding: 1.5rem; transition: transform 0.2s; }
        
        .post-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
        .post-header .avatar { background: var(--bg-tertiary); font-weight: bold; width: 44px; height: 44px; font-size: 1.1rem; }
        .post-author { font-size: 1.05rem; margin: 0; }
        .post-time { font-size: 0.8rem; color: var(--text-muted); }
        
        .post-body { margin-bottom: 1rem; }
        .post-text { font-size: 1rem; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap; margin-bottom: 1rem; }
        .post-media { border-radius: 12px; overflow: hidden; border: 1px solid var(--glass-border); margin-bottom: 1rem; }
        .post-media img { width: 100%; height: auto; max-height: 500px; object-fit: cover; display: block; }
        
        .shared-project-card { display: flex; align-items: center; gap: 1rem; padding: 1rem; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer; }
        .shared-project-card:hover { border-color: var(--accent-primary); }
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
      `}</style>
    </div>
  );
}


