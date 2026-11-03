import React, { useState, useEffect } from 'react';

export const STANDARD_PLATFORMS = [
  'Zoom',
  'Google Meet',
  'Microsoft Teams',
  'In-Person Studio'
];

/**
 * Reusable Class / Routine Platform & Medium Selector.
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

  useEffect(() => {
    if (value && !STANDARD_PLATFORMS.includes(value)) {
      setIsCustomMode(true);
    }
  }, [value]);

  const selectValue = isCustomMode ? '__custom__' : (value || '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%', minWidth: 0 }}>
      <select
        value={selectValue}
        onChange={(e) => {
          const val = e.target.value;
          if (val === '__custom__') {
            setIsCustomMode(true);
            if (STANDARD_PLATFORMS.includes(value)) {
              onChange('');
            }
          } else {
            setIsCustomMode(false);
            onChange(val);
          }
        }}
        className={className}
        style={{ minHeight: '38px', padding: '0.35rem 0.4rem', fontSize: '0.78rem', width: '100%', ...selectStyle }}
        title={title}
      >
        <option value="">Medium: Not Set</option>
        <option value="Zoom">🎥 Zoom</option>
        <option value="Google Meet">📹 Google Meet</option>
        <option value="Microsoft Teams">💼 Microsoft Teams</option>
        <option value="In-Person Studio">🏢 In-Person Studio</option>
        <option value="__custom__">✏️ Custom / Other Medium...</option>
      </select>

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
            ...inputStyle
          }}
          autoFocus
        />
      )}
    </div>
  );
}
