import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import './Login.css'; // Reusing the login styles

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState({ type: '', message: '', isAdmin: false });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: '', message: '', isAdmin: false });
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || 'Something went wrong');
        if (data.role === 'admin') error.isAdmin = true;
        throw error;
      }

      setStatus({ type: 'success', message: data.message });
      setEmail('');
    } catch (err) {
      setStatus({ type: 'error', message: err.message, isAdmin: err.isAdmin });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* Background Video / Elements */}
      <div className="login-bg-elements">
        <div className="glow-orb orb-1"></div>
        <div className="glow-orb orb-2"></div>
        <div className="film-strip-bg"></div>
      </div>

      <div className="login-content">
        <div className="login-brand font-display">
          <div className="logo-box" style={{ 
            background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4f46e5 100%)', 
            padding: '1.2rem', 
            borderRadius: '24px', 
            marginBottom: '1.5rem', 
            boxShadow: '0 15px 35px -10px rgba(37, 99, 235, 0.6)',
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
          <h1>Password <span>Recovery</span></h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form glass-panel">
          <h2 className="font-display">Forgot Password?</h2>
          <p className="subtitle">Enter your registered email address and we'll send you a link to reset your password.</p>
          
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
              {status.isAdmin && (
                <div style={{ marginTop: '0.5rem' }}>
                  <Link to="/admin/forgot-password" style={{ color: '#fff', textDecoration: 'underline', fontWeight: 'bold' }}>
                    Go to Admin Password Recovery
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="input-group">
            <label htmlFor="email">Email Address</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input 
                id="email"
                type="email" 
                className="input-glass" 
                placeholder="student@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary w-full login-btn"
            disabled={isLoading || status.type === 'success'}
            style={{ marginTop: '1rem' }}
          >
            {isLoading ? <Loader2 size={18} className="spin" /> : 'Send Reset Link'}
            {!isLoading && <ArrowRight size={18} />}
          </button>
          
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link to="/login" className="text-gradient" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
              <ArrowLeft size={16} /> Back to Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
