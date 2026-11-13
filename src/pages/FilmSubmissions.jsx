import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import './FilmSubmissions.css';

const statuses = { under_review: 'Under Review', accepted: 'Accepted', changes_requested: 'Changes Requested' };
const dateLabel = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });

function SubmissionForm({ course, phase, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prefix = `film-${course.enrollmentId}-${phase.id}`;
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError('');
    try {
      const response = await apiClient('/api/film-submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enrollmentId: course.enrollmentId, phaseId: phase.id, title: data.get('title'), videoUrl: data.get('videoUrl'), notes: data.get('notes') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not submit film.');
      form.reset(); await onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="film-form">
    <label htmlFor={`${prefix}-title`}>Film title</label><input id={`${prefix}-title`} name="title" required maxLength={160} />
    <label htmlFor={`${prefix}-url`}>YouTube or Vimeo video link</label><input id={`${prefix}-url`} name="videoUrl" type="url" required maxLength={2048} placeholder="https://…" />
    <p>Use a public or unlisted video that your reviewer can open. Direct video uploads are currently unavailable.</p>
    <label htmlFor={`${prefix}-notes`}>Notes for your reviewer (optional)</label><textarea id={`${prefix}-notes`} name="notes" maxLength={2000} />
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit film for review'}</button>
  </form>;
}

function ReviewForm({ submission, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function review(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const response = await apiClient(`/api/film-submissions/${submission.id}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data)) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save review.');
      await onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={review} className="film-form">
    <label htmlFor={`outcome-${submission.id}`}>Review outcome</label>
    <select id={`outcome-${submission.id}`} name="status"><option value="accepted">Accepted</option><option value="changes_requested">Changes Requested</option></select>
    <label htmlFor={`feedback-${submission.id}`}>Feedback (required when requesting changes)</label>
    <textarea id={`feedback-${submission.id}`} name="feedback" maxLength={2000} />
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button>
  </form>;
}

export default function FilmSubmissions() {
  const { currentUser } = useAuth();
  const [params] = useSearchParams();
  const batch = params.get('batch_id');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient(`/api/film-submissions${batch ? `?batch_id=${encodeURIComponent(batch)}` : ''}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load films.');
      setData(result);
    } catch (err) { setError(err.message); }
  }, [batch]);
  useEffect(() => { load(); }, [load]);
  const student = currentUser?.role === 'student';
  return <div className="page-container container film-portal">
    <h1>Film Submission Portal</h1>
    <p>{student ? 'Share your film with BFI and follow its review here.' : 'Review student films and provide feedback.'}</p>
    <Link to={student ? '/student-portal' : '/admin/batchmanager'}>← {student ? 'My Student Panel' : 'Batch Manager'}</Link>
    {error && <div role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={load}>Try again</button></div>}
    {!data && !error && <p role="status">Loading films…</p>}
    {data && !data.courses.length && <p>{student ? 'No film submission phases are available for your courses yet.' : 'No student films have been submitted in this view yet.'}</p>}
    {data?.courses.map(course => <section className="academic-card film-course" key={course.enrollmentId}>
      <h2>{course.courseName}{course.batchId ? ` · Batch #${course.batchId}` : ''}</h2>
      {!student && <p>Student: {course.studentName?.first_name} {course.studentName?.last_name}</p>}
      {course.phases.map(phase => {
        const history = course.submissions.filter(item => item.phase_id === phase.id);
        const latest = history[0];
        return <article key={phase.id} className="film-phase">
          <h3>{phase.title}</h3>
          {history.map(submission => <div key={submission.id} className="film-submission">
            <h4>{submission.title} · Version {submission.revision}</h4>
            <p><strong className={`film-status ${submission.status}`}>{statuses[submission.status]}</strong> · Submitted {dateLabel(submission.submitted_at)} BST</p>
            <a href={submission.video_url} target="_blank" rel="noopener noreferrer">Watch submitted film ↗</a>
            {submission.notes && <p>{submission.notes}</p>}
            {submission.feedback && <p><strong>Reviewer feedback:</strong> {submission.feedback}</p>}
            {submission.reviewed_at && <p>Reviewed {dateLabel(submission.reviewed_at)} BST</p>}
            {data.canReview && submission.status === 'under_review' && <ReviewForm submission={submission} onSaved={load} />}
          </div>)}
          {student && (!latest || latest.status === 'changes_requested') && (phase.eligible ? <SubmissionForm course={course} phase={phase} onSaved={load} /> : <p>{phase.blockedReason || 'Submission opens when you are admitted to this phase.'}</p>)}
          {student && phase.completed && <p>Practical filmmaking completed. <Link to="/certificates">Check certificate eligibility</Link>.</p>}
          {!student && !latest && <p>No film submitted yet.</p>}
        </article>;
      })}
    </section>)}
  </div>;
}
