import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Plus, Trash2, RefreshCw, Save, AlertCircle, CheckCircle2,
  Film, GraduationCap, Edit3, X, ChevronDown, Search, ArrowUpDown
} from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import './BatchFeeManager.css';

const API_BASE = '/api/admin';

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

const COURSE_OPTIONS = [
  { label: 'Online Filmmaking Course', value: 'Online Filmmaking Course', type: 'filmmaking', icon: Film },
  { label: 'Film Appreciation Course', value: 'Film Appreciation Course', type: 'workshop', icon: GraduationCap },
];

const DEFAULT_FORM = {
  course_name: 'Online Filmmaking Course',
  batch_number: '',
  phase1_fee: '',
  phase2_fee: '',
  full_fee: '',
};

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`bfm-toast bfm-toast--${type}`}>
      {type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      <span>{message}</span>
      <button className="bfm-toast-close" onClick={onClose}><X size={14} /></button>
    </div>
  );
}

export default function BatchFeeManager() {
  const { showConfirm } = useModal();
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formMode, setFormMode] = useState('custom'); // 'custom' or 'default'
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [availableBatches, setAvailableBatches] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDirection, setSortDirection] = useState('desc');

  const filteredFees = fees.filter(fee => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const batchMatch = String(fee.batch_number).toLowerCase().includes(q);
    const courseMatch = String(fee.course_name).toLowerCase().includes(q);
    const badgeMatch = (fee.phase1_fee > 0 || fee.phase2_fee > 0 ? 'filmmaking' : 'appreciation').includes(q);
    const isDefault = fee.batch_number === 'DEFAULT';
    const defaultMatch = isDefault && 'default course fee'.includes(q);
    return batchMatch || courseMatch || badgeMatch || defaultMatch;
  });

  const filteredBatches = availableBatches
    .filter(batch => {
      if (!form.batch_number) return true;
      return String(batch).toLowerCase().includes(form.batch_number.toLowerCase());
    })
    .sort((a, b) => {
      const numA = parseFloat(a) || 0;
      const numB = parseFloat(b) || 0;
      if (numB !== numA) return numB - numA;
      return String(b).localeCompare(String(a));
    });

  const isBatchDefined = (batch) => {
    return fees.some(fee => fee.course_name === form.course_name && String(fee.batch_number) === String(batch));
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || filteredBatches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev + 1) % filteredBatches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev - 1 + filteredBatches.length) % filteredBatches.length);
    } else if (e.key === 'Enter') {
      if (suggestionIndex >= 0 && suggestionIndex < filteredBatches.length) {
        e.preventDefault();
        const selectedBatch = filteredBatches[suggestionIndex];
        const defined = isBatchDefined(selectedBatch);
        if (defined) {
          showToast(`The course fee for Batch ${selectedBatch} is already defined. To edit this course fee, please see Defined Batch Fees below.`, 'error');
        } else {
          setForm(f => ({ ...f, batch_number: String(selectedBatch) }));
          setShowSuggestions(false);
        }
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const showToast = (message, type = 'success') => setToast({ message, type });
  const hideToast = () => setToast(null);

  const fetchFees = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/batch-fees');
      setFees(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailableBatches = useCallback(async (courseName) => {
    try {
      const data = await apiFetch(`/batch-fees/available-batches?course_name=${encodeURIComponent(courseName)}`);
      setAvailableBatches(data);
    } catch (err) {
      console.error('Error fetching available batches:', err);
    }
  }, []);

  useEffect(() => { fetchFees(); }, [fetchFees]);

  useEffect(() => {
    if (formMode === 'custom') {
      fetchAvailableBatches(form.course_name);
    }
  }, [form.course_name, formMode, fetchAvailableBatches]);

  // Automatically sync/populate global DEFAULT fees into the form when target switches
  useEffect(() => {
    if (formMode === 'default' && !editingId && fees.length > 0) {
      const existing = fees.find(fee => fee.course_name === form.course_name && fee.batch_number === 'DEFAULT');
      if (existing) {
        setForm(f => ({
          ...f,
          phase1_fee: existing.phase1_fee ? String(existing.phase1_fee) : '',
          phase2_fee: existing.phase2_fee ? String(existing.phase2_fee) : '',
          full_fee: existing.full_fee ? String(existing.full_fee) : '',
        }));
      } else {
        setForm(f => ({
          ...f,
          phase1_fee: '',
          phase2_fee: '',
          full_fee: '',
        }));
      }
    }
  }, [fees, formMode, form.course_name, editingId]);

  const selectedCourse = COURSE_OPTIONS.find(c => c.value === form.course_name);
  const isFilmmaking = selectedCourse?.type === 'filmmaking';

  const handleCourseChange = (value) => {
    setForm(f => ({
      ...f,
      course_name: value,
      batch_number: formMode === 'default' ? 'DEFAULT' : '',
      phase1_fee: '',
      phase2_fee: '',
      full_fee: '',
    }));
  };

  const handleFormModeChange = (mode) => {
    if (editingId) return;
    setFormMode(mode);
    setForm(f => ({
      ...f,
      batch_number: mode === 'default' ? 'DEFAULT' : '',
      phase1_fee: '',
      phase2_fee: '',
      full_fee: '',
    }));
  };

  const handleEdit = (fee) => {
    setEditingId(fee.id);
    const isDef = fee.batch_number === 'DEFAULT';
    setFormMode(isDef ? 'default' : 'custom');
    setForm({
      course_name: fee.course_name,
      batch_number: String(fee.batch_number),
      phase1_fee: fee.phase1_fee ? String(fee.phase1_fee) : '',
      phase2_fee: fee.phase2_fee ? String(fee.phase2_fee) : '',
      full_fee: fee.full_fee ? String(fee.full_fee) : '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormMode('custom');
    setForm(DEFAULT_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formMode === 'custom' && !form.batch_number.trim()) {
      showToast('Please enter a batch number.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        course_name: form.course_name,
        batch_number: formMode === 'default' ? 'DEFAULT' : form.batch_number.trim(),
        phase1_fee: isFilmmaking ? parseInt(form.phase1_fee, 10) || 0 : 0,
        phase2_fee: isFilmmaking ? parseInt(form.phase2_fee, 10) || 0 : 0,
        full_fee: !isFilmmaking ? parseInt(form.full_fee, 10) || 0 : 0,
      };
      await apiFetch('/batch-fees', { method: 'POST', body: JSON.stringify(payload) });
      showToast(editingId ? 'Fee updated successfully.' : 'Fee saved successfully.');
      setEditingId(null);
      if (formMode === 'custom') {
        setForm(f => ({ ...f, batch_number: '', phase1_fee: '', phase2_fee: '', full_fee: '' }));
      }
      await fetchFees();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!await showConfirm('Delete Fee Definition', 'Delete this batch fee definition? This cannot be undone.', 'danger')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/batch-fees/${id}`, { method: 'DELETE' });
      showToast('Fee definition deleted.');
      await fetchFees();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const formatCurrency = (v) => v ? `৳${Number(v).toLocaleString('en-BD')}` : '—';

  return (
    <div className="bfm-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}

      {/* ── Header ── */}
      <div className="bfm-header">
        <div className="bfm-header-left">
          <div className="bfm-header-icon">
            <DollarSign size={22} />
          </div>
          <div>
            <h1>Batch Fee Manager</h1>
            <p>Define course fees per batch — used as the default when student fees are not manually set.</p>
          </div>
        </div>
        <button className="bfm-refresh-btn" onClick={fetchFees} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Form Card ── */}
      <div className="bfm-card bfm-form-card">
        <div className="bfm-card-header">
          {editingId ? (
            <>
              <Edit3 size={16} />
              <span>{formMode === 'default' ? 'Edit Default Course Fee' : 'Edit Customized Batch Fee'}</span>
            </>
          ) : (
            <>
              <Plus size={16} />
              <span>{formMode === 'default' ? 'Default Course Fee' : 'Customize Batch Fee'}</span>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="bfm-form">
          {/* Fee Type / Target Selector (Tabs) */}
          {!editingId && (
            <div className="bfm-field">
              <label>Configuration Type</label>
              <div className="bfm-course-pills" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`bfm-course-pill ${formMode === 'custom' ? 'active' : ''}`}
                  onClick={() => handleFormModeChange('custom')}
                  style={{ flex: 1, justifyContent: 'center', py: '0.5rem' }}
                >
                  Customize Batch Fee
                </button>
                <button
                  type="button"
                  className={`bfm-course-pill ${formMode === 'default' ? 'active' : ''}`}
                  onClick={() => handleFormModeChange('default')}
                  style={{ flex: 1, justifyContent: 'center', py: '0.5rem' }}
                >
                  Default Course Fee
                </button>
              </div>
            </div>
          )}

          {/* Course selector */}
          <div className="bfm-field">
            <label>Course</label>
            <div className="bfm-course-pills">
              {COURSE_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`bfm-course-pill ${form.course_name === opt.value ? 'active' : ''}`}
                    onClick={() => handleCourseChange(opt.value)}
                    disabled={!!editingId}
                    style={editingId ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                  >
                    <Icon size={14} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Batch number (Conditional) */}
          {formMode === 'custom' ? (
            <div className="bfm-field">
              <label htmlFor="bfm-batch">Batch Number</label>
              <div className="bfm-input-wrapper">
                <input
                  id="bfm-batch"
                  type="text"
                  className="bfm-input"
                  placeholder="e.g. 53, 75, 76A…"
                  value={form.batch_number}
                  onChange={e => {
                    setForm(f => ({ ...f, batch_number: e.target.value }));
                    setSuggestionIndex(-1);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => {
                    setShowSuggestions(true);
                    setSuggestionIndex(-1);
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={!!editingId}
                  autoComplete="off"
                />
                {!editingId && filteredBatches.length > 0 && (
                  <button
                    type="button"
                    className={`bfm-dropdown-toggle ${showSuggestions ? 'open' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowSuggestions(prev => !prev);
                    }}
                    tabIndex={-1}
                  >
                    <ChevronDown size={16} />
                  </button>
                )}
                {showSuggestions && filteredBatches.length > 0 && (
                  <div className="bfm-suggestions-dropdown">
                    {filteredBatches.map((batch, index) => {
                      const defined = isBatchDefined(batch);
                      return (
                        <div
                          key={batch}
                          className={`bfm-suggestion-item ${index === suggestionIndex ? 'active' : ''} ${defined ? 'defined' : ''}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={() => {
                            if (defined) {
                              showToast(`The course fee for Batch ${batch} is already defined. To edit this course fee, please see Defined Batch Fees below.`, 'error');
                            } else {
                              setForm(f => ({ ...f, batch_number: String(batch) }));
                              setShowSuggestions(false);
                            }
                          }}
                        >
                          <span>{batch}</span>
                          {defined && (
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.05)' }}>
                              Already Defined
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {editingId && (
                <span className="bfm-field-hint">Batch & course cannot be changed when editing — delete and re-add instead.</span>
              )}
            </div>
          ) : (
            <div className="bfm-field">
              <label>Default Scope</label>
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: '8px',
                padding: '0.8rem 1rem',
                color: 'var(--text-secondary)',
                fontSize: '0.85rem',
                lineHeight: '1.4',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem'
              }}>
                <AlertCircle size={16} className="text-warning" style={{ flexShrink: 0, color: '#f59e0b' }} />
                <span>
                  This default course fee applies globally to all batches of <strong>{form.course_name}</strong>.
                </span>
              </div>
            </div>
          )}

          {/* Fee fields */}
          <div className="bfm-fee-fields">
            {isFilmmaking ? (
              <>
                <div className="bfm-field">
                  <label htmlFor="bfm-p1">Phase 1 Fee (৳)</label>
                  <input
                    id="bfm-p1"
                    type="number"
                    min="0"
                    className="bfm-input"
                    placeholder="e.g. 4000"
                    value={form.phase1_fee}
                    onChange={e => setForm(f => ({ ...f, phase1_fee: e.target.value }))}
                  />
                </div>
                <div className="bfm-field">
                  <label htmlFor="bfm-p2">Phase 2 Fee (৳)</label>
                  <input
                    id="bfm-p2"
                    type="number"
                    min="0"
                    className="bfm-input"
                    placeholder="e.g. 4000"
                    value={form.phase2_fee}
                    onChange={e => setForm(f => ({ ...f, phase2_fee: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <div className="bfm-field">
                <label htmlFor="bfm-full">Full Fee (৳)</label>
                <input
                  id="bfm-full"
                  type="number"
                  min="0"
                  className="bfm-input"
                  placeholder="e.g. 4000"
                  value={form.full_fee}
                  onChange={e => setForm(f => ({ ...f, full_fee: e.target.value }))}
                />
              </div>
            )}
          </div>

          {/* Filmmaking total preview */}
          {isFilmmaking && (form.phase1_fee || form.phase2_fee) && (
            <div className="bfm-total-preview">
              Total: ৳{((parseInt(form.phase1_fee, 10) || 0) + (parseInt(form.phase2_fee, 10) || 0)).toLocaleString('en-BD')}
            </div>
          )}

          <div className="bfm-form-actions">
            {editingId && (
              <button type="button" className="bfm-cancel-btn" onClick={handleCancelEdit}>
                <X size={14} /> Cancel
              </button>
            )}
            <button type="submit" className="bfm-save-btn" disabled={saving}>
              <Save size={14} />
              {saving ? 'Saving…' : editingId ? 'Update Fee' : 'Save Fee'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Table Card ── */}
      <div className="bfm-card">
        <div className="bfm-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <DollarSign size={16} />
            <span>Defined Batch Fees</span>
            <span className="bfm-count-badge">{filteredFees.length}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginLeft: 'auto' }}>
            <button
              type="button"
              className="bfm-sort-btn"
              onClick={() => setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc')}
              title={sortDirection === 'desc' ? 'Sorted: Newest first (Click to sort oldest first)' : 'Sorted: Oldest first (Click to sort newest first)'}
            >
              <ArrowUpDown size={14} />
              <span>{sortDirection === 'desc' ? 'Newest First' : 'Oldest First'}</span>
            </button>
            
            <div className="bfm-search-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="Search batches..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  padding: '0.4rem 0.6rem 0.4rem 2rem',
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(0, 0, 0, 0.2)',
                  color: 'var(--text-primary)',
                  width: '180px',
                  transition: 'all 0.2s',
                  textTransform: 'none',
                  letterSpacing: 'normal'
                }}
                className="bfm-search-input"
              />
              {searchQuery && (
                <button 
                  type="button" 
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bfm-loading">
            <RefreshCw size={20} className="spinning" />
            <span>Loading fee definitions…</span>
          </div>
        ) : fees.length === 0 ? (
          <div className="bfm-empty">
            <DollarSign size={36} />
            <p>No batch fees defined yet.</p>
            <p className="bfm-empty-sub">Add a fee definition above to get started.</p>
          </div>
        ) : filteredFees.length === 0 ? (
          <div className="bfm-empty" style={{ padding: '3rem 1.5rem' }}>
            <Search size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
            <p>No matching batch fees found.</p>
            <p className="bfm-empty-sub">Try adjusting your search terms.</p>
          </div>
        ) : (

          <div className="bfm-table-wrapper">
            <table className="bfm-table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Batch</th>
                  <th>Phase 1 Fee</th>
                  <th>Phase 2 Fee</th>
                  <th>Full Fee</th>
                  <th>Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredFees].sort((a, b) => {
                  const isA_Default = a.batch_number === 'DEFAULT';
                  const isB_Default = b.batch_number === 'DEFAULT';
                  if (isA_Default && !isB_Default) return -1;
                  if (!isA_Default && isB_Default) return 1;
                  if (isA_Default && isB_Default) return a.course_name.localeCompare(b.course_name);

                  const numA = parseFloat(a.batch_number) || 0;
                  const numB = parseFloat(b.batch_number) || 0;
                  const diff = numA - numB;
                  if (diff !== 0) {
                    return sortDirection === 'asc' ? diff : -diff;
                  }
                  const strCompare = String(a.batch_number).localeCompare(String(b.batch_number));
                  return sortDirection === 'asc' ? strCompare : -strCompare;
                }).map(fee => {
                  const isFm = fee.course_name === 'Online Filmmaking Course';
                  const total = isFm
                    ? (fee.phase1_fee || 0) + (fee.phase2_fee || 0)
                    : (fee.full_fee || 0);
                  const isDefault = fee.batch_number === 'DEFAULT';
                  return (
                    <tr key={fee.id} className={editingId === fee.id ? 'bfm-row--editing' : ''}>
                      <td>
                        <span className={`bfm-course-badge ${isFm ? 'bfm-course-badge--film' : 'bfm-course-badge--workshop'}`}>
                          {isFm ? <Film size={11} /> : <GraduationCap size={11} />}
                          {isFm ? 'Filmmaking' : 'Appreciation'}
                        </span>
                      </td>
                      <td>
                        {isDefault ? (
                          <span style={{ 
                            fontSize: '0.72rem', 
                            fontWeight: 700, 
                            color: '#f59e0b', 
                            textTransform: 'uppercase', 
                            letterSpacing: '0.04em', 
                            background: 'rgba(245, 158, 11, 0.1)', 
                            padding: '3px 8px', 
                            borderRadius: '4px', 
                            border: '1px solid rgba(245, 158, 11, 0.2)',
                            display: 'inline-block'
                          }}>
                            default course fee
                          </span>
                        ) : (
                          <span className="bfm-batch-num">Batch {fee.batch_number}</span>
                        )}
                      </td>
                      <td>{isFm ? formatCurrency(fee.phase1_fee) : '—'}</td>
                      <td>{isFm ? formatCurrency(fee.phase2_fee) : '—'}</td>
                      <td>{!isFm ? formatCurrency(fee.full_fee) : '—'}</td>
                      <td><strong className="bfm-total-cell">{formatCurrency(total)}</strong></td>
                      <td>
                        <div className="bfm-row-actions">
                          <button
                            className="bfm-edit-btn"
                            onClick={() => handleEdit(fee)}
                            title="Edit"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            className="bfm-delete-btn"
                            onClick={() => handleDelete(fee.id)}
                            disabled={deletingId === fee.id}
                            title="Delete"
                          >
                            {deletingId === fee.id
                              ? <RefreshCw size={13} className="spinning" />
                              : <Trash2 size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Info note ── */}
      <div className="bfm-info-note">
        <AlertCircle size={14} />
        <span>
          These fees are used as <strong>fallback values</strong> in the Fee Collection Status dashboard.
          If a student has custom fees set in their enrollment, those take priority.
          If no batch fee is defined here either, the system falls back to course-wide defaults.
        </span>
      </div>
    </div>
  );
}
