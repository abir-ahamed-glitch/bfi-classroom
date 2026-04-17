import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Briefcase, Calendar, MapPin, Trash2, X, Edit, Globe, Award, BookOpen, Film } from 'lucide-react';

export default function Experience() {
  const { currentUser } = useAuth();
  const [experiences, setExperiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const initialForm = {
    title: '',
    organization: '',
    experience_type: 'Film',
    start_date: '',
    end_date: '',
    description: ''
  };
  const [formData, setFormData] = useState(initialForm);

  useEffect(() => {
    fetchExperiences();
  }, []);

  const fetchExperiences = async () => {
    try {
      const res = await fetch('/api/experience', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        setExperiences(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/experience', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(formData)
      });
      
      if (res.ok) {
        setShowAddModal(false);
        setFormData(initialForm);
        fetchExperiences();
      }
    } catch (err) {
      console.error(err);
      alert('Failed to add experience');
    }
  };

  const deleteExperience = async (id) => {
    if(!window.confirm('Are you sure you want to delete this experience?')) return;
    try {
      await fetch(`/api/experience/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      fetchExperiences();
    } catch (err) {
      console.error(err);
    }
  };

  const getExperienceIcon = (type) => {
    switch(type) {
      case 'Film': return <Film size={20} />;
      case 'Cultural': return <Globe size={20} />;
      case 'Workshop': return <BookOpen size={20} />;
      case 'Award': return <Award size={20} />;
      default: return <Briefcase size={20} />;
    }
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Experiences...</h2></div>;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>Experience & History</h1>
          <p className="subtitle">Document your professional filmmaking journey and cultural contributions.</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn btn-primary" style={{ padding: '0.8rem 1.5rem', borderRadius: '50px' }}>
          <Plus size={20} /> Add Experience
        </button>
      </div>

      {experiences.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Briefcase size={64} style={{ margin: '0 auto 1.5rem auto', opacity: 0.3 }} />
          <h2 className="font-display" style={{ fontSize: '1.8rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Experiences Listed</h2>
          <p style={{ marginBottom: '2rem' }}>Add your film sets, workshops, and cultural activities to build your professional profile.</p>
          <button onClick={() => setShowAddModal(true)} className="btn btn-glass">Add My First Experience</button>
        </div>
      ) : (
        <div className="experience-timeline">
          {experiences.map(exp => (
            <div key={exp.id} className="experience-card glass-panel">
              <div className="exp-icon-main">
                {getExperienceIcon(exp.experience_type)}
              </div>
              <div className="exp-content">
                <div className="exp-header">
                  <div>
                    <h3 className="exp-title font-display">{exp.title}</h3>
                    <p className="exp-org">{exp.organization}</p>
                  </div>
                  <div className="exp-meta">
                    <span className="exp-type-badge">{exp.experience_type}</span>
                    <button className="delete-exp-btn" onClick={() => deleteExperience(exp.id)} title="Delete Experience">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                
                <div className="exp-dates">
                  <Calendar size={14} />
                  <span>{exp.start_date || 'N/A'} — {exp.end_date || 'Present'}</span>
                </div>

                {exp.description && <p className="exp-desc">{exp.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2 className="font-display">Add Experience</h2>
              <button onClick={() => setShowAddModal(false)} className="close-btn"><X size={24} /></button>
            </div>
            
            <div className="modal-body">
              <form id="expForm" onSubmit={handleSubmit}>
                <div className="input-group">
                  <label>Title / Role *</label>
                  <input 
                    type="text" 
                    value={formData.title} 
                    onChange={e => setFormData({...formData, title: e.target.value})} 
                    className="input-glass" 
                    placeholder="e.g. Lead Director, Production Assistant"
                    required 
                  />
                </div>

                <div className="input-group">
                  <label>Organization / Project Name</label>
                  <input 
                    type="text" 
                    value={formData.organization} 
                    onChange={e => setFormData({...formData, organization: e.target.value})} 
                    className="input-glass" 
                    placeholder="e.g. BFI Film Workshop, Netflix Production"
                  />
                </div>

                <div className="grid-2">
                  <div className="input-group">
                    <label>Experience Type</label>
                    <select 
                      value={formData.experience_type} 
                      onChange={e => setFormData({...formData, experience_type: e.target.value})} 
                      className="input-glass"
                      style={{ appearance: 'none' }}
                    >
                      <option value="Film">Film Production</option>
                      <option value="Cultural">Cultural Activity</option>
                      <option value="Workshop">Workshop / Course</option>
                      <option value="Award">Achievement / Award</option>
                      <option value="Education">Education</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="input-group">
                    <label>Start Date</label>
                    <input 
                      type="text" 
                      value={formData.start_date} 
                      onChange={e => setFormData({...formData, start_date: e.target.value})} 
                      className="input-glass" 
                      placeholder="e.g. Jan 2023"
                    />
                  </div>
                  <div className="input-group">
                    <label>End Date</label>
                    <input 
                      type="text" 
                      value={formData.end_date} 
                      onChange={e => setFormData({...formData, end_date: e.target.value})} 
                      className="input-glass" 
                      placeholder="e.g. Dec 2023 or Present"
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label>Description / Key Contributions</label>
                  <textarea 
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})} 
                    className="input-glass" 
                    rows={4}
                    placeholder="Describe your role and what you achieved..."
                  ></textarea>
                </div>
              </form>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowAddModal(false)} className="btn btn-glass">Cancel</button>
              <button form="expForm" type="submit" className="btn btn-primary">Save Experience</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .experience-timeline {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          max-width: 800px;
          margin: 0 auto;
        }
        .experience-card {
          display: flex;
          gap: 1.5rem;
          padding: 2rem;
          border-radius: 20px;
          border: 1px solid var(--glass-border);
          transition: all 0.3s ease;
        }
        .experience-card:hover {
          transform: translateX(10px);
          background: rgba(255,255,255,0.03);
          border-color: var(--accent-primary);
        }
        .exp-icon-main {
          width: 50px;
          height: 50px;
          background: var(--bg-gradient-primary);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
          box-shadow: 0 8px 20px rgba(0,0,0,0.3);
        }
        .exp-content { flex: 1; }
        .exp-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }
        .exp-title { font-size: 1.4rem; margin: 0; color: var(--text-primary); }
        .exp-org { font-size: 1.1rem; color: var(--accent-primary); font-weight: 500; margin: 0.2rem 0 0 0; }
        
        .exp-meta { display: flex; align-items: center; gap: 1rem; }
        .exp-type-badge {
          font-size: 0.75rem;
          padding: 0.2rem 0.7rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--glass-border);
          border-radius: 20px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        
        .delete-exp-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0.5rem;
          transition: color 0.2s;
        }
        .delete-exp-btn:hover { color: var(--danger); }
        
        .exp-dates {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 1rem;
        }
        .exp-desc {
          font-size: 1rem;
          line-height: 1.6;
          color: var(--text-secondary);
          margin: 0;
        }

        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        
        .modal-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100vh;
          background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 1.5rem;
        }
        .modal-content {
          width: 100%; 
          display: flex; flex-direction: column;
          background: var(--bg-secondary);
          border-radius: 24px;
        }
        .modal-header {
          padding: 1.5rem 2rem; border-bottom: 1px solid var(--glass-border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .close-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; }
        .modal-body { padding: 2rem; }
        .modal-footer {
          padding: 1.5rem 2rem; border-top: 1px solid var(--glass-border);
          display: flex; justify-content: flex-end; gap: 1rem; background: rgba(0,0,0,0.2);
          border-bottom-left-radius: 24px; border-bottom-right-radius: 24px;
        }
      `}</style>
    </div>
  );
}
