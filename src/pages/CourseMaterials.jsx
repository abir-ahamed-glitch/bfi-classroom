import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookOpen, ExternalLink, FileText, Link2, PlayCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import './CourseMaterials.css';

const types = ['All', 'PDFs', 'Documents', 'Videos', 'Links', 'Other'];
const typeLabels = { PDFs: 'PDF', Documents: 'Document', Videos: 'Video', Links: 'Link', Other: 'File' };
const typeIcons = { PDFs: FileText, Documents: FileText, Videos: PlayCircle, Links: Link2 };

function materialType(material) {
  switch (material.file_type?.toLowerCase() || 'pdf') {
    case 'pdf': return 'PDFs';
    case 'doc':
    case 'docx': return 'Documents';
    case 'video': return 'Videos';
    case 'link':
    case 'url': return 'Links';
    default: return /^https?:\/\//i.test(material.file_url ?? '') ? 'Links' : 'Other';
  }
}

function materialUrl(fileUrl) {
  if (!fileUrl) return null;
  // The catalog supports external HTTP(S) links and existing local file paths.
  if (/^https?:\/\//i.test(fileUrl)) {
    return URL.canParse(fileUrl) ? fileUrl : null;
  }
  if (/^[a-z][\w+.-]*:|^[/\\]{2}|\\/i.test(fileUrl)) return null;

  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  if (fileUrl.startsWith(base.pathname)) return new URL(fileUrl, base).href;
  if (fileUrl.startsWith('/media/')) {
    return new URL(fileUrl, import.meta.env.VITE_API_BASE_URL || base).href;
  }
  return new URL(fileUrl.replace(/^\//, ''), base).href;
}

export default function CourseMaterials({ savedOnly = false }) {
  const { currentUser } = useAuth();
  const isStudent = currentUser?.role === 'student';
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All');
  const [pending, setPending] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const endpoint = savedOnly ? '/api/courses/bookmarks' : '/api/courses';
    (async () => {
      try {
        const response = await apiClient(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load materials');
        const data = await response.json();
        if (!controller.signal.aborted) setMaterials(data.materials);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [savedOnly, retry]);

  async function updateBookmark(material) {
    setPending(material.id);
    setFeedback(null);
    const bookmarked = !material.bookmarked_at;
    try {
      const response = await apiClient(`/api/courses/bookmarks/${material.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarked })
      });
      if (!response.ok) {
        setFeedback({ error: true, text: response.status === 404
          ? 'This material is no longer available.'
          : 'Could not update your library. Please try again.' });
        return;
      }
      const { bookmarked_at } = await response.json();
      setMaterials(previous => savedOnly && !bookmarked_at
        ? previous.filter(item => item.id !== material.id)
        : previous.map(item => item.id === material.id ? { ...item, bookmarked_at } : item));
      setFeedback({ text: bookmarked_at ? 'Saved to My Library.' : 'Removed from My Library.' });
    } catch {
      setFeedback({ error: true, text: 'Could not update your library. Please try again.' });
    } finally {
      setPending(null);
    }
  }

  const search = query.trim().toLowerCase();
  const visible = materials.filter(material =>
    (type === 'All' || type === materialType(material)) &&
    (!search || [material.title, material.course_name].some(value => value?.toLowerCase().includes(search)))
  );

  return (
    <section className="page-container container resource-library" aria-labelledby="resource-library-title">
      <header className="resource-library__header">
        <h1 id="resource-library-title" className="text-gradient font-display">{savedOnly ? 'My Library' : 'Course Materials'}</h1>
        {isStudent && (
          <Link className="btn btn-glass" to={savedOnly ? '/courses' : '/my-library'}>
            {savedOnly ? <BookOpen aria-hidden="true" size={18} /> : <Bookmark aria-hidden="true" size={18} />}
            {savedOnly ? 'Browse course materials' : 'My Library'}
          </Link>
        )}
      </header>

      {loading ? <p role="status">Loading materials…</p> : loadError ? (
        <div className="glass-panel resource-library__empty">
          <p role="alert">Could not load materials.</p>
          <button type="button" className="btn btn-glass" onClick={() => {
            setLoadError(false);
            setLoading(true);
            setRetry(value => value + 1);
          }}>Try again</button>
        </div>
      ) : materials.length === 0 ? (
        <div className="glass-panel resource-library__empty">
          <p>{savedOnly ? 'Your library is empty. Save a resource from Course Materials to find it here.' : 'No course materials are available.'}</p>
        </div>
      ) : (
        <>
          <div className="resource-library__filters">
            <label>
              Search materials
              <input className="input-glass" type="search" value={query}
                onChange={event => setQuery(event.target.value)} placeholder="Title or course" />
            </label>
            <label>
              Resource type
              <select className="input-glass" value={type} onChange={event => setType(event.target.value)}>
                {types.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          {visible.length === 0 ? <p role="status">No materials match your filters.</p> : (
            <ul className="resource-library__list">
              {visible.map(material => {
                const kind = materialType(material);
                const Icon = typeIcons[kind] || BookOpen;
                const href = materialUrl(material.file_url);
                const saved = Boolean(material.bookmarked_at);
                const bookmarkLabel = saved ? 'Remove bookmark' : 'Save bookmark';
                const openLabel = kind === 'Videos' ? 'Watch' : 'Open';
                return (
                  <li key={material.id} className="glass-panel resource-library__row">
                    <Icon className="resource-library__type-icon" aria-hidden="true" size={24} />
                    <div className="resource-library__info">
                      <h2>{material.title}</h2>
                      <p>{[material.course_name, typeLabels[kind]].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="resource-library__actions">
                      {href ? (
                        <a className="btn btn-glass" href={href} target="_blank" rel="noopener noreferrer"
                          aria-label={`${openLabel} ${material.title} (opens in a new tab)`}>
                          {openLabel}<ExternalLink aria-hidden="true" size={16} />
                        </a>
                      ) : <span>Unavailable</span>}
                      {isStudent && (
                        <button type="button" className="btn btn-glass resource-library__bookmark"
                          aria-label={`Bookmark ${material.title}`} aria-pressed={saved} title={bookmarkLabel}
                          disabled={pending !== null} onClick={() => updateBookmark(material)}>
                          <Bookmark aria-hidden="true" size={19} fill={saved ? 'currentColor' : 'none'} />
                          {saved ? 'Saved' : 'Save'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <p role="status" className={feedback?.error ? 'text-danger' : undefined}>{feedback?.text}</p>
    </section>
  );
}
