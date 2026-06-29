import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Award, Film, BookOpen, Download, CheckCircle, CalendarCheck, FileText, AlertCircle, Clapperboard, Scissors, BarChart2, Lock, XCircle } from 'lucide-react';
import { io } from 'socket.io-client';

const getStatusBadgeStyle = (status) => {
  switch (status) {
    case 'Paid Full':
      return { background: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)' };
    case 'Waived':
      return { background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)' };
    case 'Partial':
      return { background: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.25)' };
    case 'Pending':
      return { background: 'rgba(107, 114, 128, 0.15)', color: '#9ca3af', border: '1px solid rgba(107, 114, 128, 0.25)' };
    case 'Due':
      return { background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)' };
    default:
      return { background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', border: '1px solid rgba(255, 255, 255, 0.08)' };
  }
};

const getStatusLabel = (status) => {
  switch (status) {
    case 'Paid Full': return 'Paid Full';
    case 'Waived': return 'Waived / Free';
    case 'Partial': return 'Partial Payment';
    case 'Pending': return 'Pending';
    case 'Due': return 'Due / Unpaid';
    default: return status || 'Not Specified';
  }
};

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

  if (course.course_type === 'filmmaking') {
    return isUnpaid(feeDetails.phase1) || isUnpaid(feeDetails.phase2);
  } else {
    return isUnpaid(feeDetails);
  }
};

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

  // Get other course enrollment (courses that do not require attendance)
  const otherEnrollment = profile?.enrollments?.find(c => c.course_name !== 'Online Filmmaking Course');
  
  // Calculate attendance percentage (Filmmaking only)
  const attendanceTotal = filmmakingEnrollment?.attendance_total || 22;
  const attendanceClasses = filmmakingEnrollment?.attendance_classes || 0;
  const currentAttendance = attendanceTotal > 0 ? Math.round((attendanceClasses / attendanceTotal) * 100) : 0;
  
  // Extract exam data — Filmmaking
  const examData = {
    examScore: filmmakingEnrollment?.exam_written || 0,
    assignments: {
      screenplay: filmmakingEnrollment?.assignment_screenplay || 0,
      shootingScript: filmmakingEnrollment?.assignment_shooting_script || 0
    }
  };
  const filmmakingTotal = examData.examScore + examData.assignments.screenplay + examData.assignments.shootingScript;

  // Extract exam data — Other Courses
  const facExamData = {
    examScore: otherEnrollment?.exam_written || 0
  };

  // Phase 2 participation data (Filmmaking only)
  const phase2ShootingAttended = !!(filmmakingEnrollment?.phase2_shooting_attended);
  const phase2EditingAttended = !!(filmmakingEnrollment?.phase2_editing_attended);
  const isInPhase2 = !!(filmmakingEnrollment?.step3_completed);

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
                    hasPendingDueOrPartialPayment(course) ? (
                      <button disabled className="btn" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', padding: '0.5rem 1rem', opacity: 0.8, cursor: 'not-allowed', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)' }} title="Certificate locked due to pending, partial, or due fees.">
                        <Lock size={14} /> Certificate Locked
                      </button>
                    ) : (
                      <NavLink to="/certificates" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                        <Download size={14} /> Download Certificate
                      </NavLink>
                    )
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
                    {(() => {
                      const isGraded = course.exam_written !== null && course.exam_written !== undefined && course.exam_written !== '';
                      const totalScore = (parseInt(course.exam_written) || 0) + (parseInt(course.assignment_screenplay) || 0) + (parseInt(course.assignment_shooting_script) || 0);
                      const hasFailed = isGraded && course.step1_completed === 1 && course.step2_completed !== 1;
                      if (hasFailed) {
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: 1 }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <XCircle size={16} color="white" />
                            </div>
                            <div className="text-sm" style={{ color: '#ef4444' }}>Phase 1: Failed Exam (Score: {totalScore})</div>
                          </div>
                        );
                      }
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step2_completed ? 1 : 0.5 }}>
                          <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step2_completed ? '#34d399' : 'transparent', border: course.step2_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {course.step2_completed ? <CheckCircle size={16} color="black" /> : null}
                          </div>
                          <div className="text-sm">Phase 1: Passed Exam</div>
                        </div>
                      );
                    })()}
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
                    {(() => {
                      const isGraded = course.exam_written !== null && course.exam_written !== undefined && course.exam_written !== '';
                      const hasFailed = isGraded && course.step1_completed === 1 && course.step4_completed !== 1;
                      if (hasFailed) {
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: 1 }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <XCircle size={16} color="white" />
                            </div>
                            <div className="text-sm" style={{ color: '#ef4444' }}>Failed Exam (Score: {course.exam_written})</div>
                          </div>
                        );
                      }
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                          <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step4_completed ? '#34d399' : 'transparent', border: course.step4_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {course.step4_completed ? <CheckCircle size={16} color="black" /> : null}
                          </div>
                          <div className="text-sm">Course Completed</div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* Per-Course Fee and Payment Details Section */}
              {(() => {
                let feeDetails = {};
                if (course.fee_details) {
                  try {
                    feeDetails = typeof course.fee_details === 'string' 
                      ? JSON.parse(course.fee_details) 
                      : course.fee_details;
                  } catch (e) {
                    console.error('Error parsing course fee details:', e);
                  }
                }

                const isFilmmaking = course.course_type === 'filmmaking';

                const renderFeeRow = (title, data) => {
                  if (!data || (!data.full_fee && !data.amount_paid && !data.status && !data.discount)) {
                    return null;
                  }

                  const badgeStyle = getStatusBadgeStyle(data.status);
                  const fullFeeNum = parseFloat((data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
                  const amountPaidNum = parseFloat((data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
                  const discountNum = parseFloat((data.discount || '').replace(/[^\d.]/g, '')) || 0;
                  const rawRemainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);

                  const installments = data.installments || [];
                  const remainingDue = installments.length > 0
                    ? installments.filter(inst => (inst.status || '').toLowerCase() !== 'paid').reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0)
                    : rawRemainingDue;

                  const isFullySatisfied = fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum;
                  const allInstallmentsPaid = rawRemainingDue > 0 && 
                    installments.length > 0 && 
                    installments.every(inst => inst.status === 'Paid');
                  const isFullyCompleted = isFullySatisfied || allInstallmentsPaid || remainingDue === 0;

                  let completionMessage = '';
                  if (title) {
                    if (title.toLowerCase().includes('phase 1')) {
                      completionMessage = '1st Phase fee completed';
                    } else if (title.toLowerCase().includes('phase 2')) {
                      completionMessage = '2nd Phase fee completed';
                    } else {
                      completionMessage = `${title} fee completed`;
                    }
                  } else {
                    completionMessage = `${course.course_name} fee completed`;
                  }

                  return (
                    <div style={{ 
                      padding: '1rem', 
                      background: 'rgba(255,255,255,0.015)', 
                      borderRadius: '10px', 
                      border: '1px solid var(--glass-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {title || 'Fee Details'}
                        </span>
                        <span style={{ 
                          fontSize: '0.72rem', 
                          fontWeight: '600', 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '6px',
                          ...badgeStyle
                        }}>
                          {getStatusLabel(data.status)}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Course Fee:</span>
                          <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                            {fullFeeNum > 0 ? `${fullFeeNum.toLocaleString()} BDT` : '—'}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Amount Paid:</span>
                          <span style={{ fontWeight: '600', color: '#34d399' }}>
                            {amountPaidNum > 0 ? `${amountPaidNum.toLocaleString()} BDT` : '0 BDT'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                        {discountNum > 0 && (
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Discount:</span>
                            <span style={{ fontWeight: '600', color: '#10b981' }}>
                              -{discountNum.toLocaleString()} BDT
                            </span>
                          </div>
                        )}
                        {remainingDue > 0 && (
                          <div>
                            <span style={{ color: '#fbbf24', display: 'block', fontSize: '0.75rem' }}>Remaining Due:</span>
                            <span style={{ fontWeight: '700', color: '#fbbf24' }}>
                              {remainingDue.toLocaleString()} BDT
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Render Installment Schedule */}
                      {remainingDue > 0 && data.installments && data.installments.length > 0 && (
                        <div style={{ 
                          marginTop: '0.4rem', 
                          padding: '0.5rem 0.75rem', 
                          background: 'rgba(245, 158, 11, 0.01)', 
                          borderRadius: '6px', 
                          border: '1px dashed rgba(245, 158, 11, 0.2)' 
                        }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: '700', color: '#fbbf24', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>📅</span> Installment Schedule
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            {data.installments.map((inst, instIdx) => {
                              const instStatusStyle = inst.status === 'Paid'
                                ? { background: 'rgba(16, 185, 129, 0.12)', color: '#34d399' }
                                : { background: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24' };
                              return (
                                <div key={instIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>
                                    Installment {instIdx + 1}: <strong>{inst.amount ? `${parseFloat(inst.amount).toLocaleString()} BDT` : '—'}</strong>
                                  </span>
                                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    {inst.dueDate && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Due: {inst.dueDate}</span>}
                                    <span style={{ fontSize: '0.68rem', fontWeight: '600', padding: '0.05rem 0.35rem', borderRadius: '4px', ...instStatusStyle }}>
                                      {inst.status || 'Pending'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Fully Completed Banner */}
                      {isFullyCompleted && (
                        <div style={{
                          marginTop: '0.75rem',
                          padding: '0.6rem 0.75rem',
                          background: 'rgba(16, 185, 129, 0.06)',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          color: '#34d399',
                          fontSize: '0.78rem',
                          fontWeight: '600'
                        }}>
                          <span style={{ 
                            display: 'inline-block', 
                            width: '6px', 
                            height: '6px', 
                            borderRadius: '50%', 
                            background: '#34d399', 
                            boxShadow: '0 0 8px #34d399' 
                          }}></span>
                          {completionMessage}
                        </div>
                      )}
                    </div>
                  );
                };

                const hasFeeInfo = isFilmmaking 
                  ? (feeDetails.phase1?.full_fee || feeDetails.phase1?.amount_paid || feeDetails.phase1?.status || feeDetails.phase1?.discount || feeDetails.phase2?.full_fee || feeDetails.phase2?.amount_paid || feeDetails.phase2?.status || feeDetails.phase2?.discount)
                  : (feeDetails.full_fee || feeDetails.amount_paid || feeDetails.status || feeDetails.discount);

                if (!hasFeeInfo) return null;

                return (
                  <div style={{ 
                    marginTop: '1.25rem', 
                    paddingTop: '1.25rem', 
                    borderTop: '1px dashed var(--glass-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    <h5 style={{ margin: 0, fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>💰</span> Course Fee & Payment Details
                    </h5>
                    <div style={{ display: 'grid', gridTemplateColumns: isFilmmaking ? 'repeat(auto-fit, minmax(220px, 1fr))' : '1fr', gap: '0.75rem' }}>
                      {isFilmmaking ? (
                        <>
                          {renderFeeRow('Phase 1', feeDetails.phase1)}
                          {renderFeeRow('Phase 2', feeDetails.phase2)}
                        </>
                      ) : (
                        renderFeeRow(null, feeDetails)
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
          {(!profile?.enrollments || profile.enrollments.length === 0) && (
            <p className="text-muted" style={{ fontStyle: 'italic' }}>No active course enrollments found.</p>
          )}
        </div>
      </section>

      {/* ── Other Courses: Admission & Exam Results ── */}
      {otherEnrollment && (
        <section id="detailed-records" className="academic-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
          {/* Card header */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={20} className="text-accent" /> Admission &amp; Exam Results
            </h3>
          </div>

          {/* Congratulations banner if completed */}
          {otherEnrollment.step4_completed === 1 && (
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '1rem', background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%)', borderRadius: '12px', padding: '1.25rem', border: '1px solid rgba(52, 211, 153, 0.3)', marginBottom: '1.5rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(52, 211, 153, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Award size={26} color="#34d399" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 0.25rem 0', color: '#34d399', fontWeight: '700', fontSize: '1.05rem' }}>Course Completed Successfully!</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Congratulations! You have successfully completed all the requirements of the {otherEnrollment.course_name} at Bangladesh Film Institute. Your digital certificate is ready for download.
                </p>
              </div>
            </div>
          )}

          {/* Two-column layout with vertical divider */}
          <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', flexWrap: 'wrap' }}>
            
            {/* Left: Admission Status */}
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '0.5rem 2rem 0.5rem 0.5rem' }}>
              <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Award size={17} className="text-accent" /> {otherEnrollment.step1_completed ? 'Admission Confirmed' : 'Admission Pending'}
              </h4>

              {otherEnrollment.step1_completed ? (
                /* Green seal icon (Confirmed) */
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: 'rgba(52, 211, 153, 0.1)', border: '2px solid rgba(52, 211, 153, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CheckCircle size={44} color="#34d399" />
                  </div>

                  <div className="academic-inner-section" style={{ width: '100%' }}>
                    <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                      Your enrolment has been formally confirmed by Bangladesh Film Institute (BFI). You are now an officially registered student of the
                      {' '}<strong style={{ color: 'var(--text-primary)' }}>{otherEnrollment.course_name}</strong> and are authorised to participate in all scheduled academic activities.
                    </p>
                  </div>

                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(52, 211, 153, 0.06)', borderRadius: '8px', padding: '0.85rem 1rem', border: '1px solid rgba(52, 211, 153, 0.15)' }}>
                    <CheckCircle size={16} color="#34d399" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', color: '#34d399', fontWeight: '500' }}>Status: Officially Enrolled — Bangladesh Film Institute</span>
                  </div>
                </div>
              ) : (
                /* Amber alert icon (Pending) */
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.1)', border: '2px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertCircle size={44} color="#f59e0b" />
                  </div>

                  <div className="academic-inner-section" style={{ width: '100%' }}>
                    <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                      Your admission to the <strong style={{ color: 'var(--text-primary)' }}>{otherEnrollment.course_name}</strong> is currently being processed by Bangladesh Film Institute (BFI).
                      Once the administration confirms your registration, your status will be updated here.
                    </p>
                  </div>

                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(245, 158, 11, 0.06)', borderRadius: '8px', padding: '0.85rem 1rem', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
                    <AlertCircle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', color: '#f59e0b', fontWeight: '500' }}>Status: Pending Confirmation — Administration</span>
                  </div>
                </div>
              )}
            </div>

            {/* Vertical Divider */}
            <div style={{ width: '1px', background: 'var(--glass-border)', margin: '0 1rem', flexShrink: 0, alignSelf: 'stretch', minHeight: '1px' }} className="phase1-divider-v" />
            <div className="phase1-divider-h" style={{ display: 'none', height: '1px', background: 'var(--glass-border)', width: '100%', margin: '1.5rem 0' }} />

            {/* Right: Exam Results */}
            <div style={{ flex: '1 1 280px', padding: '0.5rem 0.5rem 0.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={17} className="text-accent" /> Exam Results
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Total Score */}
                <div className="academic-inner-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Total Score</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div style={{ fontWeight: 'bold', color: facExamData.examScore >= 33 ? '#34d399' : '#ef4444', fontSize: '1.2rem' }}>
                        {facExamData.examScore} <span className="text-muted" style={{ fontSize: '0.9rem', fontWeight: 'normal' }}>/ 100</span>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem', fontWeight: '500' }}>Passed mark: 33</div>
                    </div>
                  </div>
                  <div className="academic-progress-track">
                    <div style={{ width: `${(facExamData.examScore / 100) * 100}%`, height: '100%', background: facExamData.examScore >= 33 ? '#34d399' : '#ef4444', borderRadius: '4px' }}></div>
                  </div>
                </div>

                {/* Written Exam */}
                <div className="academic-inner-section">
                  <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)' }}>Written Exam</h4>
                  <div className="academic-assignment-box">
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Final Written Exam</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '1.3rem' }}>{facExamData.examScore}</span>
                      <span className="text-muted" style={{ fontSize: '0.9rem' }}>/ 100</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>
      )}

      {/* ── Online Filmmaking Course: Phase 1 Attendance & Exam Results ── */}
      {filmmakingEnrollment && (
        <section id="detailed-records" className="academic-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
          {/* Card header */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.4rem' }}>Phase 1</div>
            <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CalendarCheck size={20} className="text-accent" /> Attendance &amp; Exam Results
            </h3>
          </div>

          {/* Two-column layout with vertical divider */}
          <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', flexWrap: 'wrap' }}>
            
            {/* Left: Attendance */}
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '0.5rem 2rem 0.5rem 0.5rem' }}>
              <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', alignSelf: 'flex-start' }}>
                <BarChart2 size={17} className="text-accent" /> Attendance
              </h4>
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
                Institute rule: You need at least <strong style={{ color: 'var(--text-primary)' }}>80% attendance</strong> to be eligible for exams.
              </div>

              {/* Attendance Breakdown Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', width: '100%' }}>
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

            {/* Vertical Divider */}
            <div style={{ width: '1px', background: 'var(--glass-border)', margin: '0 1rem', flexShrink: 0, alignSelf: 'stretch', minHeight: '1px' }} className="phase1-divider-v" />
            <div className="phase1-divider-h" style={{ display: 'none', height: '1px', background: 'var(--glass-border)', width: '100%', margin: '1.5rem 0' }} />

            {/* Right: Exam Results */}
            <div style={{ flex: '1 1 280px', padding: '0.5rem 0.5rem 0.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={17} className="text-accent" /> Exam Results
              </h4>

              {currentAttendance >= 80 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Total Score */}
                  <div className="academic-inner-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Total Score</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <div style={{ fontWeight: 'bold', color: filmmakingTotal >= 33 ? '#34d399' : '#ef4444', fontSize: '1.2rem' }}>
                          {filmmakingTotal} <span className="text-muted" style={{ fontSize: '0.9rem', fontWeight: 'normal' }}>/ 100</span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem', fontWeight: '500' }}>Passed mark: 33</div>
                      </div>
                    </div>
                    <div className="academic-progress-track">
                      <div style={{ width: `${(filmmakingTotal / 100) * 100}%`, height: '100%', background: filmmakingTotal >= 33 ? '#34d399' : '#ef4444', borderRadius: '4px' }}></div>
                    </div>
                  </div>

                  {/* Written Exam */}
                  <div className="academic-inner-section">
                    <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)' }}>Written Exam</h4>
                    <div className="academic-assignment-box">
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Final Written Exam</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: '1.3rem' }}>{examData.examScore}</span>
                        <span className="text-muted" style={{ fontSize: '0.9rem' }}>/ 80</span>
                      </div>
                    </div>
                  </div>

                  {/* Assignments */}
                  <div className="academic-inner-section">
                    <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)' }}>Assignments</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 0', textAlign: 'center', flex: 1 }}>
                  <AlertCircle size={44} color="#ef4444" style={{ marginBottom: '1rem', opacity: 0.8 }} />
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#ef4444' }}>Not Eligible for Exams</h4>
                  <p className="text-muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                    Your attendance is below the required 80%. You cannot attend or view exams until your attendance improves.
                  </p>
                </div>
              )}
            </div>

          </div>
        </section>
      )}

      {/* Phase 2 Participation — only visible for Online Filmmaking Course students enrolled in Phase 2 */}
      {filmmakingEnrollment && isInPhase2 && (
        <section className="academic-card" style={{ padding: '2rem', marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>Phase 2</div>
              <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clapperboard size={20} style={{ color: '#8b5cf6' }} /> Course Participation
              </h3>
            </div>
            {/* Overall Phase 2 status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.9rem', borderRadius: '999px', background: filmmakingEnrollment.step4_completed ? 'rgba(16,185,129,0.12)' : 'rgba(139,92,246,0.1)', border: '1px solid', borderColor: filmmakingEnrollment.step4_completed ? 'rgba(16,185,129,0.35)' : 'rgba(139,92,246,0.25)' }}>
              {filmmakingEnrollment.step4_completed ? (
                <><CheckCircle size={14} style={{ color: '#10b981' }} /><span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#10b981' }}>Completed</span></>
              ) : (
                <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#8b5cf6' }}>In Progress</span>
              )}
            </div>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            To complete Phase 2, you must participate in both the <strong style={{ color: 'var(--text-primary)' }}>Shooting</strong> and <strong style={{ color: 'var(--text-primary)' }}>Editing</strong> parts of the course.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '125rem' }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            {/* Shooting Card */}
            <div style={{ padding: '1.25rem', borderRadius: '12px', background: phase2ShootingAttended ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.02)', border: '1px solid', borderColor: phase2ShootingAttended ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.2s' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: phase2ShootingAttended ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Clapperboard size={22} style={{ color: phase2ShootingAttended ? '#10b981' : 'var(--text-muted)' }} />
              </div>
              <div>
                <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '1rem', marginBottom: '0.2rem' }}>Shooting</div>
                <div style={{ fontSize: '0.8rem', fontWeight: '600', color: phase2ShootingAttended ? '#10b981' : 'var(--text-muted)' }}>
                  {phase2ShootingAttended ? '✓ Attended' : 'Not yet attended'}
                </div>
              </div>
            </div>

            {/* Editing Card */}
            <div style={{ padding: '1.25rem', borderRadius: '12px', background: phase2EditingAttended ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.02)', border: '1px solid', borderColor: phase2EditingAttended ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.2s' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: phase2EditingAttended ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Scissors size={22} style={{ color: phase2EditingAttended ? '#10b981' : 'var(--text-muted)' }} />
              </div>
              <div>
                <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '1rem', marginBottom: '0.2rem' }}>Editing</div>
                <div style={{ fontSize: '0.8rem', fontWeight: '600', color: phase2EditingAttended ? '#10b981' : 'var(--text-muted)' }}>
                  {phase2EditingAttended ? '✓ Attended' : 'Not yet attended'}
                </div>
              </div>
            </div>
          </div>

          {/* Progress hint */}
          {!filmmakingEnrollment.step4_completed && (
            <div style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {(!phase2ShootingAttended && !phase2EditingAttended) && 'Neither part has been attended yet. Attend both Shooting and Editing to complete Phase 2.'}
              {(phase2ShootingAttended && !phase2EditingAttended) && '🎬 Shooting attended! Complete the Editing part to finish Phase 2.'}
              {(!phase2ShootingAttended && phase2EditingAttended) && '✂️ Editing attended! Complete the Shooting part to finish Phase 2.'}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
