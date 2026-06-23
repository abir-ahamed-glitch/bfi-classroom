import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, BookOpen, Settings, AlertCircle, CheckCircle, Edit2, Check, X, DollarSign, Wallet, ChevronUp, ChevronDown, Search, GripVertical } from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import BatchFeeManager from './BatchFeeManager';
import FeeTracker from './FeeTracker';

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
  const [newSubjectPartsCount, setNewSubjectPartsCount] = useState(1);
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

  useEffect(() => {
    fetchCustomSubjects();
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
          parts_count: newSubjectPartsCount
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subject');
      }

      setSuccessMsg(`Subject "${newSubjectName}" created successfully.`);
      setNewSubjectName('');
      setNewSubjectPartsCount(1);
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
        body: JSON.stringify({ name: editingName, parts_count: editingPartsCount })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update subject');
      }

      setSuccessMsg(`Subject updated successfully.`);
      setEditingId(null);
      setEditingName('');
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
        </div>
      ) : (
        <>
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
              marginBottom: '1.5rem',
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
            &larr; Back to Additional Options
          </button>

          {currentView === 'subjects' && (
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
                  <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                    <Plus className="text-accent" size={20} /> Create Custom Subject
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
                  <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                    <Settings className="text-accent" size={20} /> Classroom Subjects
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
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}
                              >
                                <input
                                  type="text"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  className="input-glass"
                                  required
                                  style={{ flex: 2, padding: '0.4rem 0.8rem', height: '36px' }}
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

          {currentView === 'batch-fees' && (
            <BatchFeeManager />
          )}

          {currentView === 'fee-tracker' && (
            <FeeTracker />
          )}
        </>
      )}
    </div>
  );
}
