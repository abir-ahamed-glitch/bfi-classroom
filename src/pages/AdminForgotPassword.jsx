import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import './Login.css';

export default function AdminForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState({ type: '', message: '', isStudent: false });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: '', message: '', isStudent: false });
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/admin-forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || 'Something went wrong');
        if (data.role === 'student') error.isStudent = true;
        throw error;
      }

      setStatus({ type: 'success', message: data.message });
      setEmail('');
    } catch (err) {
      setStatus({ type: 'error', message: err.message, isStudent: err.isStudent });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container admin-theme">
      <div className="login-bg-elements">
        <div className="glow-orb orb-1" style={{ background: 'radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, rgba(185, 28, 28, 0) 70%)' }}></div>
        <div className="glow-orb orb-2" style={{ background: 'radial-gradient(circle, rgba(220, 38, 38, 0.4) 0%, rgba(153, 27, 27, 0) 70%)' }}></div>
        <div className="film-strip-bg"></div>
      </div>

      <div className="login-content">
        <div className="login-brand font-display">
          <div className="logo-box" style={{ 
            background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 50%, #7f1d1d 100%)', 
            padding: '1.2rem', 
            borderRadius: '24px', 
            marginBottom: '1.5rem', 
            boxShadow: '0 15px 35px -10px rgba(239, 68, 68, 0.6)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <img src={`${import.meta.env.BASE_URL}bfi-logo.jpg`} alt="BFI Logo" style={{ 
              height: '50px', 
              width: 'auto', 
              mixBlendMode: 'multiply',
              display: 'block'
            }} />
          </div>
          <h1>Admin <span>Recovery</span></h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form glass-panel">
          <h2 className="font-display">Admin Forgot Password?</h2>
          <p className="subtitle">Enter your registered admin email address and we'll send you a link to reset your password.</p>
          
          {status.message && (
            <div className={`alert ${status.type === 'error' ? 'error-alert' : 'success-alert'}`} style={{
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              background: status.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              border: `1px solid ${status.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
              color: status.type === 'error' ? '#fca5a5' : '#6ee7b7'
            }}>
              <div>{status.message}</div>
              {status.isStudent && (
                <div style={{ marginTop: '0.5rem' }}>
                  <Link to="/forgot-password" style={{ color: '#fff', textDecoration: 'underline', fontWeight: 'bold' }}>
                    Go to Student Password Recovery
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="input-group">
            <label htmlFor="email">Admin Email</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input 
                id="email"
                type="email" 
                className="input-glass" 
                placeholder="admin@bfi.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="btn w-full login-btn"
            disabled={isLoading || status.type === 'success'}
            style={{ marginTop: '1rem', background: 'var(--danger)', color: 'white', border: 'none', fontWeight: 'bold' }}
          >
            {isLoading ? <Loader2 size={18} className="spin" /> : 'Send Admin Reset Link'}
            {!isLoading && <ArrowRight size={18} />}
          </button>
          
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link to="/admin/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'var(--text-muted)' }} onMouseEnter={(e) => e.target.style.color = 'var(--danger)'} onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}>
              <ArrowLeft size={16} /> Back to Admin Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
