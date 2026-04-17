import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, Loader2, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Login.css';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // Pass 'admin' as the type to the login context
      await login(username, password, 'admin');
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to login. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container" style={{ background: '#0f172a' }}>
      {/* Background Video / Elements */}
      <div className="login-bg-elements">
        <div className="glow-orb orb-1" style={{ background: 'var(--danger)' }}></div>
        <div className="glow-orb orb-2" style={{ background: 'var(--warning)' }}></div>
        <div className="film-strip-bg" style={{ opacity: 0.05 }}></div>
      </div>

      <div className="login-content">
        <div className="login-brand font-display">
          <div className="logo-box" style={{ 
            background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', 
            padding: '1.2rem', 
            borderRadius: '24px', 
            marginBottom: '1.5rem', 
            boxShadow: '0 15px 35px -10px rgba(30, 58, 138, 0.6)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <img src="/bfi-logo.jpg" alt="BFI Logo" style={{ 
              height: '50px', 
              width: 'auto', 
              mixBlendMode: 'multiply',
              display: 'block'
            }} />
          </div>
          <h1 style={{ color: 'var(--danger)' }}>Admin <span>Portal</span></h1>
          <p>Bangladesh Film Institute's Administrative Access</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form glass-panel" style={{ borderTop: '4px solid var(--danger)' }}>
          <h2 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
            <ShieldAlert className="text-danger" size={24} /> Restricted Area
          </h2>
          <p className="subtitle">Sign in to manage student accounts and certifications.</p>
          
          {error && <div className="error-alert" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>{error}</div>}

          <div className="input-group">
            <label htmlFor="username">Admin Username</label>
            <div className="input-wrapper">
              <User size={18} className="input-icon" />
              <input 
                id="username"
                type="text" 
                className="input-glass" 
                placeholder="Enter admin username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <Lock size={18} className="input-icon" />
              <input 
                id="password"
                type={showPassword ? "text" : "password"} 
                className="input-glass" 
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: '3rem' }}
                required
              />
              <button 
                type="button" 
                className="password-toggle-btn" 
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="btn w-full login-btn"
            style={{ background: 'var(--danger)', color: 'white', border: 'none', fontWeight: 'bold' }}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 size={18} className="spin" /> : 'Enter Admin Portal'}
            {!isLoading && <ArrowRight size={18} />}
          </button>
        </form>

        <div className="login-footer">
          <p>Are you a student?</p>
          <p><a href="/login" className="text-gradient">Go to Student Login</a></p>
        </div>
      </div>
    </div>
  );
}
