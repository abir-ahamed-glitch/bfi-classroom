import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Search, Copy, CheckCircle2, User, UserCheck, CheckSquare, Square, Edit, X, FileSpreadsheet, Trash2, GraduationCap } from 'lucide-react';
import BulkStudentImport from '../../components/admin/BulkStudentImport';
import { getOrdinalSuffix } from '../../utils/formatUtils';

export default function StudentManager() {
  const [students, setStudents] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit Modal State
  const [editingStudent, setEditingStudent] = useState(null);
  const [editFormData, setEditFormData] = useState({
    firstName: '', lastName: '', email: '', username: '', batchNumber: '', mobileNumber: '', phase1_fee: '', phase2_fee: '',
    courses: []
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');

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

  // Confirmation Modal State
  const [confirmConfig, setConfirmConfig] = useState(null);

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

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (editingStudent || confirmConfig || academicStudent) {
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
  }, [editingStudent, confirmConfig, academicStudent]);

  const toggleProgress = async (studentId, enrollmentId, stepField, currentValue, courseName) => {
    if (courseName === 'Online Filmmaking Course') {
      const student = students.find(s => s.id === studentId);
      const e = student?.enrollments?.find(env => env.id === enrollmentId);
      const willBeChecked = !currentValue;

      if (stepField === 'step2_completed') {
        openAcademicModal(student, enrollmentId);
        return;
      }

      if (willBeChecked) {
        if (stepField === 'step3_completed' && (!e?.step1_completed || !e?.step2_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Phase 2: Enrolled". "Phase 1: Enrolled" and "Phase 1: Passed Exam" must be checked first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step4_completed' && (!e?.step1_completed || !e?.step2_completed || !e?.step3_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Phase 2: Completed". All previous phases must be checked first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      } else {
        if (stepField === 'step3_completed' && e?.step4_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 2: Enrolled" while "Phase 2: Completed" is checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step1_completed' && (e?.step2_completed || e?.step3_completed || e?.step4_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 1: Enrolled" while subsequent phases are checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
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
    setEditError('');
    setEditingStudent(student);
    const names = student.full_name ? student.full_name.split(' ') : ['', ''];
    
    let extractedSn = '';
    let extractedYear = new Date().getFullYear().toString();
    if (student.student_id && student.student_id.startsWith('BFI')) {
      const idStr = student.student_id.substring(3);
      if (idStr.length === 8) {
        extractedSn = idStr.substring(0, 2);
        extractedYear = idStr.substring(4, 8);
      }
    }

    setEditFormData({
      firstName: student.first_name || names[0] || '',
      lastName: student.last_name || names.slice(1).join(' ') || '',
      email: student.email || '',
      mobileNumber: student.mobile_number || '',
      username: student.username || '',
      batchNumber: student.batch_number || '',
      snNo: extractedSn,
      year: extractedYear,
      phase1_fee: student.phase1_fee || '',
      phase2_fee: student.phase2_fee || '',
      courses: student.enrollments ? student.enrollments.map(e => e.course_name) : []
    });
  };

  const handleCourseChange = (courseName) => {
    const currentCourses = formData.courses;
    if (currentCourses.includes(courseName)) {
      setFormData({ ...formData, courses: currentCourses.filter(c => c !== courseName) });
    } else {
      setFormData({ ...formData, courses: [...currentCourses, courseName] });
    }
  };

  const handleEditCourseChange = (courseName) => {
    const currentCourses = editFormData.courses || [];
    if (currentCourses.includes(courseName)) {
      setEditFormData({ ...editFormData, courses: currentCourses.filter(c => c !== courseName) });
    } else {
      setEditFormData({ ...editFormData, courses: [...currentCourses, courseName] });
    }
  };

  const handleEditChange = (e) => setEditFormData({ ...editFormData, [e.target.name]: e.target.value });

  const openAcademicModal = (student, courseId) => {
    setAcademicError('');
    const enrollment = student.enrollments.find(e => e.id === courseId);
    setAcademicStudent({ ...student, enrollment });
    setAcademicCourseId(courseId);
    setAcademicFormData({
      attendance_classes: enrollment.attendance_classes?.toString() || '0',
      attendance_total: enrollment.attendance_total?.toString() || '22',
      exam_written: enrollment.exam_written?.toString() || '0',
      assignment_screenplay: enrollment.assignment_screenplay?.toString() || '0',
      assignment_shooting_script: enrollment.assignment_shooting_script?.toString() || '0'
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update academic records');
      await fetchStudents();
      closeAcademicModal();
    } catch (err) {
      setAcademicError(err.message);
    } finally {
      setIsAcademicSaving(false);
    }
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    setIsEditing(true);
    setEditError('');

    try {
      const res = await fetch(`/api/admin/students/${editingStudent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(editFormData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update student profile');
      
      setEditingStudent(null);
      fetchStudents();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setIsEditing(false);
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
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <UserCheck className="text-secondary" /> Registered Students
            </h2>
            <div className="input-wrapper" style={{ width: '100%', maxWidth: '350px' }}>
              <Search className="input-icon" size={18} />
              <input 
                type="text" 
                placeholder="Search by name, ID, batch, email..." 
                className="input-glass" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="glass-panel student-manager-table-scroll" style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', padding: '0', border: '1px solid var(--glass-border)', borderRadius: '12px', scrollbarGutter: 'stable both-edges' }}>
            <table className="student-manager-table" style={{ borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.02)', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                        {s.enrollments && s.enrollments.find(e => e.course_name === 'Online Filmmaking Course') && (
                          <button 
                            onClick={() => openAcademicModal(s, s.enrollments.find(e => e.course_name === 'Online Filmmaking Course').id)}
                            className="btn" 
                            style={{ padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                            title="Academic Records"
                          >
                            <GraduationCap size={16} />
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
                    <td colSpan="7" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '48px', height: '48px', background: 'var(--glass-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <UserCheck size={24} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <span>No students registered yet.</span>
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
      {editingStudent && createPortal(
        <div onClick={() => setEditingStudent(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} className="glass-panel" style={{ background: 'var(--bg-secondary)', padding: '2rem', width: '100%', maxWidth: '500px', position: 'relative', margin: 'auto' }}>
            <button onClick={() => setEditingStudent(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
               <X size={20} />
            </button>
            
            <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Edit className="text-accent" /> Edit Student Details
            </h2>
            
            <form onSubmit={submitEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                  <input type="text" name="firstName" value={editFormData.firstName} onChange={handleEditChange} className="input-glass" required />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                  <input type="text" name="lastName" value={editFormData.lastName} onChange={handleEditChange} className="input-glass" required />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                  <input type="email" name="email" value={editFormData.email} onChange={handleEditChange} className="input-glass" required style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                  <input type="text" name="mobileNumber" value={editFormData.mobileNumber} onChange={handleEditChange} className="input-glass" placeholder="+880..." style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Username</label>
                  <input type="text" name="username" value={editFormData.username} onChange={handleEditChange} className="input-glass" required style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Batch Number</label>
                  <input type="text" name="batchNumber" value={editFormData.batchNumber} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>SN No. (2 digits)</label>
                  <input type="text" name="snNo" value={editFormData.snNo} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} placeholder="e.g. 05" />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Year (4 digits)</label>
                  <input type="text" name="year" value={editFormData.year} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} placeholder="e.g. 2024" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Phase 1 Fee Status</label>
                  <input type="text" name="phase1_fee" value={editFormData.phase1_fee} onChange={handleEditChange} className="input-glass" placeholder="e.g. 5000 BDT Paid" style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Phase 2 Fee Status</label>
                  <input type="text" name="phase2_fee" value={editFormData.phase2_fee} onChange={handleEditChange} className="input-glass" placeholder="e.g. Paid Full" style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Enrolled Courses</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                  {availableCourses.map(course => (
                    <label key={course.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: (editFormData.courses || []).includes(course.name) ? 'rgba(56, 189, 248, 0.1)' : 'transparent', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid', borderColor: (editFormData.courses || []).includes(course.name) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', transition: 'all 0.2s' }}>
                      <input 
                        type="checkbox" 
                        checked={(editFormData.courses || []).includes(course.name)} 
                        onChange={() => handleEditCourseChange(course.name)}
                        style={{ width: '15px', height: '15px' }}
                      />
                      <span style={{ fontSize: '0.85rem' }}>{course.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {editError && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{editError}</div>}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setEditingStudent(null)} className="btn btn-glass" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isEditing} style={{ flex: 1 }}>
                  {isEditing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {confirmConfig && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay" onClick={() => setConfirmConfig(null)}>
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem', animation: 'fadeIn 0.2s ease-out' }} onClick={closeAcademicModal}>
          <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', border: '1px solid var(--glass-border)', borderRadius: '24px', padding: '2rem', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GraduationCap size={24} style={{ color: '#10b981' }} /> Academic Records
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                  {academicStudent.full_name} <span style={{ opacity: 0.7 }}>({academicStudent.batch_number ? `${getOrdinalSuffix(academicStudent.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: '500', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.2rem 0.6rem', borderRadius: '6px', display: 'inline-block' }}>
                  {academicStudent.enrollment?.course_name || 'Course'}
                </p>
              </div>
              <button onClick={closeAcademicModal} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-muted)'; }}><X size={20} /></button>
            </div>

            <form onSubmit={submitAcademic} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>Requires 33+ total marks to pass.</p>
              </div>

              {academicError && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{academicError}</div>}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={closeAcademicModal} className="btn btn-glass" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn" disabled={isAcademicSaving} style={{ flex: 1, background: '#10b981', color: 'white', border: 'none', borderRadius: '8px' }}>
                  {isAcademicSaving ? 'Saving...' : 'Save Records'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
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
          width: 10%;
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
          height: 12px;
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
            min-width: 180px;
            width: auto;
          }
          .student-table-course-card {
            max-width: 210px;
          }
        }
      `}</style>

    </div>
  );
}
