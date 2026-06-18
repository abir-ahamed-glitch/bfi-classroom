import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Film, User, Lock, ArrowRight, Loader2, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Login.css'; // Add a specific CSS file for Login

export default function Login() {
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
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to login. Please check your credentials.');
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
          <h1>BFI <span>Classroom</span></h1>
          <p>Bangladesh Film Institute's Digital Hub</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form glass-panel">
          <h2 className="font-display">Welcome Back</h2>
          <p className="subtitle">Sign in to continue your filmmaking journey.</p>
          
          {error && <div className="error-alert">{error}</div>}

          <div className="input-group">
            <label htmlFor="username">Username or Email</label>
            <div className="input-wrapper">
              <User size={18} className="input-icon" />
              <input 
                id="username"
                type="text" 
                className="input-glass" 
                placeholder="Enter your username"
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
                placeholder="Enter your password"
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

          <div className="form-actions">
            <Link to="/forgot-password" className="forgot-password text-gradient">Forgot password?</Link>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary w-full login-btn"
            disabled={isLoading}
          >
            {isLoading ? <Loader2 size={18} className="spin" /> : 'Access Classroom'}
            {!isLoading && <ArrowRight size={18} />}
          </button>

          {/* Institute Authority Area — subtle secondary button */}
          <div style={{
            marginTop: '1.25rem',
            paddingTop: '1.1rem',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <Link
              to="/admin/login"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                textDecoration: 'none',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                padding: '0.5rem 1.2rem',
                width: '100%',
                transition: 'background 0.2s, border-color 0.2s, transform 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.09)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <ShieldAlert size={13} style={{ color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} />
              <span style={{
                fontSize: '0.78rem',
                fontWeight: 500,
                letterSpacing: '0.02em',
                background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 60%, var(--accent-tertiary) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                Institute Authority Area
              </span>
            </Link>
          </div>
        </form>

        <div className="login-footer">
          <p>Student registration is handled by the institute.</p>
          <p>Not a student yet? <a href="https://bfibd.org/our-courses/" target="_blank" rel="noopener noreferrer" className="text-gradient">Explore courses</a></p>
        </div>
      </div>

    </div>
  );
}
