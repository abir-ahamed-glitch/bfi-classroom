import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Users, Award, Download, Play, Star, ChevronRight, 
  FileText, ArrowDownToLine, Clock, Film, AlertTriangle
} from 'lucide-react';
import jsPDF from 'jspdf';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ pinnedProjects: [], recommendedProjects: [], stats: {}, announcements: [] });
  const [loading, setLoading] = useState(true);
  const [cvDownloading, setCvDownloading] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    // DEMO MODE FOR GITHUB PAGES
    if (window.location.hostname.includes('github.io')) {
      setData({
        pinnedProjects: [{ id: 1, title: 'BFI Demo Project', genre: 'Documentation', duration: 'N/A', synopsis: 'This is a demo project showcasing the UI layout. Database features are currently disabled on GitHub pages.', awards_count: 5 }],
        recommendedProjects: [],
        stats: { batch: 'Demo', isBfiaaMember: false },
        announcements: [{ id: 1, title: 'Welcome to the BFI Classroom Demo', content: 'You are currently viewing the static preview of the application. Since GitHub Pages does not support a backend database, any data changes you make will not be saved.', priority: 'normal', created_at: new Date() }]
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

  const { pinnedProjects, recommendedProjects, stats, announcements } = data;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      
      {/* Header Profile Summary */}
      <header className="dashboard-header">
        <div className="header-text">
          <h1 className="text-gradient font-display main-welcome">
            Welcome, {[currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ')}
          </h1>
          <div className="header-meta">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Users size={18} /> {currentUser?.batch || stats.batch || 'N/A'} Batch
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: stats.isBfiaaMember ? 'var(--warning)' : 'inherit' }}>
              <Award size={18} /> {stats.isBfiaaMember ? 'BFIAA Member' : 'Non-BFIAA'}
            </span>
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

      {/* Global Announcements (Visible to everyone) */}
      {announcements && announcements.length > 0 && (
        <section style={{ marginBottom: '3rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {announcements.map(ann => (
              <div key={ann.id} className="glass-panel" style={{ 
                padding: '1.25rem 2rem', 
                borderLeft: ann.priority === 'high' ? '4px solid var(--danger)' : ann.priority === 'normal' ? '4px solid var(--warning)' : '4px solid var(--success)',
                background: ann.priority === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'var(--glass-bg)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1.1rem', margin: 0, color: ann.priority === 'high' ? 'var(--danger)' : 'var(--text-primary)' }}>
                    {ann.priority === 'high' && <AlertTriangle size={16} style={{ display: 'inline', marginRight: '0.5rem', transform: 'translateY(2px)' }}/>}
                    {ann.title}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(ann.created_at).toLocaleDateString()}</span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{ann.content}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Featured/Pinned Projects (Hero section - Netflix Style) */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 className="font-display" style={{ marginBottom: '1.5rem', fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Star className="text-accent" /> Featured on your Dashboard
        </h2>
        
        {pinnedProjects.length > 0 ? (
          <div className="netflix-hero">
            <div className="hero-content">
              <h1>{pinnedProjects[0].title}</h1>
              <div className="meta-tags">
                <span className="tag match">{pinnedProjects[0].awards_count > 0 ? 'Award Winner' : 'New Release'}</span>
                <span className="tag outline">{pinnedProjects[0].duration}</span>
                <span className="tag outline">{pinnedProjects[0].genre}</span>
              </div>
              <p className="synopsis">{pinnedProjects[0].synopsis}</p>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                <button className="btn hero-btn-play" onClick={() => alert(`Opening preview for ${pinnedProjects[0].title}`)}>
                  <Play size={20} fill="currentColor" /> Play Previews
                </button>
                <button className="btn hero-btn-more" onClick={() => navigate('/portfolio')}>More Info</button>
              </div>
            </div>
            {pinnedProjects[0].poster_url || pinnedProjects[0].thumbnail_url ? (
               <div className="hero-bg" style={{ backgroundImage: `url(${pinnedProjects[0].poster_url || pinnedProjects[0].thumbnail_url})` }}></div>
            ) : (
               <div className="hero-bg-default"></div>
            )}
           
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
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="font-display" style={{ fontSize: '1.8rem' }}>Recommended Projects</h2>
          <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }} onClick={() => navigate('/community')}>
            Explore All <ChevronRight size={16} />
          </span>
        </div>
        
        {recommendedProjects.length > 0 ? (
          <div className="movie-row">
            {recommendedProjects.map((proj) => (
              <div key={proj.id} className="movie-card" onClick={() => {
                const win = window.confirm(`Open Project Detail for "${proj.title}"?`);
                if (win) console.log('User wants to view project', proj.id);
              }}>
                <div className="movie-poster">
                  {proj.awards_count > 0 && <div className="award-badge"><Award size={14} /></div>}
                  {proj.thumbnail_url || proj.poster_url ? (
                    <img src={proj.thumbnail_url || proj.poster_url} alt={proj.title} />
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
        .dropdown-container:hover .dropdown-menu {
          display: flex;
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
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
        .dropdown-menu {
          display: none;
          opacity: 0;
          visibility: hidden;
          position: absolute;
          top: 100%;
          left: 0;
          margin-top: 4px;
          flex-direction: column;
          min-width: 220px;
          padding: 0.5rem;
          z-index: 50;
          transition: all 0.3s ease;
          transform: translateY(10px);
        }
        /* Add an invisible bridge to prevent losing hover between button and menu */
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
          border-radius: 6px;
          transition: background 0.2s;
        }
        .dropdown-item:hover {
          background: rgba(255,255,255,0.1);
          color: white;
        }

        /* Netflix Style Hero */
        .netflix-hero {
          position: relative;
          height: 60vh;
          min-height: 400px;
          border-radius: 20px;
          overflow: hidden;
          background: #000;
          border: 1px solid var(--glass-border);
          width: 100%;
        }
        .hero-bg, .hero-bg-default {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-size: cover;
          background-position: center;
          opacity: 0.6;
          z-index: 1;
        }
        .hero-bg-default {
          background: linear-gradient(135deg, #1f1f2e 0%, #0f0f16 100%);
        }
        .hero-content {
          position: relative;
          z-index: 2;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 4rem;
          background: linear-gradient(to top, var(--bg-primary) 0%, transparent 100%),
                      linear-gradient(to right, rgba(10,10,12,0.8) 0%, transparent 80%);
        }
        .hero-content h1 {
          font-size: clamp(1.8rem, 4vw, 3.5rem);
          font-weight: 800;
          margin-bottom: 1rem;
          max-width: 800px;
          line-height: 1.1;
        }
        @media (max-width: 768px) {
          .netflix-hero {
            height: 50vh;
            min-height: 300px;
            border-radius: 12px;
          }
          .hero-content {
            padding: 2rem 1.5rem;
          }
        }
        @media (max-width: 480px) {
          .netflix-hero {
            height: 45vh;
            min-height: 260px;
          }
          .hero-content {
            padding: 1.5rem 1rem;
          }
        }
        .meta-tags {
          display: flex;
          gap: 1rem;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        .tag {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .tag.match { color: var(--success); }
        .tag.outline {
          border: 1px solid rgba(255,255,255,0.4);
          padding: 0.2rem 0.6rem;
          border-radius: 4px;
        }
        .synopsis {
          max-width: 600px;
          font-size: 1.1rem;
          color: rgba(255,255,255,0.8);
          line-height: 1.6;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .hero-btn-play {
          background: white;
          color: black;
          font-weight: 700;
          padding: 0.8rem 2rem;
        }
        .hero-btn-play:hover {
          background: rgba(255,255,255,0.8);
        }
        .hero-btn-more {
          background: rgba(109, 109, 110, 0.7);
          color: white;
          font-weight: 700;
        }
        .hero-btn-more:hover {
          background: rgba(109, 109, 110, 0.4);
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
      `}</style>
    </div>
  );
}
