import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import SkeletonLoader from '../components/SkeletonLoader';
import { getOrdinalSuffix } from '../utils/formatUtils';
import { UsersRound, BookOpen, Layers, ChevronRight, Search, Mail, Award } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import UserHoverCard from '../components/UserHoverCard';
import { resolveMediaUrl } from '../utils/mediaUtils';
import './Registry.css';

export default function Registry() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // States for student
  const [myCourses, setMyCourses] = useState([]);
  const [myBatchNumber, setMyBatchNumber] = useState(null);
  const [myEnrollments, setMyEnrollments] = useState([]);

  // States for admin/teacher
  const [allCourses, setAllCourses] = useState([]);
  const [courseBatches, setCourseBatches] = useState([]);

  // Shared state
  const [selectedCourse, setSelectedCourse] = useState(() => {
    return sessionStorage.getItem('registry_selected_course') || null;
  });
  const [selectedBatch, setSelectedBatch] = useState(() => {
    const val = sessionStorage.getItem('registry_selected_batch');
    if (!val) return null;
    try { return JSON.parse(val); } catch { return val; }
  });
  const [selectedBatchId, setSelectedBatchId] = useState(() => {
    const val = sessionStorage.getItem('registry_selected_batch_id');
    return val ? parseInt(val, 10) : null;
  });
  const [batchmates, setBatchmates] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Master Search for admin/teacher
  const [masterSearchQuery, setMasterSearchQuery] = useState('');
  const [masterSearchResults, setMasterSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (selectedCourse) {
      sessionStorage.setItem('registry_selected_course', selectedCourse);
    } else {
      sessionStorage.removeItem('registry_selected_course');
    }
  }, [selectedCourse]);

  useEffect(() => {
    if (selectedBatch) {
      sessionStorage.setItem('registry_selected_batch', typeof selectedBatch === 'object' ? JSON.stringify(selectedBatch) : selectedBatch);
    } else {
      sessionStorage.removeItem('registry_selected_batch');
    }
  }, [selectedBatch]);

  useEffect(() => {
    if (selectedBatchId) {
      sessionStorage.setItem('registry_selected_batch_id', String(selectedBatchId));
    } else {
      sessionStorage.removeItem('registry_selected_batch_id');
    }
  }, [selectedBatchId]);

  const isStudent = currentUser?.role === 'student';

  // Debounced Master Search
  useEffect(() => {
    if (isStudent) return;
    
    if (!masterSearchQuery.trim()) {
      setMasterSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/registry/search?q=${encodeURIComponent(masterSearchQuery.trim())}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (res.ok) {
          setMasterSearchResults(data.batchmates || []);
        }
      } catch (err) {
        console.error('Master search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [masterSearchQuery, isStudent]);

  useEffect(() => {
    if (location.state?.reset) {
      if (!isStudent) {
        setSelectedCourse(null);
        setSelectedBatch(null);
        setSelectedBatchId(null);
        sessionStorage.removeItem('registry_selected_course');
        sessionStorage.removeItem('registry_selected_batch');
        sessionStorage.removeItem('registry_selected_batch_id');
      }
      setSearchQuery('');
      setMasterSearchQuery('');
      
      if (isStudent) {
        if (myEnrollments && myEnrollments.length === 1) {
          const only = myEnrollments[0];
          setSelectedCourse(only.course_name);
          setSelectedBatch(only.batch_name || only.batch_number);
          setSelectedBatchId(only.batch_id || null);
        } else {
          setSelectedCourse(null);
          setSelectedBatch(null);
          setSelectedBatchId(null);
          sessionStorage.removeItem('registry_selected_course');
          sessionStorage.removeItem('registry_selected_batch');
          sessionStorage.removeItem('registry_selected_batch_id');
        }
      }
    }
  }, [location.state?.reset, isStudent, myCourses, myBatchNumber, myEnrollments]);


  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        if (isStudent) {
          const res = await fetch('/api/registry/my-courses', {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

          setMyCourses(data.courses || []);
          setMyBatchNumber(data.batch_number);
          const enrollments = data.enrollments || [];
          setMyEnrollments(enrollments);

          // Auto-select if only 1 enrollment and none selected yet
          if (enrollments.length === 1 && !selectedCourse && !selectedBatch && !selectedBatchId) {
            const only = enrollments[0];
            setSelectedCourse(only.course_name);
            setSelectedBatch(only.batch_name || only.batch_number);
            setSelectedBatchId(only.batch_id || null);
          }
        } else {
          const res = await fetch('/api/registry/courses', {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          setAllCourses(data.courses || []);
        }
        // Fetch teachers is no longer needed here as it's moved to InstructorDirectory.jsx
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [isStudent]);

  // Fetch batches when a course is selected (admin/teacher)
  useEffect(() => {
    if (isStudent) return;
    if (!selectedCourse) {
      setCourseBatches([]);
      return;
    }

    const fetchBatches = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/registry/batches?course_name=${encodeURIComponent(selectedCourse)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setCourseBatches(data.batch_list || data.batches || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchBatches();
  }, [selectedCourse, isStudent]);

  // Fetch batchmates when course and batch are selected
  useEffect(() => {
    if (!selectedCourse || (!selectedBatch && !selectedBatchId)) {
      setBatchmates([]);
      return;
    }

    const fetchStudents = async () => {
      setLoading(true);
      try {
        let url = `/api/registry/batchmates?course_name=${encodeURIComponent(selectedCourse)}`;
        if (selectedBatch) {
          const bNum = typeof selectedBatch === 'object' ? (selectedBatch.batch_number || '') : selectedBatch;
          url += `&batch_number=${encodeURIComponent(bNum)}`;
        }
        if (selectedBatchId) {
          url += `&batch_id=${selectedBatchId}`;
        }
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBatchmates(data.batchmates || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStudents();
  }, [selectedCourse, selectedBatch, selectedBatchId]);

  // Filter batchmates
  const filteredBatchmates = batchmates.filter(s => {
    const sName = (s.full_name || s.first_name + ' ' + s.last_name).toLowerCase();
    const query = searchQuery.toLowerCase();
    return sName.includes(query);
  });

  // Handle browser back button via hash
  useEffect(() => {
    const handleHashChange = () => {
      if (!window.location.hash) {
        if (!isStudent) {
          setSelectedCourse(null);
          setSelectedBatch(null);
          setSelectedBatchId(null);
        } else if (myEnrollments.length > 1 || myCourses.length > 1) {
          setSelectedCourse(null);
          setSelectedBatch(null);
          setSelectedBatchId(null);
        }
      } else if (window.location.hash === '#course') {
        setSelectedBatch(null);
        setSelectedBatchId(null);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [isStudent, myCourses, myEnrollments]);

  const goBackToCourses = () => {
    window.location.hash = '';
    setSelectedCourse(null);
    setSelectedBatch(null);
    setSelectedBatchId(null);
    setSearchQuery('');
  };

  const goBackToBatches = () => {
    window.location.hash = 'course';
    setSelectedBatch(null);
    setSelectedBatchId(null);
    setSearchQuery('');
  };

  const handleStartChat = (student) => {
    navigate('/inbox', { state: { selectedUser: student } });
  };

  return (
    <div className="page-container container registry-page">
      <div className="registry-header" style={{ marginBottom: '2rem' }}>
        <div className="registry-header-content">
          <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
            {isStudent ? 'My Batchmates' : 'Academic Records & Registry'}
          </h1>
          <p className="subtitle">
            {isStudent
              ? 'Connect and collaborate with your peers.'
              : 'Browse students by course and batch, or use the master search below.'}
          </p>
        </div>
      </div>

      {/* Master Search Bar for Admin/Teacher */}
      {!isStudent && (
        <div style={{ marginBottom: '2rem' }}>
          <div className="registry-search-bar glass-panel" style={{ maxWidth: '100%' }}>
            <Search size={18} />
            <input
              type="text"
              placeholder="Master Search: Find students by name, email, or batch..."
              value={masterSearchQuery}
              onChange={(e) => {
                setMasterSearchQuery(e.target.value);
                // Clear selected views when starting a global search
                if (e.target.value.trim() !== '') {
                  setSelectedCourse(null);
                  setSelectedBatch(null);
                  setSelectedBatchId(null);
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="registry-content">
        {loading && !selectedCourse && !selectedBatch ? (
          <div className="registry-loader"><SkeletonLoader variant="list" count={4} /></div>
        ) : error ? (
          <div className="registry-error glass-panel">{error}</div>
        ) : (
          <>
            {/* Breadcrumb Navigation */}
            {(selectedCourse || selectedBatch || selectedBatchId) && (
              <div className="registry-breadcrumb glass-panel">
                <span className="breadcrumb-item" onClick={goBackToCourses}>Courses</span>
                {selectedCourse && (
                  <>
                    <ChevronRight size={16} />
                    <span className={`breadcrumb-item ${(!selectedBatch && !selectedBatchId) ? 'active' : ''}`} onClick={goBackToBatches}>
                      {selectedCourse}
                    </span>
                  </>
                )}
                {(selectedBatch || selectedBatchId) && (
                  <>
                    <ChevronRight size={16} />
                    <span className="breadcrumb-item active">
                      {typeof selectedBatch === 'string'
                        ? selectedBatch
                        : (selectedBatch?.batch_name || (selectedBatch?.batch_number ? `${getOrdinalSuffix(selectedBatch.batch_number)} Batch` : 'Batch'))}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* View 1: List of Courses */}
            {!selectedCourse && !masterSearchQuery.trim() && (
              <div className="registry-grid courses-grid">
                {isStudent ? (
                  myEnrollments.map((enr, idx) => {
                    const batchLabel = enr.batch_name || (enr.batch_number ? `Batch ${enr.batch_number}` : 'Batch');
                    return (
                      <div
                        key={enr.enrollment_id || enr.batch_id || idx}
                        className="registry-card glass-panel dashboard-highlight-outline"
                        data-testid={`enrollment-card-${enr.batch_id || idx}`}
                        data-batch-id={enr.batch_id}
                        data-batch-name={batchLabel}
                        onClick={() => {
                          setSelectedCourse(enr.course_name);
                          setSelectedBatch(batchLabel);
                          setSelectedBatchId(enr.batch_id || null);
                          window.location.hash = 'students';
                        }}
                      >
                        <div className="card-icon"><BookOpen size={24} /></div>
                        <div className="card-details">
                          <h3>{enr.course_name}</h3>
                          <p style={{ marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                            <span style={{ 
                              display: 'inline-block', 
                              padding: '2px 8px', 
                              borderRadius: '4px', 
                              fontSize: '0.8rem', 
                              fontWeight: 600,
                              background: 'rgba(235, 178, 47, 0.15)', 
                              color: 'var(--primary-color, #ebb22f)' 
                            }}>
                              {batchLabel}
                            </span>
                          </p>
                        </div>
                        <div className="card-chevron-wrapper">
                          <ChevronRight size={20} className="card-chevron" />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  allCourses.map((course, idx) => (
                    <div key={idx} className="registry-card glass-panel dashboard-highlight-outline" onClick={() => {
                      setSelectedCourse(course);
                      window.location.hash = 'course';
                    }}>
                      <div className="card-icon"><BookOpen size={24} /></div>
                      <div className="card-details">
                        <h3>{course}</h3>
                        <p>View enrolled students</p>
                      </div>
                      <div className="card-chevron-wrapper">
                        <ChevronRight size={20} className="card-chevron" />
                      </div>
                    </div>
                  ))
                )}
                {((isStudent ? myEnrollments : allCourses).length === 0) && (
                  <div className="empty-state glass-panel">
                    <p>No courses found.</p>
                  </div>
                )}
              </div>
            )}

            {/* View 2: List of Batches (Admin/Teacher only) */}
            {selectedCourse && !selectedBatch && !selectedBatchId && !isStudent && !masterSearchQuery.trim() && (
              <div className="registry-grid batches-grid">
                {courseBatches.map((batchItem, idx) => {
                  const bId = typeof batchItem === 'object' ? batchItem.id : null;
                  const bNumber = typeof batchItem === 'object' ? batchItem.batch_number : batchItem;
                  const bName = typeof batchItem === 'object' ? (batchItem.batch_name || `${bNumber} Batch`) : `${getOrdinalSuffix(batchItem)} Batch`;

                  return (
                    <div
                      key={bId || idx}
                      className="registry-card glass-panel dashboard-highlight-outline"
                      data-testid={`batch-card-${bId || idx}`}
                      data-batch-id={bId}
                      onClick={() => {
                        setSelectedBatch(bName);
                        setSelectedBatchId(bId);
                        window.location.hash = 'batch';
                      }}
                    >
                      <div className="card-icon"><Layers size={24} /></div>
                      <div className="card-details">
                        <h3>{bName}</h3>
                        <p>{bId ? `Defined Batch #${bId}` : 'Legacy Batch'}</p>
                      </div>
                      <div className="card-chevron-wrapper">
                        <ChevronRight size={20} className="card-chevron" />
                      </div>
                    </div>
                  );
                })}
                {courseBatches.length === 0 && !loading && (
                  <div className="empty-state glass-panel">
                    <p>No batches found for this course.</p>
                  </div>
                )}
              </div>
            )}

            {/* View 3: List of Students / Master Search Results */}
            {((selectedCourse && (selectedBatch || selectedBatchId)) || masterSearchQuery.trim()) && (
              <div className="students-view">
                <div className="students-toolbar">
                  {masterSearchQuery.trim() ? (
                    <div className="students-count glass-panel">
                      <UsersRound size={18} />
                      <span>{masterSearchResults.length} Results Found</span>
                    </div>
                  ) : (
                    <>
                      <div className="registry-search-bar glass-panel">
                        <Search size={18} />
                        <input
                          type="text"
                          placeholder="Search by name..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                      <div className="students-count glass-panel">
                        <UsersRound size={18} />
                        <span>{filteredBatchmates.length} Student{filteredBatchmates.length !== 1 ? 's' : ''}</span>
                      </div>
                    </>
                  )}
                </div>

                {loading || isSearching ? (
                  <div className="registry-loader"><SkeletonLoader variant="grid" count={6} /></div>
                ) : (masterSearchQuery.trim() ? masterSearchResults : filteredBatchmates).length > 0 ? (
                  <div className="students-grid">
                    {(masterSearchQuery.trim() ? masterSearchResults : filteredBatchmates).map(student => (
                      <div key={student.id} className="student-card glass-panel dashboard-highlight-outline">
                          <div className="student-avatar-wrapper" onClick={() => navigate(`/profile/${student.id}`)}>
                            <img 
                              src={student.profile_picture ? resolveMediaUrl(student.profile_picture) : `${import.meta.env.BASE_URL}avatars/male1.png`} 
                              alt={student.full_name || student.first_name} 
                              className="student-avatar"
                            />
                          </div>
                          <h3 className="student-name" onClick={() => navigate(`/profile/${student.id}`)}>
                            {student.full_name || `${student.first_name} ${student.last_name}`}
                          </h3>
                        <div className="student-meta">
                          <span className="batch-badge">
                            <Layers size={12} style={{ marginRight: '4px' }} />
                            {getOrdinalSuffix(student.batch_number)} Batch
                          </span>
                        </div>
                        <p className="student-bio">
                          {student.bio || student.profession || "New filmmaker exploring the world of cinema."}
                        </p>
                        <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={(e) => {
                          e.stopPropagation();
                          handleStartChat(student);
                        }}>
                          <Mail size={14} /> Message
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state glass-panel">
                    <UsersRound size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                    <p>No students found.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
