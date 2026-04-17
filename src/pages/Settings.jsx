import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Shield, Key, User, Save, AlertCircle, Palette, Check, Sun, Moon, Pencil } from 'lucide-react';

export default function Settings() {
  const { currentUser, updateUser } = useAuth();
  const { themeId, setTheme, themes, mode, toggleMode } = useTheme();
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [nameForm, setNameForm] = useState({ firstName: currentUser?.firstName || '', lastName: currentUser?.lastName || '' });
  const [nameLoading, setNameLoading] = useState(false);
  const [nameMessage, setNameMessage] = useState({ type: '', text: '' });

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
    setNameLoading(true);
    setNameMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/auth/update-name', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ first_name: nameForm.firstName, last_name: nameForm.lastName }),
      });

      let data = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }

      if (res.ok) {
        updateUser({ firstName: data.user?.firstName, lastName: data.user?.lastName });
        setNameMessage({ type: 'success', text: 'Name updated! Changes are reflected across the platform.' });
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
      <div style={{ marginBottom: '3rem' }}>
        <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>Account Settings</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
          Manage your account details, security preferences, and appearance.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* ── Dark / Light Mode Toggle ──────────────────────────────────────── */}
        <section className="glass-panel" style={{ padding: '2rem' }}>
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
            ].map(({ m, icon, label, desc, bg, cardBg, textCol }) => {
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
        </section>

        {/* ── Theme Colour Switcher ─────────────────────────────────────────── */}
        <section className="glass-panel" style={{ padding: '2rem' }}>
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
        </section>

        {/* ── Account Info + Name Edit + Password ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>

          {/* Account Info */}
          <section className="glass-panel" style={{ padding: '2rem' }}>
            <h3 className="font-display" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
              <User size={20} style={{ color: 'var(--accent-primary)' }} /> Account Info
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label>Username</label>
                <input type="text" className="input-glass" value={currentUser?.username} disabled style={{ opacity: 0.7 }} title="Username can only be changed by admin" />
              </div>
              <div className="input-group">
                <label>Account Role</label>
                {currentUser?.role === 'admin' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 1rem', borderRadius: '8px', background: 'linear-gradient(135deg, rgba(225,29,72,0.12), rgba(139,92,246,0.12))', border: '1px solid rgba(225,29,72,0.25)' }}>
                    <Shield size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>ADMIN — Control Panel</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>Full platform administrative access</div>
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
          </section>

          {/* Display Name Editor */}
          <section className="glass-panel" style={{ padding: '2rem' }}>
            <h3 className="font-display" style={{ marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem' }}>
              <Pencil size={20} style={{ color: 'var(--accent-primary)' }} /> Display Name
            </h3>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Change how your name appears on the dashboard, sidebar, and across the platform.
            </p>
            <form onSubmit={handleNameChange} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label>First Name</label>
                <input type="text" className="input-glass" required placeholder="e.g. BFI" value={nameForm.firstName} onChange={e => setNameForm({ ...nameForm, firstName: e.target.value })} />
              </div>
              <div className="input-group">
                <label>Last Name</label>
                <input type="text" className="input-glass" placeholder="e.g. Admin" value={nameForm.lastName} onChange={e => setNameForm({ ...nameForm, lastName: e.target.value })} />
              </div>
              {nameMessage.text && (
                <div style={{ padding: '0.75rem', borderRadius: '8px', fontSize: '0.88rem', background: nameMessage.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: nameMessage.type === 'error' ? 'var(--danger)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={15} /> {nameMessage.text}
                </div>
              )}
              <button type="submit" className="btn btn-primary" disabled={nameLoading}>
                {nameLoading ? 'Saving...' : <><Save size={17} /> Save Name</>}
              </button>
            </form>
          </section>

          {/* Change Password */}
          <section className="glass-panel" style={{ padding: '2rem' }}>
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
          </section>

        </div>

      </div>
    </div>
  );
}
