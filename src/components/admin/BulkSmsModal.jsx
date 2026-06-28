import React, { useState, useRef, useEffect } from 'react';
import {
  X, Send, MessageSquare, Users, CheckCircle2,
  XCircle, Loader2, ChevronDown, ChevronUp, AlertCircle, Smartphone
} from 'lucide-react';

const SMS_CHAR_LIMIT = 160;
const MAX_SMS_PARTS  = 5;

function charInfo(text) {
  const len   = text.length;
  const parts = len === 0 ? 1 : Math.ceil(len / SMS_CHAR_LIMIT);
  const remaining = (parts * SMS_CHAR_LIMIT) - len;
  return { len, parts, remaining };
}

export default function BulkSmsModal({ recipients, onClose }) {
  const [message,      setMessage]      = useState('');
  const [senderId,     setSenderId]     = useState('8809617626169');
  const [sending,      setSending]      = useState(false);
  const [progress,     setProgress]     = useState(0);
  const [results,      setResults]      = useState(null);
  const [showRecipients, setShowRecipients] = useState(false);
  const [error,        setError]        = useState('');
  const textareaRef = useRef(null);

  const info = charInfo(message);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  const insertTag = () => {
    const ta  = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const next  = message.slice(0, start) + '{name}' + message.slice(end);
    setMessage(next);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + 6;
      ta.focus();
    }, 0);
  };

  const previewMessage = (msg) => {
    const first = recipients[0];
    if (!first) return msg;
    return msg.replace(/\{name\}/gi, first.name || 'Student');
  };

  const handleSend = async () => {
    if (!message.trim()) { setError('Please enter a message.'); return; }
    if (info.parts > MAX_SMS_PARTS) {
      setError(`Message is too long (${info.parts} SMS parts). Maximum is ${MAX_SMS_PARTS}.`);
      return;
    }
    setError('');
    setSending(true);
    setProgress(0);
    setResults(null);

    try {
      let fakeProgress = 0;
      const ticker = setInterval(() => {
        fakeProgress = Math.min(fakeProgress + (100 / recipients.length) * 0.6, 90);
        setProgress(Math.round(fakeProgress));
      }, Math.max(50, (recipients.length * 60) / 20));

      const res = await fetch('/api/admin/sms/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          recipients: recipients.map(r => ({ name: r.name, phone: r.phone })),
          message: message.trim(),
          senderId: senderId.trim()
        })
      });

      clearInterval(ticker);
      setProgress(100);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send SMS.');
      setResults(data);
    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setSending(false);
    }
  };

  const progressColor = sending
    ? 'var(--accent-primary)'
    : results
      ? results.failed === 0 ? '#10b981' : results.sent === 0 ? '#ef4444' : '#f59e0b'
      : 'var(--accent-primary)';

  return (
    <div
      className="modern-modal-overlay"
      onClick={onClose}
      style={{ zIndex: 9999, overflowY: 'auto' }}
    >
      <div
        className="glass-panel animate-slide-up"
        style={{ width: '100%', maxWidth: '640px', margin: 'auto 0', borderRadius: '16px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modern-modal-header" style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              borderRadius: '10px', padding: '0.6rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <MessageSquare size={20} color="white" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Send Bulk SMS
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                via smsinbd.com
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn-ghost" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem' }}>

          {/* Recipient Summary */}
          <div
            style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: '10px', padding: '0.9rem 1.1rem',
              cursor: 'pointer', userSelect: 'none'
            }}
            onClick={() => setShowRecipients(v => !v)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Users size={16} color="#6366f1" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                  {recipients.length} Recipient{recipients.length !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#6366f1', fontSize: '0.8rem' }}>
                {showRecipients ? 'Hide' : 'Preview list'}
                {showRecipients ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>

            {showRecipients && (
              <div style={{
                marginTop: '0.75rem', maxHeight: '160px', overflowY: 'auto',
                borderTop: '1px solid rgba(99,102,241,0.15)', paddingTop: '0.75rem',
                display: 'flex', flexDirection: 'column', gap: '0.4rem'
              }}>
                {recipients.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <Smartphone size={12} color="var(--text-muted)" />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{r.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sender ID */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Sender ID <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(max 11 chars)</span>
            </label>
            <input
              type="text"
              className="input-glass"
              value={senderId}
              maxLength={15}
              onChange={e => setSenderId(e.target.value.replace(/\s/g, ''))}
              placeholder="e.g. 8809617626169"
              style={{ paddingLeft: '1rem', fontFamily: 'monospace', letterSpacing: '0.05em' }}
              disabled={sending}
            />
          </div>

          {/* Message Composer */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Message
              </label>
              <button
                type="button"
                onClick={insertTag}
                disabled={sending}
                style={{
                  background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99,102,241,0.25)',
                  color: '#818cf8', borderRadius: '6px', padding: '0.25rem 0.7rem',
                  fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600,
                  fontFamily: 'monospace', letterSpacing: '0.02em'
                }}
              >
                + Insert {'{name}'}
              </button>
            </div>

            <textarea
              ref={textareaRef}
              className="input-glass"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={'Type your message here... Use {name} to personalize.'}
              rows={5}
              disabled={sending}
              style={{
                width: '100%', resize: 'vertical', padding: '0.85rem 1rem',
                fontFamily: 'inherit', lineHeight: 1.6, borderRadius: '10px',
                boxSizing: 'border-box'
              }}
            />

            {/* Character counter */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                {info.parts > 1 && (
                  <span style={{ color: info.parts > MAX_SMS_PARTS ? '#ef4444' : '#f59e0b' }}>
                    {`? ${info.parts} SMS parts`}
                  </span>
                )}
              </span>
              <span style={{ color: info.remaining < 20 ? '#f59e0b' : 'var(--text-muted)' }}>
                {`${info.remaining} chars remaining · ${info.len} total`}
              </span>
            </div>

            {/* Preview */}
            {message && recipients.length > 0 && (
              <div style={{
                marginTop: '0.75rem', background: 'rgba(0,0,0,0.15)',
                borderRadius: '8px', padding: '0.75rem 1rem',
                fontSize: '0.82rem', color: 'var(--text-secondary)',
                borderLeft: '3px solid #6366f1', lineHeight: 1.5
              }}>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6366f1', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Preview (first recipient)</span>
                {previewMessage(message)}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '0.75rem 1rem',
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              color: '#f87171', fontSize: '0.85rem'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          {/* Progress Bar */}
          {(sending || progress > 0) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>{sending ? `Sending to ${recipients.length} recipients…` : 'Done!'}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.07)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${progress}%`,
                  background: `linear-gradient(90deg, #6366f1, ${progressColor})`,
                  borderRadius: '9999px',
                  transition: 'width 0.3s ease, background 0.5s ease'
                }} />
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <div>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16,185,129,0.25)',
                  borderRadius: '8px', padding: '0.5rem 0.9rem',
                  color: '#10b981', fontWeight: 700, fontSize: '0.9rem'
                }}>
                  <CheckCircle2 size={16} />
                  {results.sent} Sent
                </div>
                {results.failed > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '8px', padding: '0.5rem 0.9rem',
                    color: '#f87171', fontWeight: 700, fontSize: '0.9rem'
                  }}>
                    <XCircle size={16} />
                    {results.failed} Failed
                  </div>
                )}
              </div>

              {results.failed > 0 && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239,68,68,0.15)',
                  borderRadius: '10px', padding: '0.75rem',
                  maxHeight: '160px', overflowY: 'auto'
                }}>
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: '#f87171', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Failed recipients</p>
                  {results.results.filter(r => !r.ok).map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(239,68,68,0.1)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{r.name} <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>({r.phone})</span></span>
                      <span style={{ color: '#f87171', fontSize: '0.78rem' }}>
                        {typeof r.error === 'object' ? (r.error.message || r.error.code || JSON.stringify(r.error)) : String(r.error || 'Failed')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modern-modal-footer" style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="modern-btn modern-btn--secondary"
            onClick={onClose}
            style={{ flex: 1 }}
            disabled={sending}
          >
            {results ? 'Close' : 'Cancel'}
          </button>

          {!results && (
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !message.trim()}
              style={{
                flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', fontWeight: 700, border: 'none', borderRadius: '10px',
                padding: '0.75rem 1.5rem', cursor: sending ? 'not-allowed' : 'pointer',
                background: sending ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: 'white', fontSize: '0.95rem', transition: 'opacity 0.2s'
              }}
            >
              {sending
                ? <><Loader2 size={17} className="spinner" /> Sending…</>
                : <><Send size={17} /> Send {recipients.length} SMS</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


