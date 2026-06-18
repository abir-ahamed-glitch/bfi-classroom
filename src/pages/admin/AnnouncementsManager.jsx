import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { renderAsync } from 'docx-preview';
import { Megaphone, Trash2, Send, AlertTriangle, Image as ImageIcon, X, Pencil, ChevronDown, Download, Clock, FileText, File, Music, Video, Eye, Paperclip, Printer, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import PhotoEditorModal from '../../components/PhotoEditorModal';
import { resolveMediaUrl } from '../../utils/mediaUtils';

const parseAttachment = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch (e) {
      // ignore
    }
  }
  return {
    name: 'notice_image.png',
    type: 'image/png',
    url: value
  };
};

const FileIcon = ({ type, size = 22 }) => {
  if (!type) return <File size={size} />;
  if (type.startsWith('image/')) return <ImageIcon size={size} />;
  if (type.startsWith('video/')) return <Video size={size} />;
  if (type.startsWith('audio/')) return <Music size={size} />;
  if (type === 'application/pdf') return <FileText size={size} style={{ color: '#ef4444' }} />;
  if (type.includes('word') || type.includes('document')) return <FileText size={size} style={{ color: '#3b82f6' }} />;
  if (type.includes('excel') || type.includes('sheet')) return <FileText size={size} style={{ color: '#10b981' }} />;
  return <File size={size} />;
};

const dataURLtoBlob = (dataurl) => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

function DocxRenderer({ url, name, handleDownload, onClose }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scale, setScale] = useState(1.0);

  const handleWrapperClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  useEffect(() => {
    let active = true;
    const loadDocx = async () => {
      try {
        setLoading(true);
        setError(null);
        
        let blob;
        if (url.startsWith('data:')) {
          blob = dataURLtoBlob(url);
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          blob = await response.blob();
        }
        
        if (!active) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          await renderAsync(blob, containerRef.current, null, {
            className: 'docx-preview',
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: false,
            ignorePadding: false,
            experimental: true
          });
        }
        setLoading(false);
      } catch (err) {
        console.error('Error rendering docx:', err);
        if (active) {
          setError(err.message || 'Error loading document');
          setLoading(false);
        }
      }
    };

    loadDocx();
    return () => {
      active = false;
    };
  }, [url]);

  const handlePrint = () => {
    if (!containerRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const content = containerRef.current.innerHTML;
    let stylesHtml = '';
    for (const sheet of document.styleSheets) {
      try {
        let rulesHtml = '';
        for (const rule of sheet.cssRules) {
          if (rule.type === CSSRule.FONT_FACE_RULE || rule.cssText.startsWith('@font-face')) {
            rulesHtml += rule.cssText;
          } else if (rule.cssText && (rule.cssText.includes('docx') || rule.cssText.includes('docx-preview'))) {
            rulesHtml += rule.cssText;
          }
        }
        if (rulesHtml) {
          stylesHtml += `<style>${rulesHtml}</style>`;
        }
      } catch (e) {
        if (sheet.href && (sheet.href.includes('fonts.googleapis.com') || sheet.href.includes('docx-preview'))) {
          stylesHtml += `<link rel="stylesheet" href="${sheet.href}">`;
        }
      }
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>${name}</title>
          ${stylesHtml}
          <style>
            @page { size: auto; margin: 0; }
            html, body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; }
            .docx-print-wrapper { margin: 0 !important; padding: 0 !important; }
            section.docx, section.docx-preview {
              box-shadow: none !important;
              border: none !important;
              background: #fff !important;
              color: #000 !important;
              margin: 0 auto !important;
              position: relative !important;
              page-break-inside: avoid;
              min-height: auto !important;
            }
            .docx-wrapper {
              padding: 0 !important;
              margin: 0 !important;
              background: #fff !important;
            }
            section.docx:not(:last-child), section.docx-preview:not(:last-child) {
              page-break-after: always;
            }
          </style>
        </head>
        <body>
          <div class="docx-print-wrapper">${content}</div>
          <script>
            window.addEventListener('DOMContentLoaded', () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 500);
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const zoomIn = () => setScale(prev => Math.min(prev + 0.1, 2.0));
  const zoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5));
  const resetZoom = () => setScale(1.0);

  return (
    <div 
      onClick={handleWrapperClick}
      style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      {loading && (
        <div style={{ padding: '2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="loader-spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderLeftColor: '#60a5fa', animation: 'spin 1s linear infinite' }}></div>
          <span>Loading document preview...</span>
        </div>
      )}
      
      {!loading && !error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '0.5rem 1rem',
          background: 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(8px)',
          borderRadius: '30px',
          border: '1px solid rgba(255,255,255,0.1)',
          marginBottom: '1rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          color: '#fff',
          zIndex: 10
        }}>
          <button 
            onClick={zoomOut}
            title="Zoom Out"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <ZoomOut size={18} />
          </button>
          
          <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '45px', textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          
          <button 
            onClick={zoomIn}
            title="Zoom In"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <ZoomIn size={18} />
          </button>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

          <button 
            onClick={resetZoom}
            title="Reset Zoom"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <RotateCcw size={16} />
          </button>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

          <button 
            onClick={handlePrint}
            title="Print Document"
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
          >
            <Printer size={18} />
          </button>
        </div>
      )}

      {error && (
        <div style={{
          background: 'var(--bg-secondary, #0e2238)',
          padding: '3rem 2.5rem',
          borderRadius: '16px',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          width: '450px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '20px',
            background: 'rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary, #60a5fa)',
            border: '1px solid var(--glass-border)'
          }}>
            <FileText size={42} />
          </div>
          <div>
            <h3 style={{ color: '#fff', fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 600 }}>{name}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              This document could not be previewed directly.
            </p>
          </div>
          <button
            onClick={() => handleDownload(url, name)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              background: 'var(--accent-primary, #60a5fa)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'none'}
          >
            <Download size={18} /> Download file to view
          </button>
        </div>
      )}
      <style>{`
        .docx-scroll-wrapper section.docx,
        .docx-scroll-wrapper section.docx-preview {
          background: #fff !important;
          color: #000 !important;
          box-shadow: 0 24px 80px rgba(0,0,0,0.6) !important;
          border: 1px solid rgba(0,0,0,0.15) !important;
          border-radius: 4px !important;
          margin: 0 auto 2rem auto !important;
          box-sizing: border-box !important;
          position: relative !important;
        }
      `}</style>
      <div 
        onClick={handleWrapperClick}
        className="docx-scroll-wrapper"
        style={{
          width: '100%',
          maxHeight: '88vh',
          overflowY: 'auto',
          display: loading || error ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.5rem 1rem 1rem 1rem',
          boxSizing: 'border-box'
        }}
      >
        <div 
          ref={containerRef} 
          style={{ 
            width: '100%', 
            maxWidth: '820px', 
            background: 'transparent', 
            color: '#000', 
            boxSizing: 'border-box',
            textAlign: 'left',
            zoom: scale
          }} 
        />
      </div>
    </div>
  );
}

