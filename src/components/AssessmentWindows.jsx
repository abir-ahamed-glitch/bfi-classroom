import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import '../pages/AssessmentSubmission.css';
import './AssessmentPanels.css';

const formatDhaka = value => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value));

export function StudentAssessmentWindows({ batchId, phaseId }) {
  const [windows, setWindows] = useState([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiClient('/api/assessment-windows');
        if (!response.ok) throw new Error('Cannot load assessments');
        const data = await response.json();
        if (active) { setWindows(data.windows || []); setError(false); }
      } catch { if (active) setError(true); }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const selected = windows.filter(window => String(window.batchId) === String(batchId) && String(window.phaseId) === String(phaseId));
  return <section className="glass-panel assessment-windows-panel" aria-label="Assessments" style={{padding: '1rem', marginBottom: '1rem'}}>
    <h3>Assessments</h3>
    {error ? <p role="alert" className="assessment-panel-error">Could not load assessment schedules.</p> : selected.length === 0 ? <p className="assessment-panel-subtitle">No eligible assessment is scheduled for this phase.</p> :
      <ul className="assessment-panel-list">{selected.map(window => <li key={window.id} className="assessment-panel-item"><strong>{window.title}</strong> · {window.type} · {window.availability}<br />
        {formatDhaka(window.opensAt)} – {formatDhaka(window.closesAt)} (Bangladesh time)
        <p><Link to={`/assessment-submissions/${window.id}`} className="assessment-action-link">{window.availability === 'open' ? 'Submit answer paper' : 'View submissions and results'}</Link></p>
      </li>)}</ul>}
  </section>;
}

export function AdminAssessmentWindows({ batchId, phases }) {
  const [saved, setSaved] = useState([]);
  const [phaseId, setPhaseId] = useState('');
  const [target, setTarget] = useState('');
  const [slotId, setSlotId] = useState('');
  const [date, setDate] = useState('');
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [message, setMessage] = useState('');
  const phase = phases.find(item => String(item.id) === phaseId);
  const choices = phase ? [
    ...(phase.exam?.enabled ? [{value: 'exam:exam', label: phase.exam.title || 'Phase exam'}] : []),
    ...(phase.assignments || []).filter(item => item.id != null).map(item => ({value: `assignment:${item.id}`, label: item.title || item.name || 'Assignment'}))
  ] : [];
  const load = async () => {
    const response = await apiClient(`/api/assessment-windows?batchId=${encodeURIComponent(batchId)}`);
    if (!response.ok) throw new Error('Could not load saved schedules.');
    setSaved((await response.json()).windows || []);
  };
  useEffect(() => { let active = true; (async () => { try { const response = await apiClient(`/api/assessment-windows?batchId=${encodeURIComponent(batchId)}`); if (!response.ok) throw new Error(); const data = await response.json(); if (active) setSaved(data.windows || []); } catch { if (active) setMessage('Could not load saved schedules.'); } })(); return () => { active = false; }; }, [batchId]);
  const save = async event => {
    event.preventDefault();
    const colon = target.indexOf(':');
    const type = target.slice(0, colon), assessmentId = target.slice(colon + 1);
    try {
      const response = await apiClient('/api/assessment-windows', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({batchId, phaseId, type, assessmentId, routineSlotId: slotId, sessionDate: date, opensAt: opens, closesAt: closes})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      await load(); setMessage('Assessment schedule saved.');
    } catch (error) { setMessage(error.message); }
  };
  return <section aria-label="Assessment scheduling" className="glass-panel assessment-admin-panel" style={{padding: '1rem', marginBottom: '1rem'}}>
    <h3>Assessment scheduling</h3>
    <p className="assessment-panel-subtitle">Times use Bangladesh time. An exam must be linked to a scheduled class.</p>
    {saved.length > 0 && <ul className="assessment-panel-list">{saved.map(item => <li key={item.id} className="assessment-panel-item">{phases.find(p => String(p.id) === item.phase_id)?.title || item.phase_id} · {item.assessment_type} · {item.assessment_id}: {formatDhaka(item.opens_at)} – {formatDhaka(item.closes_at)}{item.needsReview && <strong> · Schedule changed: update this assessment before students can see it.</strong>}</li>)}</ul>}
    <form onSubmit={save} className="assessment-admin-grid">
      <label className="assessment-admin-field">Phase
        <select aria-label="Phase" className="assessment-admin-input" required value={phaseId} onChange={event => {setPhaseId(event.target.value); setTarget(''); setSlotId('');}}>
          <option value="">Select phase</option>
          {phases.filter(item => item.id != null).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <label className="assessment-admin-field">Assessment
        <select aria-label="Assessment" className="assessment-admin-input" required value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">Select assessment</option>
          {choices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {target.startsWith('exam:') && <>
        <label className="assessment-admin-field">Routine class
          <select className="assessment-admin-input" required value={slotId} onChange={event => setSlotId(event.target.value)}>
            <option value="">Select class</option>
            {(phase?.routine || []).filter(slot => slot.id != null).map(slot => <option key={slot.id} value={slot.id}>{slot.classTitle || slot.subjectName || slot.weekday} · {slot.date || slot.weekday}</option>)}
          </select>
        </label>
        <label className="assessment-admin-field">Exam date
          <input className="assessment-admin-input" required type="date" value={date} onChange={event => setDate(event.target.value)} />
        </label>
      </>}
      <label className="assessment-admin-field">Opens (Bangladesh time)
        <input className="assessment-admin-input" required type="datetime-local" value={opens} onChange={event => setOpens(event.target.value)} />
      </label>
      <label className="assessment-admin-field">Deadline (Bangladesh time)
        <input className="assessment-admin-input" required type="datetime-local" value={closes} onChange={event => setCloses(event.target.value)} />
      </label>
      <div className="assessment-admin-actions">
        <button type="submit" className="assessment-btn assessment-btn--primary">Save assessment schedule</button>
      </div>
    </form>
    {message && <p role="status" className="assessment-panel-status">{message}</p>}
  </section>;
}
