import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Search, Users, Check, CheckCircle2, XCircle, 
  AlertTriangle, Loader2, ArrowLeft 
} from 'lucide-react';
import './AddStudentsModal.css';

export default function AddStudentsModal({ 
  batchId, 
  batchName, 
  batchNumber, 
  courseName, 
  isOpen, 
  onClose, 
  onSuccess 
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loadingAvailable, setLoadingAvailable] = useState(true);
  const [availableStudents, setAvailableStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [submitResult, setSubmitResult] = useState(null);

  // Esc key closing handler
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, isSubmitting, onClose]);

  // Fetch available students when modal opens
  useEffect(() => {
    if (isOpen) {
      // Reset state
      setCurrentStep(1);
      setSearchQuery('');
      setSelectedStudents([]);
      setApiError('');
      setSubmitResult(null);
      setIsSubmitting(false);
      setLoadingAvailable(true);

      const fetchAvailable = async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch(`/api/admin/batches/${batchId}/available-students`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (response.ok) {
            const data = await response.json();
            setAvailableStudents(data || []);
          } else {
            console.error('Failed to fetch available students');
          }
        } catch (error) {
          console.error('Error fetching available students:', error);
        } finally {
          setLoadingAvailable(false);
        }
      };

      fetchAvailable();
    }
  }, [isOpen, batchId]);

  // Client-side search filtering
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return availableStudents;
    const term = searchQuery.toLowerCase();
    return availableStudents.filter(s => {
      const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
      const bfiId = (s.bfi_id || '').toLowerCase();
      return fullName.includes(term) || bfiId.includes(term);
    });
  }, [availableStudents, searchQuery]);

  // Checkbox toggle logic
  const toggleStudentSelection = (student) => {
    setSelectedStudents(prev => {
      const exists = prev.find(s => s.user_id === student.user_id);
      if (exists) {
        return prev.filter(s => s.user_id !== student.user_id);
      } else {
        return [...prev, student];
      }
    });
  };

  // Remove individual student from selection panel
  const handleRemoveSelection = (studentId) => {
    setSelectedStudents(prev => prev.filter(s => s.user_id !== studentId));
  };

  // "Select All on this page" toggle logic
  const isAllFilteredSelected = useMemo(() => {
    if (filteredStudents.length === 0) return false;
    return filteredStudents.every(s => selectedStudents.some(sel => sel.user_id === s.user_id));
  }, [filteredStudents, selectedStudents]);

  const isSomeFilteredSelected = useMemo(() => {
    if (filteredStudents.length === 0) return false;
    return !isAllFilteredSelected && filteredStudents.some(s => selectedStudents.some(sel => sel.user_id === s.user_id));
  }, [filteredStudents, selectedStudents, isAllFilteredSelected]);

  const handleSelectAllToggle = () => {
    if (isAllFilteredSelected) {
      // Deselect all currently filtered students
      const filteredIds = filteredStudents.map(s => s.user_id);
      setSelectedStudents(prev => prev.filter(s => !filteredIds.includes(s.user_id)));
    } else {
      // Select all currently filtered students (avoiding duplicates)
      setSelectedStudents(prev => {
        const toAdd = filteredStudents.filter(s => !prev.some(sel => sel.user_id === s.user_id));
        return [...prev, ...toAdd];
      });
    }
  };

  // Submit assignments to API
  const handleSubmit = async () => {
    setIsSubmitting(true);
    setApiError('');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/batches/${batchId}/students`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          student_ids: selectedStudents.map(s => s.user_id)
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSubmitResult(data);
        setCurrentStep(3);
      } else {
        const errData = await response.json().catch(() => ({}));
        setApiError(errData.error || 'Failed to assign students. Please try again.');
      }
    } catch (error) {
      console.error('[AddStudentsModal] Submit error:', error);
      setApiError('Connection failed. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset modal state to add more students
  const handleAddMore = () => {
    setCurrentStep(1);
    setSelectedStudents([]);
    setSubmitResult(null);
    setApiError('');
    // Re-fetch available students
    setLoadingAvailable(true);
    const token = localStorage.getItem('token');
    fetch(`/api/admin/batches/${batchId}/available-students`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setAvailableStudents(data || []);
        setLoadingAvailable(false);
      })
      .catch(err => {
        console.error(err);
        setLoadingAvailable(false);
      });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="batch-modal-overlay" 
      onClick={() => !isSubmitting && onClose()}
    >
      <div 
        className="batch-modal-container add-students-modal" 
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="batch-modal-header">
          <div>
            <h3 className="batch-modal-header-title">
              <Users size={24} color="#3b82f6" />
              Add Students to {batchName}
            </h3>
            <p className="batch-modal-header-subtitle">
              {courseName} · Batch #{batchNumber}
            </p>
          </div>
          <button 
            className="icon-btn-ghost" 
            onClick={onClose} 
            disabled={isSubmitting}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            aria-label="Close modal"
          >
            <X size={24} />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="add-students-step-bar">
          <div className="modal-step-indicator">
            <div className={`step-circle ${currentStep === 1 ? 'active' : (currentStep > 1 ? 'completed' : '')}`}>
              {currentStep > 1 ? <Check size={14} /> : '1'}
            </div>
            <span className={currentStep === 1 ? 'step-text-active' : 'step-text-muted'}>Search & Select</span>
            
            <div className="step-connector"></div>
            
            <div className={`step-circle ${currentStep === 2 ? 'active' : (currentStep > 2 ? 'completed' : '')}`}>
              {currentStep > 2 ? <Check size={14} /> : '2'}
            </div>
            <span className={currentStep === 2 ? 'step-text-active' : 'step-text-muted'}>Review</span>
            
            <div className="step-connector"></div>
            
            <div className={`step-circle ${currentStep === 3 ? 'active' : ''}`}>
              3
            </div>
            <span className={currentStep === 3 ? 'step-text-active' : 'step-text-muted'}>Done</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="batch-modal-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* STEP 1: Search & Select */}
          {currentStep === 1 && (
            <div className="add-students-panels">
              {/* Left Panel: Student Picker */}
              <div className="panel-left">
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                  <Search size={16} className="search-icon-left" />
                  <input
                    type="text"
                    placeholder="Search by name or student ID..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="search-input-glass"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="search-clear-btn"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {loadingAvailable ? (
                  /* Skeleton loader list */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[1, 2, 3, 4].map(n => (
                      <div key={n} className="skeleton-item" style={{ height: '56px', borderRadius: '8px', animation: 'pulse 1.5s infinite' }}></div>
                    ))}
                  </div>
                ) : availableStudents.length === 0 ? (
                  /* No available students in DB */
                  <div className="empty-picker-state">
                    <Users size={48} className="empty-state-icon" />
                    <h4>No available students</h4>
                    <p>All students are already assigned to a batch. There are no available students to add.</p>
                  </div>
                ) : filteredStudents.length === 0 ? (
                  /* Search results empty */
                  <div className="empty-picker-state">
                    <Search size={48} className="empty-state-icon" />
                    <h4>No students found</h4>
                    <p>No students match your search query "{searchQuery}"</p>
                  </div>
                ) : (
                  /* Available Students List */
                  <div>
                    {/* Select All Checkbox Row */}
                    <div 
                      className="select-all-row" 
                      onClick={handleSelectAllToggle}
                    >
                      <input 
                        type="checkbox" 
                        checked={isAllFilteredSelected}
                        ref={el => {
                          if (el) el.indeterminate = isSomeFilteredSelected;
                        }}
                        onChange={() => {}} // toggled by row click
                        className="student-picker-checkbox"
                      />
                      <span className="select-all-label">
                        {isAllFilteredSelected 
                          ? `Deselect All (${filteredStudents.length})` 
                          : (isSomeFilteredSelected 
                              ? `Select remaining (${filteredStudents.filter(s => !selectedStudents.some(sel => sel.user_id === s.user_id)).length})` 
                              : `Select All (${filteredStudents.length})`
                            )
                        }
                      </span>
                    </div>

                    {/* Scrollable list */}
                    <div className="scrollable-students-list">
                      {filteredStudents.map(student => {
                        const isSelected = selectedStudents.some(sel => sel.user_id === student.user_id);
                        return (
                          <div 
                            key={student.user_id} 
                            className={`student-picker-row ${isSelected ? 'selected' : ''}`}
                            onClick={() => toggleStudentSelection(student)}
                          >
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => {}} // handled by row click
                              className="student-picker-checkbox"
                            />
                            {student.avatar ? (
                              <img src={student.avatar} alt="" className="picker-avatar" />
                            ) : (
                              <div className="picker-avatar-placeholder">
                                {student.first_name?.[0]}{student.last_name?.[0]}
                              </div>
                            )}
                            <div>
                              <div className="student-picker-name">{student.first_name} {student.last_name}</div>
                              <div className="student-picker-meta">{student.bfi_id || '—'} · No batch assigned</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="showing-count-label">
                      Showing {filteredStudents.length} of {availableStudents.length} students
                    </div>
                  </div>
                )}
              </div>

              {/* Panel Divider */}
              <div className="panel-divider"></div>

              {/* Right Panel: Selected Roster */}
              <div className="panel-right">
                <div className="right-panel-header">
                  <span>Selected ({selectedStudents.length})</span>
                  {selectedStudents.length > 0 && (
                    <button 
                      onClick={() => setSelectedStudents([])}
                      className="clear-all-btn"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {selectedStudents.length === 0 ? (
                  <div className="selected-empty-state">
                    No students selected yet. Check students on the left to add them.
                  </div>
                ) : (
                  <div className="scrollable-selected-list">
                    {selectedStudents.map(student => (
                      <div key={student.user_id} className="selected-student-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Check size={14} style={{ color: '#22c55e', flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <div className="selected-student-name">{student.first_name} {student.last_name}</div>
                            <div className="selected-student-id">{student.bfi_id}</div>
                          </div>
                        </div>
                        <button 
                          className="selected-student-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSelection(student.user_id);
                          }}
                          aria-label="Remove student"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Review Selection */}
          {currentStep === 2 && (
            <div className="review-step-container">
              {apiError && (
                <div className="batch-modal-error-banner" style={{ marginBottom: '1.5rem' }}>
                  <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                  <span>{apiError}</span>
                </div>
              )}

              <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                📋 You are about to add {selectedStudents.length} student{selectedStudents.length > 1 ? 's' : ''} to:
              </div>

              {/* Batch Info Card */}
              <div className="review-batch-card">
                <div className="review-batch-badge-col">
                  <span className="review-course-badge">🎬 FILMMAKING</span>
                </div>
                <div>
                  <h4 className="review-batch-title">{batchName}</h4>
                  <div className="review-batch-subtitle">{courseName} · Batch #{batchNumber}</div>
                </div>
              </div>

              <div style={{ marginBottom: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Students to be added:
              </div>

              {/* Scrollable list of students */}
              <div className="review-student-list">
                {selectedStudents.map((student, idx) => (
                  <div key={student.user_id} className="review-student-row">
                    <span className="review-row-num">{idx + 1}.</span>
                    {student.avatar ? (
                      <img src={student.avatar} alt="" className="picker-avatar" />
                    ) : (
                      <div className="picker-avatar-placeholder">
                        {student.first_name?.[0]}{student.last_name?.[0]}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="review-student-name">{student.first_name} {student.last_name}</span>
                    </div>
                    <span className="review-student-bfiid">{student.bfi_id}</span>
                  </div>
                ))}
              </div>

              {/* Amber warning box */}
              <div className="review-warning-box">
                <AlertTriangle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  Once added, their batch number will be set to #{batchNumber} and they will appear in Batch Fee Manager and Analytics for this batch.
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Done / Results */}
          {currentStep === 3 && submitResult && (
            <div className="done-step-container">
              <div className="done-success-center">
                {submitResult.assigned > 0 ? (
                  <CheckCircle2 size={56} className="success-icon" />
                ) : (
                  <XCircle size={56} className="success-icon" style={{ color: '#ef4444' }} />
                )}
                <h3 className="done-success-title">
                  {submitResult.assigned > 0 ? 'Assignment Complete' : 'Assignment Failed'}
                </h3>
                <p className="done-success-message">
                  {submitResult.assigned} student{submitResult.assigned !== 1 ? 's' : ''} successfully added to {batchName}
                </p>
              </div>

              {/* Successful/failed assignments list */}
              <div className="done-result-list">
                {selectedStudents.map(student => {
                  // Check if this student failed
                  const isError = submitResult.errors?.find(e => e.student_id === student.user_id);
                  if (isError) {
                    return (
                      <div key={student.user_id} className="done-result-row error">
                        <XCircle size={16} className="result-icon-error" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>{student.first_name} {student.last_name}</strong>
                          <span className="error-row-msg"> — {isError.message}</span>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div key={student.user_id} className="done-result-row success">
                        <CheckCircle2 size={16} className="result-icon-success" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>{student.first_name} {student.last_name}</strong>
                          <span className="success-row-msg"> added successfully</span>
                        </div>
                      </div>
                    );
                  }
                })}
              </div>

              {/* Error warning box if failures occurred */}
              {submitResult.errors && submitResult.errors.length > 0 && (
                <div className="review-warning-box" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#fca5a5' }}>
                  <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                  <div>
                    {submitResult.errors.length} student{submitResult.errors.length > 1 ? 's' : ''} could not be added (see above)
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        {/* Mobile bottom selected bar (for Step 1 on mobile viewport) */}
        {currentStep === 1 && selectedStudents.length > 0 && (
          <div className="mobile-selection-bar">
            <span style={{ fontSize: '14px', color: 'white', fontWeight: 600 }}>
              {selectedStudents.length} selected
            </span>
            <button 
              className="modern-btn modern-btn--primary"
              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
              onClick={() => setCurrentStep(2)}
            >
              Review
            </button>
          </div>
        )}

        <div className="batch-modal-footer">
          {currentStep === 1 && (
            <>
              <button 
                type="button" 
                className="btn btn-cancel" 
                onClick={onClose}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-submit"
                disabled={selectedStudents.length === 0}
                onClick={() => setCurrentStep(2)}
              >
                Next: Review ({selectedStudents.length}) →
              </button>
            </>
          )}

          {currentStep === 2 && (
            <>
              <button 
                type="button" 
                className="btn btn-cancel" 
                onClick={() => setCurrentStep(1)}
                disabled={isSubmitting}
                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button 
                type="button" 
                className="btn btn-cancel" 
                onClick={onClose}
                disabled={isSubmitting}
                style={{ marginLeft: 'auto' }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-submit"
                disabled={isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Adding students...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Add {selectedStudents.length} Student{selectedStudents.length > 1 ? 's' : ''}
                  </>
                )}
              </button>
            </>
          )}

          {currentStep === 3 && (
            <>
              <button 
                type="button" 
                className="btn btn-cancel" 
                onClick={handleAddMore}
              >
                Add More Students
              </button>
              <button 
                type="button" 
                className="btn btn-submit"
                onClick={() => onSuccess(submitResult.assigned)}
              >
                Done
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
