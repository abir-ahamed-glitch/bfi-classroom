import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { haptic } from '../utils/haptics';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { soundManager } from '../utils/AudioSynthesizer';
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
  UsersRound,
  ScrollText,
  Globe,
  Bell
} from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ isNotifOpen, setIsNotifOpen }) {
  const { currentUser, logout } = useAuth();
  const { currentTheme, mode, toggleMode } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadInboxCount, setUnreadInboxCount] = useState(0);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const currentUserIdRef = useRef(null);
  const socketUrl = import.meta.env.VITE_SOCKET_URL || '';
  const hideBottomNav = isOpen || location.pathname.startsWith('/admin');

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);
  const goToDashboard = () => {
    closeSidebar();
    navigate('/');
  };

  useEffect(() => {
    // Mobile sidebar toggle no longer manipulates history to prevent breaking standard navigation stack
  }, [isOpen]);
  const hasUnreadInbox = unreadInboxCount > 0;
  const unreadBadgeLabel = unreadInboxCount > 99 ? '99+' : `${unreadInboxCount}`;

  const fetchUnreadInboxCount = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUnreadInboxCount(0);
      return;
    }

    try {
      const response = await fetch('/api/inbox/conversations', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) return;

      const data = await response.json();
      const chats = data.chats || [];
      const nextCount = chats.reduce((sum, chat) => sum + (Number(chat.unread_count) || 0), 0);
      setUnreadInboxCount(nextCount);
    } catch (error) {
      console.error('Failed to fetch unread inbox count', error);
    }
  };

  const fetchUnreadNotificationCount = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadNotificationCount(data.unreadCount || 0);
        window.dispatchEvent(new CustomEvent('updateUnreadNotifications', { detail: data.unreadCount || 0 }));
      }
    } catch (error) {
      console.error('Failed to fetch unread notification count', error);
    }
  };

  useEffect(() => {
    currentUserIdRef.current = Number(currentUser?.id);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) {
      const timeoutId = window.setTimeout(() => {
        setUnreadInboxCount(0);
        setUnreadNotificationCount(0);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      fetchUnreadInboxCount();
      fetchUnreadNotificationCount();
    }, 0);
    const intervalId = window.setInterval(() => {
      fetchUnreadInboxCount();
      fetchUnreadNotificationCount();
    }, 10000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !currentUser?.id) return undefined;

    const socket = io(socketUrl, {
      withCredentials: true,
      auth: { token },
    });

    socket.on('inbox:message', (message) => {
      const currentUserId = currentUserIdRef.current;
      if (Number(message.receiver_id) !== currentUserId || Number(message.sender_id) === currentUserId) {
        return;
      }

      setUnreadInboxCount((prev) => prev + 1);
      if (!location.pathname.startsWith('/inbox')) {
        try {
          const mutedChats = JSON.parse(localStorage.getItem('inbox_muted_chats') || '[]');
          const isMuted = mutedChats.map(Number).includes(Number(message.sender_id));
          if (!isMuted) {
            soundManager.playMessageReceived();
          }
        } catch {
          soundManager.playMessageReceived();
        }
      }
    });

    socket.on('inbox:read', () => {
      fetchUnreadInboxCount();
    });

    socket.on('inbox:conversation_deleted', () => {
      fetchUnreadInboxCount();
    });

    socket.on('inbox:message_deleted', () => {
      fetchUnreadInboxCount();
    });

    socket.on('new_notification', () => {
      fetchUnreadNotificationCount();
    });

    return () => {
      socket.disconnect();
    };
  }, [currentUser?.id, currentUser?.role, socketUrl, location.pathname]);



  return (
    <>
      {/* Mobile Header Bar */}
      <div className="mobile-header-bar">
        <button type="button" className="mobile-header-brand brand-home-button" onClick={goToDashboard} title="Go to Dashboard">
          <div style={{
            background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
            padding: '5px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 3px 8px rgba(37, 99, 235, 0.4)'
          }}>
            <img src={`${import.meta.env.BASE_URL}bfi-logo.jpg`} alt="BFI Logo" style={{ height: '18px', width: 'auto', mixBlendMode: 'multiply', display: 'block' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.2rem',
              color: 'var(--text-primary)',
              lineHeight: '1.3',
              fontWeight: 700,
            }}>
              Bangladesh Film Institute
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.2rem',
              color: 'var(--text-secondary)',
              fontWeight: 300,
              lineHeight: '1.3'
            }}>
              BFI Classroom
            </div>
          </div>
        </button>
      </div>

      {/* Backdrop for mobile */}
      {isOpen && <div className="sidebar-backdrop" onClick={closeSidebar}></div>}

      <aside className={`sidebar glass-panel ${isOpen ? 'open' : ''}`}>
        <button type="button" className="sidebar-brand brand-home-button" onClick={goToDashboard} title="Go to Dashboard">
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
            <img src={`${import.meta.env.BASE_URL}bfi-logo.jpg`} alt="BFI Logo" style={{ height: '22px', width: 'auto', mixBlendMode: 'multiply', display: 'block' }} />
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
        </button>

        <nav className="sidebar-nav">
          <p className="nav-subtitle">Main Menu</p>
          <NavLink to="/" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`} end>
            <Home size={20} /> Dashboard
          </NavLink>
          <NavLink to="/notices" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Megaphone size={20} /> Notice Board
          </NavLink>
          <NavLink to="/inbox" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Inbox size={20} /> Inbox
            {hasUnreadInbox && <span className="nav-badge">{unreadBadgeLabel}</span>}
          </NavLink>
          
          <p className="nav-subtitle">BFI Classroom</p>
          {currentUser?.role === 'student' && (
            <NavLink to="/student-portal" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Award size={20} /> Student Portal
            </NavLink>
          )}
          <NavLink to="/classroom" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookOpen size={20} /> Classroom
          </NavLink>
          <NavLink to="/registry" state={{ reset: true }} onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <UsersRound size={20} /> {currentUser?.role === 'student' ? 'My Batchmates' : 'Academic Records & Registry'}
          </NavLink>
          <NavLink to="/instructors" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Award size={20} /> Instructor Directory
          </NavLink>

          <p className="nav-subtitle">My Studio</p>
          <NavLink to="/profile" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <User size={20} /> {currentUser?.role === 'admin' ? 'Admin Profile' : currentUser?.role === 'instructor' ? 'Teacher Profile' : 'Student Profile'}
          </NavLink>
          <NavLink to="/portfolio" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Library size={20} /> {currentUser?.role === 'admin' ? 'Admin Portfolio' : currentUser?.role === 'instructor' ? 'Teacher Portfolio' : 'Student Portfolio'}
          </NavLink>
          <NavLink to="/experience" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Briefcase size={20} /> Experience
          </NavLink>
          {currentUser?.role === 'student' && (
            <NavLink to="/certificates" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <ScrollText size={20} /> Certificates
            </NavLink>
          )}
          {currentUser?.role !== 'admin' && (
            <NavLink to="/courses" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <BookOpen size={20} /> Course Materials
            </NavLink>
          )}
          <p className="nav-subtitle">Learning Hub</p>
          <NavLink to="/community" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Users size={20} /> Community
          </NavLink>

          <NavLink to="/directory" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookUser size={20} /> Alumni Directory
          </NavLink>
          <NavLink to="/bfiaa" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <Globe size={20} /> BFIAA Network
          </NavLink>

          {currentUser?.role === 'admin' && (
            <>
              <p className="nav-subtitle">Administration</p>
              <NavLink to="/admin/students" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Settings size={20} /> Student Manager
              </NavLink>
              <NavLink to="/admin/teachers" onClick={closeSidebar} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Settings size={20} /> Teacher Manager
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
            className="theme-toggle-btn"
            title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
              {mode === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </span>
            {/* Mini pill toggle */}
            <div style={{
              width: '36px', height: '20px', borderRadius: '10px',
              background: mode === 'dark' ? 'var(--accent-primary)' : 'rgba(0,0,0,0.1)',
              position: 'relative', flexShrink: 0, transition: 'background 0.25s',
            }}>
              <div style={{
                position: 'absolute', top: '3px',
                left: mode === 'dark' ? '18px' : '3px',
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
            <div className="avatar" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {currentUser?.profile_picture ? (
                <img src={resolveMediaUrl(currentUser.profile_picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
              )}
            </div>
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

      {/* ── Mobile Bottom Navigation Bar ─────────────────────────── */}
      <nav className={`mobile-bottom-nav ${hideBottomNav ? 'bottom-nav-hidden' : ''}`} aria-label="Quick navigation">
        <NavLink to="/" end className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={() => { closeSidebar(); haptic('tap'); }}>
          <Home size={22} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/inbox" className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={() => { closeSidebar(); haptic('tap'); }}>
          <div className="bottom-nav-icon-wrap">
            <Inbox size={22} />
            {hasUnreadInbox && <span className="bottom-nav-badge">{unreadBadgeLabel}</span>}
          </div>
          <span>Inbox</span>
        </NavLink>
        <NavLink to="/profile" className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={() => { closeSidebar(); haptic('tap'); }}>
          <User size={22} />
          <span>Profile</span>
        </NavLink>
        <button type="button" className={`bottom-nav-item ${isNotifOpen ? 'active' : ''}`} onClick={() => { 
          if (setIsNotifOpen) {
            setIsNotifOpen(!isNotifOpen);
          } else {
            document.dispatchEvent(new CustomEvent('toggleNotifications'));
          }
          haptic('tap'); 
        }}>
          <div className="bottom-nav-icon-wrap">
            <Bell size={22} />
            {unreadNotificationCount > 0 && <span className="bottom-nav-badge">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}
          </div>
          <span>Notifications</span>
        </button>
        <button type="button" className={`bottom-nav-item ${isOpen ? 'active' : ''}`} onClick={() => { toggleSidebar(); haptic('tap'); }}>
          <Menu size={22} />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}
