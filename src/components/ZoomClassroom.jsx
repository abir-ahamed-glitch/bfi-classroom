import { useEffect, useRef, useState } from 'react';
import apiClient from '../utils/apiClient';
import { safeZoomOrigin, validZoomReadyMessage } from '../utils/zoomFrame';

export default function ZoomClassroom({batchId, phaseId, session, userName}) {
  const [joinData, setJoinData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const frame = useRef(null);
  const origin = safeZoomOrigin(import.meta.env.VITE_ZOOM_EMBED_ORIGIN, window.location.origin);
  useEffect(() => {
    if (!joinData) return;
    const ready = event => {
      if (!validZoomReadyMessage(event, frame.current?.contentWindow, origin)) return;
      event.source.postMessage({type:'BFI_ZOOM_JOIN', ...joinData, userName}, origin);
    };
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, [joinData, userName, origin]);
  const join = async () => {
    if (!origin) { setError('Zoom Classroom is not configured.'); return; }
    setError(''); setLoading(true);
    try {
      const response = await apiClient('/api/zoom-meetings/join', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({batchId, phaseId, slotId:String(session.id), date:session.date})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the meeting.');
      setJoinData(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return <div>
    {!joinData ? <button type="button" onClick={join} disabled={loading}>{loading ? 'Connecting…' : 'Join in Classroom'}</button> : <>
      <button type="button" onClick={() => setJoinData(null)}>Close meeting</button>
      <iframe ref={frame} title="Zoom classroom" src={`${origin}/index.html`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" allow="camera; microphone; display-capture; fullscreen"
        onLoad={() => frame.current?.contentWindow?.postMessage({type:'BFI_ZOOM_PING'}, origin)}
        style={{width:'100%', minHeight:600, border:0}} />
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
