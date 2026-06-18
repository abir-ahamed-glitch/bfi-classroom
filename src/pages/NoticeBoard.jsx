import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Megaphone, AlertTriangle, Clock, Calendar, ChevronDown, ChevronUp, Layers, GraduationCap, X, Download, FileText, File, Music, Video, Eye, Paperclip, Image as ImageIcon, Printer, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { renderAsync } from 'docx-preview';

const parseAttachment = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch (e) {
      // ignore
    }
  }
  return {
    name: 'notice_image.png',
    type: 'image/png',
    url: value
  };
};

const FileIcon = ({ type, size = 22 }) => {
  if (!type) return <File size={size} />;
  if (type.startsWith('image/')) return <ImageIcon size={size} />;
  if (type.startsWith('video/')) return <Video size={size} />;
  if (type.startsWith('audio/')) return <Music size={size} />;
  if (type === 'application/pdf') return <FileText size={size} style={{ color: '#ef4444' }} />;
  if (type.includes('word') || type.includes('document')) return <FileText size={size} style={{ color: '#3b82f6' }} />;
  if (type.includes('excel') || type.includes('sheet')) return <FileText size={size} style={{ color: '#10b981' }} />;
  return <File size={size} />;
};

const dataURLtoBlob = (dataurl) => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

function DocxRenderer({ url, name, handleDownload, onClose }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scale, setScale] = useState(1.0);

  const handleWrapperClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  useEffect(() => {
    let active = true;
    const loadDocx = async () => {
      try {
        setLoading(true);
        setError(null);
        
        let blob;
        if (url.startsWith('data:')) {
          blob = dataURLtoBlob(url);
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          blob = await response.blob();
        }
        
        if (!active) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          await renderAsync(blob, containerRef.current, null, {
            className: 'docx-preview',
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: false,
            ignorePadding: false,
            experimental: true
          });
        }
        setLoading(false);
      } catch (err) {
        console.error('Error rendering docx:', err);
        if (active) {
          setError(err.message || 'Error loading document');
          setLoading(false);
        }
      }
    };

    loadDocx();
    return () => {
      active = false;
    };
  }, [url]);

  const handlePrint = () => {
    if (!containerRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const content = containerRef.current.innerHTML;
    let stylesHtml = '';
    for (const sheet of document.styleSheets) {
      try {
        let rulesHtml = '';
        for (const rule of sheet.cssRules) {
          if (rule.type === CSSRule.FONT_FACE_RULE || rule.cssText.startsWith('@font-face')) {
            rulesHtml += rule.cssText;
          } else if (rule.cssText && (rule.cssText.includes('docx') || rule.cssText.includes('docx-preview'))) {
            rulesHtml += rule.cssText;
          }
        }
        if (rulesHtml) {
          stylesHtml += `<style>${rulesHtml}</style>`;
        }
      } catch (e) {
        if (sheet.href && (sheet.href.includes('fonts.googleapis.com') || sheet.href.includes('docx-preview'))) {
          stylesHtml += `<link rel="stylesheet" href="${sheet.href}">`;
        }
      }
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>${name}</title>
          ${stylesHtml}
          <style>
            @page { size: auto; margin: 0; }
            html, body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; }
            .docx-print-wrapper { margin: 0 !important; padding: 0 !important; }
            section.docx, section.docx-preview {
              box-shadow: none !important;
              border: none !important;
              background: #fff !important;
              color: #000 !important;
              margin: 0 auto !important;
              position: relative !important;
              page-break-inside: avoid;
              min-height: auto !important;
            }
            .docx-wrapper {
              padding: 0 !important;
              margin: 0 !important;
              background: #fff !important;
            }
            section.docx:not(:last-child), section.docx-preview:not(:last-child) {
              page-break-after: always;
            }
          </style>
        </head>
        <body>
          <div class="docx-print-wrapper">${content}</div>
          <script>
            window.addEventListener('DOMContentLoaded', () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 500);
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const zoomIn = () => setScale(prev => Math.min(prev + 0.1, 2.0));
  const zoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5));
  const resetZoom = () => setScale(1.0);

  return (
    <div 
      onClick={handleWrapperClick}
      style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      {loading && (
        <div style={{ padding: '2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="loader-spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderLeftColor: '#60a5fa', animation: 'spin 1s linear infinite' }}></div>
          <span>Loading document preview...</span>
        </div>
      )}
      
      {!loading && !error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '0.5rem 1rem',
          background: 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(8px)',
          borderRadius: '30px',
          border: '1px solid rgba(255,255,255,0.1)',
          marginBottom: '1rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          color: '#fff',
          zIndex: 10
        }}>
          <button 
            onClick={zoomOut}
            title="Zoom Out"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <ZoomOut size={18} />
          </button>
          
          <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '45px', textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          
          <button 
            onClick={zoomIn}
            title="Zoom In"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <ZoomIn size={18} />
          </button>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

          <button 
            onClick={resetZoom}
            title="Reset Zoom"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <RotateCcw size={16} />
          </button>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

          <button 
            onClick={handlePrint}
            title="Print Document"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <Printer size={18} />
          </button>
        </div>
      )}

      {error && (
        <div style={{
          background: 'var(--bg-secondary, #0e2238)',
          padding: '3rem 2.5rem',
          borderRadius: '16px',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          width: '450px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '20px',
            background: 'rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary, #60a5fa)',
            border: '1px solid var(--glass-border)'
          }}>
            <FileText size={42} />
          </div>
          <div>
            <h3 style={{ color: '#fff', fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 600 }}>{name}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              This document could not be previewed directly.
            </p>
          </div>
          <button
            onClick={() => handleDownload(url, name)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              background: 'var(--accent-primary, #60a5fa)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'none'}
          >
            <Download size={18} /> Download file to view
          </button>
        </div>
      )}
      <style>{`
        .docx-scroll-wrapper section.docx,
        .docx-scroll-wrapper section.docx-preview {
          background: #fff !important;
          color: #000 !important;
          box-shadow: 0 24px 80px rgba(0,0,0,0.6) !important;
          border: 1px solid rgba(0,0,0,0.15) !important;
          border-radius: 4px !important;
          margin: 0 auto 2rem auto !important;
          box-sizing: border-box !important;
          position: relative !important;
        }
      `}</style>
      <div 
        onClick={handleWrapperClick}
        className="docx-scroll-wrapper"
        style={{
          width: '100%',
          maxHeight: '88vh',
          overflowY: 'auto',
          display: loading || error ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.5rem 1rem 1rem 1rem',
          boxSizing: 'border-box'
        }}
      >
        <div 
          ref={containerRef} 
          style={{ 
            width: '100%', 
            maxWidth: '820px', 
            background: 'transparent', 
            color: '#000', 
            boxSizing: 'border-box',
            textAlign: 'left',
            zoom: scale
          }} 
        />
      </div>
    </div>
  );
}

