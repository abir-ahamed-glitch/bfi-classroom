import { useState, useEffect, useRef } from 'react';
import { Globe, GraduationCap, EyeOff, ChevronDown, Check } from 'lucide-react';
import './PrivacySelector.css';

const PRIVACY_OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can see this',
    Icon: Globe,
    colorClass: 'privacy-public'
  },
  {
    value: 'batchmates',
    label: 'Batchmates',
    description: 'Only your batchmates',
    Icon: GraduationCap,
    colorClass: 'privacy-batchmates'
  },
  {
    value: 'only_me',
    label: 'Only Me',
    description: 'Hidden from everyone',
    Icon: EyeOff,
    colorClass: 'privacy-onlyme'
  }
];

export default function PrivacySelector({ fieldName, currentValue = 'public', onChange, compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const ref = useRef(null);

  const current = PRIVACY_OPTIONS.find(o => o.value === currentValue) || PRIVACY_OPTIONS[0];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (option) => {
    if (option.value === currentValue) {
      setIsOpen(false);
      return;
    }
    setSaving(true);
    setIsOpen(false);

    try {
      const res = await fetch('/api/student/privacy', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ field_name: fieldName, visibility: option.value })
      });

      if (res.ok) {
        if (onChange) onChange(fieldName, option.value);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      }
    } catch (err) {
      console.error('Failed to save privacy setting:', err);
    } finally {
      setSaving(false);
    }
  };

  const CurrentIcon = current.Icon;

  return (
    <div className={`privacy-selector ${compact ? 'compact' : ''} ${isOpen ? 'open-dropdown' : ''}`} ref={ref}>
      <button
        type="button"
        className={`privacy-trigger ${current.colorClass} ${isOpen ? 'open' : ''} ${justSaved ? 'just-saved' : ''}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(!isOpen); }}
        title={`Visibility: ${current.label}`}
        disabled={saving}
      >
        {justSaved ? (
          <Check size={compact ? 12 : 14} className="privacy-check-icon" />
        ) : (
          <CurrentIcon size={compact ? 12 : 14} />
        )}
        {!compact && <span className="privacy-label">{current.label}</span>}
        {!compact && <ChevronDown size={12} className={`privacy-chevron ${isOpen ? 'flipped' : ''}`} />}
      </button>

      {isOpen && (
        <div className="privacy-dropdown" onClick={(e) => e.stopPropagation()}>
          {PRIVACY_OPTIONS.map(option => {
            const OptionIcon = option.Icon;
            const isSelected = option.value === currentValue;
            return (
              <button
                key={option.value}
                type="button"
                className={`privacy-option ${isSelected ? 'selected' : ''} ${option.colorClass}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(option); }}
              >
                <div className="privacy-option-icon">
                  <OptionIcon size={16} />
                </div>
                <div className="privacy-option-text">
                  <span className="privacy-option-label">{option.label}</span>
                  <span className="privacy-option-desc">{option.description}</span>
                </div>
                {isSelected && <Check size={14} className="privacy-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Lightweight inline version for Community post composer
export function AudienceSelector({ value = 'public', onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  const current = PRIVACY_OPTIONS.find(o => o.value === value) || PRIVACY_OPTIONS[0];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const CurrentIcon = current.Icon;

  return (
    <div className={`privacy-selector audience-selector ${isOpen ? 'open-dropdown' : ''}`} ref={ref}>
      <button
        type="button"
        className={`privacy-trigger ${current.colorClass} ${isOpen ? 'open' : ''}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(!isOpen); }}
        title={`Post audience: ${current.label}`}
      >
        <CurrentIcon size={14} />
        <span className="privacy-label">{current.label}</span>
        <ChevronDown size={12} className={`privacy-chevron ${isOpen ? 'flipped' : ''}`} />
      </button>

      {isOpen && (
        <div className="privacy-dropdown" onClick={(e) => e.stopPropagation()}>
          {PRIVACY_OPTIONS.map(option => {
            const OptionIcon = option.Icon;
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`privacy-option ${isSelected ? 'selected' : ''} ${option.colorClass}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(option.value); setIsOpen(false); }}
              >
                <div className="privacy-option-icon">
                  <OptionIcon size={16} />
                </div>
                <div className="privacy-option-text">
                  <span className="privacy-option-label">{option.label}</span>
                  <span className="privacy-option-desc">{option.description}</span>
                </div>
                {isSelected && <Check size={14} className="privacy-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
