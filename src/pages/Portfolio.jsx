import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Video, Image as ImageIcon, Award, Trash2, X, Play, Download, Settings, ChevronRight } from 'lucide-react';
import jsPDF from 'jspdf';

export default function Portfolio() {
  const { currentUser } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // New Project State
  const initialForm = {
    title: '',
    duration: '',
    genre: '',
    synopsis: '',
    media_link: '',
    media_source: 'youtube', // youtube, vimeo, facebook
    poster_url: '',
    privacy_setting: 'public',
    show_on_dashboard: true,
    show_on_community: true,
  };
  const [formData, setFormData] = useState(initialForm);
  
  // Complex state arrays
  const [credits, setCredits] = useState([]);
  const [awards, setAwards] = useState([]);
  
  // Staging state for inputs
  const [creditRole, setCreditRole] = useState('Director');
  const [creditName, setCreditName] = useState('');
  const [awardData, setAwardData] = useState({ awardName: '', festivalName: '', awardYear: '' });

  const roleOptions = [
    'Director', 'Producer', 'Actor', 'Actress', 'Cinematographer', 
    'Script Writer', 'Screenplay Writer', 'Story', 'Researcher', 
    'Editor', 'Sound Designer', 'Art Director', 'Crew'
  ];

  useEffect(() => {
    fetchPortfolio();
  }, []);

  const fetchPortfolio = async () => {
    try {
      const res = await fetch('/api/portfolio', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        setProjects(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addCredit = () => {
    if (creditName.trim()) {
      setCredits([...credits, { role: creditRole, name: creditName.trim() }]);
      setCreditName('');
    }
  };

  const removeCredit = (index) => setCredits(credits.filter((_, i) => i !== index));

  const addAward = () => {
    if (awardData.awardName.trim()) {
      setAwards([...awards, { ...awardData }]);
      setAwardData({ awardName: '', festivalName: '', awardYear: '' });
    }
  };
  
  const removeAward = (index) => setAwards(awards.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData, credits, awards };
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setShowAddModal(false);
        setFormData(initialForm);
        setCredits([]);
        setAwards([]);
        fetchPortfolio();
      }
    } catch (err) {
      console.error(err);
      alert('Failed to add project');
    }
  };

  const deleteProject = async (id) => {
    if(!window.confirm('Are you sure you want to delete this project?')) return;
    try {
      await fetch(`/api/portfolio/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      fetchPortfolio();
    } catch (err) {
      console.error(err);
    }
  };

  const downloadAsset = (proj, format) => {
    if (format === 'pdf') {
      try {
        const doc = new jsPDF();
        doc.setFillColor(15, 23, 42); 
        doc.rect(0, 0, 210, 297, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.text(proj.title, 20, 30);
        
        doc.setFontSize(12);
        doc.setTextColor(150, 150, 150);
        doc.text(`${proj.genre} | ${proj.duration}`, 20, 40);
        
        doc.setTextColor(200, 200, 200);
        const splitSynopsis = doc.splitTextToSize(proj.synopsis || 'No synopsis provided.', 170);
        doc.text(splitSynopsis, 20, 55);
        
        doc.setFontSize(14);
        doc.setTextColor(52, 211, 153);
        doc.text('CREDITS', 20, 90);
        
        let y = 100;
        proj.credits?.forEach(c => {
          doc.setFontSize(11);
          doc.setTextColor(200, 200, 200);
          doc.text(`${c.role}: ${c.name}`, 20, y);
          y += 10;
        });

        if (proj.awards?.length > 0) {
          y += 10;
          doc.setFontSize(14);
          doc.setTextColor(245, 158, 11);
          doc.text('AWARDS', 20, y);
          y += 10;
          proj.awards.forEach(a => {
            doc.setFontSize(11);
            doc.setTextColor(200, 200, 200);
            doc.text(`- ${a.awardName} (${a.awardYear}) @ ${a.festivalName}`, 20, y);
            y += 10;
          });
        }
        
        doc.save(`${proj.title.replace(/\s+/g, '_')}_Portfolio.pdf`);
      } catch (e) {
        console.error('PDF Generation Failed', e);
        alert('Failed to generate PDF.');
      }
    } else {
      alert(`Downloading format: ${format}`);
    }
  };

  // Extract embedded IDs for preview natively
  const getEmbedUrl = (url, source) => {
    if (!url) return '';
    try {
      if (source === 'youtube') {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
        return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=0&controls=1` : url;
      }
      if (source === 'vimeo') {
        const match = url.match(/vimeo\.com\/(?:[a-z]*\/)*([0-9]{6,11})[?]?.*/);
        return match ? `https://player.vimeo.com/video/${match[1]}` : url;
      }
      if (source === 'facebook') {
        // Fallback for FB videos to plugins iframe
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560`;
      }
    } catch(e) { /* ignore */ }
    return url;
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Studio...</h2></div>;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>Student Portfolio</h1>
          <p className="subtitle">Manage and showcase your filmography, awards, and credentials.</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn btn-primary" style={{ padding: '0.8rem 1.5rem', borderRadius: '50px' }}>
          <Plus size={20} /> Add New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Video size={64} style={{ margin: '0 auto 1.5rem auto', opacity: 0.3 }} />
          <h2 className="font-display" style={{ fontSize: '1.8rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Your Studio is Empty</h2>
          <p style={{ marginBottom: '2rem' }}>Upload your latest short films, documentaries, and projects here.</p>
          <button onClick={() => setShowAddModal(true)} className="btn btn-glass">Start Building Portfolio</button>
        </div>
      ) : (
        <div className="portfolio-grid">
          {projects.map(proj => (
            <div key={proj.id} className="portfolio-card glass-panel">
              <div className="card-media">
                {proj.awards?.length > 0 && <div className="achievement-badge"><Award size={16} /></div>}
                
                {proj.media_link ? (
                  <div className="video-wrapper">
                    <iframe 
                      src={getEmbedUrl(proj.media_link, proj.media_source)} 
                      frameBorder="0" 
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                      allowFullScreen
                      title={proj.title}
                    ></iframe>
                  </div>
                ) : (
                  <div className="media-placeholder" style={{ backgroundImage: `url(${proj.poster_url})` }}>
                    {!proj.poster_url && <ImageIcon size={48} opacity={0.3} />}
                  </div>
                )}
                
                <div className="media-overlay">
                  <div className="overlay-actions">
                    <button className="icon-btn tooltip-target" onClick={() => downloadAsset(proj, 'pdf')}><Download size={18} /><span>Download PDF</span></button>
                    <button className="icon-btn tooltip-target" onClick={() => deleteProject(proj.id)} style={{ color: 'var(--danger)' }}><Trash2 size={18} /><span>Delete</span></button>
                  </div>
                </div>
              </div>

              <div className="card-details">
                <div className="title-row">
                  <h3 className="font-display">{proj.title}</h3>
                  <span className="duration">{proj.duration}</span>
                </div>
                
                <p className="synopsis">{proj.synopsis}</p>
                
                <div className="metadata">
                  {proj.credits?.slice(0, 3).map((c, i) => (
                    <span key={i} className="credit-pill"><strong>{c.role}:</strong> {c.name}</span>
                  ))}
                  {proj.credits?.length > 3 && <span className="credit-pill">+{proj.credits.length - 3} more</span>}
                </div>

                {proj.awards?.length > 0 && (
                  <div className="card-awards">
                    <Award size={14} className="text-warning" /> 
                    <span>{proj.awards.length} Award{proj.awards.length > 1 ? 's' : ''} Won</span>
                  </div>
                )}

                <div className="card-footer">
                  <div className="visibility-tags">
                    {proj.show_on_dashboard === 1 && <span className="v-tag dash">Dashboard ✔</span>}
                    {proj.show_on_community === 1 && <span className="v-tag comm">Community ✔</span>}
                  </div>
                  <span className="privacy">{proj.privacy_setting}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h2 className="font-display">Add Portfolio Project</h2>
              <button onClick={() => setShowAddModal(false)} className="close-btn"><X size={24} /></button>
            </div>
            
            <div className="modal-body custom-scrollbar">
              <form id="projectForm" onSubmit={handleSubmit}>
                
                <section className="form-section">
                  <h4 className="section-title">Basic Information</h4>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Project Title *</label>
                      <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="input-glass" required />
                    </div>
                    <div className="grid-2">
                      <div className="input-group">
                        <label>Duration / Length</label>
                        <input type="text" value={formData.duration} onChange={e => setFormData({...formData, duration: e.target.value})} className="input-glass" placeholder="e.g. 15 min" />
                      </div>
                      <div className="input-group">
                        <label>Genre</label>
                        <input type="text" value={formData.genre} onChange={e => setFormData({...formData, genre: e.target.value})} className="input-glass" placeholder="Documentary, Drama..." />
                      </div>
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Short Synopsis</label>
                    <textarea value={formData.synopsis} onChange={e => setFormData({...formData, synopsis: e.target.value})} className="input-glass" rows={3}></textarea>
                  </div>
                </section>

                <section className="form-section">
                  <h4 className="section-title">Media & Links</h4>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Media Player Source</label>
                      <select value={formData.media_source} onChange={e => setFormData({...formData, media_source: e.target.value})} className="input-glass" style={{ appearance: 'none' }}>
                        <option value="youtube">YouTube</option>
                        <option value="vimeo">Vimeo</option>
                        <option value="facebook">Facebook Video</option>
                        <option value="other">Other Link</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Video URL / Link *</label>
                      <input type="url" value={formData.media_link} onChange={e => setFormData({...formData, media_link: e.target.value})} className="input-glass" placeholder="https://youtube.com/..." required />
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Poster Image URL (Optional Thumbnail)</label>
                    <input type="url" value={formData.poster_url} onChange={e => setFormData({...formData, poster_url: e.target.value})} className="input-glass" placeholder="Leave empty to auto-fetch from video if possible" />
                  </div>
                </section>

                <section className="form-section">
                  <h4 className="section-title">Cast & Crew Credits</h4>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <select value={creditRole} onChange={e => setCreditRole(e.target.value)} className="input-glass" style={{ flex: 1, appearance: 'none' }}>
                      {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input type="text" value={creditName} onChange={e => setCreditName(e.target.value)} className="input-glass" placeholder="Name" style={{ flex: 2 }} />
                    <button type="button" onClick={addCredit} className="btn btn-glass">Add</button>
                  </div>
                  <div className="tag-cloud">
                    {credits.map((c, i) => (
                      <div key={i} className="credit-tag">
                        <strong>{c.role}:</strong> {c.name}
                        <X size={14} className="remove-icon" onClick={() => removeCredit(i)} />
                      </div>
                    ))}
                    {credits.length === 0 && <span className="text-muted text-sm">No credits added yet.</span>}
                  </div>
                </section>

                <section className="form-section">
                  <h4 className="section-title"><Award size={16} style={{ display: 'inline', verticalAlign: 'middle' }}/> Awards (Optional)</h4>
                  <div className="grid-3" style={{ marginBottom: '1rem', alignItems: 'end' }}>
                    <div className="input-group">
                      <label>Award Name/Category</label>
                      <input type="text" value={awardData.awardName} onChange={e => setAwardData({...awardData, awardName: e.target.value})} className="input-glass" placeholder="Best Director" />
                    </div>
                    <div className="input-group">
                      <label>Festival Name</label>
                      <input type="text" value={awardData.festivalName} onChange={e => setAwardData({...awardData, festivalName: e.target.value})} className="input-glass" placeholder="Dhaka Int. Film Fest" />
                    </div>
                    <div className="input-group" style={{ display: 'flex', gap: '0.5rem' }}>
                      <div style={{ flex: 1 }}>
                        <label>Year</label>
                        <input type="text" value={awardData.awardYear} onChange={e => setAwardData({...awardData, awardYear: e.target.value})} className="input-glass" placeholder="2024" />
                      </div>
                      <button type="button" onClick={addAward} className="btn btn-glass" style={{ alignSelf: 'flex-end', height: '42px' }}>Add</button>
                    </div>
                  </div>
                  <div className="tag-cloud">
                    {awards.map((a, i) => (
                      <div key={i} className="award-tag">
                        <Award size={14} /> {a.awardName} ({a.awardYear})
                        <X size={14} className="remove-icon" onClick={() => removeAward(i)} />
                      </div>
                    ))}
                  </div>
                </section>

                <section className="form-section">
                  <h4 className="section-title">Visibility & Distribution</h4>
                  <div className="grid-2 toggle-grid">
                    <label className="toggle-label">
                      <span>Show on my Dashboard</span>
                      <input type="checkbox" checked={formData.show_on_dashboard} onChange={e => setFormData({...formData, show_on_dashboard: e.target.checked})} />
                    </label>
                    <label className="toggle-label">
                      <span>Publish to Institute Community</span>
                      <input type="checkbox" checked={formData.show_on_community} onChange={e => setFormData({...formData, show_on_community: e.target.checked})} />
                    </label>
                  </div>
                  <div className="input-group" style={{ marginTop: '1.5rem' }}>
                    <label>External Privacy Access</label>
                    <select value={formData.privacy_setting} onChange={e => setFormData({...formData, privacy_setting: e.target.value})} className="input-glass" style={{ appearance: 'none', width: '250px' }}>
                      <option value="public">Public (Anyone can view)</option>
                      <option value="unlisted">Unlisted (Link only)</option>
                      <option value="private">Private (Only me & Admins)</option>
                    </select>
                  </div>
                </section>

              </form>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowAddModal(false)} className="btn btn-glass">Cancel</button>
              <button form="projectForm" type="submit" className="btn btn-primary">Publish Project</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .portfolio-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 2rem;
        }
        .portfolio-card {
          border-radius: 16px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--glass-border);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .portfolio-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 15px 35px rgba(0,0,0,0.4);
        }
        .card-media {
          position: relative;
          aspect-ratio: 16/9;
          background: #000;
          overflow: hidden;
        }
        .achievement-badge {
          position: absolute;
          top: 1rem;
          left: 1rem;
          background: linear-gradient(135deg, var(--warning) 0%, #d97706 100%);
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        }
        .video-wrapper, .video-wrapper iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
        .media-placeholder {
          width: 100%;
          height: 100%;
          background-size: cover;
          background-position: center;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .media-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 50%);
          opacity: 0;
          transition: opacity 0.3s ease;
          display: flex;
          align-items: flex-end;
          justify-content: flex-end;
          padding: 1rem;
          z-index: 5;
          pointer-events: none; /* Let iframe swallow clicks unless hovering actions */
        }
        .portfolio-card:hover .media-overlay {
          opacity: 1;
        }
        .overlay-actions {
          pointer-events: auto;
          display: flex;
          gap: 0.5rem;
        }
        .icon-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(4px);
          border: 1px solid rgba(255,255,255,0.2);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.3); }
        
        /* Tooltip hack */
        .tooltip-target { position: relative; }
        .tooltip-target span {
          position: absolute; bottom: 120%; right: 0;
          background: var(--bg-primary); padding: 0.4rem 0.8rem;
          border-radius: 4px; border: 1px solid var(--glass-border);
          font-size: 0.75rem; white-space: nowrap;
          pointer-events: none; opacity: 0; transition: opacity 0.2s;
        }
        .tooltip-target:hover span { opacity: 1; }

        .card-details { padding: 1.5rem; display: flex; flex-direction: column; flex: 1; }
        .title-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; }
        .title-row h3 { font-size: 1.3rem; margin: 0; line-height: 1.2; }
        .duration { font-size: 0.8rem; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--glass-border); }
        .synopsis { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        
        .metadata { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
        .credit-pill { font-size: 0.8rem; padding: 0.2rem 0.6rem; background: rgba(255,255,255,0.05); border-radius: 12px; color: var(--text-secondary); }
        .credit-pill strong { color: var(--text-primary); }
        
        .card-awards { display: flex; alignItems: center; gap: 0.5rem; font-size: 0.85rem; color: var(--warning); margin-bottom: 1.5rem; }
        
        .card-footer { margin-top: auto; border-top: 1px solid var(--glass-border); padding-top: 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--text-muted); }
        .visibility-tags { display: flex; gap: 0.5rem; }
        .v-tag { padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 500; }
        .v-tag.dash { background: rgba(16, 185, 129, 0.1); color: #34d399; }
        .v-tag.comm { background: rgba(59, 130, 246, 0.1); color: #60a5fa; }
        .privacy { text-transform: capitalize; }

        /* Modal Styles */
        .modal-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100vh;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(5px);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 2rem;
        }
        .modal-content {
          width: 100%; max-width: 800px; max-height: 90vh;
          display: flex; flex-direction: column;
          background: var(--bg-secondary);
        }
        .modal-header {
          padding: 1.5rem 2rem; border-bottom: 1px solid var(--glass-border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .close-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; }
        .close-btn:hover { color: white; }
        .modal-body { padding: 2rem; overflow-y: auto; flex: 1; }
        .modal-footer {
          padding: 1.5rem 2rem; border-top: 1px solid var(--glass-border);
          display: flex; justify-content: flex-end; gap: 1rem; background: rgba(0,0,0,0.2);
        }
        .form-section { margin-bottom: 2.5rem; }
        .section-title { font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 1rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.5rem; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .grid-3 { display: grid; grid-template-columns: 2fr 2fr 1fr; gap: 1rem; }
        .text-sm { font-size: 0.85rem; }
        
        .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .credit-tag, .award-tag {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05);
          border: 1px solid var(--glass-border); border-radius: 20px; font-size: 0.85rem;
        }
        .award-tag { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #fcd34d; }
        .remove-icon { cursor: pointer; opacity: 0.6; transition: opacity 0.2s; }
        .remove-icon:hover { opacity: 1; color: var(--danger); }
        
        .toggle-grid { align-items: center; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; border: 1px solid var(--glass-border); }
        .toggle-label { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
      `}</style>
    </div>
  );
}
