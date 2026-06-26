import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Users, Plus, Search, Calendar, UserCheck, MoreVertical, 
  Archive, Trash2, ChevronRight, BookOpen, Clock, CheckCircle2, Award, 
  AlertTriangle, ArrowLeft, X, Check, CreditCard, ShieldAlert, Edit3,
  Zap, Loader2
} from 'lucide-react';
import './BatchManager.css';
import BatchFormModal from '../../components/admin/BatchFormModal';

// Helpers
const formatNumber = (n) => {
  if (typeof n !== 'number') return n;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
};

const formatDateRange = (startDate, endDate) => {
  if (!startDate && !endDate) return <span style={{ color: 'var(--text-muted)' }}>No dates set</span>;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (startDate && endDate) {
    return `${formatDate(startDate)} → ${formatDate(endDate)}`;
  }
  if (startDate) {
    return `From ${formatDate(startDate)}`;
  }
  if (endDate) {
    return `Until ${formatDate(endDate)}`;
  }
};

const generateSlug = (name) => {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

// Reusable Stat Card
function StatCard({ icon, iconVariant, value, label, active = false }) {
  return (
    <div className={`stat-card ${active ? 'active' : ''}`}>
      <div className={`stat-card-icon ${iconVariant}`}>{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-value">{value != null ? formatNumber(value) : '—'}</div>
        <div className="stat-card-label" title={label}>{label}</div>
      </div>
    </div>
  );
}

const DEFAULT_BATCH_FORM = {
  batch_name: '',
  batch_number: '',
  course_name: 'Online Filmmaking Course',
  status: 'upcoming',
  start_date: '',
  end_date: '',
  description: ''
};

export default function BatchManager() {
  const [allBatches, setAllBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [activeStatusTab, setActiveStatusTab] = useState('all');
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  const [popoverAction, setPopoverAction] = useState(null); // { type: 'archive'|'delete', batchId }
  const [actionLoading, setActionLoading] = useState(false);
  const [leavingBatches, setLeavingBatches] = useState([]);
  const [enteringBatches, setEnteringBatches] = useState([]);
  const [toastMsg, setToastMsg] = useState('');

  // Details view states
  const { id: urlBatchId } = useParams();
  
  const selectedBatchId = useMemo(() => {
    if (!urlBatchId) return null;
    
    // First try exact ID match (just in case they have old links)
    if (/^\d+$/.test(urlBatchId)) {
      const exactMatch = allBatches.find(b => b.id.toString() === urlBatchId);
      if (exactMatch) return exactMatch.id;
    }
    
    // Fallback: match by generated slug of batch_name
    const slugMatch = allBatches.find(b => generateSlug(b.batch_name) === urlBatchId);
    if (slugMatch) return slugMatch.id;

    // Optimistic fallback for purely numeric IDs when allBatches isn't loaded yet
    if (allBatches.length === 0 && /^\d+$/.test(urlBatchId)) {
      return parseInt(urlBatchId, 10);
    }
    
    return null;
  }, [allBatches, urlBatchId]);
  
  const [batchDetails, setBatchDetails] = useState(null);
  const [batchStudents, setBatchStudents] = useState([]);
  const [batchProgress, setBatchProgress] = useState(null);
  const [detailsTab, setDetailsTab] = useState('students');
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [studentListSearch, setStudentListSearch] = useState('');

  // Modals
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);

  // Student Assignment Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [availableStudents, setAvailableStudents] = useState([]);
  const [selectedStudentsToAssign, setSelectedStudentsToAssign] = useState([]);
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  // Custom Confirm Modal
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

  const requestConfirm = (title, message, onConfirm) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Automation States
  const [automationRunning, setAutomationRunning] = useState(false);
  const [automationResult, setAutomationResult] = useState(null);
  const [showAutomationPanel, setShowAutomationPanel] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [timerTicks, setTimerTicks] = useState(0);

  const getRelativeTime = (date) => {
    if (!date) return 'never';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };

  useEffect(() => {
    if (!showAutomationPanel || !lastRunAt) return;
    const interval = setInterval(() => {
      setTimerTicks(t => t + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, [showAutomationPanel, lastRunAt]);

  const handleRunAutomation = async () => {
    setAutomationRunning(true);
    setAutomationResult(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/batches/run-automation', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      setAutomationResult(data);
      setShowAutomationPanel(true);
      setLastRunAt(new Date());

      // If any transitions happened, refresh the batch list
      if (data.transitions && data.transitions.length > 0) {
        await fetchBatches(); // re-fetch the full list to show updated statuses
      }

    } catch (error) {
      console.error('[BatchAutomation] Client trigger error:', error);
      setAutomationResult({ 
        success: false, 
        error: 'Failed to connect to server. Please try again.' 
      });
      setShowAutomationPanel(true);
    } finally {
      setAutomationRunning(false);
    }
  };

  // Fetch all batches
  const fetchBatches = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/batches', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setAllBatches(data || []);
      } else {
        console.error('Failed to fetch batches from server.');
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  // Close dropdowns on outside clicks and escape
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (activeDropdownId !== null && dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setActiveDropdownId(null);
      }
      if (popoverAction !== null && dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setPopoverAction(null);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setActiveDropdownId(null);
        setPopoverAction(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activeDropdownId, popoverAction]);

  // Show temporary feedback toast
  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  // Standard registered courses + any dynamic ones in database
  const courseOptions = useMemo(() => {
    const courses = new Set([
      'Online Filmmaking Course',
      'Film Appreciation Course',
      'Script Writing',
      'Cinematography',
      'Acting'
    ]);
    allBatches.forEach(b => {
      if (b.course_name) courses.add(b.course_name);
    });
    return Array.from(courses);
  }, [allBatches]);

  // Fetch batch details, students, and progress for Details View
  const fetchBatchDetailsData = async (id) => {
    try {
      setDetailsLoading(true);
      const token = localStorage.getItem('token');
      
      const [detailsRes, studentsRes, progressRes] = await Promise.all([
        fetch(`/api/admin/batches/${id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/admin/batches/${id}/students`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/admin/batches/${id}/progress`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (detailsRes.ok) {
        const det = await detailsRes.json();
        setBatchDetails(det);
      }
      if (studentsRes.ok) {
        const studs = await studentsRes.json();
        setBatchStudents(studs || []);
      }
      if (progressRes.ok) {
        const prog = await progressRes.json();
        setBatchProgress(prog);
      }
    } catch (e) {
      console.error('Error fetching batch details:', e);
      showToast('Error loading details');
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBatchId) {
      fetchBatchDetailsData(selectedBatchId);
    }
  // Also re-fire when allBatches loads so slug-based URLs resolve correctly
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, allBatches.length]);


  // Open Create Modal
  const handleCreateNewBatchClick = () => {
    setEditingBatch(null);
    setShowBatchModal(true);
  };

  // Open Edit Modal
  const handleEditClick = (batch) => {
    setEditingBatch(batch);
    setActiveDropdownId(null);
    setShowBatchModal(true);
  };

  // Toggle batch status directly (e.g. from archive)
  const handleArchiveBatch = (batchId) => {
    setActiveDropdownId(null);
    setPopoverAction({ type: 'archive', batchId });
  };

  const confirmArchive = async (batchId) => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/batches/${batchId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'archived' })
      });
      if (response.ok) {
        const batchName = allBatches.find(b => b.id === batchId)?.batch_name || 'Batch';
        showToast(`'${batchName}' has been archived`);
        
        // Update in place
        setAllBatches(prev => prev.map(b => b.id === batchId ? { ...b, status: 'archived' } : b));
        
        // If the active filter tab is NOT "All" or "Archived", animate out
        if (activeStatusTab !== 'all' && activeStatusTab !== 'archived') {
          setLeavingBatches(prev => [...prev, batchId]);
          setTimeout(() => {
            setAllBatches(prev => prev.filter(b => b.id !== batchId));
            setLeavingBatches(prev => prev.filter(x => x !== batchId));
          }, 300);
        }

        if (selectedBatchId === batchId) {
          fetchBatchDetailsData(batchId);
        }
      } else {
        showToast('Failed to archive batch. Please try again.');
      }
    } catch (error) {
      console.error('Error archiving batch:', error);
      showToast('Failed to archive batch. Please try again.');
    } finally {
      setActionLoading(false);
      setPopoverAction(null);
    }
  };

  // Delete batch
  const handleDeleteBatch = (batchId) => {
    setActiveDropdownId(null);
    setPopoverAction({ type: 'delete', batchId });
  };

  const confirmDelete = async (batchId) => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/batches/${batchId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        showToast('Batch permanently deleted');
        
        // Animate out
        setLeavingBatches(prev => [...prev, batchId]);
        setTimeout(() => {
          setAllBatches(prev => prev.filter(b => b.id !== batchId));
          setLeavingBatches(prev => prev.filter(x => x !== batchId));
          if (selectedBatchId === batchId) {
            navigate('/admin/batches');
          }
        }, 300);
      } else {
        const err = await response.json();
        if (response.status === 400) {
          showToast('Cannot delete: batch still has students or is not archived');
        } else {
          showToast(err.error || 'Failed to delete batch');
        }
      }
    } catch (error) {
      console.error('Error deleting batch:', error);
      showToast('Failed to delete batch');
    } finally {
      setActionLoading(false);
      setPopoverAction(null);
    }
  };

  // Student Allocation handlers
  const openAssignModal = async () => {
    setShowAssignModal(true);
    setAssignLoading(true);
    setSelectedStudentsToAssign([]);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/batches/${selectedBatchId}/available-students`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableStudents(data || []);
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to load students');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleAssignSubmit = async () => {
    if (selectedStudentsToAssign.length === 0) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/batches/${selectedBatchId}/students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ student_ids: selectedStudentsToAssign })
      });
      if (res.ok) {
        showToast(`Assigned ${selectedStudentsToAssign.length} students`);
        setShowAssignModal(false);
        fetchBatchDetailsData(selectedBatchId);
        fetchBatches();
      } else {
        const err = await res.json();
        showToast(err.error || 'Assignment failed');
      }
    } catch (e) {
      console.error(e);
      showToast('Connection error');
    }
  };

  const handleRemoveStudent = (studentId, studentName) => {
    // Use batchDetails.id (the real numeric DB id) as a reliable source of truth
    // rather than selectedBatchId which may still be resolving from a slug.
    const resolvedBatchId = batchDetails?.id || selectedBatchId;
    if (!resolvedBatchId) {
      showToast('Cannot remove: batch not loaded yet. Please wait a moment and try again.');
      return;
    }
    requestConfirm(
      'Remove Student',
      `Remove ${studentName} from this batch?`,
      async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/batches/${resolvedBatchId}/students/${studentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            showToast(`${studentName} removed from batch`);
            fetchBatchDetailsData(resolvedBatchId);
            fetchBatches();
          } else {
            const err = await res.json();
            showToast(err.error || 'Failed to remove student');
          }
        } catch (e) {
          console.error(e);
          showToast('Connection error');
        }
      }
    );
  };


  // Toggle selection inside multiselect list
  const toggleStudentSelection = (id) => {
    setSelectedStudentsToAssign(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Statistics calculations (client-side)
  const stats = useMemo(() => {
    let total = allBatches.length;
    let active = 0;
    let upcoming = 0;
    let completed = 0;

    allBatches.forEach(b => {
      if (b.status === 'active') active++;
      else if (b.status === 'upcoming') upcoming++;
      else if (b.status === 'completed') completed++;
    });

    return { total, active, upcoming, completed };
  }, [allBatches]);

  // Filter batches client-side
  const filteredBatches = useMemo(() => {
    return allBatches.filter(b => {
      // 1. Status Filter
      if (activeStatusTab !== 'all' && b.status !== activeStatusTab) {
        return false;
      }
      // 2. Course Filter
      if (selectedCourse !== 'all' && b.course_name !== selectedCourse) {
        return false;
      }
      // 3. Search Filter
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const nameMatch = b.batch_name?.toLowerCase().includes(q);
        const numberMatch = b.batch_number?.toLowerCase().includes(q);
        if (!nameMatch && !numberMatch) return false;
      }
      return true;
    });
  }, [allBatches, activeStatusTab, selectedCourse, searchQuery]);

  // Filter student list client-side
  const filteredStudents = useMemo(() => {
    if (!studentListSearch.trim()) return batchStudents;
    const terms = studentListSearch.toLowerCase().split(' ').filter(Boolean);
    
    return batchStudents.filter(s => {
      const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
      const bfiId = (s.bfi_id || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      
      // Every typed word must match somewhere in their profile data
      return terms.every(term => 
        fullName.includes(term) || 
        bfiId.includes(term) || 
        email.includes(term) || 
        phone.includes(term)
      );
    });
  }, [batchStudents, studentListSearch]);

  // Filter available students for multiselect
  const filteredAvailableStudents = useMemo(() => {
    if (!assignSearchQuery.trim()) return availableStudents;
    const terms = assignSearchQuery.toLowerCase().split(' ').filter(Boolean);
    
    return availableStudents.filter(s => {
      const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
      const bfiId = (s.bfi_id || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      
      // Every typed word must match somewhere in their profile data
      return terms.every(term => 
        fullName.includes(term) || 
        bfiId.includes(term) || 
        email.includes(term) || 
        phone.includes(term)
      );
    });
  }, [availableStudents, assignSearchQuery]);

  return (
    <div className="page-container container batch-manager-container">
      {/* Floating feedback toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          padding: '0.85rem 1.5rem',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          color: '#f8fafc',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          zIndex: 9999,
          backdropFilter: 'blur(8px)',
          animation: 'fadeIn 0.2s ease'
        }}>
          <CheckCircle2 size={16} className="text-success" />
          {toastMsg}
        </div>
      )}

      {selectedBatchId ? (
        /* ───────────────────────────────────────────────────────────────────
           BATCH DETAILS VIEW
           ─────────────────────────────────────────────────────────────────── */
        <div>
          {/* Header Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <button 
              onClick={() => { navigate('/admin/batches'); setBatchDetails(null); }} 
              className="modern-btn modern-btn--secondary" 
              style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', borderRadius: '8px' }}
            >
              <ArrowLeft size={16} /> Back to List
            </button>
            <h2 className="text-gradient" style={{ margin: 0, fontSize: '1.75rem' }}>Batch Dashboard</h2>
          </div>

          {detailsLoading || !batchDetails ? (
            <div className="skeleton-card" style={{ height: '400px' }} />
          ) : (
            <div>
              {/* Batch Header Info Card */}
              <div className="batch-details-header-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      <span className={`batch-status-badge ${batchDetails.status}`}>{batchDetails.status}</span>
                      <span className={`batch-course-badge ${batchDetails.course_name === 'Online Filmmaking Course' ? 'filmmaking' : 'workshop'}`}>
                        {batchDetails.course_name}
                      </span>
                    </div>
                    <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {batchDetails.batch_name}
                    </h1>
                    <p style={{ margin: '0 0 1rem 0', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '1rem' }}>
                      Batch Number: #{batchDetails.batch_number}
                    </p>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} style={{ opacity: 0.6 }} />
                        <span>{formatDateRange(batchDetails.start_date, batchDetails.end_date)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Users size={16} style={{ opacity: 0.6 }} />
                        <span>{batchDetails.student_count} Students Enrolled</span>
                      </div>
                    </div>
                    {batchDetails.description && (
                      <p style={{ margin: '1rem 0 0 0', fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        {batchDetails.description}
                      </p>
                    )}
                  </div>

                  {/* Actions right */}
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button 
                      onClick={() => handleEditClick(batchDetails)} 
                      className="modern-btn modern-btn--secondary" 
                      style={{ padding: '0.6rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <Edit3 size={16} /> Edit Details
                    </button>
                    {batchDetails.status !== 'archived' ? (
                      <button 
                        onClick={() => handleArchiveBatch(batchDetails.id)} 
                        className="modern-btn modern-btn--secondary" 
                        style={{ padding: '0.6rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <Archive size={16} /> Archive Batch
                      </button>
                    ) : (
                      batchDetails.student_count === 0 && (
                        <button 
                          onClick={() => handleDeleteBatch(batchDetails.id)} 
                          className="modern-btn modern-btn--danger" 
                          style={{ padding: '0.6rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          <Trash2 size={16} /> Delete Batch
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Main Content Details tabs grid */}
              <div className="details-grid">
                {/* Left side: Tab content */}
                <div className="details-panel glass-panel" style={{ padding: '1.5rem', borderRadius: '12px', minWidth: 0, maxWidth: '100%' }}>
                  {/* Tab list header */}
                  <div className="details-tabs-bar">
                    <button 
                      className={`details-tab-btn ${detailsTab === 'students' ? 'active' : ''}`}
                      onClick={() => setDetailsTab('students')}
                    >
                      Student Roster ({batchStudents.length})
                    </button>
                    <button 
                      className={`details-tab-btn ${detailsTab === 'progress' ? 'active' : ''}`}
                      onClick={() => setDetailsTab('progress')}
                    >
                      Roster Performance
                    </button>
                    <button 
                      className={`details-tab-btn ${detailsTab === 'finances' ? 'active' : ''}`}
                      onClick={() => setDetailsTab('finances')}
                    >
                      Fee Collections
                    </button>
                  </div>

                  {/* Tab content 1: Roster List */}
                  {detailsTab === 'students' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
                        <div className="input-wrapper" style={{ flex: 1, maxWidth: '300px' }}>
                          <Search className="input-icon" size={16} />
                          <input 
                            type="text" 
                            placeholder="Search students in batch..."
                            value={studentListSearch}
                            onChange={(e) => setStudentListSearch(e.target.value)}
                            className="input-glass"
                            style={{ paddingLeft: '2.2rem', fontSize: '0.85rem' }}
                          />
                        </div>
                        {batchDetails.status !== 'archived' && (
                          <button 
                            onClick={openAssignModal} 
                            className="modern-btn modern-btn--primary" 
                            style={{ padding: '0.6rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                          >
                            <Plus size={16} /> Assign Students
                          </button>
                        )}
                      </div>

                      {filteredStudents.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                          <Users size={32} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                          <p style={{ margin: 0 }}>No students matching criteria are in this batch.</p>
                        </div>
                      ) : (
                        <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                          <table className="student-list-table">
                            <thead>
                              <tr>
                                <th>Student Name</th>
                                <th>BFI ID</th>
                                <th>Phase 1</th>
                                <th>Phase 2</th>
                                <th>Fee Status</th>
                                {batchDetails.status !== 'archived' && <th style={{ textAlign: 'right' }}>Actions</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {filteredStudents.map(s => (
                                <tr key={s.user_id} className="student-list-row">
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                      {s.avatar ? (
                                        <img src={s.avatar} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                                      ) : (
                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                          {s.first_name?.[0]}{s.last_name?.[0]}
                                        </div>
                                      )}
                                      <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.first_name} {s.last_name}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{s.bfi_id || '—'}</td>
                                  <td>
                                    {s.phase1_completed ? (
                                      <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                                        <CheckCircle2 size={14} /> Complete
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Pending</span>
                                    )}
                                  </td>
                                  <td>
                                    {batchDetails.course_name === 'Online Filmmaking Course' ? (
                                      s.phase2_completed ? (
                                        <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                                          <CheckCircle2 size={14} /> Complete
                                        </span>
                                      ) : (
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Pending</span>
                                      )
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>N/A</span>
                                    )}
                                  </td>
                                  <td>
                                    {s.fee_status ? (
                                      <span className={`batch-status-badge ${s.fee_status.toLowerCase().replace(' ', '-')}`} style={{ fontSize: '0.7rem' }}>
                                        {s.fee_status}
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>—</span>
                                    )}
                                  </td>
                                  {batchDetails.status !== 'archived' && (
                                    <td style={{ textAlign: 'right' }}>
                                      <button 
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleRemoveStudent(s.user_id, `${s.first_name} ${s.last_name}`);
                                        }}
                                        className="modern-btn modern-btn--danger"
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}
                                        title="Remove from batch"
                                      >
                                        <Trash2 size={13} /> Remove
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab content 2: Performance metrics */}
                  {detailsTab === 'progress' && (
                    <div>
                      {batchProgress ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>Group Milestones</h3>
                          
                          {batchDetails.course_name === 'Online Filmmaking Course' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                              {/* Phase 1 Metrics */}
                              <div>
                                <h4 style={{ color: '#818cf8', margin: '0 0 1rem 0' }}>Phase 1 — Academic & Attendance</h4>
                                <div className="metric-cards-grid">
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val">{batchProgress.phase1?.admitted || 0}</span>
                                    <span className="metric-mini-lbl">Admitted to Phase 1</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val" style={{ color: '#34d399' }}>{batchProgress.phase1?.attendance_qualified || 0}</span>
                                    <span className="metric-mini-lbl">Attendance Qualified (≥80%)</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val">{batchProgress.phase1?.screenplay_submitted || 0}</span>
                                    <span className="metric-mini-lbl">Screenplays Submitted</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val">{batchProgress.phase1?.shooting_script_submitted || 0}</span>
                                    <span className="metric-mini-lbl">Shooting Scripts Submitted</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val" style={{ color: '#34d399' }}>{batchProgress.phase1?.exam_passed || 0}</span>
                                    <span className="metric-mini-lbl">Exams Passed / Graduated P1</span>
                                  </div>
                                </div>
                              </div>

                              {/* Phase 2 Metrics */}
                              <div>
                                <h4 style={{ color: '#a78bfa', margin: '0 0 1rem 0' }}>Phase 2 — Film Production</h4>
                                <div className="metric-cards-grid">
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val">{batchProgress.phase2?.admitted || 0}</span>
                                    <span className="metric-mini-lbl">Admitted to Phase 2</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val">{batchProgress.phase2?.shooting_attended || 0}</span>
                                    <span className="metric-mini-lbl">Shooting Workshops Attended</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val">{batchProgress.phase2?.editing_attended || 0}</span>
                                    <span className="metric-mini-lbl">Editing Workshops Attended</span>
                                  </div>
                                  <div className="metric-mini-card">
                                    <span className="metric-mini-val" style={{ color: '#a78bfa' }}>{batchProgress.phase2?.completed || 0}</span>
                                    <span className="metric-mini-lbl">Phase 2 Graduated</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Workshop Single Phase Metrics */
                            <div>
                              <h4 style={{ color: '#38bdf8', margin: '0 0 1rem 0' }}>Workshop Progress Metrics</h4>
                              <div className="metric-cards-grid">
                                <div className="metric-mini-card">
                                  <span className="metric-mini-val">{batchProgress.single_phase?.admitted || 0}</span>
                                  <span className="metric-mini-lbl">Registered Participants</span>
                                </div>
                                <div className="metric-mini-card">
                                  <span className="metric-mini-val">{batchProgress.single_phase?.attendance || 0}</span>
                                  <span className="metric-mini-lbl">Attended Classes</span>
                                </div>
                                <div className="metric-mini-card">
                                  <span className="metric-mini-val">{batchProgress.single_phase?.assignment_submitted || 0}</span>
                                  <span className="metric-mini-lbl">Assignments Submitted</span>
                                </div>
                                <div className="metric-mini-card">
                                  <span className="metric-mini-val" style={{ color: '#34d399' }}>{batchProgress.single_phase?.completed || 0}</span>
                                  <span className="metric-mini-lbl">Completed Workshop</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>No progress metrics available</div>
                      )}
                    </div>
                  )}

                  {/* Tab content 3: Finances */}
                  {detailsTab === 'finances' && (
                    <div>
                      {batchProgress?.fees ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                          <div>
                            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem' }}>Roster Fee Collection Summary</h3>
                            <div className="metric-cards-grid">
                              <div className="metric-mini-card">
                                <span className="metric-mini-val" style={{ color: '#34d399' }}>৳{batchProgress.fees.total_collected.toLocaleString()}</span>
                                <span className="metric-mini-lbl">Total Fees Collected</span>
                              </div>
                              <div className="metric-mini-card">
                                <span className="metric-mini-val" style={{ color: '#f43f5e' }}>৳{batchProgress.fees.total_outstanding.toLocaleString()}</span>
                                <span className="metric-mini-lbl">Total Outstanding Balance</span>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem' }}>Roster Allocation</h3>
                            <div className="metric-cards-grid">
                              <div className="metric-mini-card">
                                <span className="metric-mini-val">{batchProgress.fees.fully_paid}</span>
                                <span className="metric-mini-lbl">Fully Paid Students</span>
                              </div>
                              <div className="metric-mini-card">
                                <span className="metric-mini-val">{batchProgress.fees.partial}</span>
                                <span className="metric-mini-lbl">Partially Paid Students</span>
                              </div>
                              <div className="metric-mini-card">
                                <span className="metric-mini-val">{batchProgress.fees.due}</span>
                                <span className="metric-mini-lbl">Students with Overdue Fees</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>No finance details available</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right side: Sidebar Info cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Credentials / Certificate Designer metrics */}
                  <div className="glass-panel" style={{ padding: '1.5rem', borderRadius: '12px' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                      <Award size={18} style={{ color: '#a78bfa' }} /> Certificates Issued
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Issued count</span>
                        <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#34d399' }}>{batchProgress?.certificates?.issued || 0}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Pending generation</span>
                        <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#fbbf24' }}>{batchProgress?.certificates?.pending || 0}</span>
                      </div>
                    </div>
                  </div>

                  {/* Operational Summary */}
                  <div className="glass-panel" style={{ padding: '1.5rem', borderRadius: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <ShieldAlert size={18} style={{ color: '#fbbf24' }} /> Operations Guide
                    </h3>
                    <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', lineHeight: 1.5 }}>
                      <li>Ensure student records and course fees are settled before finalizing completions.</li>
                      <li>To delete a batch, you must first **remove all students** from its roster and set the batch status to **Archived**.</li>
                      <li>Modifying the batch number updates the enrollment reference keys for all associated students automatically.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ───────────────────────────────────────────────────────────────────
           BATCH LIST VIEW (DEFAULT)
           ─────────────────────────────────────────────────────────────────── */
        <div>
          {/* Top Header Row */}
          <div className="registry-header" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="registry-header-content">
              <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Users size={32} style={{ color: 'var(--accent-primary, #6366f1)' }} /> Batch Manager
              </h1>
              <p className="subtitle" style={{ margin: 0 }}>
                Create and manage student batches by course
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                onClick={handleRunAutomation} 
                disabled={automationRunning}
                className="modern-btn btn-automation" 
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', borderRadius: '8px' }}
                title={lastRunAt ? `Last run: ${getRelativeTime(lastRunAt)}` : 'Never run this session'}
              >
                {automationRunning ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Zap size={18} />
                )}
                {automationRunning ? 'Checking...' : '⚡ Run Status Check'}
              </button>
              <button onClick={handleCreateNewBatchClick} className="modern-btn modern-btn--primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', borderRadius: '8px' }}>
                <Plus size={18} /> Create New Batch
              </button>
            </div>
          </div>

          {/* Automation Result Panel */}
          {showAutomationPanel && automationResult && (
            <div className="automation-result-panel glass-panel animate-down">
              <div className="panel-header">
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                  <Zap size={18} style={{ color: '#F59E0B' }} /> Automation Run Complete
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Last run: {getRelativeTime(lastRunAt)}
                  </span>
                  <button 
                    onClick={() => setShowAutomationPanel(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem' }}
                    title="Close Panel"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {automationResult.success === false ? (
                <div style={{ color: '#ef4444', fontSize: '0.95rem' }}>
                  ⚠️ Error: {automationResult.error || 'Automation run failed'}
                </div>
              ) : (
                <div>
                  <div className="automation-summary-stats">
                    <span style={{ 
                      fontSize: '0.9rem', 
                      fontWeight: 600,
                      color: (automationResult.transitions && automationResult.transitions.length > 0) ? '#22C55E' : 'var(--text-muted)' 
                    }}>
                      ✅ {automationResult.transitions?.length || 0} batches updated
                    </span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      📋 {automationResult.batches_checked || 0} batches checked
                    </span>
                    <span style={{ 
                      fontSize: '0.9rem', 
                      fontWeight: 600,
                      color: (automationResult.errors && automationResult.errors.length > 0) ? '#ef4444' : 'var(--text-muted)' 
                    }}>
                      ⚠️ {automationResult.errors?.length || 0} errors
                    </span>
                  </div>

                  {(!automationResult.transitions || automationResult.transitions.length === 0) ? (
                    <div className="automation-no-changes">
                      ✓ All batches are up to date — no changes needed
                    </div>
                  ) : (
                    <div className="automation-transition-list">
                      {automationResult.transitions.map((t, idx) => (
                        <div key={idx} className="automation-transition-row">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '1.1rem' }}>
                                {t.to_status === 'active' ? '🟢' : '✅'}
                              </span>
                              <strong style={{ color: 'white' }}>{t.batch_name}</strong>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {t.from_status} → 
                              </span>
                              <span className={`batch-status-badge ${t.to_status}`}>
                                {t.to_status}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              {t.reason}
                            </span>
                          </div>
                          <button
                            onClick={() => navigate(`/admin/batches/${generateSlug(t.batch_name)}`)}
                            className="modern-btn modern-btn--secondary"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                          >
                            View →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {automationResult.errors && automationResult.errors.length > 0 && (
                    <div className="automation-errors">
                      <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertTriangle size={16} /> Errors ({automationResult.errors.length})
                      </div>
                      <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#fca5a5', fontSize: '0.85rem' }}>
                        {automationResult.errors.map((err, idx) => (
                          <li key={idx}>
                            • Batch &ldquo;{err.batch_name}&rdquo; &mdash; {err.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Summary Stats Row */}
          <div className="batch-stats-row">
            <StatCard 
              icon={<Users size={18} />} 
              iconVariant="blue" 
              value={stats.total} 
              label="Total Batches" 
            />
            <StatCard 
              icon={<Clock size={18} />} 
              iconVariant="green" 
              value={stats.active} 
              label="Active Batches" 
            />
            <StatCard 
              icon={<BookOpen size={18} />} 
              iconVariant="sky" 
              value={stats.upcoming} 
              label="Upcoming Batches" 
            />
            <StatCard 
              icon={<Award size={18} />} 
              iconVariant="purple" 
              value={stats.completed} 
              label="Completed Batches" 
            />
          </div>

          {/* Filter Bar */}
          <div className="batch-filter-bar">
            {/* Left Status Tabs */}
            <div className="filter-left-tabs">
              {['all', 'upcoming', 'active', 'completed', 'archived'].map(tab => (
                <button 
                  key={tab}
                  onClick={() => setActiveStatusTab(tab)}
                  className={`filter-tab-btn ${activeStatusTab === tab ? 'active' : ''}`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Middle Course Select */}
            <div className="filter-middle-select">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Course:</span>
              <select 
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                className="input-glass"
                style={{ padding: '0.4rem 2rem 0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '180px', height: 'auto' }}
              >
                <option value="all">All Courses</option>
                {courseOptions.map((c, idx) => (
                  <option key={idx} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Right Search Input */}
            <div className="filter-right-search input-wrapper">
              <Search className="input-icon" size={16} />
              <input 
                type="text"
                placeholder="Search by batch name or number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-glass"
                style={{ paddingLeft: '2.2rem', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          {/* Main Grid / Content Area */}
          {loading ? (
            <div className="batch-grid">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="skeleton-card" />
              ))}
            </div>
          ) : filteredBatches.length === 0 ? (
            <div className="batch-empty-state glass-panel">
              <Users size={48} className="empty-icon" />
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: 'var(--text-primary)' }}>No batches found</h3>
              <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                {allBatches.length === 0 
                  ? 'Create your first batch to get started.' 
                  : 'Try adjusting your filters.'}
              </p>
              <button onClick={handleCreateNewBatchClick} className="modern-btn modern-btn--primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={16} /> Create New Batch
              </button>
            </div>
          ) : (
            <div className="batch-grid">
              {filteredBatches.map(b => {
                const hasStudents = b.student_count > 0;
                const isFilmmaking = b.course_name === 'Online Filmmaking Course';
                const isWorkshop = [
                  'Film Appreciation Course',
                  'Script Writing',
                  'Cinematography',
                  'Acting'
                ].includes(b.course_name);
                
                let badgeClass = 'other';
                let badgeLabel = b.course_name || 'COURSE';
                if (isFilmmaking) {
                  badgeClass = 'filmmaking';
                } else if (isWorkshop) {
                  badgeClass = 'workshop';
                }

                return (
                  <div key={b.id} className={`batch-card ${leavingBatches.includes(b.id) ? 'batch-card-leaving' : ''} ${enteringBatches.includes(b.id) ? 'batch-card-entering' : ''}`}>
                    {/* Header Row */}
                    <div className="batch-card-header">
                      <span className={`batch-status-badge ${b.status}`}>{b.status}</span>
                      <span className={`batch-course-badge ${badgeClass}`} title={b.course_name}>{badgeLabel}</span>
                    </div>

                    {/* Title & Subtitle */}
                    <div>
                      <h3 className="batch-card-title">{b.batch_name}</h3>
                      <p className="batch-card-subtitle">Batch #{b.batch_number}</p>
                    </div>

                    {/* Metadata details */}
                    <div className="batch-card-meta">
                      <div className="meta-row">
                        <Calendar size={15} style={{ opacity: 0.6 }} />
                        <span style={{ fontSize: '0.85rem' }}>
                          {formatDateRange(b.start_date, b.end_date)}
                        </span>
                      </div>
                      <div className={`meta-row ${!hasStudents ? 'muted' : ''}`}>
                        <UserCheck size={15} style={{ opacity: 0.6 }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: hasStudents ? 500 : 400 }}>
                          {hasStudents ? `${b.student_count} Students` : 'No students yet'}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {hasStudents && (
                      <div className="batch-progress-wrapper" style={{ marginTop: '0.5rem' }}>
                        <div className="batch-progress-bar-track">
                          <div 
                            className="batch-progress-bar-fill" 
                            style={{ width: `${b.phase1_completed_count != null ? (b.phase1_completed_count / b.student_count) * 100 : 0}%` }} 
                          />
                        </div>
                        <div className="batch-progress-label">
                          {b.phase1_completed_count != null 
                            ? `${b.phase1_completed_count} of ${b.student_count} completed Phase 1`
                            : 'No progress data yet'}
                        </div>
                      </div>
                    )}

                    {/* Bottom Actions Row */}
                    <div className="batch-card-actions">
                      <button 
                        onClick={() => navigate(`/admin/batches/${generateSlug(b.batch_name)}`)}
                        className="modern-btn modern-btn--secondary"
                        style={{ flex: 1, padding: '0.45rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                      >
                        View Details
                      </button>
                      <button 
                        onClick={() => handleEditClick(b)}
                        className="modern-btn modern-btn--secondary"
                        style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                      >
                        Edit
                      </button>
                      
                      {/* Three Dots custom popover menu */}
                      <div className="three-dots-wrapper" ref={activeDropdownId === b.id || popoverAction?.batchId === b.id ? dropdownRef : null}>
                        <button 
                          onClick={() => {
                            if (activeDropdownId === b.id || popoverAction?.batchId === b.id) {
                              setActiveDropdownId(null);
                              setPopoverAction(null);
                            } else {
                              setPopoverAction(null);
                              setActiveDropdownId(b.id);
                            }
                          }}
                          className="modern-btn modern-btn--secondary"
                          style={{ padding: '0.45rem 0.55rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="More Options"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {activeDropdownId === b.id && !popoverAction && (
                          <div className="dropdown-menu-custom">
                            {b.status !== 'archived' && (
                              <button 
                                onClick={() => handleArchiveBatch(b.id)}
                                className="dropdown-item-custom"
                              >
                                <Archive size={14} /> Archive Batch
                              </button>
                            )}
                            {b.student_count === 0 && b.status === 'archived' ? (
                              <button 
                                onClick={() => handleDeleteBatch(b.id)}
                                className="dropdown-item-custom danger"
                              >
                                <Trash2 size={14} /> Delete Batch
                              </button>
                            ) : null}
                          </div>
                        )}

                        {/* Inline Confirm Popover */}
                        {popoverAction?.batchId === b.id && (
                          <div className="batch-confirm-popover" style={{ bottom: '120%', right: 0 }}>
                            {popoverAction.type === 'archive' ? (
                              <>
                                <Archive size={24} color="#f59e0b" className="batch-confirm-popover-icon" />
                                <h4 className="batch-confirm-popover-title">Archive '{b.batch_name}'?</h4>
                                <p className="batch-confirm-popover-subtitle">
                                  Archived batches are hidden from the active view. Students remain assigned.
                                </p>
                                <div className="batch-confirm-popover-actions">
                                  <button 
                                    className="btn btn-cancel" 
                                    onClick={() => setPopoverAction(null)}
                                    disabled={actionLoading}
                                  >
                                    Cancel
                                  </button>
                                  <button 
                                    className="btn btn-submit" 
                                    style={{ background: '#f59e0b', borderColor: '#f59e0b' }}
                                    onClick={() => confirmArchive(b.id)}
                                    disabled={actionLoading}
                                  >
                                    {actionLoading ? <span className="spin" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }}></span> : 'Archive'}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <Trash2 size={24} color="#ef4444" className="batch-confirm-popover-icon" />
                                <h4 className="batch-confirm-popover-title">Permanently delete '{b.batch_name}'?</h4>
                                <p className="batch-confirm-popover-subtitle" style={{ color: '#ef4444' }}>
                                  This action cannot be undone. All batch data will be permanently removed.
                                </p>
                                <div className="batch-confirm-popover-actions">
                                  <button 
                                    className="btn btn-cancel" 
                                    onClick={() => setPopoverAction(null)}
                                    disabled={actionLoading}
                                  >
                                    Cancel
                                  </button>
                                  <button 
                                    className="btn btn-submit" 
                                    style={{ background: '#ef4444', borderColor: '#ef4444' }}
                                    onClick={() => confirmDelete(b.id)}
                                    disabled={actionLoading}
                                  >
                                    {actionLoading ? <span className="spin" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }}></span> : 'Delete Forever'}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────
         CREATE/EDIT BATCH MODAL
         ─────────────────────────────────────────────────────────────────── */}
      <BatchFormModal
        mode={editingBatch ? "edit" : "create"}
        batch={editingBatch}
        isOpen={showBatchModal}
        onClose={() => {
          setShowBatchModal(false);
          setEditingBatch(null);
        }}
        onSuccess={(savedBatch) => {
          showToast(`Batch ${editingBatch ? 'updated' : 'created'} successfully`);
          setShowBatchModal(false);
          
          if (editingBatch) {
            setAllBatches(prev => prev.map(b => b.id === savedBatch.id ? { ...b, ...savedBatch } : b));
            if (activeStatusTab !== 'all' && activeStatusTab !== savedBatch.status) {
              setLeavingBatches(prev => [...prev, savedBatch.id]);
              setTimeout(() => {
                setAllBatches(prev => prev.filter(b => b.id !== savedBatch.id));
                setLeavingBatches(prev => prev.filter(x => x !== savedBatch.id));
              }, 300);
            }
          } else {
            setEnteringBatches(prev => [...prev, savedBatch.id]);
            setAllBatches(prev => [savedBatch, ...prev]);
            setTimeout(() => {
              setEnteringBatches(prev => prev.filter(x => x !== savedBatch.id));
            }, 400);
          }
          
          setEditingBatch(null);
          if (selectedBatchId && editingBatch) {
            fetchBatchDetailsData(selectedBatchId);
          }
        }}
      />

      {/* ───────────────────────────────────────────────────────────────────
         ASSIGN STUDENTS MODAL
         ─────────────────────────────────────────────────────────────────── */}
      {showAssignModal && (
        <div className="modern-modal-overlay">
          <div className="modern-modal-content glass-panel shadow-2xl" style={{ maxWidth: '500px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="text-gradient" style={{ margin: 0, fontSize: '1.4rem' }}>
                Assign Students to {batchDetails?.batch_name}
              </h3>
              <button className="icon-btn-ghost" onClick={() => setShowAssignModal(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modern-modal-body" style={{ padding: '1.5rem' }}>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Showing students who are not currently assigned to any batch.
              </p>

              {/* Search Available Students */}
              <div className="input-wrapper" style={{ marginBottom: '1rem' }}>
                <Search className="input-icon" size={16} />
                <input 
                  type="text" 
                  placeholder="Search available students..."
                  value={assignSearchQuery}
                  onChange={(e) => setAssignSearchQuery(e.target.value)}
                  className="input-glass"
                  style={{ paddingLeft: '2.2rem', fontSize: '0.85rem' }}
                />
              </div>

              {assignLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>Loading roster...</div>
              ) : filteredAvailableStudents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                  No unassigned students found.
                </div>
              ) : (
                <div className="multiselect-container">
                  {filteredAvailableStudents.map(s => {
                    const isSelected = selectedStudentsToAssign.includes(s.user_id);
                    return (
                      <div 
                        key={s.user_id}
                        onClick={() => toggleStudentSelection(s.user_id)}
                        className={`multiselect-item ${isSelected ? 'selected' : ''}`}
                      >
                        <div style={{ 
                          width: '18px', 
                          height: '18px', 
                          borderRadius: '4px', 
                          border: '1px solid rgba(255,255,255,0.2)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          background: isSelected ? 'var(--accent-primary, #6366f1)' : 'transparent',
                          borderColor: isSelected ? 'var(--accent-primary, #6366f1)' : 'rgba(255,255,255,0.2)'
                        }}>
                          {isSelected && <Check size={12} color="white" />}
                        </div>
                        
                        {s.avatar ? (
                          <img src={s.avatar} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>
                            {s.first_name?.[0]}{s.last_name?.[0]}
                          </div>
                        )}

                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {s.first_name} {s.last_name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            ID: {s.bfi_id || '—'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem', padding: '1rem 1.5rem' }}>
              <button type="button" onClick={() => setShowAssignModal(false)} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleAssignSubmit} 
                disabled={selectedStudentsToAssign.length === 0} 
                className="modern-btn modern-btn--primary" 
                style={{ flex: 1 }}
              >
                Assign ({selectedStudentsToAssign.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="modern-modal-overlay">
          <div className="modern-modal-content glass-panel shadow-2xl" style={{ maxWidth: '450px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="text-gradient" style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={24} style={{ color: '#ef4444' }} /> {confirmModal.title}
              </h3>
              <button className="icon-btn-ghost" onClick={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modern-modal-body" style={{ padding: '1.5rem' }}>
              <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6', fontSize: '1rem' }}>
                {confirmModal.message}
              </p>
            </div>
            
            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem', padding: '1rem 1.5rem' }}>
              <button 
                onClick={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })} 
                className="modern-btn modern-btn--secondary"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (confirmModal.onConfirm) confirmModal.onConfirm();
                  setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
                }} 
                className="modern-btn modern-btn--danger"
                style={{ flex: 1 }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
