import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, Calendar, Users, Clock, CheckCircle2, XCircle, 
  FileText, Film, Award, UserCheck, Camera, Video, Wallet,
  Search, ExternalLink, Trash2, UserPlus, Pencil, CheckSquare,
  History, RefreshCw, Zap, Loader2
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import './BatchDetail.css';
import BatchFormModal from '../../components/admin/BatchFormModal';
import AddStudentsModal from '../../components/admin/AddStudentsModal';

// Reusable Stat Card
function StatCard({ icon, value, label, colorVariant }) {
  const getIconColor = () => {
    switch (colorVariant) {
      case 'Blue': return '#3b82f6';
      case 'Green': return '#10b981';
      case 'Red': return '#ef4444';
      case 'Amber': return '#f59e0b';
      case 'Purple': return '#8b5cf6';
      default: return '#3b82f6';
    }
  };
  
  const getIconBg = () => {
    switch (colorVariant) {
      case 'Blue': return 'rgba(59, 130, 246, 0.1)';
      case 'Green': return 'rgba(16, 185, 129, 0.1)';
      case 'Red': return 'rgba(239, 68, 68, 0.1)';
      case 'Amber': return 'rgba(245, 158, 11, 0.1)';
      case 'Purple': return 'rgba(139, 92, 246, 0.1)';
      default: return 'rgba(59, 130, 246, 0.1)';
    }
  };

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{ width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: getIconBg(), color: getIconColor() }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          {value != null ? value : '—'}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.75rem', borderRadius: '8px', color: '#fff' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>{label}</p>
        <p style={{ margin: 0, fontWeight: 'bold', fontSize: '1rem' }}>
          {payload[0].value} <span style={{ fontWeight: 'normal', fontSize: '0.85rem' }}>Students</span>
        </p>
      </div>
    );
  }
  return null;
};

