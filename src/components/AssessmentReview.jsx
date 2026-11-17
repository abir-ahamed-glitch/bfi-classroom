import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';

export default function AssessmentReview({ batchId }) {
  const [items, setItems] = useState([]);
  const [marks, setMarks] = useState({});
  const [remarks, setRemarks] = useState({});
  const [message, setMessage] = useState('');
  const load = async () => {
    const response = await apiClient(`/api/assessment-submissions/review?batchId=${encodeURIComponent(batchId)}`);
    if (!response.ok) throw new Error('Could not load submitted answer papers.');
    setItems((await response.json()).submissions || []);
  };
  useEffect(() => { let active = true; (async () => { try { const response = await apiClient(`/api/assessment-submissions/review?batchId=${encodeURIComponent(batchId)}`); if (!response.ok) throw new Error(); const data = await response.json(); if (active) setItems(data.submissions || []); } catch { if (active) setMessage('Could not load submitted answer papers.'); } })(); return () => { active = false; }; }, [batchId]);
  const download = async id => {
    try {
      const response = await apiClient(`/api/assessment-submissions/files/${id}`);
      if (!response.ok) throw new Error('Download failed.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `answer-paper-${id}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error.message); }
  };
  const grade = async (event, item) => {
    event.preventDefault();
    const value = marks[item.id];
    if (value === undefined || value.trim() === '') return setMessage('Enter marks.');
    try {
      const response = await apiClient(`/api/assessment-submissions/${item.id}/grade`, {method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({marks: Number(value), remarks: remarks[item.id] || ''})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save marks.');
      await load(); setMessage('Marks saved.');
    } catch (error) { setMessage(error.message); }
  };
  return <section aria-label="Submitted answer papers" className="glass-panel" style={{padding: '1rem', marginBottom: '1rem'}}>
    <h3>Submitted answer papers</h3>
    {!items.length && <p>No submissions for this batch.</p>}
    {items.map(item => <article key={item.id} style={{padding: '0.75rem', borderBottom: '1px solid var(--glass-border)'}}>
      <p><strong>{item.student_name || `Student #${item.user_id}`}</strong> · {item.phase_id} · {item.assessment_type} · {item.assessment_id} · Version {item.version} · {item.status}</p>
      <button type="button" onClick={() => download(item.id)}>Download answer paper</button>
      {!item.is_latest ? <p>Earlier version; grade the latest submission.</p> : item.status === 'graded' ? <p>Marks: {item.marks}{item.remarks ? ` · ${item.remarks}` : ''}</p> : <form onSubmit={event => grade(event, item)}>
        <label>Marks <input type="number" step="any" min="0" required value={marks[item.id] || ''} onChange={event => setMarks(current => ({...current, [item.id]: event.target.value}))} /></label>
        <label>Feedback <input maxLength="2000" value={remarks[item.id] || ''} onChange={event => setRemarks(current => ({...current, [item.id]: event.target.value}))} /></label>
        <button type="submit">Save marks</button>
      </form>}
    </article>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
