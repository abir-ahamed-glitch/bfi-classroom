import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import './Login.css';

export default function AdminResetPassword() {
  const { id, token } = useParams();
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: '', message: '' });
    
    if (password !== confirmPassword) {
      return setStatus({ type: 'error', message: 'Passwords do not match.' });
    }

    if (password.length < 6) {
      return setStatus({ type: 'error', message: 'Password must be at least 6 characters long.' });
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/auth/admin-reset-password/${id}/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      setStatus({ type: 'success', message: data.message });
      
      // Redirect to admin login after 3 seconds
      setTimeout(() => {
        navigate('/admin/login', { replace: true });
      }, 3000);
      
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
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
          <h1>Create Admin <span>Password</span></h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form glass-panel">
          <h2 className="font-display">Reset Admin Password</h2>
          <p className="subtitle">Please enter your new admin password below.</p>
          
          {status.message && (
            <div className={`alert ${status.type === 'error' ? 'error-alert' : 'success-alert'}`} style={{
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              background: status.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              border: `1px solid ${status.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
              color: status.type === 'error' ? '#fca5a5' : '#6ee7b7'
            }}>
              {status.message}
            </div>
          )}

          {status.type !== 'success' && (
            <>
              <div className="input-group">
                <label htmlFor="password">New Password</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input 
                    id="password"
                    type={showPassword ? "text" : "password"} 
                    className="input-glass" 
                    placeholder="Enter new password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ paddingRight: '3rem' }}
                    required
                  />
                  <button 
                    type="button" 
                    className="password-toggle-btn" 
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input 
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"} 
                    className="input-glass" 
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    style={{ paddingRight: '3rem' }}
                    required
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className="btn w-full login-btn"
                disabled={isLoading}
                style={{ marginTop: '1rem', background: 'var(--danger)', color: 'white', border: 'none', fontWeight: 'bold' }}
              >
                {isLoading ? <Loader2 size={18} className="spin" /> : 'Reset Password'}
                {!isLoading && <CheckCircle size={18} />}
              </button>
            </>
          )}

          {status.type === 'success' && (
            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <Link to="/admin/login" className="btn w-full login-btn" style={{ background: 'var(--danger)', color: 'white', border: 'none', fontWeight: 'bold' }}>
                Go to Admin Login
              </Link>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