export default function BatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [batchData, setBatchData] = useState(null);
  const [progressData, setProgressData] = useState(null);
  const [studentsData, setStudentsData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Toast state
  const [toastMsg, setToastMsg] = useState('');
  
  // Remove student popover state
  const [removePopoverId, setRemovePopoverId] = useState(null);

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);

  // Timeline and Automation States
  const [transitionsData, setTransitionsData] = useState([]);
  const [refreshingTransitions, setRefreshingTransitions] = useState(false);
  const [showUpdatedText, setShowUpdatedText] = useState(false);
  const [automationRunning, setAutomationRunning] = useState(false);
  const [flashHeader, setFlashHeader] = useState(false);
  const [showAddStudentsModal, setShowAddStudentsModal] = useState(false);

  const timelineEvents = useMemo(() => {
    if (!batchData) return [];
    
    // Synthesize "Batch created" event
    const creatorName = 'Admin'; 
    const initialStatus = 'upcoming'; 
    const createdEvent = {
      id: 'created',
      from_status: null,
      to_status: 'upcoming',
      reason: `Batch created with status: ${initialStatus}`,
      trigger_type: 'manual',
      triggered_by_name: creatorName,
      transitioned_at: batchData.created_at,
      is_synthetic: true
    };

    return [...transitionsData, createdEvent];
  }, [transitionsData, batchData]);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchTransitions = async (resolvedId) => {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch(`/api/admin/batches/${resolvedId}/transitions`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTransitionsData(data || []);
      }
    } catch (e) {
      console.error('Error fetching transitions:', e);
    }
  };

  const handleRefreshTransitions = async () => {
    if (!batchData) return;
    setRefreshingTransitions(true);
    await fetchTransitions(batchData.id);
    setRefreshingTransitions(false);
    setShowUpdatedText(true);
    setTimeout(() => setShowUpdatedText(false), 2000);
  };

  const handleRunDetailAutomation = async () => {
    if (!batchData) return;
    setAutomationRunning(true);
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

      if (data.transitions && data.transitions.length > 0) {
        // Find if this batch was updated
        const thisTransition = data.transitions.find(t => t.batch_id === batchData.id);
        if (thisTransition) {
          setBatchData(prev => ({ ...prev, status: thisTransition.to_status }));
          showToast(`Status check complete — ${batchData.batch_name} is now ${thisTransition.to_status}`);
          setFlashHeader(true);
          setTimeout(() => setFlashHeader(false), 1500);
        } else {
          showToast('Status check complete — no changes needed');
        }
      } else {
        showToast('Status check complete — no changes needed');
      }

      // Auto-refresh the timeline
      await fetchTransitions(batchData.id);

    } catch (error) {
      console.error('[BatchAutomation] Detail trigger error:', error);
      showToast('Automation run failed');
    } finally {
      setAutomationRunning(false);
    }
  };

  const fetchStudents = async (resolvedId) => {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch(`/api/admin/batches/${resolvedId}/students`, { headers });
      if (res.ok) {
        const data = await res.json();
        setStudentsData(data || []);
      }
    } catch (e) {
      console.error('Error fetching students:', e);
    }
  };

  const fetchProgress = async (resolvedId) => {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch(`/api/admin/batches/${resolvedId}/progress`, { headers });
      if (res.ok) {
        const data = await res.json();
        setProgressData(data);
      }
    } catch (e) {
      console.error('Error fetching progress:', e);
    }
  };
  const handleAdmitPhase2 = async (studentId, studentName) => {
    if (!batchData) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/batches/${batchData.id}/students/${studentId}/admit-phase2`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        showToast(`Successfully admitted ${studentName} to Phase 2`);
        await fetchStudents(batchData.id);
        await fetchProgress(batchData.id);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to admit student to Phase 2');
      }
    } catch (e) {
      console.error('Error admitting student to Phase 2:', e);
      showToast('Failed to admit student to Phase 2');
    }
  };

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        setLoading(true);
        setError('');
        const token = localStorage.getItem('token');
        const headers = { 'Authorization': `Bearer ${token}` };

        let resolvedId = id;

        // Slug resolution logic
        if (id && !/^\d+$/.test(id)) {
          const res = await fetch('/api/admin/batches', { headers });
          if (res.ok) {
            const batches = await res.json();
            const generateSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const match = batches.find(b => generateSlug(b.batch_name) === id);
            if (match) {
              resolvedId = match.id;
            } else {
              setError('Batch not found');
              setLoading(false);
              return;
            }
          } else {
            throw new Error('Failed to fetch batches for slug resolution');
          }
        }

        const [batchRes, progressRes, studentsRes, transitionsRes] = await Promise.all([
          fetch(`/api/admin/batches/${resolvedId}`, { headers }),
          fetch(`/api/admin/batches/${resolvedId}/progress`, { headers }),
          fetch(`/api/admin/batches/${resolvedId}/students`, { headers }),
          fetch(`/api/admin/batches/${resolvedId}/transitions`, { headers })
        ]);

        if (batchRes.status === 404) {
          setError('Batch not found');
          return;
        }

        if (!batchRes.ok || !progressRes.ok || !studentsRes.ok) {
          throw new Error('Failed to fetch one or more resources');
        }

        const bData = await batchRes.json();
        const pData = await progressRes.json();
        const sData = await studentsRes.json();
        const tData = transitionsRes.ok ? await transitionsRes.json() : [];

        setBatchData(bData);
        setProgressData(pData);
        setStudentsData(sData || []);
        setTransitionsData(tData || []);
      } catch (err) {
        console.error('Error fetching batch detail:', err);
        setError('Error loading batch details');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchAllData();
    }
  }, [id]);

  const handleRemoveStudentClick = (studentId) => {
    setRemovePopoverId(studentId);
  };

  const cancelRemove = () => {
    setRemovePopoverId(null);
  };

  const confirmRemoveStudent = async (studentId, studentName) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/batches/${batchData.id}/students/${studentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        // Optimistic UI update
        setStudentsData(prev => prev.filter(s => s.user_id !== studentId));
        setBatchData(prev => ({ ...prev, student_count: Math.max(0, (prev.student_count || 0) - 1) }));
        setRemovePopoverId(null);
        showToast(`${studentName} removed from batch`);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to remove student');
        setRemovePopoverId(null);
      }
    } catch (e) {
      console.error(e);
      showToast('Connection error');
      setRemovePopoverId(null);
    }
  };

  const handleEditClick = () => {
    setShowEditModal(true);
  };

  const handleAddStudentsClick = () => {
    setShowAddStudentsModal(true);
  };

  // Format dates
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Not set';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return '1 month ago';
    return `${diffMonths} months ago`;
  };

  if (loading) {
    return (
      <div className="page-container container" style={{ paddingTop: '2rem' }}>
        <div style={{ height: '200px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', animation: 'pulse 2s infinite' }}></div>
        <div style={{ height: '300px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', marginTop: '2rem', animation: 'pulse 2s infinite' }}></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ fontSize: '1.5rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{error}</div>
        <button onClick={() => navigate('/admin/batches')} className="modern-btn modern-btn--secondary">
          <ArrowLeft size={16} /> Back to Batches
        </button>
      </div>
    );
  }

  if (!batchData) return null;

  // Filter students
  const filteredStudents = studentsData.filter(s => {
    if (!searchQuery.trim()) return true;
    const terms = searchQuery.toLowerCase().split(' ').filter(Boolean);
    const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
    const bfiId = (s.bfi_id || '').toLowerCase();
    return terms.every(term => fullName.includes(term) || bfiId.includes(term));
  });

  // Funnel data prep
  let funnelData = [];
  const isFilmmaking = batchData.course_name === 'Online Filmmaking Course';

  if (progressData) {
    if (isFilmmaking) {
      funnelData = [
        { stage: 'Enrolled', value: progressData.total_students || 0 },
        { stage: 'Attendance OK', value: progressData.phase1?.attendance_qualified || 0 },
        { stage: 'Exam Passed', value: progressData.phase1?.exam_passed || 0 },
        { stage: 'Phase 2', value: progressData.phase2?.completed || 0 },
        { stage: 'Certified', value: progressData.certificates?.issued || 0 },
      ];
    } else {
      funnelData = [
        { stage: 'Enrolled', value: progressData.single_phase?.admitted || progressData.total_students || 0 },
        { stage: 'Attended', value: progressData.single_phase?.attendance || 0 },
        { stage: 'Assignment', value: progressData.single_phase?.assignment_submitted || 0 },
        { stage: 'Exam Passed', value: progressData.single_phase?.exam_passed || 0 },
        { stage: 'Completed', value: progressData.single_phase?.completed || 0 },
      ];
    }
  }

  const getTimelineRelativeTime = (dateInput) => {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };



  const isBatchLocked = batchData.status === 'completed' || batchData.status === 'archived';

  // Fee calculation (fallback logic if no specific totals exist yet)
  const totalCollected = 0; // Placeholder, assuming it's not directly in progressData
  const totalOutstanding = 0; // Placeholder

  return (
    <div className="page-container container batch-detail-container">
      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white', padding: '1rem 1.5rem',
          borderRadius: '8px', zIndex: 9999, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', gap: '0.75rem', animation: 'fadeInUp 0.3s ease'
        }}>
          <CheckCircle2 size={18} color="#34d399" />
          {toastMsg}
        </div>
      )}

      {/* SECTION 1: Batch Header */}
      <div className={`batch-detail-header glass-panel ${flashHeader ? 'header-flash' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <button 
              onClick={() => navigate('/admin/batches')} 
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}
            >
              <ArrowLeft size={16} /> Back to Batches
            </button>
            <h1 style={{ fontSize: '2.5rem', margin: 0, fontFamily: 'Outfit, sans-serif', color: 'var(--text-primary)', lineHeight: '1.2' }}>
              {batchData.batch_name}
            </h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span>Batch #{batchData.batch_number}</span>
              <span>·</span>
              <span>{batchData.course_name}</span>
            </div>
            
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <span className={`batch-status-badge ${batchData.status}`}>
                {batchData.status}
              </span>
              <span className={`batch-course-badge ${isFilmmaking ? 'filmmaking' : 'workshop'}`}>
                {isFilmmaking ? 'FILMMAKING' : 'WORKSHOP'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button 
              onClick={handleRunDetailAutomation} 
              disabled={automationRunning}
              className="modern-btn btn-automation" 
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1rem', borderRadius: '8px' }}
            >
              {automationRunning ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Zap size={16} />
              )}
              {automationRunning ? 'Checking...' : '⚡ Run Status Check'}
            </button>
            <button onClick={handleEditClick} className="modern-btn modern-btn--secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Pencil size={16} /> Edit Batch
            </button>
            <button onClick={handleAddStudentsClick} className="modern-btn modern-btn--primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus size={16} /> Add Students
            </button>
          </div>
        </div>

        <div className="batch-meta-chips">
          <div className="batch-meta-chip"><Calendar size={14} /> {formatDate(batchData.start_date)}</div>
          <div className="batch-meta-chip"><Calendar size={14} /> {formatDate(batchData.end_date)}</div>
          <div className="batch-meta-chip"><Users size={14} /> {batchData.student_count || 0} students enrolled</div>
          <div className="batch-meta-chip"><Clock size={14} /> Created {getRelativeTime(batchData.created_at)}</div>
        </div>

        {batchData.description && (
          <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.95rem', lineHeight: '1.6', maxWidth: '800px' }}>
            {batchData.description}
          </p>
        )}
      </div>

      {/* SECTION 2: Progress Dashboard */}
      {progressData && (
        <div className="batch-progress-section">
          {isFilmmaking ? (
            <>
              <div>
                <div className="batch-phase-label">Phase 1</div>
                <div className="batch-metrics-grid">
                  <StatCard icon={<Users size={20} />} value={progressData.total_students} label="Total Students" colorVariant="Blue" />
                  <StatCard icon={<CheckCircle2 size={20} />} value={progressData.phase1?.attendance_qualified} label="Attendance Qualified" colorVariant="Green" />
                  <StatCard icon={<XCircle size={20} />} value={progressData.phase1?.attendance_not_qualified} label="Not Qualified" colorVariant="Red" />
                  <StatCard icon={<FileText size={20} />} value={progressData.phase1?.screenplay_submitted} label="Screenplay Submitted" colorVariant="Amber" />
                  <StatCard icon={<Film size={20} />} value={progressData.phase1?.shooting_script_submitted} label="Shooting Script Submitted" colorVariant="Amber" />
                  <StatCard icon={<Award size={20} />} value={progressData.phase1?.exam_passed} label="Exam Passed" colorVariant="Green" />
                  <StatCard icon={<XCircle size={20} />} value={progressData.phase1?.exam_failed} label="Exam Failed" colorVariant="Red" />
                  <StatCard icon={<CheckSquare size={20} />} value={progressData.phase1?.completed} label="Phase 1 Completed" colorVariant="Green" />
                </div>
              </div>
              
              {progressData.phase2?.admitted > 0 ? (
                <div style={{ marginTop: '1rem' }} className="batch-phase2-section visible">
                  <div className="batch-phase-label purple">Phase 2</div>
                  <div className="batch-metrics-grid">
                    <StatCard icon={<UserCheck size={20} />} value={progressData.phase2?.admitted} label="Phase 2 Admitted" colorVariant="Blue" />
                    <StatCard icon={<Camera size={20} />} value={progressData.phase2?.shooting_attended} label="Shooting Attended" colorVariant="Amber" />
                    <StatCard icon={<Video size={20} />} value={progressData.phase2?.editing_attended} label="Editing Attended" colorVariant="Amber" />
                    <StatCard icon={<CheckSquare size={20} />} value={progressData.phase2?.completed} label="Phase 2 Completed" colorVariant="Green" />
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '1rem' }} className="batch-phase2-section">
                  <div className="batch-phase-label purple">Phase 2</div>
                  <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px', padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Phase 2 data will appear once students advance from Phase 1.
                  </div>
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="batch-phase-label">Course Progress</div>
              <div className="batch-metrics-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <StatCard icon={<Users size={20} />} value={progressData.single_phase?.admitted || progressData.total_students} label="Total Students" colorVariant="Blue" />
                <StatCard icon={<CheckCircle2 size={20} />} value={progressData.single_phase?.attendance} label="Attendance" colorVariant="Green" />
                <StatCard icon={<FileText size={20} />} value={progressData.single_phase?.assignment_submitted} label="Assignment Submitted" colorVariant="Amber" />
                <StatCard icon={<Award size={20} />} value={progressData.single_phase?.exam_passed} label="Exam Passed" colorVariant="Green" />
                <StatCard icon={<CheckSquare size={20} />} value={progressData.single_phase?.completed} label="Completed" colorVariant="Green" />
              </div>
            </div>
          )}

          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', marginTop: '1rem' }}>
            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.1rem', fontFamily: 'Outfit, sans-serif' }}>Student Progression Funnel</h3>
            <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Drop-off at each stage</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={funnelData} layout="vertical" margin={{ top: 4, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" width={100} tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {funnelData.map((entry, index) => {
                    const colors = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
                    return <Cell key={`cell-${index}`} fill={colors[index] || '#2563eb'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div className="batch-phase-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Wallet size={14} /> Fees & Certificates
            </div>
            <div className="batch-fee-cert-row">
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                <div className="fee-summary-row">
                  <div className="fee-summary-label">
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
                    Fully Paid
                  </div>
                  <div className="fee-summary-value" style={{ color: '#34d399' }}>৳{totalCollected} collected</div>
                </div>
                <div className="fee-summary-row">
                  <div className="fee-summary-label">
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }}></span>
                    Partial Payment
                  </div>
                </div>
                <div className="fee-summary-row">
                  <div className="fee-summary-label">
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
                    Payment Due
                  </div>
                  <div className="fee-summary-value" style={{ color: '#ef4444' }}>৳{totalOutstanding} outstanding</div>
                </div>
                
                <div className="fee-progress-bar">
                  <div className="fee-progress-segment" style={{ width: '50%', background: '#34d399' }}></div>
                  <div className="fee-progress-segment" style={{ width: '30%', background: '#f59e0b' }}></div>
                  <div className="fee-progress-segment" style={{ width: '20%', background: '#ef4444' }}></div>
                </div>
                
                <Link to={`/admin/fee-tracker?batch=${batchData.batch_number}`} style={{ color: 'var(--primary)', fontSize: '0.85rem', textDecoration: 'none', marginTop: 'auto', alignSelf: 'flex-start' }}>
                  View in Fee Tracker →
                </Link>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '1.5rem' }}>✅</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {progressData.certificates?.issued || 0} Certificates Issued
                  </div>
                  {progressData.certificates?.issued > 0 && <Award size={24} color="#fbbf24" style={{ marginLeft: 'auto' }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '1.5rem' }}>⏳</div>
                  <div style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                    {progressData.certificates?.pending || 0} Pending
                  </div>
                </div>
                <Link to="/admin/analytics" style={{ color: 'var(--primary)', fontSize: '0.85rem', textDecoration: 'none', marginTop: 'auto', alignSelf: 'flex-start' }}>
                  View in Analytics →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: Students Table */}
      <div className="batch-students-section glass-panel" style={{ padding: '2rem', borderRadius: '16px' }}>
        <div className="batch-students-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Users size={20} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontFamily: 'Outfit, sans-serif' }}>STUDENTS IN THIS BATCH</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Showing {filteredStudents.length} students</span>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="text"
                placeholder="Search by name or student ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-glass"
                style={{ paddingLeft: '2.25rem', fontSize: '0.85rem', width: '250px' }}
              />
            </div>
          </div>
        </div>

        {studentsData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px' }}>
            <UserPlus size={48} style={{ opacity: 0.2, margin: '0 auto 1rem auto', color: 'var(--primary)' }} />
            <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>No students in this batch yet</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Click '+ Add Students' to assign students to this batch</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <Search size={32} style={{ opacity: 0.2, margin: '0 auto 1rem auto' }} />
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>No students match your search</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="student-list-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student Name</th>
                  <th>BFI ID</th>
                  <th>Phase 1</th>
                  <th>Exam</th>
                  <th>Phase 2</th>
                  <th>Fee Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s, index) => (
                  <tr key={s.user_id} className="student-list-row">
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{index + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {s.avatar ? (
                          <img src={s.avatar} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                            {s.first_name?.[0]}{s.last_name?.[0]}
                          </div>
                        )}
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.first_name} {s.last_name}</div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{s.bfi_id || '—'}</td>
                    <td>
                      {s.phase1_completed ? <span style={{ color: '#34d399' }}>✅</span> : (s.phase1_completed === false ? '❌' : '—')}
                    </td>
                    <td>
                      {s.exam_passed ? <span style={{ color: '#34d399' }}>✅</span> : (s.exam_passed === false ? '❌' : '—')}
                    </td>
                    <td>
                      {isFilmmaking ? (
                        s.phase2_completed ? <span style={{ color: '#34d399' }}>✅</span> : (s.phase2_completed === false ? '❌' : '—')
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
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
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', position: 'relative' }}>
                        <Link 
                          to={`/admin/students/${s.user_id}`}
                          className="modern-btn modern-btn--secondary"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                        >
                          <ExternalLink size={14} /> Profile
                        </Link>
                        
                        {isFilmmaking && s.phase1_completed && !s.phase2_admitted && (
                          <button 
                            onClick={() => handleAdmitPhase2(s.user_id, `${s.first_name} ${s.last_name}`)}
                            className="modern-btn modern-btn--primary"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                          >
                            <UserCheck size={14} /> Admit to Phase 2
                          </button>
                        )}
                        
                        {!isBatchLocked && (
                          <button 
                            onClick={() => handleRemoveStudentClick(s.user_id)}
                            className="modern-btn modern-btn--danger"
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                          >
                            <Trash2 size={14} /> Remove
                          </button>
                        )}

                        {/* Inline Popover for Remove Confirmation */}
                        {removePopoverId === s.user_id && (
                          <div style={{
                            position: 'absolute', right: 0, top: '100%', marginTop: '0.5rem',
                            background: '#1e293b', border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px', padding: '1rem', zIndex: 10, width: '260px',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.5)', textAlign: 'left',
                            animation: 'fadeInUp 0.15s ease'
                          }}>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                              Remove {s.first_name} from this batch? Their batch number will be cleared.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              <button onClick={cancelRemove} className="modern-btn modern-btn--secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>Cancel</button>
                              <button onClick={() => confirmRemoveStudent(s.user_id, `${s.first_name} ${s.last_name}`)} className="modern-btn modern-btn--danger" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>Remove</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 4: Status History Timeline */}
      <div className="batch-timeline-section glass-panel" style={{ padding: '2rem', borderRadius: '16px', marginTop: '2.5rem', marginBottom: '2.5rem' }}>
        <div className="batch-timeline-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <History size={20} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontFamily: 'Outfit, sans-serif', color: 'var(--text-primary)', letterSpacing: '0.1em' }}>STATUS HISTORY</h2>
            <span className="batch-status-badge upcoming" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', textTransform: 'lowercase' }}>
              {transitionsData.length} transitions
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {showUpdatedText && <span style={{ fontSize: '0.8rem', color: '#34d399' }}>Updated just now</span>}
            <button 
              onClick={handleRefreshTransitions} 
              disabled={refreshingTransitions}
              className="icon-btn-ghost" 
              style={{ padding: '0.4rem', borderRadius: '6px', color: 'var(--text-secondary)' }}
              title="Refresh History"
            >
              <RefreshCw size={16} className={refreshingTransitions ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="batch-timeline">
          {timelineEvents.map((t) => {
            // Determine dot color
            let dotColor = '#2563EB'; // blue for manual change (default)
            if (t.is_synthetic) {
              dotColor = '#38BDF8'; // sky dot for created
            } else if (t.from_status === 'upcoming' && t.to_status === 'active') {
              dotColor = '#22C55E'; // green dot
            } else if (t.from_status === 'active' && t.to_status === 'completed') {
              dotColor = '#A855F7'; // purple dot
            }

            // Simple helper to format date for tooltip
            const fullDateTooltip = t.transitioned_at 
              ? new Date(t.transitioned_at).toLocaleString('en-US', { 
                  day: 'numeric', 
                  month: 'short', 
                  year: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit' 
                }) 
              : '';

            return (
              <div 
                key={t.id} 
                className={`batch-timeline-item ${t.is_synthetic ? 'batch-timeline-synthetic' : ''}`}
              >
                <div 
                  className="batch-timeline-dot" 
                  style={{ color: dotColor }}
                />
                
                <div className="batch-timeline-item-header">
                  <div className="batch-timeline-transition">
                    {t.is_synthetic ? (
                      <span>📝 created</span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span className={`batch-status-badge ${t.from_status}`}>{t.from_status}</span>
                        <span style={{ color: 'rgba(255,255,255,0.4)' }}>→</span>
                        <span className={`batch-status-badge ${t.to_status}`}>{t.to_status}</span>
                      </span>
                    )}
                  </div>
                  <span 
                    className="batch-timeline-timestamp" 
                    title={fullDateTooltip}
                  >
                    {t.transitioned_at ? getTimelineRelativeTime(t.transitioned_at) : ''}
                  </span>
                </div>

                <div className="batch-timeline-reason">
                  {t.reason}
                </div>

                <div className="batch-timeline-trigger">
                  {t.is_synthetic ? (
                    `By: ${t.triggered_by_name}`
                  ) : (
                    t.trigger_type === 'automatic' 
                      ? 'Triggered automatically by the system' 
                      : `Triggered manually by ${t.triggered_by_name || 'Admin'}`
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* CREATE/EDIT BATCH MODAL */}
      <BatchFormModal
        mode="edit"
        batch={batchData}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSuccess={(updatedBatch) => {
          showToast('Batch updated successfully');
          setShowEditModal(false);
          // Optimistically update the UI without reloading all data
          setBatchData(prev => ({
            ...prev,
            ...updatedBatch
          }));
        }}
      />

      {/* ADD STUDENTS MODAL */}
      <AddStudentsModal
        batchId={batchData.id}
        batchName={batchData.batch_name}
        batchNumber={batchData.batch_number}
        courseName={batchData.course_name}
        isOpen={showAddStudentsModal}
        onClose={() => setShowAddStudentsModal(false)}
        onSuccess={(assignedCount) => {
          setShowAddStudentsModal(false);
          showToast(`${assignedCount} student(s) added to ${batchData.batch_name}`);
          fetchStudents(batchData.id);
          fetchProgress(batchData.id);
          setBatchData(prev => ({
            ...prev,
            student_count: (prev.student_count || 0) + assignedCount
          }));
        }}
      />
    </div>
  );
}
