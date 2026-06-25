import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Search, Copy, CheckCircle2, User, UserCheck, Edit, X, ChevronUp, ChevronDown, GripVertical, Trash2 } from 'lucide-react';

export default function TeacherManager() {
  const [teachers, setTeachers] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmConfig, setConfirmConfig] = useState(null);

  // Edit Modal State
  const [editingTeacher, setEditingTeacher] = useState(null);
  const [editFormData, setEditFormData] = useState({
    firstName: '', lastName: '', email: '', username: '', mobileNumber: '', gender: '', subjects: []
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');
  const [customSubjects, setCustomSubjects] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [subjectSearchAdd, setSubjectSearchAdd] = useState('');
  const [subjectSearchEdit, setSubjectSearchEdit] = useState('');

  const SUBJECTS = [
    'History of World Cinema', 'Film Language', 'Film Aesthetics', 'Aesthetics of Sound', 
    'Music', 'Cinematography', 'Light', 'Art Direction', 'Acting', 'Dress and Props', 
    'Script', 'Shot Division', 'Documentary', 'Film Criticism', 'How to Read a Film', 
    'Film Production Design'
  ];

  const allSubjects = (customSubjects.length > 0 ? customSubjects : SUBJECTS.map(name => ({
    id: name,
    name,
    course_name: 'Online Filmmaking Course',
    phase: 1,
    parts_count: 1
  }))).flatMap(s => {
    const partsCount = s.parts_count || 1;
    if (partsCount > 1) {
      const parts = [];
      for (let i = 1; i <= partsCount; i++) {
        parts.push({
          id: `${s.id}-part${i}`,
          name: `${s.name} - Part ${i}`,
          course_name: s.course_name,
          phase: s.phase
        });
      }
      return parts;
    }
    return s;
  });

  const getGroupedSubjects = (searchQuery) => {
    const groups = {};
    allSubjects.forEach(sub => {
      if (!sub.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
      const key = sub.course_name + (sub.phase ? ` (Phase ${sub.phase})` : '');
      if (!groups[key]) groups[key] = [];
      groups[key].push(sub.name);
    });
    return groups;
  };

  const fetchCustomSubjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/custom-subjects', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setCustomSubjects(data.subjects || []);
      }
    } catch (error) {
      console.error('Failed to fetch custom subjects:', error);
    }
  };

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobileNumber: '',
    gender: '',
    manualUsername: '',
    manualPassword: '',
    subjects: []
  });

  const fetchTeachers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/teachers', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setTeachers(data.teachers || []);
      }
    } catch (error) {
      console.error('Failed to fetch teachers:', error);
    }
  };

  const confirmDeleteTeacher = (teacherId, teacherName) => {
    const messageNode = (
      <span>
        You are about to permanently remove the profile and account for{' '}
        <strong style={{ fontWeight: 700, color: '#f43f5e' }}>{teacherName}</strong>
        {' '}from the institutional database. This action is irreversible and will delete all associated data.
      </span>
    );
    setConfirmConfig({
      title: 'Delete Teacher Account',
      message: messageNode,
      confirmText: 'Delete',
      type: 'danger',
      onConfirm: () => performDelete(teacherId)
    });
  };

  const performDelete = async (teacherId) => {
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (res.ok) {
        fetchTeachers();
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Deletion Failed', message: data.error || 'Failed to delete teacher.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Teacher deletion error', err);
      setConfirmConfig({ title: 'Error', message: 'An error occurred while deleting the teacher.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
    }
  };

  useEffect(() => {
    fetchTeachers();
    fetchCustomSubjects();
  }, []);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubjectChange = (subject) => {
    setFormData((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subject)
        ? prev.subjects.filter((s) => s !== subject)
        : [...prev.subjects, subject]
    }));
  };

  const handleEditInputChange = (e) => {
    setEditFormData({ ...editFormData, [e.target.name]: e.target.value });
  };

  const handleEditSubjectChange = (subject) => {
    setEditFormData((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subject)
        ? prev.subjects.filter((s) => s !== subject)
        : [...prev.subjects, subject]
    }));
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverAdd = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    setFormData((prev) => {
      const newSubjects = [...(prev.subjects || [])];
      const [draggedItem] = newSubjects.splice(draggedIndex, 1);
      newSubjects.splice(index, 0, draggedItem);
      setDraggedIndex(index);
      return { ...prev, subjects: newSubjects };
    });
  };

  const handleDragOverEdit = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    setEditFormData((prev) => {
      const newSubjects = [...(prev.subjects || [])];
      const [draggedItem] = newSubjects.splice(draggedIndex, 1);
      newSubjects.splice(index, 0, draggedItem);
      setDraggedIndex(index);
      return { ...prev, subjects: newSubjects };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsDeploying(true);
    setErrorMsg('');
    setSuccessData(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/teachers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create teacher account');
      }

      setSuccessData(data.teacher);
      setFormData({
        firstName: '', lastName: '', email: '', mobileNumber: '',
        manualUsername: '', manualPassword: '', subjects: []
      });
      fetchTeachers();
      
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setIsDeploying(false);
    }
  };

  const copyToClipboard = () => {
    if (!successData) return;
    const text = `Teacher Account Credentials:\n\nName: ${successData.firstName} ${successData.lastName}\nUsername: ${successData.username}\nPassword: ${successData.rawPassword}\n\nPlease keep this information secure.`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startEdit = (teacher) => {
    setEditingTeacher(teacher);
    setEditFormData({
      firstName: teacher.first_name,
      lastName: teacher.last_name,
      email: teacher.email,
      username: teacher.username,
      mobileNumber: teacher.mobile_number || '',
      subjects: teacher.subjects || []
    });
    setIsEditing(false);
  };

  const saveEdit = async (e) => {
    if (e) e.preventDefault();
    setEditError('');
    setIsEditing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/teachers/${editingTeacher.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editFormData)
      });

      if (!response.ok) {
        const d = await response.json();
        throw new Error(d.error || 'Failed to update teacher');
      }

      setIsEditing(false);
      setEditingTeacher(null);
      fetchTeachers();
    } catch (err) {
      setEditError(err.message);
      setIsEditing(false);
    }
  };

  const filteredTeachers = teachers.filter(t => 
    t.first_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.last_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedSubjectsForAdd = getGroupedSubjects(subjectSearchAdd);
  const groupedSubjectsForEdit = getGroupedSubjects(subjectSearchEdit);

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Teacher Accounts</h1>
        <p className="subtitle">Create and manage access for instructors.</p>
      </div>

      <div style={{ display: 'block' }}>
        {/* Creator Panel */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '3rem' }}>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserPlus className="text-accent" /> Register New Teacher
          </h2>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="responsive-two-column-grid">
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                <input type="text" name="firstName" value={formData.firstName} onChange={handleInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                <input type="text" name="lastName" value={formData.lastName} onChange={handleInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div className="responsive-two-column-grid">
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                <input type="text" name="mobileNumber" value={formData.mobileNumber} onChange={handleInputChange} className="input-glass" placeholder="+880..." style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Gender</label>
              <select name="gender" value={formData.gender} onChange={handleInputChange} className="input-glass" style={{ width: '100%', paddingLeft: '1rem' }}>
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Select Subjects</h3>
              
              <div style={{ position: 'relative', marginBottom: '1.2rem' }}>
                <Search 
                  size={16} 
                  style={{ 
                    position: 'absolute', 
                    left: '10px', 
                    top: '50%', 
                    transform: 'translateY(-50%)', 
                    color: 'var(--text-muted)' 
                  }} 
                />
                <input
                  type="text"
                  placeholder="Search subjects..."
                  value={subjectSearchAdd}
                  onChange={(e) => setSubjectSearchAdd(e.target.value)}
                  className="input-glass"
                  style={{ 
                    width: '100%', 
                    paddingLeft: '2.2rem', 
                    paddingRight: '1rem',
                    height: '36px',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              {Object.keys(groupedSubjectsForAdd).map((groupName) => (
                <div key={groupName} style={{ marginBottom: '1.5rem', width: '100%' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.8rem', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.3rem' }}>
                    {groupName}
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                    {groupedSubjectsForAdd[groupName].map((subject) => (
                      <label key={subject} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: formData.subjects.includes(subject) ? 'rgba(56, 189, 248, 0.1)' : 'transparent', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid', borderColor: formData.subjects.includes(subject) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', transition: 'all 0.2s' }}>
                        <input 
                          type="checkbox" 
                          checked={formData.subjects.includes(subject)} 
                          onChange={() => handleSubjectChange(subject)}
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span style={{ fontSize: '0.9rem' }}>{subject}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {Object.keys(groupedSubjectsForAdd).length === 0 && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.5rem' }}>
                  No matching subjects found.
                </p>
              )}

              {formData.subjects && formData.subjects.length > 0 && (
                <div style={{ marginTop: '1.5rem', paddingTop: '1.2rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ fontSize: '0.95rem', marginBottom: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Arrange Subjects Lineup (drag to reorder)
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {formData.subjects.map((subject, index) => (
                      <div
                        key={subject}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOverAdd(e, index)}
                        onDragEnd={() => setDraggedIndex(null)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.6rem 1rem',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          cursor: 'grab',
                          opacity: draggedIndex === index ? 0.4 : 1,
                          transition: 'opacity 0.2s',
                          userSelect: 'none'
                        }}
                        onDragEnter={(e) => e.preventDefault()}
                      >
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                          <GripVertical size={16} style={{ color: 'var(--text-muted)', cursor: 'grab', opacity: 0.5 }} />
                          <span style={{ color: 'var(--text-muted)' }}>#{index + 1}</span>
                          {subject}
                        </span>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (index > 0) {
                                setFormData(prev => {
                                  const newSubjects = [...(prev.subjects || [])];
                                  const [moved] = newSubjects.splice(index, 1);
                                  newSubjects.splice(index - 1, 0, moved);
                                  return { ...prev, subjects: newSubjects };
                                });
                              }
                            }}
                            disabled={index === 0}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: index === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                              opacity: index === 0 ? 0.3 : 0.8,
                              cursor: index === 0 ? 'not-allowed' : 'pointer',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              borderRadius: '4px',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              if (index > 0) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'none';
                            }}
                            title="Move Up"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (index < formData.subjects.length - 1) {
                                setFormData(prev => {
                                  const newSubjects = [...(prev.subjects || [])];
                                  const [moved] = newSubjects.splice(index, 1);
                                  newSubjects.splice(index + 1, 0, moved);
                                  return { ...prev, subjects: newSubjects };
                                });
                              }
                            }}
                            disabled={index === formData.subjects.length - 1}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: index === formData.subjects.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                              opacity: index === formData.subjects.length - 1 ? 0.3 : 0.8,
                              cursor: index === formData.subjects.length - 1 ? 'not-allowed' : 'pointer',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              borderRadius: '4px',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              if (index < formData.subjects.length - 1) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'none';
                            }}
                            title="Move Down"
                          >
                            <ChevronDown size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Optional: Manual Credentials</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>If left blank, secure credentials will be generated automatically.</p>
              
              <div className="responsive-two-column-grid">
                <div>
                  <input type="text" name="manualUsername" value={formData.manualUsername} onChange={handleInputChange} className="input-glass" placeholder="Custom Username" style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
                <div>
                  <input type="text" name="manualPassword" value={formData.manualPassword} onChange={handleInputChange} className="input-glass" placeholder="Custom Password" style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
              </div>
            </div>

            {errorMsg && <div className="error-alert">{errorMsg}</div>}

            <button type="submit" className="btn btn-primary" disabled={isDeploying}>
              {isDeploying ? 'Creating Account...' : 'Create Teacher Account'}
            </button>
          </form>

          {/* Success Summary */}
          {successData && (
            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(16, 185, 129, 0.12)', border: '2px solid rgba(16, 185, 129, 0.5)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle2 size={20} /> Success! Credentials Ready</h3>
                <button onClick={copyToClipboard} className="btn" style={{ padding: '0.5rem 1rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px' }}>
                  {copied ? 'Copied!' : <><Copy size={16} /> Copy Details</>}
                </button>
              </div>
              <div className="responsive-two-column-grid" style={{ fontSize: '0.95rem' }}>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Name:</strong> {successData.firstName} {successData.lastName}</p>
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

        {/* Teachers List */}
        <div style={{ marginTop: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <UserCheck className="text-secondary" /> Registered Teachers
            </h2>
            <div className="input-wrapper" style={{ width: '100%', maxWidth: '350px' }}>
              <Search className="input-icon" size={18} />
              <input 
                type="text" 
                placeholder="Search by name, email, username..." 
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
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Name</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Username</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Email</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Subjects</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Joined</th>
                  <th style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--glass-border)', fontSize: '0.95rem' }}>
                    <td style={{ padding: '1rem' }}>{t.first_name} {t.last_name}</td>
                    <td style={{ padding: '1rem', fontFamily: 'monospace' }}>{t.username}</td>
                    <td style={{ padding: '1rem', fontSize: '0.85rem' }}>{t.email}</td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {t.subjects?.map((sub, i) => (
                          <div key={i} style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>{sub}</div>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => startEdit(t)} className="btn" style={{ padding: '0.4rem', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.2)' }} title="Edit Teacher">
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => confirmDeleteTeacher(t.id, `${t.first_name} ${t.last_name}`)} 
                          className="btn" 
                          style={{ 
                            padding: '0.4rem', 
                            background: 'rgba(239, 68, 68, 0.1)', 
                            color: '#ef4444', 
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: '4px',
                            transition: 'all 0.2s'
                          }} 
                          onMouseEnter={(e) => { 
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; 
                            e.currentTarget.style.transform = 'scale(1.05)'; 
                          }} 
                          onMouseLeave={(e) => { 
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; 
                            e.currentTarget.style.transform = 'scale(1)'; 
                          }} 
                          title="Delete Teacher"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTeachers.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No teachers registered yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal Overlay */}
      {editingTeacher && createPortal(
        <div className="modern-modal-overlay" onClick={() => setEditingTeacher(null)}>
          <form onSubmit={saveEdit} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Edit className="text-accent" /> Edit Teacher Details
              </h3>
              <button type="button" className="icon-btn-ghost" onClick={() => setEditingTeacher(null)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            
            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '60vh', overflowY: 'auto' }}>
              <div className="responsive-two-column-grid">
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                  <input type="text" name="firstName" value={editFormData.firstName} onChange={handleEditInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                  <input type="text" name="lastName" value={editFormData.lastName} onChange={handleEditInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
              </div>

              <div className="responsive-two-column-grid">
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                  <input type="email" name="email" value={editFormData.email} onChange={handleEditInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                  <input type="text" name="mobileNumber" value={editFormData.mobileNumber} onChange={handleEditInputChange} className="input-glass" placeholder="+880..." style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Username</label>
                  <input type="text" name="username" value={editFormData.username} onChange={handleEditInputChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Subjects Taught</h3>
                
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                  <Search 
                    size={15} 
                    style={{ 
                      position: 'absolute', 
                      left: '10px', 
                      top: '50%', 
                      transform: 'translateY(-50%)', 
                      color: 'var(--text-muted)' 
                    }} 
                  />
                  <input
                    type="text"
                    placeholder="Search subjects..."
                    value={subjectSearchEdit}
                    onChange={(e) => setSubjectSearchEdit(e.target.value)}
                    className="input-glass"
                    style={{ 
                      width: '100%', 
                      paddingLeft: '2.2rem', 
                      paddingRight: '1rem',
                      height: '34px',
                      fontSize: '0.8rem'
                    }}
                  />
                </div>

                {Object.keys(groupedSubjectsForEdit).map((groupName) => (
                  <div key={groupName} style={{ marginBottom: '1.2rem', width: '100%' }}>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginBottom: '0.6rem', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                      {groupName}
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                      {groupedSubjectsForEdit[groupName].map((subject) => (
                        <label key={subject} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: (editFormData.subjects || []).includes(subject) ? 'rgba(56, 189, 248, 0.1)' : 'transparent', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid', borderColor: (editFormData.subjects || []).includes(subject) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', transition: 'all 0.2s' }}>
                          <input 
                            type="checkbox" 
                            checked={(editFormData.subjects || []).includes(subject)} 
                            onChange={() => handleEditSubjectChange(subject)}
                            style={{ width: '15px', height: '15px' }}
                          />
                          <span style={{ fontSize: '0.85rem' }}>{subject}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                {Object.keys(groupedSubjectsForEdit).length === 0 && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.5rem' }}>
                    No matching subjects found.
                  </p>
                )}

                {editFormData.subjects && editFormData.subjects.length > 0 && (
                  <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <h4 style={{ fontSize: '0.9rem', marginBottom: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Arrange Subjects Lineup (drag to reorder)
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {editFormData.subjects.map((subject, index) => (
                        <div
                          key={subject}
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragOver={(e) => handleDragOverEdit(e, index)}
                          onDragEnd={() => setDraggedIndex(null)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.6rem 1rem',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            cursor: 'grab',
                            opacity: draggedIndex === index ? 0.4 : 1,
                            transition: 'opacity 0.2s',
                            userSelect: 'none'
                          }}
                          onDragEnter={(e) => e.preventDefault()}
                        >
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                            <GripVertical size={16} style={{ color: 'var(--text-muted)', cursor: 'grab', opacity: 0.5 }} />
                            <span style={{ color: 'var(--text-muted)' }}>#{index + 1}</span>
                            {subject}
                          </span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <button
                              type="button"
                              onClick={() => {
                                if (index > 0) {
                                  setEditFormData(prev => {
                                    const newSubjects = [...(prev.subjects || [])];
                                    const [moved] = newSubjects.splice(index, 1);
                                    newSubjects.splice(index - 1, 0, moved);
                                    return { ...prev, subjects: newSubjects };
                                  });
                                }
                              }}
                              disabled={index === 0}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: index === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                                opacity: index === 0 ? 0.3 : 0.8,
                                cursor: index === 0 ? 'not-allowed' : 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '4px',
                                transition: 'background 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                if (index > 0) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'none';
                              }}
                              title="Move Up"
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (index < editFormData.subjects.length - 1) {
                                  setEditFormData(prev => {
                                    const newSubjects = [...(prev.subjects || [])];
                                    const [moved] = newSubjects.splice(index, 1);
                                    newSubjects.splice(index + 1, 0, moved);
                                    return { ...prev, subjects: newSubjects };
                                  });
                                }
                              }}
                              disabled={index === editFormData.subjects.length - 1}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: index === editFormData.subjects.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                                opacity: index === editFormData.subjects.length - 1 ? 0.3 : 0.8,
                                cursor: index === editFormData.subjects.length - 1 ? 'not-allowed' : 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '4px',
                                transition: 'background 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                if (index < editFormData.subjects.length - 1) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'none';
                              }}
                              title="Move Down"
                            >
                              <ChevronDown size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {editError && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{editError}</div>}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setEditingTeacher(null)} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="modern-btn modern-btn--primary" disabled={isEditing} style={{ flex: 1 }}>
                {isEditing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Confirmation Modal */}
      {confirmConfig && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay" onClick={() => setConfirmConfig(null)}>
          <div className="modern-modal-content glass-panel" style={{ width: '100%', maxWidth: '450px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display">{confirmConfig.title}</h3>
              <button type="button" className="icon-btn-ghost" onClick={() => setConfirmConfig(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="modern-modal-body" style={{ color: 'var(--text-secondary)' }}>
              <p style={{ lineHeight: 1.6 }}>{confirmConfig.message}</p>
            </div>
            <div className="modern-modal-footer" style={{ justifyContent: confirmConfig.isAlert ? 'center' : 'flex-end', gap: '0.8rem', display: 'flex', marginTop: '1.5rem' }}>
              {!confirmConfig.isAlert && (
                <button type="button" className="modern-btn modern-btn--secondary" onClick={() => setConfirmConfig(null)}>Cancel</button>
              )}
              <button 
                type="button"
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
    </div>
  );
}
