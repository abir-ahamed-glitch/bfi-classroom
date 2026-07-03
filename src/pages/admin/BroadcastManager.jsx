import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Megaphone, History, Send, Clock, ChevronDown, ChevronUp,
  X, Eye, Copy, Trash2, Users, BookOpen, Edit3, AlertTriangle,
  Bell, FileText, Inbox, Shield, Check, RefreshCw, Calendar,
  Bold, Italic, List, Paperclip, Loader, User, Radio, File, Layers, GraduationCap
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useModal } from '../../components/BFIModal';
import { resolveMediaUrl } from '../../utils/mediaUtils';
import './BroadcastManager.css';

const API_BASE = '/api/admin/broadcast';
const token = () => localStorage.getItem('token');
const authHeader = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function getStatusClass(s) {
  return {
    sent: 'bc-status-sent',
    published: 'bc-status-sent',
    scheduled: 'bc-status-scheduled',
    draft: 'bc-status-draft',
    failed: 'bc-status-failed',
    sending: 'bc-status-sending',
  }[s] || 'bc-status-draft';
}

function audienceBadgeLabel(type, value) {
  if (type === 'all') return 'All Students';
  if (type === 'batch') return `Batch ${value}`;
  if (type === 'course') return value || 'Course';
  if (type === 'specific') {
    const ids = (value || '').split(',').filter(Boolean);
    return `${ids.length} Student${ids.length !== 1 ? 's' : ''}`;
  }
  return type;
}

const parseAttachment = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch (e) {
      // ignore
    }
  }
  return {
    name: 'attachment.png',
    type: 'image/png',
    url: value
  };
};

