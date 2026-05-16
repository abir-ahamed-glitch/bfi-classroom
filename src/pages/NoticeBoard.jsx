import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Megaphone, AlertTriangle, Clock, Calendar, ChevronDown, ChevronUp, Layers, GraduationCap } from 'lucide-react';

export default function NoticeBoard() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [searchParams] = useSearchParams();
  const socketRef = useRef(null);

  useEffect(() => {
    fetchNotices();

    // Connect socket for real-time updates
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const token = localStorage.getItem('token');
    const socket = io(socketUrl, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('new_announcement', () => {
      // Re-fetch notices when admin broadcasts a new one
      fetchNotices();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Handle ?expand=noticeId from URL (when clicking "Read more" on Dashboard)
  useEffect(() => {
    const expandId = searchParams.get('expand');
    if (expandId && notices.length > 0) {
      const numId = parseInt(expandId, 10);
      setExpandedIds(prev => new Set(prev).add(numId));
      // Scroll to the expanded notice after a brief render delay
      setTimeout(() => {
        const el = document.getElementById(`notice-${numId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Flash highlight effect
          el.classList.add('notice-highlight');
          setTimeout(() => el.classList.remove('notice-highlight'), 2000);
        }
      }, 300);
    }
  }, [searchParams, notices]);

  const fetchNotices = async () => {
    if (window.location.hostname.includes('github.io')) {
      setNotices([
        { id: 1, title: 'Welcome to the BFI Classroom Demo', content: 'You are currently viewing the static preview of the application. Since GitHub Pages does not support a backend database, any data changes you make will not be saved.', priority: 'normal', created_at: new Date() }
      ]);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/student/notices', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const json = await res.json();
        setNotices(json.announcements || []);
      }
    } catch (error) {
      console.error('Fetch notices failed', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'var(--danger)';
      case 'normal': return 'var(--warning)';
      case 'low': return 'var(--success)';
      default: return 'var(--primary)';
    }
  };

  const getPriorityLabel = (priority) => {
    switch (priority) {
      case 'high': return 'Urgent';
      case 'normal': return 'Notice';
      case 'low': return 'Info';
      default: return 'Notice';
    }
  };

  const WORD_LIMIT = 60;

  const getWordCount = (text) => {
    if (!text) return 0;
    return text.trim().split(/\s+/).length;
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Notice Board...</h2></div>;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      <header className="dashboard-header" style={{ marginBottom: '3rem' }}>
        <div className="header-text">
          <h1 className="text-gradient font-display main-welcome">
            Notice Board
          </h1>
          <p className="subtitle">Important updates and announcements from the institute.</p>
        </div>
      </header>

      <div className="notices-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {notices.length > 0 ? (
          notices.map(notice => {
            const isLong = getWordCount(notice.content) > WORD_LIMIT;
            const isExpanded = expandedIds.has(notice.id);
            const priorityColor = getPriorityColor(notice.priority);

            return (
              <div 
                key={notice.id} 
                id={`notice-${notice.id}`}
                className="glass-panel card-hover" 
                style={{ 
                  padding: '2rem', 
                  borderLeft: `5px solid ${priorityColor}`,
                  background: notice.priority === 'high' ? 'rgba(239, 68, 68, 0.03)' : 'var(--glass-bg)',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease'
                }}
              >
                {/* Background Icon */}
                <Megaphone size={120} style={{ 
                  position: 'absolute', 
                  right: '-20px', 
                  bottom: '-20px', 
                  opacity: 0.03, 
                  transform: 'rotate(-15deg)',
                  pointerEvents: 'none'
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ 
                      width: '45px', 
                      height: '45px', 
                      borderRadius: '12px', 
                      background: `${priorityColor}20`,
                      color: priorityColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {notice.priority === 'high' ? <AlertTriangle size={22} /> : <Megaphone size={22} />}
                    </div>
                    <div>
                      <h3 style={{ 
                        fontSize: '1.4rem', 
                        margin: 0, 
                        color: notice.priority === 'high' ? 'var(--danger)' : 'var(--text-primary)',
                        fontWeight: 700 
                      }}>
                        {notice.title}
                      </h3>
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', opacity: 0.7, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Calendar size={14} /> {new Date(notice.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                        <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Clock size={14} /> {new Date(notice.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {notice.target_course && (
                      <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Layers size={11} /> {notice.target_course}
                      </span>
                    )}
                    {notice.target_batch && (
                      <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <GraduationCap size={11} /> Batch {notice.target_batch}
                      </span>
                    )}
                    <span style={{ 
                      padding: '4px 12px', 
                      borderRadius: '20px', 
                      fontSize: '0.75rem', 
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      background: `${priorityColor}15`,
                      color: priorityColor,
                      border: `1px solid ${priorityColor}30`
                    }}>
                      {getPriorityLabel(notice.priority)}
                    </span>
                  </div>
                </div>

                <div style={{ 
                  background: 'rgba(255,255,255,0.02)', 
                  padding: '1.5rem', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  lineHeight: 1.6,
                  color: 'var(--text-secondary)',
                  fontSize: '1.05rem',
                  whiteSpace: 'pre-wrap',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'max-height 0.6s cubic-bezier(0.4, 0, 0.2, 1), mask-image 0.6s ease',
                  maxHeight: isExpanded ? '3000px' : (isLong ? '160px' : 'none'),
                  WebkitMaskImage: (!isExpanded && isLong) ? 'linear-gradient(to bottom, black 40%, transparent 100%)' : 'none',
                  maskImage: (!isExpanded && isLong) ? 'linear-gradient(to bottom, black 40%, transparent 100%)' : 'none',
                }}>
                  {notice.content}
                </div>
                
                {isLong && (
                  <button
                    onClick={() => toggleExpand(notice.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginTop: '1rem',
                      padding: '0.6rem 1.2rem',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      color: 'var(--accent-primary, #60a5fa)',
                      cursor: 'pointer',
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      letterSpacing: '0.02em'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(96, 165, 250, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.3)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <ChevronDown size={16} style={{ 
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', 
                      transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' 
                    }} /> 
                    {isExpanded ? 'Show less' : 'Read full notice'}
                  </button>
                )}

                <p style={{ margin: '1rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  — Posted by <strong style={{ color: 'var(--text-secondary)' }}>Admin</strong>
                </p>
              </div>
            );
          })
        ) : (
          <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ 
              width: '80px', height: '80px', borderRadius: '50%', background: 'var(--glass-bg)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' 
            }}>
              <Megaphone size={40} opacity={0.2} />
            </div>
            <h2 className="font-display" style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Notices Yet</h2>
            <p>All official announcements and notices will appear here.</p>
          </div>
        )}
      </div>

      <style>{`
        .notice-highlight {
          animation: noticeHighlightPulse 2s ease-out;
        }
        @keyframes noticeHighlightPulse {
          0% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.5); }
          30% { box-shadow: 0 0 0 8px rgba(96, 165, 250, 0.25); }
          100% { box-shadow: none; }
        }
      `}</style>
    </div>
  );
}