function LightboxContent({ attachment, handleDownload, onClose }) {
  const { type, url, name } = attachment;

  const isWordDoc = type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                    type === 'application/msword' || 
                    (name && (name.endsWith('.docx') || name.endsWith('.doc')));

  if (isWordDoc) {
    return <DocxRenderer url={resolveMediaUrl(url)} name={name} handleDownload={handleDownload} onClose={onClose} />;
  }

  if (type.startsWith('image/')) {
    return (
      <img
        className="lb-img"
        src={resolveMediaUrl(url)}
        alt={name}
        style={{
          maxWidth: '90%',
          maxHeight: '80vh',
          objectFit: 'contain',
          borderRadius: '10px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          animation: 'lb-img-in 0.25s ease',
          userSelect: 'none'
        }}
      />
    );
  }

  if (type === 'application/pdf') {
    return (
      <iframe
        src={resolveMediaUrl(url)}
        title={name}
        style={{
          width: '85%',
          height: '80vh',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          backgroundColor: '#323639'
        }}
      />
    );
  }

  if (type.startsWith('video/')) {
    return (
      <video
        src={resolveMediaUrl(url)}
        controls
        autoPlay
        style={{
          maxWidth: '85%',
          maxHeight: '80vh',
          borderRadius: '8px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)'
        }}
      />
    );
  }

  if (type.startsWith('audio/')) {
    return (
      <div style={{
        background: 'var(--bg-secondary, #0e2238)',
        padding: '2.5rem',
        borderRadius: '16px',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        width: '400px',
        textAlign: 'center'
      }}>
        <div style={{ color: 'var(--accent-primary, #60a5fa)' }}>
          <Music size={48} />
        </div>
        <div style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 600 }}>{name}</div>
        <audio src={resolveMediaUrl(url)} controls autoPlay style={{ width: '100%' }} />
      </div>
    );
  }

  if (type === 'text/plain' || type.startsWith('text/')) {
    let textStr = '';
    const fileUrl = resolveMediaUrl(url);
    if (fileUrl.startsWith('data:')) {
      try {
        const base64Str = fileUrl.split(',')[1];
        textStr = atob(base64Str);
      } catch (e) {
        textStr = 'Unable to decode text file.';
      }
    } else {
      textStr = 'Loading file content...';
    }

    return (
      <div style={{
        width: '80%',
        maxHeight: '80vh',
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid var(--glass-border)',
        borderRadius: '12px',
        padding: '2rem',
        overflowY: 'auto',
        color: '#f8fafc',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        fontSize: '0.95rem',
        textAlign: 'left',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        lineHeight: 1.5
      }}>
        {textStr}
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary, #0e2238)',
      padding: '3rem 2.5rem',
      borderRadius: '16px',
      border: '1px solid var(--glass-border)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1.5rem',
      width: '450px',
      textAlign: 'center'
    }}>
      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '20px',
        background: 'rgba(255,255,255,0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--accent-primary, #60a5fa)',
        border: '1px solid var(--glass-border)'
      }}>
        <FileText size={42} />
      </div>
      <div>
        <h3 style={{ color: '#fff', fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 600 }}>{name}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
          This file type ({type || 'Unknown'}) cannot be previewed directly.
        </p>
      </div>
      <button
        onClick={() => handleDownload(resolveMediaUrl(url), name)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem',
          background: 'var(--accent-primary, #60a5fa)',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
        onMouseLeave={e => e.currentTarget.style.filter = 'none'}
      >
        <Download size={18} /> Download file to view
      </button>
    </div>
  );
}

