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
  Plus,
  DollarSign,
  Wallet,
  UploadCloud,
  Trash2,
  Sparkles
} from 'lucide-react';
import './GlobalSearch.css';

// ── Levenshtein Distance for typo tolerance & intelligent suggestions ─────────
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Word similarity: 1.0 = exact/contains, down to 0.5 for close typos
function wordSimilarity(word, target) {
  if (!word || !target) return 0;
  if (target.includes(word)) return 1.0;
  if (word.includes(target)) return 0.9;
  const dist = levenshtein(word, target);
  const maxLen = Math.max(word.length, target.length);
  const sim = 1 - dist / maxLen;
  return sim >= 0.55 ? sim : 0;
}

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

  // Comprehensive index of every option, feature, sub-view, and menu according to role
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
        desc: 'Overview, film catalog, and quick access',
        keywords: 'dashboard home overview feed film catalog welcome main',
      },
      {
        id: 'notices',
        title: 'Notice Board',
        category: 'Main Menu',
        path: '/notices',
        icon: <Megaphone size={16} />,
        desc: 'Official institutional announcements and circulars',
        keywords: 'notice board announcements circulars news broadcast alerts circular circulars bulletin',
      },
      {
        id: 'inbox',
        title: 'Inbox',
        category: 'Main Menu',
        path: '/inbox',
        icon: <Inbox size={16} />,
        desc: 'Direct messages, class discussions, and chat',
        keywords: 'inbox messages chat conversations direct communication messaging dm chats',
      },

      // ── BFI Classroom ──────────────────────
      ...(role === 'student' ? [{
        id: 'student-portal',
        title: 'Student Portal',
        category: 'BFI Classroom',
        path: '/student-portal',
        icon: <Award size={16} />,
        desc: 'Academic records, grades, and course status',
        keywords: 'student portal grades attendance academic results status marks report card',
      }] : []),
      {
        id: 'classroom',
        title: 'Classroom',
        category: 'BFI Classroom',
        path: '/classroom',
        icon: <BookOpen size={16} />,
        desc: 'Course lessons, video modules, and curriculum',
        keywords: 'classroom lessons courses lectures syllabus video learning zoom live class curriculum modules',
      },
      {
        id: 'registry',
        title: role === 'student' ? 'My Batchmates' : 'Academic Records & Registry',
        category: 'BFI Classroom',
        path: '/registry',
        icon: <UsersRound size={16} />,
        desc: role === 'student' ? 'View and connect with your batchmates' : 'Student database, batch rosters, and transcripts',
        keywords: 'registry records students batchmates academic database roster classmates batch cohort',
      },
      {
        id: 'instructors',
        title: 'Instructor Directory',
        category: 'BFI Classroom',
        path: '/instructors',
        icon: <Award size={16} />,
        desc: 'Faculty members, course mentors, and directors',
        keywords: 'instructors teachers faculty directory professors mentors directors staff teaching',
      },

      // ── My Studio ──────────────────────────
      {
        id: 'profile',
        title: role === 'admin' ? 'Admin Profile' : role === 'instructor' ? 'Teacher Profile' : 'Student Profile',
        category: 'My Studio',
        path: '/profile',
        icon: <User size={16} />,
        desc: 'Personal details, portfolio, and identity',
        keywords: 'profile my account student teacher admin details bio avatar identity information edit photo',
      },
      ...(role === 'student' ? [{
        id: 'certificates',
        title: 'Certificates',
        category: 'My Studio',
        path: '/certificates',
        icon: <ScrollText size={16} />,
        desc: 'Issued certificates, diplomas, and credentials',
        keywords: 'certificates awards achievements diploma degree credentials verification download verify',
      }] : []),
      ...(role !== 'admin' ? [{
        id: 'courses',
        title: 'Course Materials',
        category: 'My Studio',
        path: '/courses',
        icon: <BookOpen size={16} />,
        desc: 'Downloadable syllabus, lecture notes, and study PDFs',
        keywords: 'course materials syllabus notes pdf download study resources reading files slides',
      }] : []),

      // ── Learning Hub ───────────────────────
      {
        id: 'community',
        title: 'Community',
        category: 'Learning Hub',
        path: '/community',
        icon: <Users size={16} />,
        desc: 'Student posts, film discussions, and collaborations',
        keywords: 'community forum discussion posts group social feed film collab networking feed',
      },
      {
        id: 'directory',
        title: 'Alumni Directory',
        category: 'Learning Hub',
        path: '/directory',
        icon: <BookUser size={16} />,
        desc: 'Directory of all graduated BFI filmmakers',
        keywords: 'directory alumni graduates members list filmmakers contact graduates network',
      },
      {
        id: 'bfiaa',
        title: 'BFIAA Network',
        category: 'Learning Hub',
        path: '/bfiaa',
        icon: <Globe size={16} />,
        desc: 'Bangladesh Film Institute Alumni Association network',
        keywords: 'bfiaa alumni network global film association chapter association bfi',
      },

      // ── Administration (Admin only) ────────
      ...(role === 'admin' ? [
        {
          id: 'admin-analytics',
          title: 'Analytics',
          category: 'Administration',
          path: '/admin/analytics',
          icon: <BarChart2 size={16} />,
          desc: 'Platform traffic, logins, and engagement metrics',
          keywords: 'analytics statistics metrics data charts visitors traffic performance stats tracking',
        },
        {
          id: 'admin-reports',
          title: 'Reports & Moderation',
          category: 'Administration',
          path: '/admin/reports',
          icon: <Flag size={16} />,
          desc: 'Moderation queue, user flags, and issue reports',
          keywords: 'reports flags moderation issues tickets logs audit violations complaints',
        },
        {
          id: 'admin-studentsmanager',
          title: 'Student Manager',
          category: 'Administration',
          path: '/admin/studentsmanager',
          icon: <Users size={16} />,
          desc: 'Enrollments, user permissions, and access status',
          keywords: 'student manager users enrollment accounts admissions access approve students edit student',
        },
        {
          id: 'admin-batchmanager',
          title: 'Batch Manager',
          category: 'Administration',
          path: '/admin/batchmanager',
          icon: <Users size={16} />,
          desc: 'Create and manage student batches and cohorts',
          keywords: 'batch manager classes cohorts batches groups intake create batch assign batch',
        },
        {
          id: 'admin-teachers',
          title: 'Teacher Manager',
          category: 'Administration',
          path: '/admin/teachers',
          icon: <Shield size={16} />,
          desc: 'Faculty assignments and teacher management',
          keywords: 'teachers manager faculty instructors staff assign instructors faculty directory add teacher',
        },
        {
          id: 'admin-course-materials',
          title: 'Admin Course Materials',
          category: 'Administration',
          path: '/admin/course-materials',
          icon: <BookOpen size={16} />,
          desc: 'Upload and organize course files and resources',
          keywords: 'admin course materials upload files resources pdf video curriculum class docs',
        },
        {
          id: 'admin-course-maker',
          title: 'Course Maker',
          category: 'Administration',
          path: '/admin/course-maker',
          icon: <Layers size={16} />,
          desc: 'Design and build interactive course modules',
          keywords: 'course maker builder curriculum syllabus modules lessons create new course phases routine',
        },
        {
          id: 'admin-certificate-designer',
          title: 'Certificate Designer',
          category: 'Administration',
          path: '/admin/certificate-designer',
          icon: <FileSignature size={16} />,
          desc: 'Design templates and generate graduate certificates',
          keywords: 'certificate designer template design issue credentials generator templates diplomas',
        },
        {
          id: 'admin-announcements',
          title: 'Announcements & Broadcasts',
          category: 'Administration',
          path: '/admin/announcements',
          icon: <Megaphone size={16} />,
          desc: 'Send push announcements and bulk notices',
          keywords: 'announcements broadcast notices push send alert notice board sms email mass notice',
        },
                ...(currentUser?.is_super_admin || currentUser?.id === 1 ? [{
          id: 'admin-administrators',
          title: 'Administrator Management',
          category: 'Administration',
          path: '/admin/administrators',
          icon: <Shield size={16} />,
          desc: 'Manage administrator accounts, assign granular permissions, and view audit ledger',
          keywords: 'super admin administrators rbac permissions accounts audit security mfa logs staff privileges roles',
        }] : []),
        {
          id: 'admin-additional-options',
          title: 'Additional Options',
          category: 'Administration',
          path: '/admin/additional-options',
          icon: <Sliders size={16} />,
          desc: 'Overview of all advanced administrative classroom tools',
          keywords: 'additional options settings tools admin controls extra features overview',
        },

        // ── Specific Features inside Additional Options ───────
        {
          id: 'create-custom-subject',
          title: 'Create Custom Subject',
          category: 'Additional Options',
          path: '/admin/additional-options?view=custom-subjects',
          icon: <Plus size={16} />,
          desc: 'Manage default & custom classroom subjects, edit names, and delete subjects',
          keywords: 'create custom subject subjects curriculum topics course subject class subject add subject edit subject delete subject custom subject',
        },
        {
          id: 'course-settings-manager',
          title: 'Course Settings Manager',
          category: 'Additional Options',
          path: '/admin/additional-options?view=course-settings',
          icon: <Settings size={16} />,
          desc: 'Configure total classes, exam scores, passing marks, and assignments per course',
          keywords: 'course settings manager grading pass marks passing score total classes exam assignments evaluation rules',
        },
        {
          id: 'batch-fee-manager',
          title: 'Batch Fee Manager',
          category: 'Additional Options',
          path: '/admin/additional-options?view=batch-fees',
          icon: <DollarSign size={16} />,
          desc: 'Define course fees per batch used as the default fee',
          keywords: 'batch fee manager course fee tuition price pricing cost installment payment fee structure',
        },
        {
          id: 'fee-tracker',
          title: 'Fee Tracker',
          category: 'Additional Options',
          path: '/admin/additional-options?view=fee-tracker',
          icon: <Wallet size={16} />,
          desc: 'Monitor student payments, send payment reminders, and track dues',
          keywords: 'fee tracker monitor payments student fees paid dues unpaid payment reminders ledger balance accounts',
        },
        {
          id: 'bulk-import-registrations',
          title: 'Bulk Import Registrations',
          category: 'Additional Options',
          path: '/admin/additional-options?view=bulk-import',
          icon: <UploadCloud size={16} />,
          desc: 'Upload unregistered students from CSV/Excel to track leads and prospects',
          keywords: 'bulk import registrations upload students excel csv leads prospects admissions bulk import upload file spreadsheet',
        },
        {
          id: 'trash-activity-log',
          title: 'Trash & Activity Log',
          category: 'Additional Options',
          path: '/admin/additional-options?view=trash',
          icon: <Trash2 size={16} />,
          desc: 'Restore deleted items, review audit activity log, and view system trash',
          keywords: 'trash activity log restore deleted items audit history recycle bin logs deletions recovery',
        },
        {
          id: 'leads-table',
          title: 'Registered Leads Table',
          category: 'Additional Options',
          path: '/admin/additional-options?view=leads',
          icon: <Users size={16} />,
          desc: 'View prospective student leads and admission inquiries',
          keywords: 'leads table registered leads prospective students inquiry inquiries admission contacts',
        },
      ] : []),

      // ── Settings & Preferences (All Users) ─────────────
      {
        id: 'settings',
        title: 'Account Settings',
        category: 'Settings',
        path: '/settings',
        icon: <Settings size={16} />,
        desc: 'Preferences, security, appearance, and profile details',
        keywords: 'account settings preferences configuration user settings options account setup',
      },
      {
        id: 'settings-display-mode',
        title: 'Display Mode (Dark / Light)',
        category: 'Settings',
        path: '/settings',
        action: 'toggle-mode',
        icon: mode === 'dark' ? <Moon size={16} /> : <Sun size={16} />,
        desc: `Switch between dark and light interface (Currently ${mode === 'dark' ? 'Dark' : 'Light'})`,
        keywords: 'display mode dark light theme appearance contrast night day switch toggle ui light mode dark mode',
      },
      {
        id: 'settings-colour-theme',
        title: 'Colour Theme',
        category: 'Settings',
        path: '/settings',
        icon: <Palette size={16} />,
        desc: 'Customize accent color palette (Crimson, Emerald, Cyan, Purple, Amber)',
        keywords: 'colour color theme accent palette tint style look aesthetic crimson emerald cyan purple amber palette',
      },
      {
        id: 'settings-profile-details',
        title: 'Profile Details & Name',
        category: 'Settings',
        path: '/settings',
        icon: <Pencil size={16} />,
        desc: 'Update your display name, username, and recovery email',
        keywords: 'profile details edit name username recovery email change name first name last name display name',
      },
      {
        id: 'settings-change-password',
        title: 'Change Password',
        category: 'Settings',
        path: '/settings',
        icon: <Key size={16} />,
        desc: 'Update your account login password',
        keywords: 'change password security update password credentials current password new password reset credentials',
      },

      // ── Actions ────────────────────────────
      {
        id: 'logout',
        title: 'Logout',
        category: 'Actions',
        action: 'logout',
        icon: <LogOut size={16} />,
        desc: 'Sign out of your BFI Classroom account',
        keywords: 'logout sign out exit quit disconnect end session log off',
      },
    ];

    return items;
  }, [currentUser?.role, currentUser?.is_super_admin, currentUser?.id, mode]);

  // Intelligent search matching: exact + typo-tolerant fuzzy suggestions
  const { results, isSuggestion } = useMemo(() => {
    const raw = query.trim().toLowerCase();
    if (!raw) {
      return { results: [], isSuggestion: false };
    }

    const queryWords = raw.split(/\s+/).filter(Boolean);

    // Score all items
    const scored = allItems.map((item) => {
      const titleLower = item.title.toLowerCase();
      const catLower = item.category.toLowerCase();
      const kwLower = (item.keywords || '').toLowerCase();
      const descLower = (item.desc || '').toLowerCase();

      // 1. Direct exact phrase match (highest score)
      if (titleLower.includes(raw)) return { item, score: 3.0, isExact: true };
      if (kwLower.includes(raw)) return { item, score: 2.5, isExact: true };
      if (descLower.includes(raw)) return { item, score: 2.0, isExact: true };
      if (catLower.includes(raw)) return { item, score: 1.8, isExact: true };

      // 2. Multi-word token match
      let totalTokenScore = 0;
      let matchedTokens = 0;

      for (const qw of queryWords) {
        let bestTokenScore = 0;

        // Check against title words
        const titleWords = titleLower.split(/[\s—\-/,]+/);
        for (const tw of titleWords) {
          bestTokenScore = Math.max(bestTokenScore, wordSimilarity(qw, tw) * 1.5);
        }

        // Check against keyword words
        const kwWords = kwLower.split(/[\s—\-/,]+/);
        for (const kw of kwWords) {
          bestTokenScore = Math.max(bestTokenScore, wordSimilarity(qw, kw) * 1.2);
        }

        // Check against category words
        const catWords = catLower.split(/[\s—\-/,]+/);
        for (const cw of catWords) {
          bestTokenScore = Math.max(bestTokenScore, wordSimilarity(qw, cw) * 1.0);
        }

        if (bestTokenScore >= 0.6) {
          matchedTokens++;
          totalTokenScore += bestTokenScore;
        }
      }

      const avgScore = totalTokenScore / queryWords.length;
      const allMatched = matchedTokens === queryWords.length;

      return {
        item,
        score: allMatched ? avgScore * 1.3 : avgScore * 0.8,
        isExact: false,
      };
    });

    // Exact or strong matches (score >= 0.8)
    const exactMatches = scored
      .filter((s) => s.isExact || s.score >= 0.85)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.item);

    if (exactMatches.length > 0) {
      return { results: exactMatches, isSuggestion: false };
    }

    // If no strong/exact matches, look for close fuzzy suggestions (score >= 0.55)
    const suggestions = scored
      .filter((s) => s.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.item);

    if (suggestions.length > 0) {
      return { results: suggestions, isSuggestion: true };
    }

    return { results: [], isSuggestion: false };
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
    if (!isSearching || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (selectedIndex + 1) % results.length;
      setSelectedIndex(next);
      itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (selectedIndex - 1 + results.length) % results.length;
      setSelectedIndex(prev);
      itemRefs.current[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
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
          placeholder="Search menus, features & tools…"
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

      {/* ── Results appear ONLY when user types ───────────────────────────── */}
      {isSearching && (
        <div className="sidebar-search-results-panel" role="listbox">
          <div className="sidebar-search-results-header">
            {isSuggestion ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--accent-primary)' }}>
                <Sparkles size={12} /> Closest Suggestions
              </span>
            ) : (
              <span>Search Results</span>
            )}
            <span>{results.length} found</span>
          </div>

          {results.length === 0 ? (
            <div className="sidebar-search-results-empty">
              <div>No option matches “<strong>{query}</strong>”</div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Try searching for: <span style={{ color: 'var(--accent-primary)' }}>Custom Subject, Password, Batch, Classroom</span>
              </div>
            </div>
          ) : (
            results.map((item, idx) => {
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
                    {/* Full Name Always Shown without truncation */}
                    <div className="sidebar-search-item-title">{item.title}</div>
                    <div className="sidebar-search-item-category">
                      {item.category} {item.desc ? `• ${item.desc}` : ''}
                    </div>
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