function LightboxContent({ attachment, handleDownload, onClose }) {
  const { type, url, name } = attachment;

  const isWordDoc = type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                    type === 'application/msword' || 
                    (name && (name.endsWith('.docx') || name.endsWith('.doc')));

  if (isWordDoc) {
    return <DocxRenderer url={resolveMediaUrl(url)} name={name} handleDownload={handleDownload} onClose={onClose} />;
  }

  if (type.startsWith('image/')) {
    return (
      <img
        className="lb-img"
        src={resolveMediaUrl(url)}
        alt={name}
        style={{
          maxWidth: '90%',
          maxHeight: '80vh',
          objectFit: 'contain',
          borderRadius: '10px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          animation: 'lb-img-in 0.25s ease',
          userSelect: 'none'
        }}
      />
    );
  }

  if (type === 'application/pdf') {
    return (
      <iframe
        src={resolveMediaUrl(url)}
        title={name}
        style={{
          width: '85%',
          height: '80vh',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          backgroundColor: '#323639'
        }}
      />
    );
  }

  if (type.startsWith('video/')) {
    return (
      <video
        src={resolveMediaUrl(url)}
        controls
        autoPlay
        style={{
          maxWidth: '85%',
          maxHeight: '80vh',
          borderRadius: '8px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)'
        }}
      />
    );
  }

  if (type.startsWith('audio/')) {
    return (
      <div style={{
        background: 'var(--bg-secondary, #0e2238)',
        padding: '2.5rem',
        borderRadius: '16px',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        width: '400px',
        textAlign: 'center'
      }}>
        <div style={{ color: 'var(--accent-primary, #60a5fa)' }}>
          <Music size={48} />
        </div>
        <div style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 600 }}>{name}</div>
        <audio src={resolveMediaUrl(url)} controls autoPlay style={{ width: '100%' }} />
      </div>
    );
  }

  if (type === 'text/plain' || type.startsWith('text/')) {
    let textStr = '';
    const fileUrl = resolveMediaUrl(url);
    if (fileUrl.startsWith('data:')) {
      try {
        const base64Str = fileUrl.split(',')[1];
        textStr = atob(base64Str);
      } catch (e) {
        textStr = 'Unable to decode text file.';
      }
    } else {
      textStr = 'Loading file content...';
    }

    return (
      <div style={{
        width: '80%',
        maxHeight: '80vh',
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid var(--glass-border)',
        borderRadius: '12px',
        padding: '2rem',
        overflowY: 'auto',
        color: '#f8fafc',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        fontSize: '0.95rem',
        textAlign: 'left',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        lineHeight: 1.5
      }}>
        {textStr}
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary, #0e2238)',
      padding: '3rem 2.5rem',
      borderRadius: '16px',
      border: '1px solid var(--glass-border)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1.5rem',
      width: '450px',
      textAlign: 'center'
    }}>
      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '20px',
        background: 'rgba(255,255,255,0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--accent-primary, #60a5fa)',
        border: '1px solid var(--glass-border)'
      }}>
        <FileText size={42} />
      </div>
      <div>
        <h3 style={{ color: '#fff', fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 600 }}>{name}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
          This file type ({type || 'Unknown'}) cannot be previewed directly.
        </p>
      </div>
      <button
        onClick={() => handleDownload(resolveMediaUrl(url), name)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem',
          background: 'var(--accent-primary, #60a5fa)',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
        onMouseLeave={e => e.currentTarget.style.filter = 'none'}
      >
        <Download size={18} /> Download file to view
      </button>
    </div>
  );
}

