import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Edit3 } from 'lucide-react';

export const STANDARD_PLATFORMS = [
  'Zoom',
  'Google Meet',
  'Microsoft Teams',
  'In-Person Studio'
];

/**
 * Official vector brand icons for standard mediums.
 * Strict standard: Uses real official branding assets, zero generic emojis.
 */
export const ZoomOfficialIcon = ({ size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }} aria-label="Zoom">
    <rect width="24" height="24" rx="5.5" fill="#2D8CFF" />
    <path d="M4.5 9.2C4.5 7.98 5.48 7 6.7 7H12.3C13.52 7 14.5 7.98 14.5 9.2V14.8C14.5 16.02 13.52 17 12.3 17H6.7C5.48 17 4.5 16.02 4.5 14.8V9.2Z" fill="white" />
    <path d="M15.5 10.38L19.2 7.7C19.38 7.57 19.5 7.69 19.5 7.91V16.09C19.5 16.31 19.38 16.43 19.2 16.3L15.5 13.62V10.38Z" fill="white" />
  </svg>
);

export const GoogleMeetOfficialIcon = ({ size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }} aria-label="Google Meet">
    <path d="M14 12L17.5 9.5V14.5L14 12Z" fill="#EA4335" />
    <path d="M17.5 9.5L14 12V7C14 6.45 13.55 6 13 6H6V9.5L17.5 9.5Z" fill="#00832D" />
    <path d="M14 12L17.5 14.5L14 17V12Z" fill="#2684FC" />
    <path d="M6 14.5V17C6 17.55 6.45 18 7 18H13C13.55 18 14 17.55 14 17V14.5L6 14.5Z" fill="#00AC47" />
    <path d="M6 9.5H14V14.5H6V9.5Z" fill="#0066DA" />
    <path d="M3.5 10.5C3.5 9.4 4.4 8.5 5.5 8.5H6V15.5H5.5C4.4 15.5 3.5 14.6 3.5 13.5V10.5Z" fill="#FFBA00" />
  </svg>
);

export const TeamsOfficialIcon = ({ size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }} aria-label="Microsoft Teams">
    <rect width="24" height="24" rx="5.5" fill="#464EB8" />
    <circle cx="15.5" cy="8.5" r="2" fill="#7B83EB" />
    <path d="M13.5 12C13.5 11.45 13.95 11 14.5 11H17.5C18.05 11 18.5 11.45 18.5 12V14.5C18.5 15.05 18.05 15.5 17.5 15.5H14.5C13.95 15.5 13.5 15.05 13.5 14.5V12Z" fill="#7B83EB" />
    <circle cx="9.5" cy="8.5" r="2.5" fill="#FFFFFF" />
    <rect x="5.5" y="12" width="8" height="6" rx="2" fill="#5059C9" />
    <path d="M10 13.5H8.5V12.5H11.5V13.5H10V16.5H9V13.5H10Z" fill="white" />
  </svg>
);

export const StudioOfficialIcon = ({ size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }} aria-label="In-Person Studio">
    <rect width="24" height="24" rx="5.5" fill="#1E293B" stroke="#475569" strokeWidth="1" />
    <path d="M6 18V7C6 6.45 6.45 6 7 6H17C17.55 6 18 6.45 18 7V18H6Z" stroke="#94A3B8" strokeWidth="1.5" />
    <path d="M9 9H11M13 9H15M9 12H11M13 12H15" stroke="#E2E8F0" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="10" y="14" width="4" height="4" fill="#60A5FA" rx="0.5" />
  </svg>
);

export function getPlatformIcon(platform, size = 16) {
  if (!platform) return null;
  const p = String(platform).trim().toLowerCase();
  if (p === 'zoom') return <ZoomOfficialIcon size={size} />;
  if (p === 'google meet' || p === 'meet') return <GoogleMeetOfficialIcon size={size} />;
  if (p === 'microsoft teams' || p === 'teams') return <TeamsOfficialIcon size={size} />;
  if (p === 'in-person studio' || p === 'studio' || p === 'offline') return <StudioOfficialIcon size={size} />;
  return null;
}

const PLATFORM_OPTIONS = [
  { value: '', label: 'Medium: Not Set', icon: null },
  { value: 'Zoom', label: 'Zoom', icon: <ZoomOfficialIcon size={16} /> },
  { value: 'Google Meet', label: 'Google Meet', icon: <GoogleMeetOfficialIcon size={16} /> },
  { value: 'Microsoft Teams', label: 'Microsoft Teams', icon: <TeamsOfficialIcon size={16} /> },
  { value: 'In-Person Studio', label: 'In-Person Studio', icon: <StudioOfficialIcon size={16} /> },
  { value: '__custom__', label: 'Custom / Other Medium...', icon: <Edit3 size={15} style={{ color: '#818cf8' }} /> }
];

/**
 * Reusable Class / Routine Platform & Medium Selector with Official Brand Logos.
 * Offers standard video conference & studio options (Zoom, Google Meet, Teams, In-Person Studio)
 * and an inline custom option allowing administrators to enter any custom app or medium.
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
  const containerRef = useRef(null);

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
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%', minWidth: 0, position: 'relative' }}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
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
            zIndex: 9999,
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
          {PLATFORM_OPTIONS.map((opt) => {
            const isSelected = isCustomMode ? opt.value === '__custom__' : opt.value === (value || '');
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelectOption(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent',
                  border: 'none',
                  color: isSelected ? '#93c5fd' : 'var(--text-primary)',
                  fontSize: '0.78rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
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
