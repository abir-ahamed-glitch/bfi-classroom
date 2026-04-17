import { useState, useEffect } from 'react';
import { Search, User, Mail, GraduationCap } from 'lucide-react';

export default function Directory() {
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDirectory();
  }, []);

  const fetchDirectory = async () => {
    try {
      const res = await fetch('/api/student/directory', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students);
      }
    } catch (err) {
      console.error('Failed to fetch directory', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = students.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.full_name && s.full_name.toLowerCase().includes(q)) ||
      (s.batch_number && s.batch_number.toLowerCase().includes(q))
    );
  });

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Directory...</h2></div>;

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Alumni Directory</h1>
        <p className="subtitle">Connect with your peers and past alumni from BFI.</p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <div className="input-wrapper" style={{ width: '100%', maxWidth: '500px' }}>
          <Search className="input-icon" size={18} />
          <input 
            type="text" 
            placeholder="Search by name or batch..." 
            className="input-glass" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {filteredStudents.map(student => (
          <div key={student.id} className="glass-panel card-hover" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--bg-gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem', color: 'white' }}>
              {student.profile_picture ? (
                <img src={student.profile_picture} alt={student.full_name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                student.first_name?.[0] || 'U'
              )}
            </div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.2rem' }}>{student.full_name}</h3>
            
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><GraduationCap size={14}/> {student.batch_number || 'N/A'} Batch</span>
            </div>
            
            {student.bfiaa_member === 1 && (
              <span className="badge-pill" style={{ marginBottom: '1rem', fontSize: '0.7rem' }}>BFIAA Member</span>
            )}

            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {student.bio || 'New filmmaker exploring the world of cinema.'}
            </p>

            <a href={`mailto:${student.email}`} className="btn btn-glass" style={{ width: '100%', marginTop: 'auto', padding: '0.5rem' }}>
              <Mail size={16} /> Contact
            </a>
          </div>
        ))}
        {filteredStudents.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <User size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <p>No students found matching "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
