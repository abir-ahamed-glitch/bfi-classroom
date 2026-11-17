import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import apiClient from '../utils/apiClient';
import { dhakaNow } from '../utils/timetable';
import { timelineFocus, timelineSessions } from '../utils/classTimeline';
import './ClassTimeline.css';

export default function ClassTimeline() {
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(dhakaNow);
  const [selected, setSelected] = useState(null);
  const [revision, setRevision] = useState(0);
  const track = useRef(null);
  const drag = useRef(null);
  const centered = useRef(new Set());

  useEffect(() => {
    let active = true;
    let requestNumber = 0;
    async function loadSchedule() {
      const request = ++requestNumber;
      try {
        const response = await apiClient('/api/student/schedule');
        if (!response.ok) throw new Error('Could not load your class routine.');
        const data = await response.json();
        if (active && request === requestNumber) {
          const updated = Array.isArray(data.batches) ? data.batches : [];
          setBatches(updated);
          setSelected(previous => {
            if (!previous) return null;
            const batch = updated.find(item => item.batchId === previous.batchId);
            const phase = batch?.phases?.find(item => item.phaseId === previous.phaseId);
            if (!batch || !phase) return null;
            const item = timelineSessions(phase.schedule || [], batch, dhakaNow().date)
              .find(session => session.key === previous.key);
            return item ? { ...item, course: batch.courseName, phase: phase.title, batchId: batch.batchId, phaseId: phase.phaseId } : null;
          });
          setError('');
        }
      } catch (err) {
        if (active && request === requestNumber) setError(err.message || 'Could not load your class routine.');
      } finally {
        if (active && request === requestNumber) setLoading(false);
      }
    }
    loadSchedule();
    const refresh = () => { setNow(dhakaNow()); loadSchedule(); };
    const socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
      auth: callback => callback({ token: localStorage.getItem('token') })
    });
    socket.on('schedule_updated', () => { setSelected(null); refresh(); });
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); socket.disconnect(); };
  }, [revision]);

  useEffect(() => {
    for (const element of document.querySelectorAll('.class-timeline__track')) {
      if (centered.current.has(element.id)) continue;
      const focused = element.querySelector('[data-focus="true"]');
      if (!focused) continue;
      element.scrollLeft = focused.offsetLeft - element.offsetLeft - (element.clientWidth - focused.offsetWidth) / 2;
      centered.current.add(element.id);
    }
  }, [batches]);

  function beginDrag(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
  }

  return <section className="class-timeline glass-panel" aria-labelledby="class-timeline-title">
    <div className="class-timeline__heading">
      <div><h2 id="class-timeline-title">Class routine</h2><p>Bangladesh time · Select a class for details</p></div>
      <Link to="/classroom">Full schedule →</Link>
    </div>
    {loading && <p role="status">Loading your routine…</p>}
    {error && <div role="alert">{error} <button type="button" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Try again</button></div>}
    {!loading && !error && batches.length === 0 && <p>No course routine is available yet.</p>}
    {batches.map(batch => <div className="class-timeline__course" key={batch.batchId}>
      <h3>{batch.courseName} · {batch.batchName}</h3>
      {batch.phases?.map(phase => {
        const sessions = timelineSessions(phase.schedule || [], batch, now.date);
        return <div key={phase.phaseId}>
          <h4>{phase.title}</h4>
          {sessions.length === 0 ? <p>No classes are scheduled for this phase.</p> : <>
            <div className="class-timeline__controls">
              <button type="button" onClick={() => document.getElementById(`timeline-${batch.batchId}-${phase.phaseId}`)?.scrollBy({ left: -260, behavior: 'smooth' })}>← Earlier classes</button>
              <button type="button" onClick={() => document.getElementById(`timeline-${batch.batchId}-${phase.phaseId}`)?.scrollBy({ left: 260, behavior: 'smooth' })}>Later classes →</button>
            </div>
            <div id={`timeline-${batch.batchId}-${phase.phaseId}`} className="class-timeline__track" tabIndex={0}
              aria-label={`${phase.title} class timeline`} ref={element => { if (element) track.current = element; }}
              onPointerDown={event => { track.current = event.currentTarget; beginDrag(event); }}
              onPointerMove={event => {
                if (!drag.current) return;
                const distance = event.clientX - drag.current.x;
                if (!drag.current.moved && Math.abs(distance) > 5) {
                  drag.current.moved = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }
                if (drag.current.moved) event.currentTarget.scrollLeft = drag.current.scroll - distance;
              }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              {sessions.map((session, index) => {
                const today = session.date === now.date && !['cancelled', 'rescheduled'].includes(session.status);
                return <button key={session.key} type="button" data-focus={index === timelineFocus(sessions, now.date, now.time)} className={`class-timeline__node ${today ? 'is-today' : ''}`}
                  onClick={() => setSelected({ ...session, course: batch.courseName, phase: phase.title, batchId: batch.batchId, phaseId: phase.phaseId })}>
                  <span>{today ? 'Today · ' + session.date : session.date}</span>
                  <strong>{session.classTitle || session.subjectName || 'Class'}</strong>
                  <small>{session.startTime}–{session.endTime}</small>
                  {(session.attendance || session.date < now.date) && !['cancelled', 'rescheduled'].includes(session.status) &&
                    <small>Attendance: {session.attendance === 'present' ? 'Present' : session.attendance === 'absent' ? 'Absent' : 'Not marked'}</small>}
                  {session.status !== 'scheduled' && <small>{session.status === 'moved' ? 'Rescheduled' : session.status}</small>}
                </button>;
              })}
            </div>
          </>}
        </div>;
      })}
    </div>)}
    {selected && <div className="class-timeline__detail" aria-live="polite">
      <h3>{selected.classTitle || selected.subjectName || 'Class'}</h3>
      <p>{selected.course} · {selected.phase}</p>
      <p>{selected.date} · {selected.startTime}–{selected.endTime} · {selected.platform || 'Platform not set'}</p>
      <p>Teacher: {selected.teacherName || 'Not assigned'}</p>
      <p>{selected.meetingUrl ? 'Open Classroom to join the meeting.' : 'Meeting link is not configured.'}</p>
      {selected.date < now.date && <p>Attendance: {selected.attendance === 'present' ? 'Present' : selected.attendance === 'absent' ? 'Absent' : 'Not marked'}</p>}
      <Link to={{ pathname: '/classroom', search: new URLSearchParams({ batch_id: String(selected.batchId), phase_id: String(selected.phaseId), date: selected.date, slot_id: String(selected.id) }).toString() }}>Open Classroom</Link>
    </div>}
  </section>;
}
