import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Save, CheckCircle2, Image as ImageIcon, FileSignature, Layout, Download } from 'lucide-react';

export default function CertificateDesigner() {
  const { currentUser } = useAuth();
  const [template, setTemplate] = useState({
    layout_json: '{}',
    logo_url: '/assets/bfi-logo.png', // Default
    signature_url: '',
    background_url: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    try {
      const res = await fetch('/api/certification/template', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          setTemplate(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch certificate template', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setTemplate({ ...template, [e.target.name]: e.target.value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    
    try {
      const res = await fetch('/api/certification/template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(template)
      });
      
      if (res.ok) {
        setMessage('Certificate layout saved successfully!');
        setTimeout(() => setMessage(''), 5000);
      } else {
        throw new Error('Failed to save template');
      }
    } catch (err) {
      console.error(err);
      setMessage('Error saving template. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Designer...</h2></div>;

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Certificate Designer</h1>
        <p className="subtitle">Design the official certification layout issued to students upon course completion.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Editor sidebar */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layout size={20} className="text-accent" /> Layout Config
          </h3>
          
          {message && (
            <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#34d399', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              <CheckCircle2 size={16} /> {message}
            </div>
          )}

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="input-group">
              <label><ImageIcon size={14} style={{ verticalAlign: 'middle' }}/> Logo URL</label>
              <input type="text" name="logo_url" value={template.logo_url} onChange={handleChange} className="input-glass" placeholder="https://..." />
            </div>
            
            <div className="input-group">
              <label><ImageIcon size={14} style={{ verticalAlign: 'middle' }}/> Background Image URL</label>
              <input type="text" name="background_url" value={template.background_url} onChange={handleChange} className="input-glass" placeholder="https://... (Keep it highly transparent)" />
            </div>

            <div className="input-group">
              <label><FileSignature size={14} style={{ verticalAlign: 'middle' }}/> Authority Signature URL</label>
              <input type="text" name="signature_url" value={template.signature_url} onChange={handleChange} className="input-glass" placeholder="https://..." />
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Note: The student's Name, Batch, and Student ID will strictly follow the institutional records encoded directly into the generated certificate for authenticity.
            </p>

            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save size={18} /> {saving ? 'Saving...' : 'Save Template'}
            </button>
          </form>
        </div>

        {/* Live Preview Panel */}
        <div>
          <h3 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Live Preview</h3>
          <div style={{ 
            width: '100%', 
            aspectRatio: '1.414', // A4 Landscape ratio approximation
            background: template.background_url ? `url(${template.background_url}) center/cover no-repeat, white` : 'white',
            borderRadius: '8px',
            border: '1px solid var(--glass-border)',
            position: 'relative',
            color: 'black',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            textAlign: 'center',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            {template.logo_url && (
              <img src={template.logo_url} alt="Logo" style={{ maxHeight: '80px', marginBottom: '2rem' }} />
            )}
            
            <h1 style={{ fontSize: '2.5rem', fontFamily: 'serif', letterSpacing: '4px', margin: '0 0 1rem 0', color: '#1e293b' }}>CERTIFICATE OF COMPLETION</h1>
            <p style={{ fontSize: '1.2rem', color: '#475569', marginBottom: '2rem' }}>This certifies that</p>
            
            <h2 style={{ fontSize: '3rem', fontFamily: 'Georgia, serif', color: '#0f172a', borderBottom: '2px solid rgba(0,0,0,0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', width: '80%' }}>
              [Student Full Name]
            </h2>
            
            <p style={{ fontSize: '1.2rem', color: '#334155', maxWidth: '80%', lineHeight: '1.6' }}>
              has successfully completed all theoretical and practical phases of the Filmmaking Program. 
              Student ID: <strong>[BFI-0000]</strong> | Batch: <strong>[00th]</strong>
            </p>

            {template.signature_url && (
              <div style={{ position: 'absolute', bottom: '4rem', right: '4rem', textAlign: 'center' }}>
                <img src={template.signature_url} alt="Signature" style={{ maxHeight: '60px', marginBottom: '0.5rem' }} />
                <div style={{ borderTop: '1px solid black', width: '200px' }}></div>
                <p style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>Authorized Signature</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
