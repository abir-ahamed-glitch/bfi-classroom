import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Edit3, Building2 } from 'lucide-react';

export const STANDARD_PLATFORMS = [
  'Zoom',
  'Google Meet',
  'Microsoft Teams',
  'In-Person Studio'
];

/**
 * Official vector brand icons for standard video conferencing platforms.
 * Uses exact brand geometries, colors, and standard local SVG vectors with zero remote requests.
 */
export const ZoomBrandIcon = ({ size = 16, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    aria-label="Zoom"
  >
    <rect width="24" height="24" rx="5.5" fill="#0B5CFF" />
    <path
      d="M4.5 9.2C4.5 7.98 5.48 7 6.7 7H12.3C13.52 7 14.5 7.98 14.5 9.2V14.8C14.5 16.02 13.52 17 12.3 17H6.7C5.48 17 4.5 16.02 4.5 14.8V9.2Z"
      fill="white"
    />
    <path
      d="M15.5 10.38L19.2 7.7C19.38 7.57 19.5 7.69 19.5 7.91V16.09C19.5 16.31 19.38 16.43 19.2 16.3L15.5 13.62V10.38Z"
      fill="white"
    />
  </svg>
);

export const GoogleMeetBrandIcon = ({ size = 16, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    aria-label="Google Meet"
  >
    <path d="M14 12L17.5 9.5V14.5L14 12Z" fill="#EA4335" />
    <path d="M17.5 9.5L14 12V7C14 6.45 13.55 6 13 6H6V9.5L17.5 9.5Z" fill="#00832D" />
    <path d="M14 12L17.5 14.5L14 17V12Z" fill="#2684FC" />
    <path d="M6 14.5V17C6 17.55 6.45 18 7 18H13C13.55 18 14 17.55 14 17V14.5L6 14.5Z" fill="#00AC47" />
    <path d="M6 9.5H14V14.5H6V9.5Z" fill="#0066DA" />
    <path d="M3.5 10.5C3.5 9.4 4.4 8.5 5.5 8.5H6V15.5H5.5C4.4 15.5 3.5 14.6 3.5 13.5V10.5Z" fill="#FFBA00" />
  </svg>
);

export const TeamsBrandIcon = ({ size = 16, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    aria-label="Microsoft Teams"
  >
    <rect width="24" height="24" rx="5.5" fill="#464EB8" />
    <circle cx="15.5" cy="8.5" r="2" fill="#7B83EB" />
    <path
      d="M13.5 12C13.5 11.45 13.95 11 14.5 11H17.5C18.05 11 18.5 11.45 18.5 12V14.5C18.5 15.05 18.05 15.5 17.5 15.5H14.5C13.95 15.5 13.5 15.05 13.5 14.5V12Z"
      fill="#7B83EB"
    />
    <circle cx="9.5" cy="8.5" r="2.5" fill="#FFFFFF" />
    <rect x="5.5" y="12" width="8" height="6" rx="2" fill="#5059C9" />
    <path d="M10 13.5H8.5V12.5H11.5V13.5H10V16.5H9V13.5H10Z" fill="white" />
  </svg>
);

/** Generic facility icon for in-person physical studio classes (not an official brand logo). */
export const InPersonStudioIcon = ({ size = 16, style = {} }) => (
  <Building2 size={size} style={{ color: '#94a3b8', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }} aria-label="In-Person Studio" />
);

// Backward-compatible named exports for any legacy consumers
export const ZoomOfficialIcon = ZoomBrandIcon;
export const GoogleMeetOfficialIcon = GoogleMeetBrandIcon;
export const TeamsOfficialIcon = TeamsBrandIcon;
export const StudioOfficialIcon = InPersonStudioIcon;

export function getPlatformIcon(platform, size = 16) {
  if (!platform) return null;
  const p = String(platform).trim().toLowerCase();
  if (p === 'zoom') return <ZoomBrandIcon size={size} />;
  if (p === 'google meet' || p === 'meet') return <GoogleMeetBrandIcon size={size} />;
  if (p === 'microsoft teams' || p === 'teams') return <TeamsBrandIcon size={size} />;
  if (p === 'in-person studio' || p === 'studio' || p === 'offline') return <InPersonStudioIcon size={size} />;
  return <Edit3 size={size} style={{ color: '#818cf8' }} />;
}

const PLATFORM_OPTIONS = [
  { value: '', label: 'Medium: Not Set', icon: null },
  { value: 'Zoom', label: 'Zoom', icon: <ZoomBrandIcon size={16} /> },
  { value: 'Google Meet', label: 'Google Meet', icon: <GoogleMeetBrandIcon size={16} /> },
  { value: 'Microsoft Teams', label: 'Microsoft Teams', icon: <TeamsBrandIcon size={16} /> },
  { value: 'In-Person Studio', label: 'In-Person Studio', icon: <InPersonStudioIcon size={16} /> },
  { value: '__custom__', label: 'Custom / Other Medium...', icon: <Edit3 size={15} style={{ color: '#818cf8' }} /> }
];

/**
 * Reusable Class / Routine Platform & Medium Selector.
 * Offers standard video conference platforms (Zoom, Google Meet, Teams, In-Person Studio)
 * with authentic brand SVGs and a custom option for arbitrary tools.
 * Supports full keyboard navigation (Escape, ArrowUp, ArrowDown, Enter) and accessible listbox semantics.
 */
export default function PlatformSelector({
  value = '',
  onChange,
  className = 'cm-select',
  inputClassName = 'cm-input',
  selectStyle = {},
  inputStyle = {},
  title = 'Class Medium / App (e.g. Zoom, Google Meet)'
}) {
  const isStandard = !value || STANDARD_PLATFORMS.includes(value);
  const [isCustomMode, setIsCustomMode] = useState(!isStandard);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (value && !STANDARD_PLATFORMS.includes(value)) {
      setIsCustomMode(true);
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentOption = PLATFORM_OPTIONS.find(o => o.value === (isCustomMode ? '__custom__' : (value || ''))) || {
    value: value || '',
    label: value || 'Medium: Not Set',
    icon: getPlatformIcon(value)
  };

  const handleSelectOption = (optValue) => {
    if (optValue === '__custom__') {
      setIsCustomMode(true);
      setIsOpen(false);
      if (STANDARD_PLATFORMS.includes(value)) {
        onChange('');
      }
    } else {
      setIsCustomMode(false);
      setIsOpen(false);
      onChange(optValue);
    }
    if (triggerRef.current) {
      triggerRef.current.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
        const idx = PLATFORM_OPTIONS.findIndex(o => o.value === (isCustomMode ? '__custom__' : (value || '')));
        setHighlightedIndex(idx >= 0 ? idx : 0);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      if (triggerRef.current) triggerRef.current.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1) % PLATFORM_OPTIONS.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 + PLATFORM_OPTIONS.length) % PLATFORM_OPTIONS.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (PLATFORM_OPTIONS[highlightedIndex]) {
        handleSelectOption(PLATFORM_OPTIONS[highlightedIndex].value);
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%', minWidth: 0, position: 'relative' }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(prev => {
            const next = !prev;
            if (next) {
              const idx = PLATFORM_OPTIONS.findIndex(o => o.value === (isCustomMode ? '__custom__' : (value || '')));
              setHighlightedIndex(idx >= 0 ? idx : 0);
            }
            return next;
          });
        }}
        className={className}
        style={{
          minHeight: '38px',
          padding: '0.35rem 0.6rem',
          fontSize: '0.78rem',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.45rem',
          textAlign: 'left',
          cursor: 'pointer',
          borderRadius: '6px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'var(--text-primary)',
          ...selectStyle
        }}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isCustomMode ? (
            <Edit3 size={15} style={{ color: '#818cf8', flexShrink: 0 }} />
          ) : (
            currentOption.icon || <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px dashed rgba(255,255,255,0.2)', display: 'inline-block', flexShrink: 0 }} />
          )}
          <span style={{ fontWeight: currentOption.value ? 500 : 400 }}>
            {isCustomMode ? (value ? `Custom: ${value}` : 'Custom Medium...') : currentOption.label}
          </span>
        </span>
        <ChevronDown size={14} style={{ opacity: 0.6, flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 100,
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {PLATFORM_OPTIONS.map((opt, idx) => {
            const isSelected = isCustomMode ? opt.value === '__custom__' : opt.value === (value || '');
            const isHighlighted = idx === highlightedIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelectOption(opt.value)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  background: isSelected
                    ? 'rgba(59,130,246,0.18)'
                    : isHighlighted
                    ? 'rgba(255,255,255,0.08)'
                    : 'transparent',
                  border: 'none',
                  color: isSelected ? '#93c5fd' : 'var(--text-primary)',
                  fontSize: '0.78rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                  outline: isHighlighted ? '1px solid rgba(99,102,241,0.5)' : 'none'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {opt.icon || <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px dashed rgba(255,255,255,0.2)', display: 'inline-block', flexShrink: 0 }} />}
                  <span>{opt.label}</span>
                </span>
                {isSelected && <Check size={14} style={{ color: '#3b82f6', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}

      {isCustomMode && (
        <input
          type="text"
          value={STANDARD_PLATFORMS.includes(value) ? '' : (value || '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type custom medium (e.g. Discord, YouTube...)"
          className={inputClassName}
          style={{
            minHeight: '34px',
            padding: '0.3rem 0.5rem',
            fontSize: '0.78rem',
            width: '100%',
            borderColor: '#6366f1',
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.05)',
            color: 'var(--text-primary)',
            ...inputStyle
          }}
          autoFocus
        />
      )}
    </div>
  );
}

