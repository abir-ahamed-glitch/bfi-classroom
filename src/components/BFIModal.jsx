import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/* ─────────────────────────────────────────────
   Context
───────────────────────────────────────────── */
const ModalContext = createContext(null);

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used inside <ModalProvider>');
  return ctx;
}

/* ─────────────────────────────────────────────
   Provider  (wrap around <App /> in main.jsx)
───────────────────────────────────────────── */
export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);
  // modal shape:
  //   { type: 'alert'|'confirm', title, message, icon, confirmLabel, cancelLabel, resolve }

  const showAlert = useCallback((message, { title = 'Notice', icon = null } = {}) => {
    return new Promise(resolve => {
      setModal({ type: 'alert', title, message, icon, resolve });
    });
  }, []);

  const showConfirm = useCallback((message, { title = 'Are you sure?', icon = null, confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) => {
    return new Promise(resolve => {
      setModal({ type: 'confirm', title, message, icon, confirmLabel, cancelLabel, resolve });
    });
  }, []);

  const close = useCallback((value) => {
    setModal(prev => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!modal) return;
    const handler = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modal, close]);

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      {modal && createPortal(
        <BFIModalDialog modal={modal} onClose={close} />,
        document.body
      )}
    </ModalContext.Provider>
  );
}

/* ─────────────────────────────────────────────
   Dialog UI
───────────────────────────────────────────── */
function BFIModalDialog({ modal, onClose }) {
  const { type, title, message, icon, confirmLabel = 'OK', cancelLabel = 'Cancel' } = modal;
  const isConfirm = type === 'confirm';

  // Determine icon — BFI logo crest by default
  const IconEl = icon || <BFICrestIcon />;

  return (
    <>
      <style>{dialogCss}</style>
      {/* Backdrop */}
      <div
        className="bfi-modal-backdrop"
        onClick={() => onClose(false)}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        className="bfi-modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bfi-modal-title"
        aria-describedby="bfi-modal-message"
      >
        {/* Header */}
        <div className="bfi-modal-header">
          <div className="bfi-modal-title-row">
            <div className="bfi-modal-icon-wrap">{IconEl}</div>
            <h3 id="bfi-modal-title" className="bfi-modal-title">{title}</h3>
          </div>
          <button
            className="bfi-modal-close"
            onClick={() => onClose(false)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Message box */}
        <div className="bfi-modal-body">
          <div className="bfi-modal-message-box">
            <p id="bfi-modal-message" className="bfi-modal-message">{message}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="bfi-modal-footer">
          {isConfirm && (
            <button
              className="bfi-modal-btn bfi-modal-btn-cancel"
              onClick={() => onClose(false)}
            >
              {cancelLabel}
            </button>
          )}
          <button
            className="bfi-modal-btn bfi-modal-btn-ok"
            onClick={() => onClose(true)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   BFI logo icon — real bfi-logo.jpg image
───────────────────────────────────────────── */
function BFICrestIcon() {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const logoSrc = `${base}/bfi-logo.jpg`;
  return (
    <div style={{
      width: 42,
      height: 42,
      borderRadius: 10,
      background: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
      padding: '3px',
      boxSizing: 'border-box',
    }}>
      <img
        src={logoSrc}
        alt="BFI"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          borderRadius: 7,
        }}
      />
    </div>
  );
}


/* ─────────────────────────────────────────────
   CSS (injected via <style> tag in portal)
───────────────────────────────────────────── */
const dialogCss = `
  .bfi-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99998;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: bfiBackdropIn 0.18s ease-out;
  }

  .bfi-modal-dialog {
    position: fixed;
    z-index: 99999;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 2rem));
    border-radius: 16px;
    overflow: hidden;
    animation: bfiModalIn 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);

    /* Dark mode (default) */
    background-image:
      url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.35' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)' opacity='0.10'/%3E%3C/svg%3E"),
      linear-gradient(#07172d, #07172d);
    background-color: #07172d;
    box-shadow:
      0 0 0 1px rgba(96, 165, 250, 0.2),
      0 0 24px rgba(96, 165, 250, 0.12),
      0 24px 60px rgba(0, 0, 0, 0.65);
  }

  /* ── Light mode override ── */
  [data-mode="light"] .bfi-modal-dialog {
    background-image: none !important;
    background-color: #ffffff !important;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.08),
      0 20px 50px rgba(0, 0, 0, 0.18) !important;
  }

  /* ── Header ── */
  .bfi-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.1rem 1.25rem 1rem;
    border-bottom: 1px solid rgba(96, 165, 250, 0.1);
    background: rgba(4, 16, 37, 0.6);
  }
  [data-mode="light"] .bfi-modal-header {
    background: #f8fafc !important;
    border-bottom: 1px solid rgba(0,0,0,0.07) !important;
  }

  .bfi-modal-title-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .bfi-modal-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .bfi-modal-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #e2e8f0;
    line-height: 1.2;
  }
  [data-mode="light"] .bfi-modal-title {
    color: #1e293b !important;
  }

  .bfi-modal-close {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255,255,255,0.5);
    border-radius: 8px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.18s;
    flex-shrink: 0;
  }
  .bfi-modal-close:hover {
    background: rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.85);
  }
  [data-mode="light"] .bfi-modal-close {
    background: rgba(0,0,0,0.04) !important;
    border: 1px solid rgba(0,0,0,0.08) !important;
    color: rgba(0,0,0,0.4) !important;
  }
  [data-mode="light"] .bfi-modal-close:hover {
    background: rgba(0,0,0,0.08) !important;
    color: rgba(0,0,0,0.7) !important;
  }

  /* ── Body ── */
  .bfi-modal-body {
    padding: 1.25rem 1.25rem 1rem;
  }

  .bfi-modal-message-box {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    border: 1px solid rgba(255,255,255,0.06);
  }
  [data-mode="light"] .bfi-modal-message-box {
    background: #f1f5f9 !important;
    border: 1px solid rgba(0,0,0,0.06) !important;
  }

  .bfi-modal-message {
    margin: 0;
    font-size: 0.93rem;
    line-height: 1.55;
    color: #cbd5e1;
  }
  [data-mode="light"] .bfi-modal-message {
    color: #334155 !important;
  }

  /* ── Footer ── */
  .bfi-modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 0 1.25rem 1.25rem;
  }

  .bfi-modal-btn {
    flex: 1;
    border: none;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.18s;
    letter-spacing: 0.01em;
  }

  /* OK / Confirm — the prominent gradient red button */
  .bfi-modal-btn-ok {
    background: linear-gradient(135deg, #e11d48 0%, #be185d 100%);
    color: white;
    box-shadow: 0 4px 16px rgba(225, 29, 72, 0.4);
  }
  .bfi-modal-btn-ok:hover {
    background: linear-gradient(135deg, #f43f5e 0%, #db2777 100%);
    box-shadow: 0 6px 20px rgba(225, 29, 72, 0.55);
    transform: translateY(-1px);
  }
  .bfi-modal-btn-ok:active {
    transform: translateY(0);
    box-shadow: 0 2px 8px rgba(225, 29, 72, 0.4);
  }

  /* Cancel — subtle glass button */
  .bfi-modal-btn-cancel {
    background: rgba(255,255,255,0.06);
    color: #94a3b8;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .bfi-modal-btn-cancel:hover {
    background: rgba(255,255,255,0.1);
    color: #e2e8f0;
    border-color: rgba(255,255,255,0.18);
  }
  [data-mode="light"] .bfi-modal-btn-cancel {
    background: #f1f5f9 !important;
    color: #64748b !important;
    border: 1px solid rgba(0,0,0,0.1) !important;
  }
  [data-mode="light"] .bfi-modal-btn-cancel:hover {
    background: #e2e8f0 !important;
    color: #334155 !important;
  }

  /* ── Animations ── */
  @keyframes bfiBackdropIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes bfiModalIn {
    from { opacity: 0; transform: translate(-50%, -46%) scale(0.94); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
`;
