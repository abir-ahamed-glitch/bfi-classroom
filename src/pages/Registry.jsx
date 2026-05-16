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

  // States for admin/teacher
  const [allCourses, setAllCourses] = useState([]);
  const [courseBatches, setCourseBatches] = useState([]);

  // Shared state
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchmates, setBatchmates] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Master Search for admin/teacher
  const [masterSearchQuery, setMasterSearchQuery] = useState('');
  const [masterSearchResults, setMasterSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

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
      }
      setSearchQuery('');
      setMasterSearchQuery('');
      
      if (isStudent) {
        if (myCourses && myCourses.length === 1 && myBatchNumber) {
          setSelectedCourse(myCourses[0]);
          setSelectedBatch(myBatchNumber);
        } else {
          setSelectedCourse(null);
          setSelectedBatch(null);
        }
      }
    }
  }, [location.state?.reset, isStudent, myCourses, myBatchNumber]);


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

          // Auto-select if only 1 course
          if (data.courses && data.courses.length === 1 && data.batch_number) {
            setSelectedCourse(data.courses[0]);
            setSelectedBatch(data.batch_number);
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
        setCourseBatches(data.batches || []);
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
    if (!selectedCourse || !selectedBatch) {
      setBatchmates([]);
      return;
    }

    const fetchStudents = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/registry/batchmates?course_name=${encodeURIComponent(selectedCourse)}&batch_number=${encodeURIComponent(selectedBatch)}`, {
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
  }, [selectedCourse, selectedBatch]);

  // Filter batchmates
  const filteredBatchmates = batchmates.filter(s => {
    const sName = (s.full_name || s.first_name + ' ' + s.last_name).toLowerCase();
    const query = searchQuery.toLowerCase();
    return sName.includes(query);
  });

  const goBackToCourses = () => {
    setSelectedCourse(null);
    setSelectedBatch(null);
    setSearchQuery('');
  };

  const goBackToBatches = () => {
    setSelectedBatch(null);
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
            {!isStudent && (selectedCourse || selectedBatch) && (
              <div className="registry-breadcrumb glass-panel">
                <span className="breadcrumb-item" onClick={goBackToCourses}>Courses</span>
                {selectedCourse && (
                  <>
                    <ChevronRight size={16} />
                    <span className={`breadcrumb-item ${!selectedBatch ? 'active' : ''}`} onClick={goBackToBatches}>
                      {selectedCourse}
                    </span>
                  </>
                )}
                {selectedBatch && (
                  <>
                    <ChevronRight size={16} />
                    <span className="breadcrumb-item active">{getOrdinalSuffix(selectedBatch)} Batch</span>
                  </>
                )}
              </div>
            )}

            {/* View 1: List of Courses */}
            {!selectedCourse && !masterSearchQuery.trim() && (
              <div className="registry-grid courses-grid">
                {(isStudent ? myCourses : allCourses).map((course, idx) => (
                  <div key={idx} className="registry-card glass-panel" onClick={() => {
                    setSelectedCourse(course);
                    if (isStudent && myBatchNumber) {
                      setSelectedBatch(myBatchNumber);
                    }
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
                ))}
                {(isStudent ? myCourses : allCourses).length === 0 && (
                  <div className="empty-state glass-panel">
                    <p>No courses found.</p>
                  </div>
                )}
              </div>
            )}

            {/* View 2: List of Batches (Admin/Teacher only) */}
            {selectedCourse && !selectedBatch && !isStudent && !masterSearchQuery.trim() && (
              <div className="registry-grid batches-grid">
                {courseBatches.map((batch, idx) => (
                  <div key={idx} className="registry-card glass-panel" onClick={() => setSelectedBatch(batch)}>
                    <div className="card-icon"><Layers size={24} /></div>
                    <div className="card-details">
                      <h3>{getOrdinalSuffix(batch)} Batch</h3>
                      <p>View batch details</p>
                    </div>
                    <div className="card-chevron-wrapper">
                      <ChevronRight size={20} className="card-chevron" />
                    </div>
                  </div>
                ))}
                {courseBatches.length === 0 && !loading && (
                  <div className="empty-state glass-panel">
                    <p>No batches found for this course.</p>
                  </div>
                )}
              </div>
            )}

            {/* View 3: List of Students / Master Search Results */}
            {((selectedCourse && selectedBatch) || masterSearchQuery.trim()) && (
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
                      <div key={student.id} className="student-card glass-panel">
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
