import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Users, Award, Download, Play, Star, ChevronRight, 
  FileText, ArrowDownToLine, Clock, Film, AlertTriangle, X, CheckCircle2,
  Layers, Megaphone, ArrowRight, Clapperboard, Camera, Video, Ticket, MonitorPlay
} from 'lucide-react';
import { io } from 'socket.io-client';
import jsPDF from 'jspdf';
import { useNavigate, Link } from 'react-router-dom';
import { resolveMediaUrl } from '../utils/mediaUtils';

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ pinnedProjects: [], recommendedProjects: [], stats: {}, announcements: [] });
  const [loading, setLoading] = useState(true);
  const [cvDownloading, setCvDownloading] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);
  const [brokenThumbs, setBrokenThumbs] = useState({});
  const socketRef = useRef(null);

  useEffect(() => {
    fetchDashboardData();

    // Real-time announcement listener
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const token = localStorage.getItem('token');
    const socket = io(socketUrl, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('new_announcement', () => {
      fetchDashboardData();
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const fetchDashboardData = async () => {
    // DEMO MODE FOR GITHUB PAGES
    if (window.location.hostname.includes('github.io')) {
      setData({
        pinnedProjects: [{ id: 1, title: 'BFI Demo Project', genre: 'Documentation', duration: 'N/A', synopsis: 'This is a demo project showcasing the UI layout. Database features are currently disabled on GitHub pages.', awards_count: 5 }],
        recommendedProjects: [],
        stats: { batch: 'Demo', isBfiaaMember: false, phase1_admitted: true, phase1_passed: true, phase2_admitted: false, phase2_completed: false },
        announcements: [{ id: 1, title: 'Welcome to the BFI Classroom Demo', content: 'You are currently viewing the static preview of the application. Since GitHub Pages does not support a backend database, any data changes you make will not be saved.', priority: 'normal', created_at: new Date() }],
        enrollments: [{ course_name: 'Film Appreciation Course' }]
      });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/student/dashboard', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (error) {
      console.error('Fetch dashboard failed', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadCV = async (format) => {
    setCvDownloading(true);
    try {
      if (format === 'pdf') {
        const doc = new jsPDF();
        // Modern Style CV Background
        doc.setFillColor(31, 41, 55); // Dark slate
        doc.rect(0, 0, 210, 297, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(28);
        doc.setFont("helvetica", "bold");
        doc.text(`${currentUser?.firstName} ${currentUser?.lastName}`.toUpperCase(), 20, 40);
        
        doc.setFontSize(14);
        doc.setTextColor(52, 211, 153); // Emerald accent
        doc.text("BFI CLASSROOM FILMMAKER", 20, 50);

        doc.setTextColor(200, 200, 200);
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 60);

        doc.setDrawColor(255, 255, 255);
        doc.line(20, 65, 190, 65);

        // Featured Projects
        if (data.pinnedProjects && data.pinnedProjects.length > 0) {
          doc.setFontSize(16);
          doc.setTextColor(255, 255, 255);
          doc.text("FEATURED FILMOGRAPHY", 20, 80);
          
          let y = 95;
          data.pinnedProjects.forEach((proj) => {
            doc.setFontSize(12);
            doc.setTextColor(96, 165, 250); // Blue accent for titles
            doc.text(proj.title, 20, y);
            
            doc.setFontSize(10);
            doc.setTextColor(150, 150, 150);
            doc.text(`${proj.genre} | ${proj.duration} | ${proj.awards_count} Awards`, 20, y + 6);
            
            doc.setTextColor(200, 200, 200);
            doc.text(proj.synopsis ? proj.synopsis.substring(0, 100) + '...' : '', 20, y + 12);
            y += 25;
          });
        }

        doc.save(`${currentUser?.firstName}_${currentUser?.lastName}_Filmography.pdf`);
      } else {
        alert(`${format.toUpperCase()} generation coming soon.`);
      }
    } catch (err) {
      console.error(err);
      alert('Error generating CV.');
    } finally {
      setCvDownloading(false);
    }
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading your Studio...</h2></div>;

  const { pinnedProjects, recommendedProjects, stats, announcements, enrollments = [] } = data;

  // Extract YouTube video ID and return thumbnail URL
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
    // Check database-stored thumbnails first
    if (proj.thumbnail_url) return resolveMediaUrl(proj.thumbnail_url);
    if (proj.poster_url) return resolveMediaUrl(proj.poster_url);
    // If no manual thumbnail, try to extract from media_link (YouTube)
    return getYoutubeThumbnail(proj.media_link) || null;
  };

  const isDirectVideoFile = (url) => {
    return Boolean(url && /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url));
  };

  const getHeroBackground = (proj) => {
    if (proj.poster_url) return resolveMediaUrl(proj.poster_url);
    if (proj.thumbnail_url) return resolveMediaUrl(proj.thumbnail_url);
    if (proj.media_link) {
      return getYoutubeThumbnail(proj.media_link) || null;
    }
    return null;
  };

  const getEmbedUrl = (url) => {
    if (!url) return null;
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
      return match
        ? `https://www.youtube.com/embed/${match[1]}?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&fs=1&origin=${window.location.origin}`
        : null;
    }
    if (url.includes('vimeo.com')) {
      const match = url.match(/vimeo\.com\/(\d+)/);
      return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=0&title=0&byline=0&portrait=0` : null;
    }
    return resolveMediaUrl(url);
  };

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      
      {/* Header Profile Summary */}
      <header className="dashboard-header" style={{ 
        position: 'relative', overflow: 'hidden', padding: '1.75rem 2.5rem', 
        borderRadius: '24px', background: 'var(--bg-secondary)', 
        border: '1px solid var(--glass-border)', 
        borderTop: '4px solid var(--accent-primary)',
        boxShadow: '0 12px 40px -12px rgba(0,0,0,0.2)', 
        marginBottom: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem'
      }}>
        
        {/* Subtle Decorative Cinematic Elements */}
        <div style={{ position: 'absolute', right: '5%', top: '-20px', opacity: 0.05, transform: 'rotate(12deg)', pointerEvents: 'none', color: 'var(--text-primary)' }}>
          <Clapperboard size={200} strokeWidth={1} />
        </div>
        <div style={{ position: 'absolute', left: '20%', bottom: '-50px', opacity: 0.04, transform: 'rotate(-8deg)', pointerEvents: 'none', color: 'var(--accent-primary)' }}>
          <Camera size={160} strokeWidth={1} />
        </div>

        <div className="header-text" style={{ position: 'relative', zIndex: 1 }}>
          <h1 className="text-gradient font-display main-welcome" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', fontSize: 'clamp(2rem, 4vw, 2.6rem)' }}>
            <Clapperboard size={36} color="var(--accent-primary)" />
            Welcome, {[currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ')}
          </h1>
          <div className="header-meta" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {currentUser?.role === 'instructor' ? (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-primary)', fontWeight: '600' }}>
                  <Award size={18} /> Teacher
                </span>
                {stats.subjects && (
                  <span style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.4rem', 
                    background: 'rgba(255, 255, 255, 0.05)', 
                    padding: '4px 10px', 
                    borderRadius: '8px', 
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem'
                  }}>
                    <Film size={16} className="text-secondary" /> 
                    {(() => {
                      try {
                        const subjects = JSON.parse(stats.subjects);
                        return Array.isArray(subjects) ? subjects.join(', ') : '';
                      } catch {
                        return '';
                      }
                    })()}
                  </span>
                )}
              </>
            ) : (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Users size={18} /> {currentUser?.batch || stats.batch || 'N/A'} Batch
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: stats.isBfiaaMember ? 'var(--warning)' : 'inherit' }}>
                  <Award size={18} /> {stats.isBfiaaMember ? 'BFIAA Member' : 'Non-BFIAA'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons" style={{ display: 'flex', gap: '1rem' }}>
          {currentUser?.role === 'admin' && (
            <button className="btn btn-glass" onClick={() => navigate('/admin/students')}>
              <Users size={18} /> Student Management
            </button>
          )}
          {currentUser?.role !== 'admin' && (
            <div style={{ position: 'relative', width: '100%' }} className="dropdown-container">
              <button className="btn btn-primary" disabled={cvDownloading} style={{ width: '100%' }}>
                {cvDownloading ? 'Generating...' : <><Download size={18} /> Download CV / Filmography</>}
              </button>
              <div className="dropdown-menu glass-panel" style={{ width: '100%', minWidth: '220px' }}>
                <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); downloadCV('pdf'); }}><FileText size={16}/> Standard PDF (Print)</div>
                <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); downloadCV('jpg'); }}><ArrowDownToLine size={16}/> High-Res JPG (Web)</div>
                <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); downloadCV('docx'); }}><FileText size={16}/> DOCX (Editable)</div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Notice Board Widget */}
      <section style={{ marginBottom: '3rem', position: 'relative' }}>
          {/* Subtle decoration */}
          <div style={{ position: 'absolute', right: '1%', top: '5%', opacity: 0.03, transform: 'rotate(-5deg)', pointerEvents: 'none', color: 'var(--text-primary)' }}>
            <Megaphone size={120} strokeWidth={1} />
          </div>
          <div className="glass-panel" style={{ padding: '1.5rem', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Megaphone className="text-accent" size={20} /> Notice Board
              </h2>
              <Link to="/notices" style={{ 
                fontSize: '0.85rem', 
                color: 'var(--text-secondary)', 
                textDecoration: 'none', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.3rem',
                fontWeight: 600,
                background: 'rgba(255,255,255,0.04)',
                padding: '0.4rem 0.8rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.05)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}>
                View all <ArrowRight size={14} />
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {loading ? (
                <div style={{ padding: '2.5rem 2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Loading notices...
                </div>
              ) : (!announcements || announcements.length === 0) ? (
                <div style={{ 
                  padding: '2.5rem 2rem', 
                  textAlign: 'center', 
                  color: 'var(--text-muted)', 
                  fontSize: '0.95rem',
                  background: 'rgba(255,255,255,0.015)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.75rem'
                }}>
                  <CheckCircle2 size={32} style={{ color: 'var(--success)', opacity: 0.8 }} />
                  <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-secondary)' }}>You're all caught up!</p>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>There are no recent announcements at this time.</p>
                </div>
              ) : announcements.slice(0, 2).map(ann => {
                const priorityColor = ann.priority === 'high' ? 'var(--danger)' : ann.priority === 'normal' ? 'var(--warning)' : 'var(--success)';
                const priorityLabel = ann.priority === 'high' ? 'Urgent' : ann.priority === 'normal' ? 'Notice' : 'Info';
                const annDate = new Date(ann.created_at);
                const words = ann.content ? ann.content.trim().split(/\s+/) : [];
                const isLong = words.length > 60;
                const truncatedContent = isLong ? words.slice(0, 60).join(' ') + '…' : ann.content;
                return (
                  <div key={ann.id} style={{
                    padding: '1.25rem 1.5rem',
                    borderRadius: '12px',
                    borderLeft: `4px solid ${priorityColor}`,
                    background: ann.priority === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                  {/* Top row: title + priority badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      {ann.priority === 'high' && <AlertTriangle size={16} style={{ color: priorityColor, flexShrink: 0 }} />}
                      <h3 style={{ fontSize: '1.05rem', margin: 0, color: ann.priority === 'high' ? 'var(--danger)' : 'var(--text-primary)', fontWeight: 700 }}>
                        {ann.title}
                      </h3>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                        padding: '2px 9px', borderRadius: '20px',
                        background: `${priorityColor}18`, color: priorityColor,
                        border: `1px solid ${priorityColor}40`
                      }}>{priorityLabel}</span>
                    </div>
                    {/* Date + Time */}
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                      {ann.target_course && (
                        <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Layers size={11} /> {ann.target_course}
                        </span>
                      )}
                      {ann.target_batch && (
                        <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Users size={11} /> Batch {ann.target_batch}
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Clock size={12} />
                        {annDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        {annDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  {/* Content — truncated at 60 words */}
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{truncatedContent}</p>
                  {isLong && (
                    <span
                      onClick={() => navigate(`/notices?expand=${ann.id}`)}
                      className="dashboard-read-more"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        marginTop: '0.6rem',
                        color: 'var(--accent-primary, #60a5fa)',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        letterSpacing: '0.01em'
                      }}
                    >
                      Read more <ChevronRight size={15} style={{ transition: 'transform 0.2s ease' }} />
                    </span>
                  )}
                  <p style={{ margin: '0.6rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    — Posted by <strong style={{ color: 'var(--text-secondary)' }}>Admin</strong>
                  </p>
                </div>
              );
            })}
          </div>
          </div>
        </section>
      {/* Live Course Progression (Students Only) */}
      {currentUser?.role === 'student' && (
        (() => {
          const enrolledCourses = enrollments.map(e => ({
            ...e,
            title: e.course_name,
            completed: e.step4_completed === 1
          }));

          if (enrolledCourses.length === 0) return null;

          return (
            <section style={{ marginBottom: '4rem', position: 'relative' }}>
              {/* Subtle cinematic decoration */}
              <div style={{ position: 'absolute', right: '5%', bottom: '-10%', opacity: 0.03, transform: 'rotate(10deg)', pointerEvents: 'none', color: 'var(--accent-primary)' }}>
                 <MonitorPlay size={160} strokeWidth={1} />
              </div>
              <h2 className="font-display" style={{ marginBottom: '1.5rem', fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Award className="text-accent" size={24} style={{ color: '#60a5fa' }} /> Live Course Progression
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {enrolledCourses.map((course, idx) => (
                  <div key={idx} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                      <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem', color: 'var(--text-secondary)' }}>
                        <Film size={20} /> {course.title}
                      </h3>
                      <button 
                        className="btn btn-primary" 
                        style={{ padding: '0.6rem 1.2rem', boxShadow: course.completed ? '0 4px 20px rgba(59, 130, 246, 0.4)' : 'none' }} 
                        disabled={!course.completed}
                        onClick={() => navigate('/certificates')}
                      >
                        <Download size={16} /> Download Certificate
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '4rem', flexWrap: 'wrap' }}>
                      {course.course_type === 'filmmaking' ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: course.step1_completed ? 1 : 0.5 }}>
                            <CheckCircle2 size={24} style={{ color: course.step1_completed ? '#10b981' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '1.1rem', color: course.step1_completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>Phase 1: Enrolled</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: course.step2_completed ? 1 : 0.5 }}>
                            <CheckCircle2 size={24} style={{ color: course.step2_completed ? '#10b981' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '1.1rem', color: course.step2_completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>Phase 1: Passed Exam</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: course.step3_completed ? 1 : 0.5 }}>
                            <CheckCircle2 size={24} style={{ color: course.step3_completed ? '#10b981' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '1.1rem', color: course.step3_completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>Phase 2: Enrolled</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                            <CheckCircle2 size={24} style={{ color: course.step4_completed ? '#10b981' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '1.1rem', color: course.step4_completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>Phase 2: Completed</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: course.step1_completed ? 1 : 0.5 }}>
                            <CheckCircle2 size={24} style={{ color: course.step1_completed ? '#10b981' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '1.1rem', color: course.step1_completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>Admission Confirmed</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                            <CheckCircle2 size={24} style={{ color: course.step4_completed ? '#10b981' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '1.1rem', color: course.step4_completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>Course Completed</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })()
      )}

      {/* Featured/Pinned Projects (Hero section - Netflix Style) */}
      <section style={{ marginBottom: '4rem', position: 'relative' }}>
        {/* Subtle cinematic decoration */}
        <div style={{ position: 'absolute', right: '10%', top: '30%', opacity: 0.03, transform: 'rotate(15deg)', pointerEvents: 'none', color: 'var(--text-primary)', zIndex: 0 }}>
          <Video size={180} strokeWidth={1} />
        </div>
        <h2 className="font-display" style={{ marginBottom: '1.5rem', fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative', zIndex: 1 }}>
          <Star className="text-accent" /> Featured on your Dashboard
        </h2>
        
        {pinnedProjects.length > 0 ? (
          <div className="hero-card">
            {/* Thumbnail side */}
            <div className="hero-thumb">
              {(() => {
                const bg = getHeroBackground(pinnedProjects[0]);
                return bg
                  ? <img 
                      src={bg} 
                      alt={pinnedProjects[0].title} 
                      className="hero-thumb-img" 
                      onError={(e) => {
                        const currentSrc = e.target.src;
                        if (currentSrc.includes('hqdefault.jpg')) {
                          e.target.src = currentSrc.replace('hqdefault.jpg', '0.jpg');
                        } else if (currentSrc.includes('0.jpg')) {
                          e.target.src = currentSrc.replace('0.jpg', 'mqdefault.jpg');
                        } else {
                          e.target.style.display = 'none';
                        }
                      }}
                    />
                  : <div className="hero-thumb-placeholder"><Film size={48} opacity={0.3} /></div>;
              })()}
              {pinnedProjects[0].awards_count > 0 && (
                <div className="hero-award-badge"><Award size={14} /> Award Winner</div>
              )}
            </div>

            {/* Info side */}
            <div className="hero-info">
              <div className="hero-badge-row">
                <span className="hero-badge hero-badge--new">{pinnedProjects[0].awards_count > 0 ? 'Award Winner' : 'New Release'}</span>
                {pinnedProjects[0].duration && <span className="hero-badge hero-badge--outline">{pinnedProjects[0].duration}</span>}
                {pinnedProjects[0].genre && <span className="hero-badge hero-badge--outline">{pinnedProjects[0].genre}</span>}
              </div>
              <h2 className="hero-title font-display">{pinnedProjects[0].title}</h2>
              {pinnedProjects[0].synopsis && (
                <p className="hero-synopsis">{pinnedProjects[0].synopsis}</p>
              )}
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={() => setActiveVideo(pinnedProjects[0])}>
                  <Play size={18} fill="currentColor" /> Watch Now
                </button>
                <button className="btn btn-glass" onClick={() => navigate('/portfolio')}>
                  More Info
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Film size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <p>You haven't pinned any projects to your dashboard yet.</p>
            <button className="btn btn-glass" style={{ marginTop: '1rem' }} onClick={() => navigate('/portfolio')}>Go to Portfolio</button>
          </div>
        )}
      </section>

      {/* Recommended Projects Row */}
      <section style={{ position: 'relative' }}>
        {/* Subtle cinematic decoration */}
        <div style={{ position: 'absolute', left: '-2%', top: '15%', opacity: 0.03, transform: 'rotate(-12deg)', pointerEvents: 'none', color: 'var(--text-primary)' }}>
          <Ticket size={140} strokeWidth={1} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem', position: 'relative', zIndex: 1 }}>
          <h2 className="font-display" style={{ fontSize: '1.8rem' }}>Recommended Projects</h2>
          <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }} onClick={() => navigate('/community')}>
            Explore All <ChevronRight size={16} />
          </span>
        </div>
        
        {recommendedProjects.length > 0 ? (
          <div className="movie-row">
            {recommendedProjects.map((proj) => (
              <div
                key={proj.id}
                className="movie-card"
                onClick={() => {
                  if (proj.media_link) {
                    setActiveVideo(proj);
                    return;
                  }
                  navigate('/community');
                }}
              >
                <div className="movie-poster">
                  {proj.awards_count > 0 && <div className="award-badge"><Award size={14} /></div>}
                  {getProjectPoster(proj) ? (
                    <img
                      src={getProjectPoster(proj)}
                      alt={proj.title}
                      onError={(e) => {
                        // Advanced fallback for YouTube thumbnails
                        const currentSrc = e.target.src;
                        if (currentSrc.includes('hqdefault.jpg')) {
                          e.target.src = currentSrc.replace('hqdefault.jpg', '0.jpg');
                        } else if (currentSrc.includes('0.jpg')) {
                          e.target.src = currentSrc.replace('0.jpg', 'mqdefault.jpg');
                        } else {
                          setBrokenThumbs((prev) => ({ ...prev, [proj.id]: true }));
                        }
                      }}
                    />
                  ) : (
                    <div className="poster-placeholder">
                      <Film size={32} opacity={0.5} />
                    </div>
                  )}
                  <div className="poster-overlay">
                    <Play size={40} className="play-icon" />
                  </div>
                </div>
                <div className="movie-info">
                  <h4>{proj.title}</h4>
                  <p className="movie-creator" onClick={(e) => { e.stopPropagation(); alert(`View profile of ${proj.first_name}`); }}>
                    By {proj.first_name} {proj.last_name}
                  </p>
                  <div className="movie-meta">
                    <span><Clock size={12} /> {proj.duration || 'N/A'}</span>
                    <span>{proj.genre}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>No public projects available to recommend right now.</p>
          </div>
        )}
      </section>

      <style>{`
        .dashboard-read-more:hover {
          opacity: 0.85;
        }
        .dashboard-read-more:hover svg {
          transform: translateX(3px);
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 3rem;
          gap: 1.5rem;
          flex-wrap: wrap;
        }
        .main-welcome {
          font-size: 3rem;
          letter-spacing: -1px;
        }
        .header-meta {
          display: flex;
          gap: 1.5rem;
          margin-top: 1rem;
          color: var(--text-secondary);
        }
        @media (max-width: 768px) {
          .dashboard-header {
            flex-direction: column;
            margin-bottom: 2rem;
            align-items: stretch;
          }
          .dashboard-header > div {
            flex-wrap: wrap;
          }
          .action-buttons {
            display: grid !important;
            grid-template-columns: 1fr;
            gap: 1rem;
            width: 100%;
          }
          .action-buttons .btn {
            width: 100%;
            justify-content: center;
          }
          .main-welcome {
            font-size: 2.2rem;
          }
        }
        .dropdown-container .dropdown-menu {
          display: none;
          opacity: 0;
          visibility: hidden;
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          flex-direction: column;
          padding: 0.5rem;
          z-index: 100;
          transition: opacity 0.2s ease, transform 0.2s ease;
          transform: translateY(8px);
          background: var(--bg-secondary, #1e1e2e);
          border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
          border-radius: 14px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .dropdown-container:hover .dropdown-menu,
        .dropdown-container:focus-within .dropdown-menu {
          display: flex;
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }
        /* Invisible bridge to prevent losing hover between button and menu */
        .dropdown-container::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 0;
          width: 100%;
          height: 10px;
        }
        .dropdown-item {
          padding: 0.75rem 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 10px;
          transition: background 0.15s ease, color 0.15s ease;
          font-size: 0.92rem;
        }
        .dropdown-item:hover {
          background: rgba(255,255,255,0.08);
          color: var(--text-primary, #fff);
        }
        .dropdown-item:active {
          background: rgba(255,255,255,0.14);
        }

        /* Featured Hero Card */
        .hero-card {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          border-radius: 20px;
          overflow: hidden;
          border: 1px solid var(--glass-border);
          background: var(--bg-secondary);
          min-height: 300px;
        }
        .hero-thumb {
          position: relative;
          background: #000;
          overflow: hidden;
        }
        .hero-thumb-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.4s ease;
        }
        .hero-card:hover .hero-thumb-img {
          transform: scale(1.04);
        }
        .hero-thumb-placeholder {
          width: 100%;
          height: 100%;
          min-height: 280px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #1a1a2e 0%, #12121e 100%);
        }
        .hero-award-badge {
          position: absolute;
          top: 1rem;
          left: 1rem;
          background: linear-gradient(135deg, var(--warning), #d97706);
          color: #000;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .hero-info {
          padding: 2.5rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 1rem;
          background: linear-gradient(135deg, var(--bg-secondary) 0%, rgba(225,29,72,0.04) 100%);
        }
        .hero-badge-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
        }
        .hero-badge {
          font-size: 0.8rem;
          font-weight: 600;
          padding: 0.25rem 0.7rem;
          border-radius: 20px;
        }
        .hero-badge--new {
          background: rgba(16,185,129,0.15);
          color: #34d399;
          border: 1px solid rgba(16,185,129,0.3);
        }
        .hero-badge--outline {
          background: rgba(255,255,255,0.05);
          color: var(--text-muted);
          border: 1px solid var(--glass-border);
        }
        .hero-title {
          font-size: clamp(1.4rem, 2.5vw, 2.2rem);
          font-weight: 800;
          line-height: 1.2;
          margin: 0;
          color: var(--text-primary);
        }
        .hero-synopsis {
          font-size: 0.95rem;
          color: var(--text-secondary);
          line-height: 1.65;
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin: 0;
        }
        .hero-actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin-top: 0.5rem;
        }
        @media (max-width: 768px) {
          .hero-card {
            grid-template-columns: 1fr;
          }
          .hero-thumb { min-height: 220px; }
          .hero-info { padding: 1.5rem; }
          .hero-title { font-size: 1.4rem; }
        }

        /* Netflix Style Row */
        .movie-row {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 1.5rem;
          padding-bottom: 1rem;
          width: 100%;
        }
        .movie-card {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          min-width: 0;
        }
        @media (max-width: 768px) {
          .movie-poster {
            border-radius: 16px;
          }
        }
        .movie-card:hover {
          transform: translateY(-8px) scale(1.02);
        }
        .movie-card:hover .poster-overlay {
          opacity: 1;
        }
        .movie-poster {
          aspect-ratio: 16/9;
          border-radius: 12px;
          overflow: hidden;
          background: var(--bg-secondary);
          position: relative;
          box-shadow: 0 10px 20px rgba(0,0,0,0.3);
        }
        .movie-poster img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .poster-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(45deg, var(--bg-tertiary), rgba(225, 29, 72, 0.1));
        }
        .award-badge {
          position: absolute;
          top: 10px;
          right: 10px;
          background: var(--warning);
          color: #000;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          z-index: 2;
          box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        }
        .poster-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s;
        }
        .play-icon {
          color: white;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));
          transform: scale(0.8);
          transition: transform 0.3s;
        }
        .movie-card:hover .play-icon {
          transform: scale(1);
        }
        .movie-info h4 {
          font-size: 1.1rem;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .movie-creator {
          font-size: 0.85rem;
          color: var(--text-muted);
          margin-bottom: 0.5rem;
        }
        .movie-creator:hover {
          color: var(--text-primary);
          text-decoration: underline;
        }
        .movie-meta {
          display: flex;
          gap: 1rem;
          align-items: center;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .movie-meta span {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        /* Video Modal Styles */
        .video-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 2rem;
          backdrop-filter: blur(10px);
          animation: dashboardFadeIn 0.3s ease;
        }
        .video-modal-content {
          width: 100%;
          max-width: 1100px;
          background: var(--bg-primary);
          border-radius: 24px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: dashboardSlideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .video-modal-close {
          position: absolute;
          top: 1.5rem;
          right: 1.5rem;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 10;
          transition: all 0.2s;
        }
        .video-modal-close:hover {
          background: var(--accent-primary);
          transform: rotate(90deg);
        }
        .video-player-container {
          position: relative;
          width: 100%;
          padding-top: 56.25%; /* 16:9 Aspect Ratio */
          background: #000;
        }
        .video-player-container iframe {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }
        .video-modal-info {
          padding: 2rem;
          background: linear-gradient(to bottom, rgba(255,255,255,0.02), transparent);
        }

        @keyframes dashboardFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dashboardSlideUp {
          from { transform: translateY(40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @media (max-width: 768px) {
          .video-modal-overlay { padding: 1rem; }
          .video-modal-content { border-radius: 16px; }
          .video-modal-info { padding: 1.25rem; }
          .video-modal-close { top: 0.75rem; right: 0.75rem; width: 36px; height: 36px; }
        }
      `}</style>

      {/* Video Modal */}
      {activeVideo && (
        <div className="video-modal-overlay" onClick={() => setActiveVideo(null)}>
          <div className="video-modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <button className="video-modal-close" onClick={() => setActiveVideo(null)}>
              <X size={24} />
            </button>
            <div className="video-player-container">
              {isDirectVideoFile(activeVideo.media_link) ? (
                <video
                  src={resolveMediaUrl(activeVideo.media_link)}
                  title={activeVideo.title}
                  controls
                  autoPlay
                  playsInline
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <iframe
                  src={getEmbedUrl(activeVideo.media_link)}
                  title={activeVideo.title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                ></iframe>
              )}
            </div>
            <div className="video-modal-info">
              <h3 className="font-display" style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>{activeVideo.title}</h3>
              <p style={{ margin: 0, opacity: 0.8, fontSize: '0.95rem' }}>{activeVideo.synopsis}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
