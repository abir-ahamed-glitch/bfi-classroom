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
  Shield,
  ArrowRight
} from 'lucide-react';
import './GlobalSearch.css';

export default function GlobalSearch({ inSidebar = false, onNavigate }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { mode, toggleMode } = useTheme();

  // Global hotkey: Ctrl+K or Cmd+K or "/" to focus search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === '/' && document.activeElement !== inputRef.current) {
        // Only trigger '/' if not already typing in another input/textarea
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !document.activeElement?.isContentEditable) {
          e.preventDefault();
          inputRef.current?.focus();
          setIsOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        icon: <Home size={18} />,
        desc: 'Overview, film catalog, and quick access',
        keywords: 'dashboard home overview feed film catalog welcome',
      },
      {
        id: 'notices',
        title: 'Notice Board',
        category: 'Main Menu',
        path: '/notices',
        icon: <Megaphone size={18} />,
        desc: 'Official institutional announcements and notices',
        keywords: 'notice board announcements circulars news broadcast alerts',
      },
      {
        id: 'inbox',
        title: 'Inbox',
        category: 'Main Menu',
        path: '/inbox',
        icon: <Inbox size={18} />,
        desc: 'Direct messages, class conversations, and chat',
        keywords: 'inbox messages chat conversations direct communication messaging',
      },

      // ── BFI Classroom ──────────────────────
      ...(role === 'student' ? [{
        id: 'student-portal',
        title: 'Student Portal',
        category: 'BFI Classroom',
        path: '/student-portal',
        icon: <Award size={18} />,
        desc: 'Academic profile, grades, and records',
        keywords: 'student portal grades attendance academic results',
      }] : []),
      {
        id: 'classroom',
        title: 'Classroom',
        category: 'BFI Classroom',
        path: '/classroom',
        icon: <BookOpen size={18} />,
        desc: 'Course lessons, video modules, and curriculum',
        keywords: 'classroom lessons courses lectures syllabus video learning',
      },
      {
        id: 'registry',
        title: role === 'student' ? 'My Batchmates' : 'Academic Records & Registry',
        category: 'BFI Classroom',
        path: '/registry',
        icon: <UsersRound size={18} />,
        desc: role === 'student' ? 'View and connect with your batchmates' : 'Student database, batch rosters, and transcripts',
        keywords: 'registry records students batchmates academic database roster',
      },
      {
        id: 'instructors',
        title: 'Instructor Directory',
        category: 'BFI Classroom',
        path: '/instructors',
        icon: <Award size={18} />,
        desc: 'Faculty members, course mentors, and directors',
        keywords: 'instructors teachers faculty directory professors mentors',
      },

      // ── My Studio ──────────────────────────
      {
        id: 'profile',
        title: role === 'admin' ? 'Admin Profile' : role === 'instructor' ? 'Teacher Profile' : 'Student Profile',
        category: 'My Studio',
        path: '/profile',
        icon: <User size={18} />,
        desc: 'Personal details, portfolio, and identity',
        keywords: 'profile my account student teacher admin details bio avatar identity',
      },
      ...(role === 'student' ? [{
        id: 'certificates',
        title: 'Certificates',
        category: 'My Studio',
        path: '/certificates',
        icon: <ScrollText size={18} />,
        desc: 'Issued certificates, diplomas, and credentials',
        keywords: 'certificates awards achievements diploma degree credentials verification',
      }] : []),
      ...(role !== 'admin' ? [{
        id: 'courses',
        title: 'Course Materials',
        category: 'My Studio',
        path: '/courses',
        icon: <BookOpen size={18} />,
        desc: 'Downloadable syllabus, lecture notes, and PDFs',
        keywords: 'course materials syllabus notes pdf download study resources',
      }] : []),

      // ── Learning Hub ───────────────────────
      {
        id: 'community',
        title: 'Community',
        category: 'Learning Hub',
        path: '/community',
        icon: <Users size={18} />,
        desc: 'Student posts, discussions, and film collaborations',
        keywords: 'community forum discussion posts group social feed film collab',
      },
      {
        id: 'directory',
        title: 'Alumni Directory',
        category: 'Learning Hub',
        path: '/directory',
        icon: <BookUser size={18} />,
        desc: 'Directory of all graduated BFI filmmakers',
        keywords: 'directory alumni graduates members list filmmakers contact',
      },
      {
        id: 'bfiaa',
        title: 'BFIAA Network',
        category: 'Learning Hub',
        path: '/bfiaa',
        icon: <Globe size={18} />,
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
          icon: <BarChart2 size={18} />,
          desc: 'Platform traffic, logins, and engagement metrics',
          keywords: 'analytics statistics metrics data charts visitors traffic performance',
        },
        {
          id: 'admin-reports',
          title: 'Reports & Moderation',
          category: 'Administration',
          path: '/admin/reports',
          icon: <Flag size={18} />,
          desc: 'Moderation queue, user flags, and issue reports',
          keywords: 'reports flags moderation issues tickets logs audit',
        },
        {
          id: 'admin-studentsmanager',
          title: 'Student Manager',
          category: 'Administration',
          path: '/admin/studentsmanager',
          icon: <Users size={18} />,
          desc: 'Enrollments, user permissions, and access status',
          keywords: 'student manager users enrollment accounts admissions access',
        },
        {
          id: 'admin-batchmanager',
          title: 'Batch Manager',
          category: 'Administration',
          path: '/admin/batchmanager',
          icon: <Users size={18} />,
          desc: 'Create and manage student batches and cohorts',
          keywords: 'batch manager classes cohorts batches groups intake',
        },
        {
          id: 'admin-teachers',
          title: 'Teacher Manager',
          category: 'Administration',
          path: '/admin/teachers',
          icon: <Shield size={18} />,
          desc: 'Faculty assignments and teacher management',
          keywords: 'teachers manager faculty instructors staff assign instructors',
        },
        {
          id: 'admin-course-materials',
          title: 'Admin Course Materials',
          category: 'Administration',
          path: '/admin/course-materials',
          icon: <BookOpen size={18} />,
          desc: 'Upload and organize course files and resources',
          keywords: 'admin course materials upload files resources pdf video curriculum',
        },
        {
          id: 'admin-course-maker',
          title: 'Course Maker',
          category: 'Administration',
          path: '/admin/course-maker',
          icon: <Layers size={18} />,
          desc: 'Design and build interactive course modules',
          keywords: 'course maker builder curriculum syllabus modules lessons create',
        },
        {
          id: 'admin-certificate-designer',
          title: 'Certificate Designer',
          category: 'Administration',
          path: '/admin/certificate-designer',
          icon: <FileSignature size={18} />,
          desc: 'Design templates and generate graduate certificates',
          keywords: 'certificate designer template design issue credentials generator',
        },
        {
          id: 'admin-announcements',
          title: 'Announcements & Broadcasts',
          category: 'Administration',
          path: '/admin/announcements',
          icon: <Megaphone size={18} />,
          desc: 'Send push announcements and bulk notices',
          keywords: 'announcements broadcast notices push send alert notice board',
        },
        {
          id: 'admin-additional-options',
          title: 'Additional Options',
          category: 'Administration',
          path: '/admin/additional-options',
          icon: <Sliders size={18} />,
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
        icon: <Settings size={18} />,
        desc: 'Preferences, security, appearance, and profile info',
        keywords: 'settings account preferences options configuration',
      },
      {
        id: 'settings-display-mode',
        title: 'Display Mode (Dark / Light)',
        category: 'Settings',
        path: '/settings',
        action: 'toggle-mode',
        icon: mode === 'dark' ? <Moon size={18} /> : <Sun size={18} />,
        desc: `Currently in ${mode === 'dark' ? 'Dark' : 'Light'} Mode. Click to switch.`,
        keywords: 'display mode dark light theme appearance contrast night day switch toggle',
      },
      {
        id: 'settings-colour-theme',
        title: 'Colour Theme',
        category: 'Settings',
        path: '/settings',
        icon: <Palette size={18} />,
        desc: 'Customize your accent color palette',
        keywords: 'colour color theme accent palette tint style look aesthetic crimson emerald cyan',
      },
      {
        id: 'settings-profile-details',
        title: 'Profile Details & Name',
        category: 'Settings',
        path: '/settings',
        icon: <Pencil size={18} />,
        desc: 'Update your display name, username, and recovery email',
        keywords: 'profile details edit name username recovery email change name',
      },
      {
        id: 'settings-change-password',
        title: 'Change Password',
        category: 'Settings',
        path: '/settings',
        icon: <Key size={18} />,
        desc: 'Update your account login password',
        keywords: 'change password security update password credentials current new confirm',
      },

      // ── Actions ────────────────────────────
      {
        id: 'logout',
        title: 'Logout',
        category: 'Actions',
        action: 'logout',
        icon: <LogOut size={18} />,
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
      // Return top / default items when input is empty
      return allItems.slice(0, 8);
    }
    return allItems.filter(item => {
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
    setIsOpen(false);
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
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        handleSelect(filteredItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`global-search-container ${inSidebar ? 'sidebar-mode' : ''}`}
      role="search"
    >
      <div className="global-search-input-wrap">
        <Search size={15} className="global-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="global-search-input"
          placeholder="Search menus & settings…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="Search all menus and settings"
          aria-expanded={isOpen}
          aria-autocomplete="list"
        />
        {query ? (
          <button
            type="button"
            className="global-search-clear-btn"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            title="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="global-search-kbd">Ctrl K</kbd>
        )}
      </div>

      {/* Floating search dropdown */}
      {isOpen && (
        <div className="global-search-dropdown" role="listbox">
          {filteredItems.length === 0 ? (
            <div className="global-search-empty">
              <Search size={28} style={{ opacity: 0.3 }} />
              <div>No menu or option matches “<strong>{query}</strong>”</div>
            </div>
          ) : (
            <div>
              {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category}>
                  <div className="global-search-group-title">{category}</div>
                  {items.map((item) => {
                    const globalIdx = filteredItems.indexOf(item);
                    const isSelected = globalIdx === selectedIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`global-search-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <div className="global-search-item-icon">
                          {item.icon}
                        </div>
                        <div className="global-search-item-info">
                          <div className="global-search-item-title">
                            <span>{item.title}</span>
                          </div>
                          <div className="global-search-item-desc">
                            {item.desc}
                          </div>
                        </div>
                        <ArrowRight size={13} style={{ color: 'var(--text-muted)', opacity: isSelected ? 0.9 : 0.3 }} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
