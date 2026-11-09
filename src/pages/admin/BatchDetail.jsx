import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DELIVERY_MODE_OPTIONS, normalizeDeliveryMode, deliveryModeLabel, deliveryModeFromSubject, createDefaultRoutineSlot, DEFAULT_ROUTINE_SLOT } from '../../utils/deliveryModes';
import PlatformSelector from '../../components/admin/PlatformSelector';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, Calendar, Users, Clock, CheckCircle2, XCircle, 
  FileText, Film, Award, UserCheck, Camera, Video, Wallet,
  Search, ExternalLink, Trash2, UserPlus, Pencil, CheckSquare,
  History, RefreshCw, Zap, Loader2, GraduationCap, Clapperboard, Edit, Square, X, Lock, Plus
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import './BatchDetail.css';
import { useCourseSettings } from '../../hooks/useCourseSettings';
import BatchFormModal from '../../components/admin/BatchFormModal';
import AddStudentsModal from '../../components/admin/AddStudentsModal';
import EditStudentModal from '../../components/admin/EditStudentModal';
import UploadResultsModal from '../../components/admin/UploadResultsModal';
import DefinedCourseProgressModal from '../../components/admin/DefinedCourseProgressModal';
import BatchAttendanceSheet from '../../components/admin/BatchAttendanceSheet';
import { useAuth } from '../../context/AuthContext';
import { resolveFeeAccounting, isCourseFeeUnpaid, resolveEnrollmentFinancialsClient } from '../../utils/feeUtils';

const hasPendingDueOrPartialPayment = (course) => isCourseFeeUnpaid(course);
import { getOrdinalSuffix } from '../../utils/formatUtils';