export default function NoticeBoard() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [searchParams] = useSearchParams();
  const socketRef = useRef(null);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox]);

  const handleDownload = async (imageUrl, customFilename) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = customFilename || imageUrl.split('/').pop().split('?')[0] || 'notice_attachment.png';
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file', err);
      window.open(imageUrl, '_blank');
    }
  };
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
        { 
          id: 1, 
          title: 'Welcome to the BFI Classroom Demo', 
          content: 'You are currently viewing the static preview of the application. Since GitHub Pages does not support a backend database, we have enabled "Demo Mode" with mocked data so you can explore all student and admin features without restriction.\n\nKey features to explore:\n- Dashboard with project tracking\n- Course materials and lectures\n- Admin panel for student and announcement management\n- Community directory and portfolio views', 
          priority: 'high', 
          created_at: new Date() 
        },
        { 
          id: 2, 
          title: 'Admissions Open for Summer 2024', 
          content: 'Admissions are now open for the 76th Batch of the Online Filmmaking Course. Interested candidates can apply through the official website. The course curriculum has been updated with new modules on Virtual Production and AI in Filmmaking.', 
          priority: 'normal', 
          created_at: new Date(Date.now() - 86400000) 
        },
        { 
          id: 3, 
          title: 'Film Appreciation Workshop', 
          content: 'A 3-day intensive workshop on the Art of Film Appreciation will be held next weekend. Renowned critics and filmmakers will lead the sessions. Registration is mandatory for all current students.', 
          priority: 'low', 
          created_at: new Date(Date.now() - 172800000) 
        }
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
                          <Calendar size={14} /> {new Date(notice.scheduled_at || notice.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                        <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Clock size={14} /> {new Date(notice.scheduled_at || notice.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
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
                  border: '1px solid rgba(255,255,255,0.04)',
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
                  
                  {notice.image_url && (() => {
                    const attachment = parseAttachment(notice.image_url);
                    if (!attachment || !attachment.url) return null;
                    const isImage = attachment.type?.startsWith('image/');
                    
                    if (isImage) {
                      return (
                        <div 
                          onClick={() => setLightbox(attachment)}
                          style={{ 
                            marginTop: '1.5rem', 
                            borderRadius: '8px', 
                            overflow: 'hidden', 
                            maxWidth: '100%', 
                            maxHeight: '450px', 
                            border: '1px solid var(--glass-border)', 
                            background: 'rgba(0,0,0,0.1)',
                            cursor: 'zoom-in',
                            transition: 'opacity 0.2s',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center'
                          }}
                          onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                          onMouseLeave={e => e.currentTarget.style.opacity = 1}
                        >
                          <img src={resolveMediaUrl(attachment.url)} alt={attachment.name} style={{ maxWidth: '100%', maxHeight: '450px', objectFit: 'contain', display: 'block' }} />
                        </div>
                      );
                    } else {
                      return (
                        <div 
                          onClick={() => setLightbox(attachment)}
                          style={{ 
                            marginTop: '1.5rem', 
                            borderRadius: '10px', 
                            border: '1px solid var(--glass-border)', 
                            background: 'rgba(255,255,255,0.03)',
                            padding: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                            e.currentTarget.style.borderColor = 'var(--glass-border)';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                            <div style={{ 
                              width: '42px', 
                              height: '42px', 
                              borderRadius: '8px', 
                              background: 'rgba(255,255,255,0.05)', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              color: 'var(--accent-primary, #60a5fa)',
                              flexShrink: 0
                            }}>
                              <FileIcon type={attachment.type} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {attachment.name}
                              </p>
                              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                                {attachment.type.split('/')[1] || 'FILE'}
                              </p>
                            </div>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary, #60a5fa)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Eye size={14} /> Preview
                          </span>
                        </div>
                      );
                    }
                  })()}
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
                      border: '1px solid rgba(255,255,255,0.04)',
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
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)';
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

      {/* ── Lightbox Portal ── */}
      {lightbox && (() => {
        const attachment = typeof lightbox === 'string' ? { name: 'notice_image.png', type: 'image/png', url: lightbox } : lightbox;
        const isDoc = attachment.type === 'application/pdf' || 
                      attachment.type?.includes('word') || 
                      attachment.type?.includes('document') || 
                      (attachment.name && (attachment.name.endsWith('.docx') || attachment.name.endsWith('.doc') || attachment.name.endsWith('.pdf') || attachment.name.endsWith('.txt')));
        return createPortal(
          <div
            className="lb-backdrop"
            onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
          >
            {/* Top bar */}
            <div 
              className="lb-topbar"
              onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', width: '100%', boxSizing: 'border-box' }}
            >
              <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 600, marginLeft: '1rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                {attachment.name}
              </span>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  className="lb-close" 
                  onClick={() => handleDownload(resolveMediaUrl(attachment.url), attachment.name)} 
                  title="Download File"
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
                    cursor: 'pointer',
                    transition: 'background 0.18s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                >
                  <Download size={18} />
                </button>
                <button 
                  className="lb-close" 
                  onClick={() => setLightbox(null)} 
                  title="Close"
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
                    cursor: 'pointer',
                    transition: 'background 0.18s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(225,29,72,0.7)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Main image area */}
            <div 
              className="lb-main"
              onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
              style={{
                position: 'relative',
                width: '100%', 
                flex: 1,
                display: 'flex', 
                alignItems: isDoc ? 'flex-start' : 'center', 
                justifyContent: 'center',
                overflow: 'hidden',
                padding: isDoc ? '0 2rem 2rem 2rem' : '2rem',
                boxSizing: 'border-box'
              }}
            >
              <LightboxContent attachment={attachment} handleDownload={handleDownload} onClose={() => setLightbox(null)} />
            </div>
          </div>,
          document.body
        );
      })()}

      <style>{`
        .notice-highlight {
          animation: noticeHighlightPulse 2s ease-out;
        }
        @keyframes noticeHighlightPulse {
          0% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.5); }
          30% { box-shadow: 0 0 0 8px rgba(96, 165, 250, 0.25); }
          100% { box-shadow: none; }
        }
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
        @keyframes lb-img-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
