import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import './AssessmentSubmission.css';

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read an image.'));
    reader.readAsDataURL(file);
  });
}

async function imagePdf(images) {
  const { jsPDF } = await import('jspdf');
  let pdf;
  for (const [index, item] of images.entries()) {
    const image = new Image();
    image.src = item.src;
    await image.decode();
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const sideways = item.rotation % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(item.rotation * Math.PI / 180);
    context.drawImage(image, -width / 2, -height / 2, width, height);
    if (!pdf) pdf = new jsPDF({orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'pt', format: 'a4'});
    else if (index) pdf.addPage('a4', canvas.width > canvas.height ? 'landscape' : 'portrait');
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min((pageWidth - 24) / canvas.width, (pageHeight - 24) / canvas.height);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', (pageWidth - canvas.width * ratio) / 2, (pageHeight - canvas.height * ratio) / 2, canvas.width * ratio, canvas.height * ratio);
  }
  return pdf.output('blob');
}

export default function AssessmentSubmission() {
  const { windowId } = useParams();
  const [window, setWindow] = useState(null);
  const [history, setHistory] = useState([]);
  const [pdfFile, setPdfFile] = useState(null);
  const [images, setImages] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const generatedPdf = useRef(null);
  const loadHistory = async () => {
    const response = await apiClient(`/api/assessment-submissions/${windowId}/history`);
    if (!response.ok) throw new Error('Could not load submission history.');
    setHistory((await response.json()).submissions || []);
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [response, past] = await Promise.all([apiClient('/api/assessment-windows'), apiClient(`/api/assessment-submissions/${windowId}/history`)]);
        if (!response.ok || !past.ok) throw new Error('This assessment is unavailable.');
        const found = (await response.json()).windows.find(item => String(item.id) === windowId);
        if (!found) throw new Error('This assessment is unavailable.');
        const rows = (await past.json()).submissions;
        if (active) { setWindow(found); setHistory(rows || []); }
      } catch (error) { if (active) setMessage(error.message); }
    })();
    return () => { active = false; };
  }, [windowId]);
  const addImages = async event => {
    const files = Array.from(event.target.files || []);
    if (files.some(file => file.type !== 'image/jpeg' || file.size > 8 * 1024 * 1024) || images.length + files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) + images.reduce((sum, image) => sum + image.size, 0) > 40 * 1024 * 1024) {
      setMessage('Choose up to 20 JPG images, each under 8 MB and 40 MB in total.'); return;
    }
    try {
      const added = await Promise.all(files.map(async file => ({id: crypto.randomUUID(), name: file.name, size: file.size, src: await readImage(file), rotation: 0})));
      setImages(current => [...current, ...added]); setPdfFile(null); generatedPdf.current = null; requestKey.current = crypto.randomUUID(); setMessage('');
    } catch (error) { setMessage(error.message); }
    event.target.value = '';
  };
  const move = (index, direction) => setImages(current => {
    const next = [...current], target = index + direction;
    if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
    generatedPdf.current = null; requestKey.current = crypto.randomUUID(); return next;
  });
  const submit = async event => {
    event.preventDefault();
    if (!pdfFile && !images.length) return setMessage('Choose a PDF or add JPG pages.');
    setBusy(true); setMessage('');
    try {
      const file = pdfFile || generatedPdf.current || await imagePdf(images);
      if (!pdfFile) generatedPdf.current = file;
      if (file.size > 15 * 1024 * 1024) throw new Error('The PDF exceeds 15 MB. Use fewer or smaller images.');
      const form = new FormData(); form.append('requestKey', requestKey.current); form.append('file', file, 'answer-paper.pdf');
      const response = await apiClient(`/api/assessment-submissions/${windowId}`, {method: 'POST', body: form});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Submission failed.');
      setPdfFile(null); setImages([]); generatedPdf.current = null; requestKey.current = crypto.randomUUID();
      try { await loadHistory(); setMessage(`Submitted successfully. Receipt #${data.id}, version ${data.version}.`); }
      catch { setMessage(`Submitted successfully. Receipt #${data.id}, version ${data.version}. History could not be refreshed.`); }
    } catch (error) { setMessage(error.message || 'Submission failed; your selected pages are still here.'); }
    finally { setBusy(false); }
  };
  const download = async id => {
    try {
      const response = await apiClient(`/api/assessment-submissions/files/${id}`);
      if (!response.ok) throw new Error('Could not download this submission.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `answer-paper-${id}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error.message); }
  };
  return <main className="page-container container assessment-page"><Link to="/classroom" className="assessment-back-link">← Classroom</Link><h1>Submit answer paper</h1>
    {window && <><p>{window.title} · {window.type} · {window.availability}</p>
      {history.some(item => item.status === 'graded') && <p>This assessment has already been graded.</p>}
      {window.availability === 'open' && !history.some(item => item.status === 'graded') && <form onSubmit={submit} className="assessment-form">
        <label className="assessment-field">PDF answer paper <input type="file" accept="application/pdf,.pdf" onChange={event => {setPdfFile(event.target.files?.[0] || null); setImages([]); generatedPdf.current = null; requestKey.current = crypto.randomUUID();}} /></label>
        {pdfFile && <p>Selected: {pdfFile.name}</p>}
        <p>Or add JPG pages, then arrange them in the correct order.</p>
        <label className="assessment-field">JPG pages <input type="file" accept="image/jpeg,.jpg,.jpeg" multiple onChange={addImages} /></label>
        <ol className="assessment-page-list">{images.map((item, index) => <li key={item.id} className="assessment-page-card"><p>Page {index + 1}: {item.name}</p>
          <img src={item.src} alt={`Page ${index + 1} preview`} style={{width: 140, maxHeight: 180, objectFit: 'contain', transform: `rotate(${item.rotation}deg)`}} />
          <div className="assessment-page-actions"><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button><button type="button" disabled={index === images.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button type="button" onClick={() => {generatedPdf.current = null; requestKey.current = crypto.randomUUID(); setImages(current => current.map(page => page.id === item.id ? {...page, rotation: (page.rotation + 90) % 360} : page));}}>Rotate</button>
          <button type="button" onClick={() => {generatedPdf.current = null; requestKey.current = crypto.randomUUID(); setImages(current => current.filter(page => page.id !== item.id));}}>Remove</button></div></li>)}</ol>
        <button type="submit" className="assessment-submit-btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit PDF'}</button>
      </form>}
      <h2>Submission history</h2>{history.length ? <ul className="assessment-history-list">{history.map(item => <li key={item.id}>Version {item.version} · {item.status} · {item.submitted_at} <button type="button" onClick={() => download(item.id)}>Download</button>{item.marks != null && ` · Marks: ${item.marks}`}{item.remarks && ` · ${item.remarks}`}</li>)}</ul> : <p>No submissions yet.</p>}
    </>}
    {message && <p role="status">{message}</p>}
  </main>;
}
