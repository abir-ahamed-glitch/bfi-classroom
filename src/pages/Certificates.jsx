import { useState, useEffect } from 'react';
import { ScrollText, Download, CheckCircle, Clock, Lock } from 'lucide-react';
import { downloadCertificatePdf } from '../utils/certificates';
import { useModal } from '../components/BFIModal';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

export default function Certificates() {
  const { currentUser } = useAuth();
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);
  const [error, setError] = useState('');
  const { showAlert } = useModal();

  useEffect(() => {
    fetchCertificates();

    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const token = localStorage.getItem('token');
    const socket = io(socketUrl, { auth: { token }, transports: ['websocket', 'polling'] });

    socket.on('progression_updated', (payload) => {
      if (payload.bulk || String(payload.studentId) === String(currentUser?.id)) {
        fetchCertificates();
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [currentUser]);

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

  const downloadCertificate = async (cert, index) => {
    try {
      setDownloadingId(index);
      await downloadCertificatePdf(cert, cert.template || {});
    } catch (err) {
      console.error('Certificate download failed', err);
      await showAlert('Unable to generate the certificate right now. Please try again.', { title: 'Download Failed' });
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Certificates...</h2></div>;

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '3rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>My Certificates</h1>
        <p className="subtitle">All your earned institutional recognitions from BFI.</p>
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '2rem', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '2rem' }}>
        {certificates.map((cert, index) => {
          if (cert.locked) {
            return (
              <div key={index} className="glass-panel" style={{ padding: '2rem', border: '1px solid rgba(239, 68, 68, 0.25)', position: 'relative', overflow: 'hidden', background: 'rgba(239, 68, 68, 0.02)' }}>
                {/* Background Decoration */}
                <Lock size={120} style={{ position: 'absolute', right: '-20px', bottom: '-20px', opacity: 0.05, color: '#ef4444' }} />
                
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    <Lock size={20} style={{ color: '#ef4444' }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f87171' }}>Certificate Locked</span>
                  </div>
                  
                  <h2 className="font-display" style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>{cert.courseName}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: '1.5' }}>
                    This certificate is locked because of pending, due, or partial payments. Please clear your remaining balance to unlock.
                  </p>
                  
                  <button
                    disabled
                    className="btn"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)', cursor: 'not-allowed', opacity: 0.8 }}
                  >
                    <Lock size={18} /> Download Locked
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={index} className="glass-panel" style={{ padding: '2rem', border: '1px solid var(--accent-primary)', position: 'relative', overflow: 'hidden' }}>
              {/* Background Decoration */}
              <ScrollText size={120} style={{ position: 'absolute', right: '-20px', bottom: '-20px', opacity: 0.1, color: 'var(--accent-primary)' }} />
              
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
                
                <button
                  onClick={() => downloadCertificate(cert, index)}
                  className="btn btn-primary"
                  disabled={downloadingId === index}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Download size={18} /> {downloadingId === index ? 'Generating PDF...' : 'Official PDF Certificate'}
                </button>
              </div>
            </div>
          );
        })}
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
          <ScrollText size={20} className="text-secondary" /> About BFI Certification
        </h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          BFI certificates are formal recognitions of your dedication and skill in filmmaking. These are digital-first, blockchain-verifiable records that you can share with employers, film festivals, and on your social profiles.
        </p>
      </div>
    </div>
  );
}
