import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Plus, Trash2, CheckCircle2, AlertCircle, X, Search, Edit3, RefreshCw
} from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import { useCourseSettings } from '../../hooks/useCourseSettings';
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

const DEFAULT_FORM = {
  course_name: 'Online Filmmaking Course',
  batch_number: '',
  total_classes: 22,
  exam_max_score: 100,
  exam_pass_mark: 33,
  has_phase2: false,
  has_assignment: false,
  assignments: []
};

export default function CourseSettingsManager() {
  const { showConfirm } = useModal();
  const { courseSettings, fetchSettings, loading } = useCourseSettings();
  
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formMode, setFormMode] = useState('custom'); // 'custom' or 'default'
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Available batches for suggestions
  const [availableBatches, setAvailableBatches] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const fetchBatches = async () => {
      try {
        const res = await apiFetch('/batches');
        setAvailableBatches(res.map(b => b.batch_number));
      } catch (err) {}
    };
    fetchBatches();
  }, []);

  const filteredSettings = courseSettings.filter(setting => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const batchMatch = String(setting.batch_number).toLowerCase().includes(q);
    const courseMatch = String(setting.course_name).toLowerCase().includes(q);
    return batchMatch || courseMatch;
  });

  const isBatchDefined = (batch) => {
    return courseSettings.some(s => s.course_name === form.course_name && String(s.batch_number) === String(batch));
  };

  const handleSelectBatch = (b) => {
    setForm(prev => ({ ...prev, batch_number: b }));
    setShowSuggestions(false);
  };

  const showSuccess = (msg) => setToast({ message: msg, type: 'success' });
  const showError = (msg) => setToast({ message: msg, type: 'error' });

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setFormMode('custom');
    setEditingId(null);
  };

  const handleEdit = (setting) => {
    setForm({
      course_name: setting.course_name,
      batch_number: setting.batch_number === 'DEFAULT' ? '' : setting.batch_number,
      total_classes: setting.total_classes,
      exam_max_score: setting.exam_max_score,
      exam_pass_mark: setting.exam_pass_mark,
      has_phase2: setting.has_phase2,
      has_assignment: setting.has_assignment,
      assignments: setting.assignments || []
    });
    setFormMode(setting.batch_number === 'DEFAULT' ? 'default' : 'custom');
    setEditingId(setting.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (setting) => {
    if (setting.batch_number === 'DEFAULT') {
      showError("Cannot delete the default setting.");
      return;
    }
    showConfirm({
      title: 'Delete Course Setting',
      message: `Are you sure you want to delete the settings for ${setting.course_name} (Batch: ${setting.batch_number})?`,
      confirmText: 'Delete',
      isAlert: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/course-settings/${encodeURIComponent(setting.course_name)}/${encodeURIComponent(setting.batch_number)}`, {
            method: 'DELETE'
          });
          showSuccess('Course setting deleted');
          fetchSettings();
        } catch (err) {
          showError(err.message);
        }
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formMode === 'custom' && !form.batch_number.trim()) {
      showError('Batch number is required for custom settings.');
      return;
    }
    
    setSaving(true);
    try {
      await apiFetch('/course-settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          batch_number: formMode === 'default' ? 'DEFAULT' : form.batch_number.trim()
        })
      });
      showSuccess('Course setting saved successfully!');
      fetchSettings();
      resetForm();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addAssignment = () => {
    setForm(prev => ({
      ...prev,
      assignments: [...prev.assignments, { id: Date.now().toString(), name: 'New Assignment', max_score: 10 }]
    }));
  };

  const updateAssignment = (index, field, value) => {
    setForm(prev => {
      const newAssignments = [...prev.assignments];
      newAssignments[index] = { ...newAssignments[index], [field]: value };
      if (field === 'name') {
        newAssignments[index].id = value.toLowerCase().replace(/[^a-z0-9]/g, '_');
      }
      return { ...prev, assignments: newAssignments };
    });
  };

  const removeAssignment = (index) => {
    setForm(prev => {
      const newAssignments = [...prev.assignments];
      newAssignments.splice(index, 1);
      return { ...prev, assignments: newAssignments };
    });
  };

  if (loading && courseSettings.length === 0) {
    return (
      <div className="bfm-page">
        <div className="bfm-loading">
          <RefreshCw size={20} className="spinning" />
          <p>Loading course settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bfm-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bfm-header">
        <div className="bfm-header-left">
          <div className="bfm-header-icon">
            <Settings size={22} />
          </div>
          <div>
            <h1>Course Settings</h1>
            <p>Define global course parameters and assignments per batch.</p>
          </div>
        </div>
        <button className="bfm-refresh-btn" onClick={fetchSettings} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
      </div>

      <div className="bfm-card bfm-form-card">
        <div className="bfm-card-header">
          {editingId ? (
            <>
              <Edit3 size={16} />
              <span>{formMode === 'default' ? 'Edit Default Settings' : 'Edit Batch Settings'}</span>
            </>
          ) : (
            <>
              <Plus size={16} />
              <span>{formMode === 'default' ? 'Default Course Settings' : 'Customize Batch Settings'}</span>
            </>
          )}
        </div>
        <form onSubmit={handleSubmit} className="bfm-form">
          <div className="bfm-field">
            <label>Settings Mode</label>
            <div className="bfm-course-pills" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`bfm-course-pill ${formMode === 'custom' ? 'active' : ''}`}
                onClick={() => setFormMode('custom')}
                disabled={editingId && formMode === 'default'}
              >
                Batch Custom
              </button>
              <button
                type="button"
                className={`bfm-course-pill ${formMode === 'default' ? 'active' : ''}`}
                onClick={() => setFormMode('default')}
                disabled={editingId && formMode === 'custom'}
              >
                Global Default
              </button>
            </div>
          </div>

          <div className="bfm-field">
            <label>Course Name</label>
            <div className="bfm-input-wrapper">
              <select 
                className="bfm-input"
                value={form.course_name} 
                onChange={e => setForm({...form, course_name: e.target.value})}
                disabled={editingId}
                required
              >
                <option value="Online Filmmaking Course">Online Filmmaking Course</option>
                <option value="Film Appreciation Course">Film Appreciation Course</option>
                <option value="Script Writing">Script Writing</option>
                <option value="Cinematography">Cinematography</option>
                <option value="Acting">Acting</option>
              </select>
            </div>
          </div>

          {formMode === 'custom' && (
            <div className="bfm-field">
              <label>Target Batch <span className="text-error">*</span></label>
              <div style={{ position: 'relative' }}>
                <div className="bfm-input-wrapper">
                  <input
                    type="text"
                    className="bfm-input"
                    value={form.batch_number}
                    onChange={(e) => {
                      setForm({...form, batch_number: e.target.value});
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder="e.g. 1st Batch"
                    disabled={editingId}
                    required
                  />
                </div>
                {showSuggestions && availableBatches.length > 0 && (
                  <div className="bfm-suggestions-dropdown" style={{ display: 'block' }}>
                    {availableBatches.map(b => {
                      const defined = isBatchDefined(b);
                      return (
                        <div 
                          key={b} 
                          className={`bfm-suggestion-item ${defined ? 'defined' : ''}`}
                          onMouseDown={() => handleSelectBatch(b)}
                        >
                          {b}
                          {defined && <span className="bfm-suggestion-tag">Defined</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bfm-fee-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bfm-field">
              <label>Total Classes</label>
              <div className="bfm-input-wrapper">
                <input
                  type="number"
                  min="1"
                  className="bfm-input"
                  value={form.total_classes}
                  onChange={e => setForm({...form, total_classes: parseInt(e.target.value) || 0})}
                  required
                />
              </div>
            </div>
            <div className="bfm-field">
              <label>Max Exam Score</label>
              <div className="bfm-input-wrapper">
                <input
                  type="number"
                  min="0"
                  className="bfm-input"
                  value={form.exam_max_score}
                  onChange={e => setForm({...form, exam_max_score: parseInt(e.target.value) || 0})}
                  required
                />
              </div>
            </div>
          </div>

          <div className="bfm-field">
            <label>Exam Pass Mark</label>
            <div className="bfm-input-wrapper">
              <input
                type="number"
                min="0"
                className="bfm-input"
                value={form.exam_pass_mark}
                onChange={e => setForm({...form, exam_pass_mark: parseInt(e.target.value) || 0})}
                required
              />
            </div>
          </div>

          <div className="bfm-field" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
            <input
              type="checkbox"
              id="has_phase2"
              checked={form.has_phase2}
              onChange={e => setForm({...form, has_phase2: e.target.checked})}
              style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary)' }}
            />
            <label htmlFor="has_phase2" style={{ margin: 0, cursor: 'pointer', color: 'var(--text-primary)' }}>Course has Phase 2 (Admission required)</label>
          </div>

          <div className="bfm-field" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
            <input
              type="checkbox"
              id="has_assignment"
              checked={form.has_assignment}
              onChange={e => setForm({...form, has_assignment: e.target.checked})}
              style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary)' }}
            />
            <label htmlFor="has_assignment" style={{ margin: 0, cursor: 'pointer', color: 'var(--text-primary)' }}>Enable dynamic assignments</label>
          </div>

          {form.has_assignment && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', padding: '1.25rem', borderRadius: '12px', marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Assignments</h4>
                <button type="button" onClick={addAssignment} className="bfm-course-pill" style={{ padding: '0.3rem 0.75rem', background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                  <Plus size={14} style={{ marginRight: '4px' }} /> Add
                </button>
              </div>
              {form.assignments.map((ass, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                  <div className="bfm-input-wrapper" style={{ flex: 1 }}>
                    <input 
                      type="text" 
                      className="bfm-input"
                      placeholder="Name (e.g. Script)" 
                      value={ass.name} 
                      onChange={e => updateAssignment(i, 'name', e.target.value)} 
                    />
                  </div>
                  <div className="bfm-input-wrapper" style={{ width: '90px' }}>
                    <input 
                      type="number" 
                      className="bfm-input"
                      placeholder="Max" 
                      value={ass.max_score} 
                      onChange={e => updateAssignment(i, 'max_score', parseInt(e.target.value) || 0)} 
                    />
                  </div>
                  <button type="button" onClick={() => removeAssignment(i)} className="bfm-delete-btn" style={{ padding: '0.5rem' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {form.assignments.length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No assignments defined yet.</div>}
            </div>
          )}

          <div className="bfm-form-actions" style={{ marginTop: '2rem' }}>
            {editingId && (
              <button type="button" className="bfm-cancel-btn" onClick={resetForm}>
                Cancel
              </button>
            )}
            <button type="submit" className="bfm-save-btn" disabled={saving}>
              {saving ? 'Saving...' : 'Save Course Settings'}
            </button>
          </div>
        </form>
      </div>

      <div className="bfm-card">
        <div className="bfm-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Defined Settings</span>
            <span className="bfm-count-badge">{filteredSettings.length}</span>
          </div>
          <div className="bfm-search-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '1rem', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="bfm-search-input"
              placeholder="Search by batch..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>
        </div>

        <div className="bfm-table-wrapper">
          <table className="bfm-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Batch</th>
                <th>Exams / Classes</th>
                <th>Assignments</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSettings.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="bfm-empty" style={{ padding: '3rem 1.5rem' }}>
                      <AlertCircle size={32} />
                      <p>No records found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSettings.map(setting => {
                  const isDefault = setting.batch_number === 'DEFAULT';
                  const isFm = setting.course_name.includes('Filmmaking');
                  return (
                    <tr key={setting.id} className={editingId === setting.id ? 'bfm-row--editing' : ''}>
                      <td>
                        <span className={`bfm-course-badge ${isFm ? 'bfm-course-badge--film' : 'bfm-course-badge--workshop'}`}>
                          {isFm ? 'Online Filmmaking' : 'Film Appreciation'}
                        </span>
                        {setting.has_phase2 && <div style={{ fontSize: '0.7rem', color: 'var(--brand-primary)', marginTop: '6px' }}>Phase 2 Enabled</div>}
                      </td>
                      <td>
                        {isDefault ? (
                          <span className="bfm-batch-num" style={{ color: '#818cf8', fontWeight: 600 }}>DEFAULT</span>
                        ) : (
                          <span className="bfm-batch-num">Batch {setting.batch_number}</span>
                        )}
                      </td>
                      <td>
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>Max {setting.exam_max_score} / Pass {setting.exam_pass_mark}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>{setting.total_classes} Classes</div>
                      </td>
                      <td>
                        {setting.has_assignment && setting.assignments?.length > 0 ? (
                          <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {setting.assignments.map(a => (
                              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                                <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--brand-primary)' }}></div>
                                {a.name} (Max: {a.max_score})
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None</span>
                        )}
                      </td>
                      <td>
                        <div className="bfm-row-actions">
                          <button 
                            className="bfm-edit-btn" 
                            onClick={() => handleEdit(setting)}
                            title="Edit"
                          >
                            <Edit3 size={15} />
                          </button>
                          {!isDefault && (
                            <button 
                              className="bfm-delete-btn" 
                              onClick={() => handleDelete(setting)}
                              title="Delete"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
