import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Award, Film, BookOpen, Download, CheckCircle, CalendarCheck, FileText, AlertCircle } from 'lucide-react';
import { io } from 'socket.io-client';

export default function StudentPortal() {
  const { currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const currentUserRef = React.useRef(currentUser?.id);

  useEffect(() => {
    currentUserRef.current = currentUser?.id;
  }, [currentUser]);

  // Get Online Filmmaking Course enrollment for academic data
  const filmmakingEnrollment = profile?.enrollments?.find(c => c.course_name === 'Online Filmmaking Course');
  
  // Calculate attendance percentage
  const attendanceTotal = filmmakingEnrollment?.attendance_total || 22;
  const attendanceClasses = filmmakingEnrollment?.attendance_classes || 0;
  const currentAttendance = attendanceTotal > 0 ? Math.round((attendanceClasses / attendanceTotal) * 100) : 0;
  
  // Extract exam data
  const examData = {
    examScore: filmmakingEnrollment?.exam_written || 0,
    assignments: {
      screenplay: filmmakingEnrollment?.assignment_screenplay || 0,
      shootingScript: filmmakingEnrollment?.assignment_shooting_script || 0
    },
    date: '12 May 2026' // Keeping static date for now unless DB has it
  };

  useEffect(() => {
    fetchProfile();
    
    // Real-time progression listener instead of polling
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const token = localStorage.getItem('token');
    const socket = io(socketUrl, { auth: { token }, transports: ['websocket', 'polling'] });
    
    socket.on('progression_updated', (payload) => {
      const currentId = currentUserRef.current;
      if (payload.bulk || String(payload.studentId) === String(currentId)) {
        fetchProfile();
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/student/profile', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading...</h2></div>;

  if (profile?.role !== 'student') {
    return <div className="page-container container"><h2 className="text-secondary">Access Denied</h2></div>;
  }

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Live Course Progression Tracker */}
      <section className="academic-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Award size={20} className="text-accent" /> Live Course Progression
          </h3>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {profile?.enrollments && profile.enrollments.map(course => (
            <div key={course.id} style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, color: 'var(--text-secondary)' }}>
                  {course.course_type === 'filmmaking' ? <Film size={18} /> : <BookOpen size={18} />}
                  {course.course_name}
                </h4>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  {course.step4_completed === 1 ? (
                    <NavLink to="/certificates" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                      <Download size={14} /> Download Certificate
                    </NavLink>
                  ) : (
                    <button disabled className="btn" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 1rem', opacity: 0.6, cursor: 'not-allowed', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
                      <Download size={14} /> Download Certificate
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {course.course_type === 'filmmaking' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step1_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step1_completed ? '#34d399' : 'transparent', border: course.step1_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step1_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 1: Enrolled</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step2_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step2_completed ? '#34d399' : 'transparent', border: course.step2_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step2_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 1: Passed Exam</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step3_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step3_completed ? '#34d399' : 'transparent', border: course.step3_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step3_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 2: Enrolled</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step4_completed ? '#34d399' : 'transparent', border: course.step4_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step4_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 2: Completed</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step1_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step1_completed ? '#34d399' : 'transparent', border: course.step1_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step1_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Admission Confirmed</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step4_completed ? '#34d399' : 'transparent', border: course.step4_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step4_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Course Completed</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          {(!profile?.enrollments || profile.enrollments.length === 0) && (
            <p className="text-muted" style={{ fontStyle: 'italic' }}>No active course enrollments found.</p>
          )}
        </div>
      </section>

      {/* Attendance & Exam Results */}
      <div id="detailed-records" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
        
        {/* Attendance Section */}
        <section className="academic-card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>Phase 1</div>
              <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CalendarCheck size={20} className="text-accent" /> Attendance
              </h3>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '1.5rem 0 0 0' }}>
            {/* Circular Progress Ring */}
            <div style={{ position: 'relative', width: '140px', height: '140px' }}>
              <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                <path className="academic-progress-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={currentAttendance >= 80 ? '#34d399' : '#ef4444'} strokeWidth="3" strokeDasharray={`${currentAttendance}, 100`} strokeLinecap="round" />
              </svg>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', fontWeight: 'bold', color: currentAttendance >= 80 ? '#34d399' : '#ef4444' }}>
                {currentAttendance}%
              </div>
            </div>
            
            <div style={{ textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Institute rule: You need at least <strong style={{color: 'var(--text-primary)'}}>80% attendance</strong> to be eligible for exams.
            </div>

            {/* Attendance Breakdown Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', width: '100%', marginTop: '0.5rem' }}>
              <div className="academic-assignment-box" style={{ textAlign: 'center', padding: '0.8rem 0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Total Classes</div>
                <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '1.1rem' }}>{attendanceTotal}</div>
              </div>
              <div className="academic-assignment-box" style={{ textAlign: 'center', padding: '0.8rem 0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Attended</div>
                <div style={{ fontWeight: 'bold', color: '#34d399', fontSize: '1.1rem' }}>{attendanceClasses}</div>
              </div>
              <div className="academic-assignment-box" style={{ textAlign: 'center', padding: '0.8rem 0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Missed</div>
                <div style={{ fontWeight: 'bold', color: '#ef4444', fontSize: '1.1rem' }}>{Math.max(0, attendanceTotal - attendanceClasses)}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Exam Results Section */}
        <section className="academic-card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>Phase 1</div>
              <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={20} className="text-accent" /> Exam Results
              </h3>
            </div>
          </div>
          
          {currentAttendance >= 80 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* Total Score Styled like a major section */}
              <div className="academic-inner-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Total Score</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div style={{ fontWeight: 'bold', color: (examData.examScore + examData.assignments.screenplay + examData.assignments.shootingScript >= 33) ? '#34d399' : '#ef4444', fontSize: '1.2rem' }}>
                      {examData.examScore + examData.assignments.screenplay + examData.assignments.shootingScript} <span className="text-muted" style={{ fontSize: '0.9rem', fontWeight: 'normal' }}>/ 100</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem', fontWeight: '500' }}>Passed mark: 33</div>
                  </div>
                </div>
                <div className="academic-progress-track">
                  <div style={{ width: `${((examData.examScore + examData.assignments.screenplay + examData.assignments.shootingScript) / 100) * 100}%`, height: '100%', background: (examData.examScore + examData.assignments.screenplay + examData.assignments.shootingScript >= 33) ? '#34d399' : '#ef4444', borderRadius: '4px' }}></div>
                </div>
              </div>

              {/* Written Exam */}
              <div className="academic-inner-section">
                <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)' }}>Written Exam</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
                  <div className="academic-assignment-box">
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Final Written Exam</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '1.3rem' }}>{examData.examScore}</span>
                      <span className="text-muted" style={{ fontSize: '0.9rem' }}>/ 80</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Assignments */}
              <div className="academic-inner-section">
                <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)' }}>Assignments</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
                  
                  <div className="academic-assignment-box">
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Screenplay</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '1.3rem' }}>{examData.assignments.screenplay}</span>
                      <span className="text-muted" style={{ fontSize: '0.9rem' }}>/ 10</span>
                    </div>
                  </div>
                  
                  <div className="academic-assignment-box">
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Shooting Script</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '1.3rem' }}>{examData.assignments.shootingScript}</span>
                      <span className="text-muted" style={{ fontSize: '0.9rem' }}>/ 10</span>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 0', textAlign: 'center', height: '100%' }}>
              <AlertCircle size={48} color="#ef4444" style={{ marginBottom: '1rem', opacity: 0.8 }} />
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#ef4444' }}>Not Eligible for Exams</h4>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                Your attendance is below the required 80%. You cannot attend or view exams until your attendance improves.
              </p>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
