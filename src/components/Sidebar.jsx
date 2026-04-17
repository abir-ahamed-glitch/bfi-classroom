import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { 
  Home, 
  Inbox, 
  User, 
  Library, 
  Film, 
  BookOpen, 
  Users, 
  Award,
  LogOut,
  Settings,
  Menu,
  X,
  FileSignature,
  Megaphone,
  BookUser,
  Sun,
  Moon,
  Shield,
  Briefcase,
} from 'lucide-react';
import './Sidebar.css';

export default function Sidebar() {
  const { currentUser, logout } = useAuth();
  const { currentTheme, mode, toggleMode } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Header Bar */}
      <div className="mobile-header-bar">
        <button className={`mobile-toggle ${isOpen ? 'active' : ''}`} onClick={toggleSidebar}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="mobile-header-brand">
          BFI Classroom
        </div>
      </div>

      {/* Backdrop for mobile */}
      {isOpen && <div className="sidebar-backdrop" onClick={closeSidebar}></div>}

      <aside className={`sidebar glass-panel ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div style={{
            background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
            padding: '6px',
            borderRadius: '10px',
            marginRight: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(37, 99, 235, 0.4)'
          }}>
            <img src="/bfi-logo.jpg" alt="BFI Logo" style={{ height: '22px', width: 'auto', mixBlendMode: 'multiply', display: 'block' }} />
          </div>
          <div>
            <h2 className="font-display">BFI <span className="font-light">Classroom</span></h2>
            {currentUser?.role === 'admin' && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                background: 'linear-gradient(135deg, rgba(225,29,72,0.2), rgba(139,92,246,0.2))',
                border: '1px solid rgba(225,29,72,0.3)',
                borderRadius: '20px', padding: '1px 8px',
                fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
                color: 'var(--accent-primary)', marginTop: '2px',
                textTransform: 'uppercase',
              }}>
                <Shield size={9} /> Admin Panel
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-subtitle">Main Menu</p>
          <NavLink to="/" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`} end>
            <Home size={20} /> Dashboard
          </NavLink>
          <NavLink to="/inbox" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Inbox size={20} /> Inbox
          </NavLink>
          
          <p className="nav-subtitle">My Studio</p>
          <NavLink to="/profile" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <User size={20} /> Student Profile
          </NavLink>
          <NavLink to="/portfolio" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Library size={20} /> Student Portfolio
          </NavLink>
          <NavLink to="/experience" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Briefcase size={20} /> Experience
          </NavLink>
          <NavLink to="/certificates" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Award size={20} /> Certificates
          </NavLink>
          
          <p className="nav-subtitle">Learning Hub</p>
          <NavLink to="/courses" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookOpen size={20} /> Course Materials
          </NavLink>
          <NavLink to="/community" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Users size={20} /> Community
          </NavLink>
          <NavLink to="/directory" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookUser size={20} /> Alumni Directory
          </NavLink>
          <NavLink to="/bfiaa" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Award size={20} /> BFIAA Network
          </NavLink>

          {currentUser?.role === 'admin' && (
            <>
              <p className="nav-subtitle">Administration</p>
              <NavLink to="/admin/students" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Settings size={20} /> Student Manager
              </NavLink>
              <NavLink to="/admin/course-materials" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <BookOpen size={20} /> Course Materials
              </NavLink>
              <NavLink to="/admin/certificate-designer" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <FileSignature size={20} /> Certificate Designer
              </NavLink>
              <NavLink to="/admin/announcements" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Megaphone size={20} /> Announcements
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">

          {/* Dark / Light Mode Toggle */}
          <button
            onClick={toggleMode}
            title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)',
              color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: '0.5rem',
              fontFamily: 'var(--font-sans)', fontSize: '0.88rem', fontWeight: 500,
              transition: 'all 0.2s ease',
              justifyContent: 'space-between',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
              {mode === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </span>
            {/* Mini pill toggle */}
            <div style={{
              width: '36px', height: '20px', borderRadius: '10px',
              background: mode === 'light' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.15)',
              position: 'relative', flexShrink: 0, transition: 'background 0.25s',
            }}>
              <div style={{
                position: 'absolute', top: '3px',
                left: mode === 'light' ? '18px' : '3px',
                width: '14px', height: '14px', borderRadius: '50%',
                background: 'white', transition: 'left 0.25s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </div>
          </button>

          <NavLink to="/settings" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`} style={{ marginBottom: '1rem', position: 'relative' }}>
            <Settings size={20} /> Account Settings
            <span title={`Theme: ${currentTheme?.name}`} style={{
              position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
              width: '8px', height: '8px', borderRadius: '50%',
              background: currentTheme?.accent || 'var(--accent-primary)',
              boxShadow: `0 0 6px ${currentTheme?.accent || 'var(--accent-primary)'}`,
              flexShrink: 0,
            }} />
          </NavLink>
          <div className="user-mini-profile">
            <div className="avatar">{currentUser?.firstName?.[0] || 'U'}</div>
            <div className="user-info">
              <p className="user-name">{currentUser?.firstName} {currentUser?.lastName}</p>
              <p className="user-role">{currentUser?.username}</p>
            </div>
          </div>
          <button onClick={() => { logout(); closeSidebar(); }} className="logout-btn">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>
    </>
  );
}
