import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Search, MapPin, Film, Mail, ExternalLink } from 'lucide-react';

export default function BFIAA() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Mock data for BFIAA (Since we only seeded a few, we'll use robust mocks for visual excellence or fetch if API exists)
  useEffect(() => {
    fetchAlumni();
  }, []);

  const fetchAlumni = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/bfiaa', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Since we want standard profiles, we'll map the backend result
        // If empty, we can show a few curated mock ones for "Visual Excellence" as requested
        if (data.members.length > 0) {
          setMembers(data.members.map(m => ({
            id: m.id,
            name: m.name,
            batch: m.member_since?.split('-')[0] || 'Alumni',
            role: m.position || 'Member',
            profession: 'BFI Alumni',
            image: m.profile_picture || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop'
          })));
        } else {
          // Fallback mocks for high-end preview
          setMembers([
            { id: 1, name: 'Tariq Anam Khan', batch: 'Admin', role: 'President', profession: 'Director & Actor', image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop' },
            { id: 2, name: 'Amitabh Reza Chowdhury', batch: 'Honorary', role: 'Member', profession: 'Filmmaker', image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop' }
          ]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch alumni', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMembers = members.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()) || m.profession.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) return <div className="page-container container"><h2 className="text-secondary text-center" style={{marginTop: '20vh'}}>Loading Alumni Network...</h2></div>;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 className="text-gradient font-display" style={{ fontSize: '3rem', marginBottom: '1rem' }}>BFIAA Network</h1>
        <p className="subtitle" style={{ maxWidth: '600px', margin: '0 auto' }}>
          Bangladesh Film Institute Alumni Association. Connect with industry veterans, find mentors, and explore the legacy of our graduates.
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4rem' }}>
        <div className="search-bar glass-panel" style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 1rem', borderRadius: '50px', width: '100%', maxWidth: '500px' }}>
          <Search size={20} className="text-muted" style={{ marginRight: '1rem' }} />
          <input 
            type="text" 
            placeholder="Search alumni by name or profession..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', width: '100%', outline: 'none', fontSize: '1rem' }}
          />
        </div>
      </div>

      <div className="alumni-grid">
        {filteredMembers.map(member => (
          <div key={member.id} className="alumni-card glass-panel">
            <div className="alumni-image-wrapper">
              <img src={member.image} alt={member.name} className="alumni-image" />
              <div className="batch-badge">{member.batch} Batch</div>
            </div>
            <div className="alumni-info">
              <h3 className="alumni-name font-display">{member.name}</h3>
              <p className="alumni-role text-warning">{member.role}</p>
              <div className="alumni-details">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Film size={14} /> {member.profession}</span>
              </div>
              <div className="alumni-actions">
                <button className="btn btn-glass" style={{ flex: 1, padding: '0.5rem' }}>View Profile</button>
                <button className="btn btn-primary" style={{ flex: 1, padding: '0.5rem' }}><Mail size={16} /> Contact</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredMembers.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
          No alumni found matching your search.
        </div>
      )}

      <style>{`
        .alumni-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 2rem;
        }
        .alumni-card {
          border-radius: 16px;
          overflow: hidden;
          transition: transform 0.3s ease;
          display: flex;
          flex-direction: column;
        }
        .alumni-card:hover {
          transform: translateY(-5px);
          border-color: rgba(255,255,255,0.2);
        }
        .alumni-image-wrapper {
          position: relative;
          width: 100%;
          padding-top: 100%; /* 1:1 Aspect Ratio */
          overflow: hidden;
        }
        .alumni-image {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.5s ease;
        }
        .alumni-card:hover .alumni-image {
          transform: scale(1.05);
        }
        .batch-badge {
          position: absolute;
          bottom: 1rem;
          right: 1rem;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(4px);
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          font-size: 0.8rem;
          font-weight: bold;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .alumni-info {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        .alumni-name {
          font-size: 1.25rem;
          margin: 0 0 0.25rem 0;
        }
        .alumni-role {
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 1rem;
        }
        .alumni-details {
          color: var(--text-secondary);
          font-size: 0.9rem;
          margin-bottom: 1.5rem;
        }
        .alumni-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: auto;
        }
        
        @media (max-width: 768px) {
          .alumni-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
