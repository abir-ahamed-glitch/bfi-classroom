import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { BookOpen, FileText, Download, PlayCircle, Folder } from 'lucide-react';

export default function CourseMaterials() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');

  useEffect(() => {
    fetchMaterials();
  }, []);

  const fetchMaterials = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/courses', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = data.materials.map(m => ({
          id: m.id,
          title: m.title,
          course: m.course_name,
          type: m.file_type || 'pdf',
          date: new Date(m.created_at).toLocaleDateString(),
          size: m.file_type === 'video' ? 'Video' : '1.2 MB',
          downloadable: m.is_downloadable === 1,
          duration: '15 min'
        }));
        setMaterials(mapped);
      }
    } catch (err) {
      console.error('Failed to fetch materials', err);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type) => {
    const t = type?.toLowerCase();
    if (t === 'pdf') return <FileText size={24} className="text-danger" />;
    if (t === 'doc' || t === 'docx') return <FileText size={24} className="text-primary" />;
    if (t === 'video') return <PlayCircle size={24} className="text-warning" />;
    return <BookOpen size={24} />;
  };

  const filteredMaterials = activeTab === 'All' 
    ? materials 
    : materials.filter(m => m.type.toLowerCase() === activeTab.toLowerCase());

  if (loading) return <div className="page-container container"><h2 className="text-secondary text-center" style={{marginTop: '20vh'}}>Loading Library...</h2></div>;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>Course Materials</h1>
          <p className="subtitle">Access lecture notes, guides, and masterclasses provided by instructors.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-panel" style={{ display: 'inline-flex', padding: '0.4rem', borderRadius: '12px', marginBottom: '2rem', overflowX: 'auto', maxWidth: '100%' }}>
        {['All', 'PDF', 'Doc', 'Video'].map(tab => (
          <button 
            key={tab} 
            onClick={() => setActiveTab(tab)}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="materials-grid">
        {filteredMaterials.map(mat => (
          <div key={mat.id} className="material-card glass-panel">
            <div className="material-icon">
              {getIcon(mat.type)}
            </div>
            <div className="material-info">
              <h3 className="material-title">{mat.title}</h3>
              <p className="material-course"><Folder size={14} style={{display:'inline', marginRight:'4px'}}/> {mat.course}</p>
              <div className="material-meta">
                <span>{mat.date}</span>
                <span>•</span>
                <span>{mat.type === 'video' ? mat.duration : mat.size}</span>
              </div>
            </div>
            <div className="material-action">
              {mat.downloadable ? (
                <button className="btn btn-glass icon-btn" title="Download Material"><Download size={20} /></button>
              ) : (
                <button className="btn btn-primary icon-btn" title="Watch Video"><PlayCircle size={20} /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredMaterials.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          <BookOpen size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <p>No materials found for this category.</p>
        </div>
      )}

      <style>{`
        .tab-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 0.6rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .tab-btn:hover { color: var(--text-primary); }
        .tab-btn.active {
          background: rgba(var(--accent-primary-rgb, 225,29,72), 0.1);
          color: var(--accent-primary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .materials-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1.5rem;
        }
        .material-card {
          display: flex;
          align-items: center;
          padding: 1.5rem;
          border-radius: 12px;
          transition: transform 0.2s, border-color 0.2s;
        }
        .material-card:hover {
          transform: translateY(-3px);
          border-color: var(--glass-border);
        }
        .material-icon {
          width: 50px;
          height: 50px;
          border-radius: 12px;
          background: rgba(128,128,128,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 1.5rem;
          flex-shrink: 0;
        }
        .material-info {
          flex: 1;
          min-width: 0; /* needed for text truncation */
        }
        .material-title {
          font-size: 1.1rem;
          margin: 0 0 0.4rem 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .material-course {
          font-size: 0.85rem;
          color: var(--text-secondary);
          margin: 0 0 0.5rem 0;
        }
        .material-meta {
          display: flex;
          gap: 0.5rem;
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .material-action {
          margin-left: 1rem;
        }
        .icon-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        @media (max-width: 768px) {
          .materials-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
