import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { 
  Shield, Key, User, Save, AlertCircle, Palette, Check, Sun, Moon, Pencil, X, Search,
  ShieldCheck, ShieldAlert, KeyRound, QrCode, Download, Copy, AlertTriangle, CheckCircle2, RefreshCw, Lock
} from 'lucide-react';
import AuthenticatorQRCode from '../components/AuthenticatorQRCode';

// Searchable metadata for each settings section
const SECTIONS_META = [
  { id: 'display-mode',     keywords: 'display mode dark light interface night day appearance' },
  { id: 'colour-theme',    keywords: 'colour theme color accent palette tint style look' },
  { id: 'account-info',    keywords: 'account info username role status badge verified' },
  { id: 'profile-details', keywords: 'profile details name first last recovery email edit' },
  { id: 'change-password', keywords: 'change password security current new confirm update' },
  { id: 'two-factor-auth', keywords: 'two-factor 2fa mfa authenticator otp security code qr backup recovery' },
];

export default function Settings() {
  const { currentUser, updateUser } = useAuth();
  const { themeId, setTheme, themes, mode, toggleMode } = useTheme();
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [nameForm, setNameForm] = useState({
    username: currentUser?.username || '',
    firstName: currentUser?.firstName || '',
    lastName: currentUser?.lastName || '',
    email: currentUser?.email || '',
  });
  const [nameLoading, setNameLoading] = useState(false);
  const [nameMessage, setNameMessage] = useState({ type: '', text: '' });
  const [usernameStatus, setUsernameStatus] = useState({ state: 'idle', message: '' });
  const usernameBlocked = usernameStatus.state === 'taken' || usernameStatus.state === 'error' || usernameStatus.state === 'checking';
  const [searchQuery, setSearchQuery] = useState('');

  // ── Universal 2FA State ──────────────────────────────────────────────────
  const [mfaStatus, setMfaStatus] = useState({
    enabled: false,
    recoveryCodesRemaining: 0,
    loading: true,
  });
  const [mfaModal, setMfaModal] = useState(null); // null | 'setup' | 'replace' | 'disable' | 'recovery_codes'
  const [mfaStep, setMfaStep] = useState(1); // 1: password, 2: scan QR & verify, 3: recovery codes
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaSetupData, setMfaSetupData] = useState({ secret: '', otpauthUri: '' });
  const [mfaVerificationCode, setMfaVerificationCode] = useState('');
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState([]);
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaCopiedCodes, setMfaCopiedCodes] = useState(false);
  const [mfaAcknowledgedCodes, setMfaAcknowledgedCodes] = useState(false);
  const [mfaReplaceMethod, setMfaReplaceMethod] = useState('password'); // 'password' | 'recovery'
  const [mfaRecoveryInput, setMfaRecoveryInput] = useState('');

  const isSuperAdmin = currentUser?.is_super_admin === 1 || currentUser?.isSuperAdmin === true;

  const fetchMfaStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/mfa/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setMfaStatus({
          enabled: !!data.enabled,
          recoveryCodesRemaining: data.recoveryCodesRemaining ?? 0,
          loading: false,
        });
      } else {
        setMfaStatus(prev => ({ ...prev, loading: false }));
      }
    } catch {
      setMfaStatus(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchMfaStatus();
  }, [fetchMfaStatus]);

  const openMfaSetup = () => {
    setMfaModal('setup');
    setMfaStep(1);
    setMfaPassword('');
    setMfaSetupData({ secret: '', otpauthUri: '' });
    setMfaVerificationCode('');
    setMfaRecoveryCodes([]);
    setMfaError('');
    setMfaAcknowledgedCodes(false);
  };

  const openMfaReplace = () => {
    setMfaModal('replace');
    setMfaStep(1);
    setMfaPassword('');
    setMfaRecoveryInput('');
    setMfaReplaceMethod('password');
    setMfaSetupData({ secret: '', otpauthUri: '' });
    setMfaVerificationCode('');
    setMfaRecoveryCodes([]);
    setMfaError('');
    setMfaAcknowledgedCodes(false);
  };

  const openMfaDisable = () => {
    if (isSuperAdmin) return;
    setMfaModal('disable');
    setMfaPassword('');
    setMfaVerificationCode('');
    setMfaError('');
  };

  const closeMfaModal = () => {
    setMfaModal(null);
    setMfaStep(1);
    setMfaPassword('');
    setMfaRecoveryInput('');
    setMfaSetupData({ secret: '', otpauthUri: '' });
    setMfaVerificationCode('');
    setMfaRecoveryCodes([]);
    setMfaError('');
    setMfaAcknowledgedCodes(false);
  };

  const handleMfaSetupStep1 = async (e) => {
    e.preventDefault();
    setMfaError('');
    setMfaLoading(true);

    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ password: mfaPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate 2FA setup');
      }
      setMfaSetupData({ secret: data.secret, otpauthUri: data.otpauthUri });
      setMfaStep(2);
    } catch (err) {
      setMfaError(err.message || 'Verification failed. Please check your password.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaReplaceStep1 = async (e) => {
    e.preventDefault();
    setMfaError('');
    setMfaLoading(true);

    try {
      const res = await fetch('/api/auth/mfa/replace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          password: mfaReplaceMethod === 'password' ? mfaPassword : undefined,
          recoveryCode: mfaReplaceMethod === 'recovery' ? mfaRecoveryInput.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reconfigure 2FA');
      }
      setMfaSetupData({ secret: data.secret, otpauthUri: data.otpauthUri });
      setMfaStep(2);
    } catch (err) {
      setMfaError(err.message || 'Verification failed.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaVerifyStep2 = async (e) => {
    e.preventDefault();
    setMfaError('');
    setMfaLoading(true);

    try {
      const res = await fetch('/api/auth/mfa/verify-setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ code: mfaVerificationCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid authenticator code');
      }
      setMfaRecoveryCodes(data.recoveryCodes || []);
      setMfaStep(3);
      fetchMfaStatus();
    } catch (err) {
      setMfaError(err.message || 'Invalid code. Check your authenticator app and try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaDisableSubmit = async (e) => {
    e.preventDefault();
    setMfaError('');
    setMfaLoading(true);

    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          password: mfaPassword || undefined,
          code: mfaVerificationCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to disable 2FA');
      }
      closeMfaModal();
      fetchMfaStatus();
    } catch (err) {
      setMfaError(err.message || 'Failed to disable 2FA.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleCopyRecoveryCodes = () => {
    if (!mfaRecoveryCodes.length) return;
    const text = mfaRecoveryCodes.join('\n');
    navigator.clipboard.writeText(text);
    setMfaCopiedCodes(true);
    setTimeout(() => setMfaCopiedCodes(false), 2500);
  };

  const handleDownloadRecoveryCodes = () => {
    if (!mfaRecoveryCodes.length) return;
    const content = [
      '=======================================================',
      'BFI CLASSROOM — TWO-FACTOR AUTHENTICATION RECOVERY CODES',
      `Account: ${currentUser?.username || 'user'}`,
      `Generated: ${new Date().toISOString()}`,
      '=======================================================',
      '',
      'INSTRUCTIONS:',
      '- Each backup recovery code can be used ONCE to sign in or reconfigure 2FA.',
      '- Keep these codes secret in a password manager or safe physical location.',
      '',
      ...mfaRecoveryCodes.map((code, idx) => `[${idx + 1}] ${code}`),
      '',
      '=======================================================',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bfi-recovery-codes-${currentUser?.username || 'user'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Derive which section IDs are visible based on the current search query
  const visibleSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null; // null = show all
    return SECTIONS_META
      .filter(({ keywords }) => keywords.includes(q))
      .map(({ id }) => id);
  }, [searchQuery]);

  const show = (id) => !visibleSections || visibleSections.includes(id);

  useEffect(() => {
    const username = nameForm.username.trim();
    const currentUsername = currentUser?.username || '';

    if (!username) {
      setUsernameStatus({ state: 'idle', message: '' });
      return undefined;
    }

    if (username.toLowerCase() === currentUsername.toLowerCase()) {
      setUsernameStatus({ state: 'same', message: 'This is your current username.' });
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setUsernameStatus({ state: 'checking', message: 'Checking username...' });
        const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
          signal: controller.signal,
        });

        const data = await res.json();
        if (res.ok) {
          // Force valid: true for admins if it's not taken
          const isAvailable = data.available || (currentUser?.role === 'admin' && data.message?.includes('3-40 letters'));
          if (isAvailable) {
            setUsernameStatus({ state: 'available', message: 'Username is available.' });
          } else {
            setUsernameStatus({ state: 'taken', message: data.message || 'Username is not available.' });
          }
        } else {
          // If server errors out with validation message, and we are admin, ignore it
          if (currentUser?.role === 'admin' && data.error?.includes('3-40 letters')) {
            setUsernameStatus({ state: 'available', message: 'Username is available.' });
          } else {
            setUsernameStatus({ state: 'error', message: data.error || 'Could not check username.' });
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          setUsernameStatus({ state: 'error', message: 'Could not check username.' });
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameForm.username, currentUser?.username]);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      return setMessage({ type: 'error', text: 'New passwords do not match!' });
    }
    setLoading(true);
    try {
      const res = await fetch('/api/student/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(passwords),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'Password updated successfully!' });
        setPasswords({ current: '', new: '', confirm: '' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update password' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Server error. Please try again later.' });
    } finally {
      setLoading(false);
    }
  };

  const handleNameChange = async (e) => {
    e.preventDefault();
    if (usernameStatus.state === 'taken' || usernameStatus.state === 'error' || usernameStatus.state === 'checking') {
      return;
    }
    setNameLoading(true);
    setNameMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/auth/update-name', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          username: nameForm.username,
          first_name: nameForm.firstName,
          last_name: nameForm.lastName,
          email: nameForm.email,
        }),
      });

      let data = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }

      if (res.ok) {
        updateUser({
          username: data.user?.username,
          email: data.user?.email,
          firstName: data.user?.firstName,
          lastName: data.user?.lastName,
        });
        setNameForm((prev) => ({
          ...prev,
          username: data.user?.username ?? prev.username,
          email: data.user?.email ?? '',
          firstName: data.user?.firstName ?? prev.firstName,
          lastName: data.user?.lastName ?? prev.lastName,
        }));
        setUsernameStatus({ state: 'same', message: 'This is your current username.' });
        setNameMessage({ type: 'success', text: 'Profile updated! Username and name changes are reflected across the platform.' });
      } else {
        setNameMessage({ type: 'error', text: data.error || `Request failed (${res.status})` });
      }
    } catch (err) {
      setNameMessage({ type: 'error', text: `Connection error: ${err.message}` });
    } finally {
      setNameLoading(false);
    }
  };

  const isLight = mode === 'light';

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>Account Settings</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
          Manage your account details, security preferences, and appearance.
        </p>
      </div>

      {/* ── Settings Search ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: '2rem', position: 'relative', maxWidth: '480px' }}>
        <Search
          size={17}
          style={{
            position: 'absolute', left: '0.9rem', top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)', pointerEvents: 'none',
          }}
        />
        <input
          type="search"
          className="input-glass"
          placeholder="Search settings…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ paddingLeft: '2.5rem', width: '100%' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* ── Dark / Light Mode Toggle ──────────────────────────────────────── */}
        {show('display-mode') && <section className="glass-panel" style={{ padding: '2rem' }}>
          <h3 className="font-display" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
            {isLight ? <Sun size={20} style={{ color: 'var(--accent-primary)' }} /> : <Moon size={20} style={{ color: 'var(--accent-primary)' }} />}
            Display Mode
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.75rem' }}>
            Switch between dark and light interface — just like your phone settings.
          </p>

          {/* Mode Toggle Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '480px' }}>
            {[
              {
                m: 'dark', icon: <Moon size={28} />, label: 'Dark Mode',
                desc: 'Easier on the eyes at night.',
                bg: '#0a0a0c', cardBg: '#1c1c21', textCol: '#fff',
              },
              {
                m: 'light', icon: <Sun size={28} />, label: 'Light Mode',
                desc: 'Clean and bright. Great for daytime.',
                bg: '#f5f5f8', cardBg: '#ffffff', textCol: '#09090b',
              },
            ].map(({ m, label, desc, bg, cardBg, textCol }) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  id={`mode-${m}`}
                  onClick={toggleMode}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    border: active ? `2px solid var(--accent-primary)` : `2px solid var(--glass-border)`,
                    borderRadius: '16px', overflow: 'hidden',
                    background: active ? 'transparent' : 'transparent',
                    boxShadow: active ? '0 0 0 4px color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'none',
                    transition: 'all 0.25s ease',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
                >
                  {/* Mini preview window */}
                  <div style={{ background: bg, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff5f57' }} />
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#febc2e' }} />
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#28c840' }} />
                    </div>
                    <div style={{ background: cardBg, borderRadius: '6px', padding: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'var(--accent-primary)', opacity: 0.9, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ height: '5px', borderRadius: '3px', background: textCol, opacity: 0.7, marginBottom: '4px', width: '70%' }} />
                        <div style={{ height: '4px', borderRadius: '3px', background: textCol, opacity: 0.3, width: '50%' }} />
                      </div>
                    </div>
                    <div style={{ height: '4px', borderRadius: '3px', background: textCol, opacity: 0.1, width: '80%' }} />
                    <div style={{ height: '4px', borderRadius: '3px', background: textCol, opacity: 0.06, width: '60%' }} />
                  </div>

                  {/* Label row */}
                  <div style={{ padding: '0.85rem 1rem', background: isLight ? '#f5f5f8' : '#18181f' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: active ? 'var(--accent-primary)' : 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        {label}
                      </span>
                      {active && (
                        <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Check size={10} color="white" strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>}

        {/* ── Theme Colour Switcher ─────────────────────────────────────────── */}
        {show('colour-theme') && <section className="glass-panel" style={{ padding: '2rem' }}>
          <h3 className="font-display" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
            <Palette size={20} style={{ color: 'var(--accent-primary)' }} /> Colour Theme
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.75rem' }}>
            Choose your accent colour. Works in both dark and light mode.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '1rem' }}>
            {themes.map(theme => {
              const isActive = themeId === theme.id;
              return (
                <button
                  key={theme.id}
                  id={`theme-${theme.id}`}
                  onClick={() => setTheme(theme.id)}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: '0.75rem',
                    padding: '1.25rem', borderRadius: '14px',
                    border: isActive ? `2px solid ${theme.accent}` : '2px solid var(--glass-border)',
                    background: isActive ? `color-mix(in srgb, ${theme.accent} 8%, transparent)` : 'rgba(255,255,255,0.02)',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    boxShadow: isActive ? `0 0 20px color-mix(in srgb, ${theme.accent} 20%, transparent)` : 'none',
                  }}
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; } }}
                >
                  {isActive && (
                    <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', width: '20px', height: '20px', borderRadius: '50%', background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                      <Check size={11} color="white" strokeWidth={3} />
                    </div>
                  )}

                  {/* Swatch */}
                  <div style={{ display: 'flex', gap: '5px', height: '36px', borderRadius: '8px', overflow: 'hidden' }}>
                    {theme.preview.map((color, idx) => (
                      <div key={idx} style={{
                        flex: idx === 0 ? 3 : 1, background: color,
                        borderRadius: idx === 0 ? '6px 0 0 6px' : idx === theme.preview.length - 1 ? '0 6px 6px 0' : '0',
                      }} />
                    ))}
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: isActive ? theme.accent : 'var(--text-primary)', marginBottom: '0.2rem', fontFamily: 'var(--font-display)' }}>
                      {theme.name}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {theme.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>}

        {/* ── Account Info + Name Edit + Password ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>

          {/* Account Info */}
          {show('account-info') && <section className="glass-panel" style={{ padding: '2rem' }}>
            <h3 className="font-display" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
              <User size={20} style={{ color: 'var(--accent-primary)' }} /> Account Info
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label>Username</label>
                {currentUser?.role === 'admin' ? (
                  <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <span style={{ 
                      display: 'flex', alignItems: 'center', padding: '0 0.75rem', 
                      background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)',
                      borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--accent-primary)',
                      fontSize: '0.88rem', fontWeight: 700, pointerEvents: 'none'
                    }}>admin@</span>
                    <input
                      type="text"
                      className="input-glass"
                      style={{ borderRadius: '0 8px 8px 0', flex: 1 }}
                      value={nameForm.username.startsWith('admin@') ? nameForm.username.substring(6) : nameForm.username}
                      onChange={e => {
                        const suffix = e.target.value.replace(/^admin@/, '').replace(/\s/g, '');
                        setNameForm({ ...nameForm, username: 'admin@' + suffix });
                      }}
                      placeholder="suffix"
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    className="input-glass"
                    value={nameForm.username}
                    onChange={e => setNameForm({ ...nameForm, username: e.target.value })}
                    placeholder="Choose a unique username"
                  />
                )}
              </div>
              <div className="input-group">
                <label>Account Role</label>
                {currentUser?.role === 'admin' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 1rem', borderRadius: '8px', background: 'linear-gradient(135deg, rgba(225,29,72,0.12), rgba(139,92,246,0.12))', border: '1px solid rgba(225,29,72,0.25)' }}>
                    <Shield size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>
                        {currentUser?.is_super_admin ? 'SUPER ADMIN — Primary Control Panel' : 'ADMIN — Control Panel'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                        {currentUser?.is_super_admin ? 'Super Administrator & Master Control Access' : 'Full platform administrative access'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', fontWeight: 'bold' }}>
                    <Shield size={16} /> {currentUser?.role?.toUpperCase()}
                  </div>
                )}
              </div>
              <div className="input-group">
                <label>Account Status</label>
                <span className="badge-pill">Active &amp; Verified</span>
              </div>
            </div>
          </section>}

          {/* Profile Editor */}
          {show('profile-details') && <section className="glass-panel" style={{ padding: '2rem' }}>
            <h3 className="font-display" style={{ marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
              <Pencil size={20} style={{ color: 'var(--accent-primary)' }} /> Profile Details
            </h3>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              {currentUser?.role === 'admin' 
                ? 'Admins can change their username, but it must start with "admin@". Add your name after the prefix to make it unique.' 
                : 'Change your username and display name. Usernames must stay unique across the whole platform.'}
            </p>
            <form onSubmit={handleNameChange} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label>Username</label>
                <div style={{ position: 'relative' }}>
                  {currentUser?.role === 'admin' ? (
                    <div style={{ display: 'flex', alignItems: 'stretch' }}>
                      <span style={{ 
                        display: 'flex', alignItems: 'center', padding: '0 0.85rem', 
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)',
                        borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--accent-primary)',
                        fontSize: '0.9rem', fontWeight: 700, pointerEvents: 'none'
                      }}>admin@</span>
                      <input 
                        type="text" 
                        className="input-glass" 
                        required 
                        placeholder="e.g. abir" 
                        value={nameForm.username.startsWith('admin@') ? nameForm.username.substring(6) : nameForm.username} 
                        onChange={e => {
                          const suffix = e.target.value.replace(/^admin@/, '').replace(/\s/g, '');
                          setNameForm({ ...nameForm, username: 'admin@' + suffix });
                        }} 
                        style={{ borderLeft: 'none', borderRadius: '0 8px 8px 0', paddingRight: '3rem' }} 
                      />
                    </div>
                  ) : (
                    <input type="text" className="input-glass" required placeholder="e.g. bfi.admin" value={nameForm.username} onChange={e => setNameForm({ ...nameForm, username: e.target.value })} style={{ paddingRight: '3rem' }} />
                  )}
                  {usernameStatus.state === 'available' && (
                    <span style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--success)', display: 'flex', alignItems: 'center', zIndex: 10 }}>
                      <Check size={18} strokeWidth={3} />
                    </span>
                  )}
                  {(usernameStatus.state === 'taken' || usernameStatus.state === 'error') && (
                    <span style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--danger)', display: 'flex', alignItems: 'center', zIndex: 10 }}>
                      <X size={18} strokeWidth={3} />
                    </span>
                  )}
                </div>
                {usernameStatus.state !== 'idle' && (
                  <div style={{
                    marginTop: '0.45rem',
                    fontSize: '0.78rem',
                    color:
                      usernameStatus.state === 'available' || usernameStatus.state === 'same'
                        ? 'var(--success)'
                        : usernameStatus.state === 'checking'
                          ? 'var(--text-muted)'
                          : 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}>
                    {usernameStatus.state === 'available' || usernameStatus.state === 'same' ? <Check size={14} /> : usernameStatus.state === 'checking' ? <AlertCircle size={14} /> : <X size={14} />}
                    {usernameStatus.message}
                  </div>
                )}
              </div>
              <div className="input-group">
                <label>First Name</label>
                <input type="text" className="input-glass" required placeholder="e.g. BFI" value={nameForm.firstName} onChange={e => setNameForm({ ...nameForm, firstName: e.target.value })} />
              </div>
              <div className="input-group">
                <label>Last Name</label>
                <input type="text" className="input-glass" placeholder="e.g. Admin" value={nameForm.lastName} onChange={e => setNameForm({ ...nameForm, lastName: e.target.value })} />
              </div>
              {currentUser?.role === 'admin' && (
                <div className="input-group">
                  <label>Recovery Email</label>
                  <input type="email" className="input-glass" placeholder="e.g. admin@bfibd.org" value={nameForm.email} onChange={e => setNameForm({ ...nameForm, email: e.target.value })} />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>Used for password resets and critical administrative notices.</p>
                </div>
              )}
              {nameMessage.text && (
                <div style={{ padding: '0.75rem', borderRadius: '8px', fontSize: '0.88rem', background: nameMessage.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: nameMessage.type === 'error' ? 'var(--danger)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={15} /> {nameMessage.text}
                </div>
              )}
              <button type="submit" className="btn btn-primary" disabled={nameLoading || usernameBlocked}>
                {nameLoading ? 'Saving...' : usernameBlocked ? 'Fix Username First' : <><Save size={17} /> Save Profile</>}
              </button>
            </form>
          </section>}

          {/* Change Password */}
          {show('change-password') && <section className="glass-panel" style={{ padding: '2rem' }}>
            <h3 className="font-display" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
              <Key size={20} style={{ color: 'var(--accent-primary)' }} /> Change Password
            </h3>
            <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label>Current Password</label>
                <input type="password" className="input-glass" required value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} />
              </div>
              <div className="input-group">
                <label>New Password</label>
                <input type="password" className="input-glass" required value={passwords.new} onChange={e => setPasswords({ ...passwords, new: e.target.value })} />
              </div>
              <div className="input-group">
                <label>Confirm New Password</label>
                <input type="password" className="input-glass" required value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} />
              </div>
              {message.text && (
                <div style={{ padding: '0.75rem', borderRadius: '8px', fontSize: '0.9rem', background: message.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: message.type === 'error' ? 'var(--danger)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={16} /> {message.text}
                </div>
              )}
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Updating...' : <><Save size={18} /> Update Password</>}
              </button>
            </form>
          </section>}

          {/* ── Two-Factor Authentication (2FA) ──────────────────────────────── */}
          {show('two-factor-auth') && <section className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
                <ShieldCheck size={20} style={{ color: 'var(--accent-primary)' }} /> Two-Factor Authentication
              </h3>
              {mfaStatus.loading ? (
                <span className="badge-pill" style={{ opacity: 0.6 }}>Checking...</span>
              ) : mfaStatus.enabled ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.25rem 0.65rem', borderRadius: '999px',
                  background: 'rgba(16,185,129,0.12)', color: '#10b981',
                  border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.78rem', fontWeight: 600,
                }}>
                  <CheckCircle2 size={13} /> Active &amp; Protected
                </span>
              ) : (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.25rem 0.65rem', borderRadius: '999px',
                  background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.78rem', fontWeight: 600,
                }}>
                  <AlertTriangle size={13} /> Not Configured
                </span>
              )}
            </div>

            {/* Super Admin Mandatory Badge & Warning */}
            {isSuperAdmin && (
              <div style={{
                marginBottom: '1.25rem', padding: '0.85rem 1rem', borderRadius: '10px',
                background: mfaStatus.enabled ? 'rgba(99,102,241,0.08)' : 'rgba(225,29,72,0.1)',
                border: mfaStatus.enabled ? '1px solid rgba(99,102,241,0.2)' : '1px solid rgba(225,29,72,0.3)',
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
              }}>
                <ShieldAlert size={18} style={{ color: mfaStatus.enabled ? 'var(--accent-primary)' : 'var(--danger)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: mfaStatus.enabled ? 'var(--accent-primary)' : 'var(--danger)' }}>
                    Mandatory Super Admin Requirement
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                    {mfaStatus.enabled 
                      ? 'Two-Factor Authentication is active. As a Super Administrator, 2FA cannot be disabled to protect institutional governance.'
                      : 'Governance actions (promoting, demoting, archiving administrators) are restricted until you complete authenticator enrollment.'}
                  </p>
                </div>
              </div>
            )}

            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Enhance account security by requiring an authenticator code (Google Authenticator, Microsoft Authenticator, 1Password, or Authy) on sign in.
            </p>

            {mfaStatus.enabled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{
                  padding: '1rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <KeyRound size={17} style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      Emergency Recovery Codes
                    </span>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: mfaStatus.recoveryCodesRemaining <= 2 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {mfaStatus.recoveryCodesRemaining} of 8 remaining
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={openMfaReplace}
                    style={{ flex: 1, minWidth: '160px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    <RefreshCw size={15} /> Reconfigure App
                  </button>
                  {!isSuperAdmin && (
                    <button
                      type="button"
                      className="btn"
                      onClick={openMfaDisable}
                      style={{
                        flex: 1, minWidth: '140px',
                        background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
                        border: '1px solid rgba(239,68,68,0.25)',
                      }}
                    >
                      Disable 2FA
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openMfaSetup}
                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <ShieldCheck size={18} /> Enable Two-Factor Authentication
                </button>
              </div>
            )}
          </section>}

        </div>

      </div>


      {/* ── Universal 2FA Modals Overlay ────────────────────────────────────── */}
      {mfaModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
          <div className="glass-panel" style={{
            width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto',
            padding: '2rem', borderRadius: '20px', background: 'var(--bg-surface, #13131a)',
            border: '1px solid var(--glass-border)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            position: 'relative',
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <KeyRound size={22} style={{ color: 'var(--accent-primary)' }} />
                <h3 className="font-display" style={{ margin: 0, fontSize: '1.25rem' }}>
                  {mfaModal === 'setup' && (mfaStep === 1 ? 'Verify Password' : mfaStep === 2 ? 'Scan Authenticator QR' : 'Backup Recovery Codes')}
                  {mfaModal === 'replace' && (mfaStep === 1 ? 'Reconfigure 2FA' : mfaStep === 2 ? 'Scan New QR' : 'Fresh Recovery Codes')}
                  {mfaModal === 'disable' && 'Disable Two-Factor Authentication'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeMfaModal}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {mfaError && (
              <div style={{
                marginBottom: '1.25rem', padding: '0.75rem 1rem', borderRadius: '8px',
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
                color: 'var(--danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{mfaError}</span>
              </div>
            )}

            {/* SETUP / REPLACE: Step 1 (Password or Recovery Code) */}
            {mfaStep === 1 && (mfaModal === 'setup' || mfaModal === 'replace') && (
              <form onSubmit={mfaModal === 'setup' ? handleMfaSetupStep1 : handleMfaReplaceStep1} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                  {mfaModal === 'setup'
                    ? 'To begin setup, please confirm your current account password.'
                    : 'To replace your authenticator, confirm with either your password or an emergency recovery code.'}
                </p>

                {mfaModal === 'replace' && (
                  <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => { setMfaReplaceMethod('password'); setMfaError(''); }}
                      className={`btn btn-sm ${mfaReplaceMethod === 'password' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      Use Password
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMfaReplaceMethod('recovery'); setMfaError(''); }}
                      className={`btn btn-sm ${mfaReplaceMethod === 'recovery' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      Use Recovery Code
                    </button>
                  </div>
                )}

                {mfaReplaceMethod === 'password' ? (
                  <div className="input-group">
                    <label>Account Password</label>
                    <input
                      type="password"
                      className="input-glass"
                      required
                      placeholder="Enter your current password"
                      value={mfaPassword}
                      onChange={e => setMfaPassword(e.target.value)}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="input-group">
                    <label>Emergency Recovery Code</label>
                    <input
                      type="text"
                      className="input-glass font-mono text-center tracking-wider"
                      required
                      placeholder="e.g. A1B2-C3D4"
                      value={mfaRecoveryInput}
                      onChange={e => setMfaRecoveryInput(e.target.value)}
                      autoFocus
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeMfaModal}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={mfaLoading}>
                    {mfaLoading ? 'Verifying...' : 'Continue'}
                  </button>
                </div>
              </form>
            )}

            {/* SETUP / REPLACE: Step 2 (Scan QR Code & Enter TOTP) */}
            {mfaStep === 2 && (mfaModal === 'setup' || mfaModal === 'replace') && (
              <form onSubmit={handleMfaVerifyStep2} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
                  Scan the QR code below using your authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit verification code.
                </p>

                {/* Local Canvas QR Code Component */}
                <AuthenticatorQRCode
                  otpauthUri={mfaSetupData.otpauthUri}
                  secret={mfaSetupData.secret}
                  accountName={currentUser?.username || 'BFI User'}
                />

                <div className="input-group">
                  <label htmlFor="totpVerifyInput">6-Digit Verification Code</label>
                  <input
                    id="totpVerifyInput"
                    type="text"
                    inputMode="numeric"
                    className="input-glass font-mono text-center text-lg tracking-widest"
                    placeholder="000 000"
                    maxLength={6}
                    required
                    value={mfaVerificationCode}
                    onChange={e => setMfaVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeMfaModal}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={mfaLoading || mfaVerificationCode.length !== 6}
                  >
                    {mfaLoading ? 'Activating...' : 'Activate 2FA'}
                  </button>
                </div>
              </form>
            )}

            {/* SETUP / REPLACE: Step 3 (Display 8 Emergency Recovery Codes) */}
            {mfaStep === 3 && (mfaModal === 'setup' || mfaModal === 'replace') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: 'rgba(16,185,129,0.15)', color: '#10b981',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem',
                  }}>
                    <CheckCircle2 size={26} />
                  </div>
                  <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
                    Two-Factor Authentication Activated!
                  </h4>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                    Save these 8 single-use emergency recovery codes. If you ever lose your phone or authenticator app, these codes are the ONLY way to access your account.
                  </p>
                </div>

                {/* 8 Recovery Codes Grid */}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem',
                  background: 'rgba(0,0,0,0.25)', padding: '1rem', borderRadius: '12px',
                  border: '1px solid var(--glass-border)',
                }}>
                  {mfaRecoveryCodes.map((code, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.5rem', borderRadius: '6px',
                        background: 'rgba(255,255,255,0.04)',
                        fontFamily: 'monospace', fontSize: '0.9rem',
                        textAlign: 'center', fontWeight: 600,
                        color: 'var(--text-primary)', letterSpacing: '0.05em',
                      }}
                    >
                      {code}
                    </div>
                  ))}
                </div>

                {/* Actions: Copy & Download */}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={handleCopyRecoveryCodes}
                    className="btn btn-secondary"
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                  >
                    {mfaCopiedCodes ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
                    {mfaCopiedCodes ? 'Copied to Clipboard' : 'Copy Codes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadRecoveryCodes}
                    className="btn btn-secondary"
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                  >
                    <Download size={14} /> Download .txt
                  </button>
                </div>

                {/* Acknowledgment Checkbox */}
                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                  fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer',
                  padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)',
                }}>
                  <input
                    type="checkbox"
                    checked={mfaAcknowledgedCodes}
                    onChange={e => setMfaAcknowledgedCodes(e.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>I have securely saved these 8 emergency recovery codes in a safe place.</span>
                </label>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={closeMfaModal}
                  disabled={!mfaAcknowledgedCodes}
                  style={{ width: '100%', marginTop: '0.5rem' }}
                >
                  Done
                </button>
              </div>
            )}

            {/* DISABLE MODAL */}
            {mfaModal === 'disable' && (
              <form onSubmit={handleMfaDisableSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                  Disabling two-factor authentication makes your account less secure. Please confirm with your password or a 6-digit code.
                </p>

                <div className="input-group">
                  <label>Account Password</label>
                  <input
                    type="password"
                    className="input-glass"
                    placeholder="Enter account password"
                    value={mfaPassword}
                    onChange={e => setMfaPassword(e.target.value)}
                  />
                </div>

                <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>— OR —</div>

                <div className="input-group">
                  <label>6-Digit Authenticator Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input-glass font-mono text-center tracking-widest"
                    placeholder="000 000"
                    maxLength={6}
                    value={mfaVerificationCode}
                    onChange={e => setMfaVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeMfaModal}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn"
                    style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}
                    disabled={mfaLoading || (!mfaPassword && mfaVerificationCode.length !== 6)}
                  >
                    {mfaLoading ? 'Disabling...' : 'Confirm Disable 2FA'}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

      {/* No-results empty state */}
      {visibleSections && visibleSections.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          color: 'var(--text-muted)', fontSize: '0.95rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
        }}>
          <Search size={32} style={{ opacity: 0.3 }} />
          <span>No settings match <strong style={{ color: 'var(--text-secondary)' }}>“{searchQuery}”</strong></span>
        </div>
      )}
    </div>
  );
}