// Reusable Stat Card
function StatCard({ icon, value, label, colorVariant, onClick, isActive }) {
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

  const cardStyle = {
    cursor: onClick ? 'pointer' : 'default',
    transition: 'all 0.2s ease-in-out',
    ...(onClick && {
      // Rule 4: subtle transition without hover movement
      background: isActive ? getIconBg().replace('0.1', '0.15') : undefined,
      borderColor: isActive ? getIconColor() : undefined,
      boxShadow: isActive ? `0 4px 20px ${getIconBg().replace('0.1', '0.2')}` : undefined,
    })
  };

  return (
    <div 
      className={`batch-stat-card ${onClick ? 'interactive' : ''} ${isActive ? 'active' : ''}`}
      style={cardStyle}
      onClick={onClick}
    >
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
  const { slug } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [attendancePhase, setAttendancePhase] = useState(null);
  const canMarkAttendance = currentUser?.role === 'admin' && Boolean(
    currentUser.is_super_admin || currentUser.isSuperAdmin ||
    currentUser.permissions?.includes('*') || currentUser.permissions?.includes('students:academic_records')
  );

  const attendanceButton = phase => canMarkAttendance && (
    <button type="button" className="modern-btn modern-btn--secondary" onClick={() => setAttendancePhase(phase)}>
      <CheckSquare size={16} aria-hidden="true" /> Attendance Sheet
    </button>
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [batchData, setBatchData] = useState(null);
  const [progressData, setProgressData] = useState(null);
  const [selectedStatFilter, setSelectedStatFilter] = useState(null);
  const [recentlyToggledIds, setRecentlyToggledIds] = useState([]);

  const { courseSettings, getSetting, loading: settingsLoading } = useCourseSettings();
  const currentCourseSetting = useMemo(() => {
    if (!batchData || settingsLoading) return null;
    return getSetting(batchData.course_name, batchData.batch_number, batchData.id);
  }, [batchData, courseSettings, settingsLoading, getSetting]);
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

  // Batch Routine Adjustment Modal State
  const [editingRoutinePhase, setEditingRoutinePhase] = useState(null);
  const [batchRoutineSlots, setBatchRoutineSlots] = useState([]);
  const [routineAuditReason, setRoutineAuditReason] = useState('');
  const [routineAuditTouched, setRoutineAuditTouched] = useState(false);
  const routineAuditInputRef = useRef(null);
  const lastSlotRef = useRef(null);
  const [routineSaving, setRoutineSaving] = useState(false);
  const [routineError, setRoutineError] = useState('');
  const [catalogSubjects, setCatalogSubjects] = useState([]);
  const [catalogTeachers, setCatalogTeachers] = useState([]);

  // Defined Course Progress Modal State
  const [definedProgressModal, setDefinedProgressModal] = useState({
    isOpen: false,
    student: null,
    enrollment: null,
    initialPhaseIndex: 0
  });

  const openDefinedProgress = (student, enrollment, phaseIndex = 0) => {
    setDefinedProgressModal({
      isOpen: true,
      student,
      enrollment,
      initialPhaseIndex: phaseIndex
    });
  };

  const closeDefinedProgress = () => {
    setDefinedProgressModal(prev => ({ ...prev, isOpen: false }));
  };

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
  const [showUploadResultsModal, setShowUploadResultsModal] = useState(false);

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

  // Fee calculation dynamically computed from student enrollments
  const { totalCollected, totalOutstanding, feeSegments, paidCount, partialCount, dueCount } = useMemo(() => {
    if (!batchData) {
      return { totalCollected: 0, totalOutstanding: 0, feeSegments: { paidPct: 0, partialPct: 0, duePct: 100 }, paidCount: 0, partialCount: 0, dueCount: 0 };
    }

    let collectedSum = 0;
    let outstandingSum = 0;
    
    let paidCount = 0;
    let partialCount = 0;
    let dueCount = 0;

    const courseName = batchData.course_name;
    const isOnlineFilmmaking = courseName === 'Online Filmmaking Course';

    const defaultFee = batchData.course_fee || 8000;
    const defaultP1 = batchData.phase1_fee || 4000;
    const defaultP2 = batchData.phase2_fee || 4000;

    studentsData.forEach(student => {
      const e = student.enrollments?.find(x => x.course_name === courseName);
      let feeDetails = null;
      if (e?.fee_details) {
        try {
          feeDetails = typeof e.fee_details === 'string' ? JSON.parse(e.fee_details) : e.fee_details;
        } catch (err) {
          // Ignore
        }
      }

      let totalFee = 0;
      let collected = 0;

      let studentCollected = 0;
      let studentOutstanding = 0;
      let studentTotalFee = 0;

      if (e?.defined_progress?.phases && Array.isArray(e.defined_progress.phases) && e.defined_progress.phases.length > 0) {
        e.defined_progress.phases.forEach((p, idx) => {
          const phaseData = feeDetails?.phases?.[idx] || feeDetails?.[`phase${idx + 1}`];
          const acct = resolveFeeAccounting(phaseData || {}, {
            expectedFee: p.feeAmount || p.fee || 0,
            courseDiscount: feeDetails?.discount
          });
          studentTotalFee += acct.grossFee;
          studentCollected += acct.cashCollected;
          studentOutstanding += acct.remainingDue;
        });
      } else if (isOnlineFilmmaking) {
        const p1 = feeDetails?.phase1 || {};
        const p1Acct = resolveFeeAccounting(p1, {
          expectedFee: defaultP1,
          courseDiscount: feeDetails?.discount
        });
        const p2 = feeDetails?.phase2 || {};
        const p2Acct = resolveFeeAccounting(p2, {
          expectedFee: defaultP2,
          courseDiscount: feeDetails?.discount
        });

        studentTotalFee = p1Acct.grossFee + p2Acct.grossFee;
        studentCollected = p1Acct.cashCollected + p2Acct.cashCollected;
        studentOutstanding = p1Acct.remainingDue + p2Acct.remainingDue;
      } else {
        const p = feeDetails || {};
        const acct = resolveFeeAccounting(p, {
          expectedFee: defaultFee,
          courseDiscount: feeDetails?.discount
        });

        studentTotalFee = acct.grossFee;
        studentCollected = acct.cashCollected;
        studentOutstanding = acct.remainingDue;
      }

      collectedSum += studentCollected;
      outstandingSum += studentOutstanding;

      // Classify for progress bar segments
      if (studentTotalFee > 0 && studentOutstanding === 0) {
        paidCount++;
      } else if (studentCollected > 0) {
        partialCount++;
      } else {
        dueCount++;
      }
    });

    const totalStudents = studentsData.length;
    let paidPct = 0;
    let partialPct = 0;
    let duePct = 0;

    if (totalStudents > 0) {
      paidPct = (paidCount / totalStudents) * 100;
      partialPct = (partialCount / totalStudents) * 100;
      duePct = (dueCount / totalStudents) * 100;
    } else {
      duePct = 100;
    }

    return {
      totalCollected: Math.round(collectedSum),
      totalOutstanding: Math.round(outstandingSum),
      feeSegments: { paidPct, partialPct, duePct },
      paidCount,
      partialCount,
      dueCount
    };
  }, [studentsData, batchData]);

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
    const isAdmitted = isOnlineFilmmaking ? (enrollment?.step3_completed === 1) : true;

    if (!isAdmitted) {
      setConfirmConfig({
        title: 'Action Restricted',
        message: 'Cannot update academic records because Phase 2: Admitted is not yet completed.',
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
      const p1Acct = resolveFeeAccounting(phase1);
      const phase1PaidAny = p1Acct.cashCollected > 0 || p1Acct.isPaid;
      const phase1FullyPaid = p1Acct.isPaid;

      const phase2 = feeDetails?.phase2 || {};
      const p2Acct = resolveFeeAccounting(phase2);
      const phase2PaidAny = p2Acct.cashCollected > 0 || p2Acct.isPaid;

      if (stepField === 'step2_completed') {
        if (!phase1PaidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update exam results because the student is completely unpaid.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
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
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 1: Admitted" because a payment has already been made for this phase. Please change the payment to 0 first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      }
    }

    if (courseName !== 'Online Filmmaking Course') {
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
      const amountPaidNum = parseFloat((feeDetails.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
      const installments = feeDetails.installments || [];
      const paidAny = amountPaidNum > 0 || installments.some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) > 0);

      if (stepField === 'step2_completed') {
        if (!paidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Completed Course" because the student is completely unpaid.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (!e?.step1_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Completed Course" because "Admission Confirmed" is not yet completed.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        openAcademicModal(student, enrollmentId);
        return;
      }

      if (willBeChecked) {
        if (stepField === 'step1_completed') {
          openEditModal(student);
          return;
        }
      } else {
        if (stepField === 'step1_completed' && e?.step2_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Admission Confirmed" while "Completed Course" is checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        
        let feeDetails = {};
        if (e?.fee_details) {
          try {
            feeDetails = typeof e.fee_details === 'string' ? JSON.parse(e.fee_details) : e.fee_details;
          } catch (err) {
            console.error(err);
          }
        }
        const amountPaidNum = parseFloat((feeDetails.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
        const installments = feeDetails.installments || [];
        const paidAny = amountPaidNum > 0 || installments.some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) > 0);
        
        if (stepField === 'step1_completed' && paidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Admission Confirmed" because a payment has already been made. Please change the payment to 0 first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
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
        fetchProgress(batchData.id);
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

  const getAcademicValidationError = () => {
    if (!academicStudent) return null;
    const isOnlineFilmmaking = academicStudent.enrollment?.course_name === 'Online Filmmaking Course';

    const attendanceStr = academicFormData.attendance_classes;
    const totalAttendanceStr = academicFormData.attendance_total;
    
    if (attendanceStr === '' || attendanceStr === undefined || attendanceStr === null) return 'Classes Attended is required.';
    if (totalAttendanceStr === '' || totalAttendanceStr === undefined || totalAttendanceStr === null) return 'Total Classes is required.';
    
    const attendance = parseInt(attendanceStr) || 0;
    const totalAttendance = parseInt(totalAttendanceStr) || 0;

    if (attendance > totalAttendance) return 'Attended classes cannot exceed total classes.';
    if (attendance < 0) return 'Attended classes cannot be negative.';
    if (totalAttendance < 1) return 'Total classes must be at least 1.';

    if (!isOnlineFilmmaking) {
      const examStr = academicFormData.exam_written;
      if (examStr === '' || examStr === undefined || examStr === null) return 'Written exam score is required.';
      const exam = parseInt(examStr) || 0;
      if (exam > 100) return 'Written exam score cannot exceed 100.';
      if (exam < 0) return 'Written exam score cannot be negative.';
    } else {
      const exam = parseInt(academicFormData.exam_written) || 0;
      const screenplay = parseInt(academicFormData.assignment_screenplay) || 0;
      const shootingScript = parseInt(academicFormData.assignment_shooting_script) || 0;

      if (exam > 80) return 'Written exam score cannot exceed 80.';
      if (exam < 0) return 'Written exam score cannot be negative.';
      
      if (screenplay > 10) return 'Screenplay assignment score cannot exceed 10.';
      if (screenplay < 0) return 'Screenplay assignment score cannot be negative.';
      
      if (shootingScript > 10) return 'Shooting script assignment score cannot exceed 10.';
      if (shootingScript < 0) return 'Shooting script assignment score cannot be negative.';
    }
    return null;
  };

  const submitAcademic = async (e) => {
    e.preventDefault();
    setIsAcademicSaving(true);
    setAcademicError('');

    const valError = getAcademicValidationError();
    if (valError) {
      setAcademicError(valError);
      setIsAcademicSaving(false);
      return;
    }

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
        fetchProgress(batchData.id);
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
        fetchProgress(batchData.id);
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
        fetchProgress(batchData.id);
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

  const WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const DELIVERY_MODES = DELIVERY_MODE_OPTIONS;
  const CLASS_CATEGORIES = [
    { value: 'theory', label: 'Theory' },
    { value: 'practical', label: 'Practical' },
    { value: 'shooting', label: 'Shooting Session' },
    { value: 'editing', label: 'Editing Session' },
    { value: 'review', label: 'Review & Q&A' }
  ];

  const fetchRoutineCatalogs = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      const [sRes, tRes] = await Promise.all([
        fetch('/api/admin/custom-subjects', { headers }),
        fetch('/api/admin/teachers', { headers })
      ]);
      if (sRes.ok) {
        const sData = await sRes.json();
        setCatalogSubjects(sData.subjects || sData || []);
      }
      if (tRes.ok) {
        const tData = await tRes.json();
        setCatalogTeachers(tData.teachers || []);
      }
    } catch (err) {
      console.error('Failed to fetch routine catalogs in BatchDetail:', err);
    }
  };

  const fetchAllData = async () => {
    if (!slug) return;
    try {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const [batchRes, progressRes, studentsRes, transitionsRes] = await Promise.all([
        fetch(`/api/admin/batches/${slug}`, { headers }),
        fetch(`/api/admin/batches/${slug}/progress`, { headers }),
        fetch(`/api/admin/batches/${slug}/students`, { headers }),
        fetch(`/api/admin/batches/${slug}/transitions`, { headers })
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

  useEffect(() => {
    fetchAllData();
    fetchRoutineCatalogs();
  }, [slug]);

  // Window focus listener: dynamically refresh custom subjects & teachers when returning from other tabs
  useEffect(() => {
    const handleFocus = () => {
      fetchRoutineCatalogs();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleOpenRoutineModal = (phase) => {
    fetchRoutineCatalogs();
    setEditingRoutinePhase(phase);
    setBatchRoutineSlots(
      Array.isArray(phase.routine) && phase.routine.length > 0
        ? phase.routine.map(slot => createDefaultRoutineSlot(slot))
        : [createDefaultRoutineSlot()]
    );
    setRoutineAuditReason('');
    setRoutineAuditTouched(false);
    setRoutineError('');
  };

  const handleCloseRoutineModal = () => {
    setEditingRoutinePhase(null);
    setBatchRoutineSlots([]);
    setRoutineAuditReason('');
    setRoutineAuditTouched(false);
    setRoutineError('');
    setRoutineSaving(false);
  };

  const handleAddRoutineSlot = () => {
    setBatchRoutineSlots(prev => [
      ...prev,
      createDefaultRoutineSlot()
    ]);
    setTimeout(() => {
      if (lastSlotRef.current) {
        lastSlotRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const firstInput = lastSlotRef.current.querySelector('input, select');
        if (firstInput) firstInput.focus();
      }
    }, 50);
  };

  const handleCopyFromPhaseClass = (slotIdx, classId) => {
    if (!classId || !editingRoutinePhase) return;
    const cls = (editingRoutinePhase.classes || []).find(c => String(c.id) === String(classId));
    if (!cls) return;
    const fallbackSlot = createDefaultRoutineSlot();

    let validatedTid = null;
    let validatedTname = cls.teacherName || fallbackSlot.teacherName;
    if (cls.teacherUserId) {
      const matchTeacher = catalogTeachers.find(t => t.id === Number(cls.teacherUserId) && t.is_active !== 0 && !t.deleted_at);
      if (matchTeacher) {
        validatedTid = matchTeacher.id;
        if (!validatedTname) {
          validatedTname = matchTeacher.full_name || `${matchTeacher.first_name} ${matchTeacher.last_name}`;
        }
      }
    }

    setBatchRoutineSlots(prev => {
      const updated = [...prev];
      updated[slotIdx] = {
        ...updated[slotIdx],
        classId: cls.id,
        classTitle: cls.title || fallbackSlot.classTitle,
        subjectName: cls.subjectName || fallbackSlot.subjectName,
        teacherName: validatedTname,
        teacherUserId: validatedTid,
        deliveryMode: cls.deliveryMode || fallbackSlot.deliveryMode,
        category: cls.category || fallbackSlot.category,
        platform: cls.platform || fallbackSlot.platform
      };
      return updated;
    });
  };

  const handleRemoveRoutineSlot = (index) => {
    setBatchRoutineSlots(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateRoutineSlot = (index, field, value) => {
    setBatchRoutineSlots(prev => {
      const updated = [...prev];
      const nextSlot = { ...updated[index], [field]: value };
      if (field === 'date' && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        if (!isNaN(dateObj.getTime())) {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          nextSlot.weekday = dayNames[dateObj.getUTCDay()];
        }
      }
      if (field === 'teacherUserId') {
        const parsedId = value ? Number(value) : null;
        const match = catalogTeachers.find(t => t.id === parsedId && t.is_active !== 0 && !t.deleted_at);
        nextSlot.teacherUserId = match ? match.id : null;
        if (match) {
          nextSlot.teacherName = match.full_name || `${match.first_name} ${match.last_name}`;
        }
      }
      if (field === 'teacherName') {
        nextSlot.teacherName = value;
        // If a teacher account was selected, check if display text was edited away from that account's canonical name.
        // If edited away, clear the association (teacherUserId = null).
        // Display names must NEVER silently select or link an account!
        if (nextSlot.teacherUserId) {
          const match = catalogTeachers.find(t => t.id === Number(nextSlot.teacherUserId));
          const canonicalName = match ? (match.full_name || `${match.first_name} ${match.last_name}`) : '';
          if (!value || value.trim().toLowerCase() !== canonicalName.trim().toLowerCase()) {
            nextSlot.teacherUserId = null;
          }
        } else {
          nextSlot.teacherUserId = null;
        }
      }
      if (field === 'subjectName' && value && typeof value === 'string') {
        const match = catalogSubjects.find(s => s.name?.trim().toLowerCase() === value.trim().toLowerCase());
        if (match) {
          if (!nextSlot.teacherName && match.teacher_name) {
            nextSlot.teacherName = match.teacher_name;
            if (match.teacher_id) {
              const teacherMatch = catalogTeachers.find(t => t.id === Number(match.teacher_id) && t.is_active !== 0 && !t.deleted_at);
              nextSlot.teacherUserId = teacherMatch ? teacherMatch.id : null;
            } else {
              nextSlot.teacherUserId = null;
            }
          }
          if ((!nextSlot.deliveryMode || nextSlot.deliveryMode === 'live') && match.class_type) {
            nextSlot.deliveryMode = deliveryModeFromSubject(match);
          }
        }
      }
      updated[index] = nextSlot;
      return updated;
    });
  };

  const handleRevertBatchRoutine = async () => {
    if (!editingRoutinePhase || !batchData?.course_definition?.id) return;
    const confirmed = window.confirm(
      'Are you sure you want to revert this batch routine to the course default template? This will delete the custom routine override for this batch.'
    );
    if (!confirmed) return;

    try {
      setRoutineSaving(true);
      setRoutineError('');
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/course-definitions/${batchData.course_definition.id}/routine`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          phase_id: editingRoutinePhase.id,
          batch_id: batchData.id,
          action: 'revert',
          reason: routineAuditReason.trim() || 'Reverted batch schedule to course default template'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to revert batch routine.');
      }

      showToast('Batch routine reverted to course template successfully!');
      handleCloseRoutineModal();
      await fetchAllData();
    } catch (err) {
      console.error('Error reverting batch routine:', err);
      setRoutineError(err.message || 'Error reverting batch routine');
    } finally {
      setRoutineSaving(false);
    }
  };

  const handleSaveBatchRoutine = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editingRoutinePhase || !batchData?.course_definition?.id) {
      setRoutineError('Course definition data is missing for this batch. Cannot save routine override.');
      return;
    }
    const trimmedReason = routineAuditReason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      setRoutineAuditTouched(true);
      setRoutineError('Reason for routine adjustment is required (at least 3 characters) before saving (Required for Audit Log).');
      if (routineAuditInputRef.current) {
        routineAuditInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        routineAuditInputRef.current.focus();
      }
      return;
    }
    try {
      setRoutineSaving(true);
      setRoutineError('');
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/course-definitions/${batchData.course_definition.id}/routine`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          phase_id: editingRoutinePhase.id,
          batch_id: batchData.id,
          routine: batchRoutineSlots,
          reason: trimmedReason
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update batch routine.');
      }

      showToast('Batch class routine updated successfully!');
      handleCloseRoutineModal();
      await fetchAllData();
    } catch (err) {
      console.error('Error saving batch routine:', err);
      setRoutineError(err.message || 'Error updating batch routine');
    } finally {
      setRoutineSaving(false);
    }
  };

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

  const handleUploadResultsClick = () => {
    setShowUploadResultsModal(true);
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

  const toggleStatFilter = (filter) => {
    setRecentlyToggledIds([]);
    setSelectedStatFilter(prev => {
      const newVal = prev === filter ? null : filter;
      if (newVal) {
        setTimeout(() => {
          const el = document.querySelector('.batch-students-section');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
      return newVal;
    });
  };

  // Course type flags
  const isFilmmaking = batchData.course_name === 'Online Filmmaking Course';
  const isFilmAppreciation = batchData.course_name === 'Film Appreciation Course';

  // Filter students
  const filteredStudents = studentsData.filter(s => {
    // 1. Text search filter
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(' ').filter(Boolean);
      const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
      const bfiId = (s.bfi_id || '').toLowerCase();
      const matchesSearch = terms.every(term => fullName.includes(term) || bfiId.includes(term));
      if (!matchesSearch) return false;
    }

    // 2. Stat card click filter
    if (selectedStatFilter && selectedStatFilter !== 'all') {
      const enrollment = s.enrollments?.find(e => e.course_name === batchData.course_name);
      
      switch (selectedStatFilter) {
        // Phase 1 (Filmmaking)
        case 'attendance_qualified':
          return enrollment && enrollment.attendance_total > 0 && (enrollment.attendance_classes / enrollment.attendance_total >= 0.8);
        case 'attendance_not_qualified':
          return !enrollment || enrollment.attendance_total === 0 || (enrollment.attendance_classes / enrollment.attendance_total < 0.8);
        case 'screenplay_submitted':
          return enrollment && enrollment.assignment_screenplay > 0;
        case 'shooting_script_submitted':
          return enrollment && enrollment.assignment_shooting_script > 0;
        case 'phase1_completed':
          return enrollment && enrollment.step2_completed === 1;
          
        // Phase 2 (Filmmaking)
        case 'phase2_admitted':
          return enrollment && enrollment.step3_completed === 1;
        case 'phase2_shooting_attended':
          return enrollment && enrollment.phase2_shooting_attended === 1;
        case 'phase2_editing_attended':
          return enrollment && enrollment.phase2_editing_attended === 1;
        case 'phase2_completed':
          return enrollment && enrollment.step4_completed === 1;
          
        // Shared: exam_passed works the same way for all courses
        case 'exam_passed':
          return enrollment && enrollment.step2_completed === 1;
          
        // exam_failed differs by course type
        case 'exam_failed':
          if (isFilmmaking) {
            // Filmmaking: has attended (step1) but not passed exam (step2)
            return enrollment && enrollment.step1_completed === 1 && enrollment.step2_completed !== 1;
          } else {
            // Film Appreciation / Workshop: has a non-zero exam score but did NOT pass
            return enrollment && (enrollment.exam_written > 0) && enrollment.step2_completed !== 1;
          }
          
        // Workshop / Film Appreciation (single phase)
        case 'attendance':
          return enrollment && enrollment.attendance_classes > 0;
        case 'assignment_submitted':
          return enrollment && (enrollment.assignment_screenplay > 0 || enrollment.assignment_shooting_script > 0);
        case 'completed':
          return enrollment && enrollment.step2_completed === 1;

        case 'fee_fully_paid':
        case 'fee_partial_paid':
        case 'fee_unpaid': {
          if (!enrollment) return false;
          const fin = resolveEnrollmentFinancialsClient(enrollment, batchData);
          if (selectedStatFilter === 'fee_fully_paid') return fin.isPaid;
          if (selectedStatFilter === 'fee_partial_paid') return fin.isPartial;
          if (selectedStatFilter === 'fee_unpaid') return fin.isUnpaid;
          return true;
        }

        default:
          if (selectedStatFilter && selectedStatFilter.startsWith('dp_')) {
            const defPhases = enrollment?.defined_progress?.phases || [];
            if (selectedStatFilter.startsWith('dp_admitted_')) {
              const pId = selectedStatFilter.replace('dp_admitted_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph ? Boolean(ph.admitted) : false;
            }
            if (selectedStatFilter.startsWith('dp_att_qual_')) {
              const pId = selectedStatFilter.replace('dp_att_qual_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph ? Boolean(ph.attendance?.isQualified) : false;
            }
            if (selectedStatFilter.startsWith('dp_att_not_qual_')) {
              const pId = selectedStatFilter.replace('dp_att_not_qual_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph ? !ph.attendance?.isQualified : true;
            }
            if (selectedStatFilter.startsWith('dp_asg_done_')) {
              const pId = selectedStatFilter.replace('dp_asg_done_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph && ph.assignments ? ph.assignments.completed >= ph.assignments.total : false;
            }
            if (selectedStatFilter.startsWith('dp_exam_passed_')) {
              const pId = selectedStatFilter.replace('dp_exam_passed_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph?.exam?.isPassed === true;
            }
            if (selectedStatFilter.startsWith('dp_exam_failed_')) {
              const pId = selectedStatFilter.replace('dp_exam_failed_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph?.exam && !ph.exam.isPassed && ph.exam.marks !== null && ph.exam.marks !== undefined;
            }
            if (selectedStatFilter.startsWith('dp_completed_')) {
              const pId = selectedStatFilter.replace('dp_completed_', '');
              const ph = defPhases.find(p => p.id === pId);
              return ph?.isPassed === true;
            }
          }
          return true;
      }
    }
    
    return true;
  });

  // Funnel data prep
  let funnelData = [];

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
        ...(!isFilmAppreciation ? [{ stage: 'Attended', value: progressData.single_phase?.attendance || 0 }] : []),
        ...(!isFilmAppreciation ? [{ stage: 'Assignment', value: progressData.single_phase?.assignment_submitted || 0 }] : []),
        { stage: 'Exam Passed', value: progressData.single_phase?.exam_passed || 0 },
        { stage: 'Exam Failed', value: progressData.single_phase?.exam_failed || 0 },
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

  const renderCourseFeeChip = () => {
    let fee = batchData.course_fee;
    let p1 = batchData.phase1_fee;
    let p2 = batchData.phase2_fee;
    let isCustom = batchData.is_custom_fee;
    const name = batchData.course_name || '';

    // Frontend fallback defaults if not returned by backend
    if (fee === undefined || fee === null || fee === 0) {
      if (name === 'Online Filmmaking Course') {
        fee = 8000;
        p1 = 4000;
        p2 = 4000;
        isCustom = false;
      } else if (name === 'Film Appreciation Course') {
        fee = 8000;
        p1 = 8000;
        p2 = 0;
        isCustom = false;
      }
    }

    if (!fee) return null;

    return (
      <div className="batch-meta-chip" title={isCustom ? "Customized Course Fee" : "Default Course Fee"} style={{ fontWeight: 600 }}>
        <Wallet size={14} />
        <span>Course Fee: ৳{fee.toLocaleString()}</span>
        <span style={{ 
          fontSize: '0.7rem', 
          opacity: 0.85, 
          marginLeft: '0.4rem', 
          padding: '0.1rem 0.4rem', 
          borderRadius: '4px', 
          background: isCustom ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)', 
          color: isCustom ? '#10b981' : 'var(--text-muted)',
          border: isCustom ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(148, 163, 184, 0.2)',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          fontWeight: 700
        }}>
          {isCustom ? 'custom' : 'default'}
        </span>
        {name === 'Online Filmmaking Course' && p1 !== undefined && p2 !== undefined && p1 > 0 && (
          <span style={{ fontSize: '0.85em', opacity: 0.8, marginLeft: '0.25rem', fontWeight: 400 }}>
            (P1: ৳{p1.toLocaleString()} | P2: ৳{p2.toLocaleString()})
          </span>
        )}
      </div>
    );
  };

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
            <button onClick={handleUploadResultsClick} className="modern-btn modern-btn--secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={16} /> Upload Results
            </button>
            <button onClick={handleAddStudentsClick} className="modern-btn modern-btn--primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus size={16} /> Add Students
            </button>
          </div>
        </div>

        <div className="batch-meta-chips">
          {renderCourseFeeChip()}
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

      {/* SECTION 1B: Defined Course Structure & Operational Routines */}
      {batchData.course_definition && (
        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderRadius: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Film size={18} className="text-accent" /> {batchData.course_definition.name} (Curriculum v{batchData.course_definition.version})
              </h3>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {batchData.course_definition.phase_count} Structured Phase{batchData.course_definition.phase_count > 1 ? 's' : ''} • Operational Class Routines
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '1rem' }}>
            {batchData.course_definition.definition?.phases?.map((p, idx) => (
              <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem' }}>
                  <span>Phase {idx + 1}: {p.title || p.name}</span>
                  {p.routineSource === 'batch_override' ? (
                    <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>
                      Batch Schedule
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
                      Course Default
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  {p.classes ? `${p.classes.length} Classes` : `${p.classCount || 0} Classes`}
                </div>
                <div style={{ flex: 1 }}>
                  {p.routine && p.routine.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {p.routine.map((slot, rIdx) => (
                        <div key={rIdx} style={{ fontSize: '0.75rem', color: slot.date ? '#93c5fd' : 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                            <Calendar size={12} style={{ flexShrink: 0 }} />
                            <span>
                              {slot.date ? `${slot.date} (${slot.weekday})` : `Every ${slot.weekday}`}: {slot.startTime}–{slot.endTime}
                            </span>
                          </div>
                          {(slot.subjectName || slot.classTitle) && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', paddingLeft: '1rem' }}>
                              {slot.subjectName && <strong style={{ color: '#60a5fa' }}>{slot.subjectName}</strong>}
                              {slot.subjectName && slot.classTitle && ' — '}
                              {slot.classTitle && <span>{slot.classTitle}</span>}
                            </div>
                          )}
                          {(slot.teacherName || slot.deliveryMode || slot.category || slot.platform) && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', paddingLeft: '1rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                              {slot.teacherName && <span>👨‍🏫 {slot.teacherName}</span>}
                              {slot.teacherName && (slot.deliveryMode || slot.category || slot.platform) && <span>•</span>}
                              {slot.deliveryMode && (
                                <span style={{ textTransform: 'capitalize' }}>
                                  {deliveryModeLabel(slot.deliveryMode)}
                                </span>
                              )}
                              {slot.category && <span style={{ textTransform: 'capitalize' }}>({slot.category})</span>}
                              {slot.platform && (
                                <span style={{
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: 'rgba(99, 102, 241, 0.15)',
                                  color: '#818cf8',
                                  fontWeight: 500,
                                  fontSize: '0.68rem'
                                }}>
                                  🎥 {slot.platform}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No routine scheduled
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenRoutineModal(p)}
                  style={{
                    marginTop: '0.75rem',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    background: 'rgba(59,130,246,0.12)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59,130,246,0.25)',
                    cursor: 'pointer',
                    minHeight: '38px',
                    transition: 'border-color 0.15s, background-color 0.15s'
                  }}
                  title="Adjust routine dates, days, and times specifically for this batch"
                >
                  <Pencil size={12} /> Adjust Routine
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 2: Progress Dashboard */}
      {progressData && (
        <div className="batch-progress-section">
          {progressData.defined_phases && progressData.defined_phases.length > 0 ? (
            progressData.defined_phases.map((dp, idx) => (
              <div key={dp.phaseId || idx} style={{ marginTop: idx > 0 ? '1rem' : 0 }}>
                <div className="batch-phase-label batch-attendance-heading" style={{ color: idx === 1 ? '#a855f7' : idx === 2 ? '#ec4899' : '#60a5fa' }}>
                  <span>{dp.title || `Phase ${dp.phaseIndex || idx + 1}`}</span>
                  {attendanceButton(dp.phaseIndex || idx + 1)}
                </div>
                <div className="batch-metrics-grid">
                  <StatCard icon={<Users size={20} />} value={dp.admitted} label="Admitted" colorVariant="Blue" onClick={() => toggleStatFilter(`dp_admitted_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_admitted_${dp.phaseId}`} />
                  <StatCard icon={<CheckCircle2 size={20} />} value={dp.attendance_qualified} label="Attendance Qualified" colorVariant="Green" onClick={() => toggleStatFilter(`dp_att_qual_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_att_qual_${dp.phaseId}`} />
                  <StatCard icon={<XCircle size={20} />} value={dp.attendance_not_qualified} label="Not Qualified" colorVariant="Red" onClick={() => toggleStatFilter(`dp_att_not_qual_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_att_not_qual_${dp.phaseId}`} />
                  <StatCard icon={<FileText size={20} />} value={dp.assignments_completed} label="Assignments Done" colorVariant="Amber" onClick={() => toggleStatFilter(`dp_asg_done_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_asg_done_${dp.phaseId}`} />
                  <StatCard icon={<Award size={20} />} value={dp.exam_passed} label="Exam Passed" colorVariant="Green" onClick={() => toggleStatFilter(`dp_exam_passed_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_exam_passed_${dp.phaseId}`} />
                  <StatCard icon={<XCircle size={20} />} value={dp.exam_failed} label="Exam Failed" colorVariant="Red" onClick={() => toggleStatFilter(`dp_exam_failed_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_exam_failed_${dp.phaseId}`} />
                  <StatCard icon={<CheckSquare size={20} />} value={dp.completed} label="Phase Completed" colorVariant="Green" onClick={() => toggleStatFilter(`dp_completed_${dp.phaseId}`)} isActive={selectedStatFilter === `dp_completed_${dp.phaseId}`} />
                </div>
              </div>
            ))
          ) : isFilmmaking ? (
            <>
              <div>
                <div className="batch-phase-label">Phase 1</div>
                <div className="batch-metrics-grid">
                  <StatCard icon={<Users size={20} />} value={progressData.total_students} label="Total Students" colorVariant="Blue" onClick={() => toggleStatFilter('all')} isActive={selectedStatFilter === 'all'} />
                  <StatCard icon={<CheckCircle2 size={20} />} value={progressData.phase1?.attendance_qualified} label="Attendance Qualified" colorVariant="Green" onClick={() => toggleStatFilter('attendance_qualified')} isActive={selectedStatFilter === 'attendance_qualified'} />
                  <StatCard icon={<XCircle size={20} />} value={progressData.phase1?.attendance_not_qualified} label="Not Qualified" colorVariant="Red" onClick={() => toggleStatFilter('attendance_not_qualified')} isActive={selectedStatFilter === 'attendance_not_qualified'} />
                  <StatCard icon={<FileText size={20} />} value={progressData.phase1?.screenplay_submitted} label="Screenplay Submitted" colorVariant="Amber" onClick={() => toggleStatFilter('screenplay_submitted')} isActive={selectedStatFilter === 'screenplay_submitted'} />
                  <StatCard icon={<Film size={20} />} value={progressData.phase1?.shooting_script_submitted} label="Shooting Script Submitted" colorVariant="Amber" onClick={() => toggleStatFilter('shooting_script_submitted')} isActive={selectedStatFilter === 'shooting_script_submitted'} />
                  <StatCard icon={<Award size={20} />} value={progressData.phase1?.exam_passed} label="Exam Passed" colorVariant="Green" onClick={() => toggleStatFilter('exam_passed')} isActive={selectedStatFilter === 'exam_passed'} />
                  <StatCard icon={<XCircle size={20} />} value={progressData.phase1?.exam_failed} label="Exam Failed" colorVariant="Red" onClick={() => toggleStatFilter('exam_failed')} isActive={selectedStatFilter === 'exam_failed'} />
                  <StatCard icon={<CheckSquare size={20} />} value={progressData.phase1?.completed} label="Phase 1 Completed" colorVariant="Green" onClick={() => toggleStatFilter('phase1_completed')} isActive={selectedStatFilter === 'phase1_completed'} />
                </div>
              </div>
              
              {progressData.phase2?.admitted > 0 ? (
                <div style={{ marginTop: '1rem' }} className="batch-phase2-section visible">
                  <div className="batch-phase-label purple batch-attendance-heading"><span>Phase 2</span>{attendanceButton(2)}</div>
                  <div className="batch-metrics-grid">
                    <StatCard icon={<UserCheck size={20} />} value={progressData.phase2?.admitted} label="Phase 2 Admitted" colorVariant="Blue" onClick={() => toggleStatFilter('phase2_admitted')} isActive={selectedStatFilter === 'phase2_admitted'} />
                    <StatCard icon={<Camera size={20} />} value={progressData.phase2?.shooting_attended} label="Shooting Attended" colorVariant="Amber" onClick={() => toggleStatFilter('phase2_shooting_attended')} isActive={selectedStatFilter === 'phase2_shooting_attended'} />
                    <StatCard icon={<Video size={20} />} value={progressData.phase2?.editing_attended} label="Editing Attended" colorVariant="Amber" onClick={() => toggleStatFilter('phase2_editing_attended')} isActive={selectedStatFilter === 'phase2_editing_attended'} />
                    <StatCard icon={<CheckSquare size={20} />} value={progressData.phase2?.completed} label="Phase 2 Completed" colorVariant="Green" onClick={() => toggleStatFilter('phase2_completed')} isActive={selectedStatFilter === 'phase2_completed'} />
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '1rem' }} className="batch-phase2-section">
                  <div className="batch-phase-label purple batch-attendance-heading"><span>Phase 2</span>{attendanceButton(2)}</div>
                  <div className="batch-info-card-dashed" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Phase 2 data will appear once students advance from Phase 1.
                  </div>
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="batch-phase-label">Course Progress</div>
              <div className="batch-metrics-grid">
                <StatCard icon={<Users size={20} />} value={progressData.single_phase?.admitted || progressData.total_students} label="Total Students" colorVariant="Blue" onClick={() => toggleStatFilter('all')} isActive={selectedStatFilter === 'all'} />
                {!isFilmAppreciation && (
                  <StatCard icon={<CheckCircle2 size={20} />} value={progressData.single_phase?.attendance} label="Attendance" colorVariant="Green" onClick={() => toggleStatFilter('attendance')} isActive={selectedStatFilter === 'attendance'} />
                )}
                {!isFilmAppreciation && (
                  <StatCard icon={<FileText size={20} />} value={progressData.single_phase?.assignment_submitted} label="Assignment Submitted" colorVariant="Amber" onClick={() => toggleStatFilter('assignment_submitted')} isActive={selectedStatFilter === 'assignment_submitted'} />
                )}
                <StatCard icon={<Award size={20} />} value={progressData.single_phase?.exam_passed} label="Exam Passed" colorVariant="Green" onClick={() => toggleStatFilter('exam_passed')} isActive={selectedStatFilter === 'exam_passed'} />
                {isFilmAppreciation && (
                  <StatCard icon={<XCircle size={20} />} value={progressData.single_phase?.exam_failed} label="Exam Failed" colorVariant="Red" onClick={() => toggleStatFilter('exam_failed')} isActive={selectedStatFilter === 'exam_failed'} />
                )}
                <StatCard icon={<CheckSquare size={20} />} value={progressData.single_phase?.completed} label="Completed" colorVariant="Green" onClick={() => toggleStatFilter('completed')} isActive={selectedStatFilter === 'completed'} />
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
              <div className="batch-info-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Two Sub-Cards side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  {/* Card 1: Fully Paid */}
                  <div 
                    onClick={() => toggleStatFilter(selectedStatFilter === 'fee_fully_paid' ? 'all' : 'fee_fully_paid')}
                    style={{
                      padding: '0.75rem',
                      background: selectedStatFilter === 'fee_fully_paid' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: selectedStatFilter === 'fee_fully_paid' ? '1.5px solid #10b981' : '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                    className="subtle-card"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#34d399', fontWeight: '600' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }}></span>
                      Fully Paid
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                      {paidCount} {paidCount === 1 ? 'Student' : 'Students'}
                    </div>
                  </div>

                  {/* Card 2: Partial Payment */}
                  <div 
                    onClick={() => toggleStatFilter(selectedStatFilter === 'fee_partial_paid' ? 'all' : 'fee_partial_paid')}
                    style={{
                      padding: '0.75rem',
                      background: selectedStatFilter === 'fee_partial_paid' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: selectedStatFilter === 'fee_partial_paid' ? '1.5px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                    className="subtle-card"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#fbbf24', fontWeight: '600' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }}></span>
                      Partial Paid
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                      {partialCount} {partialCount === 1 ? 'Student' : 'Students'}
                    </div>
                  </div>

                  {/* Card 3: Unpaid */}
                  <div 
                    onClick={() => toggleStatFilter(selectedStatFilter === 'fee_unpaid' ? 'all' : 'fee_unpaid')}
                    style={{
                      padding: '0.75rem',
                      background: selectedStatFilter === 'fee_unpaid' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: selectedStatFilter === 'fee_unpaid' ? '1.5px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                    className="subtle-card"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#f87171', fontWeight: '600' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }}></span>
                      Unpaid
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                      {dueCount} {dueCount === 1 ? 'Student' : 'Students'}
                    </div>
                  </div>
                </div>

                {/* Collected & Outstanding Totals below cards */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem', padding: '0 0.2rem' }}>
                  <div>Collected: <span style={{ color: '#34d399', fontWeight: '600' }}>৳{totalCollected.toLocaleString('en-BD')}</span></div>
                  <div>Outstanding: <span style={{ color: '#ef4444', fontWeight: '600' }}>৳{totalOutstanding.toLocaleString('en-BD')}</span></div>
                </div>

                <div className="fee-progress-bar" style={{ marginTop: '0.25rem' }}>
                  <div className="fee-progress-segment" style={{ width: `${feeSegments.paidPct}%`, background: '#34d399' }}></div>
                  <div className="fee-progress-segment" style={{ width: `${feeSegments.partialPct}%`, background: '#f59e0b' }}></div>
                  <div className="fee-progress-segment" style={{ width: `${feeSegments.duePct}%`, background: '#ef4444' }}></div>
                </div>
                
                <Link to={`/admin/fee-tracker?batch=${batchData.batch_number}`} style={{ color: 'var(--primary)', fontSize: '0.85rem', textDecoration: 'none', marginTop: 'auto', alignSelf: 'flex-start', paddingTop: '0.5rem' }}>
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
            {selectedStatFilter && (
              <button 
                onClick={() => { setSelectedStatFilter(null); setRecentlyToggledIds([]); }}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '12px',
                  padding: '2px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
              >
                Clear Filter <X size={12} />
              </button>
            )}
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
                  <th style={{ textAlign: 'center' }}>Fee Status</th>
                  <th>Joined</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s, index) => {
                  const enrollment = s.enrollments?.find(e => e.course_name === batchData.course_name);
                  let totalFee = 0;
                  let collected = 0;
                  if (enrollment) {
                    const fin = resolveEnrollmentFinancialsClient(enrollment, batchData);
                    totalFee = fin.netPayable;
                    collected = fin.cashCollected;
                  }
                  return (
                    <tr key={s.user_id} className="student-list-row">
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem', verticalAlign: 'middle' }}>{index + 1}</td>
                      <td style={{ verticalAlign: 'middle' }}>
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
                      <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', verticalAlign: 'middle' }}>{s.bfi_id || '—'}</td>
                      <td style={{ minWidth: '250px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {s.enrollments && s.enrollments.map(e => (
                          <div key={e.id} className="student-table-course-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.01)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                              {e.course_name}
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              {e.course_definition_id && e.defined_progress ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    {e.defined_progress.phases?.map((p, pIdx) => {
                                      const isPassed = p.status === 'passed';
                                      const isFailed = p.status === 'failed';
                                      const isInProgress = p.status === 'in_progress';
                                      const badgeBg = isPassed ? 'rgba(16, 185, 129, 0.15)' : isFailed ? 'rgba(239, 68, 68, 0.15)' : isInProgress ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)';
                                      const badgeColor = isPassed ? '#10b981' : isFailed ? '#ef4444' : isInProgress ? '#60a5fa' : 'var(--text-muted)';
                                      const badgeBorder = isPassed ? 'rgba(16, 185, 129, 0.3)' : isFailed ? 'rgba(239, 68, 68, 0.3)' : isInProgress ? 'rgba(59, 130, 246, 0.3)' : 'var(--glass-border)';
                                      return (
                                        <button
                                          key={p.phaseNumber || pIdx}
                                          type="button"
                                          onClick={() => openDefinedProgress(s, e, pIdx)}
                                          title={`Phase ${p.phaseNumber}: ${p.phaseName || ''} | Status: ${p.status} | Attendance: ${p.attendance?.percentage || 0}% | Click to record attendance, grades, or exam marks`}
                                          style={{
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '5px',
                                            fontSize: '0.72rem',
                                            fontWeight: '600',
                                            background: badgeBg,
                                            color: badgeColor,
                                            border: `1px solid ${badgeBorder}`,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.25rem',
                                            cursor: 'pointer',
                                            transition: 'background-color 0.2s, border-color 0.2s',
                                            minHeight: '28px'
                                          }}
                                        >
                                          P{p.phaseNumber} {isPassed ? '✓' : isFailed ? '✗' : isInProgress ? '⋯' : '–'}
                                        </button>
                                      );
                                    })}
                                    {e.defined_progress.certificateEligible && (
                                      <span
                                        title="Certificate Eligible"
                                        style={{
                                          padding: '0.15rem 0.45rem',
                                          borderRadius: '4px',
                                          fontSize: '0.72rem',
                                          fontWeight: '600',
                                          background: 'rgba(234, 179, 8, 0.15)',
                                          color: '#eab308',
                                          border: '1px solid rgba(234, 179, 8, 0.3)',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '0.2rem'
                                        }}
                                      >
                                        🏆 Cert
                                      </span>
                                    )}
                                    {e.defined_progress.failedAnyPhase && e.defined_progress.reEnrollmentDiscount && (
                                      <span
                                        title={`Re-enrollment discount available: ${e.defined_progress.reEnrollmentDiscount.percent}%`}
                                        style={{
                                          padding: '0.15rem 0.45rem',
                                          borderRadius: '4px',
                                          fontSize: '0.72rem',
                                          fontWeight: '600',
                                          background: 'rgba(168, 85, 247, 0.15)',
                                          color: '#c084fc',
                                          border: '1px solid rgba(168, 85, 247, 0.3)'
                                        }}
                                      >
                                        {e.defined_progress.reEnrollmentDiscount.percent}% Off
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                    {e.defined_progress.phaseCount} Phase{e.defined_progress.phaseCount > 1 ? 's' : ''} (v{e.defined_progress.courseVersion})
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {e.course_type === 'filmmaking' || e.course_name === 'Online Filmmaking Course' ? (
                                    <>
                                      <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Phase 1: Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                                        {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                      </button>
                                      {(() => {
                                        const isGraded = e.exam_written !== null && e.exam_written !== undefined && e.exam_written !== '';
                                        let eAssignmentsTotal = 0;
                                        if (currentCourseSetting?.has_assignment) {
                                          try {
                                            const pScores = JSON.parse(e.assignment_scores || '{}');
                                            const defs = JSON.parse(currentCourseSetting.assignments || '[]');
                                            defs.forEach(d => { eAssignmentsTotal += parseFloat(pScores[d.id]) || 0; });
                                          } catch(err) { /* ignore parse error */ }
                                        }
                                        const totalScore = (parseInt(e.exam_written) || 0) + eAssignmentsTotal;
                                        const attClasses = e.attendance_classes || 0;
                                        const attTotal = e.attendance_total || 22;
                                        const qualifiesAttendance = attTotal > 0 ? (attClasses / attTotal) >= 0.8 : false;
                                        const hasFailed = isGraded && e.step1_completed === 1 && e.step2_completed !== 1 && (!qualifiesAttendance || totalScore < 33);
                                        if (hasFailed) {
                                          return (
                                            <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title={`Phase 1: Failed (Score: ${totalScore})`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                                              <XCircle size={18} />
                                            </button>
                                          );
                                        }
                                        return (
                                          <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title="Phase 1: Passed Exam" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step2_completed ? '#10b981' : 'var(--text-muted)' }}>
                                            {e.step2_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                          </button>
                                        );
                                      })()}
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
                                      <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Admission Confirmed" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                                        {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                      </button>
                                      {(() => {
                                        const examScore = parseInt(e.exam_written) || 0;
                                        const hasExam = examScore > 0 || (e.exam_written !== null && e.exam_written !== undefined && e.exam_written !== '');
                                        const hasPassed = e.step2_completed === 1;
                                        const hasFailed = hasExam && examScore < 33 && !hasPassed;
                                        if (hasFailed) {
                                          return (
                                            <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title={`Course Failed (Score: ${examScore})`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                                              <XCircle size={18} />
                                            </button>
                                          );
                                        }
                                        return (
                                          <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title={hasPassed ? `Course Completed (Score: ${examScore})` : 'Course Not Completed'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: hasPassed ? '#10b981' : 'var(--text-muted)' }}>
                                            {hasPassed ? <CheckSquare size={18} /> : <Square size={18} />}
                                          </button>
                                        );
                                      })()}
                                    </>
                                  )}
                                  {((e.course_name === 'Online Filmmaking Course' && e.step4_completed === 1) || (e.course_name !== 'Online Filmmaking Course' && e.step2_completed === 1)) && hasPendingDueOrPartialPayment(e) && (
                                    <Lock 
                                      size={14} 
                                      style={{ color: '#f87171', display: 'inline-block', cursor: 'not-allowed', marginLeft: '0.2rem' }} 
                                      title={`Certificate Locked (Outstanding: ৳${(totalFee - collected).toLocaleString('en-BD')})`} 
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                        {s.fee_status ? (
                          <span className={`batch-status-badge ${s.fee_status.toLowerCase().replace(' ', '-')}`} style={{ fontSize: '0.7rem', display: 'inline-block', width: 'fit-content' }}>
                            {s.fee_status}
                          </span>
                        ) : (
                          <span className="batch-status-badge unpaid" style={{ fontSize: '0.7rem', display: 'inline-block', width: 'fit-content' }}>UNPAID</span>
                        )}
                        {enrollment && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
                            Paid: <span style={{ color: collected > 0 ? '#34d399' : 'var(--text-muted)', fontWeight: '600' }}>৳{collected.toLocaleString('en-BD')}</span> of <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>৳{totalFee.toLocaleString('en-BD')}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem', verticalAlign: 'middle' }}>
                      {s.created_at ? new Date(s.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', position: 'relative' }}>
                        {(() => {
                          const e = s.enrollments?.find(x => x.course_name === batchData.course_name);
                          if (!e) return null;
                          const isAppreciation = e.course_name !== 'Online Filmmaking Course';
                          return (
                            <button 
                              onClick={() => e.course_definition_id ? openDefinedProgress(s, e, 0) : openAcademicModal(s, e.id)}
                              className="btn" 
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', background: e.course_definition_id ? 'rgba(99, 102, 241, 0.12)' : 'rgba(16, 185, 129, 0.1)', color: e.course_definition_id ? '#818cf8' : '#10b981', border: e.course_definition_id ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'background-color 0.2s, border-color 0.2s', minWidth: '36px', minHeight: '36px' }} 
                              onMouseEnter={(e) => { e.currentTarget.style.background = e.course_definition_id ? 'rgba(99, 102, 241, 0.22)' : 'rgba(16, 185, 129, 0.2)'; }} 
                              onMouseLeave={(e) => { e.currentTarget.style.background = e.course_definition_id ? 'rgba(99, 102, 241, 0.12)' : 'rgba(16, 185, 129, 0.1)'; }} 
                              title={e.course_definition_id ? 'Manage Defined Course Progress (Attendance, Grades, Exams)' : (isAppreciation ? 'Exam Result' : 'Academic Records')}
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
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)';  }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';  }}
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
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';  }} 
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';  }} 
                          title="Edit Student"
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => confirmDeleteStudent(s.id, s.full_name, s.batch_number)}
                          className="btn" 
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';  }} 
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';  }} 
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
                );
              })}
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
      {attendancePhase !== null && (
        <BatchAttendanceSheet
          key={`${batchData.id}:${attendancePhase}`}
          batchId={batchData.id}
          phaseNumber={attendancePhase}
          onClose={() => setAttendancePhase(null)}
          onSaved={() => {
            fetchStudents(batchData.id);
            fetchProgress(batchData.id);
          }}
        />
      )}
      {/* Defined Course Progress Modal */}
      {definedProgressModal.isOpen && (
        <DefinedCourseProgressModal
          isOpen={definedProgressModal.isOpen}
          onClose={closeDefinedProgress}
          student={definedProgressModal.student}
          enrollment={definedProgressModal.enrollment}
          initialPhaseIndex={definedProgressModal.initialPhaseIndex}
          onUpdated={() => {
            if (batchData?.id) {
              fetchStudents(batchData.id);
              fetchProgress(batchData.id);
            }
          }}
        />
      )}

      {editingStudent && (
        <EditStudentModal 
          student={editingStudent} 
          batchId={batchData?.id}
          onClose={() => setEditingStudent(null)} 
          onSaveSuccess={() => fetchStudents(batchData.id)} 
        />
      )}

      {/* Academic Records Modal */}
      {academicStudent && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <form onSubmit={submitAcademic} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <style>{`
              .academic-modal-header-h3::before {
                display: none !important;
              }
            `}</style>
            <div className="modern-modal-header" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '1.25rem' }}>
              {/* Centered BFI Logo Box */}
              <div style={{
                width: '44px',
                height: '44px',
                backgroundImage: "url('/bfi-classroom/bfi-logo.jpg')",
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                border: '1.5px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                marginBottom: '0.75rem'
              }} />

              {/* Centered Content */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <h3 className="academic-modal-header-h3 font-display" style={{ 
                  margin: '0 0 20px 0', 
                  fontSize: '1.35rem', 
                  fontWeight: '700', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '0.5rem',
                  color: 'var(--text-primary)'
                }}>
                  <GraduationCap size={22} style={{ color: '#10b981' }} /> 
                  {academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? 'Exam Result' : 'Academic Records'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: '0 0 0.5rem 0', fontWeight: '500' }}>
                  {academicStudent.full_name} <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>({academicStudent.batch_number ? `${getOrdinalSuffix(academicStudent.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <div>
                  <span style={{ 
                    color: '#34d399', 
                    fontSize: '0.72rem', 
                    fontWeight: '600', 
                    background: 'rgba(16, 185, 129, 0.15)', 
                    border: '1px solid rgba(16, 185, 129, 0.3)', 
                    padding: '0.2rem 0.6rem', 
                    borderRadius: '6px', 
                    display: 'inline-block' 
                  }}>
                    {academicStudent.enrollment?.course_name || 'Course'}
                  </span>
                </div>
              </div>
              
              <button type="button" className="icon-btn-ghost" onClick={closeAcademicModal} aria-label="Close" style={{ position: 'absolute', right: 0, top: 0 }}><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: '60vh', overflowY: 'auto' }}>
              {academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? (
                /* Film Appreciation Course: single Exam Result out of 100, plus attendance */
                <>
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '1.25rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Attendance</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Classes Attended</label>
                        <input type="number" name="attendance_classes" value={academicFormData.attendance_classes} onChange={handleAcademicChange} min="0" className="input-glass" style={{ paddingLeft: '1rem' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Total Classes</label>
                        <input type="number" name="attendance_total" value={academicFormData.attendance_total} onChange={handleAcademicChange} min="0" className="input-glass" style={{ paddingLeft: '1rem', cursor: 'not-allowed', opacity: 0.6 }} disabled />
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Exam Result (Total: {currentCourseSetting?.exam_max_score || 100})</h3>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam Score (Max: {currentCourseSetting?.exam_max_score || 100})</label>
                      <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max={currentCourseSetting?.exam_max_score || 100} className="input-glass" style={{ paddingLeft: '1rem' }} required />
                    </div>
                  {(() => {
                    const totalGained = parseInt(academicFormData.exam_written) || 0;
                    const isPassed = totalGained >= (currentCourseSetting?.exam_pass_mark || 33);
                    return (
                      <div style={{ 
                        marginTop: '1.25rem', 
                        padding: '1rem', 
                        background: 'rgba(0, 0, 0, 0.2)', 
                        borderRadius: '8px', 
                        border: '1px solid var(--glass-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Passing Requirement:</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>{currentCourseSetting?.exam_pass_mark || 33}+ marks</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total Score Gained:</span>
                          <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            {totalGained} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ {currentCourseSetting?.exam_max_score || 100}</span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.75rem' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</span>
                          <span style={{ 
                            fontSize: '0.72rem', 
                            fontWeight: '600', 
                            padding: '0.15rem 0.5rem', 
                            borderRadius: '4px',
                            background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                            color: isPassed ? '#34d399' : '#f87171',
                            border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            {isPassed ? 'Passed' : 'Failed'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  </div>
                </>
              ) : (
                /* Online Filmmaking Course: attendance & full breakdown */
                <>
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>Attendance</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Total classes:</label>
                        <input type="number" name="attendance_total" value={academicFormData.attendance_total} onChange={handleAcademicChange} min="1" className="input-glass" style={{ width: '100px', paddingLeft: '0.5rem', fontSize: '0.9rem', cursor: 'not-allowed', opacity: 0.6 }} required disabled />
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
                        <div style={{ 
                          marginTop: '1.25rem', 
                          padding: '1rem', 
                          background: 'rgba(0, 0, 0, 0.2)', 
                          borderRadius: '8px', 
                          border: '1px solid var(--glass-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Passing Requirement:</span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>{currentCourseSetting.exam_pass_mark}+ total marks</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total Score Gained:</span>
                            <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                              {totalGained} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ 100</span>
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.75rem' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</span>
                            <span style={{ 
                              fontSize: '0.72rem', 
                              fontWeight: '600', 
                              padding: '0.15rem 0.5rem', 
                              borderRadius: '4px',
                              background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                              color: isPassed ? '#34d399' : '#f87171',
                              border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em'
                            }}>
                              {isPassed ? 'Passed' : 'Failed'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}

              <div className="error-alert" style={{ 
                marginTop: '0.75rem', 
                color: '#f87171', 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid rgba(239, 68, 68, 0.2)',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                opacity: (academicError || getAcademicValidationError()) ? 1 : 0,
                visibility: (academicError || getAcademicValidationError()) ? 'visible' : 'hidden',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                transition: 'opacity 0.2s'
              }}>
                {(academicError || getAcademicValidationError()) ? `⚠️ ${academicError || getAcademicValidationError()}` : ''}
              </div>
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={closeAcademicModal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button 
                type="submit" 
                className="modern-btn modern-btn--primary" 
                disabled={isAcademicSaving || !!getAcademicValidationError()} 
                style={{ 
                  flex: 1, 
                  background: '#10b981', 
                  borderColor: '#10b981',
                  opacity: (isAcademicSaving || !!getAcademicValidationError()) ? 0.5 : 1,
                  cursor: (isAcademicSaving || !!getAcademicValidationError()) ? 'not-allowed' : 'pointer'
                }}
              >
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
      <UploadResultsModal 
        isOpen={showUploadResultsModal}
        onClose={() => setShowUploadResultsModal(false)}
        batchId={batchData.id}
        onUploadSuccess={(data) => {
          showToast(`Successfully updated results for ${data.updated} students`);
          fetchStudents(batchData.id);
          fetchProgress(batchData.id);
        }}
      />

      {/* Batch Routine Adjustment Modal */}
      {editingRoutinePhase && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}
          onClick={handleCloseRoutineModal}
        >
          <div
            style={{
              background: 'var(--glass-bg, #0f172a)',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '620px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calendar size={18} className="text-accent" />
                  Adjust Batch Routine — {editingRoutinePhase.title || editingRoutinePhase.name || 'Phase'}
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Batch: {batchData?.batch_name} • Specific schedule overrides for this batch
                </p>
              </div>
              <button
                type="button"
                className="icon-btn-ghost"
                onClick={handleCloseRoutineModal}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveBatchRoutine} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.8rem', color: '#93c5fd', lineHeight: 1.4 }}>
                  💡 <strong>Per-Batch Flexibility:</strong> Assign exact calendar dates for upcoming classes (e.g. holidays, special shooting days) or leave the date blank for recurring weekdays. Selecting a date auto-fills the weekday, but you can manually adjust any field as needed.
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Batch Routine Slots</span>
                    <button
                      type="button"
                      onClick={handleAddRoutineSlot}
                      style={{
                        padding: '0.35rem 0.65rem',
                        fontSize: '0.78rem',
                        borderRadius: '6px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem'
                      }}
                    >
                      + Add Slot
                    </button>
                  </div>

                  <datalist id="batch-subject-suggestions">
                    {catalogSubjects.map(s => <option key={s.id || s.name} value={s.name} />)}
                  </datalist>
                  <datalist id="batch-teacher-suggestions">
                    {catalogTeachers.map(t => <option key={t.id} value={t.full_name || `${t.first_name} ${t.last_name}`} />)}
                  </datalist>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {batchRoutineSlots.length === 0 ? (
                      <div style={{ padding: '1rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        <p style={{ margin: 0 }}>No routine slots scheduled for this batch.</p>
                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                          💡 Saving an empty list sets an empty schedule for this batch. To restore the course default schedule, click &ldquo;Revert to Course Default&rdquo;.
                        </p>
                      </div>
                    ) : (
                      batchRoutineSlots.map((slot, sIdx) => {
                        const phaseClasses = editingRoutinePhase?.classes || [];
                        return (
                          <div
                            key={sIdx}
                            ref={sIdx === batchRoutineSlots.length - 1 ? lastSlotRef : null}
                            style={{
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: '8px',
                              padding: '0.75rem',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.5rem'
                            }}
                          >
                            {/* Slot Header & Quick-Fill */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                Slot #{sIdx + 1}
                              </span>
                              {phaseClasses.length > 0 && (
                                <select
                                  onChange={(e) => {
                                    handleCopyFromPhaseClass(sIdx, e.target.value);
                                    e.target.value = '';
                                  }}
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.72rem',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    minHeight: '28px',
                                    maxWidth: '210px'
                                  }}
                                  title="Autofill from a phase class"
                                >
                                  <option value="">⚡ Autofill from Class...</option>
                                  {phaseClasses.map((c, i) => (
                                    <option key={c.id || i} value={c.id} style={{ background: '#1e293b' }}>
                                      {c.title || `Class ${i + 1}`} ({c.subjectName || 'No Subject'})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>

                            {/* Row 1: Date, Day, Time, Delete */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <div style={{ flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Class Date (Optional)</label>
                                <input
                                  type="date"
                                  value={slot.date || ''}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'date', e.target.value)}
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.4rem 0.5rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.85rem',
                                    minHeight: '44px'
                                  }}
                                  aria-label="Class Date"
                                />
                              </div>
                              <div style={{ flex: '1 1 130px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Day of Week</label>
                                <select
                                  value={slot.weekday}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'weekday', e.target.value)}
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.4rem 0.5rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.85rem',
                                    minHeight: '44px'
                                  }}
                                >
                                  {WEEKDAYS.map(w => <option key={w} value={w} style={{ background: '#1e293b' }}>{w}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flex: '1 1 160px' }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Start Time</label>
                                  <input
                                    type="time"
                                    value={slot.startTime}
                                    onChange={(e) => handleUpdateRoutineSlot(sIdx, 'startTime', e.target.value)}
                                    style={{
                                      background: 'rgba(255,255,255,0.05)',
                                      border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: '6px',
                                      padding: '0.4rem 0.5rem',
                                      color: 'var(--text-primary)',
                                      fontSize: '0.85rem',
                                      minHeight: '44px',
                                      width: '100%'
                                    }}
                                  />
                                </div>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1.2rem' }}>to</span>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>End Time</label>
                                  <input
                                    type="time"
                                    value={slot.endTime}
                                    onChange={(e) => handleUpdateRoutineSlot(sIdx, 'endTime', e.target.value)}
                                    style={{
                                      background: 'rgba(255,255,255,0.05)',
                                      border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: '6px',
                                      padding: '0.4rem 0.5rem',
                                      color: 'var(--text-primary)',
                                      fontSize: '0.85rem',
                                      minHeight: '44px',
                                      width: '100%'
                                    }}
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveRoutineSlot(sIdx)}
                                style={{
                                  alignSelf: 'flex-end',
                                  minHeight: '44px',
                                  width: '44px',
                                  background: 'rgba(239,68,68,0.1)',
                                  border: '1px solid rgba(239,68,68,0.25)',
                                  borderRadius: '6px',
                                  color: '#ef4444',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer'
                                }}
                                title="Delete Slot"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>

                            {/* Row 2: Subject & Class Title */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '0.4rem', width: '100%' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Subject (Live Catalog)</label>
                                <input
                                  type="text"
                                  list="batch-subject-suggestions"
                                  value={slot.subjectName || ''}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'subjectName', e.target.value)}
                                  placeholder="Select or enter subject"
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.55rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.82rem',
                                    minHeight: '38px',
                                    width: '100%'
                                  }}
                                  title="Subject from Custom Subjects or custom name"
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Class / Topic Title</label>
                                <input
                                  type="text"
                                  value={slot.classTitle || ''}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'classTitle', e.target.value)}
                                  placeholder="Class Title or Topic"
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.55rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.82rem',
                                    minHeight: '38px',
                                    width: '100%'
                                  }}
                                  title="Class or Topic Title"
                                />
                              </div>
                            </div>

                            {/* Row 3: Teacher Account, Teacher Label, Mode & Category */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '0.4rem', width: '100%' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Instructor Account</label>
                                <select
                                  aria-label="Instructor Account"
                                  value={slot.teacherUserId ? String(slot.teacherUserId) : ''}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'teacherUserId', e.target.value)}
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.4rem',
                                    color: slot.teacherUserId ? '#38bdf8' : 'var(--text-primary)',
                                    fontSize: '0.78rem',
                                    minHeight: '38px',
                                    width: '100%'
                                  }}
                                  title="Assign Instructor Account"
                                >
                                  <option value="" style={{ background: '#1e293b' }}>-- Unassigned / Free Text --</option>
                                  {catalogTeachers.filter(t => t.is_active !== 0 && !t.deleted_at).map(t => (
                                    <option key={t.id} value={t.id} style={{ background: '#1e293b' }}>
                                      {t.full_name || `${t.first_name} ${t.last_name}`} (ID: {t.id}{t.username ? `, @${t.username}` : ''})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  Teacher Label {slot.teacherUserId ? <span style={{ color: '#38bdf8' }}>(ID #{slot.teacherUserId})</span> : <span style={{ color: 'var(--text-muted)' }}>(Unassigned)</span>}
                                </label>
                                <input
                                  type="text"
                                  value={slot.teacherName || ''}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'teacherName', e.target.value)}
                                  placeholder="Select or enter teacher"
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.55rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.82rem',
                                    minHeight: '38px',
                                    width: '100%'
                                  }}
                                  title="Assigned Teacher"
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Mode</label>
                                <select
                                  value={normalizeDeliveryMode(slot.deliveryMode)}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'deliveryMode', e.target.value)}
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.4rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.78rem',
                                    minHeight: '38px',
                                    width: '100%'
                                  }}
                                  title="Delivery Mode"
                                >
                                  {DELIVERY_MODES.map(m => <option key={m.value} value={m.value} style={{ background: '#1e293b' }}>{m.label}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Category</label>
                                <select
                                  value={slot.category || 'theory'}
                                  onChange={(e) => handleUpdateRoutineSlot(sIdx, 'category', e.target.value)}
                                  style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.4rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.78rem',
                                    minHeight: '38px',
                                    width: '100%'
                                  }}
                                  title="Class Category"
                                >
                                  {CLASS_CATEGORIES.map(cat => <option key={cat.value} value={cat.value} style={{ background: '#1e293b' }}>{cat.label}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Medium / App</label>
                                <PlatformSelector
                                  value={slot.platform || ''}
                                  onChange={(val) => handleUpdateRoutineSlot(sIdx, 'platform', val)}
                                  selectStyle={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
                                  inputStyle={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* BOTTOM ADD SLOT BUTTON */}
                  {batchRoutineSlots.length > 0 && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <button
                        type="button"
                        onClick={handleAddRoutineSlot}
                        style={{
                          width: '100%',
                          padding: '0.6rem 1rem',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          borderRadius: '6px',
                          background: 'rgba(59,130,246,0.08)',
                          border: '1px dashed rgba(59,130,246,0.35)',
                          color: '#93c5fd',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(59,130,246,0.16)';
                          e.currentTarget.style.borderColor = 'rgba(59,130,246,0.6)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(59,130,246,0.08)';
                          e.currentTarget.style.borderColor = 'rgba(59,130,246,0.35)';
                        }}
                      >
                        <Plus size={16} /> + Add Slot
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                    <span>Reason for Batch Routine Adjustment</span>
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>* (Required / আবশ্যক)</span>
                  </label>
                  <input
                    ref={routineAuditInputRef}
                    type="text"
                    value={routineAuditReason}
                    onChange={(e) => {
                      setRoutineAuditReason(e.target.value);
                      if (e.target.value.trim()) {
                        setRoutineAuditTouched(false);
                        if (routineError && routineError.includes('Reason')) setRoutineError('');
                      }
                    }}
                    placeholder="e.g. Adjusted shooting schedule, rescheduled Friday class for holiday..."
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: routineAuditTouched && !routineAuditReason.trim() ? '1.5px solid #ef4444' : '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      padding: '0.55rem 0.75rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      minHeight: '44px',
                      outline: 'none',
                      boxShadow: routineAuditTouched && !routineAuditReason.trim() ? '0 0 0 2px rgba(239,68,68,0.2)' : 'none',
                      transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
                    }}
                  />
                  {routineAuditTouched && !routineAuditReason.trim() && (
                    <div style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span>⚠️ এই তথ্যটি পূরণ করা আবশ্যক — শিডিউল সেভ করার জন্য পরিবর্তনের কারণটি উল্লেখ করুন।</span>
                    </div>
                  )}
                </div>

              </div>

              {routineError && (
                <div style={{
                  margin: '0 1.5rem 0.75rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  background: 'rgba(239,68,68,0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.3)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <XCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{routineError}</span>
                </div>
              )}

              <div
                style={{
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  background: 'rgba(0,0,0,0.1)',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {editingRoutinePhase?.routineSource === 'batch_override' && (
                    <button
                      type="button"
                      onClick={handleRevertBatchRoutine}
                      disabled={routineSaving}
                      style={{
                        padding: '0.45rem 0.8rem',
                        borderRadius: '6px',
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        color: '#fbbf24',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        cursor: routineSaving ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}
                      title="Revert custom batch schedule back to the original course template"
                    >
                      <RefreshCw size={13} /> Revert to Course Default
                    </button>
                  )}
                  {(!routineAuditReason.trim() || routineAuditReason.trim().length < 3) && (
                    <span style={{ fontSize: '0.78rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      💡 সেভ করতে কারণটি (কমপক্ষে ৩ অক্ষর) লিখুন
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={handleCloseRoutineModal}
                  disabled={routineSaving}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    minHeight: '40px'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={routineSaving}
                  style={{
                    padding: '0.5rem 1.25rem',
                    borderRadius: '6px',
                    background: routineSaving ? 'rgba(59,130,246,0.3)' : '#2563eb',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: routineSaving ? 'not-allowed' : 'pointer',
                    minHeight: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  {routineSaving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Saving Routine...
                    </>
                  ) : (
                    'Save Batch Schedule'
                  )}
                </button>
              </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
