import React, { useState, useEffect } from 'react';
import { X, Plus, Pencil, Calendar, Lock, AlertTriangle, Save, Loader2 } from 'lucide-react';
import './BatchFormModal.css';

function getOrdinalSuffix(n) {
  const num = parseInt(n);
  if (isNaN(num)) return n;
  const s = ["th","st","nd","rd"];
  const v = num % 100;
  return num + (s[(v-20)%10] || s[v] || s[0]) + " Batch";
}

export default function BatchFormModal({ mode, batch, isOpen, onClose, onSuccess }) {
  const [form, setForm] = useState({
    batch_name: '',
    batch_number: '',
    course_name: 'Online Filmmaking Course',
    status: 'upcoming',
    start_date: '',
    end_date: '',
    description: ''
  });

  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Available courses
  const courseOptions = ['Online Filmmaking Course', 'Film Appreciation Course'];

  // Initialize form when modal opens or batch changes
  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && batch) {
        setForm({
          batch_name: batch.batch_name || '',
          batch_number: batch.batch_number || '',
          course_name: batch.course_name || 'Online Filmmaking Course',
          status: batch.status || 'upcoming',
          start_date: batch.start_date ? batch.start_date.substring(0, 10) : '',
          end_date: batch.end_date ? batch.end_date.substring(0, 10) : '',
          description: batch.description || ''
        });
      } else {
        setForm({
          batch_name: '',
          batch_number: '',
          course_name: 'Online Filmmaking Course',
          status: 'upcoming',
          start_date: '',
          end_date: '',
          description: ''
        });
      }
      setErrors({});
      setApiError('');
      setIsSubmitting(false);
    }
  }, [isOpen, mode, batch]);

  // Handle Escape key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, isSubmitting, onClose]);

  const validateField = (name, value, currentForm = form) => {
    let error = '';
    
    switch (name) {
      case 'course_name':
        if (!value) error = 'Please select a course';
        break;
      case 'batch_number':
        if (!value) error = 'Batch number is required';
        break;
      case 'batch_name':
        if (!value) error = 'Batch name is required';
        break;
      case 'status':
        if (!value) error = 'Please select a status';
        break;
      case 'end_date':
      case 'start_date':
        // If both are filled, end must be after start
        const start = name === 'start_date' ? value : currentForm.start_date;
        const end = name === 'end_date' ? value : currentForm.end_date;
        if (start && end && new Date(end) <= new Date(start)) {
          error = 'End date must be after start date';
        }
        break;
      case 'description':
        if (value && value.length > 500) error = 'Description cannot exceed 500 characters';
        break;
      default:
        break;
    }

    return error;
  };

  const handleBlur = (field) => {
    // Ordinal logic for batch_number in create mode
    if (field === 'batch_number' && mode === 'create') {
      const numVal = form.batch_number.trim();
      if (numVal && !form.batch_name) {
        setForm(prev => ({ ...prev, batch_name: getOrdinalSuffix(numVal) }));
      }
    }

    const err = validateField(field, form[field]);
    setErrors(prev => ({
      ...prev,
      [field]: err,
      // If we are validating start_date, also re-validate end_date and vice versa
      ...(field === 'start_date' ? { end_date: validateField('end_date', form.end_date) } : {}),
      ...(field === 'end_date' ? { start_date: validateField('start_date', form.start_date) } : {})
    }));
  };

  const handleChange = (field, value) => {
    const newForm = { ...form, [field]: value };
    setForm(newForm);
    // Clear error immediately if valid (e.g. typing fixes it)
    if (errors[field]) {
      const err = validateField(field, value, newForm);
      setErrors(prev => ({ ...prev, [field]: err }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Validate all
    const newErrors = {};
    let hasError = false;
    Object.keys(form).forEach(key => {
      const err = validateField(key, form[key]);
      if (err) {
        newErrors[key] = err;
        hasError = true;
      }
    });

    if (hasError) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setApiError('');

    try {
      const token = localStorage.getItem('token');
      const url = mode === 'create' 
        ? '/api/admin/batches' 
        : `/api/admin/batches/${batch.id}`;
      
      const method = mode === 'create' ? 'POST' : 'PATCH';

      const payload = { ...form };
      // Backend expects start_date/end_date to be null if empty
      if (!payload.start_date) payload.start_date = null;
      if (!payload.end_date) payload.end_date = null;
      if (!payload.description) payload.description = null;
      
      if (mode === 'edit') {
        // Technically backend ignores course_name and batch_number, but we can omit batch_number completely as requested
        delete payload.batch_number;
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok) {
        onSuccess(data.batch || data); // pass back the batch object
      } else {
        if (response.status === 409) {
          setErrors(prev => ({ ...prev, batch_number: 'This batch number already exists' }));
        } else if (response.status === 400 && data.error && data.error.includes('date')) {
          setErrors(prev => ({ ...prev, end_date: data.error }));
        } else {
          setApiError(data.error || 'Something went wrong. Please try again.');
        }
      }
    } catch (err) {
      console.error('Submit error:', err);
      setApiError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Determine if submit should be disabled
  const hasErrors = Object.values(errors).some(err => err);
  const isFormEmpty = !form.course_name || !form.batch_number || !form.batch_name || !form.status;

  return (
    <div className="batch-modal-overlay" onClick={() => !isSubmitting && onClose()}>
      <div className="batch-modal-container" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="batch-modal-header">
          <div>
            <h3 className="batch-modal-header-title">
              {mode === 'create' ? <Plus size={24} color="#3b82f6" /> : <Pencil size={24} color="#3b82f6" />}
              {mode === 'create' ? 'Create New Batch' : 'Edit Batch'}
            </h3>
            <p className="batch-modal-header-subtitle">
              {mode === 'create' 
                ? 'Set up a new student batch for a course' 
                : `Update details for ${batch?.batch_name}`}
            </p>
          </div>
          <button 
            className="icon-btn-ghost" 
            onClick={onClose} 
            disabled={isSubmitting}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="batch-modal-body">
            
            {apiError && (
              <div className="batch-modal-error-banner">
                <AlertTriangle size={18} />
                {apiError}
              </div>
            )}

            {/* Course Selection */}
            <div className="batch-form-field">
              <label>
                Course Program
                {mode === 'edit' && <Lock size={14} title="Course cannot be changed after creation" />}
              </label>
              <div className="batch-course-toggle">
                {courseOptions.map(course => (
                  <button
                    key={course}
                    type="button"
                    className={`course-toggle-btn ${form.course_name === course ? 'selected' : ''}`}
                    onClick={() => handleChange('course_name', course)}
                    disabled={mode === 'edit'}
                    title={mode === 'edit' ? "Course cannot be changed after creation" : ""}
                  >
                    {course === 'Online Filmmaking Course' ? '🎬' : '🎞'} {course}
                  </button>
                ))}
              </div>
              {errors.course_name && <div className="batch-field-error">{errors.course_name}</div>}
            </div>

            <div className="form-row">
              {/* Batch Number */}
              <div className="batch-form-field">
                <label>
                  Batch Number
                  {mode === 'edit' && <Lock size={14} title="Batch number cannot be changed after creation" />}
                </label>
                <div className="input-with-icon">
                  <input
                    type="text"
                    placeholder="e.g. 86"
                    value={form.batch_number}
                    onChange={e => handleChange('batch_number', e.target.value)}
                    onBlur={() => handleBlur('batch_number')}
                    disabled={mode === 'edit'}
                  />
                  {mode === 'edit' && <Lock size={16} className="input-icon-right" />}
                </div>
                {mode === 'edit' && <div className="field-helper">Batch number cannot be changed after creation</div>}
                {errors.batch_number && <div className="batch-field-error">{errors.batch_number}</div>}
              </div>

              {/* Batch Name */}
              <div className="batch-form-field">
                <label>Batch Name</label>
                <input
                  type="text"
                  placeholder="e.g. 86th Batch"
                  value={form.batch_name}
                  onChange={e => handleChange('batch_name', e.target.value)}
                  onBlur={() => handleBlur('batch_name')}
                />
                {errors.batch_name && <div className="batch-field-error">{errors.batch_name}</div>}
              </div>
            </div>

            {/* Status */}
            <div className="batch-form-field">
              <label>Status</label>
              <div className="status-select-wrapper">
                <div className={`status-dot ${form.status}`}></div>
                <select
                  className="batch-status-select"
                  value={form.status}
                  onChange={e => handleChange('status', e.target.value)}
                  onBlur={() => handleBlur('status')}
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              {errors.status && <div className="batch-field-error">{errors.status}</div>}
            </div>

            <div className="form-row">
              {/* Start Date */}
              <div className="batch-form-field">
                <label><Calendar size={14} /> Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={e => handleChange('start_date', e.target.value)}
                  onBlur={() => handleBlur('start_date')}
                />
                <div className="field-helper">When does Phase 1 / the course begin?</div>
                {errors.start_date && <div className="batch-field-error">{errors.start_date}</div>}
              </div>

              {/* End Date */}
              <div className="batch-form-field">
                <label><Calendar size={14} /> End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={e => handleChange('end_date', e.target.value)}
                  onBlur={() => handleBlur('end_date')}
                />
                <div className="field-helper">Expected graduation / course completion date</div>
                {errors.end_date && <div className="batch-field-error">{errors.end_date}</div>}
              </div>
            </div>

            {/* Description */}
            <div className="batch-form-field">
              <label>Description</label>
              <textarea
                rows={3}
                placeholder="Optional notes about this batch (e.g. Evening batch, Zoom-based Phase 1, Special intake)"
                value={form.description}
                onChange={e => handleChange('description', e.target.value)}
                onBlur={() => handleBlur('description')}
              />
              <div className={`char-counter ${form.description.length > 400 ? 'error' : ''}`}>
                {form.description.length}/500
              </div>
              {errors.description && <div className="batch-field-error">{errors.description}</div>}
            </div>

          </div>

          {/* Footer */}
          <div className="batch-modal-footer">
            <button 
              type="button" 
              className="btn btn-cancel" 
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-submit"
              disabled={isSubmitting || hasErrors || isFormEmpty}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  {mode === 'create' ? 'Creating...' : 'Saving...'}
                </>
              ) : (
                <>
                  {mode === 'create' ? <Plus size={18} /> : <Save size={18} />}
                  {mode === 'create' ? 'Create Batch' : 'Save Changes'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
