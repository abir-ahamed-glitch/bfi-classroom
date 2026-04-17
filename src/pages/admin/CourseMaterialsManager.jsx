import { useState, useEffect, useRef } from 'react';
import {
  Upload, Plus, Pencil, Trash2, X, FileText, PlayCircle,
  BookOpen, Search, ChevronDown, CheckCircle,
  AlertCircle, Link as LinkIcon, File,
} from 'lucide-react';

const BATCH_OPTIONS = ['All', '85th', '84th', '83rd', '82nd', '81st', '80th'];
const COURSE_OPTIONS = [
  'History of World Cinema',
  'Film Language',
  'Film Aesthetics',
  'Aesthetics of Sound',
  'Music',
  'Cinematography',
  'Light',
  'Art Direction',
  'Acting',
  'Dress and Props',
  'Script',
  'Shot Division',
  'Documentary',
  'Film Criticism',
  'How to Read a Film',
  'Film Production Design',
];

const FILE_TYPE_ICONS = {
  pdf: <FileText size={22} style={{ color: '#ef4444' }} />,
  doc: <FileText size={22} style={{ color: '#3b82f6' }} />,
  docx: <FileText size={22} style={{ color: '#3b82f6' }} />,
  video: <PlayCircle size={22} style={{ color: '#f59e0b' }} />,
};
const getIcon = (type) => FILE_TYPE_ICONS[type?.toLowerCase()] || <File size={22} style={{ color: '#a1a1aa' }} />;

const emptyForm = {
  title: '',
  description: '',
  course_name: '',
  batch_number: '85th',
  is_downloadable: true,
  file_type_override: 'pdf',
  external_url: '',
};

