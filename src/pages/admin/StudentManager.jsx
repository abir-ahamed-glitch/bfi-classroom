import { useState, useEffect } from 'react';
import { UserPlus, Search, Copy, CheckCircle2, User, UserCheck, CheckSquare, Square, Edit, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function StudentManager() {
  const { currentUser } = useAuth();
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

  const toggleProgress = async (studentId, enrollmentId, stepField, currentValue) => {
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
        alert(data.error || 'Failed to update progress');
      }
    } catch (err) {
      console.error('Progress update error', err);
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
    setEditFormData({
      firstName: student.first_name || names[0] || '',
      lastName: student.last_name || names.slice(1).join(' ') || '',
      email: student.email || '',
      mobileNumber: student.mobile_number || '',
      username: student.username || '',
      batchNumber: student.batch_number || '',
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
        {/* Creator Panel */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '3rem' }}>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserPlus className="text-accent" /> Register New Student
          </h2>
          
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
            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle2 size={20} /> Success! Credentials Ready</h3>
                <button onClick={copyCredentials} className="btn" style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none' }}>
                  {copied ? 'Copied!' : <><Copy size={16} /> Copy Details</>}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', color: '#e2e8f0', fontSize: '0.95rem' }}>
                <p><strong>Name:</strong> {successData.firstName} {successData.lastName}</p>
                <p><strong>ID:</strong> {successData.studentId}</p>
                <p><strong>Username:</strong> <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{successData.username}</span></p>
                <p><strong>Password:</strong> <span style={{ fontFamily: 'monospace', color: '#f472b6' }}>{successData.rawPassword}</span></p>
              </div>
              <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#94a3b8' }}>* Note: Password is only displayed here once. Please copy and share it securely using the copy button above.</p>
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
          <div className="glass-panel" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Student ID</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Name</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Username</th>
                   <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Email</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Batch</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Course Progression</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Joined</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--glass-border)', fontSize: '0.95rem' }}>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{s.student_id}</td>
                    <td style={{ padding: '1rem' }}>{s.full_name}</td>
                    <td style={{ padding: '1rem', fontFamily: 'monospace' }}>{s.username}</td>
                    <td style={{ padding: '1rem', fontSize: '0.85rem' }}>{s.email}</td>
                    <td style={{ padding: '1rem' }}>{s.batch_number}</td>
                     <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        {s.enrollments && s.enrollments.map(e => (
                          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary)', minWidth: '130px' }}>{e.course_name}</div>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              {e.course_type === 'filmmaking' ? (
                                <>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed)} title="Phase 1: Admitted" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#34d399' : '#64748b' }}>
                                    {e.step1_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed)} title="Phase 1: Passed Exam" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: e.step2_completed ? '#34d399' : '#64748b' }}>
                                    {e.step2_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                                  </button>
                                  <div style={{ width: '1px', background: 'var(--glass-border)', margin: '0 0.1rem' }}></div>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step3_completed', e.step3_completed)} title="Phase 2: Admitted" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: e.step3_completed ? '#34d399' : '#64748b' }}>
                                    {e.step3_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed)} title="Phase 2: Completed Course" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: e.step4_completed ? '#34d399' : '#64748b' }}>
                                    {e.step4_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed)} title="Admitted" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#34d399' : '#64748b' }}>
                                    {e.step1_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed)} title="Completed Course" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: e.step4_completed ? '#34d399' : '#64748b' }}>
                                    {e.step4_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '1rem' }}>
                      <button onClick={() => openEditModal(s)} className="btn" style={{ padding: '0.4rem', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                        <Edit size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No students registered yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal Overlay */}
      {editingStudent && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="glass-panel" style={{ background: 'var(--bg-secondary)', padding: '2rem', width: '100%', maxWidth: '500px', position: 'relative' }}>
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
        </div>
      )}
    </div>
  );
}
