import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, Calendar, Users, Clock, CheckCircle2, XCircle, 
  FileText, Film, Award, UserCheck, Camera, Video, Wallet,
  Search, ExternalLink, Trash2, UserPlus, Pencil, CheckSquare,
  History, RefreshCw, Zap, Loader2, GraduationCap, Clapperboard, Edit, Square, X, Lock
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import './BatchDetail.css';
import BatchFormModal from '../../components/admin/BatchFormModal';
import AddStudentsModal from '../../components/admin/AddStudentsModal';
import EditStudentModal from '../../components/admin/EditStudentModal';

const hasPendingDueOrPartialPayment = (course) => {
  if (!course || !course.fee_details) return false;
  
  let feeDetails = {};
  try {
    feeDetails = typeof course.fee_details === 'string' 
      ? JSON.parse(course.fee_details) 
      : course.fee_details;
  } catch (e) {
    console.error('Error parsing course fee details:', e);
    return false;
  }

  if (!feeDetails) return false;
  
  const isUnpaid = (phase) => {
    if (!phase) return false;
    
    // If installments exist, they are the source of truth
    if (phase.installments && phase.installments.length > 0) {
      return phase.installments.some(inst => inst.status === 'Pending' || inst.status === 'Due');
    }

    // Status checks (when no installments)
    const status = phase.status;
    if (status === 'Paid Full' || status === 'Waived') {
      return false;
    }
    if (status === 'Partial' || status === 'Pending' || status === 'Due') {
      return true;
    }
    
    // Fallback numerical check
    const fullFee = parseFloat((phase.full_fee || '').toString().replace(/[^\d.]/g, '')) || 0;
    if (fullFee === 0) return false;
    
    const amountPaid = parseFloat((phase.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
    const discount = parseFloat((phase.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
    const remainingDue = Math.max(0, fullFee - discount - amountPaid);
    
    return remainingDue > 0;
  };

  if (course.course_name === 'Online Filmmaking Course') {
    return isUnpaid(feeDetails.phase1) || isUnpaid(feeDetails.phase2);
  } else {
    return isUnpaid(feeDetails);
  }
};
import { getOrdinalSuffix } from '../../utils/formatUtils';

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
    <div className="batch-stat-card">
      <div style={{ width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: getIconBg(), color: getIconColor(), flexShrink: 0 }}>
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

  // Edit Student Modal State
  const [editingStudent, setEditingStudent] = useState(null);

  // Academic Records Modal State
  const [academicStudent, setAcademicStudent] = useState(null);
  const [academicCourseId, setAcademicCourseId] = useState(null);
  const [academicFormData, setAcademicFormData] = useState({
    attendance_classes: '', attendance_total: '', exam_written: '',
    assignment_screenplay: '', assignment_shooting_script: ''
  });
  const [isAcademicSaving, setIsAcademicSaving] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // Phase 2 Completion Modal State
  const [phase2Student, setPhase2Student] = useState(null);
  const [phase2CourseId, setPhase2CourseId] = useState(null);
  const [phase2FormData, setPhase2FormData] = useState({
    phase2_shooting_attended: false, phase2_editing_attended: false
  });
  const [isPhase2Saving, setIsPhase2Saving] = useState(false);
  const [phase2Error, setPhase2Error] = useState('');

  // Confirmation Modal State
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [confirmConfig, setConfirmConfig] = useState(null);

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

  const openEditModal = (student) => {
    setEditingStudent(student);
  };

  const openAcademicModal = (student, enrollmentId) => {
    const enrollment = student.enrollments?.find(e => e.id === enrollmentId);
    const isOnlineFilmmaking = enrollment?.course_name === 'Online Filmmaking Course';
    const isAdmitted = isOnlineFilmmaking ? enrollment?.step3_completed : enrollment?.step1_completed;

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

    setAcademicStudent({ ...student, enrollment });
    setAcademicCourseId(enrollmentId);
    setAcademicFormData({
      attendance_classes: enrollment?.attendance_classes || '',
      attendance_total: enrollment?.attendance_total || '',
      exam_written: enrollment?.exam_written || '',
      assignment_screenplay: enrollment?.assignment_screenplay || '',
      assignment_shooting_script: enrollment?.assignment_shooting_script || ''
    });
  };

  const openPhase2Modal = (student, enrollmentId) => {
    const enrollment = student.enrollments?.find(e => e.id === enrollmentId);
    setPhase2Student({ ...student, enrollment });
    setPhase2CourseId(enrollmentId);
    setPhase2FormData({
      phase2_shooting_attended: !!(enrollment?.phase2_shooting_attended),
      phase2_editing_attended: !!(enrollment?.phase2_editing_attended)
    });
  };

  const toggleProgress = async (studentId, enrollmentId, stepField, currentValue, courseName) => {
    if (courseName === 'Online Filmmaking Course') {
      const student = filteredStudents.find(s => s.id === studentId);
      const e = student?.enrollments?.find(env => env.id === enrollmentId);
      const willBeChecked = !currentValue;

      let feeDetails = {};
      if (e?.fee_details) {
        try {
          feeDetails = typeof e.fee_details === 'string' ? JSON.parse(e.fee_details) : e.fee_details;
        } catch (err) {
          console.error(err);
        }
      }
      const phase1 = feeDetails?.phase1 || {};
      const fullFeeNum = parseFloat((phase1.full_fee || '').replace(/[^\d.]/g, '')) || 0;
      const amountPaidNum = parseFloat((phase1.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
      const discountNum = parseFloat((phase1.discount || '').replace(/[^\d.]/g, '')) || 0;
      const rawRemainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);
      
      const phase1Installments = phase1.installments || [];
      const remainingDue = phase1Installments.length > 0
        ? phase1Installments.filter(inst => (inst.status || '').toLowerCase() !== 'paid').reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0)
        : rawRemainingDue;
      
      const phase1PaidAny = amountPaidNum > 0 || phase1Installments.some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
      const phase1FullyPaid = (fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum) ||
        (fullFeeNum > 0 && rawRemainingDue > 0 && phase1Installments.length > 0 && phase1Installments.every(inst => inst.status === 'Paid')) ||
        (fullFeeNum > 0 && remainingDue === 0);

      const phase2 = feeDetails?.phase2 || {};
      const phase2PaidAny = (parseFloat((phase2.amount_paid || '').replace(/[^\d.]/g, '')) || 0) > 0 ||
        (phase2.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);

      if (stepField === 'step2_completed') {
        openAcademicModal(student, enrollmentId);
        return;
      }

      if (stepField === 'step4_completed') {
        if (!e?.step1_completed || !e?.step2_completed || !e?.step3_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Phase 2: Completed Course". All previous phases must be completed first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        openPhase2Modal(student, enrollmentId);
        return;
      }

      if (willBeChecked) {
        if (stepField === 'step1_completed') {
          openEditModal(student);
          return;
        }
        if (stepField === 'step3_completed' && (!e?.step1_completed || !e?.step2_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Phase 2: Admitted". "Phase 1: Admitted" and "Phase 1: Passed Exam" must be checked first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step3_completed' && !phase1FullyPaid) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Phase 2: Admitted" because Phase 1 is not fully paid.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step3_completed') {
          openEditModal(student);
          return;
        }
      } else {
        if (stepField === 'step3_completed' && e?.step4_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 2: Admitted" while "Phase 2: Completed" is checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step3_completed' && phase2PaidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 2: Admitted" because a payment has already been made for this phase.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step1_completed' && (e?.step2_completed || e?.step3_completed || e?.step4_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 1: Admitted" while subsequent phases are checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step1_completed' && phase1PaidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 1: Admitted" because a payment has already been made for this phase.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      }
    }

    if (courseName !== 'Online Filmmaking Course') {
      const student = filteredStudents.find(s => s.id === studentId);
      const e = student?.enrollments?.find(env => env.id === enrollmentId);
      const willBeChecked = !currentValue;

      if (stepField === 'step4_completed') {
        if (willBeChecked) {
          if (!e?.step1_completed) {
            setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Completed Course" because "Admission Confirmed" is not yet completed.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
            return;
          }
          openAcademicModal(student, enrollmentId);
          return;
        }
      }

      if (willBeChecked) {
        if (stepField === 'step1_completed') {
          openEditModal(student);
          return;
        }
      } else {
        if (stepField === 'step1_completed' && e?.step4_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Admission Confirmed" while "Completed Course" is checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      }
    }

    try {
      const res = await fetch(`/api/admin/students/${studentId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          course_id: enrollmentId, 
          [stepField]: currentValue ? 0 : 1 
        })
      });
      if (res.ok) {
        fetchStudents(batchData.id);
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Update Failed', message: data.error || 'Failed to update progress.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Progress update error', err);
    }
  };

  const closeAcademicModal = () => {
    setAcademicStudent(null);
    setAcademicCourseId(null);
  };

  const handleAcademicChange = (e) => {
    setAcademicFormData({ ...academicFormData, [e.target.name]: e.target.value });
  };

  const submitAcademic = async (e) => {
    e.preventDefault();
    setIsAcademicSaving(true);
    setAcademicError('');

    try {
      const res = await fetch(`/api/admin/students/${academicStudent.id}/academic-records/${academicCourseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(academicFormData)
      });

      if (res.ok) {
        fetchStudents(batchData.id); // refresh list in batch detail
        closeAcademicModal();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save academic records');
      }
    } catch (err) {
      setAcademicError(err.message);
    } finally {
      setIsAcademicSaving(false);
    }
  };

  const closePhase2Modal = () => {
    setPhase2Student(null);
    setPhase2CourseId(null);
  };

  const handlePhase2Change = (e) => {
    setPhase2FormData({ ...phase2FormData, [e.target.name]: e.target.checked });
  };

  const submitPhase2 = async (e) => {
    e.preventDefault();
    setIsPhase2Saving(true);
    setPhase2Error('');

    try {
      const res = await fetch(`/api/admin/students/${phase2Student.id}/phase2-attendance/${phase2CourseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(phase2FormData)
      });

      if (res.ok) {
        fetchStudents(batchData.id); // refresh list in batch detail
        closePhase2Modal();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save Phase 2 completion');
      }
    } catch (err) {
      setPhase2Error(err.message);
    } finally {
      setIsPhase2Saving(false);
    }
  };

  const confirmDeleteStudent = (studentId, studentName, batchNumber) => {
    const batchLabel = batchNumber ? `${getOrdinalSuffix(batchNumber)} Batch` : null;
    const messageNode = (
      <span>
        You are about to permanently remove the academic record and account for{' '}
        <strong style={{ fontWeight: 700, color: '#f43f5e' }}>{studentName}</strong>
        {batchLabel && (
          <span style={{ fontWeight: 400, color: '#8b5cf6' }}>{' '}({batchLabel})</span>
        )}
        {' '}from the institutional database. This action is irreversible and will delete all associated data.
      </span>
    );
    setConfirmConfig({
      title: 'Delete Student Account',
      message: messageNode,
      confirmText: 'Permanently Delete',
      type: 'danger',
      onConfirm: () => handleDeleteStudent(studentId)
    });
  };

  const handleDeleteStudent = async (studentId) => {
    setConfirmConfig(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast('Student deleted successfully');
        fetchStudents(batchData.id);
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Deletion Failed', message: data.error || 'Failed to delete student.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error(err);
      setConfirmConfig({ title: 'Error', message: 'An error occurred while deleting the student.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
    }
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
        <button onClick={() => navigate('/admin/batchmanager')} className="modern-btn modern-btn--secondary">
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
              onClick={() => navigate('/admin/batchmanager')} 
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
                {isFilmmaking ? 'FILMMAKING' : 'APPRECIATION'}
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
                  <div className="batch-info-card-dashed" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
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

          <div className="batch-info-card" style={{ marginTop: '1rem' }}>
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
              <div className="batch-info-card" style={{ display: 'flex', flexDirection: 'column' }}>
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

              <div className="batch-info-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
          <div className="batch-info-card-dashed" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
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
                  <th>Course Progressions</th>
                  <th>Fee Status</th>
                  <th>Joined</th>
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
                    <td style={{ minWidth: '250px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {s.enrollments && s.enrollments.map(e => (
                          <div key={e.id} className="student-table-course-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.01)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                              {e.course_name}
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              {e.course_type === 'filmmaking' || e.course_name === 'Online Filmmaking Course' ? (
                                <>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Phase 1: Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title="Phase 1: Passed Exam" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step2_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step2_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <div style={{ width: '1px', height: '14px', background: 'var(--glass-border)', margin: '0 0.2rem' }}></div>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step3_completed', e.step3_completed, e.course_name)} title="Phase 2: Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step3_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step3_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title="Phase 2: Completed Course" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step4_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step4_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title="Completed Course" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step4_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step4_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                </>
                              )}
                              {e.step4_completed === 1 && hasPendingDueOrPartialPayment(e) && (
                                <Lock size={14} style={{ color: '#f87171', display: 'inline-block' }} title="Certificate Locked (Pending/Due/Partial Payment)" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
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
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {s.created_at ? new Date(s.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', position: 'relative' }}>
                        {(() => {
                          const e = s.enrollments?.find(x => x.course_name === batchData.course_name);
                          if (!e) return null;
                          const isAppreciation = e.course_name !== 'Online Filmmaking Course';
                          return (
                            <button 
                              onClick={() => openAcademicModal(s, e.id)}
                              className="btn" 
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                              title={isAppreciation ? 'Exam Result' : 'Academic Records'}
                            >
                              <GraduationCap size={16} />
                            </button>
                          );
                        })()}
                        {(() => {
                          const e = s.enrollments?.find(x => x.course_name === 'Online Filmmaking Course');
                          if (!e || batchData.course_name !== 'Online Filmmaking Course') return null;
                          return (
                            <button
                              onClick={() => openPhase2Modal(s, e.id)}
                              className="btn"
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}
                              title="Phase 2: Shooting & Editing Attendance"
                            >
                              <Clapperboard size={16} />
                            </button>
                          );
                        })()}
                        <button 
                          onClick={() => openEditModal(s)}
                          className="btn" 
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', background: 'rgba(56, 189, 248, 0.1)', color: '#0284c7', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                          title="Edit Student"
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => confirmDeleteStudent(s.id, s.full_name, s.batch_number)}
                          className="btn" 
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                          title="Delete Student"
                        >
                          <Trash2 size={16} />
                        </button>
                        
                        <button 
                          onClick={() => handleRemoveStudentClick(s.user_id)}
                          className="modern-btn modern-btn--danger"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          <Trash2 size={14} /> Remove
                        </button>

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
      {confirmConfig && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '16px', width: '100%', maxWidth: '400px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="font-display">{confirmConfig.title}</h3>
              <button className="icon-btn-ghost" onClick={() => setConfirmConfig(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div style={{ padding: '2rem 1.5rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <p>{confirmConfig.message}</p>
            </div>
            <div style={{ padding: '1.25rem 1.5rem', background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: confirmConfig.isAlert ? 'center' : 'flex-end', gap: '1rem' }}>
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

      {/* Edit Modal Overlay */}
      {editingStudent && (
        <EditStudentModal 
          student={editingStudent} 
          onClose={() => setEditingStudent(null)} 
          onSaveSuccess={() => fetchStudents(batchData.id)} 
        />
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
