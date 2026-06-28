import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, BookOpen, Settings, AlertCircle, CheckCircle, Edit2, Check, X, DollarSign, Wallet, ChevronUp, ChevronDown, Search, GripVertical, UploadCloud } from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import BatchFeeManager from './BatchFeeManager';
import FeeTracker from './FeeTracker';
import BulkRegisteredStudentImport from '../../components/admin/BulkRegisteredStudentImport';
import LeadsTable from '../../components/admin/LeadsTable';
import { resolveMediaUrl } from '../../utils/mediaUtils';

export default function AdditionalOptions() {
  const { showConfirm } = useModal();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = searchParams.get('view') || 'dashboard';

  const setCurrentView = (view, options = {}) => {
    if (view === 'dashboard') {
      setSearchParams({}, options);
    } else {
      setSearchParams({ view }, options);
    }
  };

  const COURSE_TABS = [
    { label: 'Online Filmmaking Course', course: 'Online Filmmaking Course', hasPhases: true },
    { label: 'Film Appreciation Course', course: 'Film Appreciation Course', hasPhases: false },
    { label: 'Script Writing', course: 'Script Writing', hasPhases: false },
    { label: 'Cinematography', course: 'Cinematography', hasPhases: false },
    { label: 'Acting', course: 'Acting', hasPhases: false }
  ];

  const [activeTab, setActiveTab] = useState(COURSE_TABS[0]);
  const [selectedPhase, setSelectedPhase] = useState(1);
  const [customSubjects, setCustomSubjects] = useState([]);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingPartsCount, setEditingPartsCount] = useState(1);
  const [editingClassType, setEditingClassType] = useState('live');
  const [refreshLeads, setRefreshLeads] = useState(0);
  const [editingHasLiveQa, setEditingHasLiveQa] = useState(false);
  const [editingDuration, setEditingDuration] = useState('');
  const [editingPartDurations, setEditingPartDurations] = useState([]);
  const [newSubjectPartsCount, setNewSubjectPartsCount] = useState(1);
  const [newSubjectClassType, setNewSubjectClassType] = useState('live');
  const [newSubjectHasLiveQa, setNewSubjectHasLiveQa] = useState(false);
  const [newSubjectDuration, setNewSubjectDuration] = useState('');
  const [newSubjectPartDurations, setNewSubjectPartDurations] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [newSubjectTeacherId, setNewSubjectTeacherId] = useState('');
  const [editingTeacherId, setEditingTeacherId] = useState('');
  const [subjectSearchQuery, setSubjectSearchQuery] = useState('');

  const filteredCustomSubjects = customSubjects.filter(sub => 
    sub.course_name === activeTab.course &&
    (activeTab.hasPhases ? sub.phase === selectedPhase : true) &&
    sub.name.toLowerCase().includes(subjectSearchQuery.toLowerCase())
  );

  const [draggedIndex, setDraggedIndex] = useState(null);

  const updateSubjectsOrder = async (newFilteredList) => {
    const updatedAll = [...customSubjects];
    let filteredIdx = 0;
    const finalAll = updatedAll.map(sub => {
      const matchesFilter = sub.course_name === activeTab.course &&
        (activeTab.hasPhases ? sub.phase === selectedPhase : true);
      
      if (matchesFilter && filteredIdx < newFilteredList.length) {
        return newFilteredList[filteredIdx++];
      }
      return sub;
    });

    setCustomSubjects(finalAll);

    const orders = finalAll.map((sub, idx) => ({ id: sub.id, sort_order: idx }));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/custom-subjects/reorder', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ orders })
      });
      if (!response.ok) {
        throw new Error('Failed to save subjects order');
      }
    } catch (error) {
      console.error('Error saving custom subjects order:', error);
      setErrorMsg('Failed to save subjects lineup order.');
    }
  };

  const handleDragStart = (e, index) => {
    if (subjectSearchQuery.trim() !== '') return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    if (subjectSearchQuery.trim() !== '') return;

    const newFiltered = [...filteredCustomSubjects];
    const [draggedItem] = newFiltered.splice(draggedIndex, 1);
    newFiltered.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    updateSubjectsOrder(newFiltered);
  };

  const moveSubjectUp = (index) => {
    if (index === 0) return;
    const newFiltered = [...filteredCustomSubjects];
    const [moved] = newFiltered.splice(index, 1);
    newFiltered.splice(index - 1, 0, moved);
    updateSubjectsOrder(newFiltered);
  };

  const moveSubjectDown = (index) => {
    if (index === filteredCustomSubjects.length - 1) return;
    const newFiltered = [...filteredCustomSubjects];
    const [moved] = newFiltered.splice(index, 1);
    newFiltered.splice(index + 1, 0, moved);
    updateSubjectsOrder(newFiltered);
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

  useEffect(() => {
    fetchCustomSubjects();
    fetchTeachers();
  }, []);

  const handleAddSubject = async (e) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;

    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/custom-subjects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          name: newSubjectName,
          course_name: activeTab.course,
          phase: activeTab.hasPhases ? selectedPhase : null,
          parts_count: newSubjectPartsCount,
          class_type: newSubjectClassType,
          has_live_qa: newSubjectHasLiveQa,
          duration_minutes: newSubjectClassType === 'recorded' && newSubjectPartsCount === 1 ? (newSubjectDuration || null) : null,
          part_durations: newSubjectClassType === 'recorded' && newSubjectPartsCount > 1 ? newSubjectPartDurations.slice(0, newSubjectPartsCount) : null,
          teacher_id: newSubjectTeacherId || null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subject');
      }

      setSuccessMsg(`Subject "${newSubjectName}" created successfully.`);
      setNewSubjectName('');
      setNewSubjectPartsCount(1);
      setNewSubjectClassType('live');
      setNewSubjectHasLiveQa(false);
      setNewSubjectDuration('');
      setNewSubjectPartDurations([]);
      setNewSubjectTeacherId('');
      fetchCustomSubjects();
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditSubject = async (e, id) => {
    e.preventDefault();
    if (!editingName.trim()) return;

    setErrorMsg('');
    setSuccessMsg('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/custom-subjects/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          name: editingName, 
          parts_count: editingPartsCount, 
          class_type: editingClassType, 
          has_live_qa: editingHasLiveQa, 
          duration_minutes: editingClassType === 'recorded' && editingPartsCount === 1 ? (editingDuration || null) : null,
          part_durations: editingClassType === 'recorded' && editingPartsCount > 1 ? editingPartDurations.slice(0, editingPartsCount) : null,
          teacher_id: editingTeacherId || null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update subject');
      }

      setSuccessMsg(`Subject updated successfully.`);
      setEditingId(null);
      setEditingName('');
      setEditingTeacherId('');
      fetchCustomSubjects();
    } catch (error) {
      setErrorMsg(error.message);
    }
  };

  const handleDeleteSubject = async (id, name) => {
    const confirmed = await showConfirm(`Are you sure you want to delete the subject "${name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/custom-subjects/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        setSuccessMsg(`Subject "${name}" deleted.`);
        fetchCustomSubjects();
      } else {
        const data = await response.json();
        setErrorMsg(data.error || 'Failed to delete subject');
      }
    } catch {
      setErrorMsg('Failed to delete subject.');
    }
  };

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Additional Options</h1>
        <p className="subtitle">Configure settings and manage additional classroom tools.</p>
      </div>

      {currentView === 'dashboard' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
          <button
            onClick={() => setCurrentView('subjects')}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              padding: '2rem',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              position: 'relative',
              overflow: 'hidden',
              color: 'inherit'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              background: 'rgba(225, 29, 72, 0.1)',
              color: 'var(--accent-primary)',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Plus size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
                Create Custom Subject
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Manage default and custom classroom subjects, edit names, and delete subjects from the catalog.
              </p>
            </div>
          </button>

          <button
            onClick={() => setCurrentView('batch-fees')}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              padding: '2rem',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              position: 'relative',
              overflow: 'hidden',
              color: 'inherit'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              background: 'rgba(225, 29, 72, 0.1)',
              color: 'var(--accent-primary)',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <DollarSign size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
                Batch Fee Manager
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Define course fees per batch — used as the default when student fees are not manually set.
              </p>
            </div>
          </button>

          <button
            onClick={() => setCurrentView('fee-tracker')}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              padding: '2rem',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              position: 'relative',
              overflow: 'hidden',
              color: 'inherit'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              background: 'rgba(225, 29, 72, 0.1)',
              color: 'var(--accent-primary)',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Wallet size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
                Fee Tracker
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Monitor student payments, send reminders, and track outstanding fees.
              </p>
            </div>
          </button>

          <button
            onClick={() => setCurrentView('bulk-register')}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              padding: '2rem',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              position: 'relative',
              overflow: 'hidden',
              color: 'inherit'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              background: 'rgba(14, 165, 233, 0.1)',
              color: 'var(--accent-primary)',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <UploadCloud size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
                Bulk Import Registrations
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Smartly upload unregistered students to keep track of leads and prospects without batching them immediately.
              </p>
            </div>
          </button>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '16px', minHeight: '600px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={() => {
                setCurrentView('dashboard', { replace: true });
                setErrorMsg('');
                setSuccessMsg('');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.95rem',
                padding: '0.5rem 0.8rem',
                borderRadius: '8px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.background = 'none';
              }}
            >
              &larr; Back
            </button>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
              {currentView === 'custom-subjects' ? 'Custom Subjects' :
               currentView === 'settings' ? 'Global Settings' : 
               currentView === 'certificates' ? 'Certificate Generator' :
               currentView === 'bulk-register' ? 'Bulk Import Registrations' : 'Option'}
            </h2>
          </div>
          
          <div style={{ flex: 1, position: 'relative' }}>
            {currentView === 'custom-subjects' && (
            <>
              {/* Course Tabs Selector */}
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '0.5rem', 
                marginBottom: '1.5rem', 
                padding: '0.4rem', 
                background: 'rgba(255,255,255,0.01)', 
                borderRadius: '12px', 
                border: '1px solid rgba(255,255,255,0.05)' 
              }}>
                {COURSE_TABS.map((tab, idx) => {
                  const isActive = activeTab.course === tab.course;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab);
                        setSuccessMsg('');
                        setErrorMsg('');
                      }}
                      className={`subject-tab ${isActive ? 'active' : ''}`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Sub-selector for Phases if course has phases */}
              {activeTab.hasPhases && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center',
                  gap: '0.6rem', 
                  marginBottom: '2rem',
                  paddingLeft: '0.5rem'
                }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Phase:</span>
                  {[1, 2].map((p) => {
                    const isPhaseActive = selectedPhase === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setSelectedPhase(p);
                          setSuccessMsg('');
                          setErrorMsg('');
                        }}
                        className={`subject-tab ${isPhaseActive ? 'active' : ''}`}
                        style={{
                          padding: '0.4rem 1rem',
                          fontSize: '0.8rem',
                          borderRadius: '6px'
                        }}
                      >
                        Phase {p}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="subjects-layout-grid">
              {/* Left column: Add custom subject form */}
              <div>
                <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', color: 'var(--text-primary)' }}>
                    <Plus className="text-accent" size={20} style={{ flexShrink: 0 }} /> Create Custom Subject
                  </h2>

                  <form onSubmit={handleAddSubject} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>
                        Subject Name
                      </label>
                      <input
                        type="text"
                        value={newSubjectName}
                        onChange={(e) => setNewSubjectName(e.target.value)}
                        placeholder="e.g. Screenwriting Masterclass"
                        className="input-glass"
                        required
                        style={{ width: '100%', paddingLeft: '1rem' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>
                        Number of Parts
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={newSubjectPartsCount}
                        onChange={(e) => setNewSubjectPartsCount(parseInt(e.target.value) || 1)}
                        className="input-glass"
                        required
                        style={{ width: '100%', paddingLeft: '1rem' }}
                      />
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        Define how many daily/session parts this subject has (e.g. 3 parts).
                      </p>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>
                        Class Type
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {['live', 'recorded'].map(type => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setNewSubjectClassType(type)}
                            style={{
                              flex: 1,
                              padding: '0.5rem',
                              borderRadius: '8px',
                              border: newSubjectClassType === type
                                ? (type === 'live' ? '1px solid #22c55e' : '1px solid #a78bfa')
                                : '1px solid rgba(255,255,255,0.1)',
                              background: newSubjectClassType === type
                                ? (type === 'live' ? 'rgba(34,197,94,0.15)' : 'rgba(167,139,250,0.15)')
                                : 'rgba(255,255,255,0.03)',
                              color: newSubjectClassType === type
                                ? (type === 'live' ? '#22c55e' : '#a78bfa')
                                : 'var(--text-secondary)',
                              cursor: 'pointer',
                              fontWeight: 600,
                              fontSize: '0.85rem',
                              textTransform: 'capitalize',
                              transition: 'all 0.2s'
                            }}
                          >
                            {type === 'live' ? '🔴 Live' : '🎬 Recorded'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>
                        Assigned Teacher (Optional)
                      </label>
                      <TeacherSearchSelect
                        teachers={teachers}
                        selectedId={newSubjectTeacherId}
                        onChange={setNewSubjectTeacherId}
                        placeholder="Search or select teacher..."
                      />
                    </div>

                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', padding: '0.6rem 0.8rem', borderRadius: '8px', border: newSubjectHasLiveQa ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.08)', background: newSubjectHasLiveQa ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.02)', transition: 'all 0.2s' }}>
                        <input
                          type="checkbox"
                          checked={newSubjectHasLiveQa}
                          onChange={(e) => setNewSubjectHasLiveQa(e.target.checked)}
                          style={{ width: '16px', height: '16px', accentColor: '#fbbf24', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.85rem', color: newSubjectHasLiveQa ? '#fbbf24' : 'var(--text-secondary)', fontWeight: 500 }}>
                          💬 Has Live Q&amp;A Session
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          After class
                        </span>
                      </label>
                    </div>

                    {newSubjectClassType === 'recorded' && (
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 500 }}>
                          ⏱ Class Duration
                        </label>
                        {newSubjectPartsCount <= 1 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                              type="number"
                              min="1"
                              max="600"
                              value={newSubjectDuration}
                              onChange={(e) => setNewSubjectDuration(e.target.value)}
                              placeholder="e.g. 90"
                              className="input-glass"
                              style={{ flex: 1, paddingLeft: '1rem' }}
                            />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>minutes</span>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.5rem' }}>
                            {Array.from({ length: newSubjectPartsCount }, (_, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>P{i + 1}:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="600"
                                  value={newSubjectPartDurations[i] || ''}
                                  onChange={(e) => {
                                    const updated = [...newSubjectPartDurations];
                                    updated[i] = e.target.value;
                                    setNewSubjectPartDurations(updated);
                                  }}
                                  placeholder="min"
                                  className="input-glass"
                                  style={{ width: '100%', minWidth: '40px', padding: '0.3rem 0.5rem', textAlign: 'center' }}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {errorMsg && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', fontSize: '0.85rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
                        <AlertCircle size={16} />
                        <span>{errorMsg}</span>
                      </div>
                    )}

                    {successMsg && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-primary)', fontSize: '0.85rem', background: 'rgba(56, 189, 248, 0.1)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
                        <CheckCircle size={16} />
                        <span>{successMsg}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      className="modern-btn modern-btn--primary"
                      disabled={isLoading}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      {isLoading ? 'Creating...' : 'Create Subject'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Right column: Subject lists */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Classroom Subjects List */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                  <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', color: 'var(--text-primary)' }}>
                    <Settings className="text-accent" size={20} style={{ flexShrink: 0 }} /> Classroom Subjects
                  </h2>

                  {customSubjects.length > 0 && (
                    <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
                      <Search 
                        size={18} 
                        style={{ 
                          position: 'absolute', 
                          left: '12px', 
                          top: '50%', 
                          transform: 'translateY(-50%)', 
                          color: 'var(--text-muted)' 
                        }} 
                      />
                      <input
                        type="text"
                        placeholder="Search subjects..."
                        value={subjectSearchQuery}
                        onChange={(e) => setSubjectSearchQuery(e.target.value)}
                        className="input-glass"
                        style={{ 
                          width: '100%', 
                          paddingLeft: '2.5rem', 
                          paddingRight: '1rem',
                          height: '42px',
                          fontSize: '0.9rem'
                        }}
                      />
                    </div>
                  )}

                  {customSubjects.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                      No subjects created yet. Use the panel on the left to add one.
                    </p>
                  ) : filteredCustomSubjects.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                      No subjects match your search.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                      {filteredCustomSubjects.map((subject, idx) => {
                        const isEditing = editingId === subject.id;
                        const isSearchEmpty = subjectSearchQuery.trim() === '';
                        return (
                          <div
                            key={subject.id}
                            draggable={isSearchEmpty}
                            onDragStart={(e) => handleDragStart(e, idx)}
                            onDragOver={(e) => handleDragOver(e, idx)}
                            onDragEnd={() => setDraggedIndex(null)}
                            onDragEnter={(e) => e.preventDefault()}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.8rem 1.2rem',
                              background: 'rgba(255,255,255,0.02)',
                              borderRadius: '8px',
                              border: '1px solid rgba(255,255,255,0.05)',
                              transition: 'all 0.2s',
                              opacity: draggedIndex === idx ? 0.4 : 1,
                              cursor: isSearchEmpty ? 'grab' : 'default',
                              userSelect: 'none'
                            }}
                          >
                            {isEditing ? (
                              <form
                                onSubmit={(e) => handleEditSubject(e, subject.id)}
                                style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', flexWrap: 'wrap' }}>
                                  <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    className="input-glass"
                                    required
                                    style={{ flex: 1, minWidth: '150px', padding: '0.4rem 0.8rem', height: '36px' }}
                                    autoFocus
                                  />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Parts:</span>
                                    <input
                                      type="number"
                                      min="1"
                                      max="20"
                                      value={editingPartsCount}
                                      onChange={(e) => setEditingPartsCount(parseInt(e.target.value) || 1)}
                                      className="input-glass"
                                      style={{ width: '50px', padding: '0.4rem 0.3rem', height: '36px', textAlign: 'center' }}
                                    />
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                                    {['live', 'recorded'].map(type => (
                                      <button
                                        key={type}
                                        type="button"
                                        onClick={() => setEditingClassType(type)}
                                        style={{
                                          padding: '4px 10px',
                                          borderRadius: '8px',
                                          border: editingClassType === type
                                            ? (type === 'live' ? '1px solid #22c55e' : '1px solid #a78bfa')
                                            : '1px solid rgba(255,255,255,0.08)',
                                          background: editingClassType === type
                                            ? (type === 'live' ? 'rgba(34,197,94,0.15)' : 'rgba(167,139,250,0.15)')
                                            : 'rgba(255,255,255,0.03)',
                                          color: editingClassType === type
                                            ? (type === 'live' ? '#22c55e' : '#a78bfa')
                                            : 'var(--text-muted)',
                                          cursor: 'pointer',
                                          fontSize: '0.75rem',
                                          fontWeight: 600,
                                          height: '36px',
                                          transition: 'all 0.2s'
                                        }}
                                      >
                                        {type === 'live' ? '🔴 Live' : '🎬 Recorded'}
                                      </button>
                                    ))}
                                  </div>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '8px', border: editingHasLiveQa ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.08)', background: editingHasLiveQa ? 'rgba(251,191,36,0.1)' : 'transparent', height: '36px', transition: 'all 0.2s' }}>
                                    <input
                                      type="checkbox"
                                      checked={editingHasLiveQa}
                                      onChange={(e) => setEditingHasLiveQa(e.target.checked)}
                                      style={{ width: '14px', height: '14px', accentColor: '#fbbf24', cursor: 'pointer' }}
                                    />
                                  </label>
                                  <div style={{ minWidth: '160px', flex: 1 }}>
                                    <TeacherSearchSelect
                                      teachers={teachers}
                                      selectedId={editingTeacherId}
                                      onChange={setEditingTeacherId}
                                      placeholder="Select teacher..."
                                    />
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
                                    <button
                                      type="submit"
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--accent-primary)',
                                        cursor: 'pointer',
                                        padding: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '4px',
                                        transition: 'all 0.2s'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'none';
                                      }}
                                      title="Save changes"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingId(null);
                                        setEditingName('');
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        padding: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '4px',
                                        transition: 'all 0.2s'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'none';
                                      }}
                                      title="Cancel"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                </div>

                                {editingClassType === 'recorded' && (
                                  <div style={{ 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    gap: '0.5rem', 
                                    marginTop: '0.2rem',
                                    padding: '0.6rem 0.8rem', 
                                    background: 'rgba(255,255,255,0.015)', 
                                    borderRadius: '8px', 
                                    border: '1px solid rgba(255,255,255,0.04)' 
                                  }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                      ⏱ Define durations for each part:
                                    </span>
                                    {editingPartsCount <= 1 ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                          type="number"
                                          min="1"
                                          max="600"
                                          value={editingDuration}
                                          onChange={(e) => setEditingDuration(e.target.value)}
                                          placeholder="e.g. 90"
                                          className="input-glass"
                                          style={{ width: '100px', padding: '0.4rem 0.8rem', height: '36px' }}
                                        />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>minutes</span>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.5rem' }}>
                                        {Array.from({ length: editingPartsCount }, (_, i) => (
                                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>Part {i + 1}:</span>
                                            <input
                                              type="number"
                                              min="1"
                                              max="600"
                                              value={editingPartDurations[i] || ''}
                                              onChange={(e) => {
                                                const updated = [...editingPartDurations];
                                                updated[i] = e.target.value;
                                                setEditingPartDurations(updated);
                                              }}
                                              placeholder="min"
                                              className="input-glass"
                                              style={{ width: '100%', minWidth: '45px', padding: '0.3rem 0.5rem', height: '32px', textAlign: 'center', fontSize: '0.8rem' }}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </form>
                            ) : (
                              <>
                                <span style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                  {isSearchEmpty && (
                                    <>
                                      <GripVertical size={16} style={{ color: 'var(--text-muted)', cursor: 'grab', opacity: 0.5 }} />
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>#{idx + 1}</span>
                                    </>
                                  )}
                                  <span>{subject.name}</span>
                                  {subject.parts_count > 1 && (
                                    <span style={{ 
                                      fontSize: '0.75rem', 
                                      background: 'rgba(225, 29, 72, 0.15)', 
                                      color: 'var(--accent-primary)', 
                                      padding: '2px 8px', 
                                      borderRadius: '12px', 
                                      fontWeight: 500,
                                      display: 'inline-flex',
                                      alignItems: 'center'
                                    }}>
                                      {subject.parts_count} parts
                                    </span>
                                  )}
                                  <span style={{
                                    fontSize: '0.72rem',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    background: subject.class_type === 'recorded' ? 'rgba(167,139,250,0.15)' : 'rgba(34,197,94,0.15)',
                                    color: subject.class_type === 'recorded' ? '#a78bfa' : '#22c55e',
                                    border: subject.class_type === 'recorded' ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(34,197,94,0.3)'
                                  }}>
                                    {subject.class_type === 'recorded' ? '🎬 Recorded' : '🔴 Live'}
                                  </span>
                                  {subject.has_live_qa ? (
                                    <span style={{
                                      fontSize: '0.72rem',
                                      padding: '2px 8px',
                                      borderRadius: '12px',
                                      fontWeight: 600,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      background: 'rgba(251,191,36,0.12)',
                                      color: '#fbbf24',
                                      border: '1px solid rgba(251,191,36,0.3)'
                                    }}>
                                      💬 Live Q&amp;A
                                    </span>
                                  ) : null}
                                      {subject.class_type === 'recorded' && subject.duration_minutes ? (
                                        <span style={{
                                          fontSize: '0.72rem',
                                          padding: '2px 8px',
                                          borderRadius: '12px',
                                          fontWeight: 600,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                          background: 'rgba(99,102,241,0.12)',
                                          color: '#818cf8',
                                          border: '1px solid rgba(99,102,241,0.3)'
                                        }}>
                                          {subject.part_durations && subject.parts_count > 1
                                            ? (() => {
                                                try {
                                                  const parts = JSON.parse(subject.part_durations);
                                                  return <>⏱ {parts.map((d, i) => d ? `P${i+1}:${d}m` : null).filter(Boolean).join(' | ')}</>;
                                                } catch { return <>⏱ {subject.duration_minutes}m total</>; }
                                              })()
                                            : <>⏱ {subject.duration_minutes}m</>
                                          }
                                        </span>
                                      ) : null}
                                      {subject.teacher_name ? (
                                        <span style={{
                                          fontSize: '0.72rem',
                                          padding: '2px 8px',
                                          paddingLeft: subject.teacher_avatar ? '2px' : '8px',
                                          borderRadius: '12px',
                                          fontWeight: 600,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          background: 'rgba(56, 189, 248, 0.12)',
                                          color: '#38bdf8',
                                          border: '1px solid rgba(56, 189, 248, 0.3)'
                                        }}>
                                          {subject.teacher_avatar ? (
                                            <img 
                                              src={resolveMediaUrl(subject.teacher_avatar)} 
                                              alt={subject.teacher_name} 
                                              style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} 
                                              onError={(e) => {
                                                e.target.style.display = 'none';
                                                e.target.nextSibling.style.display = 'inline-block';
                                              }}
                                            />
                                          ) : null}
                                          <span style={{ display: subject.teacher_avatar ? 'none' : 'inline-block', fontSize: '1.2rem' }}>👨‍🏫</span>
                                          <span style={{ paddingRight: '4px' }}>{subject.teacher_name}</span>
                                        </span>
                                      ) : null}
                                    </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  {isSearchEmpty && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', marginRight: '0.3rem' }}>
                                      <button
                                        type="button"
                                        onClick={() => moveSubjectUp(idx)}
                                        disabled={idx === 0}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          color: idx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                                          opacity: idx === 0 ? 0.3 : 0.8,
                                          cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                          padding: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          borderRadius: '4px',
                                          transition: 'background 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                          if (idx > 0) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
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
                                        onClick={() => moveSubjectDown(idx)}
                                        disabled={idx === filteredCustomSubjects.length - 1}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          color: idx === filteredCustomSubjects.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                                          opacity: idx === filteredCustomSubjects.length - 1 ? 0.3 : 0.8,
                                          cursor: idx === filteredCustomSubjects.length - 1 ? 'not-allowed' : 'pointer',
                                          padding: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          borderRadius: '4px',
                                          transition: 'background 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                          if (idx < filteredCustomSubjects.length - 1) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = 'none';
                                        }}
                                        title="Move Down"
                                      >
                                        <ChevronDown size={16} />
                                      </button>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(subject.id);
                                      setEditingName(subject.name);
                                      setEditingPartsCount(subject.parts_count || 1);
                                      setEditingClassType(subject.class_type || 'live');
                                      setEditingHasLiveQa(!!subject.has_live_qa);
                                      setEditingDuration(subject.duration_minutes ? String(subject.duration_minutes) : '');
                                      setEditingTeacherId(subject.teacher_id || '');
                                      try {
                                        setEditingPartDurations(subject.part_durations ? JSON.parse(subject.part_durations).map(String) : []);
                                      } catch { setEditingPartDurations([]); }
                                    }}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--text-secondary)',
                                      cursor: 'pointer',
                                      padding: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      borderRadius: '4px',
                                      transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = 'var(--accent-primary)';
                                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = 'var(--text-secondary)';
                                      e.currentTarget.style.background = 'none';
                                    }}
                                    title="Rename subject"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSubject(subject.id, subject.name)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--text-secondary)',
                                      cursor: 'pointer',
                                      padding: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      borderRadius: '4px',
                                      transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = 'var(--danger)';
                                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = 'var(--text-secondary)';
                                      e.currentTarget.style.background = 'none';
                                    }}
                                    title="Delete subject"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            </>
          )}

          {currentView === 'bulk-register' && (
              <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column' }}>
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                  <BulkRegisteredStudentImport onImportComplete={() => setRefreshLeads(prev => prev + 1)} />
                  <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Upload Excel or CSV spreadsheet</p>
                </div>

                {/* ── Custom SMS Panel ──────────────────────────────────── */}
                <CustomSmsSender />

                <LeadsTable refreshTrigger={refreshLeads} />
              </div>
            )}

          {currentView === 'batch-fees' && (
            <BatchFeeManager />
          )}

          {currentView === 'fee-tracker' && (
            <FeeTracker />
          )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Custom SMS Sender Panel ──────────────────────────────────────────────────
// Standalone panel that lets admin send SMS to any phone numbers they type in.
function CustomSmsSender() {
  const [expanded,    setExpanded]    = useState(false);
  const [numbers,     setNumbers]     = useState('');
  const [message,     setMessage]     = useState('');
  const [senderId,    setSenderId]    = useState('8809617626169');
  const [sending,     setSending]     = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [results,     setResults]     = useState(null);
  const [error,       setError]       = useState('');
  const taRef = useRef(null);

  const SMS_LIMIT = 160;
  const len       = message.length;
  const parts     = len === 0 ? 1 : Math.ceil(len / SMS_LIMIT);
  const remaining = (parts * SMS_LIMIT) - len;

  // Parse the raw textarea into {name, phone} pairs
  // Supports: one per line, comma-separated, "Name: 017xxxx", "017xxxx - Name"
  const parseNumbers = (raw) => {
    const lines = raw.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      // Try "Name: 01xxx" or "01xxx - Name" or plain number
      const colonMatch = line.match(/^(.+?):\s*([\d\s+]+)$/);
      const dashMatch  = line.match(/^([\d\s+]+)\s*[-–]\s*(.+)$/);
      if (colonMatch) return { name: colonMatch[1].trim(), phone: colonMatch[2].replace(/\s/g,'') };
      if (dashMatch)  return { name: dashMatch[2].trim(),  phone: dashMatch[1].replace(/\s/g,'') };
      return { name: '', phone: line.replace(/\s/g,'') };
    }).filter(r => r.phone.length >= 7);
  };

  const parsed     = parseNumbers(numbers);
  const validCount = parsed.length;

  const insertTag = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    setMessage(message.slice(0, s) + '{name}' + message.slice(e));
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + 6; ta.focus(); }, 0);
  };

  const handleSend = async () => {
    if (!numbers.trim()) { setError('Please enter at least one phone number.'); return; }
    if (!message.trim()) { setError('Please enter a message.'); return; }
    if (validCount === 0) { setError('No valid phone numbers found.'); return; }
    setError(''); setSending(true); setProgress(0); setResults(null);

    try {
      let fake = 0;
      const ticker = setInterval(() => {
        fake = Math.min(fake + (100 / validCount) * 0.5, 88);
        setProgress(Math.round(fake));
      }, Math.max(60, (validCount * 70) / 20));

      const res = await fetch('/api/admin/sms/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ recipients: parsed, message: message.trim(), senderId: senderId.trim() })
      });
      clearInterval(ticker);
      setProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setResults(data);
    } catch(err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setSending(false);
    }
  };

  const reset = () => { setResults(null); setProgress(0); setError(''); };

  return (
    <div style={{
      marginBottom: '1.5rem',
      border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: '14px',
      overflow: 'hidden',
      background: 'rgba(99,102,241,0.04)'
    }}>
      {/* ── Header / Toggle ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-primary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: '9px', padding: '0.45rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {/* inline SMS icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Send Custom SMS</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Type any phone numbers &amp; send SMS directly
            </div>
          </div>
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* ── Body ────────────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ height: '1px', background: 'rgba(99,102,241,0.15)', marginBottom: '0.25rem' }} />

          {/* Phone numbers input */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Phone Numbers
              </label>
              {validCount > 0 && (
                <span style={{
                  background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                  borderRadius: '20px', padding: '0.15rem 0.65rem',
                  fontSize: '0.75rem', fontWeight: 700
                }}>
                  {validCount} valid number{validCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <textarea
              className="input-glass"
              value={numbers}
              onChange={e => setNumbers(e.target.value)}
              placeholder={"Enter numbers (one per line or comma-separated):\n01712345678\n01812345679, 01912345670\n\nWith names:\nRahim: 01712345678\n01812345679 - Karim"}
              rows={5}
              disabled={sending}
              style={{ width: '100%', resize: 'vertical', padding: '0.85rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.6, borderRadius: '10px', boxSizing: 'border-box' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Tip: Use <code style={{ background: 'rgba(99,102,241,0.1)', borderRadius: '4px', padding: '0.1rem 0.35rem', color: '#818cf8' }}>Name: 017xxx</code> format to personalize messages with <code style={{ background: 'rgba(99,102,241,0.1)', borderRadius: '4px', padding: '0.1rem 0.35rem', color: '#818cf8' }}>{'{name}'}</code>
            </p>
          </div>

          {/* Sender ID */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Sender ID <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(max 15 chars)</span>
            </label>
            <input
              type="text"
              className="input-glass"
              value={senderId}
              maxLength={15}
              onChange={e => setSenderId(e.target.value.replace(/\s/g, ''))}
              placeholder="e.g. 8809617626169"
              disabled={sending}
              style={{ paddingLeft: '1rem', fontFamily: 'monospace', letterSpacing: '0.05em', maxWidth: '220px' }}
            />
          </div>

          {/* Message */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Message</label>
              <button
                type="button"
                onClick={insertTag}
                disabled={sending}
                style={{
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                  color: '#818cf8', borderRadius: '6px', padding: '0.25rem 0.7rem',
                  fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600, fontFamily: 'monospace'
                }}
              >
                + Insert {'{name}'}
              </button>
            </div>
            <textarea
              ref={taRef}
              className="input-glass"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={'Type your SMS message... Use {name} to personalize per recipient.'}
              rows={4}
              disabled={sending}
              style={{ width: '100%', resize: 'vertical', padding: '0.85rem 1rem', fontFamily: 'inherit', lineHeight: 1.6, borderRadius: '10px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.3rem', fontSize: '0.75rem', color: remaining < 20 ? '#f59e0b' : 'var(--text-muted)' }}>
              {parts > 1 && <span style={{ marginRight: '0.5rem', color: parts > 5 ? '#ef4444' : '#f59e0b' }}>⚠ {parts} SMS parts ·&nbsp;</span>}
              {remaining} chars remaining · {len} total
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '0.75rem 1rem', color: '#f87171', fontSize: '0.85rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}>
              ⚠ {error}
            </div>
          )}

          {/* Progress */}
          {(sending || progress > 0) && !results && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                <span>{sending ? `Sending to ${validCount} number${validCount !== 1 ? 's' : ''}…` : 'Done!'}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.07)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', borderRadius: '9999px', transition: 'width 0.3s ease' }} />
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: results.failed > 0 ? '0.75rem' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '0.5rem 0.9rem', color: '#10b981', fontWeight: 700, fontSize: '0.9rem' }}>
                  ✅ {results.sent} Sent
                </div>
                {results.failed > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '0.5rem 0.9rem', color: '#f87171', fontWeight: 700, fontSize: '0.9rem' }}>
                    ❌ {results.failed} Failed
                  </div>
                )}
              </div>
              {results.failed > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '10px', padding: '0.75rem', maxHeight: '140px', overflowY: 'auto' }}>
                  {results.results.filter(r => !r.ok).map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.25rem 0', borderBottom: '1px solid rgba(239,68,68,0.1)' }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{r.phone}{r.name ? ` (${r.name})` : ''}</span>
                      <span style={{ color: '#f87171' }}>
                        {typeof r.error === 'object' ? (r.error.message || r.error.code || JSON.stringify(r.error)) : String(r.error || 'Failed')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.25rem' }}>
            {results ? (
              <button type="button" onClick={reset}
                style={{ flex: 1, padding: '0.75rem', border: '1px solid rgba(99,102,241,0.3)', background: 'transparent', color: '#818cf8', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}>
                Send Another
              </button>
            ) : (
              <>
                <button type="button" onClick={() => { setNumbers(''); setMessage(''); setError(''); setResults(null); setProgress(0); }}
                  disabled={sending}
                  style={{ padding: '0.75rem 1.25rem', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', cursor: 'pointer' }}>
                  Clear
                </button>
                <button type="button" onClick={handleSend}
                  disabled={sending || !message.trim() || validCount === 0}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    padding: '0.75rem', border: 'none', borderRadius: '10px', cursor: (sending || !message.trim() || validCount === 0) ? 'not-allowed' : 'pointer',
                    background: (sending || !message.trim() || validCount === 0) ? 'rgba(99,102,241,0.35)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: 'white', fontWeight: 700, fontSize: '0.95rem',
                    boxShadow: '0 4px 14px rgba(99,102,241,0.35)'
                  }}
                >
                  {sending
                    ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M21 12c0-4.97-4.03-9-9-9"/></svg> Sending…</>
                    : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send SMS to {validCount || '…'}</>
                  }
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Sleek, reusable custom searchable dropdown for selecting registered teachers
function TeacherSearchSelect({ teachers, selectedId, onChange, placeholder = "Search teachers..." }) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedTeacher = teachers.find(t => t.id === Number(selectedId));
  
  // Update search input when selected teacher changes
  useEffect(() => {
    if (selectedTeacher) {
      setSearch(selectedTeacher.full_name || `${selectedTeacher.first_name} ${selectedTeacher.last_name}`);
    } else {
      setSearch('');
    }
  }, [selectedId, selectedTeacher]);

  const filtered = teachers.filter(t => {
    const name = (t.full_name || `${t.first_name} ${t.last_name}`).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            if (!e.target.value) {
              onChange('');
            }
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="input-glass"
          style={{ width: '100%', paddingLeft: '1rem', paddingRight: '2.5rem', height: '38px', fontSize: '0.85rem' }}
        />
        {selectedId ? (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setSearch('');
              setIsOpen(false);
            }}
            style={{
              position: 'absolute',
              right: '10px',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px'
            }}
          >
            ✕
          </button>
        ) : (
          <span style={{ position: 'absolute', right: '12px', color: 'var(--text-muted)', pointerEvents: 'none', fontSize: '0.8rem' }}>
            🔍
          </span>
        )}
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--bg-secondary, #071221)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
          borderRadius: '8px',
          maxHeight: '200px',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          scrollbarWidth: 'thin'
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
              No teachers found
            </div>
          ) : (
            filtered.map(t => {
              const name = t.full_name || `${t.first_name} ${t.last_name}`;
              const isSelected = t.id === Number(selectedId);
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    onChange(t.id);
                    setSearch(name);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: '0.6rem 1rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                    background: isSelected ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
                    transition: 'background 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    textAlign: 'left'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {t.profile_picture ? (
                    <img 
                      src={resolveMediaUrl(t.profile_picture)} 
                      alt={name}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        flexShrink: 0,
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div style={{ display: t.profile_picture ? 'none' : 'flex', width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>
                    👨‍🏫
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    {t.email && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.email}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

