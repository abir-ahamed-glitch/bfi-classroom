import { useState } from 'react';
import apiClient from '../utils/apiClient';
import { dhakaNow } from '../utils/timetable';
import './AssessmentPanels.css';

const eventTime = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit'});

async function getJson(url, options) {
  const response = await apiClient(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not complete the request.');
  return data;
}

function ParticipantReview({meetingReceiptId}) {
  const [review, setReview] = useState(null);
  const [offset, setOffset] = useState(0);
  const [participantId, setParticipantId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [approvePresent, setApprovePresent] = useState(false);
  const [attendanceRecorded, setAttendanceRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const baseUrl = '/api/admin/zoom-event-receipts';
  const participant = review?.participants.find(item => String(item.id) === participantId);
  const verified = review?.enrollments.find(item => item.id === participant?.enrollmentId);

  function chooseParticipant(id) {
    setParticipantId(id);
    setEnrollmentId('');
    setConfirmed(false);
    setReason('');
    setEvidence(null);
    setApprovePresent(false);
    setAttendanceRecorded(false);
    setMessage('');
    setError('');
  }

  async function fetchPage(nextOffset) {
    const data = await getJson(`${baseUrl}/${meetingReceiptId}/participant-review?offset=${nextOffset}`);
    setReview(data);
    setOffset(nextOffset);
  }

  async function openPage(nextOffset) {
    chooseParticipant('');
    setBusy(true);
    try { await fetchPage(nextOffset); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (!participant || busy) return;
    const revoke = participant.enrollmentId != null;
    const payload = revoke ? {enrollmentId: participant.enrollmentId, reason: reason.trim()}
      : {enrollmentId: Number(enrollmentId), identityConfirmed: confirmed};
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await getJson(`${baseUrl}/${participant.id}/participant-verification`, {
        method: revoke ? 'DELETE' : 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
      });
      chooseParticipant('');
      setMessage(revoke ? 'Verification revoked.' : 'Participant identity verified.');
      try { await fetchPage(offset); }
      catch { setReview(null); setError('Could not refresh the list. Open participant review again.'); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function loadEvidence() {
    if (!participant || participant.enrollmentId == null || busy) return;
    setBusy(true);
    setError('');
    setEvidence(null);
    setApprovePresent(false);
    try {
      const data = await getJson(`${baseUrl}/${participant.id}/attendance-evidence`);
      setEvidence(data.evidence);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function recordAttendance() {
    if (!approvePresent || !evidence || evidence.incomplete || evidence.seconds <= 0
      || evidence.policy?.meetsMinimum === false || busy || attendanceRecorded) return;
    setBusy(true);
    setError('');
    try {
      await getJson(`${baseUrl}/${participant.id}/attendance-approval`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enrollmentId: participant.enrollmentId, seconds: evidence.seconds,
          scheduledSeconds: evidence.scheduledSeconds, minimumPercent: evidence.policy?.minimumPercent, approvePresent: true})
      });
      setAttendanceRecorded(true);
      setMessage('Attendance recorded as present.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Zoom participant review" className="assessment-zoom-participant-box">
    <h4>Review Zoom participants</h4>
    {!review && <button type="button" className="assessment-btn assessment-btn--secondary" disabled={busy} onClick={() => openPage(0)}>Open participant review</button>}
    {review && <form onSubmit={save}>
      <p className="assessment-panel-subtitle">Match the participant ID against your verified Zoom records before choosing a student.</p>
      <fieldset disabled={busy} className="assessment-admin-fieldset">
        <div className="assessment-admin-grid">
        <label className="assessment-admin-field">Zoom participant
          <select aria-label="Zoom participant" className="assessment-admin-input" required value={participantId} onChange={event => chooseParticipant(event.target.value)}>
            <option value="">Select participant</option>
            {review.participants.map(item => <option key={item.id} value={item.id}>
              {item.participantId} · {eventTime.format(new Date(item.firstEventAt))}{item.enrollmentId != null ? ' · Verified' : ''}
            </option>)}
          </select>
        </label>
        {(offset > 0 || review.hasMore) && <div className="assessment-admin-actions">
          {offset > 0 && <button type="button" className="assessment-btn assessment-btn--secondary" onClick={() => openPage(offset - 50)}>Previous participants</button>}
          {review.hasMore && <button type="button" className="assessment-btn assessment-btn--secondary" onClick={() => openPage(offset + 50)}>More participants</button>}
        </div>}
        {participant && (participant.enrollmentId != null ? <>
          <p className="assessment-review-meta" style={{gridColumn: '1 / -1'}}>Verified enrollment {participant.enrollmentId}{verified ? ` · ${verified.firstName} ${verified.lastName}` : ''}</p>
          <div className="assessment-admin-actions">
            <button type="button" className="assessment-btn assessment-btn--secondary" onClick={loadEvidence}>View time in class</button>
          </div>
          {evidence && <p role="status" className="assessment-panel-status" style={{gridColumn: '1 / -1', margin: 0}}>
            {Math.floor(evidence.seconds / 60)} of {Math.floor(evidence.scheduledSeconds / 60)} minutes recorded.
            {evidence.incomplete && ' Some join or leave records are missing. Review required.'}
            {evidence.policy && <> Course Maker minimum: {evidence.policy.minimumPercent}%.
              {!evidence.incomplete && (evidence.policy.meetsMinimum ? ' Minimum met.' : ' Below minimum.')}</>}
          </p>}
          {evidence && !evidence.incomplete && evidence.seconds > 0 && evidence.policy?.meetsMinimum !== false && !attendanceRecorded && <div className="assessment-admin-actions">
            <label className="assessment-admin-checkbox"><input type="checkbox" checked={approvePresent} onChange={event => setApprovePresent(event.target.checked)} /> Approve marking this student present.</label>
            <button type="button" className="assessment-btn assessment-btn--primary" disabled={!approvePresent} onClick={recordAttendance}>Record attendance</button>
          </div>}
          <label className="assessment-admin-field">Reason for revoking
            <input className="assessment-admin-input" required minLength={3} maxLength={240} value={reason} onChange={event => setReason(event.target.value)} />
          </label>
          <small className="assessment-review-meta" style={{gridColumn: '1 / -1'}}>Revoking a verification leaves any saved attendance mark in the attendance sheet.</small>
          <div className="assessment-admin-actions">
            <button type="submit" className="assessment-btn assessment-btn--secondary" disabled={reason.trim().length < 3}>Revoke verification</button>
          </div>
        </> : <>
          <label className="assessment-admin-field">Student enrollment
            <select aria-label="Student enrollment" className="assessment-admin-input" required value={enrollmentId} onChange={event => {setEnrollmentId(event.target.value); setConfirmed(false);}}>
              <option value="">Select enrollment</option>
              {review.enrollments.map(item => <option key={item.id} value={item.id}>
                {item.firstName} {item.lastName} · {item.studentId || `Enrollment ${item.id}`}
              </option>)}
            </select>
          </label>
          <div className="assessment-admin-actions">
            <label className="assessment-admin-checkbox"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I independently verified this participant’s identity.</label>
            <button type="submit" className="assessment-btn assessment-btn--primary" disabled={!enrollmentId || !confirmed}>Verify participant</button>
          </div>
        </>)}
        </div>
      </fieldset>
      {review.participants.length === 0 && <p className="assessment-review-meta">No participants are available for this page.</p>}
    </form>}
    {busy && <p role="status" className="assessment-panel-status">Working…</p>}
    {message && <p role="status" className="assessment-panel-status">{message}</p>}
    {error && <p role="alert" className="assessment-panel-error">{error}</p>}
  </section>;
}

export default function ZoomClassBindings({batchId, phases}) {
  const [phaseId, setPhaseId] = useState('');
  const [date, setDate] = useState(() => dhakaNow().date);
  const [options, setOptions] = useState(null);
  const [slotId, setSlotId] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const slot = options?.find(option => option.slotId === slotId);
  const receipt = slot?.receipts.find(item => String(item.id) === receiptId);

  function resetResults() {
    setOptions(null);
    setSlotId('');
    setReceiptId('');
    setMessage('');
    setError('');
  }

  async function search(event) {
    event.preventDefault();
    resetResults();
    setBusy(true);
    try {
      const query = new URLSearchParams({phaseId, date});
      const data = await getJson(`/api/admin/batches/${batchId}/zoom-binding-options?${query}`);
      setOptions(data.options);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function bind(event) {
    event.preventDefault();
    if (!receipt || receipt.bound || busy) return;
    setBusy(true);
    setError('');
    try {
      await getJson(`/api/admin/zoom-event-receipts/${receipt.id}/class-binding`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({batchId: Number(batchId), phaseId, date, slotId, classId: slot.classId})
      });
      setOptions(current => current.map(option => ({...option, receipts: option.receipts.flatMap(item => {
        if (item.id !== receipt.id) return [item];
        return option.slotId === slotId ? [{...item, bound: true}] : [];
      })})));
      setMessage('Zoom meeting linked to this class.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="glass-panel assessment-admin-panel" aria-label="Zoom class linking" style={{padding: '1rem', marginBottom: '1rem'}}>
    <h3>Link a Zoom meeting to a class</h3>
    <p className="assessment-panel-subtitle">Choose the class date in Bangladesh time, then select a recorded Zoom meeting.</p>
    <form onSubmit={search}>
      <fieldset disabled={busy} className="assessment-admin-fieldset">
        <div className="assessment-admin-grid">
        <label className="assessment-admin-field">Phase
          <select aria-label="Phase" className="assessment-admin-input" required value={phaseId} onChange={event => {setPhaseId(event.target.value); resetResults();}}>
            <option value="">Select phase</option>
            {phases.map((phase, index) => {
              const id = String(phase.id || `phase_${phase.phaseIndex ?? index + 1}`);
              return <option key={id} value={id}>{phase.title || `Phase ${index + 1}`}</option>;
            })}
          </select>
        </label>
        <label className="assessment-admin-field">Class date
          <input className="assessment-admin-input" type="date" required value={date} onChange={event => {setDate(event.target.value); resetResults();}} />
        </label>
        <button type="submit" className="assessment-btn assessment-btn--secondary">Find Zoom meetings</button>
        </div>
      </fieldset>
    </form>
    {options?.length === 0 && <p role="status" className="assessment-panel-status">No scheduled Zoom classes were found for that date.</p>}
    {options?.length > 0 && <form onSubmit={bind} style={{marginTop: '0.85rem'}}>
      <fieldset disabled={busy} className="assessment-admin-fieldset">
        <div className="assessment-admin-grid">
        <label className="assessment-admin-field">Class
          <select aria-label="Class" className="assessment-admin-input" required value={slotId} onChange={event => {setSlotId(event.target.value); setReceiptId(''); setMessage(''); setError('');}}>
            <option value="">Select class</option>
            {options.map(item => <option key={item.slotId} value={item.slotId}>{item.startTime} · {item.title}</option>)}
          </select>
        </label>
        <label className="assessment-admin-field">Recorded Zoom meeting
          <select aria-label="Recorded Zoom meeting" className="assessment-admin-input" required disabled={!slot?.receipts.length} value={receiptId} onChange={event => {setReceiptId(event.target.value); setMessage(''); setError('');}}>
            <option value="">Select meeting</option>
            {slot?.receipts.map(item => <option key={item.id} value={item.id}>
              {slot.meetingId} · {eventTime.format(new Date(item.firstEventAt))} · Record {item.id}{item.bound ? ' · Linked' : ''}
            </option>)}
          </select>
        </label>
        <button type="submit" className="assessment-btn assessment-btn--primary" disabled={!receipt || receipt.bound}>Link meeting</button>
        </div>
      </fieldset>
    </form>}
    {slot && !slot.receipts.length && <p role="status" className="assessment-panel-status">No available Zoom records for this class.</p>}
    {receipt?.bound && !message && <p role="status" className="assessment-panel-status">This meeting is already linked to the selected class.</p>}
    {receipt?.bound && <ParticipantReview key={receipt.id} meetingReceiptId={receipt.id} />}
    {busy && <p role="status" className="assessment-panel-status">Working…</p>}
    {message && <p role="status" className="assessment-panel-status">{message}</p>}
    {error && <p role="alert" className="assessment-panel-error">{error}</p>}
  </section>;
}
