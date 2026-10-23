import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, CheckCircle2, Clock, AlertTriangle, Lock, Award, 
  CheckSquare, Square, Save, RefreshCw, XCircle, Tag,
  UserCheck, UserX, CreditCard
} from 'lucide-react';

export default function DefinedCourseProgressModal({
  isOpen,
  onClose,
  student,
  enrollment,
  initialPhaseIndex = 0,
  onUpdated
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [progress, setProgress] = useState(null);
  const [activePhaseIndex, setActivePhaseIndex] = useState(initialPhaseIndex);

  // Reference to store original loaded values for strict dirty-checking
  const originalValuesRef = useRef({
    attendance: {},
    assignments: {},
    exams: {}
  });

  // Local editable state
  const [attendanceEdits, setAttendanceEdits] = useState({}); // classId -> boolean
  const [assignmentEdits, setAssignmentEdits] = useState({}); // assignmentId -> { marks, status, remarks }
  const [examEdits, setExamEdits] = useState({}); // phaseId -> marks string/number

  const studentId = student?.id || student?.user_id;
  const enrollmentId = enrollment?.id || enrollment?.enrollment_id;

  const fetchProgress = useCallback(async () => {
    if (!studentId || !enrollmentId) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const batchParam = enrollment?.batch_id ? `?batch_id=${enrollment.batch_id}` : '';
      const res = await fetch(`/api/admin/students/${studentId}/courses/${enrollmentId}/defined-progress${batchParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to load course progress');
      }
      const data = await res.json();
      const p = data.progress;
      setProgress(p);

      // Populate local edit state from authoritative response
      const initialAtt = {};
      const initialAsg = {};
      const initialExam = {};

      if (p && Array.isArray(p.phases)) {
        p.phases.forEach((phase) => {
          (phase.classes || []).forEach(cls => {
            initialAtt[cls.id] = !!cls.attended;
          });
          (phase.assignments || []).forEach(asg => {
            initialAsg[asg.id] = {
              marks: (asg.marksObtained !== null && asg.marksObtained !== undefined) ? String(asg.marksObtained) : '',
              status: asg.submissionStatus || 'pending',
              remarks: asg.remarks || ''
            };
          });
          if (phase.exam?.enabled) {
            initialExam[phase.id] = (phase.exam.marksObtained !== null && phase.exam.marksObtained !== undefined)
              ? String(phase.exam.marksObtained)
              : '';
          }
        });
      }

      originalValuesRef.current = {
        attendance: { ...initialAtt },
        assignments: JSON.parse(JSON.stringify(initialAsg)),
        exams: { ...initialExam }
      };

      setAttendanceEdits(initialAtt);
      setAssignmentEdits(initialAsg);
      setExamEdits(initialExam);
    } catch (err) {
      console.error('DefinedCourseProgressModal fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [studentId, enrollmentId, enrollment?.batch_id]);

  useEffect(() => {
    if (isOpen) {
      setActivePhaseIndex(initialPhaseIndex);
      setSuccessMsg(null);
      setError(null);
      fetchProgress();
    }
  }, [isOpen, initialPhaseIndex, fetchProgress]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const phases = progress?.phases || [];
  const currentPhase = phases[activePhaseIndex] || phases[0];
  const isGateLocked = currentPhase?.isLocked;
  const isUnadmitted = activePhaseIndex > 0 && !currentPhase?.isAdmitted;
  const isLocked = isGateLocked || isUnadmitted;
  const lockReason = currentPhase?.lockReason || (isUnadmitted ? `Student is pending admission to Phase ${currentPhase?.phaseNumber || activePhaseIndex + 1}. Click 'Admit to Phase ${currentPhase?.phaseNumber || activePhaseIndex + 1}' to unlock.` : null);

  const handleToggleAttendance = (classId) => {
    if (isLocked) return;
    setAttendanceEdits(prev => ({
      ...prev,
      [classId]: !prev[classId]
    }));
  };

  const handleAssignmentChange = (assignmentId, field, value) => {
    if (isLocked) return;
    setAssignmentEdits(prev => ({
      ...prev,
      [assignmentId]: {
        ...(prev[assignmentId] || {}),
        [field]: value
      }
    }));
  };

  const handleExamChange = (phaseId, value) => {
    if (isLocked) return;
    setExamEdits(prev => ({
      ...prev,
      [phaseId]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const token = localStorage.getItem('token');
      const batchParam = enrollment?.batch_id ? `?batch_id=${enrollment.batch_id}` : '';
      const orig = originalValuesRef.current;

      // Filter out classes/assignments/exams belonging to locked phases
      const lockedPhaseIds = new Set(
        (progress?.phases || []).filter(p => p.isLocked).map(p => p.id)
      );
      const lockedClassIds = new Set();
      const lockedAsgIds = new Set();
      (progress?.phases || []).filter(p => p.isLocked).forEach(p => {
        (p.classes || []).forEach(c => lockedClassIds.add(c.id));
        (p.assignments || []).forEach(a => lockedAsgIds.add(a.id));
      });

      // DIRTY ATTENDANCE ONLY: Only send classes actually changed by the administrator
      const attendancePayload = Object.entries(attendanceEdits)
        .filter(([class_id, attended]) => {
          if (lockedClassIds.has(class_id)) return false;
          return !!attended !== !!orig.attendance[class_id];
        })
        .map(([class_id, attended]) => ({
          class_id,
          attended: !!attended
        }));

      // DIRTY ASSIGNMENTS ONLY: Only send assignments where marks, status, or remarks changed.
      // Blank marks sends null to preserve distinction from intentional zero (0).
      const assignmentsPayload = Object.entries(assignmentEdits)
        .filter(([assignment_id, data]) => {
          if (lockedAsgIds.has(assignment_id)) return false;
          const initial = orig.assignments[assignment_id] || { marks: '', status: 'pending', remarks: '' };
          const marksChanged = String(data.marks ?? '') !== String(initial.marks ?? '');
          const statusChanged = (data.status || 'pending') !== (initial.status || 'pending');
          const remarksChanged = String(data.remarks ?? '') !== String(initial.remarks ?? '');
          return marksChanged || statusChanged || remarksChanged;
        })
        .map(([assignment_id, data]) => ({
          assignment_id,
          marks_obtained: (data.marks !== '' && data.marks !== null && data.marks !== undefined)
            ? Number(data.marks)
            : null,
          submission_status: data.status || 'pending',
          remarks: data.remarks || null
        }));

      // DIRTY EXAMS ONLY: Only send phases where exam marks actually changed.
      // Blank marks sends null to preserve distinction from intentional zero (0).
      const examMarksPayload = Object.entries(examEdits)
        .filter(([phase_id, marks]) => {
          if (lockedPhaseIds.has(phase_id)) return false;
          const initial = orig.exams[phase_id] ?? '';
          return String(marks ?? '') !== String(initial);
        })
        .map(([phase_id, marks]) => ({
          phase_id,
          marks: (marks !== '' && marks !== null && marks !== undefined) ? Number(marks) : null
        }));

      // If no fields were modified, do not send network request
      if (attendancePayload.length === 0 && assignmentsPayload.length === 0 && examMarksPayload.length === 0) {
        setSuccessMsg('No changes to save.');
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/admin/students/${studentId}/courses/${enrollmentId}/defined-progress${batchParam}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          attendance: attendancePayload,
          assignments: assignmentsPayload,
          exam_marks: examMarksPayload
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save progress changes');
      }

      setSuccessMsg('Progress updated successfully!');
      setProgress(json.progress);

      // Update originalValuesRef with the newly saved values
      const updatedAtt = { ...orig.attendance };
      attendancePayload.forEach(a => { updatedAtt[a.class_id] = a.attended; });
      const updatedAsg = { ...orig.assignments };
      assignmentsPayload.forEach(a => {
        updatedAsg[a.assignment_id] = {
          marks: a.marks_obtained !== null ? String(a.marks_obtained) : '',
          status: a.submission_status,
          remarks: a.remarks || ''
        };
      });
      const updatedExams = { ...orig.exams };
      examMarksPayload.forEach(e => {
        updatedExams[e.phase_id] = e.marks !== null ? String(e.marks) : '';
      });
      originalValuesRef.current = {
        attendance: updatedAtt,
        assignments: updatedAsg,
        exams: updatedExams
      };

      if (onUpdated) {
        onUpdated(json.progress);
      }
    } catch (err) {
      console.error('Error saving progress:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdmitPhase = async (phaseNumber) => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/students/${studentId}/courses/${enrollmentId}/phases/${phaseNumber}/admit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to admit to Phase ${phaseNumber}`);
      }
      setSuccessMsg(`Successfully admitted to Phase ${phaseNumber}`);
      await fetchProgress();
      if (onUpdated) onUpdated();
    } catch (err) {
      console.error('Error admitting phase:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUnadmitPhase = async (phaseNumber) => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/students/${studentId}/courses/${enrollmentId}/phases/${phaseNumber}/unadmit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to undo admission for Phase ${phaseNumber}`);
      }
      setSuccessMsg(`Successfully reversed admission for Phase ${phaseNumber}`);
      await fetchProgress();
      if (onUpdated) onUpdated();
    } catch (err) {
      console.error('Error undoing phase admission:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Compute live category statistics for current phase
  const computeLiveCategoryStats = () => {
    if (!currentPhase || !currentPhase.classes) return {};
    const stats = {};
    for (const cls of currentPhase.classes) {
      const cat = cls.category || 'theory';
      if (!stats[cat]) stats[cat] = { total: 0, attended: 0, mandatoryTotal: 0, mandatoryAttended: 0 };
      stats[cat].total++;
      const isAtt = !!attendanceEdits[cls.id];
      if (isAtt) stats[cat].attended++;
      if (cls.mandatory) {
        stats[cat].mandatoryTotal++;
        if (isAtt) stats[cat].mandatoryAttended++;
      }
    }
    return stats;
  };

  const liveCategoryStats = computeLiveCategoryStats();

  return createPortal(
    <div 
      className="modern-modal-overlay defined-progress-modal-overlay" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="defined-progress-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(0.75rem, env(safe-area-inset-top, 0px)) 0.75rem max(0.75rem, calc(68px + env(safe-area-inset-bottom, 0px)))'
      }}
    >
      <div 
        className="defined-course-progress-modal"
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-card, #1e293b)',
          color: 'var(--text-primary, #f8fafc)',
          borderRadius: '16px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          width: '100%',
          maxWidth: '780px',
          maxHeight: 'min(92vh, 100% - 1.5rem)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          background: 'var(--bg-card-header, rgba(255, 255, 255, 0.02))'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h2 id="defined-progress-modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary, #f8fafc)' }}>
                {student?.first_name || student?.firstName || 'Student'} {student?.last_name || student?.lastName || ''}
              </h2>
              {student?.roll_number && (
                <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-muted, #94a3b8)' }}>
                  Roll: {student.roll_number}
                </span>
              )}
            </div>
            <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)' }}>
              <span>{enrollment?.course_name || progress?.courseName || 'Defined Course'}</span>
              <span>•</span>
              <span>{progress?.phaseCount || phases.length}-Phase Curriculum</span>
              {progress?.certificateEligible ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981', fontWeight: 600 }}>
                  <Award size={14} /> Certificate Eligible
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f59e0b', fontWeight: 600 }}>
                  <Lock size={14} /> Certificate Locked
                </span>
              )}
            </div>
            {progress?.failedAnyPhase && progress?.reEnrollmentDiscount && (
              <div style={{ marginTop: '0.4rem', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '3px 10px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                <Tag size={13} />
                <span>Re-enrollment Discount Available: <strong>{progress.reEnrollmentDiscount.percent}% Off</strong></span>
              </div>
            )}
          </div>
          <button 
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #94a3b8)',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '44px',
              minHeight: '44px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Phase Navigation Tabs */}
        {phases.length > 0 && (
          <div style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            background: 'var(--bg-main, rgba(0, 0, 0, 0.15))',
            overflowX: 'auto',
            padding: '0 0.75rem'
          }}>
            {phases.map((p, idx) => {
              const isActive = idx === activePhaseIndex;
              const tabStatus = p.status || (p.isPassed ? 'passed' : p.isLocked ? 'locked' : 'in_progress');
              return (
                <button
                  key={p.id || idx}
                  type="button"
                  onClick={() => setActivePhaseIndex(idx)}
                  style={{
                    padding: '0.75rem 1.25rem',
                    border: 'none',
                    borderBottom: isActive ? '3px solid #6366f1' : '3px solid transparent',
                    background: 'none',
                    color: isActive ? '#f8fafc' : 'var(--text-muted, #94a3b8)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    whiteSpace: 'nowrap',
                    minHeight: '44px'
                  }}
                >
                  <span>Phase {p.phaseNumber || idx + 1}: {p.title || `Phase ${idx + 1}`}</span>
                  {tabStatus === 'passed' && <CheckCircle2 size={14} color="#10b981" />}
                  {tabStatus === 'locked' && <Lock size={14} color="#f59e0b" />}
                  {tabStatus === 'failed' && <XCircle size={14} color="#ef4444" />}
                  {tabStatus === 'in_progress' && <Clock size={14} color="#60a5fa" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Modal Body / Scroll Area */}
        <div style={{
          padding: '1.25rem 1.5rem',
          overflowY: 'auto',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem'
        }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
              <RefreshCw className="animate-spin" size={28} style={{ margin: '0 auto 1rem' }} />
              <div>Loading progress data...</div>
            </div>
          ) : error ? (
            <div style={{
              padding: '1rem',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          ) : !currentPhase ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
              No phase information available.
            </div>
          ) : (
            <>
              {/* Feedback messages */}
              {successMsg && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem'
                }}>
                  <CheckCircle2 size={16} />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Actionable Phase Gate Lock / Admission Banner */}
              {isLocked && (
                <div style={{
                  padding: '1rem 1.25rem',
                  borderRadius: '10px',
                  background: isGateLocked ? 'rgba(245, 158, 11, 0.12)' : 'rgba(168, 85, 247, 0.12)',
                  border: isGateLocked ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(168, 85, 247, 0.35)',
                  color: isGateLocked ? '#fbbf24' : '#c084fc',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  fontSize: '0.9rem',
                  lineHeight: 1.5
                }}>
                  {isGateLocked ? (
                    <Lock size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                  ) : (
                    <Clock size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                  )}
                  <div>
                    <strong style={{ display: 'block', marginBottom: '2px' }}>
                      {isGateLocked ? 'Phase Progression Blocked' : 'Phase Admission Required'}
                    </strong>
                    <span>
                      {isGateLocked
                        ? (lockReason || 'This phase is locked by course progression rules until prerequisite requirements are satisfied.')
                        : `Student has cleared prerequisites and is pending admission to Phase ${currentPhase?.phaseNumber || activePhaseIndex + 1}. Click 'Admit to Phase ${currentPhase?.phaseNumber || activePhaseIndex + 1}' below to authorize attendance and grading.`}
                    </span>
                  </div>
                </div>
              )}

              {/* Phase Operational Status & Progression Controls Card */}
              <div style={{
                padding: '1rem 1.25rem',
                borderRadius: '10px',
                background: 'var(--bg-card-sub, rgba(255, 255, 255, 0.03))',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Phase {currentPhase.phaseNumber} Status:</span>
                    {currentPhase.isPassed ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '0.82rem', fontWeight: 600 }}>
                        <CheckCircle2 size={14} /> Passed
                      </span>
                    ) : currentPhase.status === 'failed' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                        <XCircle size={14} /> Failed
                      </span>
                    ) : isGateLocked ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', fontSize: '0.82rem', fontWeight: 600 }}>
                        <Lock size={14} /> Locked
                      </span>
                    ) : currentPhase.isAdmitted ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', fontSize: '0.82rem', fontWeight: 600 }}>
                        <UserCheck size={14} /> Admitted / In Progress
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontSize: '0.82rem', fontWeight: 600 }}>
                        <Clock size={14} /> Pending Admission
                      </span>
                    )}
                  </div>

                  {/* Operational Admission Controls */}
                  {activePhaseIndex > 0 && !isGateLocked && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {!currentPhase.isAdmitted ? (
                        <button
                          type="button"
                          onClick={() => handleAdmitPhase(currentPhase.phaseNumber)}
                          disabled={saving}
                          style={{
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            background: '#10b981',
                            color: '#ffffff',
                            border: 'none',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: saving ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            minHeight: '44px',
                            minWidth: '44px'
                          }}
                        >
                          <UserCheck size={16} />
                          Admit to Phase {currentPhase.phaseNumber}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (currentPhase.hasPayment) {
                              alert('Cannot undo phase admission: payment has already been recorded for this phase.');
                              return;
                            }
                            handleUnadmitPhase(currentPhase.phaseNumber);
                          }}
                          disabled={saving || currentPhase.hasPayment}
                          title={currentPhase.hasPayment ? 'Cannot undo phase admission: payment has already been recorded for this phase.' : 'Undo phase admission'}
                          style={{
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            background: currentPhase.hasPayment ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.15)',
                            color: currentPhase.hasPayment ? 'var(--text-muted, #94a3b8)' : '#f87171',
                            border: currentPhase.hasPayment ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(239, 68, 68, 0.3)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: (saving || currentPhase.hasPayment) ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            minHeight: '44px',
                            minWidth: '44px'
                          }}
                        >
                          <UserX size={16} />
                          {currentPhase.hasPayment ? 'Undo Admission (Payment Recorded)' : 'Undo Phase Admission'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Phase Fee Status Bar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.82rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted, #94a3b8)' }}>
                    <CreditCard size={15} />
                    <span>Phase Fee: <strong>{currentPhase.isFree || currentPhase.feeStatus === 'Free' || currentPhase.feeAmount === 0 ? '৳0 (Free)' : `৳${(currentPhase.feeAmount || 0).toLocaleString('en-BD')}`}</strong>{currentPhase.remainingDue > 0 && <span style={{ marginLeft: '0.4rem', color: '#f87171' }}>(Due: ৳{currentPhase.remainingDue.toLocaleString('en-BD')})</span>}</span>
                  </div>
                  <div>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      background: (currentPhase.isFeePaid || currentPhase.feeStatus === 'Free' || currentPhase.feeStatus === 'Waived') ? 'rgba(16, 185, 129, 0.15)' : currentPhase.hasPayment ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: (currentPhase.isFeePaid || currentPhase.feeStatus === 'Free' || currentPhase.feeStatus === 'Waived') ? '#34d399' : currentPhase.hasPayment ? '#fbbf24' : '#f87171'
                    }}>
                      Fee Status: {currentPhase.feeStatus || (currentPhase.isFeePaid ? 'Paid Full' : currentPhase.hasPayment ? 'Partial' : 'Pending')}
                    </span>
                  </div>
                </div>

                {/* Actionable "What is blocking progression" checklist */}
                {!currentPhase.isPassed && !isLocked && (
                  <div style={{
                    padding: '0.6rem 0.8rem',
                    borderRadius: '6px',
                    background: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    fontSize: '0.82rem'
                  }}>
                    <strong style={{ color: '#818cf8', display: 'block', marginBottom: '4px' }}>Requirements to Pass Phase {currentPhase.phaseNumber}:</strong>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-primary, #f8fafc)', lineHeight: 1.5 }}>
                      {currentPhase.requirements?.attendanceRequired && (
                        <li>Attendance: Minimum {currentPhase.requirements?.minAttendancePercent || 75}% required (Current: {Math.round((Object.values(attendanceEdits).filter(Boolean).length / Math.max(1, (currentPhase.classes || []).length)) * 100)}%)</li>
                      )}
                      {currentPhase.requirements?.completionRequired && (currentPhase.classes || []).some(c => c.mandatory) && (
                        <li>Mandatory Classes: All required classes must be attended</li>
                      )}
                      {(currentPhase.assignments || []).length > 0 && (
                        <li>Assignments: All required assignments must be submitted and achieve passing marks</li>
                      )}
                      {currentPhase.exam?.enabled && (
                        <li>Exam: Score at least {currentPhase.exam.passMarks || 40} marks on {currentPhase.exam.title || 'Phase Exam'}</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              {/* Category Breakdown & Practical Requirements */}
              <div style={{
                padding: '1rem',
                borderRadius: '10px',
                background: 'var(--bg-card-sub, rgba(255, 255, 255, 0.03))',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))'
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted, #94a3b8)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Attendance & Practical Requirements Breakdown
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                  {Object.entries(liveCategoryStats).map(([cat, stat]) => {
                    const isPractical = cat === 'shooting' || cat === 'editing' || cat === 'practical';
                    const allAttended = stat.attended >= stat.total;
                    return (
                      <div 
                        key={cat} 
                        style={{
                          padding: '0.75rem',
                          borderRadius: '8px',
                          background: isPractical ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                          border: isPractical ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid rgba(255, 255, 255, 0.05)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'capitalize' }}>
                            {cat}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: allAttended ? '#10b981' : '#f59e0b' }}>
                            {stat.attended}/{stat.total} Attended
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${stat.total > 0 ? (stat.attended / stat.total) * 100 : 0}%`,
                            height: '100%',
                            background: allAttended ? '#10b981' : '#6366f1',
                            borderRadius: '3px'
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Per-Class Attendance Controls */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Class Attendance</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)' }}>
                    {(currentPhase.classes || []).filter(c => !!attendanceEdits[c.id]).length} / {(currentPhase.classes || []).length} classes marked attended
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  borderRadius: '10px',
                  padding: '0.5rem',
                  background: 'var(--bg-card-sub, rgba(255, 255, 255, 0.02))'
                }}>
                  {(currentPhase.classes || []).map((cls, idx) => {
                    const isAttended = !!attendanceEdits[cls.id];
                    return (
                      <div
                        key={cls.id || idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.6rem 0.85rem',
                          borderRadius: '8px',
                          background: isAttended ? 'rgba(16, 185, 129, 0.06)' : 'transparent',
                          border: isAttended ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid transparent',
                          gap: '0.75rem',
                          opacity: isLocked ? 0.6 : 1
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                              Class {idx + 1}: {cls.title}
                            </span>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              textTransform: 'capitalize',
                              background: cls.category === 'shooting' ? 'rgba(239, 68, 68, 0.15)' : cls.category === 'editing' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                              color: cls.category === 'shooting' ? '#f87171' : cls.category === 'editing' ? '#c084fc' : '#818cf8'
                            }}>
                              {cls.category || 'theory'}
                            </span>
                            {cls.deliveryMode && (
                              <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-muted, #94a3b8)' }}>
                                {cls.deliveryMode}
                              </span>
                            )}
                          </div>
                          {(cls.teacherName || cls.subjectName) && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', marginTop: '2px' }}>
                              {cls.subjectName && <span>Subject: {cls.subjectName}</span>}
                              {cls.subjectName && cls.teacherName && <span> • </span>}
                              {cls.teacherName && <span>Teacher: {cls.teacherName}</span>}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleToggleAttendance(cls.id)}
                          disabled={isLocked}
                          aria-label={`Mark class ${idx + 1} ${isAttended ? 'absent' : 'attended'}`}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: isLocked ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            minWidth: '44px',
                            minHeight: '44px',
                            padding: '0.4rem 0.6rem',
                            borderRadius: '6px',
                            color: isAttended ? '#10b981' : 'var(--text-muted, #94a3b8)',
                            fontWeight: 600,
                            fontSize: '0.85rem'
                          }}
                        >
                          {isAttended ? (
                            <>
                              <CheckSquare size={20} color="#10b981" />
                              <span>Attended</span>
                            </>
                          ) : (
                            <>
                              <Square size={20} />
                              <span>Absent</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Assignments Section */}
              {(currentPhase.assignments || []).length > 0 && (
                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>Assignments</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {currentPhase.assignments.map((asg, idx) => {
                      const editState = assignmentEdits[asg.id] || { marks: '', status: 'pending', remarks: '' };
                      const maxM = asg.maxMarks || 100;
                      const passM = asg.passMarks || 40;
                      const marksVal = editState.marks !== '' ? Number(editState.marks) : null;
                      const isAsgPassed = marksVal !== null && marksVal >= passM;

                      return (
                        <div
                          key={asg.id || idx}
                          style={{
                            padding: '0.85rem',
                            borderRadius: '10px',
                            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                            background: 'var(--bg-card-sub, rgba(255, 255, 255, 0.02))',
                            opacity: isLocked ? 0.6 : 1
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div>
                              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{asg.title}</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', marginLeft: '8px' }}>
                                (Pass: {passM} / Max: {maxM})
                              </span>
                            </div>
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              background: marksVal === null ? 'rgba(107, 114, 128, 0.15)' : isAsgPassed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: marksVal === null ? 'var(--text-muted, #94a3b8)' : isAsgPassed ? '#34d399' : '#f87171'
                            }}>
                              {marksVal === null ? 'Ungraded' : isAsgPassed ? 'Passed' : 'Failed'}
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', alignItems: 'center' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '3px' }}>Marks</label>
                              <input
                                type="number"
                                min="0"
                                max={maxM}
                                value={editState.marks}
                                disabled={isLocked}
                                onChange={e => handleAssignmentChange(asg.id, 'marks', e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.5rem',
                                  borderRadius: '6px',
                                  background: 'var(--bg-input, rgba(0, 0, 0, 0.25))',
                                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                                  color: 'var(--text-primary, #f8fafc)',
                                  fontSize: '0.9rem',
                                  minHeight: '44px'
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '3px' }}>Status</label>
                              <select
                                value={editState.status}
                                disabled={isLocked}
                                onChange={e => handleAssignmentChange(asg.id, 'status', e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.5rem',
                                  borderRadius: '6px',
                                  background: 'var(--bg-input, rgba(0, 0, 0, 0.25))',
                                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                                  color: 'var(--text-primary, #f8fafc)',
                                  fontSize: '0.9rem',
                                  minHeight: '44px'
                                }}
                              >
                                <option value="pending">Pending</option>
                                <option value="submitted">Submitted</option>
                                <option value="graded">Graded</option>
                                <option value="returned">Returned</option>
                              </select>
                            </div>
                            <div style={{ gridColumn: 'span 2' }}>
                              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '3px' }}>Remarks</label>
                              <input
                                type="text"
                                placeholder="Optional feedback..."
                                value={editState.remarks}
                                disabled={isLocked}
                                onChange={e => handleAssignmentChange(asg.id, 'remarks', e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.5rem',
                                  borderRadius: '6px',
                                  background: 'var(--bg-input, rgba(0, 0, 0, 0.25))',
                                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                                  color: 'var(--text-primary, #f8fafc)',
                                  fontSize: '0.9rem',
                                  minHeight: '44px'
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Exam Section */}
              {currentPhase.exam && currentPhase.exam.enabled && (
                <div style={{
                  padding: '1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-card-sub, rgba(255, 255, 255, 0.02))',
                  opacity: isLocked ? 0.6 : 1
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{currentPhase.exam.title || 'Phase Exam'}</h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)' }}>
                        Pass mark: {currentPhase.exam.passMarks || 40} / {currentPhase.exam.maxMarks || 100}
                        {currentPhase.exam.phasePassThreshold && ` (Overall threshold: ${currentPhase.exam.phasePassThreshold})`}
                      </span>
                    </div>
                    {examEdits[currentPhase.id] !== undefined && examEdits[currentPhase.id] !== '' ? (
                      <span style={{
                        fontSize: '0.8rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        background: Number(examEdits[currentPhase.id]) >= (currentPhase.exam.passMarks || 40) ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: Number(examEdits[currentPhase.id]) >= (currentPhase.exam.passMarks || 40) ? '#34d399' : '#f87171'
                      }}>
                        {Number(examEdits[currentPhase.id]) >= (currentPhase.exam.passMarks || 40) ? 'Exam Passed' : 'Exam Failed'}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.8rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        background: 'rgba(107, 114, 128, 0.15)',
                        color: 'var(--text-muted, #94a3b8)'
                      }}>
                        Not Graded
                      </span>
                    )}
                  </div>

                  <div style={{ maxWidth: '240px' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '4px' }}>Marks Obtained</label>
                    <input
                      type="number"
                      min="0"
                      max={currentPhase.exam.maxMarks || 100}
                      placeholder="Enter marks"
                      value={examEdits[currentPhase.id] !== undefined ? examEdits[currentPhase.id] : ''}
                      disabled={isLocked}
                      onChange={e => handleExamChange(currentPhase.id, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        background: 'var(--bg-input, rgba(0, 0, 0, 0.25))',
                        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                        color: 'var(--text-primary, #f8fafc)',
                        fontSize: '0.95rem',
                        minHeight: '44px'
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer / Action Bar */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '1rem',
          background: 'var(--bg-card-header, rgba(255, 255, 255, 0.02))'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="modern-btn modern-btn--secondary"
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
              background: 'transparent',
              color: 'var(--text-primary, #f8fafc)',
              cursor: 'pointer',
              minHeight: '44px',
              fontSize: '0.9rem'
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="modern-btn modern-btn--primary"
            style={{
              padding: '0.65rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: '#6366f1',
              color: '#ffffff',
              fontWeight: 600,
              cursor: (saving || loading) ? 'not-allowed' : 'pointer',
              opacity: (saving || loading) ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              minHeight: '44px',
              fontSize: '0.9rem'
            }}
          >
            {saving ? (
              <>
                <RefreshCw className="animate-spin" size={16} />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Save Progress</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
