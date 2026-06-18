import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell, Check, Eye, Flag, Image as ImageIcon, MessageSquare, Search, ShieldCheck, X, XCircle,
} from 'lucide-react';
import { resolveMediaUrl } from '../../utils/mediaUtils';
import './Reports.css';

const STATUS_FILTERS = ['all', 'pending', 'reviewed', 'resolved', 'dismissed'];
const TYPE_FILTERS = ['all', 'message', 'comment', 'post', 'profile'];

function reportDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeAgo(value) {
  const date = reportDate(value);
  if (!date) return 'Unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString();
}

function reportDateTime(value) {
  return reportDate(value)?.toLocaleString() || 'Unknown';
}

function displayName(value, fallback = 'Unknown user') {
  return String(value || '').trim() || fallback;
}

function unavailableSnapshot(value) {
  const snapshot = String(value || '').trim();
  return !snapshot || snapshot.startsWith('e2e:v1:');
}

function snapshotPreview(value) {
  if (unavailableSnapshot(value)) return null;
  const snapshot = String(value).trim();
  return snapshot.length > 80 ? `${snapshot.slice(0, 80)}...` : snapshot;
}

function Avatar({ src, name }) {
  if (src) {
    return <img className="reports-avatar" src={resolveMediaUrl(src)} alt="" />;
  }
  return <span className="reports-avatar reports-avatar-fallback">{displayName(name).charAt(0).toUpperCase()}</span>;
}

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, reviewed: 0, resolved: 0, dismissed: 0 });
  const [statusFilter, setStatusFilter] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('status');
    return STATUS_FILTERS.includes(requested) ? requested : 'all';
  });
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [adminNote, setAdminNote] = useState('');
  const [actionTarget, setActionTarget] = useState(null);
  const [actionNote, setActionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const fetchReports = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/reports/admin/all?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load reports.');
      setReports(data.reports || []);
      setCounts(data.counts || { pending: 0, reviewed: 0, resolved: 0, dismissed: 0 });
    } catch (fetchError) {
      setError(fetchError.message || 'Failed to load reports.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, statusFilter, typeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(fetchReports, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchReports, search]);

  useEffect(() => {
    const refreshReports = () => fetchReports({ silent: true });
    const interval = window.setInterval(refreshReports, 10000);
    const handleFocus = () => refreshReports();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshReports();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchReports]);

  useEffect(() => {
    if (!selectedReport) return undefined;
    setAdminNote(selectedReport.admin_note || '');
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !saving) setSelectedReport(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedReport, saving]);

  useEffect(() => {
    if (!selectedReport?.screenshot_path) {
      setScreenshotUrl('');
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    fetch(resolveMediaUrl(selectedReport.screenshot_path), {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Screenshot unavailable');
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setScreenshotUrl(objectUrl);
      })
      .catch(() => active && setScreenshotUrl(''));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedReport?.screenshot_path]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const close = (event) => event.key === 'Escape' && setLightboxOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [lightboxOpen]);

  const summary = useMemo(
    () => `${counts.pending} Pending · ${counts.reviewed} Reviewed · ${counts.resolved} Resolved`,
    [counts],
  );

  const applyAction = async (report, action, note = '') => {
    if (!report || saving) return;
    const previous = reports;
    const nextReport = {
      ...report,
      status: action,
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    };
    setReports((items) => items.map((item) => item.id === report.id ? nextReport : item));
    setSelectedReport((current) => current?.id === report.id ? nextReport : current);
    setSaving(true);
    try {
      const response = await fetch(`/api/reports/admin/${report.id}/action`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ action, admin_note: note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to update report.');
      setActionTarget(null);
      setActionNote('');
      await fetchReports();
    } catch (actionError) {
      setReports(previous);
      setError(actionError.message || 'Failed to update report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reports-page">
      <header className="reports-page-header">
        <div>
          <h1><Flag size={26} /> Reports</h1>
          <p>Review and act on user-submitted reports</p>
        </div>
        <div className="reports-summary">{summary}</div>
      </header>

      <section className="reports-filter-panel">
        <div className="reports-filter-group">
          <span>Status</span>
          <div className="reports-tabs">
            {STATUS_FILTERS.map((status) => (
              <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>
                {status}
              </button>
            ))}
          </div>
        </div>
        <div className="reports-filter-group">
          <span>Type</span>
          <div className="reports-tabs">
            {TYPE_FILTERS.map((type) => (
              <button key={type} className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)}>
                {type}
              </button>
            ))}
          </div>
        </div>
        <label className="reports-search">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reporter or reported user..." />
        </label>
      </section>

      {error && <div className="reports-error">{error}</div>}

      <section className="reports-table-shell">
        {loading ? (
          <div className="reports-skeleton-list">
            {Array.from({ length: 6 }).map((_, index) => <div className="reports-skeleton-row" key={index} />)}
          </div>
        ) : reports.length === 0 ? (
          <div className="reports-empty">
            <Flag size={34} />
            <strong>No reports found</strong>
          </div>
        ) : (
          <div className="reports-table-scroll">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>#</th><th>Type</th><th>Reported Content</th><th>Reported User</th>
                  <th>Reported By</th><th>Reason</th><th>Date</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report, index) => (
                  <tr key={report.id}>
                    <td>{index + 1}</td>
                    <td><span className={`report-type-badge ${report.content_type}`}>{report.content_type}</span></td>
                    <td className="reports-preview">
                      {snapshotPreview(report.content_snapshot) || (
                        <em style={{ color: 'var(--text-muted)' }}>[Encrypted — content not available]</em>
                      )}
                    </td>
                    <td>
                      <div className="reports-person">
                        <Avatar src={report.reported_user_avatar} name={report.reported_user_name} />
                        <span>{displayName(report.reported_user_name)}</span>
                      </div>
                    </td>
                    <td>{displayName(report.reporter_name)}</td>
                    <td>{report.reason_category}</td>
                    <td>{timeAgo(report.created_at)}</td>
                    <td><span className={`report-status-badge ${report.status}`}>{report.status}</span></td>
                    <td>
                      <div className="reports-row-actions">
                        <button title="View" onClick={() => setSelectedReport(report)}><Eye size={15} /></button>
                        <button title="Resolve" className="resolve" onClick={() => { setActionTarget({ report, action: 'resolved' }); setActionNote(''); }}><Check size={15} /></button>
                        <button title="Dismiss" className="dismiss" onClick={() => { setActionTarget({ report, action: 'dismissed' }); setActionNote(''); }}><XCircle size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {actionTarget && (
        <div className="reports-confirm-layer" onMouseDown={(event) => event.target === event.currentTarget && setActionTarget(null)}>
          <div className="reports-confirm-popover">
            <h3>{actionTarget.action === 'resolved' ? 'Resolve report' : 'Dismiss report'}</h3>
            <label>
              <span>Add a note (optional)</span>
              <input value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={1000} autoFocus />
            </label>
            <div>
              <button onClick={() => setActionTarget(null)}>Cancel</button>
              <button className={actionTarget.action} onClick={() => applyAction(actionTarget.report, actionTarget.action, actionNote)} disabled={saving}>
                {saving ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedReport && (
        <div className="reports-drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && setSelectedReport(null)}>
          <aside className="reports-drawer">
            <header>
              <div>
                <span className={`report-type-badge ${selectedReport.content_type}`}>{selectedReport.content_type}</span>
                <h2>Report #{selectedReport.id}</h2>
              </div>
              <button onClick={() => setSelectedReport(null)} aria-label="Close"><X size={20} /></button>
            </header>
            <div className="reports-drawer-body">
              <section className="reports-detail-grid">
                <div><span>Reported by</span><strong>{displayName(selectedReport.reporter_name)}</strong></div>
                <div><span>Reported user</span><strong>{displayName(selectedReport.reported_user_name)}</strong></div>
                <div><span>Submitted</span><strong>{reportDateTime(selectedReport.created_at)}</strong></div>
                <div><span>Status</span><strong className={`report-status-badge ${selectedReport.status}`}>{selectedReport.status}</strong></div>
              </section>

              <section className="reports-detail-block">
                <h3>Reason</h3>
                <strong>{selectedReport.reason_category}</strong>
              </section>

              <section className="reports-detail-block">
                <h3>Reported content</h3>
                {unavailableSnapshot(selectedReport.content_snapshot) ? (
                  <p
                    className="reports-full-content"
                    style={{
                      border: '1px solid rgba(245, 158, 11, 0.28)',
                      color: '#d99a2b',
                      background: 'rgba(245, 158, 11, 0.08)',
                    }}
                  >
                    This message was end-to-end encrypted and cannot be displayed. The reporter&apos;s reason and explanation below are the only available context.
                  </p>
                ) : (
                  <p className="reports-full-content">{selectedReport.content_snapshot}</p>
                )}
                {selectedReport.content_type === 'profile' && (
                  <a href={`/profile/${selectedReport.reported_user_id}`}>Open reported profile</a>
                )}
              </section>

              {selectedReport.screenshot_path && screenshotUrl && (
                <section className="reports-detail-block reports-screenshot-block">
                  <h3><ImageIcon size={16} /> Attached Screenshot</h3>
                  <button type="button" onClick={() => setLightboxOpen(true)}>
                    <img src={screenshotUrl} alt="Attached report screenshot" />
                  </button>
                </section>
              )}

              <section className="reports-detail-block">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <MessageSquare size={16} /> Reporter&apos;s Explanation
                </h3>
                {String(selectedReport.reason_detail || '').trim() ? (
                  <p
                    className="reports-full-content"
                    style={{ borderLeft: '3px solid var(--accent-primary)' }}
                  >
                    {selectedReport.reason_detail}
                  </p>
                ) : (
                  <p><em style={{ color: 'var(--text-muted)' }}>No additional explanation was provided.</em></p>
                )}
              </section>

              <label className="reports-admin-note">
                <span>Admin note</span>
                <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value.slice(0, 1000))} rows={5} placeholder="Internal note for this report..." />
              </label>

              <section className="reports-history">
                <h3>Report history</h3>
                <p><Flag size={14} /> Submitted {reportDateTime(selectedReport.created_at)}</p>
                {(selectedReport.history_events || []).map((event, index) => (
                  <div className="reports-history-event" key={`${event.at}-${index}`}>
                    <p><ShieldCheck size={14} /> {
                      event.action === 'reviewed' ? 'Marked as Reviewed' : event.action === 'resolved' ? 'Resolved' : 'Dismissed'
                    } by {event.admin_name} · {reportDateTime(event.at)}</p>
                    <p><Bell size={14} /> {
                      event.notification_recipients?.length === 1
                        ? 'Notification sent to reporter'
                        : 'Notifications sent to reporter and reported user'
                    } · {reportDateTime(event.at)}</p>
                  </div>
                ))}
              </section>
            </div>
            <footer>
              <button onClick={() => applyAction(selectedReport, 'reviewed', adminNote)} disabled={saving}>Mark as Reviewed</button>
              <button className="resolve" onClick={() => applyAction(selectedReport, 'resolved', adminNote)} disabled={saving}>Resolve</button>
              <button className="dismiss" onClick={() => applyAction(selectedReport, 'dismissed', adminNote)} disabled={saving}>Dismiss</button>
            </footer>
          </aside>
        </div>
      )}

      {lightboxOpen && screenshotUrl && (
        <div className="reports-lightbox" onMouseDown={(event) => event.target === event.currentTarget && setLightboxOpen(false)}>
          <button type="button" onClick={() => setLightboxOpen(false)} aria-label="Close screenshot"><X size={24} /></button>
          <img src={screenshotUrl} alt="Attached report screenshot full size" />
        </div>
      )}
    </div>
  );
}
