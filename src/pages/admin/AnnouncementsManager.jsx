import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Megaphone, Trash2, Send, AlertTriangle, Image as ImageIcon, X, Pencil, ChevronDown, Download } from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import PhotoEditorModal from '../../components/PhotoEditorModal';
import { resolveMediaUrl } from '../../utils/mediaUtils';

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

  const handleDownload = async (imageUrl) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = imageUrl.split('/').pop().split('?')[0] || 'announcement_attachment.png';
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download image', err);
      window.open(imageUrl, '_blank');
    }
  };

  useEffect(() => {
    fetchAnnouncements();
    fetchOptions();
  }, []);

  // Handle click outside custom searchable select to close it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.batch-select-container')) {
        setBatchDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

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

  const addImages = useCallback((inputs) => {
    setMediaImages(prev => {
      const shaped = inputs.map(item =>
        typeof item === 'string' ? { url: item, editedUrl: undefined, caption: '' } : item
      );
      return [...prev, ...shaped].slice(0, 1); // Limit to 1 image for announcements
    });
  }, []);

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

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const readers = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(urls => {
      addImages(urls);
    });
    e.target.value = '';
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);

    let mediaUrlPayload = null;
    if (mediaImages.length > 0) {
      const img = mediaImages[0];
      mediaUrlPayload = img.editedUrl ?? img.url;
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
          image_url: mediaUrlPayload
        })
      });
      if (res.ok) {
        setFormData({ title: '', content: '', priority: 'normal', targetCourse: '', targetBatch: '' });
        setMediaImages([]);
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

            {/* Photo Upload Input Option */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Add Photo (Optional)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-glass"
                  onClick={() => document.getElementById('announcement-photo-upload').click()}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
                >
                  <ImageIcon size={18} /> Upload Image
                </button>
                <input
                  id="announcement-photo-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            {/* Render added photo grid (same style as community uploader) */}
            {mediaImages.length > 0 && (
              <div style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {mediaImages.map((imgObj, idx) => {
                    const displaySrc = imgObj.editedUrl ?? imgObj.url;
                    return (
                      <div
                        key={idx}
                        style={{
                          position: 'relative',
                          width: '100px',
                          height: '100px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid var(--glass-border)'
                        }}
                      >
                        <img src={displaySrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                            cursor: 'pointer'
                          }}
                          title="Remove image"
                        >
                          <X size={12} />
                        </button>
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
                            cursor: 'pointer'
                          }}
                          title="Edit image"
                        >
                          <Pencil size={12} />
                        </button>
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
                {a.image_url && (
                  <div 
                    onClick={() => setLightbox(resolveMediaUrl(a.image_url))}
                    style={{ 
                      marginBottom: '1rem', 
                      borderRadius: '8px', 
                      overflow: 'hidden', 
                      maxHeight: '220px',
                      border: '1px solid var(--glass-border)',
                      background: 'rgba(0,0,0,0.1)',
                      cursor: 'zoom-in',
                      transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                    onMouseLeave={e => e.currentTarget.style.opacity = 1}
                  >
                    <img src={resolveMediaUrl(a.image_url)} alt="attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span>By {a.admin_name}</span>
                  <span>{new Date(a.created_at).toLocaleString()}</span>
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
      {lightbox && createPortal(
        <div
          className="lb-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
        >
          {/* Top bar */}
          <div 
            className="lb-topbar"
            onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem', width: '100%', boxSizing: 'border-box' }}
          >
            <button 
              className="lb-close" 
              onClick={() => handleDownload(lightbox)} 
              title="Download Image"
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

          {/* Main image area */}
          <div 
            className="lb-main"
            onClick={e => { if (e.target === e.currentTarget) setLightbox(null); }}
            style={{
              position: 'relative',
              width: '100%', 
              flex: 1,
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              overflow: 'hidden',
              padding: '3.5rem 4rem',
              boxSizing: 'border-box'
            }}
          >
            <img
              className="lb-img"
              src={lightbox}
              alt="Full view notice attachment"
              style={{
                maxWidth: '90%',
                maxHeight: '85vh',
                objectFit: 'contain',
                borderRadius: '10px',
                boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
                animation: 'lb-img-in 0.25s ease',
                userSelect: 'none'
              }}
            />
          </div>
        </div>,
        document.body
      )}

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
      `}</style>
    </div>
  );
}
