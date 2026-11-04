import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, Calendar, Clock, User, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getPlatformIcon } from '../components/admin/PlatformSelector';
import './Classroom.css';

export default function Classroom() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [batches, setBatches] = useState([]);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(0);
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Not authenticated');
      }

      const isTeacher = currentUser?.role === 'instructor';
      const endpoint = isTeacher ? '/api/teacher/schedule' : '/api/student/schedule';

      const res = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load routine schedule (HTTP ${res.status})`);
      }

      const data = await res.json();
      const rawBatches = Array.isArray(data.batches) ? data.batches : [];
      setBatches(rawBatches);
      setSelectedBatchIndex(0);
      setSelectedPhaseIndex(0);
    } catch (err) {
      console.error('Error fetching classroom schedule:', err);
      setError(err.message || 'Unable to load schedule.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.role]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const activeBatch = batches[selectedBatchIndex] || null;
  const activePhases = Array.isArray(activeBatch?.phases) ? activeBatch.phases : [];
  const activePhase = activePhases[selectedPhaseIndex] || activePhases[0] || null;
  const activeSlots = Array.isArray(activePhase?.schedule) ? activePhase.schedule : [];

  const formatDeliveryMode = (mode) => {
    switch (mode) {
      case 'recorded': return { label: 'Recorded', className: 'classroom-pill-recorded' };
      case 'recorded_plus_live_discussion': return { label: 'Recorded + Live Q&A', className: 'classroom-pill-recorded-qna' };
      case 'live': return { label: 'Live Online', className: 'classroom-pill-live' };
      case 'studio': return { label: 'In-Person (Studio)', className: 'classroom-pill-studio' };
      case 'practical': return { label: 'Practical', className: 'classroom-pill-practical' };
      default: return { label: mode || 'Live Online', className: 'classroom-pill-live' };
    }
  };

  const formatCategory = (cat) => {
    switch (cat) {
      case 'theory': return { label: 'Theory', className: 'classroom-pill-theory' };
      case 'practical': return { label: 'Practical', className: 'classroom-pill-practical' };
      case 'review': return { label: 'Review / Q&A', className: 'classroom-pill-review' };
      case 'assignment': return { label: 'Assignment', className: 'classroom-pill-assignment' };
      case 'exam': return { label: 'Exam', className: 'classroom-pill-exam' };
      default: return { label: cat || 'Theory', className: 'classroom-pill-theory' };
    }
  };

  return (
    <div className="page-container container fade-in classroom-container">
      {/* Header */}
      <div className="classroom-header">
        <div>
          <h1 className="text-gradient font-display" style={{ fontSize: '2.2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <BookOpen size={32} color="var(--accent-primary, #0284c7)" />
            BFI Classroom
          </h1>
          <p className="subtitle" style={{ margin: 0, color: 'var(--text-secondary, #94a3b8)', fontSize: '0.95rem' }}>
            {currentUser?.role === 'instructor' 
              ? 'Your assigned teaching routine, scheduled topics, and class platforms.' 
              : 'Your enrolled batch routine, scheduled lecture dates, and live session links.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="classroom-badge-tz" title="All class times are scheduled in Bangladesh Standard Time (UTC+6)">
            <Clock size={13} />
            Asia/Dhaka (BST, UTC+6)
          </span>
          <button 
            type="button" 
            onClick={fetchSchedule} 
            className="btn btn-secondary" 
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.85rem' }}
            title="Refresh routine schedule"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
          <RefreshCw size={36} className="spin" style={{ margin: '0 auto 1rem auto', color: '#38bdf8' }} />
          <h3 className="font-display" style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>Loading Routine Schedule...</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Resolving authoritative phase overrides and lecture platforms.</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
          <AlertCircle size={40} style={{ margin: '0 auto 1rem auto', color: '#f87171' }} />
          <h3 className="font-display" style={{ fontSize: '1.25rem', color: '#f87171', marginBottom: '0.5rem' }}>Unable to Load Schedule</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>{error}</p>
          <button type="button" onClick={fetchSchedule} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      )}

      {/* Empty State: No Batches */}
      {!loading && !error && batches.length === 0 && (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <Layers size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3, color: 'var(--text-muted)' }} />
          <h3 className="font-display" style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Active Batch Routine Found</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '480px', margin: '0 auto' }}>
            {currentUser?.role === 'instructor'
              ? 'You have not been assigned to any Course Maker batch schedule yet.'
              : 'You are not actively enrolled in any scheduled Course Maker batch yet. Once enrolled, your routine will appear here automatically.'}
          </p>
        </div>
      )}

      {/* Content: Batches & Routine */}
      {!loading && !error && batches.length > 0 && activeBatch && (
        <>
          {/* Multiple Batches Selector */}
          {batches.length > 1 && (
            <div className="classroom-batch-selector" role="tablist" aria-label="Select Enrolled Batch">
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Your Batches:
              </span>
              {batches.map((b, idx) => (
                <button
                  key={b.batchId}
                  type="button"
                  role="tab"
                  aria-selected={idx === selectedBatchIndex}
                  className={`classroom-batch-pill ${idx === selectedBatchIndex ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedBatchIndex(idx);
                    setSelectedPhaseIndex(0);
                  }}
                >
                  {b.courseName} — {b.batchName || `Batch ${b.batchNumber || idx + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Active Batch Summary Banner */}
          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active Batch Schedule
              </div>
              <h2 className="font-display" style={{ fontSize: '1.5rem', color: 'var(--text-primary)', margin: '0.2rem 0' }}>
                {activeBatch.courseName}
              </h2>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {activeBatch.batchName || `Batch ${activeBatch.batchNumber}`}
                {activeBatch.batchNumber ? ` (Batch #${activeBatch.batchNumber})` : ''}
              </div>
            </div>
          </div>

          {/* Phase Tabs */}
          {activePhases.length > 1 && (
            <div className="classroom-phase-tabs" role="tablist" aria-label="Course Phases">
              {activePhases.map((phase, pIdx) => (
                <button
                  key={phase.phaseId || pIdx}
                  type="button"
                  role="tab"
                  aria-selected={pIdx === selectedPhaseIndex}
                  className={`classroom-phase-tab ${pIdx === selectedPhaseIndex ? 'active' : ''}`}
                  onClick={() => setSelectedPhaseIndex(pIdx)}
                >
                  {phase.title || `Phase ${pIdx + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Empty Phase State */}
          {activeSlots.length === 0 && (
            <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
              <Calendar size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.3, color: 'var(--text-muted)' }} />
              <h4 className="font-display" style={{ fontSize: '1.15rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>No Schedule Slots Configured</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                The schedule for {activePhase?.title || 'this phase'} has not been published yet.
              </p>
            </div>
          )}

          {/* Routine Slots Grid */}
          {activeSlots.length > 0 && (
            <div className="classroom-slots-grid" data-testid="classroom-slots-grid">
              {activeSlots.map((slot, sIdx) => {
                const delivery = formatDeliveryMode(slot.deliveryMode);
                const category = formatCategory(slot.category);

                return (
                  <div 
                    key={slot.id || sIdx} 
                    className={`classroom-slot-card ${slot.isMyClass ? 'my-class-card' : ''}`}
                    data-testid={`classroom-slot-${sIdx}`}
                  >
                    {/* Time & Weekday Header */}
                    <div className="classroom-slot-meta-header">
                      <span className="classroom-time-badge" data-testid="slot-time-badge">
                        <Clock size={12} />
                        {slot.startTime || '19:00'}–{slot.endTime || '21:00'}
                      </span>
                      <span className="classroom-date-label" data-testid="slot-date-label">
                        {slot.date ? `${slot.date} (${slot.weekday})` : (slot.weekday ? `Every ${slot.weekday}` : 'Scheduled Session')}
                      </span>
                    </div>

                    {/* Class Topic & Subject */}
                    <div>
                      <div className="classroom-slot-title" data-testid="slot-topic-title">
                        {slot.classTitle || slot.subjectName || `Session #${sIdx + 1}`}
                      </div>
                      {slot.classTitle && slot.subjectName && (
                        <span className="classroom-slot-subject" data-testid="slot-subject-name">
                          {slot.subjectName}
                        </span>
                      )}
                    </div>

                    {/* Metadata Badges */}
                    <div className="classroom-slot-badges">
                      {/* Delivery Mode Badge */}
                      <span className={`classroom-pill ${delivery.className}`} data-testid="slot-delivery-badge">
                        {delivery.label}
                      </span>

                      {/* Category Badge */}
                      <span className={`classroom-pill ${category.className}`} data-testid="slot-category-badge">
                        {category.label}
                      </span>

                      {/* Platform Badge */}
                      {slot.platform && (
                        <span className="classroom-pill classroom-pill-platform" data-testid="slot-platform-badge">
                          {getPlatformIcon(slot.platform, 13)}
                          <span>{slot.platform}</span>
                        </span>
                      )}
                    </div>

                    {/* Teacher Footer */}
                    <div className="classroom-slot-teacher">
                      <span className="classroom-teacher-name" data-testid="slot-teacher-name">
                        <User size={13} style={{ opacity: 0.7 }} />
                        {slot.teacherName || 'Instructor TBA'}
                      </span>
                      {slot.isMyClass && (
                        <span className="classroom-myclass-pill" data-testid="slot-myclass-tag">
                          Your Class
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
