import { createContext, useContext, useState, useEffect } from 'react';

export const THEMES = [
  {
    id: 'cinema-noir',
    name: 'Cinema Noir',
    description: 'The classic dark room — deep black with crimson spotlight.',
    preview: ['#0a0a0c', '#e11d48', '#8b5cf6'],
    accent: '#e11d48',
    accentHover: '#be123c',
    accentSecondary: '#8b5cf6',
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    description: 'Magic hour on set — warm amber light, like a sunset shoot.',
    preview: ['#0d0a05', '#d97706', '#ef4444'],
    accent: '#d97706',
    accentHover: '#b45309',
    accentSecondary: '#ef4444',
  },
  {
    id: 'silver-screen',
    name: 'Silver Screen',
    description: 'Classic Hollywood — cool steel tones and electric blue.',
    preview: ['#0a0c10', '#3b82f6', '#a78bfa'],
    accent: '#3b82f6',
    accentHover: '#2563eb',
    accentSecondary: '#a78bfa',
  },
  {
    id: 'deep-ocean',
    name: 'Deep Ocean',
    description: 'Underwater cinematography — rich navy with electric cyan glow.',
    preview: ['#020d1a', '#0ea5e9', '#06b6d4'],
    accent: '#0ea5e9',
    accentHover: '#0284c7',
    accentSecondary: '#06b6d4',
  },
  {
    id: 'forest-dusk',
    name: 'Forest Dusk',
    description: 'Indie & art-house — deep emerald, like a forest at twilight.',
    preview: ['#050d08', '#10b981', '#3b82f6'],
    accent: '#10b981',
    accentHover: '#059669',
    accentSecondary: '#3b82f6',
  },
  {
    id: 'midnight-festival',
    name: 'Midnight Festival',
    description: 'Film festival nights — deep indigo with violet glow.',
    preview: ['#07050f', '#7c3aed', '#ec4899'],
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    accentSecondary: '#ec4899',
  },
  {
    id: 'vintage-sepia',
    name: 'Vintage Sepia',
    description: 'Old celluloid — warm sepia tones of early silent films.',
    preview: ['#110c06', '#b45309', '#dc2626'],
    accent: '#b45309',
    accentHover: '#92400e',
    accentSecondary: '#dc2626',
  },
];

// All dark-mode background/text values keyed by theme id
const DARK_VARS = {
  'cinema-noir':      { bg: '#0a0a0c', bg2: '#131316', bg3: '#1c1c21', glass: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', t1: '#ffffff',  t2: '#a1a1aa', tm: '#71717a' },
  'golden-hour':      { bg: '#0d0a05', bg2: '#1a1208', bg3: '#241b0c', glass: 'rgba(255,200,100,0.04)', border: 'rgba(251,191,36,0.12)',  t1: '#fef3c7', t2: '#d4a85a', tm: '#9a7040' },
  'silver-screen':    { bg: '#0a0c10', bg2: '#111827', bg3: '#1a2436', glass: 'rgba(100,149,237,0.04)', border: 'rgba(100,149,237,0.1)',  t1: '#e2e8f0', t2: '#94a3b8', tm: '#64748b' },
  'deep-ocean':       { bg: '#020d1a', bg2: '#061525', bg3: '#0a1f35', glass: 'rgba(14,165,233,0.06)',  border: 'rgba(14,165,233,0.15)',  t1: '#e0f2fe', t2: '#7dd3fc', tm: '#38bdf8' },
  'forest-dusk':      { bg: '#050d08', bg2: '#0a1a10', bg3: '#0f2518', glass: 'rgba(16,185,129,0.04)', border: 'rgba(16,185,129,0.1)',   t1: '#ecfdf5', t2: '#6ee7b7', tm: '#34d399' },
  'midnight-festival':{ bg: '#07050f', bg2: '#0f0c1c', bg3: '#17132a', glass: 'rgba(124,58,237,0.05)', border: 'rgba(124,58,237,0.12)',  t1: '#f3e8ff', t2: '#c4b5fd', tm: '#7c5dbf' },
  'vintage-sepia':    { bg: '#110c06', bg2: '#1c1409', bg3: '#271d0e', glass: 'rgba(180,120,60,0.06)', border: 'rgba(180,120,60,0.14)',  t1: '#fdf0d5', t2: '#c8a96a', tm: '#8b6a3a' },
};

// Light mode uses same accent color but inverted backgrounds/text
const LIGHT_VARS = {
  bg: '#f5f5f8', bg2: '#ffffff', bg3: '#ededf3',
  glass: 'rgba(0,0,0,0.03)', border: 'rgba(0,0,0,0.1)',
  t1: '#09090b', t2: '#52525b', tm: '#a1a1aa',
};

const ThemeContext = createContext(null);
const THEME_KEY = 'bfi-classroom-theme';
const MODE_KEY  = 'bfi-classroom-mode';

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => localStorage.getItem(THEME_KEY) || 'cinema-noir');
  const [mode,    setModeState] = useState(() => localStorage.getItem(MODE_KEY)  || 'dark');

  const applyVars = (id, m) => {
    const theme = THEMES.find(t => t.id === id) || THEMES[0];
    const root  = document.documentElement;
    const dark  = DARK_VARS[id] || DARK_VARS['cinema-noir'];

    if (m === 'light') {
      root.style.setProperty('--bg-primary',           LIGHT_VARS.bg);
      root.style.setProperty('--bg-secondary',         LIGHT_VARS.bg2);
      root.style.setProperty('--bg-tertiary',          LIGHT_VARS.bg3);
      root.style.setProperty('--glass-bg',             LIGHT_VARS.glass);
      root.style.setProperty('--glass-border',         LIGHT_VARS.border);
      root.style.setProperty('--text-primary',         LIGHT_VARS.t1);
      root.style.setProperty('--text-secondary',       LIGHT_VARS.t2);
      root.style.setProperty('--text-muted',           LIGHT_VARS.tm);
    } else {
      root.style.setProperty('--bg-primary',           dark.bg);
      root.style.setProperty('--bg-secondary',         dark.bg2);
      root.style.setProperty('--bg-tertiary',          dark.bg3);
      root.style.setProperty('--glass-bg',             dark.glass);
      root.style.setProperty('--glass-border',         dark.border);
      root.style.setProperty('--text-primary',         dark.t1);
      root.style.setProperty('--text-secondary',       dark.t2);
      root.style.setProperty('--text-muted',           dark.tm);
    }

    // Accent colors always from the selected theme
    root.style.setProperty('--accent-primary',         theme.accent);
    root.style.setProperty('--accent-primary-hover',   theme.accentHover);
    root.style.setProperty('--accent-secondary',       theme.accentSecondary);
    root.style.setProperty('--success',                '#10b981');
    root.style.setProperty('--warning',                '#f59e0b');
    root.style.setProperty('--danger',                 '#ef4444');

    // data attribute drives CSS-level overrides
    root.setAttribute('data-mode', m);
  };

  useEffect(() => {
    applyVars(themeId, mode);
    localStorage.setItem(THEME_KEY, themeId);
    localStorage.setItem(MODE_KEY,  mode);
  }, [themeId, mode]);

  const setTheme   = (id) => setThemeId(id);
  const toggleMode = ()   => setModeState(m => m === 'dark' ? 'light' : 'dark');
  const setMode    = (m)  => setModeState(m);

  const currentTheme = THEMES.find(t => t.id === themeId) || THEMES[0];

  return (
    <ThemeContext.Provider value={{ themeId, setTheme, currentTheme, themes: THEMES, mode, toggleMode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
