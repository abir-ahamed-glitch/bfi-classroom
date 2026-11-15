import { useState } from 'react';
import { Clock3, ExternalLink } from 'lucide-react';
import apiClient from '../utils/apiClient';

function parseTimecode(value) {
  const text = value.trim();
  if (!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(text)) return null;
  const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return seconds <= 359999 ? seconds : null;
}

function formatTimecode(total) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function videoLinkAtTime(value, seconds) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
      url.hash = `t=${Math.floor(seconds / 60)}m${seconds % 60}s`;
      return url.href;
    }

    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.split('/')[2];
    }
    return /^[\w-]{11}$/.test(id ?? '')
      ? `https://www.youtube.com/watch?v=${id}&t=${seconds}s`
      : null;
  } catch {
    return null;
  }
}

export default function FilmTimestampFeedback({ submission, canWrite, onAdded, dateLabel }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const prefix = `film-note-${submission.id}`;

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const videoSeconds = parseTimecode(data.get('timecode'));
    const note = data.get('note').trim();
    setSaved(false);
    setError('');
    if (videoSeconds === null || !note) {
      setError(videoSeconds === null ? 'Enter a video time like 2:14 or 1:02:14.' : 'Write a feedback note.');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient(`/api/film-submissions/${submission.id}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoSeconds, note })
      });
      const item = await response.json();
      if (!response.ok) throw new Error(item.error || 'Could not save the feedback note.');
      onAdded(item);
      form.reset();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const notes = submission.timestamped_feedback ?? [];
  return <section className="film-timestamp-feedback" aria-labelledby={`${prefix}-heading`}>
    <h5 id={`${prefix}-heading`}>Timestamped feedback</h5>
    {notes.length > 0 ? <ol className="film-feedback-notes">
      {notes.map(item => {
        const time = formatTimecode(item.video_seconds);
        const link = videoLinkAtTime(submission.video_url, item.video_seconds);
        return <li key={item.id}>
          <div className="film-feedback-note-meta">
            {link ? <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Watch at ${time} (opens in a new tab)`}>
              <Clock3 size={16} aria-hidden="true" /> {time} <ExternalLink size={14} aria-hidden="true" />
            </a> : <strong>{time}</strong>}
            <span>{item.author_name || 'Former reviewer'} · {dateLabel(item.created_at)} BST</span>
          </div>
          <p>{item.note}</p>
        </li>;
      })}
    </ol> : <p>No timestamped notes yet.</p>}

    {canWrite && <form className="film-form" onSubmit={submit}>
      <label htmlFor={`${prefix}-time`}>Video time</label>
      <input id={`${prefix}-time`} name="timecode" maxLength={9} placeholder="2:14"
        aria-describedby={`${prefix}-time-help`} required />
      <small id={`${prefix}-time-help`}>Use minutes:seconds or hours:minutes:seconds.</small>
      <label htmlFor={`${prefix}-note`}>Feedback note</label>
      <textarea id={`${prefix}-note`} name="note" maxLength={2000} required />
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="btn btn-secondary" disabled={saving}>{saving ? 'Posting…' : 'Post feedback'}</button>
      {saved && <p role="status">Feedback posted.</p>}
    </form>}
  </section>;
}
