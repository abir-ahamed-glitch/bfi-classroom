import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { UserPlus, Search, Copy, CheckCircle2, User, UserCheck, CheckSquare, Square, Edit, X, FileSpreadsheet, Trash2, GraduationCap, Clapperboard, Lock, Download } from 'lucide-react';
import BulkStudentImport from '../../components/admin/BulkStudentImport';
import { getOrdinalSuffix } from '../../utils/formatUtils';
import EditStudentModal from '../../components/admin/EditStudentModal';
import './StudentManager.css';

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

export default function StudentManager() {
  const location = useLocation();
  const [students, setStudents] = useState([]);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('search') || '';
  });

  // Edit Modal State
  const [editingStudent, setEditingStudent] = useState(null);

  // Academic Records Modal State
  const [academicStudent, setAcademicStudent] = useState(null);
  const [academicCourseId, setAcademicCourseId] = useState(null);
  const [academicFormData, setAcademicFormData] = useState({
    attendance_classes: '',
    attendance_total: '',
    exam_written: '',
    assignment_screenplay: '',
    assignment_shooting_script: ''
  });
  const [isAcademicSaving, setIsAcademicSaving] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // Phase 2 Completion Modal State
  const [phase2Student, setPhase2Student] = useState(null);
  const [phase2CourseId, setPhase2CourseId] = useState(null);
  const [phase2FormData, setPhase2FormData] = useState({
    phase2_shooting_attended: false,
    phase2_editing_attended: false
  });
  const [isPhase2Saving, setIsPhase2Saving] = useState(false);
  const [phase2Error, setPhase2Error] = useState('');

  // Confirmation Modal State
  const [confirmConfig, setConfirmConfig] = useState(null);

  // Export Modal State
  const [showExportModal, setShowExportModal]   = useState(false);
  const [exportScope, setExportScope]           = useState('all');
  const [exportFormat, setExportFormat]         = useState(null); // 'excel' | 'word' | 'pdf'
  const [exportLoading, setExportLoading]       = useState(false);
  const [exportError, setExportError]           = useState('');
  const [exportToast, setExportToast]           = useState('');

  // Row Selection State (for "selected students" export scope)
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobileNumber: '',
    batchNumber: '',
    snNo: '',
    year: new Date().getFullYear().toString(),
    manualUsername: '',
    manualPassword: '',
    courses: ['Online Filmmaking Course'] // Default
  });

  const availableCourses = [
    { name: 'Online Filmmaking Course', type: 'filmmaking' },
    { name: 'Film Appreciation Course', type: 'workshop' },
    { name: 'Script Writing', type: 'workshop' },
    { name: 'Cinematography', type: 'workshop' },
    { name: 'Acting', type: 'workshop' }
  ];

  const fetchStudents = async () => {
    if (window.location.hostname.includes('github.io')) {
      setStudents([
        { 
          id: 1, 
          student_id: 'BFI01-2024', 
          full_name: 'John Doe', 
          first_name: 'John',
          last_name: 'Doe',
          username: 'johndoe', 
          email: 'john@example.com', 
          batch_number: '75',
          created_at: new Date().toISOString(),
          enrollments: [
            { id: 1, course_name: 'Online Filmmaking Course', course_type: 'filmmaking', step1_completed: 1, step2_completed: 1, step3_completed: 1, step4_completed: 0 }
          ]
        },
        { 
          id: 2, 
          student_id: 'BFI02-2024', 
          full_name: 'Jane Smith', 
          first_name: 'Jane',
          last_name: 'Smith',
          username: 'janesmith', 
          email: 'jane@example.com', 
          batch_number: '75',
          created_at: new Date().toISOString(),
          enrollments: [
            { id: 2, course_name: 'Film Appreciation Course', course_type: 'workshop', step1_completed: 1, step4_completed: 1 }
          ]
        }
      ]);
      return;
    }

    try {
      const res = await fetch(`/api/admin/students?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students);
      }
    } catch (err) {
      console.error('Failed to fetch students', err);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // Auto-open Edit Modal if navigated here from Fee Tracker or via query param / location state
  useEffect(() => {
    if (students.length > 0 && !hasAutoOpened) {
      const params = new URLSearchParams(window.location.search);
      const editStudentId = location.state?.editStudentId || parseInt(params.get('edit') || '', 10);
      const searchId = params.get('student_id');
      const academicStudentId = parseInt(params.get('academic') || '', 10);
      const phase2StudentId = parseInt(params.get('phase2') || '', 10);
      const deleteStudentId = parseInt(params.get('delete') || '', 10);
      const enrollmentId = parseInt(params.get('enrollmentId') || '', 10);
      
      if (editStudentId) {
        const studentToEdit = students.find(s => s.id === editStudentId);
        if (studentToEdit) {
          setHasAutoOpened(true);
          openEditModal(studentToEdit);
        }
      } else if (searchId) {
        const studentToEdit = students.find(s => s.student_id === searchId);
        if (studentToEdit) {
          setHasAutoOpened(true);
          openEditModal(studentToEdit);
        }
      } else if (academicStudentId && enrollmentId) {
        const student = students.find(s => s.id === academicStudentId);
        if (student) {
          setHasAutoOpened(true);
          openAcademicModal(student, enrollmentId);
        }
      } else if (phase2StudentId && enrollmentId) {
        const student = students.find(s => s.id === phase2StudentId);
        if (student) {
          setHasAutoOpened(true);
          openPhase2Modal(student, enrollmentId);
        }
      } else if (deleteStudentId) {
        const student = students.find(s => s.id === deleteStudentId);
        if (student) {
          setHasAutoOpened(true);
          confirmDeleteStudent(student.id, student.full_name, student.batch_number);
        }
      }
    }
  }, [students, location.state, hasAutoOpened]);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (editingStudent || confirmConfig || academicStudent || phase2Student) {
      document.body.classList.add('modal-open');
      document.documentElement.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
      document.documentElement.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
      document.documentElement.classList.remove('modal-open');
    };
  }, [editingStudent, confirmConfig, academicStudent, phase2Student]);

  const toggleProgress = async (studentId, enrollmentId, stepField, currentValue, courseName) => {
    if (courseName === 'Online Filmmaking Course') {
      const student = students.find(s => s.id === studentId);
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

      // step4 for Online Filmmaking Course always opens the Phase 2 modal
      if (stepField === 'step4_completed') {
        if (!e?.step1_completed || !e?.step2_completed || !e?.step3_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Phase 2: Completed Course". All previous phases must be completed first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        openPhase2Modal(student, enrollmentId);
        return;
      }

      if (willBeChecked) {
        // Checking step1 (Phase 1: Admitted) opens Edit Student to enter payment details first
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
        // Open Edit Student modal so admin can fill Phase 2 payment details
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
      const student = students.find(s => s.id === studentId);
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
        // Checking step1 (Admission Confirmed) opens Edit Student to enter payment/fee details first
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
        fetchStudents();
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Update Failed', message: data.error || 'Failed to update progress.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Progress update error', err);
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
      confirmText: 'Delete',
      type: 'danger',
      onConfirm: () => performDelete(studentId)
    });
  };

  const performDelete = async (studentId) => {
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (res.ok) {
        fetchStudents();
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Deletion Failed', message: data.error || 'Failed to delete student.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Delete student error', err);
      setConfirmConfig({ title: 'Error', message: 'An error occurred while deleting the student.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleCreateStudent = async (e) => {
    e.preventDefault();
    setIsDeploying(true);
    setErrorMsg('');
    setSuccessData(null);
    setCopied(false);

    try {
      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create student account');
      }

      setSuccessData(data.student);
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        mobileNumber: '',
        batchNumber: '',
        snNo: '',
        year: new Date().getFullYear().toString(),
        manualUsername: '',
        manualPassword: '',
        courses: ['Online Filmmaking Course']
      });
      fetchStudents();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsDeploying(false);
    }
  };

  const copyCredentials = () => {
    if (!successData) return;
    const text = `BFI Classroom Credentials\nName: ${successData.firstName} ${successData.lastName}\nStudent ID: ${successData.studentId}\nUsername: ${successData.username}\nPassword: ${successData.rawPassword}\nLink: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
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
        fetchStudents();
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

  const openPhase2Modal = (student, enrollmentId) => {
    const enrollment = student.enrollments?.find(e => e.id === enrollmentId);
    setPhase2Student({ ...student, enrollment });
    setPhase2CourseId(enrollmentId);
    
    setPhase2FormData({
      phase2_shooting_attended: !!(enrollment?.phase2_shooting_attended),
      phase2_editing_attended: !!(enrollment?.phase2_editing_attended)
    });
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
        fetchStudents();
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

  const filteredStudents = students.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.full_name && s.full_name.toLowerCase().includes(q)) ||
      (s.student_id && s.student_id.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q)) ||
      (s.mobile_number && s.mobile_number.includes(q)) ||
      (s.whatsapp_number && s.whatsapp_number.includes(q)) ||
      (s.batch_number && s.batch_number.toLowerCase().includes(q))
    );
  });

  // ── Row selection helpers ────────────────────────────────────────────────
  const toggleStudentSelection = (id) => {
    setSelectedStudentIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const allVisibleSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every(s => selectedStudentIds.includes(s.id));
  const someSelected =
    filteredStudents.some(s => selectedStudentIds.includes(s.id)) && !allVisibleSelected;

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const ids = filteredStudents.map(s => s.id);
      setSelectedStudentIds(prev => [...new Set([...prev, ...ids])]);
    } else {
      const visibleIds = new Set(filteredStudents.map(s => s.id));
      setSelectedStudentIds(prev => prev.filter(id => !visibleIds.has(id)));
    }
  };

  // ── Export download handler ───────────────────────────────────────────────
  const handleExport = async () => {
    if (!exportFormat) return;
    setExportLoading(true);
    setExportError('');

    const params = new URLSearchParams();
    params.set('scope', exportScope);

    if (exportScope === 'filtered') {
      if (searchQuery) params.set('search', searchQuery);
    }

    if (exportScope === 'selected') {
      if (selectedStudentIds.length === 0) {
        setExportError('No students selected. Please select students from the table first.');
        setExportLoading(false);
        return;
      }
      params.set('ids', selectedStudentIds.join(','));
    }

    try {
      const response = await fetch(
        `/api/student-export/${exportFormat}?${params.toString()}`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } }
      );

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const ext  = { excel: 'xlsx', word: 'docx', pdf: 'pdf' }[exportFormat];
      a.href     = url;
      a.download = `BFI_Students_${new Date().toISOString().split('T')[0]}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowExportModal(false);
      setExportFormat(null);
      setExportError('');
      setExportToast(`Student list exported as ${ext.toUpperCase()} successfully ✓`);
      setTimeout(() => setExportToast(''), 4000);
    } catch (err) {
      setExportError('Export failed. Please try again.');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Student Accounts</h1>
        <p className="subtitle">Create and manage access for newly enrolled filmmakers.</p>
      </div>

      <div style={{ display: 'block' }}>
        {/* Bulk Import Panel */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileSpreadsheet className="text-accent" /> Bulk Import Students
            </h2>
            <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Upload an Excel or CSV file to quickly create multiple student accounts at once.</p>
          </div>
          <BulkStudentImport onImportComplete={fetchStudents} />
        </div>

        {/* Creator Panel */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus className="text-accent" /> Register New Student (Manual)
            </h2>
          </div>
          
          <form onSubmit={handleCreateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                <input type="text" name="firstName" value={formData.firstName} onChange={handleChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                <input type="text" name="lastName" value={formData.lastName} onChange={handleChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                <input type="text" name="mobileNumber" value={formData.mobileNumber} onChange={handleChange} className="input-glass" placeholder="+880..." style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Batch</label>
                <input type="text" name="batchNumber" value={formData.batchNumber} onChange={handleChange} className="input-glass" required placeholder="e.g. 75" style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>SN No.</label>
                <input type="text" name="snNo" value={formData.snNo} onChange={handleChange} className="input-glass" required placeholder="e.g. 01" style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Year</label>
                <input type="text" name="year" value={formData.year} onChange={handleChange} className="input-glass" required placeholder="e.g. 2024" style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Select Enrolled Courses</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                {availableCourses.map(course => (
                  <label key={course.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: formData.courses.includes(course.name) ? 'rgba(56, 189, 248, 0.1)' : 'transparent', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid', borderColor: formData.courses.includes(course.name) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', transition: 'all 0.2s' }}>
                    <input 
                      type="checkbox" 
                      checked={formData.courses.includes(course.name)} 
                      onChange={() => handleCourseChange(course.name)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span style={{ fontSize: '0.9rem' }}>{course.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Optional: Manual Credentials</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>If left blank, secure credentials will be generated automatically.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <input type="text" name="manualUsername" value={formData.manualUsername} onChange={handleChange} className="input-glass" placeholder="Custom Username" style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
                <div>
                  <input type="text" name="manualPassword" value={formData.manualPassword} onChange={handleChange} className="input-glass" placeholder="Custom Password" style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
              </div>
            </div>

            {errorMsg && <div className="error-alert">{errorMsg}</div>}

            <button type="submit" className="btn btn-primary" disabled={isDeploying}>
              {isDeploying ? 'Creating Account...' : 'Create Student Account'}
            </button>
          </form>

          {/* Success Summary */}
          {successData && (
            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(16, 185, 129, 0.12)', border: '2px solid rgba(16, 185, 129, 0.5)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle2 size={20} /> Success! Credentials Ready</h3>
                <button onClick={copyCredentials} className="btn" style={{ padding: '0.5rem 1rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px' }}>
                  {copied ? 'Copied!' : <><Copy size={16} /> Copy Details</>}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.95rem' }}>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Name:</strong> {successData.firstName} {successData.lastName}</p>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>ID:</strong> {successData.studentId}</p>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Username:</strong>{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#2563eb', background: 'rgba(37,99,235,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{successData.username}</span>
                </p>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Password:</strong>{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#be185d', background: 'rgba(190,24,93,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{successData.rawPassword}</span>
                </p>
              </div>
              <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>* Note: Password is only displayed here once. Please copy and share it securely using the copy button above.</p>
            </div>
          )}
        </div>

        {/* Students List */}
        <div style={{ marginTop: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <UserCheck className="text-secondary" /> Admitted Students
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--accent-secondary)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  fontSize: '0.8rem',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '50px',
                  fontWeight: '600',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}>
                  Total Admitted: <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>{students.length}</span>
                </span>
                <span style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: 'var(--success)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  fontSize: '0.8rem',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '50px',
                  fontWeight: '600',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}>
                  Step 1 Completed: <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>{students.filter(s => s.enrollments && s.enrollments.some(e => e.step1_completed === 1)).length}</span>
                </span>
                <span style={{
                  background: 'rgba(201, 168, 76, 0.12)',
                  color: 'var(--accent-primary)',
                  border: '1px solid rgba(201, 168, 76, 0.25)',
                  fontSize: '0.8rem',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '50px',
                  fontWeight: '600',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}>
                  Step 4 Completed: <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>{students.filter(s => s.enrollments && s.enrollments.some(e => e.step4_completed === 1)).length}</span>
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="input-wrapper" style={{ width: '100%', maxWidth: '300px' }}>
                <Search className="input-icon" size={18} />
                <input 
                  type="text" 
                  placeholder="Search by name, ID, batch, email..." 
                  className="input-glass" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                className="btn-export"
                onClick={() => { setExportScope('all'); setExportFormat(null); setExportError(''); setShowExportModal(true); }}
                title="Export student list"
              >
                <Download size={15} />
                Export
              </button>
            </div>
          </div>
          {/* Selection bar */}
          {selectedStudentIds.length > 0 && (
            <div className="student-selection-bar">
              <span className="selection-bar-count">✓ {selectedStudentIds.length} student{selectedStudentIds.length !== 1 ? 's' : ''} selected</span>
              <span
                className="selection-bar-clear"
                onClick={() => setSelectedStudentIds([])}
              >
                Clear selection
              </span>
              <button
                className="selection-bar-export"
                onClick={() => {
                  setExportScope('selected');
                  setExportFormat(null);
                  setExportError('');
                  setShowExportModal(true);
                }}
              >
                Export selected →
              </button>
            </div>
          )}

          <div className="glass-panel student-manager-table-scroll" style={{ width: '100%', maxWidth: '100%', minWidth: 0, maxHeight: '650px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', padding: '0', border: '1px solid var(--glass-border)', borderRadius: '12px', scrollbarGutter: 'stable both-edges' }}>
            <table className="student-manager-table" style={{ borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.02)', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th className="student-checkbox-col" style={{ padding: '1.25rem 0.75rem 1.25rem 1.25rem', borderBottom: '1px solid var(--glass-border)' }}>
                    <input
                      type="checkbox"
                      className="student-row-check"
                      checked={allVisibleSelected}
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      onChange={handleSelectAll}
                      title="Select all visible"
                    />
                  </th>
                  <th className="student-table-col-id" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Student ID</th>
                  <th className="student-table-col-name" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Name</th>
                  <th className="student-table-col-contact" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Username & Contact</th>
                  <th className="student-table-col-batch" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Batch</th>
                  <th className="student-table-col-progress" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Course Progression</th>
                  <th className="student-table-col-joined" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Joined</th>
                  <th className="student-table-col-actions" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s, idx) => (
                  <tr 
                    key={s.id} 
                    className="animate-slide-up"
                    style={{ 
                      borderBottom: '1px solid var(--glass-border)', 
                      transition: 'background 0.2s',
                      animationDelay: `${idx * 0.05}s`
                    }} 
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(14, 165, 233, 0.03)'} 
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td className="student-checkbox-col" style={{ padding: '1.25rem 0.75rem 1.25rem 1.25rem', verticalAlign: 'middle' }}>
                      <input
                        type="checkbox"
                        className="student-row-check"
                        checked={selectedStudentIds.includes(s.id)}
                        onChange={() => toggleStudentSelection(s.id)}
                      />
                    </td>
                    <td className="student-table-col-id" style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)', fontWeight: '500', fontSize: '0.85rem' }}>
                      {s.student_id}
                    </td>
                    <td className="student-table-col-name" style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1rem', flexShrink: 0 }}>
                          {s.full_name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{s.full_name}</span>
                      </div>
                    </td>
                    <td className="student-table-col-contact" style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <span style={{ display: 'inline-block', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--accent-primary)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', width: 'fit-content' }}>
                          @{s.username}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.email}</span>
                      </div>
                    </td>
                    <td className="student-table-col-batch" style={{ padding: '1.25rem 1.5rem' }}>
                      {s.batch_number ? (
                        <span className="badge-pill student-table-batch-pill" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.2)' }}>
                          {getOrdinalSuffix(s.batch_number)} Batch
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>N/A</span>
                      )}
                    </td>
                     <td className="student-table-col-progress" style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {s.enrollments && s.enrollments.map(e => (
                          <div key={e.id} className="student-table-course-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.01)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                              {e.course_name}
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              {e.course_type === 'filmmaking' ? (
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
                    <td className="student-table-col-joined" style={{ padding: '1.25rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {new Date(s.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="student-table-col-actions" style={{ padding: '1.25rem 1.5rem', textAlign: 'center' }}>
                      <div className="student-table-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        {s.enrollments && s.enrollments.length > 0 && (() => {
                          const e = s.enrollments[0];
                          const isAppreciation = e.course_name !== 'Online Filmmaking Course';
                          return (
                            <button 
                              onClick={() => openAcademicModal(s, e.id)}
                              className="btn" 
                              style={{ padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                              title={isAppreciation ? 'Exam Result' : 'Academic Records'}
                            >
                              <GraduationCap size={16} />
                            </button>
                          );
                        })()}
                        {s.enrollments && s.enrollments.find(e => e.course_name === 'Online Filmmaking Course') && (
                          <button
                            onClick={() => openPhase2Modal(s, s.enrollments.find(e => e.course_name === 'Online Filmmaking Course').id)}
                            className="btn"
                            style={{ padding: '0.5rem', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}
                            title="Phase 2: Shooting & Editing Attendance"
                          >
                            <Clapperboard size={16} />
                          </button>
                        )}


                        <button onClick={() => openEditModal(s)} className="btn" style={{ padding: '0.5rem', background: 'rgba(56, 189, 248, 0.1)', color: '#0284c7', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} title="Edit Student">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => confirmDeleteStudent(s.id, s.full_name, s.batch_number)} className="btn" style={{ padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} title="Delete Student">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan="8" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '48px', height: '48px', background: 'var(--glass-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <UserCheck size={24} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <span>No students admitted yet.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal Overlay */}
      {editingStudent && (
        <EditStudentModal 
          student={editingStudent} 
          onClose={() => setEditingStudent(null)} 
          onSaveSuccess={fetchStudents} 
        />
      )}

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

      {/* ── Export Modal ────────────────────────────────────────────────────── */}
      {showExportModal && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay" onClick={() => { setShowExportModal(false); setExportFormat(null); setExportError(''); }}>
          <div
            className="modern-modal-content glass-panel shadow-2xl"
            style={{ width: '100%', maxWidth: '520px', margin: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="modern-modal-header">
              <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Download size={22} style={{ color: '#2563EB' }} /> Export Student List
              </h3>
              <button className="icon-btn-ghost" onClick={() => { setShowExportModal(false); setExportFormat(null); setExportError(''); }} aria-label="Close"><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Scope section */}
              <div>
                <p style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                  Export Scope
                </p>

                {/* All students */}
                <label className={`export-scope-option${exportScope === 'all' ? ' selected' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="radio" name="exportScope" value="all" checked={exportScope === 'all'} onChange={() => setExportScope('all')} style={{ accentColor: '#2563EB' }} />
                  <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '0.9rem' }}>All students</span>
                  <span className="export-scope-count">{students.length}</span>
                </label>

                {/* Filtered */}
                <label className={`export-scope-option${exportScope === 'filtered' ? ' selected' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="radio" name="exportScope" value="filtered" checked={exportScope === 'filtered'} onChange={() => setExportScope('filtered')} style={{ accentColor: '#2563EB' }} />
                  <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '0.9rem' }}>
                    Current search / filter results
                    {searchQuery && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}> — "{searchQuery}"</span>}
                  </span>
                  <span className="export-scope-count">{filteredStudents.length}</span>
                </label>

                {/* Selected */}
                <label className={`export-scope-option${selectedStudentIds.length === 0 ? ' disabled' : ''}${exportScope === 'selected' ? ' selected' : ''}`} style={{ cursor: selectedStudentIds.length === 0 ? 'not-allowed' : 'pointer' }}>
                  <input type="radio" name="exportScope" value="selected" checked={exportScope === 'selected'} onChange={() => setExportScope('selected')} disabled={selectedStudentIds.length === 0} style={{ accentColor: '#2563EB' }} />
                  <span style={{ color: selectedStudentIds.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: '500', fontSize: '0.9rem' }}>
                    Selected students only
                    {selectedStudentIds.length === 0 && (
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>⚠ Select students from the table first</span>
                    )}
                  </span>
                  <span className="export-scope-count">{selectedStudentIds.length}</span>
                </label>
              </div>

              <div style={{ height: '1px', background: 'var(--glass-border)' }} />

              {/* Format cards */}
              <div>
                <p style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Export Format
                </p>
                <div className="export-format-cards">
                  {[
                    { id: 'excel', icon: '📊', name: 'Excel', ext: '.xlsx' },
                    { id: 'word',  icon: '📝', name: 'Word',  ext: '.docx' },
                    { id: 'pdf',   icon: '📄', name: 'PDF',   ext: '.pdf'  },
                  ].map(fmt => (
                    <div
                      key={fmt.id}
                      className={`export-format-card${exportFormat === fmt.id ? ' selected' : ''}`}
                      onClick={() => setExportFormat(fmt.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && setExportFormat(fmt.id)}
                    >
                      <span className="export-format-icon">{fmt.icon}</span>
                      <span className="export-format-name">{fmt.name}</span>
                      <span className="export-format-ext">{fmt.ext}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* What's included box */}
              <div className="export-included-box">
                <strong style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>📋 What's included:</strong>
                Student ID · Full Name · Email · Mobile · WhatsApp · Batch · Joined Date
                {exportScope !== 'all' && (
                  <div style={{ marginTop: '0.5rem', color: 'rgba(96,165,250,0.9)', fontSize: '0.8rem' }}>
                    ℹ Exporting {exportScope === 'filtered' ? filteredStudents.length : selectedStudentIds.length} student{(exportScope === 'filtered' ? filteredStudents.length : selectedStudentIds.length) !== 1 ? 's' : ''} from {exportScope === 'filtered' ? 'current filter' : 'selection'}
                  </div>
                )}
              </div>

              {/* Error */}
              {exportError && (
                <div className="error-alert" style={{ margin: 0 }}>{exportError}</div>
              )}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button
                className="modern-btn modern-btn--secondary"
                onClick={() => { setShowExportModal(false); setExportFormat(null); setExportError(''); }}
              >
                Cancel
              </button>
              <button
                className="modern-btn modern-btn--primary"
                disabled={!exportFormat || exportLoading}
                onClick={handleExport}
                style={{ gap: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Download size={15} />
                {exportLoading ? 'Preparing...' : 'Download'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Success Toast ────────────────────────────────────────────────────── */}
      {exportToast && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 9999,
          background: 'rgba(16,185,129,0.95)', color: 'white',
          padding: '0.85rem 1.25rem', borderRadius: '10px',
          fontSize: '0.9rem', fontWeight: '600',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          animation: 'slideDown 0.25s ease',
          backdropFilter: 'blur(12px)',
        }}>
          {exportToast}
        </div>
      )}

      <style>{`

        .student-manager-table-scroll {
          padding: 0 !important;
          overflow-x: auto !important;
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.72) rgba(148, 163, 184, 0.12);
          touch-action: pan-x pan-y;
        }
        .student-manager-table {
          width: 100%;
          table-layout: fixed;
        }
        .student-manager-table th,
        .student-manager-table td {
          padding: 0.95rem 0.75rem !important;
        }
        .student-manager-table th {
          position: sticky;
          top: 0;
          z-index: 10;
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(12px);
        }
        .student-manager-table .student-table-col-id {
          width: 9%;
          white-space: nowrap;
        }
        .student-manager-table .student-table-col-name {
          width: 24%;
        }
        .student-manager-table .student-table-col-contact {
          width: 23%;
        }
        .student-manager-table .student-table-col-batch {
          width: 9%;
          white-space: nowrap;
        }
        .student-manager-table .student-table-col-progress {
          width: 17%;
        }
        .student-manager-table .student-table-col-joined {
          width: 8%;
          white-space: nowrap;
        }
        .student-manager-table .student-table-col-actions {
          width: 13%;
        }
        .student-table-batch-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }
        .student-table-course-card {
          min-width: 0;
          width: 100%;
        }
        .student-table-actions {
          flex-wrap: nowrap;
          min-width: max-content;
        }
        .student-manager-table-scroll::-webkit-scrollbar {
          height: 16px;
        }
        .student-manager-table-scroll::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.12);
          border-radius: 999px;
        }
        .student-manager-table-scroll::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.72);
          border-radius: 999px;
          border: 2px solid rgba(15, 23, 42, 0.12);
        }
        .student-manager-table-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(96, 165, 250, 0.82);
        }
        @media (max-width: 1600px) {
          .student-manager-table-scroll {
            width: 100% !important;
            max-width: 100% !important;
            max-height: min(58vh, 420px);
            overflow: auto !important;
            margin-left: 0;
            margin-right: 0;
            overscroll-behavior: contain;
          }
          .student-manager-table {
            width: max-content;
            min-width: 1320px;
            table-layout: auto;
          }
          .student-manager-table th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: rgba(15, 15, 18, 0.96);
          }
          [data-mode="light"] .student-manager-table th {
            background: rgba(255, 255, 255, 0.96);
          }
          .student-manager-table th,
          .student-manager-table td {
            padding: 1rem 1.25rem !important;
          }
          .student-manager-table .student-table-col-id {
            min-width: 120px;
            width: auto;
          }
          .student-manager-table .student-table-col-name {
            min-width: 220px;
            width: auto;
          }
          .student-manager-table .student-table-col-contact {
            min-width: 280px;
            width: auto;
          }
          .student-manager-table .student-table-col-batch {
            min-width: 130px;
            width: auto;
          }
          .student-manager-table .student-table-col-progress {
            min-width: 260px;
            width: auto;
          }
          .student-manager-table .student-table-col-joined {
            min-width: 130px;
            width: auto;
          }
          .student-manager-table .student-table-col-actions {
            min-width: 220px;
            width: auto;
          }
          .student-table-course-card {
            max-width: 210px;
          }
        }

        /* ── Export Button ──────────────────────────────────── */
        .btn-export {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 7px;
          background: transparent;
          color: rgba(255,255,255,0.75);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .btn-export:hover {
          border-color: rgba(37,99,235,0.5);
          background: rgba(37,99,235,0.08);
          color: #93C5FD;
        }

        /* ── Export Scope Options ───────────────────────────── */
        .export-scope-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.06);
          margin-bottom: 8px;
          transition: background 0.15s;
        }
        .export-scope-option:hover:not(.disabled) {
          background: rgba(255,255,255,0.04);
        }
        .export-scope-option.selected {
          border-color: rgba(37,99,235,0.35);
          background: rgba(37,99,235,0.06);
        }
        .export-scope-option.disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .export-scope-count {
          margin-left: auto;
          font-size: 12px;
          color: rgba(255,255,255,0.4);
          background: rgba(255,255,255,0.06);
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 600;
          flex-shrink: 0;
        }

        /* ── Format Cards ───────────────────────────────────── */
        .export-format-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .export-format-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 20px 12px;
          border-radius: 10px;
          border: 2px solid rgba(255,255,255,0.08);
          cursor: pointer;
          transition: all 0.15s ease;
          background: rgba(255,255,255,0.02);
          user-select: none;
        }
        .export-format-card:hover {
          border-color: rgba(37,99,235,0.4);
          background: rgba(37,99,235,0.05);
        }
        .export-format-card.selected {
          border-color: #2563EB;
          background: rgba(37,99,235,0.1);
        }
        .export-format-icon {
          font-size: 28px;
          line-height: 1;
        }
        .export-format-name {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-primary);
        }
        .export-format-ext {
          font-size: 11px;
          color: rgba(255,255,255,0.4);
          font-family: monospace;
        }

        /* ── What's Included Box ────────────────────────────── */
        .export-included-box {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: rgba(255,255,255,0.5);
          line-height: 1.6;
        }

        /* ── Selection Bar ──────────────────────────────────── */
        .student-selection-bar {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 10px 16px;
          background: rgba(37,99,235,0.08);
          border: 1px solid rgba(37,99,235,0.2);
          border-radius: 8px;
          margin-bottom: 12px;
          font-size: 13px;
          color: var(--text-primary);
          animation: slideDown 0.2s ease;
          flex-wrap: wrap;
        }
        .selection-bar-count {
          color: #60A5FA;
          font-weight: 600;
        }
        .selection-bar-clear {
          color: rgba(255,255,255,0.4);
          cursor: pointer;
          text-decoration: underline;
          font-size: 12px;
          border: none;
          background: none;
          padding: 0;
        }
        .selection-bar-clear:hover { color: var(--text-primary); }
        .selection-bar-export {
          margin-left: auto;
          padding: 5px 12px;
          background: #2563EB;
          border-radius: 6px;
          color: white;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: background 0.15s;
        }
        .selection-bar-export:hover { background: #1d4ed8; }

        /* ── Row Checkbox Column ────────────────────────────── */
        .student-checkbox-col {
          width: 40px;
          text-align: center;
        }
        .student-row-check {
          accent-color: #2563EB;
          width: 15px;
          height: 15px;
          cursor: pointer;
        }

        @media (max-width: 768px) {
          .export-format-cards {
            gap: 8px;
          }
          .export-format-card {
            padding: 14px 8px;
          }
          .export-format-name { font-size: 12px; }
          .student-selection-bar {
            gap: 10px;
          }
          .selection-bar-export {
            margin-left: 0;
          }
        }
      `}</style>


    </div>
  );
}
