import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Search,
  X,
  Home,
  Megaphone,
  Inbox,
  BookOpen,
  UsersRound,
  Award,
  User,
  ScrollText,
  Users,
  BookUser,
  Globe,
  BarChart2,
  Flag,
  Layers,
  FileSignature,
  Sliders,
  Sun,
  Moon,
  Palette,
  Key,
  Pencil,
  LogOut,
  Settings,
  Shield
} from 'lucide-react';
import './GlobalSearch.css';

export default function GlobalSearch({ onNavigate }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { mode, toggleMode } = useTheme();

  const isSearching = query.trim().length > 0;

  // Global hotkey: Ctrl+K or Cmd+K or "/" to focus search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === '/' && document.activeElement !== inputRef.current) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !document.activeElement?.isContentEditable) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      } else if (e.key === 'Escape' && isSearching) {
        e.preventDefault();
        setQuery('');
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearching]);

  // Complete index of every sidebar menu and option
  const allItems = useMemo(() => {
    const role = currentUser?.role || 'student';
    const items = [
      // ── Main Menu ──────────────────────────
      {
        id: 'dashboard',
        title: 'Dashboard',
        category: 'Main Menu',
        path: '/',
        icon: <Home size={16} />,
        keywords: 'dashboard home overview feed film catalog welcome',
      },
      {
        id: 'notices',
        title: 'Notice Board',
        category: 'Main Menu',
        path: '/notices',
        icon: <Megaphone size={16} />,
        keywords: 'notice board announcements circulars news broadcast alerts',
      },
      {
        id: 'inbox',
        title: 'Inbox',
        category: 'Main Menu',
        path: '/inbox',
        icon: <Inbox size={16} />,
        keywords: 'inbox messages chat conversations direct communication messaging',
      },

      // ── BFI Classroom ──────────────────────
      ...(role === 'student' ? [{
        id: 'student-portal',
        title: 'Student Portal',
        category: 'BFI Classroom',
        path: '/student-portal',
        icon: <Award size={16} />,
        keywords: 'student portal grades attendance academic results',
      }] : []),
      {
        id: 'classroom',
        title: 'Classroom',
        category: 'BFI Classroom',
        path: '/classroom',
        icon: <BookOpen size={16} />,
        keywords: 'classroom lessons courses lectures syllabus video learning',
      },
      {
        id: 'registry',
        title: role === 'student' ? 'My Batchmates' : 'Academic Records & Registry',
        category: 'BFI Classroom',
        path: '/registry',
        icon: <UsersRound size={16} />,
        keywords: 'registry records students batchmates academic database roster',
      },
      {
        id: 'instructors',
        title: 'Instructor Directory',
        category: 'BFI Classroom',
        path: '/instructors',
        icon: <Award size={16} />,
        keywords: 'instructors teachers faculty directory professors mentors',
      },

      // ── My Studio ──────────────────────────
      {
        id: 'profile',
        title: role === 'admin' ? 'Admin Profile' : role === 'instructor' ? 'Teacher Profile' : 'Student Profile',
        category: 'My Studio',
        path: '/profile',
        icon: <User size={16} />,
        keywords: 'profile my account student teacher admin details bio avatar identity',
      },
      ...(role === 'student' ? [{
        id: 'certificates',
        title: 'Certificates',
        category: 'My Studio',
        path: '/certificates',
        icon: <ScrollText size={16} />,
        keywords: 'certificates awards achievements diploma degree credentials verification',
      }] : []),
      ...(role !== 'admin' ? [{
        id: 'courses',
        title: 'Course Materials',
        category: 'My Studio',
        path: '/courses',
        icon: <BookOpen size={16} />,
        keywords: 'course materials syllabus notes pdf download study resources',
      }] : []),

      // ── Learning Hub ───────────────────────
      {
        id: 'community',
        title: 'Community',
        category: 'Learning Hub',
        path: '/community',
        icon: <Users size={16} />,
        keywords: 'community forum discussion posts group social feed film collab',
      },
      {
        id: 'directory',
        title: 'Alumni Directory',
        category: 'Learning Hub',
        path: '/directory',
        icon: <BookUser size={16} />,
        keywords: 'directory alumni graduates members list filmmakers contact',
      },
      {
        id: 'bfiaa',
        title: 'BFIAA Network',
        category: 'Learning Hub',
        path: '/bfiaa',
        icon: <Globe size={16} />,
        keywords: 'bfiaa alumni network global film association chapter',
      },

      // ── Administration (Admin only) ────────
      ...(role === 'admin' ? [
        {
          id: 'admin-analytics',
          title: 'Analytics',
          category: 'Administration',
          path: '/admin/analytics',
          icon: <BarChart2 size={16} />,
          keywords: 'analytics statistics metrics data charts visitors traffic performance',
        },
        {
          id: 'admin-reports',
          title: 'Reports & Moderation',
          category: 'Administration',
          path: '/admin/reports',
          icon: <Flag size={16} />,
          keywords: 'reports flags moderation issues tickets logs audit',
        },
        {
          id: 'admin-studentsmanager',
          title: 'Student Manager',
          category: 'Administration',
          path: '/admin/studentsmanager',
          icon: <Users size={16} />,
          keywords: 'student manager users enrollment accounts admissions access',
        },
        {
          id: 'admin-batchmanager',
          title: 'Batch Manager',
          category: 'Administration',
          path: '/admin/batchmanager',
          icon: <Users size={16} />,
          keywords: 'batch manager classes cohorts batches groups intake',
        },
        {
          id: 'admin-teachers',
          title: 'Teacher Manager',
          category: 'Administration',
          path: '/admin/teachers',
          icon: <Shield size={16} />,
          keywords: 'teachers manager faculty instructors staff assign instructors',
        },
        {
          id: 'admin-course-materials',
          title: 'Admin Course Materials',
          category: 'Administration',
          path: '/admin/course-materials',
          icon: <BookOpen size={16} />,
          keywords: 'admin course materials upload files resources pdf video curriculum',
        },
        {
          id: 'admin-course-maker',
          title: 'Course Maker',
          category: 'Administration',
          path: '/admin/course-maker',
          icon: <Layers size={16} />,
          keywords: 'course maker builder curriculum syllabus modules lessons create',
        },
        {
          id: 'admin-certificate-designer',
          title: 'Certificate Designer',
          category: 'Administration',
          path: '/admin/certificate-designer',
          icon: <FileSignature size={16} />,
          keywords: 'certificate designer template design issue credentials generator',
        },
        {
          id: 'admin-announcements',
          title: 'Announcements & Broadcasts',
          category: 'Administration',
          path: '/admin/announcements',
          icon: <Megaphone size={16} />,
          keywords: 'announcements broadcast notices push send alert notice board',
        },
        {
          id: 'admin-additional-options',
          title: 'Additional Options',
          category: 'Administration',
          path: '/admin/additional-options',
          icon: <Sliders size={16} />,
          keywords: 'additional options settings fees fee tracker finance configuration',
        },
      ] : []),

      // ── Settings & Preferences ─────────────
      {
        id: 'settings',
        title: 'Account Settings',
        category: 'Settings',
        path: '/settings',
        icon: <Settings size={16} />,
        keywords: 'settings account preferences options configuration',
      },
      {
        id: 'settings-display-mode',
        title: 'Display Mode (Dark / Light)',
        category: 'Settings',
        path: '/settings',
        action: 'toggle-mode',
        icon: mode === 'dark' ? <Moon size={16} /> : <Sun size={16} />,
        keywords: 'display mode dark light theme appearance contrast night day switch toggle',
      },
      {
        id: 'settings-colour-theme',
        title: 'Colour Theme',
        category: 'Settings',
        path: '/settings',
        icon: <Palette size={16} />,
        keywords: 'colour color theme accent palette tint style look aesthetic crimson emerald cyan',
      },
      {
        id: 'settings-profile-details',
        title: 'Profile Details & Name',
        category: 'Settings',
        path: '/settings',
        icon: <Pencil size={16} />,
        keywords: 'profile details edit name username recovery email change name',
      },
      {
        id: 'settings-change-password',
        title: 'Change Password',
        category: 'Settings',
        path: '/settings',
        icon: <Key size={16} />,
        keywords: 'change password security update password credentials current new confirm',
      },

      // ── Actions ────────────────────────────
      {
        id: 'logout',
        title: 'Logout',
        category: 'Actions',
        action: 'logout',
        icon: <LogOut size={16} />,
        keywords: 'logout sign out exit quit disconnect',
      },
    ];

    return items;
  }, [currentUser?.role, mode]);

  // Filter items based on query - only when query is NOT empty
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return allItems.filter((item) => {
      return (
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
      );
    });
  }, [allItems, query]);

  const handleSelect = (item) => {
    setQuery('');

    if (item.action === 'toggle-mode') {
      toggleMode();
    } else if (item.action === 'logout') {
      if (window.confirm('Are you sure you want to log out?')) {
        logout();
      }
    } else if (item.path) {
      navigate(item.path);
    }

    if (onNavigate) {
      onNavigate();
    }
  };

  const handleKeyDown = (e) => {
    if (!isSearching || filteredItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (selectedIndex + 1) % filteredItems.length;
      setSelectedIndex(next);
      itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
      setSelectedIndex(prev);
      itemRefs.current[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        handleSelect(filteredItems[selectedIndex]);
      }
    }
  };

  return (
    <div className="sidebar-search-container" role="search">
      {/* ── Search Input Box ─────────────────────────────────────────────── */}
      <div className="sidebar-search-input-wrap">
        <Search size={15} className="sidebar-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="sidebar-search-input"
          placeholder="Search menus & settings…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          aria-label="Search menus and settings"
          aria-expanded={isSearching}
          aria-autocomplete="list"
        />
        {query ? (
          <button
            type="button"
            className="sidebar-search-clear"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            title="Clear search (ESC)"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="sidebar-search-kbd">Ctrl K</kbd>
        )}
      </div>

      {/* ── Results appear ONLY when people start typing ─────────────────── */}
      {isSearching && (
        <div className="sidebar-search-results-panel" role="listbox">
          <div className="sidebar-search-results-header">
            <span>Search Results</span>
            <span>{filteredItems.length} found</span>
          </div>

          {filteredItems.length === 0 ? (
            <div className="sidebar-search-results-empty">
              No menu or option matches “<strong>{query}</strong>”
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  ref={(el) => (itemRefs.current[idx] = el)}
                  type="button"
                  className={`sidebar-search-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="sidebar-search-item-icon">
                    {item.icon}
                  </div>
                  <div className="sidebar-search-item-content">
                    {/* Full Name Shown without truncation */}
                    <div className="sidebar-search-item-title">{item.title}</div>
                    <div className="sidebar-search-item-category">{item.category}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
