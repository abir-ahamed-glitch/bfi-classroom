import TurnstileWidget from '../components/TurnstileWidget';
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, ArrowRight, ArrowLeft, Loader2, ShieldAlert, KeyRound, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Login.css';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [errorField, setErrorField] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  // MFA Challenge State
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaToken, setMfaToken] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);

  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();

  // Strip the 'admin@' prefix from display value (it is always locked/prepended)
  const usernameDisplay = username.startsWith('admin@') ? username.slice(6) : username;

  const handleUsernameChange = (e) => {
    // Strip any accidental 'admin@' the user might type; we always prepend it
    const raw = e.target.value.replace(/^admin@/i, '').replace(/\s/g, '');
    setUsername('admin@' + raw);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const token = turnstileToken || window.turnstile?.getResponse() || document.querySelector('input[name="cf-turnstile-response"]')?.value || '';
    if (!token && window.turnstile) {
      setError('Please complete the Cloudflare security verification.');
      setIsLoading(false);
      return;
    }

    try {
      // Pass 'admin' as the type to the login context with turnstileToken
      const res = await login(username, password, 'admin', token);
      if (res && res.requireMfa) {
        setMfaToken(res.mfaToken);
        setMfaPending(true);
        setMfaError('');
        setTotpCode('');
        setRecoveryCode('');
        setUseRecovery(false);
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to login. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setMfaError('');
    setIsVerifyingMfa(true);

    try {
      await verifyMfa(mfaToken, {
        code: useRecovery ? undefined : totpCode.trim(),
        recoveryCode: useRecovery ? recoveryCode.trim() : undefined,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setMfaError(err.message || 'Invalid verification code. Please try again.');
    } finally {
      setIsVerifyingMfa(false);
    }
  };

  const handleCancelMfa = () => {
    setMfaPending(false);
    setMfaToken(null);
    setTotpCode('');
    setRecoveryCode('');
    setUseRecovery(false);
    setMfaError('');
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
            padding: '0.85rem', 
            borderRadius: '20px', 
            marginBottom: '0.75rem', 
            boxShadow: '0 12px 28px -8px rgba(30, 58, 138, 0.55)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <img src={`${import.meta.env.BASE_URL}bfi-logo.jpg`} alt="BFI Logo" style={{ 
              height: '42px', 
              width: 'auto', 
              mixBlendMode: 'multiply',
              display: 'block'
            }} />
          </div>
          <h1 style={{ color: 'var(--danger)' }}>Admin <span>Portal</span></h1>
          <p>Bangladesh Film Institute's Administrative Access</p>
        </div>

        {mfaPending ? (
          <form onSubmit={handleMfaSubmit} className="login-form glass-panel" style={{ borderTop: '4px solid var(--danger)' }}>
            <h2 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
              <KeyRound className="text-danger" size={24} /> Two-Factor Verification
            </h2>
            <p className="subtitle">
              {useRecovery 
                ? 'Enter an emergency backup recovery code to access your administrative account.' 
                : 'Enter the 6-digit verification code from your authenticator app.'}
            </p>

            {mfaError && (
              <div className="error-alert" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                {mfaError}
              </div>
            )}

            {!useRecovery ? (
              <div className="input-group">
                <label htmlFor="totpCode">6-Digit Authenticator Code</label>
                <div className="input-wrapper">
                  <KeyRound size={18} className="input-icon" />
                  <input
                    id="totpCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="input-glass font-mono"
                    placeholder="123456"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{ fontSize: '1.25rem', letterSpacing: '0.25em', textAlign: 'center' }}
                    autoFocus
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="input-group">
                <label htmlFor="recoveryCode">Emergency Recovery Code</label>
                <div className="input-wrapper">
                  <KeyRound size={18} className="input-icon" />
                  <input
                    id="recoveryCode"
                    type="text"
                    className="input-glass font-mono"
                    placeholder="e.g. ABCD-1234"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                    style={{ fontSize: '1.1rem', letterSpacing: '0.1em', textAlign: 'center' }}
                    autoFocus
                    required
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0 1.25rem 0' }}>
              <button
                type="button"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setMfaError('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline'
                }}
              >
                {useRecovery ? 'Use authenticator code instead' : 'Lost your device? Use recovery code'}
              </button>
            </div>

            <button
              type="submit"
              className="btn w-full login-btn"
              style={{ background: 'var(--danger)', color: 'white', border: 'none', fontWeight: 'bold' }}
              disabled={isVerifyingMfa || (!useRecovery && totpCode.length < 6) || (useRecovery && !recoveryCode.trim())}
            >
              {isVerifyingMfa ? <Loader2 size={18} className="spin" /> : 'Verify & Continue'}
              {!isVerifyingMfa && <ArrowRight size={18} />}
            </button>

            <button
              type="button"
              onClick={handleCancelMfa}
              className="btn w-full"
              style={{
                marginTop: '0.75rem',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-muted)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                cursor: 'pointer'
              }}
            >
              <ArrowLeft size={16} /> Back to Sign In
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="login-form glass-panel" style={{ borderTop: '4px solid var(--danger)' }}>
            <h2 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
              <ShieldAlert className="text-danger" size={24} /> Restricted Area
            </h2>
            <p className="subtitle">Sign in to manage student accounts and certifications.</p>
            
            {error && <div className="error-alert" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>{error}</div>}

            <div className="input-group">
              <label htmlFor="username">Admin Username</label>
              <div className="input-wrapper" style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  borderRight: 'none',
                  borderRadius: '10px 0 0 10px',
                  padding: '0 0.75rem',
                  height: '46px',
                  color: '#ef4444',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  userSelect: 'none',
                }}>
                  <User size={15} style={{ opacity: 0.8 }} />
                  admin@
                </span>
                <input
                  id="username"
                  type="text"
                  className="input-glass"
                  placeholder="yourname"
                  value={usernameDisplay}
                  onChange={handleUsernameChange}
                  style={{ borderRadius: '0 10px 10px 0', paddingLeft: '0.85rem', flex: 1 }}
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

            <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', margin: '-0.5rem 0 1.5rem 0' }}>
              <Link to="/admin/forgot-password" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => e.target.style.color = 'var(--danger)'} onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}>Forgot password?</Link>
            </div>

            <TurnstileWidget onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />

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
        )}

        <div className="login-footer">
          <p>Are you a student?</p>
          <p><Link to="/login" className="text-gradient">Go to Student Login</Link></p>
        </div>
      </div>
    </div>
  );
}
