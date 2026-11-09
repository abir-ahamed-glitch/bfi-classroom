import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Clock, History } from 'lucide-react';
import apiClient from '../utils/apiClient';
import './StudentJourney.css';

const dateLabel = value => new Date(value).toLocaleString('en-GB', {
  timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true
});

function Milestones({ events, label }) {
  if (!events.length) return null;
  return <ol className="student-journey-events" aria-label={label}>
    {events.map(event => <li key={event.id}>
      <CheckCircle aria-hidden="true" size={19} />
      <div><strong>{event.title}</strong>
        {event.occurredAt ? <time dateTime={event.occurredAt}>{dateLabel(event.occurredAt)} BST</time>
          : <span className="student-journey-date">Date not recorded</span>}
      </div>
    </li>)}
  </ol>;
}

export default function StudentJourney({ revision }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await apiClient('/api/student/journey', { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load your journey.');
        if (!controller.signal.aborted) setCourses(data.courses);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [revision, retry]);

  return <section className="academic-card student-journey" aria-labelledby="student-journey-title">
    <h3 id="student-journey-title"><History size={20} aria-hidden="true" /> My BFI Journey</h3>
    <p>Your milestones, course by course. Dates are shown in Bangladesh time.</p>
    {loading && <p role="status">Loading your journey…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!loading && !error && !courses.length && <p>Your journey will appear here when you enroll in a course.</p>}
    {!loading && !error && courses.map(course => <article key={course.enrollmentId}>
      <h4>{course.courseName}{course.batchId ? ` · Batch #${course.batchId}` : ''}</h4>
      <Milestones events={course.events.filter(event => event.occurredAt)} label={`${course.courseName} dated milestones`} />
      {course.events.some(event => !event.occurredAt) && <>
        <h5>Achievements without recorded dates</h5>
        <Milestones events={course.events.filter(event => !event.occurredAt)} label={`${course.courseName} undated achievements`} />
      </>}
      {!!course.upcoming.length && <div className="student-journey-next">
        <h5>Next milestones</h5>
        <ul>{course.upcoming.map(event => <li key={event.id}><Clock size={16} aria-hidden="true" />{event.title}</li>)}</ul>
      </div>}
    </article>)}
    {!loading && !error && courses.length > 0 && <Link className="btn btn-secondary" to="/certificates">View my certificates</Link>}
  </section>;
}