/* ─── Reusable Custom Dropdown ─────────────────────────────────────────────── */
function CustomSelect({ value, onChange, options, placeholder = 'Select...', required = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = options.find(o => (o.value ?? o) === value);
  const label = selected ? (selected.label ?? selected) : null;

  return (
    <div ref={ref} style={{ position: 'relative', userSelect: 'none' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', borderRadius: '8px', cursor: 'pointer',
          background: 'rgba(0,0,0,0.2)',
          border: `1px solid ${open ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
          color: label ? 'white' : 'var(--text-muted)',
          transition: 'border-color 0.2s',
          boxShadow: open ? '0 0 0 2px rgba(225,29,72,0.2)' : 'none',
        }}
      >
        <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label || placeholder}
        </span>
        <ChevronDown size={15} style={{ flexShrink: 0, marginLeft: '0.5rem', color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
          background: '#18181f',
          border: '1px solid var(--glass-border)',
          borderRadius: '10px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          maxHeight: '240px', overflowY: 'auto',
          backdropFilter: 'blur(20px)',
          animation: 'fadeIn 0.15s ease',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent',
        }}>
          {options.map((opt) => {
            const optVal = opt.value ?? opt;
            const optLabel = opt.label ?? opt;
            const isActive = optVal === value;
            return (
              <div
                key={optVal}
                onClick={() => { onChange(optVal); setOpen(false); }}
                style={{
                  padding: '0.7rem 1rem', cursor: 'pointer', fontSize: '0.9rem',
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'rgba(225,29,72,0.08)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'white'; }}}
                onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}}
              >
                {optLabel}
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden native input for form validation */}
      {required && <input type="text" required value={value} onChange={() => {}} style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />}
    </div>
  );
}

export default function CourseMaterialsManager() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [uploadMode, setUploadMode] = useState('file');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [filterBatch, setFilterBatch] = useState('All');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const fileRef = useRef(null);

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const BATCH_OPTS = BATCH_OPTIONS.map(b => ({ value: b, label: b === 'All' ? 'All Batches' : `${b} Batch` }));
  const FILE_TYPE_OPTS = [
    { value: 'pdf', label: 'PDF' },
    { value: 'doc', label: 'DOC / DOCX' },
    { value: 'video', label: 'Video' },
    { value: 'file', label: 'Other' },
  ];

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchMaterials(); }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/courses/admin/all', { headers });
      if (res.ok) { const data = await res.json(); setMaterials(data.materials || []); }
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  };

  const openAdd = () => {
    setEditTarget(null); setForm(emptyForm); setFile(null); setUploadMode('file'); setModalOpen(true);
  };

  const openEdit = (mat) => {
    setEditTarget(mat);
    setForm({
      title: mat.title || '', description: mat.description || '',
      course_name: mat.course_name || '', batch_number: mat.batch_number || '85th',
      is_downloadable: mat.is_downloadable === 1, file_type_override: mat.file_type || 'pdf',
      external_url: mat.file_url?.startsWith('/media/') ? '' : (mat.file_url || ''),
    });
    setFile(null);
    setUploadMode(mat.file_url && !mat.file_url.startsWith('/media/') && mat.file_url !== '' ? 'url' : 'file');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditTarget(null); setFile(null); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('file', file);
      const url = editTarget ? `/api/courses/${editTarget.id}` : '/api/courses/upload';
      const method = editTarget ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (res.ok) { showToast(editTarget ? 'Material updated!' : 'Material uploaded!', 'success'); closeModal(); fetchMaterials(); }
      else { showToast(data.error || 'Operation failed', 'error'); }
    } catch { showToast('Network error', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/courses/${id}`, { method: 'DELETE', headers });
      if (res.ok) { showToast('Material deleted'); setMaterials(prev => prev.filter(m => m.id !== id)); }
      else { showToast('Delete failed', 'error'); }
    } catch { showToast('Network error', 'error'); }
    finally { setDeleteConfirm(null); }
  };

  const filtered = materials.filter(m => {
    const matchSearch = m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.course_name || '').toLowerCase().includes(search.toLowerCase());
    const matchBatch = filterBatch === 'All' || m.batch_number === filterBatch;
    return matchSearch && matchBatch;
  });

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 9999,
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
          borderRadius: '12px', padding: '1rem 1.5rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.3s ease',
        }}>
          {toast.type === 'success' ? <CheckCircle size={18} style={{ color: 'var(--success)' }} /> : <AlertCircle size={18} style={{ color: 'var(--danger)' }} />}
          <span style={{ fontWeight: 500 }}>{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem' }}>Course Materials</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.4rem' }}>Upload, manage, and organise learning materials for each batch.</p>
        </div>
        <button className="btn btn-primary" id="add-material-btn" onClick={openAdd} style={{ gap: '0.6rem' }}>
          <Plus size={18} /> Upload Material
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="input-glass" placeholder="Search by title or subject..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2.75rem' }} />
        </div>
        <div style={{ minWidth: '160px' }}>
          <CustomSelect
            value={filterBatch}
            onChange={setFilterBatch}
            options={BATCH_OPTS}
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Materials', value: materials.length, color: 'var(--accent-secondary)' },
          { label: 'PDFs', value: materials.filter(m => m.file_type === 'pdf').length, color: '#ef4444' },
          { label: 'Videos', value: materials.filter(m => m.file_type === 'video').length, color: '#f59e0b' },
          { label: 'Documents', value: materials.filter(m => m.file_type === 'doc' || m.file_type === 'docx').length, color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} className="glass-panel" style={{ padding: '1rem 1.5rem', flex: '1', minWidth: '120px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ overflow: 'hidden', borderRadius: '16px' }}>
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading materials...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <BookOpen size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
            <p>No materials found. Upload your first one!</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}>
                  {['Material', 'Subject / Batch', 'Type', 'Downloadable', 'Uploaded', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '1rem 1.25rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((mat, i) => (
                  <tr key={mat.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '1rem 1.25rem', maxWidth: '280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {getIcon(mat.file_type)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mat.title}</div>
                          {mat.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>{mat.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{mat.course_name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{mat.batch_number === 'All' ? 'All Batches' : `${mat.batch_number} Batch`}</div>
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      <span style={{
                        padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600,
                        background: mat.file_type === 'pdf' ? 'rgba(239,68,68,0.12)' : mat.file_type === 'video' ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.12)',
                        color: mat.file_type === 'pdf' ? '#ef4444' : mat.file_type === 'video' ? '#f59e0b' : '#60a5fa',
                      }}>
                        {(mat.file_type || 'file').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
                      <span style={{ color: mat.is_downloadable ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.85rem' }}>
                        {mat.is_downloadable ? '✓ Yes' : '✗ No'}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(mat.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-glass" title="Edit" onClick={() => openEdit(mat)} style={{ padding: '0.5rem', width: '34px', height: '34px', borderRadius: '8px' }}>
                          <Pencil size={15} />
                        </button>
                        <button title="Delete" onClick={() => setDeleteConfirm(mat)}
                          style={{ padding: '0.5rem', width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Upload / Edit Modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto', padding: '2.5rem', borderRadius: '20px', position: 'relative', animation: 'fadeIn 0.25s ease' }}>

            <button onClick={closeModal} style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', color: 'white', width: '34px', height: '34px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={17} />
            </button>

            <h2 className="font-display" style={{ fontSize: '1.6rem', marginBottom: '0.4rem' }}>
              {editTarget ? '✏️ Edit Material' : '📤 Upload Material'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
              {editTarget ? 'Modify the material details or replace the file.' : 'Add a new course material for students.'}
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Title */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>Title *</label>
                <input className="input-glass" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Camera Techniques & Angles" />
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>Description</label>
                <textarea className="input-glass" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this material..." style={{ resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              {/* Subject + Batch row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>Subject *</label>
                  <CustomSelect
                    value={form.course_name}
                    onChange={v => setForm({ ...form, course_name: v })}
                    options={COURSE_OPTIONS}
                    placeholder="Select subject..."
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>Batch *</label>
                  <CustomSelect
                    value={form.batch_number}
                    onChange={v => setForm({ ...form, batch_number: v })}
                    options={BATCH_OPTS}
                  />
                </div>
              </div>

              {/* Downloadable toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none' }}>
                <div onClick={() => setForm({ ...form, is_downloadable: !form.is_downloadable })}
                  style={{ width: '46px', height: '26px', borderRadius: '13px', background: form.is_downloadable ? 'var(--success)' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--glass-border)', flexShrink: 0, cursor: 'pointer' }}>
                  <div style={{ position: 'absolute', top: '3px', left: form.is_downloadable ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Allow students to download</span>
              </label>

              {/* Upload mode tabs */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', fontWeight: 500 }}>File Source</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  {[{ mode: 'file', icon: <Upload size={15} />, label: 'Upload File' }, { mode: 'url', icon: <LinkIcon size={15} />, label: 'External URL' }].map(opt => (
                    <button key={opt.mode} type="button" onClick={() => setUploadMode(opt.mode)} style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.25rem', borderRadius: '8px', cursor: 'pointer',
                      background: uploadMode === opt.mode ? 'rgba(225,29,72,0.15)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${uploadMode === opt.mode ? 'rgba(225,29,72,0.5)' : 'var(--glass-border)'}`,
                      color: uploadMode === opt.mode ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      fontWeight: 500, fontSize: '0.88rem', transition: 'all 0.2s',
                    }}>
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>

                {uploadMode === 'file' ? (
                  <div onClick={() => fileRef.current?.click()}
                    style={{ border: `2px dashed ${file ? 'var(--success)' : 'var(--glass-border)'}`, borderRadius: '12px', padding: '2rem', textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', transition: 'all 0.2s' }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                  >
                    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.mp4,.webm,.ogg" hidden onChange={e => setFile(e.target.files[0] || null)} />
                    {file ? (
                      <>
                        <CheckCircle size={32} style={{ color: 'var(--success)', marginBottom: '0.5rem' }} />
                        <p style={{ color: 'var(--success)', fontWeight: 600 }}>{file.name}</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </>
                    ) : (
                      <>
                        <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', opacity: 0.5 }} />
                        <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Drag & drop or click to select</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>PDF, DOC, DOCX, MP4, WebM — up to 500 MB</p>
                        {editTarget?.file_url && <p style={{ fontSize: '0.78rem', color: 'var(--success)', marginTop: '0.5rem' }}>Current: {editTarget.file_url.split('/').pop()}</p>}
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <input className="input-glass" type="url" placeholder="https://example.com/material.pdf or YouTube link..." value={form.external_url} onChange={e => setForm({ ...form, external_url: e.target.value })} />
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>File type (for icon display)</label>
                      <CustomSelect
                        value={form.file_type_override}
                        onChange={v => setForm({ ...form, file_type_override: v })}
                        options={FILE_TYPE_OPTS}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-glass" onClick={closeModal} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting} style={{ minWidth: '140px' }}>
                  {submitting ? 'Saving...' : editTarget ? 'Save Changes' : <><Upload size={16} /> Upload Material</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialog ─────────────────────────────────────────── */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="glass-panel" style={{ padding: '2rem', maxWidth: '420px', width: '100%', borderRadius: '16px', textAlign: 'center', animation: 'fadeIn 0.2s ease' }}>
            <Trash2 size={40} style={{ color: 'var(--danger)', margin: '0 auto 1rem' }} />
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Delete Material?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              "<strong>{deleteConfirm.title}</strong>" will be permanently removed. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button className="btn btn-glass" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)}
                style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
