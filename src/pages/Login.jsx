import TurnstileWidget from '../components/TurnstileWidget';
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Film, User, Lock, ArrowRight, Loader2, Eye, EyeOff, ShieldAlert, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Login.css'; // Add a specific CSS file for Login

export default function Login() {
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setErrorField('');
    setIsLoading(true);

    const token = turnstileToken || window.turnstile?.getResponse() || document.querySelector('input[name="cf-turnstile-response"]')?.value || '';
    if (!token && window.turnstile) {
      setError('Please complete the Cloudflare security verification.');
      setIsLoading(false);
      return;
    }

    try {
      const res = await login(username, password, 'student', token);
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
      setErrorField(err.field || '');
      setTurnstileToken('');
      setTurnstileResetKey((prev) => prev + 1);
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
            padding: '0.6rem', 
            borderRadius: '16px', 
            marginBottom: '0.35rem', 
            boxShadow: '0 8px 20px -6px rgba(37, 99, 235, 0.55)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <img src={`${import.meta.env.BASE_URL}bfi-logo.jpg`} alt="BFI Logo" style={{ 
              height: '32px', 
              width: 'auto', 
              mixBlendMode: 'multiply',
              display: 'block'
            }} />
          </div>
          <h1>BFI <span>Classroom</span></h1>
          <p>Bangladesh Film Institute's Digital Hub</p>
        </div>

        {mfaPending ? (
          <form onSubmit={handleMfaSubmit} className="login-form glass-panel">
            <h2 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
              <KeyRound className="text-primary" size={24} /> Two-Factor Verification
            </h2>
            <p className="subtitle">
              {useRecovery 
                ? 'Enter an emergency backup recovery code to access your account.' 
                : 'Enter the 6-digit verification code from your authenticator app.'}
            </p>

            {mfaError && <div className="error-alert">{mfaError}</div>}

            <div className="input-group">
              <label htmlFor="mfaCode">{useRecovery ? 'Recovery Code' : '6-Digit Security Code'}</label>
              <div className="input-wrapper">
                <input 
                  id="mfaCode"
                  type="text" 
                  className="input-glass font-mono text-center tracking-widest text-lg" 
                  placeholder={useRecovery ? "e.g. A1B2-C3D4" : "000 000"}
                  value={useRecovery ? recoveryCode : totpCode}
                  onChange={(e) => {
                    if (useRecovery) {
                      setRecoveryCode(e.target.value);
                    } else {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setTotpCode(val);
                    }
                  }}
                  autoFocus
                  maxLength={useRecovery ? 30 : 6}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0 1rem' }}>
              <button
                type="button"
                className="text-sm text-gradient font-medium"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setMfaError('');
                }}
              >
                {useRecovery ? '← Use Authenticator App Code' : 'Lost device? Use Recovery Code'}
              </button>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary w-full login-btn"
              disabled={isVerifyingMfa || (useRecovery ? !recoveryCode.trim() : totpCode.length !== 6)}
            >
              {isVerifyingMfa ? <Loader2 size={18} className="spin" /> : 'Verify & Continue'}
              {!isVerifyingMfa && <ArrowRight size={18} />}
            </button>

            <button
              type="button"
              className="btn btn-secondary w-full"
              style={{ marginTop: '0.75rem' }}
              onClick={handleCancelMfa}
            >
              Back to Sign In
            </button>
          </form>
        ) : (
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
                className={`input-glass ${errorField === "username" ? "input-error-field" : ""}`} 
                placeholder="Enter your username or email"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (errorField === "username") setErrorField("");
                }}
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
                className={`input-glass ${errorField === "password" ? "input-error-field" : ""}`} 
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorField === "password") setErrorField("");
                }}
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

          <TurnstileWidget onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} resetKey={turnstileResetKey} />

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
            marginTop: '0.65rem',
            paddingTop: '0.6rem',
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
                gap: '0.4rem',
                textDecoration: 'none',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '0.4rem 0.9rem',
                width: '100%',
                transition: 'background 0.2s, border-color 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.09)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
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
        )}

        <div className="login-footer">
          <p>Student registration is handled by the institute.</p>
          <p>Not a student yet? <a href="https://bfibd.org/our-courses/" target="_blank" rel="noopener noreferrer" className="text-gradient">Explore courses</a></p>
        </div>
      </div>

    </div>
  );
}
