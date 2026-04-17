import { useState, useEffect } from 'react';
import { Award, Download, FileText, CheckCircle, Clock } from 'lucide-react';

export default function Certificates() {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCertificates();
  }, []);

  const fetchCertificates = async () => {
    try {
      const res = await fetch('/api/certification/my-certificates', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCertificates(data.certificates || []);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to fetch certificates');
      }
    } catch (err) {
      console.error(err);
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const downloadCertificate = (cert) => {
    alert(`Downloading Certificate for ${cert.courseName}\nModule Integration in progress...`);
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Certificates...</h2></div>;

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '3rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>My Certificates</h1>
        <p className="subtitle">All your earned institutional recognitions from BFI.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '2rem' }}>
        {certificates.map((cert, index) => (
          <div key={index} className="glass-panel" style={{ padding: '2rem', border: '1px solid var(--accent-primary)', position: 'relative', overflow: 'hidden' }}>
            {/* Background Decoration */}
            <Award size={120} style={{ position: 'absolute', right: '-20px', bottom: '-20px', opacity: 0.1, color: 'var(--accent-primary)' }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <CheckCircle size={20} className="text-accent" />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>Verified Completion</span>
              </div>
              
              <h2 className="font-display" style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{cert.courseName}</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                Awarded to <strong>{cert.studentDetails.fullName}</strong> on {new Date(cert.studentDetails.completionDate).toLocaleDateString()}.
              </p>
              
              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginBottom: '2rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span className="text-muted">Student ID:</span>
                  <span>{cert.studentDetails.studentId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Batch:</span>
                  <span>{cert.studentDetails.batchNumber}</span>
                </div>
              </div>
              
              <button onClick={() => downloadCertificate(cert)} className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <Download size={18} /> Official PDF Certificate
              </button>
            </div>
          </div>
        ))}
      </div>

      {certificates.length === 0 && (
        <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center' }}>
          <Clock size={48} className="text-muted" style={{ marginBottom: '1rem', opacity: 0.5 }} />
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>No Certificates Yet</h2>
          <p className="text-muted">Complete your enrolled courses to unlock your official BFI certificates.</p>
        </div>
      )}

      <div style={{ marginTop: '4rem', padding: '2rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>
          <Award size={20} className="text-secondary" /> About BFI Certification
        </h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          BFI certificates are formal recognitions of your dedication and skill in filmmaking. These are digital-first, blockchain-verifiable records that you can share with employers, film festivals, and on your social profiles.
        </p>
      </div>
    </div>
  );
}
