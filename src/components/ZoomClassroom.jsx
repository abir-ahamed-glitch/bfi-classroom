import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Maximize2, Minimize2, Video } from 'lucide-react';
import apiClient from '../utils/apiClient';
import { formatTime12h } from '../utils/timetable';
import { safeZoomOrigin, validZoomLeftMessage, validZoomReadyMessage } from '../utils/zoomFrame';

export default function ZoomClassroom({batchId, phaseId, session, userName, autoJoin = false, onClose}) {
  const [joinData, setJoinData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const frame = useRef(null);
  const stage = useRef(null);
  const autoStarted = useRef(false);
  const leaveTimer = useRef(null);
  const origin = safeZoomOrigin(import.meta.env.VITE_ZOOM_EMBED_ORIGIN, window.location.origin);

  const finalizeClose = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (document.fullscreenElement === stage.current) document.exitFullscreen?.().catch(() => {});
    setLeaving(false);
    setJoinData(null);
    onClose?.();
  }, [onClose]);

  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!joinData) return;
    const handleFrameMessage = event => {
      if (validZoomReadyMessage(event, frame.current?.contentWindow, origin)) {
        event.source.postMessage({type:'BFI_ZOOM_JOIN', ...joinData, userName}, origin);
        return;
      }
      if (validZoomLeftMessage(event, frame.current?.contentWindow, origin)) {
        finalizeClose();
      }
    };
    window.addEventListener('message', handleFrameMessage);
    return () => window.removeEventListener('message', handleFrameMessage);
  }, [joinData, userName, origin, finalizeClose]);

  const join = useCallback(async () => {
    if (!origin) { setError('Zoom Classroom is not configured.'); return; }
    setError(''); setLoading(true);
    try {
      const response = await apiClient('/api/zoom-meetings/join', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({batchId, phaseId, slotId:String(session.id), date:session.date})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the meeting.');
      setJoinData(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [batchId, phaseId, session.id, session.date, origin]);

  useEffect(() => {
    if (!autoJoin || autoStarted.current) return;
    autoStarted.current = true;
    join();
  }, [autoJoin, join]);

  const leaveMeeting = () => {
    if (joinData && frame.current?.contentWindow && origin) {
      setLeaving(true);
      try {
        frame.current.contentWindow.postMessage({type:'BFI_ZOOM_LEAVE'}, origin);
      } catch { /* fallback to timer */ }
      leaveTimer.current = setTimeout(finalizeClose, 300);
      return;
    }
    finalizeClose();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === stage.current) await document.exitFullscreen?.();
      else await stage.current?.requestFullscreen?.();
    } catch { /* ignore unsupported fullscreen errors */ }
  };

  if (!autoJoin && !joinData) {
    return <div>
      <button type="button" className="classroom-join-btn" onClick={join} disabled={loading}>
        <Video size={14} /> {loading ? 'Connecting…' : 'Join in Classroom'}
      </button>
      {error && <p role="alert" className="classroom-zoom-error">{error}</p>}
    </div>;
  }

  return <div ref={stage} className="classroom-zoom-stage">
    <div className="classroom-zoom-stage-header">
      <div className="classroom-zoom-stage-meta">
        <span className="classroom-zoom-live-dot" aria-hidden="true" />
        <strong>{session.classTitle || session.subjectName || 'Live Classroom'}</strong>
        {session.startTime && session.endTime && <span className="classroom-zoom-stage-time">{formatTime12h(session.startTime)} – {formatTime12h(session.endTime)}</span>}
      </div>
      <div className="classroom-zoom-stage-actions">
        <button type="button" className="classroom-zoom-fullscreen-btn" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
        <button type="button" className="classroom-zoom-close-btn" onClick={leaveMeeting} disabled={leaving}>
          <LogOut size={14} /> {leaving ? 'Leaving…' : 'Leave meeting'}
        </button>
      </div>
    </div>
    {error ? (
      <div className="classroom-zoom-stage-status">
        <p role="alert" className="classroom-zoom-error">{error}</p>
        <button type="button" className="classroom-join-btn" onClick={join} disabled={loading}>Retry</button>
      </div>
    ) : !joinData ? (
      <div className="classroom-zoom-stage-status">Connecting to Zoom Classroom…</div>
    ) : (
      <iframe ref={frame} className="classroom-zoom-frame" title="Zoom classroom" src={`${origin}/index.html`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" allow="camera; microphone; display-capture; fullscreen"
        onLoad={() => frame.current?.contentWindow?.postMessage({type:'BFI_ZOOM_PING'}, origin)} />
    )}
  </div>;
}