// ─── Preview Modal ─────────────────────────────────────────────────
function PreviewModal({ form, deliveryType, noticeAttachment, onClose }) {
  const [tab, setTab] = useState(deliveryType === 'notice' ? 'notice' : 'inbox');

  return (
    <div className="bc-modal-overlay" onClick={onClose}>
      <div className="bc-modal" onClick={e => e.stopPropagation()}>
        <div className="bc-modal-header">
          <span className="bc-modal-title"><Eye size={16} style={{ marginRight: 6 }} />Message Preview</span>
          <button type="button" className="bc-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="bc-modal-body">
          {deliveryType === 'broadcast' ? (
            <>
              <div className="bc-preview-tabs">
                {[['inbox', <Inbox size={14} />, 'Inbox'], ['notification', <Bell size={14} />, 'Notification'], ['notice', <Megaphone size={14} />, 'Notice Board']].map(([id, icon, label]) => (
                  <button key={id} type="button" className={`bc-preview-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                    {icon} {label}
                  </button>
                ))}
              </div>

              {tab === 'inbox' && (
                <div className="bc-preview-inbox">
                  <div className="bc-preview-inbox-header">
                    <div className="bc-preview-avatar">A</div>
                    <div>
                      <div className="bc-preview-subject">{form.title || '(No title)'}</div>
                      <div className="bc-preview-from">From: Admin · Broadcast Message</div>
                    </div>
                  </div>
                  <div className="bc-preview-inbox-body">{form.message || '(No message)'}</div>
                  {!form.allow_reply && (
                    <div style={{ marginTop: '1rem', padding: '0.6rem 0.9rem', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      📢 This is a broadcast message. Replies are not enabled.
                    </div>
                  )}
                </div>
              )}

              {tab === 'notification' && (
                <div className="bc-preview-notif">
                  <div className={`bc-preview-notif-icon ${form.priority === 'urgent' ? 'urgent' : 'normal'}`}>
                    {form.priority === 'urgent' ? <AlertTriangle size={18} /> : <Megaphone size={18} />}
                  </div>
                  <div>
                    <div className="bc-preview-notif-title">{form.title || '(No title)'}</div>
                    <div className="bc-preview-notif-body">
                      {(form.message || '').substring(0, 120)}{form.message?.length > 120 ? '... read more' : ''}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'notice' && (
                <div className="bc-preview-notice">
                  <div className="bc-preview-notice-header">
                    <div className={`bc-preview-notice-icon ${form.priority === 'urgent' ? 'urgent' : ''}`}>
                      {form.priority === 'urgent' ? <AlertTriangle size={20} /> : <Megaphone size={20} />}
                    </div>
                    <div>
                      <div className="bc-preview-notice-title">{form.title || '(No title)'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem', marginTop: 2 }}>
                        <span style={{ padding: '1px 8px', borderRadius: 20, background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)', fontSize: '0.65rem', fontWeight: 700 }}>📣 Broadcast</span>
                        {form.priority === 'urgent' && <span style={{ padding: '1px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.65rem', fontWeight: 700 }}>URGENT</span>}
                      </div>
                    </div>
                  </div>
                  <div className="bc-preview-notice-body">{form.message || '(No message)'}</div>
                </div>
              )}
            </>
          ) : (
            <div className="bc-preview-notice">
              <div className="bc-preview-notice-header">
                <div className={`bc-preview-notice-icon ${form.priority === 'high' ? 'urgent' : ''}`}>
                  {form.priority === 'high' ? <AlertTriangle size={20} /> : <Megaphone size={20} />}
                </div>
                <div>
                  <div className="bc-preview-notice-title">{form.title || '(No title)'}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem', marginTop: 2 }}>
                    <span style={{ padding: '1px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)', fontSize: '0.65rem', fontWeight: 700 }}>Standard Notice</span>
                    {form.priority === 'high' && <span style={{ padding: '1px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.65rem', fontWeight: 700 }}>HIGH PRIORITY</span>}
                  </div>
                </div>
              </div>
              <div className="bc-preview-notice-body" style={{ whiteSpace: 'pre-wrap' }}>{form.message || '(No content)'}</div>
              {noticeAttachment && (
                <div className="bc-file-pill" style={{ marginTop: '1rem' }}>
                  <FileText size={14} />
                  <span className="bc-file-pill-name">{noticeAttachment.name}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Broadcast Detail Drawer ────────────────────────────────────────
function BroadcastDrawer({ broadcastId, unifiedType, onClose, onDuplicate, onDeleteNotice, onSendSuccess }) {
  const { showAlert, showConfirm } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);

  useEffect(() => {
    if (!broadcastId) return;
    if (unifiedType === 'notice') {
      // For standard notices, we already have details, or can fetch all or single
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/${broadcastId}`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [broadcastId, unifiedType]);

  const handleRetry = async () => {
    if (!data?.broadcast) return;
    await fetch(`${API_BASE}/${broadcastId}/retry`, { method: 'POST', headers: authHeader() });
    const r = await fetch(`${API_BASE}/${broadcastId}`, { headers: authHeader() });
    setData(await r.json());
  };

  const handleCancelSchedule = async () => {
    if (!data?.broadcast) return;
    await fetch(`${API_BASE}/${broadcastId}/cancel`, { method: 'POST', headers: authHeader() });
    onClose();
  };

  const handleSendDraft = async () => {
    if (!data?.broadcast) return;
    setSendingDraft(true);
    try {
      const sendRes = await fetch(`${API_BASE}/${broadcastId}/send`, {
        method: 'POST',
        headers: authHeader(),
      });
      const sendData = await sendRes.json();
      if (sendData.success) {
        const r = await fetch(`${API_BASE}/${broadcastId}`, { headers: authHeader() });
        setData(await r.json());
        if (onSendSuccess) {
          onSendSuccess(`Sending to ${sendData.total_recipients} students... ✓`);
        }
      } else {
        await showAlert(sendData.error || 'Failed to send broadcast', { title: 'Broadcast Failed' });
      }
    } catch {
      await showAlert('Failed to send broadcast', { title: 'Broadcast Failed' });
    }
    setSendingDraft(false);
  };

  const handleDeleteDraft = async () => {
    if (!data?.broadcast) return;
    const confirm = await showConfirm(
      `Are you sure you want to delete the draft "${data.broadcast.title}"?`,
      { title: 'Delete Draft', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
    if (!confirm) return;

    setDeletingDraft(true);
    try {
      const res = await fetch(`${API_BASE}/${broadcastId}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const resData = await res.json();
      if (resData.success) {
        onClose();
        if (onSendSuccess) {
          onSendSuccess('Draft deleted successfully.');
        }
      } else {
        await showAlert(resData.error || 'Failed to delete draft', { title: 'Delete Failed' });
      }
    } catch {
      await showAlert('Failed to delete draft', { title: 'Delete Failed' });
    }
    setDeletingDraft(false);
  };

  return (
    <div className="bc-drawer-overlay" onClick={onClose}>
      <div className="bc-drawer" onClick={e => e.stopPropagation()}>
        <div className="bc-drawer-header">
          <span className="bc-drawer-title">{unifiedType === 'notice' ? 'Announcement Details' : 'Broadcast Details'}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="bc-icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className="bc-drawer-body">
          {unifiedType === 'notice' ? (
            <NoticeDetailView broadcastId={broadcastId} onClose={onClose} onDeleteNotice={onDeleteNotice} />
          ) : (
            <>
              {loading ? (
                <div className="bc-empty-state"><div className="bc-spinner" /></div>
              ) : !data?.broadcast ? (
                <div className="bc-empty-state"><p>Failed to load broadcast.</p></div>
              ) : (
                <>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{data.broadcast.title}</h3>
                      <span className={`bc-status-badge ${getStatusClass(data.broadcast.status)}`}>{data.broadcast.status}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <span>From: {data.broadcast.sender_name}</span>
                      <span>Audience: {audienceBadgeLabel(data.broadcast.audience_type, data.broadcast.audience_value)}</span>
                      {data.broadcast.priority === 'urgent' && <span style={{ color: '#f87171' }}>🚨 Urgent</span>}
                      {data.broadcast.sent_at && <span>Sent: {timeAgo(data.broadcast.sent_at)}</span>}
                      {data.broadcast.scheduled_at && data.broadcast.status === 'scheduled' && <span style={{ color: '#60a5fa' }}>⏰ {new Date(data.broadcast.scheduled_at).toLocaleString()}</span>}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '1rem', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                    {data.broadcast.message}
                  </div>

                  {data.attachments?.length > 0 && (
                    <div>
                      <div className="bc-label" style={{ marginBottom: '0.5rem' }}>Attachments</div>
                      {data.attachments.map(att => (
                        <div key={att.id} className="bc-file-pill">
                          <FileText size={14} />
                          <span className="bc-file-pill-name">{att.file_name}</span>
                          <span className="bc-file-pill-size">{formatBytes(att.file_size)}</span>
                          <a href={resolveMediaUrl(att.file_path)} download target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', display: 'flex' }}>
                            <ChevronDown size={14} />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.delivery_stats && data.broadcast.status !== 'draft' && (
                    <div className="bc-stats-section">
                      <div className="bc-label" style={{ marginBottom: 0 }}>Delivery Statistics</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        {[['Total', data.delivery_stats.total], ['Delivered', data.delivery_stats.delivered], ['Failed', data.delivery_stats.failed]].map(([l, v]) => (
                          <div key={l} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.6rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{v || 0}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{l}</div>
                          </div>
                        ))}
                      </div>
                      {[
                        ['📥 Inbox', data.delivery_stats.inbox_rate, data.delivery_stats.inbox_delivered, data.delivery_stats.total, 'bc-stat-fill-inbox'],
                        ['🔔 Notification', data.delivery_stats.notification_rate, data.delivery_stats.notif_delivered, data.delivery_stats.total, 'bc-stat-fill-notif'],
                        ['📋 Notice Board', data.delivery_stats.notice_rate, data.delivery_stats.notice_delivered, data.delivery_stats.total, 'bc-stat-fill-notice'],
                      ].map(([label, rate, count, total, cls]) => (
                        <div key={label} className="bc-stat-row">
                          <div className="bc-stat-label-row">
                            <span>{label}</span>
                            <strong>{count || 0}/{total || 0} ({rate || '0%'})</strong>
                          </div>
                          <div className="bc-stat-bar">
                            <div className={`bc-stat-fill ${cls}`} style={{ width: rate || '0%' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.failed_recipients?.length > 0 && (
                    <div>
                      <div className="bc-label" style={{ marginBottom: '0.5rem', color: '#f87171' }}>Failed Deliveries ({data.failed_recipients.length})</div>
                      {data.failed_recipients.map(fr => (
                        <div key={fr.student_id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(239,68,68,0.06)',
                          border: '1px solid rgba(239,68,68,0.15)',
                          borderRadius: 8,
                          fontSize: '0.8rem',
                          marginBottom: '0.4rem',
                          gap: '0.5rem'
                        }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{fr.name}</strong>
                            {fr.failed_reason && <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>— {fr.failed_reason}</span>}
                          </div>
                          <button
                            type="button"
                            className="bc-btn bc-btn-outline"
                            style={{
                              padding: '2px 8px',
                              fontSize: '0.68rem',
                              height: 'auto',
                              borderColor: 'rgba(239,68,68,0.3)',
                              color: '#f87171',
                              background: 'transparent'
                            }}
                            onClick={async () => {
                              try {
                                const res = await fetch(`${API_BASE}/${broadcastId}/retry-single`, {
                                  method: 'POST',
                                  headers: { ...authHeader(), 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ student_id: fr.student_id })
                                });
                                const rData = await res.json();
                                if (rData.success) {
                                  const fresh = await fetch(`${API_BASE}/${broadcastId}`, { headers: authHeader() });
                                  setData(await fresh.json());
                                }
                              } catch (err) {
                                console.error('Failed to retry student', err);
                              }
                            }}
                          >
                            Resend
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.delivered_recipients?.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                      <div className="bc-label" style={{ marginBottom: '0.5rem', color: '#34d399' }}>Delivered Recipients ({data.delivered_recipients.length})</div>
                      <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '4px' }}>
                        {data.delivered_recipients.map(dr => {
                          const channelsList = [];
                          if (dr.inbox_delivered) channelsList.push('Inbox');
                          if (dr.notification_delivered) channelsList.push('Notif');
                          if (dr.notice_delivered) channelsList.push('Notice');

                          return (
                            <div key={dr.student_id} style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.5rem 0.75rem',
                              background: 'rgba(52,211,153,0.04)',
                              border: '1px solid rgba(52,211,153,0.12)',
                              borderRadius: 8,
                              fontSize: '0.8rem'
                            }}>
                              <div>
                                <strong style={{ color: 'var(--text-primary)' }}>{dr.name}</strong>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', marginLeft: 8 }}>
                                  via {channelsList.join(', ')}
                                </span>
                              </div>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                {dr.delivered_at ? new Date(dr.delivered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                    {data.broadcast.status === 'draft' && (
                      <>
                        <button type="button" className="bc-btn bc-btn-primary" onClick={handleSendDraft} disabled={sendingDraft || deletingDraft}>
                          {sendingDraft ? <span className="bc-spinner" /> : <Send size={14} />} Send Broadcast Now
                        </button>
                        <button type="button" className="bc-btn bc-btn-danger" onClick={handleDeleteDraft} disabled={sendingDraft || deletingDraft}>
                          {deletingDraft ? <span className="bc-spinner" /> : <Trash2 size={14} />} Delete Draft
                        </button>
                      </>
                    )}
                    {data.delivery_stats?.failed > 0 && (
                      <button type="button" className="bc-btn bc-btn-outline" onClick={handleRetry}>
                        <RefreshCw size={14} /> Resend to Failed ({data.delivery_stats.failed})
                      </button>
                    )}
                    {data.broadcast.status === 'scheduled' && (
                      <button type="button" className="bc-btn bc-btn-danger" onClick={handleCancelSchedule}>
                        <X size={14} /> Cancel Schedule
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notice Detail View Sub-component ───────────────────────────────
function NoticeDetailView({ broadcastId, onClose, onDeleteNotice }) {
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/announcements', {
      headers: { Authorization: `Bearer ${token()}` }
    })
      .then(r => r.json())
      .then(d => {
        const item = (d.announcements || []).find(a => a.id === broadcastId);
        setNotice(item);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [broadcastId]);

  if (loading) return <div className="bc-empty-state"><div className="bc-spinner" /></div>;
  if (!notice) return <div className="bc-empty-state"><p>Notice not found.</p></div>;

  const att = parseAttachment(notice.image_url);

  return (
    <>
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{notice.title}</h3>
          <span className={`bc-status-badge ${notice.scheduled_at && new Date(notice.scheduled_at) > new Date() ? 'bc-status-scheduled' : 'bc-status-sent'}`}>
            {notice.scheduled_at && new Date(notice.scheduled_at) > new Date() ? 'scheduled' : 'published'}
          </span>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <span>From: {notice.admin_name || 'Admin'}</span>
          {(notice.target_course || notice.target_batch) ? (
            <span>Target: {notice.target_course ? notice.target_course : ''} {notice.target_batch ? `(Batch ${notice.target_batch})` : ''}</span>
          ) : (
            <span>Target: All Students</span>
          )}
          <span>Priority: <span style={{ color: notice.priority === 'high' ? '#f87171' : 'var(--text-secondary)' }}>{notice.priority}</span></span>
          {notice.created_at && <span>Posted: {timeAgo(notice.created_at)}</span>}
          {notice.scheduled_at && <span>Scheduled: {new Date(notice.scheduled_at).toLocaleString()}</span>}
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '1rem', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
        {notice.content}
      </div>

      {att && (
        <div>
          <div className="bc-label" style={{ marginBottom: '0.5rem' }}>Attachment</div>
          <div className="bc-file-pill">
            <FileText size={14} />
            <span className="bc-file-pill-name">{att.name}</span>
            <a href={att.url} download={att.name} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', display: 'flex' }}>
              <ChevronDown size={14} />
            </a>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
        <button type="button" className="bc-btn bc-btn-danger" onClick={() => onDeleteNotice(notice.id, notice.title)}>
          <Trash2 size={14} /> Delete Notice
        </button>
      </div>
    </>
  );
}

// ─── Teacher Permissions Panel ──────────────────────────────────────
function PermissionsPanel() {
  const { showConfirm } = useModal();
  const [open, setOpen] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [grantModal, setGrantModal] = useState(false);
  const [grantForm, setGrantForm] = useState({ teacher_id: '', can_send_to: 'all' });
  const [granting, setGranting] = useState(false);

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/permissions`, { headers: authHeader() });
      const d = await r.json();
      setTeachers(d.teachers || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchTeachers();
  }, [open, fetchTeachers]);

  const handleGrant = async () => {
    if (!grantForm.teacher_id) return;
    setGranting(true);
    try {
      const r = await fetch(`${API_BASE}/permissions`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify(grantForm),
      });
      if (r.ok) {
        setGrantModal(false);
        setGrantForm({ teacher_id: '', can_send_to: 'all' });
        fetchTeachers();
      }
    } catch { /* ignore */ }
    setGranting(false);
  };

  const handleRevoke = async (teacherId, name) => {
    if (!await showConfirm('Revoke Access', `Revoke broadcast access for ${name}?`, 'danger')) return;
    await fetch(`${API_BASE}/permissions/${teacherId}`, { method: 'DELETE', headers: authHeader() });
    fetchTeachers();
  };

  const unGrantedTeachers = teachers.filter(t => !t.is_active);

  return (
    <div className="bc-permissions-section">
      <div className="bc-permissions-header" onClick={() => setOpen(o => !o)}>
        <span className="bc-permissions-title"><Shield size={14} /> Teacher Broadcast Permissions</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      {open && (
        <div style={{ padding: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
            <button type="button" className="bc-btn bc-btn-primary" style={{ flex: 'none', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setGrantModal(true)}>
              + Grant Access
            </button>
          </div>
          {loading ? (
            <div style={{ padding: '1.5rem', textAlign: 'center' }}><div className="bc-spinner" style={{ margin: '0 auto' }} /></div>
          ) : teachers.length === 0 ? (
            <p style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>No instructors found.</p>
          ) : (
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table className="bc-permissions-table">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Status</th>
                    <th>Scope</th>
                    <th>Granted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map(t => (
                    <tr key={t.id}>
                      <td style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {t.profile_picture
                          ? <img src={t.profile_picture} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#a78bfa' }}><User size={12} /></div>
                        }
                        {t.first_name} {t.last_name}
                      </td>
                      <td>
                        <span className={`bc-perm-status-badge ${t.is_active ? 'bc-perm-status-enabled' : 'bc-perm-status-disabled'}`}>
                          {t.is_active ? '✅ Enabled' : '❌ No access'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {t.is_active ? (t.can_send_to === 'all' ? 'All Students' : 'Own Batch') : '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{t.granted_at ? timeAgo(t.granted_at) : '—'}</td>
                      <td>
                        {t.is_active ? (
                          <button type="button" className="bc-btn bc-btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            onClick={() => handleRevoke(t.id, `${t.first_name} ${t.last_name}`)}>
                            Revoke
                          </button>
                        ) : (
                          <button type="button" className="bc-btn bc-btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            onClick={() => { setGrantForm({ teacher_id: t.id, can_send_to: 'all' }); setGrantModal(true); }}>
                            Grant
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {grantModal && (
        <div className="bc-modal-overlay" onClick={() => setGrantModal(false)}>
          <div className="bc-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="bc-modal-header">
              <span className="bc-modal-title">Grant Broadcast Access</span>
              <button type="button" className="bc-icon-btn" onClick={() => setGrantModal(false)}><X size={16} /></button>
            </div>
            <div className="bc-modal-body">
              <div className="bc-field">
                <label className="bc-label">Teacher</label>
                <select className="bc-select" value={grantForm.teacher_id}
                  onChange={e => setGrantForm(f => ({ ...f, teacher_id: Number(e.target.value) }))}>
                  <option value="">Select teacher...</option>
                  {unGrantedTeachers.map(t => (
                    <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                  ))}
                </select>
              </div>
              <div className="bc-field" style={{ marginTop: '0.75rem' }}>
                <label className="bc-label">Scope</label>
                <select className="bc-select" value={grantForm.can_send_to}
                  onChange={e => setGrantForm(f => ({ ...f, can_send_to: e.target.value }))}>
                  <option value="all">All Students</option>
                  <option value="own_batch">Own Batch Only</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button type="button" className="bc-btn bc-btn-primary" style={{ flex: 'none' }} onClick={handleGrant} disabled={!grantForm.teacher_id || granting}>
                  {granting ? <span className="bc-spinner" /> : null} Grant Access
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unified Broadcast & Announcements Manager ───────────────────────
export default function BroadcastManager() {
  const { showConfirm } = useModal();
  const { currentUser } = useAuth();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const noticeFileInputRef = useRef(null);

  // ─── Mode state ────────────────────────────────────────────────────
  const [deliveryType, setDeliveryType] = useState('broadcast'); // 'broadcast' | 'notice'

  // ─── Composer states ───────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '',
    message: '',
    audience_type: 'all',
    audience_value: '',
    priority: 'normal', // 'normal' | 'urgent' (or 'high' for notices)
    allow_reply: false,
    delivery: 'now', // 'now' | 'later'
    scheduled_date: '',
    scheduled_time: '',
    channels: ['inbox', 'notification', 'notice'],
  });

  const [attachments, setAttachments] = useState([]); // for broadcasts
  const [uploading, setUploading] = useState(false);

  const [noticeAttachment, setNoticeAttachment] = useState(null); // for notices

  const [studentSearch, setStudentSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [targetCourse, setTargetCourse] = useState('');
  const [targetBatch, setTargetBatch] = useState('');
  const [broadcastCourse, setBroadcastCourse] = useState('');
  const [courseOptions, setCourseOptions] = useState([]);
  const [courseBatchesMap, setCourseBatchesMap] = useState({});

  // ─── History states ────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all'); // 'all', 'broadcasts', 'notices', 'scheduled', 'drafts'
  const [historySearch, setHistorySearch] = useState('');

  // ─── UI Actions ────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeDrawerId, setActiveDrawerId] = useState(null);
  const [activeDrawerType, setActiveDrawerType] = useState(null); // 'notice' | 'broadcast'
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [toast, setToast] = useState(null);
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [checkingAudience, setCheckingAudience] = useState(false);

  useEffect(() => {
    if (!studentSearch || studentSearch.trim() === '') {
      setSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(() => {
      setSearchLoading(true);
      fetch(`${API_BASE}/search-students?q=${encodeURIComponent(studentSearch)}`, { headers: { Authorization: `Bearer ${token()}` } })
        .then(r => r.json())
        .then(d => {
          setSearchResults(d.students || []);
          setSearchLoading(false);
        })
        .catch(() => setSearchLoading(false));
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [studentSearch]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Fetch targeting options for standard notices
  const fetchTargetingOptions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/targeting-options', {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCourseOptions(data.courses || []);
        setCourseBatchesMap(data.courseBatches || {});
      }
    } catch (err) {
      console.error('Failed to fetch targeting options', err);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // 1. Fetch broadcasts
      const broadcastRes = await fetch(`/api/admin/broadcast`, { headers: authHeader() });
      const broadcastData = await broadcastRes.json();
      const bList = (broadcastData.broadcasts || []).map(b => ({
        ...b,
        unified_type: 'broadcast',
        unified_id: `b_${b.id}`,
        display_title: b.title,
        display_content: b.message,
        display_date: b.sent_at || b.created_at || b.scheduled_at,
        display_badge: 'Broadcast',
        display_sender: b.sender_name || 'Admin',
      }));

      // 2. Fetch standard announcements (if Admin)
      let aList = [];
      if (currentUser?.role === 'admin') {
        const announcementsRes = await fetch('/api/admin/announcements', {
          headers: { Authorization: `Bearer ${token()}` }
        });
        if (announcementsRes.ok) {
          const announcementsData = await announcementsRes.json();
          aList = (announcementsData.announcements || []).map(a => ({
            ...a,
            unified_type: 'notice',
            unified_id: `n_${a.id}`,
            display_title: a.title,
            display_content: a.content,
            display_date: a.scheduled_at || a.created_at,
            display_badge: 'Notice',
            display_sender: a.admin_name || 'Admin',
            status: a.scheduled_at && new Date(a.scheduled_at) > new Date() ? 'scheduled' : 'published',
          }));
        }
      }

      // Merge and sort
      const combined = [...bList, ...aList].sort((a, b) => {
        return new Date(b.display_date) - new Date(a.display_date);
      });

      setHistory(combined);
      setFilteredHistory(combined);
    } catch {
      showToast('Failed to load history', 'error');
    }
    setHistoryLoading(false);
  }, [currentUser]);

  useEffect(() => {
    fetchHistory();
    if (currentUser?.role === 'admin') {
      fetchTargetingOptions();
    }
  }, [fetchHistory, fetchTargetingOptions, currentUser]);

  // Sync form options
  useEffect(() => {
    if (deliveryType === 'notice') {
      setForm(f => ({ ...f, priority: 'normal' }));
    }
  }, [deliveryType]);

  // Apply history filter & search
  useEffect(() => {
    let result = [...history];

    if (historyFilter === 'broadcasts') {
      result = result.filter(h => h.unified_type === 'broadcast');
    } else if (historyFilter === 'notices') {
      result = result.filter(h => h.unified_type === 'notice');
    } else if (historyFilter === 'scheduled') {
      result = result.filter(h => h.status === 'scheduled');
    } else if (historyFilter === 'drafts') {
      result = result.filter(h => h.status === 'draft');
    }

    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      result = result.filter(h =>
        h.display_title?.toLowerCase().includes(q) ||
        h.display_content?.toLowerCase().includes(q)
      );
    }

    setFilteredHistory(result);
  }, [history, historyFilter, historySearch]);

  // Preview audience count
  const checkAudienceSize = async () => {
    if (deliveryType === 'notice') return;
    setCheckingAudience(true);
    try {
      const res = await fetch(`${API_BASE}/resolve-audience`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          audience_type: form.audience_type,
          audience_value: form.audience_value,
        }),
      });
      const d = await res.json();
      setAudiencePreview(d);
    } catch { /* ignore */ }
    setCheckingAudience(false);
  };

  useEffect(() => {
    if (deliveryType === 'broadcast' && form.audience_type) {
      const timer = setTimeout(checkAudienceSize, 600);
      return () => clearTimeout(timer);
    }
  }, [form.audience_type, form.audience_value, deliveryType]);

  // Formatting tools
  const insertMarkdown = (before, after = '') => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = form.message.substring(start, end);
    const newText = form.message.substring(0, start) + before + selected + after + form.message.substring(end);
    setForm(f => ({ ...f, message: newText }));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 10);
  };

  // ─── File Upload (Broadcast Attachments) ──────────────────────────
  const handleFileSelect = async (files) => {
    if (!files || files.length === 0) return;
    if (attachments.length + files.length > 5) {
      showToast('Maximum 5 files per broadcast', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      const r = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      });
      const d = await r.json();
      if (d.files) {
        setAttachments(prev => [...prev, ...d.files]);
      } else {
        showToast(d.error || 'Upload failed', 'error');
      }
    } catch {
      showToast('Upload failed', 'error');
    }
    setUploading(false);
  };

  // ─── File Upload (Notice Attachment) ──────────────────────────────
  const handleNoticeFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setNoticeAttachment({
        name: file.name,
        type: file.type,
        url: reader.result
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ─── Send / Submit Announcement or Broadcast ───────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) {
      showToast('Title and message are required', 'error');
      return;
    }

    setSending(true);

    try {
      const scheduledAt = form.delivery === 'later' && form.scheduled_date && form.scheduled_time
        ? new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString()
        : null;

      if (deliveryType === 'notice') {
        // Submit Standard Notice
        let imagePayload = null;
        if (noticeAttachment) {
          imagePayload = JSON.stringify(noticeAttachment);
        }

        const res = await fetch('/api/admin/announcements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token()}`
          },
          body: JSON.stringify({
            title: form.title,
            content: form.message,
            priority: form.priority,
            targetCourse: targetCourse || null,
            targetBatch: targetBatch || null,
            image_url: imagePayload,
            scheduled_at: scheduledAt
          })
        });

        if (res.ok) {
          showToast(scheduledAt ? 'Standard Notice scheduled successfully!' : 'Standard Notice posted successfully!');
          resetForm();
          fetchHistory();
        } else {
          const err = await res.json();
          showToast(err.error || 'Failed to post standard notice', 'error');
        }
      } else {
        // Submit Multi-channel Broadcast
        if (!form.channels || form.channels.length === 0) {
          showToast('Please select at least one delivery channel', 'error');
          setSending(false);
          return;
        }

        const payload = {
          title: form.title,
          message: form.message,
          audience_type: form.audience_type,
          audience_value: form.audience_value || null,
          priority: form.priority,
          allow_reply: form.allow_reply,
          status: scheduledAt ? 'scheduled' : 'draft',
          scheduled_at: scheduledAt,
          attachment_files: attachments,
          channels: form.channels.join(','),
        };

        const res = await fetch(API_BASE, {
          method: 'POST',
          headers: authHeader(),
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!data.broadcast) {
          showToast(data.error || 'Failed to create broadcast', 'error');
          setSending(false);
          return;
        }

        const broadcastId = data.broadcast.id;

        if (scheduledAt) {
          showToast('Broadcast scheduled successfully!');
          resetForm();
          fetchHistory();
        } else {
          // Send now
          const sendRes = await fetch(`${API_BASE}/${broadcastId}/send`, {
            method: 'POST',
            headers: authHeader(),
          });
          const sendData = await sendRes.json();
          if (sendData.success) {
            showToast(`Sending to ${sendData.total_recipients} students... ✓`);
            resetForm();
            setTimeout(fetchHistory, 3000);
          } else {
            showToast(sendData.error || 'Failed to send', 'error');
          }
        }
      }
    } catch {
      showToast('An error occurred', 'error');
    }
    setSending(false);
  };

  // ─── Save as Draft (Only Broadcast supports drafts) ───────────────
  const handleSaveDraft = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      showToast('Title and message are required', 'error');
      return;
    }
    setSavingDraft(true);
    try {
      const payload = {
        title: form.title,
        message: form.message,
        audience_type: form.audience_type,
        audience_value: form.audience_value || null,
        priority: form.priority,
        allow_reply: form.allow_reply,
        status: 'draft',
        attachment_files: attachments,
        channels: form.channels ? form.channels.join(',') : 'inbox,notification,notice',
      };

      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.broadcast) {
        showToast('Draft saved successfully!');
        resetForm();
        fetchHistory();
      } else {
        showToast(data.error || 'Failed to save draft', 'error');
      }
    } catch {
      showToast('An error occurred', 'error');
    }
    setSavingDraft(false);
  };

  // ─── Delete Standard Notice ───────────────────────────────────────
  const handleDeleteNotice = async (id, title) => {
    if (!await showConfirm('Delete Notice', `Are you sure you want to delete the notice "${title}"?`, 'danger')) return;
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) {
        showToast('Notice deleted successfully.');
        setActiveDrawerId(null);
        fetchHistory();
      } else {
        showToast('Failed to delete notice', 'error');
      }
    } catch {
      showToast('Error deleting notice', 'error');
    }
  };

  const resetForm = () => {
    setForm({
      title: '', message: '', audience_type: 'all', audience_value: '',
      priority: 'normal', allow_reply: false, delivery: 'now',
      scheduled_date: '', scheduled_time: '',
      channels: ['inbox', 'notification', 'notice'],
    });
    setAttachments([]);
    setNoticeAttachment(null);
    setTargetCourse('');
    setTargetBatch('');
    setBroadcastCourse('');
    setAudiencePreview(null);
  };

  const handleDuplicate = (b) => {
    setDeliveryType('broadcast');
    setForm({
      title: `${b.title} (Copy)`,
      message: b.message,
      audience_type: b.audience_type,
      audience_value: b.audience_value || '',
      priority: b.priority,
      allow_reply: b.allow_reply === 1,
      delivery: 'now',
      scheduled_date: '',
      scheduled_time: '',
      channels: b.channels ? b.channels.split(',') : ['inbox', 'notification', 'notice'],
    });
    if (b.audience_type === 'batch' && b.audience_value) {
      const course = Object.keys(courseBatchesMap).find(c => 
        courseBatchesMap[c]?.map(String).includes(String(b.audience_value))
      );
      if (course) {
        setBroadcastCourse(course);
      } else {
        setBroadcastCourse('');
      }
    } else {
      setBroadcastCourse('');
    }
    showToast('Template copied to composer');
  };

  const renderAudienceInput = () => {
    if (form.audience_type === 'batch') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <select
              className="bc-select"
              value={broadcastCourse}
              onChange={e => {
                setBroadcastCourse(e.target.value);
                setForm(f => ({ ...f, audience_value: '' }));
              }}
            >
              <option value="">Select course...</option>
              {courseOptions.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              className="bc-select"
              value={form.audience_value}
              onChange={e => setForm(f => ({ ...f, audience_value: e.target.value }))}
              disabled={!broadcastCourse}
            >
              <option value="">Select batch...</option>
              {broadcastCourse && courseBatchesMap[broadcastCourse]?.map(b => (
                <option key={b} value={b}>{b}th Batch</option>
              ))}
            </select>
          </div>
        </div>
      );
    }
    if (form.audience_type === 'course') {
      return (
        <select className="bc-select" value={form.audience_value}
          onChange={e => setForm(f => ({ ...f, audience_value: e.target.value }))}>
          <option value="">Select course...</option>
          {courseOptions.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      );
    }
    if (form.audience_type === 'specific') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', position: 'relative' }}>
          {/* comma-separated input list */}
          <input className="bc-input" placeholder="Enter student usernames, student IDs, or user IDs separated by commas (e.g. sujon.672u, 566)"
            value={form.audience_value}
            onChange={e => setForm(f => ({ ...f, audience_value: e.target.value }))} />

          {/* search option */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="bc-input"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
              placeholder="🔍 Search student to add (by name, username, ID, or email)..."
              value={studentSearch}
              onChange={e => setStudentSearch(e.target.value)}
            />
            {searchLoading && (
              <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                <div className="bc-spinner" style={{ width: 14, height: 14 }} />
              </div>
            )}

            {/* floating search results dropdown list */}
            {searchResults.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'rgba(23, 23, 37, 0.98)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                marginTop: '4px',
                maxHeight: '220px',
                overflowY: 'auto',
                zIndex: 999,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(10px)'
              }}>
                {searchResults.map(s => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.5rem 0.75rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      const valToAdd = s.username || s.student_id || String(s.id);
                      setForm(f => {
                        const current = f.audience_value ? f.audience_value.split(',').map(x => x.trim()).filter(Boolean) : [];
                        if (!current.includes(valToAdd)) {
                          current.push(valToAdd);
                        }
                        return { ...f, audience_value: current.join(', ') };
                      });
                      setStudentSearch('');
                      setSearchResults([]);
                    }}
                  >
                    <img
                      src={resolveMediaUrl(s.profile_picture) || `https://ui-avatars.com/name=${encodeURIComponent(s.first_name + ' ' + s.last_name)}`}
                      alt=""
                      style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {s.first_name} {s.last_name}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        ID: {s.student_id || s.id} · @{s.username} · {s.batch_number ? `${s.batch_number}th Batch` : 'No Batch'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="page-container container broadcast-page">
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 9999,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)',
          color: 'white', padding: '0.75rem 1.25rem', borderRadius: 12,
          fontSize: '0.88rem', fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          animation: 'bc-scaleIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="broadcast-header">
        <div className="broadcast-header-left">
          <div className="broadcast-header-icon"><Megaphone size={22} color="white" /></div>
          <div>
            <h1 className="text-gradient font-display" style={{ fontSize: '1.8rem', margin: 0, fontWeight: 800 }}>Announcements & Broadcasts</h1>
            <p className="subtitle" style={{ margin: '0.2rem 0 0 0', fontSize: '0.9rem' }}>Send standard noticeboard updates or push multi-channel broadcast alerts.</p>
          </div>
        </div>
      </div>

      {currentUser?.role === 'admin' && <PermissionsPanel />}

      <div className="broadcast-panels">
        {/* LEFT PANEL: COMPOSER */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="bc-panel-title"><Edit3 size={16} /> Compose Broadcast</div>

          {/* Delivery Type selector (only shown to admin) */}
          {currentUser?.role === 'admin' && (
            <div className="bc-field">
              <label className="bc-label">Announcement Type</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  className={`bc-btn ${deliveryType === 'notice' ? 'bc-btn-primary' : 'bc-btn-outline'}`}
                  style={{ flex: 1 }}
                  onClick={() => { setDeliveryType('notice'); resetForm(); }}
                >
                  <BookOpen size={16} /> Standard Notice
                </button>
                <button
                  type="button"
                  className={`bc-btn ${deliveryType === 'broadcast' ? 'bc-btn-primary' : 'bc-btn-outline'}`}
                  style={{ flex: 1 }}
                  onClick={() => { setDeliveryType('broadcast'); resetForm(); }}
                >
                  <Megaphone size={16} /> Multi-Channel Broadcast
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div className="bc-field">
              <label className="bc-label">Title *</label>
              <input
                type="text"
                required
                className="bc-input"
                placeholder={deliveryType === 'notice' ? "e.g. Exam Rescheduled - 79th Batch" : "e.g. Urgent Class Announcement..."}
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                maxLength={150}
              />
              <span className="bc-char-limit">{form.title.length}/150</span>
            </div>

            <div className="bc-field">
              <label className="bc-label">Message *</label>
              <div className="bc-textarea-wrapper">
                <div className="bc-textarea-toolbar" style={{
                  display: 'flex',
                  gap: '4px',
                  padding: '6px 8px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                  {[
                    ['**', '**', 'Bold', <Bold size={14} />],
                    ['*', '*', 'Italic', <Italic size={14} />],
                    ['- ', '', 'Bullet list', <List size={14} />]
                  ].map(([before, after, title, icon], idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => insertMarkdown(before, after)}
                      title={title}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '30px',
                        height: '30px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '6px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={textareaRef}
                  required
                  className="bc-textarea"
                  rows={6}
                  placeholder="Write your message to students..."
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  maxLength={5000}
                />
              </div>
              <span className="bc-char-limit">{form.message.length}/5000</span>
            </div>

            {/* Targeting details - standard notice */}
            {deliveryType === 'notice' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="bc-field">
                  <label className="bc-label">Course Target (Optional)</label>
                  <select
                    className="bc-select"
                    value={targetCourse}
                    onChange={e => { setTargetCourse(e.target.value); setTargetBatch(''); }}
                  >
                    <option value="">All Courses</option>
                    {courseOptions.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="bc-field">
                  <label className="bc-label">Batch Target (Optional)</label>
                  <select
                    className="bc-select"
                    value={targetBatch}
                    onChange={e => setTargetBatch(e.target.value)}
                    disabled={!targetCourse}
                  >
                    <option value="">All Batches</option>
                    {targetCourse && courseBatchesMap[targetCourse]?.map(b => (
                      <option key={b} value={b}>{b}th Batch</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Targeting details - multi-channel broadcast */}
            {deliveryType === 'broadcast' && (
              <div className="bc-field">
                <label className="bc-label">Audience *</label>
                <div className="bc-audience-buttons">
                  {[['all', <Users size={14} />, 'All Students'], ['batch', <GraduationCap size={14} />, 'By Batch'], ['course', <Layers size={14} />, 'By Course'], ['specific', <Edit3 size={14} />, 'Specific']].map(([type, icon, label]) => (
                    <button
                      key={type}
                      type="button"
                      className={`bc-audience-btn ${form.audience_type === type ? 'active' : ''}`}
                      onClick={() => setForm(f => ({ ...f, audience_type: type, audience_value: '' }))}
                    >
                      {icon}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  {renderAudienceInput()}
                </div>

                {audiencePreview && (
                  <div className="bc-audience-preview">
                    <span className="bc-audience-preview-count">
                      📣 {audiencePreview.count} Student{audiencePreview.count !== 1 ? 's' : ''} will receive this message
                    </span>
                    {audiencePreview.preview?.length > 0 && (
                      <div className="bc-audience-preview-list">
                        Preview: {audiencePreview.preview.join(', ')}{audiencePreview.count > 5 ? '...' : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Priority option */}
            <div className="bc-field">
              <label className="bc-label">Priority</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  className={`bc-priority-btn ${form.priority === 'normal' || form.priority === 'low' ? 'active normal' : ''}`}
                  onClick={() => setForm(f => ({ ...f, priority: 'normal' }))}
                >
                  <Check size={14} /> Normal
                </button>
                <button
                  type="button"
                  className={`bc-priority-btn ${form.priority === 'urgent' || form.priority === 'high' ? 'active urgent' : ''}`}
                  onClick={() => setForm(f => ({ ...f, priority: deliveryType === 'notice' ? 'high' : 'urgent' }))}
                >
                  <AlertTriangle size={14} /> High / Urgent
                </button>
              </div>
            </div>

            {/* Delivery Channels Option (Broadcast only) */}
            {deliveryType === 'broadcast' && (
              <div className="bc-field">
                <label className="bc-label">Delivery Channels *</label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {[
                    ['inbox', <Inbox size={16} />, 'Direct Inbox'],
                    ['notice', <Megaphone size={16} />, 'Notice Board'],
                    ['notification', <Bell size={16} />, 'Bell Notification']
                  ].map(([chanId, icon, label]) => {
                    const isSelected = form.channels?.includes(chanId);
                    return (
                      <button
                        key={chanId}
                        type="button"
                        className={`bc-btn ${isSelected ? 'bc-btn-primary' : 'bc-btn-ghost'}`}
                        style={{ flex: 1, minWidth: '120px' }}
                        onClick={() => {
                          setForm(f => {
                            const newChans = f.channels?.includes(chanId)
                              ? f.channels.filter(c => c !== chanId)
                              : [...(f.channels || []), chanId];
                            return { ...f, channels: newChans };
                          });
                        }}
                      >
                        {icon} {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Allow reply (Broadcast only) */}
            {deliveryType === 'broadcast' && (
              <div className="bc-toggle-row">
                <div>
                  <span className="bc-label" style={{ marginBottom: 0 }}>Allow Reply</span>
                  <small style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Students can reply directly to this message</small>
                </div>
                <label className="bc-toggle">
                  <input
                    type="checkbox"
                    checked={form.allow_reply}
                    onChange={e => setForm(f => ({ ...f, allow_reply: e.target.checked }))}
                  />
                  <span className="bc-toggle-slider" />
                </label>
              </div>
            )}

            {/* Attachments - standard notice */}
            {deliveryType === 'notice' && (
              <div className="bc-field">
                <label className="bc-label">Attachment (Optional, Max 1)</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="bc-btn bc-btn-outline"
                    onClick={() => noticeFileInputRef.current?.click()}
                    style={{ flex: 'none', display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}
                  >
                    <Paperclip size={14} /> Upload Cover File
                  </button>
                  <input
                    ref={noticeFileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={handleNoticeFileSelect}
                  />
                  {noticeAttachment && (
                    <div className="bc-file-pill" style={{ margin: 0, flex: 1 }}>
                      <span className="bc-file-pill-name">{noticeAttachment.name}</span>
                      <button type="button" className="bc-icon-btn" onClick={() => setNoticeAttachment(null)}><X size={12} /></button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Attachments - multi-channel broadcast */}
            {deliveryType === 'broadcast' && (
              <div className="bc-field">
                <label className="bc-label">Attachments (Optional, max 5 files, 10MB each)</label>
                <div
                  className="bc-upload-area"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    handleFileSelect(e.dataTransfer.files);
                  }}
                  style={{
                    border: '2px dashed rgba(255, 255, 255, 0.15)',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: 'rgba(255, 255, 255, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.6)';
                    e.currentTarget.style.background = 'rgba(124, 58, 237, 0.04)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                  }}
                >
                  <Paperclip size={24} style={{ marginBottom: 4, opacity: 0.5, color: '#a78bfa' }} />
                  <span className="bc-upload-area-text" style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                    Attach Files — drag & drop or click to upload
                  </span>
                  <small className="bc-upload-area-sub" style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Images, PDF, Word, Excel - Max 10MB per file
                  </small>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => handleFileSelect(e.target.files)}
                />

                {attachments.length > 0 && (
                  <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    {attachments.map((att, idx) => {
                      const isImage = att.file_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(att.file_name);
                      return (
                        <div key={idx} className="bc-attachment-card" style={{
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '0.6rem',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: '10px',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          textAlign: 'center',
                          gap: '0.5rem',
                          overflow: 'hidden'
                        }}>
                          {isImage ? (
                            <img
                              src={resolveMediaUrl(att.file_path)}
                              alt={att.file_name}
                              style={{
                                width: '100%',
                                height: '90px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                background: 'rgba(0,0,0,0.2)'
                              }}
                            />
                          ) : (
                            <div style={{
                              width: '100%',
                              height: '90px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(255, 255, 255, 0.02)',
                              borderRadius: '6px',
                              color: 'var(--text-secondary)'
                            }}>
                              <FileText size={32} />
                            </div>
                          )}
                          <div style={{ width: '100%', overflow: 'hidden' }}>
                            <div style={{
                              fontSize: '0.75rem',
                              fontWeight: '500',
                              color: 'var(--text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }} title={att.file_name}>
                              {att.file_name}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {formatBytes(att.file_size)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="bc-icon-btn bc-delete-btn"
                            style={{
                              position: 'absolute',
                              top: '6px',
                              right: '6px',
                              background: 'rgba(0, 0, 0, 0.6)',
                              color: '#fff',
                              borderRadius: '50%',
                              width: '20px',
                              height: '20px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: 'none',
                              cursor: 'pointer'
                            }}
                            onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {uploading && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}><div className="bc-spinner" style={{ display: 'inline-block', marginRight: 6 }} /> Uploading attachments...</div>}
              </div>
            )}

            {/* Scheduling delivery options */}
            <div className="bc-field">
              <label className="bc-label">Delivery Schedule</label>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className={`bc-btn ${form.delivery === 'now' ? 'bc-btn-primary' : 'bc-btn-outline'}`}
                  style={{ flex: 1 }}
                  onClick={() => setForm(f => ({ ...f, delivery: 'now', scheduled_date: '', scheduled_time: '' }))}
                >
                  <Send size={14} /> Send Immediately
                </button>
                <button
                  type="button"
                  className={`bc-btn ${form.delivery === 'later' ? 'bc-btn-primary' : 'bc-btn-outline'}`}
                  style={{ flex: 1 }}
                  onClick={() => setForm(f => ({ ...f, delivery: 'later' }))}
                >
                  <Clock size={14} /> Schedule Later
                </button>
              </div>

              {form.delivery === 'later' && (
                <div className="bc-schedule-picker">
                  <input
                    type="date"
                    required
                    className="bc-input"
                    value={form.scheduled_date}
                    onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))}
                  />
                  <input
                    type="time"
                    required
                    className="bc-input"
                    value={form.scheduled_time}
                    onChange={e => setForm(f => ({ ...f, scheduled_time: e.target.value }))}
                  />
                </div>
              )}
            </div>

            {/* Submission buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="bc-btn bc-btn-outline"
                style={{ flex: 1 }}
                onClick={() => setPreviewOpen(true)}
              >
                <Eye size={16} /> Preview
              </button>

              {deliveryType === 'broadcast' && (
                <button
                  type="button"
                  className="bc-btn bc-btn-outline"
                  style={{ flex: 1 }}
                  disabled={savingDraft || sending}
                  onClick={handleSaveDraft}
                >
                  {savingDraft ? <span className="bc-spinner" /> : null} Save Draft
                </button>
              )}

              <button
                type="submit"
                className="bc-btn bc-btn-primary"
                style={{ flex: 2 }}
                disabled={sending || savingDraft}
              >
                {sending ? <Loader className="spin" size={16} /> : null}
                {sending ? 'Sending...' : form.delivery === 'later' ? '⏰ Schedule' : '📣 Send Now'}
              </button>
            </div>
          </form>
        </div>

        {/* RIGHT PANEL: HISTORY & LOGS */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="bc-panel-title"><History size={16} /> Broadcast History</div>

          <div className="bc-history-filters-row" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <div className="bc-filter-tabs" style={{
              display: 'flex',
              gap: '0.25rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '10px',
              padding: '3px',
              width: 'fit-content'
            }}>
              {[
                ['all', 'All'],
                ['broadcasts', 'Broadcasts'],
                ['notices', 'Notices'],
                ['scheduled', 'Scheduled'],
                ['drafts', 'Drafts']
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`bc-filter-tab ${historyFilter === id ? 'active' : ''}`}
                  onClick={() => setHistoryFilter(id)}
                  style={{
                    background: historyFilter === id ? 'rgba(124, 58, 237, 0.2)' : 'transparent',
                    border: 'none',
                    color: historyFilter === id ? '#a78bfa' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '7px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    transition: 'all 0.15s ease',
                    outline: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              type="text"
              className="bc-input bc-history-search"
              placeholder="Search broadcasts..."
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
            />
          </div>

          <div className="bc-history-list custom-scrollbar">
            {historyLoading ? (
              <div className="bc-empty-state"><div className="bc-spinner" /></div>
            ) : filteredHistory.length === 0 ? (
              <div className="bc-empty-state">
                <Megaphone size={32} style={{ opacity: 0.15, marginBottom: 8 }} />
                <p>No broadcasts found. Compose one on the left!</p>
              </div>
            ) : (
              filteredHistory.map(item => (
                <div
                  key={item.unified_id}
                  className="bc-history-row card-hover"
                  onClick={() => {
                    setActiveDrawerId(item.id);
                    setActiveDrawerType(item.unified_type);
                  }}
                >
                  <div className="bc-history-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                      <span className={`bc-unified-type-badge ${item.unified_type === 'notice' ? 'badge-notice' : 'badge-broadcast'}`}>
                        {item.display_badge}
                      </span>
                      <strong className="bc-history-title">{item.display_title}</strong>
                    </div>
                    <div className="bc-history-meta">
                      <span>By {item.display_sender}</span>
                      <span>·</span>
                      <span>{new Date(item.display_date).toLocaleDateString()}</span>
                      {item.unified_type === 'broadcast' ? (
                        <>
                          <span>·</span>
                          <span>{audienceBadgeLabel(item.audience_type, item.audience_value)}</span>
                        </>
                      ) : (
                        (item.target_course || item.target_batch) && (
                          <>
                            <span>·</span>
                            <span>Target: {item.target_course ? item.target_course : ''} {item.target_batch ? `(${item.target_batch}th Batch)` : ''}</span>
                          </>
                        )
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {item.unified_type === 'broadcast' && item.status !== 'draft' && item.status !== 'scheduled' && (
                      <span className="bc-history-stats-pill">
                        ✓ {item.delivered_count || 0} / 𐄂 {item.failed_count || 0}
                      </span>
                    )}
                    <span className={`bc-status-badge ${getStatusClass(item.status)}`}>{item.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {previewOpen && (
        <PreviewModal
          form={form}
          deliveryType={deliveryType}
          noticeAttachment={noticeAttachment}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {activeDrawerId && (
        <BroadcastDrawer
          broadcastId={activeDrawerId}
          unifiedType={activeDrawerType}
          onClose={() => { setActiveDrawerId(null); setActiveDrawerType(null); }}
          onDuplicate={handleDuplicate}
          onDeleteNotice={handleDeleteNotice}
          onSendSuccess={(msg) => {
            showToast(msg || 'Broadcast sent successfully!');
            fetchHistory();
          }}
        />
      )}
    </div>
  );
}
