import React, { useState, useEffect } from 'react';
import { Wallet, Search, Filter, Download, ArrowRight, CheckCircle, Clock, AlertCircle, ChevronDown, ChevronUp, GraduationCap, Clapperboard, Edit, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { getOrdinalSuffix } from '../../utils/formatUtils';
import './FeeTracker.css';
import { Link, useNavigate } from 'react-router-dom';
import EditStudentModal from '../../components/admin/EditStudentModal';

const FeeTracker = () => {
  const navigate = useNavigate();
  const [data, setData] = useState({
    students: [],
    summary: { totalCollected: 0, totalOutstanding: 0, paidCount: 0, partialCount: 0, dueCount: 0, overdueCount: 0 },
    batches: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState(''); // '', 'paid', 'partial', 'due', 'overdue'
  const [courseFilter, setCourseFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Toasts
  const [toasts, setToasts] = useState([]);
  
  // Sending state
  const [sendingReminderFor, setSendingReminderFor] = useState(null);
  
  // Edit modal state
  const [editingStudent, setEditingStudent] = useState(null);

  // --- Start of Copied Modals State ---
  const [academicStudent, setAcademicStudent] = useState(null);
  const [academicCourseId, setAcademicCourseId] = useState(null);
  const [academicFormData, setAcademicFormData] = useState({});
  const [isAcademicSaving, setIsAcademicSaving] = useState(false);
  const [academicError, setAcademicError] = useState('');

  const [phase2Student, setPhase2Student] = useState(null);
  const [phase2CourseId, setPhase2CourseId] = useState(null);
  const [phase2FormData, setPhase2FormData] = useState({});
  const [isPhase2Saving, setIsPhase2Saving] = useState(false);
  const [phase2Error, setPhase2Error] = useState('');

  const [confirmConfig, setConfirmConfig] = useState(null);
  // --- End of Copied Modals State ---


  const fetchFeeData = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (statusFilter) queryParams.append('status', statusFilter);
      if (courseFilter) queryParams.append('course', courseFilter);
      if (batchFilter) queryParams.append('batch', batchFilter);
      if (searchQuery) queryParams.append('search', searchQuery);

      const res = await fetch(`/api/admin/fee-tracker/students?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch fee data');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Could not load fee tracker data.');
    } finally {
      setLoading(false);
    }
  };


  const handleSaveSuccess = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (statusFilter) queryParams.append('status', statusFilter);
      if (courseFilter) queryParams.append('course', courseFilter);
      if (batchFilter) queryParams.append('batch', batchFilter);
      if (searchQuery) queryParams.append('search', searchQuery);

      const res = await fetch('/api/admin/fee-tracker/students?' + queryParams.toString(), {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
      });
      if (!res.ok) throw new Error('Failed to fetch fee data');
      const json = await res.json();
      
      setData(prev => {
        const updatedStudents = prev.students.map(s => {
          const fetchedStudent = json.students.find(fs => fs.user_id === s.user_id && fs.course_name === s.course_name);
          return fetchedStudent ? fetchedStudent : s; 
        });
        return { ...prev, summary: json.summary, students: updatedStudents };
      });
    } catch (err) {
      console.error(err);
    }
  };

  const fetchFullStudent = async (userId) => {
    const res = await fetch('/api/admin/students/' + userId, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!res.ok) throw new Error('Failed to fetch student details');
    const { student } = await res.json();
    return student;
  };

  const openAcademicModal = async (s) => {
    try {
      const fullStudent = await fetchFullStudent(s.user_id);
      const enrollment = fullStudent.enrollments?.find(e => e.course_name === s.course_name);
      if (!enrollment) throw new Error('Enrollment not found for this course.');

      const isOnlineFilmmaking = enrollment.course_name === 'Online Filmmaking Course';
      const isAdmitted = isOnlineFilmmaking ? enrollment.step3_completed === 1 : enrollment.step1_completed === 1;

      if (!isAdmitted) {
        setConfirmConfig({
          title: 'Action Restricted',
          message: isOnlineFilmmaking
            ? 'Cannot update academic records because Phase 2: Admitted is not yet completed.'
            : 'Cannot update exam results because Admission Confirmed is not yet completed.',
          confirmText: 'OK',
          isAlert: true,
          onConfirm: () => {}
        });
        return;
      }

      setAcademicStudent({ ...fullStudent, enrollment });
      setAcademicCourseId(enrollment.id);
      setAcademicFormData({
        attendance_classes: enrollment.attendance_classes || '',
        attendance_total: enrollment.attendance_total || '',
        exam_written: enrollment.exam_written || '',
        assignment_screenplay: enrollment.assignment_screenplay || '',
        assignment_shooting_script: enrollment.assignment_shooting_script || ''
      });
    } catch (err) { addToast(err.message, 'error'); }
  };

  const closeAcademicModal = () => { setAcademicStudent(null); setAcademicCourseId(null); };
  const handleAcademicChange = (e) => setAcademicFormData({ ...academicFormData, [e.target.name]: e.target.value });
  const submitAcademic = async (e) => {
    e.preventDefault();
    setIsAcademicSaving(true);
    setAcademicError('');
    try {
      const res = await fetch('/api/admin/students/' + academicStudent.id + '/academic-records/' + academicCourseId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
        body: JSON.stringify(academicFormData)
      });
      if (res.ok) { handleSaveSuccess(); closeAcademicModal(); } 
      else { const data = await res.json(); throw new Error(data.error || 'Failed to save academic records'); }
    } catch (err) { setAcademicError(err.message); } 
    finally { setIsAcademicSaving(false); }
  };

  const openPhase2Modal = async (s) => {
    try {
      const fullStudent = await fetchFullStudent(s.user_id);
      const enrollment = fullStudent.enrollments?.find(e => e.course_name === 'Online Filmmaking Course');
      if (!enrollment) throw new Error('Online Filmmaking Course enrollment not found.');

      setPhase2Student({ ...fullStudent, enrollment });
      setPhase2CourseId(enrollment.id);
      setPhase2FormData({
        phase2_shooting_attended: !!(enrollment.phase2_shooting_attended),
        phase2_editing_attended: !!(enrollment.phase2_editing_attended)
      });
    } catch (err) { addToast(err.message, 'error'); }
  };

  const closePhase2Modal = () => { setPhase2Student(null); setPhase2CourseId(null); };
  const handlePhase2Change = (e) => setPhase2FormData({ ...phase2FormData, [e.target.name]: e.target.checked });
  const submitPhase2 = async (e) => {
    e.preventDefault();
    setIsPhase2Saving(true);
    setPhase2Error('');
    try {
      const res = await fetch('/api/admin/students/' + phase2Student.id + '/phase2-attendance/' + phase2CourseId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
        body: JSON.stringify(phase2FormData)
      });
      if (res.ok) { handleSaveSuccess(); closePhase2Modal(); } 
      else { const data = await res.json(); throw new Error(data.error || 'Failed to save Phase 2 attendance'); }
    } catch (err) { setPhase2Error(err.message); } 
    finally { setIsPhase2Saving(false); }
  };

  const confirmDeleteStudent = async (s) => {
    setConfirmConfig({
      type: 'danger',
      title: 'Delete Student',
      message: `Are you sure you want to delete ${s.full_name} (${s.batch_number ? 'B-' + s.batch_number : 'No Batch'})? This action cannot be undone.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/students/' + s.user_id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
          });
          if (!res.ok) throw new Error('Failed to delete student');
          setData(prev => ({ ...prev, students: prev.students.filter(student => student.user_id !== s.user_id) }));
          handleSaveSuccess();
          addToast('Student deleted successfully', 'success');
        } catch (err) { addToast(err.message, 'error'); }
      }
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batchParam = params.get('batch');
    if (batchParam) {
      setBatchFilter(batchParam);
    }
  }, []);

  useEffect(() => {
    // Debounce search slightly
    const timer = setTimeout(() => {
      fetchFeeData();
    }, 300);
    return () => clearTimeout(timer);
  }, [statusFilter, courseFilter, batchFilter, searchQuery]);

  const addToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleSendReminder = async (student) => {
    if (student.reminder_sent_today) {
      addToast('Reminder already sent today', 'error');
      return;
    }
    
    setSendingReminderFor(student.user_id);
    try {
      const res = await fetch('/api/admin/fee-tracker/send-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          student_id: student.user_id,
          course_name: student.course_name,
          due_amount: student.outstanding,
          next_due_date: student.next_due_date
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send reminder');
      }
      
      addToast('Reminder sent successfully');
      
      // Update local state to show reminder sent
      setData(prev => ({
        ...prev,
        students: prev.students.map(s => 
          s.user_id === student.user_id ? { ...s, reminder_sent_today: true } : s
        )
      }));
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSendingReminderFor(null);
    }
  };

  const handleExport = () => {
    const queryParams = new URLSearchParams();
    if (statusFilter) queryParams.append('status', statusFilter);
    if (courseFilter) queryParams.append('course', courseFilter);
    if (batchFilter) queryParams.append('batch', batchFilter);
    if (searchQuery) queryParams.append('search', searchQuery);

    const token = localStorage.getItem('token');
    // Using window.open for file download
    window.open(`/api/admin/fee-tracker/export?${queryParams.toString()}&token=${token}`, '_blank');
  };

  const { summary } = data;

  return (
    <div className="ft-page">
      <div className="ft-header">
        <div className="ft-title-area">
          <h1><Wallet className="ft-icon" /> Fee Tracker</h1>
          <p>Monitor student payments, send reminders, and track outstanding fees.</p>
        </div>
        <div className="ft-header-actions">
          <Link to="/admin/additional-options?view=batch-fees" className="ft-btn ft-btn-secondary">
            ⚙️ Batch Fee Manager
          </Link>
          <button onClick={handleExport} className="ft-btn ft-btn-primary">
            <Download size={18} /> Export to Excel
          </button>
        </div>
      </div>

      <div className="ft-summary-cards">
        <div className="ft-card ft-card-total">
          <div className="ft-card-icon"><Wallet /></div>
          <div className="ft-card-info">
            <h3>Total Collected</h3>
            <p>৳{summary.totalCollected.toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="ft-card ft-card-outstanding">
          <div className="ft-card-icon"><Clock /></div>
          <div className="ft-card-info">
            <h3>Total Outstanding</h3>
            <p>৳{summary.totalOutstanding.toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="ft-card ft-card-paid">
          <div className="ft-card-icon"><CheckCircle /></div>
          <div className="ft-card-info">
            <h3>Fully Paid</h3>
            <p>{summary.paidCount}</p>
          </div>
        </div>
        <div className="ft-card ft-card-partial">
          <div className="ft-card-icon"><ArrowRight /></div>
          <div className="ft-card-info">
            <h3>Partial</h3>
            <p>{summary.partialCount}</p>
          </div>
        </div>
        <div className="ft-card ft-card-due">
          <div className="ft-card-icon"><AlertCircle /></div>
          <div className="ft-card-info">
            <h3>Due / Unpaid</h3>
            <p>{summary.dueCount}</p>
          </div>
        </div>
        <div className={`ft-card ft-card-overdue ${summary.overdueCount > 0 ? 'pulse' : ''}`}>
          <div className="ft-card-icon"><AlertCircle /></div>
          <div className="ft-card-info">
            <h3>Overdue</h3>
            <p>{summary.overdueCount}</p>
          </div>
        </div>
      </div>

      <div className="ft-filters">
        <div className="ft-filter-controls">
          <select 
            value={statusFilter} 
            onChange={e => setStatusFilter(e.target.value)} 
            className="ft-select"
            style={{ width: '160px' }}
          >
            <option value="">— Select Status —</option>
            <option value="paid" style={{ color: '#4ade80' }}>✅ Paid Full</option>
            <option value="partial" style={{ color: '#fbbf24' }}>⚠️ Partial Payment</option>
            <option value="pending" style={{ color: '#94a3b8' }}>🧭 Pending</option>
            <option value="waived" style={{ color: '#c084fc' }}>🎁 Waived / Free</option>
            <option value="due" style={{ color: '#f87171' }}>❌ Due / Unpaid</option>
          </select>

          <select value={courseFilter} onChange={e => setCourseFilter(e.target.value)} className="ft-select">
            <option value="">All Courses</option>
            <option value="Online Filmmaking Course">Online Filmmaking Course</option>
            <option value="Film Appreciation Course">Film Appreciation Course</option>
          </select>

          <select value={batchFilter} onChange={e => setBatchFilter(e.target.value)} className="ft-select">
            <option value="">All Batches</option>
            {data.batches.map(b => (
              <option key={b} value={b}>Batch {b}</option>
            ))}
          </select>

          <div className="ft-search-box">
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search by name or ID..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="ft-table-container">
        {loading ? (
          <div className="ft-loading">Loading fee data...</div>
        ) : error ? (
          <div className="ft-error">{error}</div>
        ) : data.students.length === 0 ? (
          <div className="ft-empty">No students found matching your criteria.</div>
        ) : (
          <table className="ft-table">
            <thead>
              <tr>
                <th className="ft-th-name">Student Name</th>
                <th>Student ID</th>
                <th>Batch</th>
                <th>Course</th>
                <th>Total Fee</th>
                <th>Collected</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map(student => (
                <tr key={`${student.user_id}-${student.course_name}`} className={student.is_overdue ? 'ft-row-overdue' : ''}>
                  <td className="ft-cell-name">
                    <img src={student.profile_picture || '/default-avatar.png'} alt="" className="ft-avatar" />
                    {student.full_name}
                  </td>
                  <td>{student.student_id || '-'}</td>
                  <td>{student.batch_number ? `B-${student.batch_number}` : '-'}</td>
                  <td>
                    <span className="ft-badge ft-badge-course">
                      {student.course_name}
                    </span>
                  </td>
                  <td>৳{student.total_fee.toLocaleString('en-IN')}</td>
                  <td className="ft-text-success">৳{student.collected.toLocaleString('en-IN')}</td>
                  <td className="ft-text-danger">৳{student.outstanding.toLocaleString('en-IN')}</td>
                  <td>
                    <span className={`ft-badge ft-badge-${student.status.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`}>
                      {student.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                      {student.outstanding > 0 && (
                        <button 
                          className={`ft-btn-sm ${student.reminder_sent_today ? 'ft-btn-disabled' : 'ft-btn-outline'}`}
                          onClick={() => handleSendReminder(student)}
                          disabled={student.reminder_sent_today || sendingReminderFor === student.user_id}
                        >
                          {sendingReminderFor === student.user_id 
                            ? 'Sending...' 
                            : student.reminder_sent_today 
                              ? 'Sent Today' 
                              : 'Send Reminder'
                          }
                        </button>
                      )}
                      <button 
                        onClick={() => openAcademicModal(student)}
                        className="btn" 
                        style={{ padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'all 0.2s', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                        title={student.course_name !== 'Online Filmmaking Course' ? 'Exam Result' : 'Academic Records'}
                      >
                        <GraduationCap size={16} />
                      </button>

                      {student.course_name === 'Online Filmmaking Course' && (
                        <button
                          onClick={() => openPhase2Modal(student)}
                          className="btn"
                          style={{ padding: '0.5rem', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', transition: 'all 0.2s', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}
                          title="Phase 2: Shooting & Editing Attendance"
                        >
                          <Clapperboard size={16} />
                        </button>
                      )}

                      <button 
                        onClick={() => setEditingStudent(student)} 
                        className="btn" 
                        style={{ padding: '0.5rem', background: 'rgba(56, 189, 248, 0.1)', color: '#0284c7', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '8px', transition: 'all 0.2s', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                        title="Edit Student"
                      >
                        <Edit size={16} />
                      </button>

                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Toasts */}
      <div className="ft-toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`ft-toast ft-toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>

      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaveSuccess={handleSaveSuccess}
        />
      )}
      
      {/* Copied Modals */}
{confirmConfig && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <div className="modern-modal-content glass-panel shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display">{confirmConfig.title}</h3>
              <button className="icon-btn-ghost" onClick={() => setConfirmConfig(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="modern-modal-body">
              <p>{confirmConfig.message}</p>
            </div>
            <div className="modern-modal-footer">
              {!confirmConfig.isAlert && (
                <button className="modern-btn modern-btn--secondary" onClick={() => setConfirmConfig(null)}>Cancel</button>
              )}
              <button 
                className={`modern-btn ${confirmConfig.type === 'danger' ? 'modern-btn--danger' : 'modern-btn--primary'}`}
                style={confirmConfig.isAlert ? { width: '100%', maxWidth: '200px', margin: '0 auto' } : {}}
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
              >
                {confirmConfig.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

{/* Academic Records Modal */}
      {academicStudent && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <form onSubmit={submitAcademic} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <div>
                <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GraduationCap size={24} style={{ color: '#10b981' }} /> {academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? 'Exam Result' : 'Academic Records'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                  {academicStudent.full_name} <span style={{ opacity: 0.7 }}>({academicStudent.batch_number ? `${getOrdinalSuffix(academicStudent.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: '500', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.2rem 0.6rem', borderRadius: '6px', display: 'inline-block' }}>
                  {academicStudent.enrollment?.course_name || 'Course'}
                </p>
              </div>
              <button type="button" className="icon-btn-ghost" onClick={closeAcademicModal} aria-label="Close"><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: '60vh', overflowY: 'auto' }}>
              {academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? (
                /* Film Appreciation Course: single Exam Result out of 100, no attendance */
                <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Exam Result (Total: 100)</h3>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam Score (Max: 100)</label>
                    <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max="100" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                  </div>
                  {(() => {
                    const totalGained = parseInt(academicFormData.exam_written) || 0;
                    const isPassed = totalGained >= 33;
                    return (
                      <p style={{ 
                        fontSize: '0.75rem', 
                        color: 'var(--text-muted)', 
                        marginTop: '1.25rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem'
                      }}>
                        <span>Requires 33+ marks to pass.</span>
                        <span style={{ 
                          fontSize: '0.85rem', 
                          fontWeight: '700', 
                          color: isPassed ? '#34d399' : '#f87171',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}>
                          <span>Total Gained:</span>
                          <strong style={{ fontSize: '0.98rem' }}>{totalGained}</strong>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ 100</span>
                          <span style={{ 
                            fontSize: '0.68rem', 
                            fontWeight: '600', 
                            padding: '0.05rem 0.35rem', 
                            borderRadius: '4px',
                            marginLeft: '0.25rem',
                            background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                            color: isPassed ? '#34d399' : '#f87171',
                            border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
                          }}>
                            {isPassed ? 'Passed' : 'Failed'}
                          </span>
                        </span>
                      </p>
                    );
                  })()}
                </div>
              ) : (
                /* Online Filmmaking Course: attendance & full breakdown */
                <>
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>Attendance</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Total classes:</label>
                        <input type="number" name="attendance_total" value={academicFormData.attendance_total} onChange={handleAcademicChange} min="1" className="input-glass" style={{ width: '100px', paddingLeft: '0.5rem', fontSize: '0.9rem' }} required />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Classes Attended</label>
                      <input type="number" name="attendance_classes" value={academicFormData.attendance_classes} onChange={handleAcademicChange} min="0" max={academicFormData.attendance_total || 22} className="input-glass" style={{ paddingLeft: '1rem' }} required />
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Requires {Math.ceil((academicFormData.attendance_total || 22) * 0.8)}+ (80%) to qualify for exam.</p>
                    </div>
                  </div>

                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Exam Results (Total: 100)</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam (Max: 80)</label>
                        <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max="80" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Screenplay (Max: 10)</label>
                          <input type="number" name="assignment_screenplay" value={academicFormData.assignment_screenplay} onChange={handleAcademicChange} min="0" max="10" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Shooting Script (Max: 10)</label>
                          <input type="number" name="assignment_shooting_script" value={academicFormData.assignment_shooting_script} onChange={handleAcademicChange} min="0" max="10" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const totalGained = (parseInt(academicFormData.exam_written) || 0) + 
                                          (parseInt(academicFormData.assignment_screenplay) || 0) + 
                                          (parseInt(academicFormData.assignment_shooting_script) || 0);
                      const isPassed = totalGained >= 33;
                      return (
                        <p style={{ 
                          fontSize: '0.75rem', 
                          color: 'var(--text-muted)', 
                          marginTop: '1.25rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.5rem'
                        }}>
                          <span>Requires 33+ total marks to pass.</span>
                          <span style={{ 
                            fontSize: '0.85rem', 
                            fontWeight: '700', 
                            color: isPassed ? '#34d399' : '#f87171',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}>
                            <span>Total Gained:</span>
                            <strong style={{ fontSize: '0.98rem' }}>{totalGained}</strong>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ 100</span>
                            <span style={{ 
                              fontSize: '0.68rem', 
                              fontWeight: '600', 
                              padding: '0.05rem 0.35rem', 
                              borderRadius: '4px',
                              marginLeft: '0.25rem',
                              background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                              color: isPassed ? '#34d399' : '#f87171',
                              border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
                            }}>
                              {isPassed ? 'Passed' : 'Failed'}
                            </span>
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                </>
              )}

              {academicError && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{academicError}</div>}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={closeAcademicModal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="modern-btn modern-btn--primary" disabled={isAcademicSaving} style={{ flex: 1, background: '#10b981', borderColor: '#10b981' }}>
                {isAcademicSaving ? 'Saving...' : (academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? 'Save Result' : 'Save Records')}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

{/* Phase 2 Completion Modal */}
      {phase2Student && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <form onSubmit={submitPhase2} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '480px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <div>
                <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GraduationCap size={24} style={{ color: '#8b5cf6' }} /> Phase 2: Completed Course
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                  {phase2Student.full_name} <span style={{ opacity: 0.7 }}>({phase2Student.batch_number ? `${getOrdinalSuffix(phase2Student.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: '500', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: '0.2rem 0.6rem', borderRadius: '6px', display: 'inline-block' }}>
                  Online Filmmaking Course
                </p>
              </div>
              <button type="button" className="icon-btn-ghost" onClick={closePhase2Modal} aria-label="Close"><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                Mark the parts the student has participated in. Step 4 (Phase 2: Completed Course) will be automatically checked once <strong style={{ color: 'var(--text-primary)' }}>both</strong> Shooting and Editing are attended.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                {/* Shooting */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '1rem', borderRadius: '10px', border: '1px solid', borderColor: phase2FormData.phase2_shooting_attended ? '#8b5cf6' : 'rgba(255,255,255,0.1)', background: phase2FormData.phase2_shooting_attended ? 'rgba(139,92,246,0.08)' : 'transparent', transition: 'all 0.2s' }}>
                  <input
                    type="checkbox"
                    checked={phase2FormData.phase2_shooting_attended}
                    onChange={(e) => setPhase2FormData({ ...phase2FormData, phase2_shooting_attended: e.target.checked })}
                    style={{ width: '20px', height: '20px', accentColor: '#8b5cf6', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>🎬 Shooting</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Student participated in the Shooting part of Phase 2</div>
                  </div>
                </label>

                {/* Editing */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '1rem', borderRadius: '10px', border: '1px solid', borderColor: phase2FormData.phase2_editing_attended ? '#8b5cf6' : 'rgba(255,255,255,0.1)', background: phase2FormData.phase2_editing_attended ? 'rgba(139,92,246,0.08)' : 'transparent', transition: 'all 0.2s' }}>
                  <input
                    type="checkbox"
                    checked={phase2FormData.phase2_editing_attended}
                    onChange={(e) => setPhase2FormData({ ...phase2FormData, phase2_editing_attended: e.target.checked })}
                    style={{ width: '20px', height: '20px', accentColor: '#8b5cf6', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>✂️ Editing</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Student participated in the Editing part of Phase 2</div>
                  </div>
                </label>
              </div>

              {/* Auto-complete status indicator */}
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: (phase2FormData.phase2_shooting_attended && phase2FormData.phase2_editing_attended) ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.06)', border: '1px solid', borderColor: (phase2FormData.phase2_shooting_attended && phase2FormData.phase2_editing_attended) ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {(phase2FormData.phase2_shooting_attended && phase2FormData.phase2_editing_attended) ? (
                  <><CheckSquare size={16} style={{ color: '#10b981', flexShrink: 0 }} /><span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: '600' }}>Both parts attended — Phase 2: Completed Course will be marked ✓</span></>
                ) : (
                  <><Square size={16} style={{ color: '#ef4444', flexShrink: 0 }} /><span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Both Shooting and Editing must be attended to complete Phase 2.</span></>
                )}
              </div>

              {phase2Error && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{phase2Error}</div>}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={closePhase2Modal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="modern-btn modern-btn--primary" disabled={isPhase2Saving} style={{ flex: 1, background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                {isPhase2Saving ? 'Saving...' : 'Save Attendance'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
};

export default FeeTracker;
