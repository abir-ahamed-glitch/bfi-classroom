import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ClipboardList, X } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import './BatchAttendanceSheet.css';

const cellKey = (enrollmentId, classId) => JSON.stringify([enrollmentId, classId]);
const savedMark = (row, id) => Object.hasOwn(row.marks, id) ? row.marks[id] : undefined;

export default function BatchAttendanceSheet({ batchId, phaseNumber, onClose, onSaved }) {
  const dialog = useRef(null);
  const [sheet, setSheet] = useState(null);
  const [changes, setChanges] = useState(new Map());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const url = `/api/admin/batches/${batchId}/attendance-sheet/${phaseNumber}`;

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await apiClient(url, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load attendance.');
        if (!controller.signal.aborted) setSheet(data);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [url]);

  const requestClose = () => {
    if (saving) return;
    if (!changes.size || window.confirm('Discard your unsaved attendance changes?')) onClose();
  };

  const editCells = (rows, column, attended) => {
    setMessage('');
    setChanges(previous => {
      const next = new Map(previous);
      for (const row of rows) {
        if (!row.editable) continue;
        const key = cellKey(row.enrollmentId, column.id);
        if (savedMark(row, column.id) === attended) next.delete(key);
        else next.set(key, { enrollmentId: row.enrollmentId, classId: column.id, attended });
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await apiClient(url, { method: 'PUT', body: { changes: [...changes.values()] } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save attendance.');
      setSheet(previous => ({
        ...previous,
        rows: previous.rows.map(row => {
          const updated = previous.columns.flatMap(column => {
            const change = changes.get(cellKey(row.enrollmentId, column.id));
            return change ? [[column.id, change.attended]] : [];
          });
          return { ...row, marks: { ...row.marks, ...Object.fromEntries(updated) } };
        })
      }));
      setChanges(new Map());
      setMessage('Attendance saved.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <dialog ref={dialog} className="attendance-sheet" aria-labelledby="attendance-sheet-title"
      onCancel={event => { event.preventDefault(); requestClose(); }}>
      <header className="attendance-sheet-header">
        <div>
          <h2 id="attendance-sheet-title"><ClipboardList size={22} aria-hidden="true" /> Attendance Sheet</h2>
          <p>{sheet?.phaseTitle || `Phase ${phaseNumber}`}</p>
        </div>
        <button type="button" className="modern-btn modern-btn--secondary" aria-label="Close attendance sheet" onClick={requestClose} disabled={saving}><X size={18} /></button>
      </header>
      {loading && <p role="status">Loading attendance…</p>}
      {sheet && (
        <>
          <p className="attendance-sheet-help">P = Present, A = Absent, — = Unmarked. Click a cell to change it, or mark everyone eligible for a session at once.</p>
          {!sheet.columns.length ? <p>Add classes to this phase in Course Maker to take attendance.</p> : !sheet.rows.length ? (
            <p>No eligible enrollments are linked to this batch yet.</p>
          ) : (
            <div className="attendance-sheet-scroll" tabIndex={0} role="region" aria-label="Attendance grid">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    {sheet.columns.map(column => (
                      <th key={column.id} scope="col">
                        <span>{column.title}</span>
                        {column.date && <time dateTime={column.date}>{column.date}</time>}
                        {column.category && !sheet.isLegacy && <small>{column.category}</small>}
                        <button type="button" className="attendance-sheet-bulk" aria-label={`Mark all present for ${column.title}`}
                          disabled={saving || !sheet.rows.some(row => row.editable)}
                          onClick={() => editCells(sheet.rows, column, true)}>All present</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map(row => (
                    <tr key={row.enrollmentId}>
                      <th scope="row">
                        {row.name}
                        {row.studentCode && <small>{row.studentCode}</small>}
                        {row.reason && <small>{row.reason}</small>}
                      </th>
                      {sheet.columns.map(column => {
                        const value = changes.get(cellKey(row.enrollmentId, column.id))?.attended ?? savedMark(row, column.id);
                        const state = value === undefined ? 'unmarked' : value ? 'present' : 'absent';
                        return <td key={column.id}>
                          <button type="button" className={`attendance-sheet-cell is-${state}`}
                            aria-label={`${row.name}, ${column.title}: ${state}. Mark ${value === true ? 'absent' : 'present'}`}
                            disabled={!row.editable || saving} onClick={() => editCells([row], column, value !== true)}>
                            {value === undefined ? '—' : value ? 'P' : 'A'}
                          </button>
                        </td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {error && <p className="attendance-sheet-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <footer className="attendance-sheet-footer">
        <span aria-live="polite">{changes.size ? `${changes.size} unsaved ${changes.size === 1 ? 'mark' : 'marks'}` : ''}</span>
        <button type="button" className="modern-btn modern-btn--secondary" disabled={!changes.size || saving}
          onClick={() => { setChanges(new Map()); setError(''); }}>Reset changes</button>
        <button type="button" className="modern-btn modern-btn--primary" disabled={!changes.size || saving} onClick={save}>
          <Check size={16} aria-hidden="true" /> {saving ? 'Saving…' : 'Save attendance'}
        </button>
      </footer>
    </dialog>,
    document.body
  );
}
