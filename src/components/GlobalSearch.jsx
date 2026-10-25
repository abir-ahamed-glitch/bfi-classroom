import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Search,
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
  Shield,
  CornerDownLeft
} from 'lucide-react';
import './GlobalSearch.css';

export default function GlobalSearch({ onNavigate }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { mode, toggleMode } = useTheme();

  // Open & Focus helper
  const handleOpen = () => {
    setIsOpen(true);
    setSelectedIndex(0);
  };

  const handleClose = () => {
    setIsOpen(false);
    setQuery('');
  };

  // Global hotkey: Ctrl+K or Cmd+K or "/" to open palette
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === '/' && !isOpen) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !document.activeElement?.isContentEditable) {
          e.preventDefault();
          handleOpen();
        }
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Auto-focus input when palette opens
  useEffect(() => {
    if (isOpen) {
      // Small timeout to guarantee DOM is mounted
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

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
        icon: <Home size={17} />,
        desc: 'Overview, film catalog, and quick access',
        keywords: 'dashboard home overview feed film catalog welcome',
      },
      {
        id: 'notices',
        title: 'Notice Board',
        category: 'Main Menu',
        path: '/notices',
        icon: <Megaphone size={17} />,
        desc: 'Official institutional announcements and circulars',
        keywords: 'notice board announcements circulars news broadcast alerts',
      },
      {
        id: 'inbox',
        title: 'Inbox',
        category: 'Main Menu',
        path: '/inbox',
        icon: <Inbox size={17} />,
        desc: 'Direct messages, class discussions, and chat',
        keywords: 'inbox messages chat conversations direct communication messaging',
      },

      // ── BFI Classroom ──────────────────────
      ...(role === 'student' ? [{
        id: 'student-portal',
        title: 'Student Portal',
        category: 'BFI Classroom',
        path: '/student-portal',
        icon: <Award size={17} />,
        desc: 'Academic records, grades, and course status',
        keywords: 'student portal grades attendance academic results',
      }] : []),
      {
        id: 'classroom',
        title: 'Classroom',
        category: 'BFI Classroom',
        path: '/classroom',
        icon: <BookOpen size={17} />,
        desc: 'Course lessons, video modules, and curriculum',
        keywords: 'classroom lessons courses lectures syllabus video learning',
      },
      {
        id: 'registry',
        title: role === 'student' ? 'My Batchmates' : 'Academic Records & Registry',
        category: 'BFI Classroom',
        path: '/registry',
        icon: <UsersRound size={17} />,
        desc: role === 'student' ? 'View and connect with your batchmates' : 'Student database, batch rosters, and transcripts',
        keywords: 'registry records students batchmates academic database roster',
      },
      {
        id: 'instructors',
        title: 'Instructor Directory',
        category: 'BFI Classroom',
        path: '/instructors',
        icon: <Award size={17} />,
        desc: 'Faculty members, course mentors, and directors',
        keywords: 'instructors teachers faculty directory professors mentors',
      },

      // ── My Studio ──────────────────────────
      {
        id: 'profile',
        title: role === 'admin' ? 'Admin Profile' : role === 'instructor' ? 'Teacher Profile' : 'Student Profile',
        category: 'My Studio',
        path: '/profile',
        icon: <User size={17} />,
        desc: 'Personal details, portfolio, and identity',
        keywords: 'profile my account student teacher admin details bio avatar identity',
      },
      ...(role === 'student' ? [{
        id: 'certificates',
        title: 'Certificates',
        category: 'My Studio',
        path: '/certificates',
        icon: <ScrollText size={17} />,
        desc: 'Issued certificates, diplomas, and credentials',
        keywords: 'certificates awards achievements diploma degree credentials verification',
      }] : []),
      ...(role !== 'admin' ? [{
        id: 'courses',
        title: 'Course Materials',
        category: 'My Studio',
        path: '/courses',
        icon: <BookOpen size={17} />,
        desc: 'Downloadable syllabus, lecture notes, and study PDFs',
        keywords: 'course materials syllabus notes pdf download study resources',
      }] : []),

      // ── Learning Hub ───────────────────────
      {
        id: 'community',
        title: 'Community',
        category: 'Learning Hub',
        path: '/community',
        icon: <Users size={17} />,
        desc: 'Student posts, film discussions, and collaborations',
        keywords: 'community forum discussion posts group social feed film collab',
      },
      {
        id: 'directory',
        title: 'Alumni Directory',
        category: 'Learning Hub',
        path: '/directory',
        icon: <BookUser size={17} />,
        desc: 'Directory of all graduated BFI filmmakers',
        keywords: 'directory alumni graduates members list filmmakers contact',
      },
      {
        id: 'bfiaa',
        title: 'BFIAA Network',
        category: 'Learning Hub',
        path: '/bfiaa',
        icon: <Globe size={17} />,
        desc: 'Bangladesh Film Institute Alumni Association network',
        keywords: 'bfiaa alumni network global film association chapter',
      },

      // ── Administration (Admin only) ────────
      ...(role === 'admin' ? [
        {
          id: 'admin-analytics',
          title: 'Analytics',
          category: 'Administration',
          path: '/admin/analytics',
          icon: <BarChart2 size={17} />,
          desc: 'Platform traffic, logins, and engagement metrics',
          keywords: 'analytics statistics metrics data charts visitors traffic performance',
        },
        {
          id: 'admin-reports',
          title: 'Reports & Moderation',
          category: 'Administration',
          path: '/admin/reports',
          icon: <Flag size={17} />,
          desc: 'Moderation queue, user flags, and issue reports',
          keywords: 'reports flags moderation issues tickets logs audit',
        },
        {
          id: 'admin-studentsmanager',
          title: 'Student Manager',
          category: 'Administration',
          path: '/admin/studentsmanager',
          icon: <Users size={17} />,
          desc: 'Enrollments, user permissions, and access status',
          keywords: 'student manager users enrollment accounts admissions access',
        },
        {
          id: 'admin-batchmanager',
          title: 'Batch Manager',
          category: 'Administration',
          path: '/admin/batchmanager',
          icon: <Users size={17} />,
          desc: 'Create and manage student batches and cohorts',
          keywords: 'batch manager classes cohorts batches groups intake',
        },
        {
          id: 'admin-teachers',
          title: 'Teacher Manager',
          category: 'Administration',
          path: '/admin/teachers',
          icon: <Shield size={17} />,
          desc: 'Faculty assignments and teacher management',
          keywords: 'teachers manager faculty instructors staff assign instructors',
        },
        {
          id: 'admin-course-materials',
          title: 'Admin Course Materials',
          category: 'Administration',
          path: '/admin/course-materials',
          icon: <BookOpen size={17} />,
          desc: 'Upload and organize course files and resources',
          keywords: 'admin course materials upload files resources pdf video curriculum',
        },
        {
          id: 'admin-course-maker',
          title: 'Course Maker',
          category: 'Administration',
          path: '/admin/course-maker',
          icon: <Layers size={17} />,
          desc: 'Design and build interactive course modules',
          keywords: 'course maker builder curriculum syllabus modules lessons create',
        },
        {
          id: 'admin-certificate-designer',
          title: 'Certificate Designer',
          category: 'Administration',
          path: '/admin/certificate-designer',
          icon: <FileSignature size={17} />,
          desc: 'Design templates and generate graduate certificates',
          keywords: 'certificate designer template design issue credentials generator',
        },
        {
          id: 'admin-announcements',
          title: 'Announcements & Broadcasts',
          category: 'Administration',
          path: '/admin/announcements',
          icon: <Megaphone size={17} />,
          desc: 'Send push announcements and bulk notices',
          keywords: 'announcements broadcast notices push send alert notice board',
        },
        {
          id: 'admin-additional-options',
          title: 'Additional Options',
          category: 'Administration',
          path: '/admin/additional-options',
          icon: <Sliders size={17} />,
          desc: 'Fee tracking, batch fees, and advanced admin controls',
          keywords: 'additional options settings fees fee tracker finance configuration',
        },
      ] : []),

      // ── Settings & Preferences ─────────────
      {
        id: 'settings',
        title: 'Account Settings',
        category: 'Settings',
        path: '/settings',
        icon: <Settings size={17} />,
        desc: 'Preferences, security, appearance, and profile info',
        keywords: 'settings account preferences options configuration',
      },
      {
        id: 'settings-display-mode',
        title: 'Display Mode (Dark / Light)',
        category: 'Settings',
        path: '/settings',
        action: 'toggle-mode',
        icon: mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />,
        desc: `Currently in ${mode === 'dark' ? 'Dark' : 'Light'} Mode. Click to switch.`,
        keywords: 'display mode dark light theme appearance contrast night day switch toggle',
      },
      {
        id: 'settings-colour-theme',
        title: 'Colour Theme',
        category: 'Settings',
        path: '/settings',
        icon: <Palette size={17} />,
        desc: 'Customize accent color palette across the UI',
        keywords: 'colour color theme accent palette tint style look aesthetic crimson emerald cyan',
      },
      {
        id: 'settings-profile-details',
        title: 'Profile Details & Name',
        category: 'Settings',
        path: '/settings',
        icon: <Pencil size={17} />,
        desc: 'Update display name, username, and recovery email',
        keywords: 'profile details edit name username recovery email change name',
      },
      {
        id: 'settings-change-password',
        title: 'Change Password',
        category: 'Settings',
        path: '/settings',
        icon: <Key size={17} />,
        desc: 'Update your account login password',
        keywords: 'change password security update password credentials current new confirm',
      },

      // ── Actions ────────────────────────────
      {
        id: 'logout',
        title: 'Logout',
        category: 'Actions',
        action: 'logout',
        icon: <LogOut size={17} />,
        desc: 'Sign out of your BFI Classroom account',
        keywords: 'logout sign out exit quit disconnect',
      },
    ];

    return items;
  }, [currentUser?.role, mode]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return allItems;
    }
    return allItems.filter((item) => {
      return (
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
      );
    });
  }, [allItems, query]);

  // Group filtered items by category
  const groupedItems = useMemo(() => {
    const groups = {};
    filteredItems.forEach((item) => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredItems]);

  const handleSelect = (item) => {
    handleClose();

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
    if (filteredItems.length === 0) return;

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
    <>
      {/* ── Sleek Trigger Button in Sidebar ──────────────────────────────── */}
      <button
        type="button"
        className="sidebar-search-trigger"
        onClick={handleOpen}
        aria-label="Open command palette"
        title="Search menus & settings (Ctrl+K)"
      >
        <Search size={15} className="sidebar-search-trigger-icon" />
        <span className="sidebar-search-trigger-text">Search menus & settings…</span>
        <kbd className="sidebar-search-trigger-kbd">Ctrl K</kbd>
      </button>

      {/* ── Modern Industry-Standard Command Palette Modal ──────────────── */}
      {isOpen && (
        <div
          className="cmd-palette-backdrop"
          onClick={handleClose}
          role="presentation"
        >
          <div
            className="cmd-palette-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command search"
          >
            {/* Header with Search Input */}
            <div className="cmd-palette-header">
              <Search size={18} className="cmd-palette-search-icon" />
              <input
                ref={inputRef}
                type="text"
                className="cmd-palette-input"
                placeholder="Type a menu, setting, or command…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                aria-label="Search menus and settings"
                aria-autocomplete="list"
              />
              <button
                type="button"
                className="cmd-palette-close-badge"
                onClick={handleClose}
                title="Press ESC to close"
              >
                ESC
              </button>
            </div>

            {/* Scrollable Results Body */}
            <div className="cmd-palette-body" role="listbox">
              {filteredItems.length === 0 ? (
                <div className="cmd-palette-empty">
                  <Search size={32} style={{ opacity: 0.35 }} />
                  <div>No menu or setting matches “<strong>{query}</strong>”</div>
                </div>
              ) : (
                Object.entries(groupedItems).map(([category, items]) => (
                  <div key={category}>
                    <div className="cmd-palette-section-title">{category}</div>
                    {items.map((item) => {
                      const globalIdx = filteredItems.indexOf(item);
                      const isSelected = globalIdx === selectedIndex;
                      return (
                        <button
                          key={item.id}
                          ref={(el) => (itemRefs.current[globalIdx] = el)}
                          type="button"
                          className={`cmd-palette-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelect(item)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <div className="cmd-palette-item-icon">
                            {item.icon}
                          </div>
                          <div className="cmd-palette-item-content">
                            <div className="cmd-palette-item-top">
                              <span className="cmd-palette-item-title">{item.title}</span>
                              <span className="cmd-palette-item-category">{item.category}</span>
                            </div>
                            <span className="cmd-palette-item-desc">{item.desc}</span>
                          </div>
                          <div className="cmd-palette-item-enter">
                            <span>Open</span>
                            <CornerDownLeft size={13} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Modal Keyboard Navigation Footer */}
            <div className="cmd-palette-footer">
              <div className="cmd-palette-footer-shortcuts">
                <span className="cmd-palette-footer-hint">
                  <kbd>↑</kbd><kbd>↓</kbd> to navigate
                </span>
                <span className="cmd-palette-footer-hint">
                  <kbd>↵</kbd> to select
                </span>
                <span className="cmd-palette-footer-hint">
                  <kbd>esc</kbd> to close
                </span>
              </div>
              <span>
                {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
