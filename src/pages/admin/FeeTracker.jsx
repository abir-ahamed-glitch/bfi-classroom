import React, { useState, useEffect } from 'react';
import { Wallet, Search, Filter, Download, ArrowRight, CheckCircle, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
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
          <Link to="/admin/batch-fees" className="ft-btn ft-btn-secondary">
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
                        className="ft-btn-sm ft-btn-edit"
                        onClick={() => setEditingStudent(student)}
                      >
                        Edit Details
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
          onSaveSuccess={fetchFeeData}
        />
      )}
    </div>
  );
};

export default FeeTracker;