export default function AnnouncementsManager() {
  const [announcements, setAnnouncements] = useState([]);
  const [courseOptions, setCourseOptions] = useState([]);
  const [courseBatchesMap, setCourseBatchesMap] = useState({});
  const [loading, setLoading] = useState(false);
  const { showAlert, showConfirm } = useModal();
  
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'normal',
    targetCourse: '',
    targetBatch: ''
  });

  // Scheduling states
  const [scheduledAt, setScheduledAt] = useState(null);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerDay, setPickerDay] = useState(new Date().getDate());
  const [pickerHour, setPickerHour] = useState(12);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerPeriod, setPickerPeriod] = useState('PM');

  // Photo uploading states
  const [mediaImages, setMediaImages] = useState([]);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [photoEditorIndex, setPhotoEditorIndex] = useState(0);

  // Searchable custom batch select states
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [batchDropdownOpen, setBatchDropdownOpen] = useState(false);

  // Lightbox view states
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox]);

  const handleDownload = async (imageUrl, customFilename) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = customFilename || imageUrl.split('/').pop().split('?')[0] || 'announcement_attachment.png';
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file', err);
      window.open(imageUrl, '_blank');
    }
  };

  useEffect(() => {
    fetchAnnouncements();
    fetchOptions();
  }, []);

  // Handle click outside custom searchable select and schedule select to close them
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.batch-select-container')) {
        setBatchDropdownOpen(false);
      }
      if (!e.target.closest('.schedule-select-container')) {
        setShowSchedulePicker(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const handleScheduleClick = () => {
    const isOpen = !showSchedulePicker;
    setShowSchedulePicker(isOpen);
    
    if (isOpen) {
      const sourceDate = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 60 * 60000);
      setPickerYear(sourceDate.getFullYear());
      setPickerMonth(sourceDate.getMonth());
      setPickerDay(sourceDate.getDate());
      
      let hr = sourceDate.getHours();
      const prd = hr >= 12 ? 'PM' : 'AM';
      hr = hr % 12;
      hr = hr === 0 ? 12 : hr;
      setPickerHour(hr);
      setPickerMinute(sourceDate.getMinutes());
      setPickerPeriod(prd);
    }
  };

  const renderCalendarDays = () => {
    const cells = [];
    const daysInMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
    const firstDayIndex = new Date(pickerYear, pickerMonth, 1).getDay();

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`empty-${i}`} className="calendar-day-empty"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const isSelected = pickerDay === day;
      const isToday = new Date().getDate() === day && new Date().getMonth() === pickerMonth && new Date().getFullYear() === pickerYear;
      
      cells.push(
        <button
          key={`day-${day}`}
          type="button"
          className={`calendar-day-btn ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
          onClick={() => setPickerDay(day)}
        >
          {day}
        </button>
      );
    }
    return cells;
  };

  const handlePrevMonth = () => {
    setPickerMonth(prev => {
      if (prev === 0) {
        setPickerYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setPickerMonth(prev => {
      if (prev === 11) {
        setPickerYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const handleConfirmSchedule = () => {
    let hours24 = pickerHour;
    if (pickerPeriod === 'PM' && hours24 < 12) hours24 += 12;
    if (pickerPeriod === 'AM' && hours24 === 12) hours24 = 0;
    
    const localDate = new Date(pickerYear, pickerMonth, pickerDay, hours24, pickerMinute, 0);
    
    if (localDate <= new Date()) {
      showAlert('Please select a future date and time.', { title: 'Invalid Time' });
      return;
    }
    
    setScheduledAt(localDate.toISOString());
    setShowSchedulePicker(false);
  };

  const fetchOptions = async () => {
    if (window.location.hostname.includes('github.io')) {
      setCourseOptions(['Online Filmmaking Course', 'Film Appreciation Course']);
      setCourseBatchesMap({
        'Online Filmmaking Course': ['75', '76'],
        'Film Appreciation Course': ['2023', '2024']
      });
      return;
    }
    try {
      const res = await fetch('/api/admin/targeting-options?_t=' + Date.now(), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        
        const sortBatches = (a, b) => {
          const numA = parseInt(a, 10);
          const numB = parseInt(b, 10);
          if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
          return String(a).localeCompare(String(b));
        };
        
        const sortedCourseBatches = {};
        if (data.courseBatches) {
          for (const course in data.courseBatches) {
            sortedCourseBatches[course] = [...data.courseBatches[course]].sort(sortBatches);
          }
        }

        setCourseOptions(data.courses || []);
        setCourseBatchesMap(sortedCourseBatches);
      }
    } catch (err) {
      console.error('Fetch targeting options error', err);
    }
  };

  const fetchAnnouncements = async () => {
    if (window.location.hostname.includes('github.io')) {
      setAnnouncements([
        { id: 1, title: 'Welcome to the BFI Classroom Demo', content: 'You are currently viewing the static preview. Since GitHub Pages is a static host, we have enabled "Demo Mode" with mocked data so you can explore the interface.', priority: 'high', admin_name: 'Admin', created_at: new Date() },
        { id: 2, title: 'Summer Batch Admissions Open', content: 'Admissions are now open for the 76th Batch of Online Filmmaking.', priority: 'normal', admin_name: 'Admin', created_at: new Date(Date.now() - 86400000) }
      ]);
      return;
    }
    try {
      const res = await fetch('/api/admin/announcements', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements || []);
      }
    } catch (err) {
      console.error('Fetch announcements error', err);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const readers = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({
        url: reader.result,
        name: file.name,
        type: file.type
      });
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(items => {
      setMediaImages(prev => {
        const shaped = items.map(item => ({
          url: item.url,
          name: item.name,
          type: item.type,
          editedUrl: undefined,
          caption: ''
        }));
        return [...prev, ...shaped].slice(0, 1); // Limit to 1 attachment
      });
    });
    e.target.value = '';
  };

  const removeImage = useCallback((index) => {
    setMediaImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const openPhotoEditor = useCallback((index) => {
    setPhotoEditorIndex(index);
    setPhotoEditorOpen(true);
  }, []);

  const handlePhotoEditorSave = useCallback((updatedImages) => {
    setMediaImages(updatedImages);
    setPhotoEditorOpen(false);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);

    let mediaUrlPayload = null;
    if (mediaImages.length > 0) {
      const img = mediaImages[0];
      mediaUrlPayload = JSON.stringify({
        name: img.name,
        type: img.type,
        url: img.editedUrl ?? img.url
      });
    }

    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...formData,
          image_url: mediaUrlPayload,
          scheduled_at: scheduledAt
        })
      });
      if (res.ok) {
        setFormData({ title: '', content: '', priority: 'normal', targetCourse: '', targetBatch: '' });
        setMediaImages([]);
        setScheduledAt(null);
        setShowSchedulePicker(false);
        fetchAnnouncements();
      } else {
        const data = await res.json();
        await showAlert(data.error, { title: 'Error' });
      }
    } catch (err) {
      console.error('Create error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await showConfirm('Delete this announcement?', { title: 'Delete Announcement', confirmLabel: 'Delete' });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) fetchAnnouncements();
    } catch (err) {
      console.error('Delete error', err);
    }
  };

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Announcements</h1>
        <p className="subtitle">Broadcast important news and alerts to all students.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
        <div className="glass-panel" style={{ padding: '2rem', alignSelf: 'start' }}>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Megaphone className="text-accent" /> New Broadcast
          </h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Title</label>
              <input type="text" className="input-glass" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Message Content</label>
              <textarea className="input-glass" required rows="4" value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} style={{ resize: 'vertical' }} />
            </div>

            {/* File Upload Input Option */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Add Attachment (Optional)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-glass"
                  onClick={() => document.getElementById('announcement-file-upload').click()}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
                >
                  <Paperclip size={18} /> Upload File
                </button>
                <input
                  id="announcement-file-upload"
                  type="file"
                  accept="*/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            {/* Render added attachment */}
            {mediaImages.length > 0 && (
              <div style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {mediaImages.map((imgObj, idx) => {
                    const displaySrc = imgObj.editedUrl ?? imgObj.url;
                    const isImage = imgObj.type?.startsWith('image/');
                    return (
                      <div
                        key={idx}
                        style={{
                          position: 'relative',
                          width: '130px',
                          height: '130px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid var(--glass-border)',
                          background: 'rgba(255,255,255,0.03)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '10px'
                        }}
                      >
                        {isImage ? (
                          <img src={displaySrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', textAlign: 'center', width: '100%', minWidth: 0 }}>
                            <div style={{ color: 'var(--accent-primary, #60a5fa)' }}>
                              <FileIcon type={imgObj.type} size={28} />
                            </div>
                            <span 
                              style={{ 
                                fontSize: '0.72rem', 
                                color: 'var(--text-secondary)', 
                                wordBreak: 'break-all', 
                                display: '-webkit-box', 
                                WebkitLineClamp: 2, 
                                WebkitBoxOrient: 'vertical', 
                                overflow: 'hidden', 
                                lineHeight: '1.2',
                                padding: '0 4px'
                              }} 
                              title={imgObj.name}
                            >
                              {imgObj.name}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeImage(idx)}
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: 'rgba(0,0,0,0.6)',
                            border: 'none',
                            borderRadius: '50%',
                            color: '#fff',
                            width: '22px',
                            height: '22px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            zIndex: 10
                          }}
                          title="Remove attachment"
                        >
                          <X size={12} />
                        </button>
                        {isImage && (
                          <button
                            type="button"
                            onClick={() => openPhotoEditor(idx)}
                            style={{
                              position: 'absolute',
                              bottom: '4px',
                              right: '4px',
                              background: 'rgba(0,0,0,0.6)',
                              border: 'none',
                              borderRadius: '50%',
                              color: '#fff',
                              width: '22px',
                              height: '22px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              zIndex: 10
                            }}
                            title="Edit image"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {photoEditorOpen && (
              <PhotoEditorModal
                images={mediaImages}
                initialIndex={photoEditorIndex}
                onSave={handlePhotoEditorSave}
                onClose={() => setPhotoEditorOpen(false)}
              />
            )}

            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Priority</label>
              <select className="input-glass" value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})}>
                <option value="low">Low (Info)</option>
                <option value="normal">Normal (Standard Alert)</option>
                <option value="high">High (Urgent Warning)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Target Course (Optional)</label>
                <select className="input-glass" value={formData.targetCourse} onChange={e => setFormData({...formData, targetCourse: e.target.value, targetBatch: ''})}>
                  <option value="">All Courses (Global)</option>
                  {courseOptions.map((c, i) => <option key={i} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Custom Searchable Select for Target Batch */}
              <div className="batch-select-container" style={{ flex: '1 1 200px', minWidth: 0, position: 'relative' }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Target Batch (Optional)</label>
                
                {/* Trigger Button */}
                <div 
                  className={`input-glass ${!formData.targetCourse ? 'disabled' : ''}`}
                  onClick={() => {
                    if (formData.targetCourse) {
                      setBatchDropdownOpen(!batchDropdownOpen);
                      setBatchSearchQuery('');
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: !formData.targetCourse ? 'not-allowed' : 'pointer',
                    opacity: !formData.targetCourse ? 0.6 : 1,
                    height: '42px',
                    padding: '0 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--glass-border)'
                  }}
                >
                  <span style={{ fontSize: '0.95rem' }}>
                    {formData.targetBatch ? `Batch ${formData.targetBatch}` : 'All Batches'}
                  </span>
                  <ChevronDown size={18} style={{ transform: batchDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-muted)' }} />
                </div>

                {/* Dropdown Menu */}
                {batchDropdownOpen && formData.targetCourse && (
                  <div 
                    className="glass-panel"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      maxHeight: '260px',
                      overflowY: 'auto',
                      zIndex: 1000,
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
                      background: 'var(--bg-primary, #07172d)',
                      border: '1px solid var(--glass-border)'
                    }}
                  >
                    {/* Horizontal Search Bar */}
                    <input
                      type="text"
                      className="input-glass"
                      placeholder="Search batch..."
                      value={batchSearchQuery}
                      onChange={e => setBatchSearchQuery(e.target.value)}
                      onClick={e => e.stopPropagation()} // Prevent dropdown close when typing in search bar
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.9rem',
                        marginBottom: '6px',
                        height: '34px',
                        width: '100%',
                        borderRadius: '6px',
                        border: '1px solid var(--glass-border)'
                      }}
                      autoFocus
                    />
                    
                    {/* Options List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto', maxHeight: '160px' }}>
                      {/* "All Batches" option */}
                      {('all batches'.includes(batchSearchQuery.toLowerCase())) && (
                        <div
                          className="batch-option"
                          onClick={() => {
                            setFormData({ ...formData, targetBatch: '' });
                            setBatchDropdownOpen(false);
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '0.9rem',
                            background: formData.targetBatch === '' ? 'rgba(96,165,250,0.15)' : 'transparent',
                            color: formData.targetBatch === '' ? 'var(--accent-primary, #60a5fa)' : 'var(--text-primary)'
                          }}
                        >
                          All Batches
                        </div>
                      )}
                      
                      {/* Dynamic filtered batch options */}
                      {courseBatchesMap[formData.targetCourse] && 
                        courseBatchesMap[formData.targetCourse]
                          .filter(b => b.toLowerCase().includes(batchSearchQuery.toLowerCase()))
                          .map((b, i) => (
                            <div
                              key={i}
                              className="batch-option"
                              onClick={() => {
                                setFormData({ ...formData, targetBatch: b });
                                setBatchDropdownOpen(false);
                              }}
                              style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                borderRadius: '6px',
                                fontSize: '0.9rem',
                                background: formData.targetBatch === b ? 'rgba(96,165,250,0.15)' : 'transparent',
                                color: formData.targetBatch === b ? 'var(--accent-primary, #60a5fa)' : 'var(--text-primary)'
                              }}
                            >
                              Batch {b}
                            </div>
                          ))}

                      {/* No results notice */}
                      {courseBatchesMap[formData.targetCourse] && 
                        courseBatchesMap[formData.targetCourse].filter(b => b.toLowerCase().includes(batchSearchQuery.toLowerCase())).length === 0 && 
                        !('all batches'.includes(batchSearchQuery.toLowerCase())) && (
                          <div style={{ padding: '8px 10px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                            No batches found
                          </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Announcement Schedule Picker */}
            <div className="schedule-select-container" style={{ position: 'relative', marginTop: '0.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Publish Schedule (Optional)</label>
              <button 
                type="button"
                className={`btn btn-glass ${scheduledAt ? 'scheduled-active' : ''}`}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}
                onClick={handleScheduleClick}
              >
                <Clock size={16} /> {scheduledAt ? `Scheduled: ${new Date(scheduledAt).toLocaleString()}` : 'Schedule Broadcast'}
              </button>

              {showSchedulePicker && (
                <div className="bfi-community-dropdown schedule-dropdown animate-fade-in" style={{ width: '280px', padding: '1rem', right: 0, left: 'auto', bottom: 'calc(100% + 8px)', top: 'auto', zIndex: 1001 }}>
                  <div className="dropdown-header" style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', fontWeight: 600, color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', padding: '0 0 0.5rem' }}>
                    <span>Schedule Broadcast</span>
                    <button 
                      type="button" 
                      onClick={() => setShowSchedulePicker(false)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}
                    >
                      &times;
                    </button>
                  </div>
                  
                  {/* Calendar Month Selector */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <button 
                      type="button" 
                      onClick={(e) => { e.stopPropagation(); handlePrevMonth(); }}
                      className="btn btn-glass"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto', minWidth: 'auto' }}
                    >
                      &larr;
                    </button>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {[
                        "January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"
                      ][pickerMonth]} {pickerYear}
                    </span>
                    <button 
                      type="button" 
                      onClick={(e) => { e.stopPropagation(); handleNextMonth(); }}
                      className="btn btn-glass"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto', minWidth: 'auto' }}
                    >
                      &rarr;
                    </button>
                  </div>

                  {/* Calendar Weekday Names */}
                  <div className="calendar-grid" style={{ marginBottom: '0.25rem' }}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                      <div key={day} className="calendar-weekday">{day}</div>
                    ))}
                  </div>

                  {/* Calendar Day Buttons */}
                  <div className="calendar-grid" style={{ marginBottom: '0.75rem' }}>
                    {renderCalendarDays()}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', textAlign: 'center' }}>Time (Local Time)</label>
                    
                    {/* Time Select Boxes */}
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center' }}>
                      <select 
                        value={pickerHour} 
                        onChange={(e) => setPickerHour(parseInt(e.target.value))}
                        className="time-picker-select"
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <span style={{ color: 'var(--text-muted)' }}>:</span>
                      <select 
                        value={pickerMinute} 
                        onChange={(e) => setPickerMinute(parseInt(e.target.value))}
                        className="time-picker-select"
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        {Array.from({ length: 60 }, (_, i) => i).map(m => (
                          <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                        ))}
                      </select>
                      <select 
                        value={pickerPeriod} 
                        onChange={(e) => setPickerPeriod(e.target.value)}
                        className="time-picker-select"
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>

                    {/* Constructed Selected String */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.25rem', lineHeight: 1.4 }}>
                      Selected:<br />
                      <strong style={{ color: 'var(--text-main)' }}>
                        {[
                          "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
                        ][pickerMonth]} {pickerDay}, {pickerYear} @ {pickerHour}:{pickerMinute.toString().padStart(2, '0')} {pickerPeriod}
                      </strong>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      {scheduledAt && (
                        <button 
                          type="button"
                          className="btn btn-glass btn-sm" 
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => {
                            setScheduledAt(null);
                            setShowSchedulePicker(false);
                          }}
                        >
                          Clear
                        </button>
                      )}
                      <button 
                        type="button"
                        className="btn btn-primary btn-sm" 
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}
                        onClick={handleConfirmSchedule}
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '1rem' }}>
              <Send size={18} /> {loading ? 'Broadcasting...' : 'Send Announcement'}
            </button>
          </form>
        </div>

        <div>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle className="text-secondary" /> Recent Broadcasts
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {announcements.map(a => (
              <div key={a.id} className="glass-panel" style={{ padding: '1.5rem', position: 'relative', borderLeft: a.priority === 'high' ? '4px solid var(--danger)' : a.priority === 'normal' ? '4px solid var(--warning)' : '4px solid var(--success)' }}>
                <button onClick={() => handleDelete(a.id)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <Trash2 size={18} className="card-hover" />
                </button>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', marginRight: '2rem' }}>{a.title}</h3>
                {(a.target_course || a.target_batch) && (
                  <div style={{ marginBottom: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                    {a.target_course && <span style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>Course: {a.target_course}</span>}
                    {a.target_batch && <span style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>Batch: {a.target_batch}</span>}
                  </div>
                )}
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>{a.content}</p>
                
                {/* Broadcast Attachment Thumbnail */}
                {a.image_url && (() => {
                  const attachment = parseAttachment(a.image_url);
                  if (!attachment || !attachment.url) return null;
                  const isImage = attachment.type?.startsWith('image/');
                  if (isImage) {
                    return (
                      <div 
                        onClick={() => setLightbox(attachment)}
                        style={{ 
                          marginBottom: '1rem', 
                          borderRadius: '8px', 
                          overflow: 'hidden', 
                          maxHeight: '220px',
                          border: '1px solid var(--glass-border)',
                          background: 'rgba(0,0,0,0.1)',
                          cursor: 'zoom-in',
                          transition: 'opacity 0.2s',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center'
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                        onMouseLeave={e => e.currentTarget.style.opacity = 1}
                      >
                        <img src={resolveMediaUrl(attachment.url)} alt={attachment.name} style={{ maxWidth: '100%', maxHeight: '220px', objectFit: 'contain', display: 'block' }} />
                      </div>
                    );
                  } else {
                    return (
                      <div 
                        onClick={() => setLightbox(attachment)}
                        style={{ 
                          marginBottom: '1rem', 
                          borderRadius: '8px', 
                          border: '1px solid var(--glass-border)', 
                          background: 'rgba(255,255,255,0.03)',
                          padding: '0.75rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                          e.currentTarget.style.borderColor = 'var(--glass-border)';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                          <div style={{ 
                            width: '36px', 
                            height: '36px', 
                            borderRadius: '6px', 
                            background: 'rgba(255,255,255,0.05)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            color: 'var(--accent-primary, #60a5fa)',
                            flexShrink: 0
                          }}>
                            <FileIcon type={attachment.type} size={18} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              {attachment.name}
                            </p>
                            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                              {attachment.type.split('/')[1] || 'FILE'}
                            </p>
                          </div>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary, #60a5fa)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Eye size={12} /> Preview
                        </span>
                      </div>
                    );
                  }
                })()}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span>By {a.admin_name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {a.scheduled_at && new Date(a.scheduled_at) > new Date() && (
                      <span className="scheduled-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '1px 6px', fontSize: '0.7rem', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', borderRadius: '4px', fontWeight: '500', border: '1px solid rgba(234, 179, 8, 0.3)' }} title={`Scheduled for ${new Date(a.scheduled_at).toLocaleString()}`}>
                        <Clock size={10} /> Scheduled
                      </span>
                    )}
                    <span>{new Date(a.scheduled_at || a.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
            {announcements.length === 0 && (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active announcements found.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Lightbox Portal ── */}
      {lightbox && (() => {
        const attachment = typeof lightbox === 'string' ? { name: 'notice_image.png', type: 'image/png', url: lightbox } : lightbox;
        const isDoc = attachment.type === 'application/pdf' || 
                      attachment.type?.includes('word') || 
                      attachment.type?.includes('document') || 
                      (attachment.name && (attachment.name.endsWith('.docx') || attachment.name.endsWith('.doc') || attachment.name.endsWith('.pdf') || attachment.name.endsWith('.txt')));
        return createPortal(
          <div
            className="lb-backdrop"
            onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
          >
            {/* Top bar */}
            <div 
              className="lb-topbar"
              onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', width: '100%', boxSizing: 'border-box' }}
            >
              <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 600, marginLeft: '1rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                {attachment.name}
              </span>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  className="lb-close" 
                  onClick={() => handleDownload(resolveMediaUrl(attachment.url), attachment.name)} 
                  title="Download File"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    color: '#fff', 
                    borderRadius: '50%',
                    width: '36px', 
                    height: '36px',
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'background 0.18s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                >
                  <Download size={18} />
                </button>
                <button 
                  className="lb-close" 
                  onClick={() => setLightbox(null)} 
                  title="Close"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    color: '#fff', 
                    borderRadius: '50%',
                    width: '36px', 
                    height: '36px',
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'background 0.18s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(225,29,72,0.7)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Main image area */}
            <div 
              className="lb-main"
              onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
              style={{
                position: 'relative',
                width: '100%', 
                flex: 1,
                display: 'flex', 
                alignItems: isDoc ? 'flex-start' : 'center', 
                justifyContent: 'center',
                overflow: 'hidden',
                padding: isDoc ? '0 2rem 2rem 2rem' : '2rem',
                boxSizing: 'border-box'
              }}
            >
              <LightboxContent attachment={attachment} handleDownload={handleDownload} onClose={() => setLightbox(null)} />
            </div>
          </div>,
          document.body
        );
      })()}

      <style>{`
        .batch-option:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          color: var(--accent-primary, #60a5fa) !important;
        }
        [data-mode="light"] .batch-option:hover {
          background: rgba(0, 0, 0, 0.05) !important;
          color: var(--accent-primary, #2563eb) !important;
        }
        .lb-backdrop {
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(0,0,0,0.94);
          backdrop-filter: blur(8px);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          animation: lb-in 0.2s ease;
        }
        @keyframes lb-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lb-img-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }

        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
          margin-top: 0.5rem;
        }
        .calendar-weekday {
          font-size: 0.7rem;
          color: var(--text-muted);
          font-weight: 600;
          text-align: center;
          padding: 2px 0;
        }
        .calendar-day-empty {
          width: 28px;
          height: 28px;
        }
        .calendar-day-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-primary);
          font-size: 0.75rem;
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.2s ease;
          padding: 0;
        }
        .calendar-day-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        [data-mode="light"] .calendar-day-btn:hover {
          background: rgba(0, 0, 0, 0.05);
        }
        .calendar-day-btn.selected {
          background: var(--accent-primary) !important;
          color: #fff !important;
          font-weight: 600;
          box-shadow: 0 0 8px rgba(225, 29, 72, 0.4);
        }
        .calendar-day-btn.today {
          border: 1px solid var(--accent-primary);
        }
        .time-picker-select {
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          border: 1px solid var(--border-color);
          background: var(--bg-card);
          color: var(--text-main);
          font-size: 0.8rem;
          outline: none;
          cursor: pointer;
        }
        .btn-glass.scheduled-active {
          background: rgba(234, 179, 8, 0.1) !important;
          border-color: #eab308 !important;
          color: #eab308 !important;
        }
      `}</style>
    </div>
  );
}
