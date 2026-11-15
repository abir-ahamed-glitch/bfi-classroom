import { dhakaNow, occursOn } from '../../utils/timetable';

export default function SessionChanges({ slot, onChange }) {
  const changes = slot.sessionChanges || [];
  const update = (index, fields) => onChange(changes.map((change, current) => current === index ? { ...change, ...fields } : change));

  function addChange() {
    const today = dhakaNow().date;
    const originalDate = slot.date || (occursOn(slot, today) ? today : '');
    onChange([...changes, {
      originalDate, status: 'cancelled', date: originalDate, startTime: slot.startTime, endTime: slot.endTime
    }]);
  }

  return (
    <details open={changes.length ? true : undefined} style={{ marginTop: '0.75rem' }}>
      <summary>Cancel or reschedule a session{changes.length ? ' (' + changes.length + ')' : ''}</summary>
      {changes.map((change, index) => (
        <fieldset key={index} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.5rem 0', padding: '0.5rem' }}>
          <legend>Session change {index + 1}</legend>
          <label>Original class date <input type="date" required value={change.originalDate}
            onChange={event => update(index, { originalDate: event.target.value })} /></label>
          <label>Action <select value={change.status} onChange={event => update(index, { status: event.target.value })}>
            <option value="cancelled">Cancel session</option>
            <option value="rescheduled">Reschedule session</option>
          </select></label>
          {change.status === 'rescheduled' && <>
            <label>New date <input type="date" required value={change.date || ''}
              onChange={event => update(index, { date: event.target.value })} /></label>
            <label>New start time <input type="time" required value={change.startTime || ''}
              onChange={event => update(index, { startTime: event.target.value })} /></label>
            <label>New end time <input type="time" required value={change.endTime || ''}
              onChange={event => update(index, { endTime: event.target.value })} /></label>
          </>}
          <button type="button" className="btn btn-secondary" onClick={() => onChange(changes.filter((_, current) => current !== index))}>Remove change</button>
        </fieldset>
      ))}
      <button type="button" className="btn btn-secondary" onClick={addChange} disabled={changes.length >= (slot.date ? 1 : 100)}>Add session change</button>
    </details>
  );
}

