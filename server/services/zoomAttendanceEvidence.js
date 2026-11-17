// Calculate evidence only; this function never identifies a student or writes attendance.
export function summarizeZoomAttendance(events, {start, end}) {
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Array.isArray(events) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('Invalid class interval.');
  const seen = new Set(), normalized = [];
  for (const event of events) {
    const at = Date.parse(event?.at);
    if (!['join','leave'].includes(event?.type) || typeof event.participantId !== 'string' || !event.participantId || !Number.isFinite(at)) throw new Error('Invalid participation event.');
    const key = JSON.stringify([event.type,event.participantId,at]);
    if (!seen.has(key)) {seen.add(key); normalized.push({...event, time:at});}
  }
  if (new Set(normalized.map(event => event.participantId)).size > 1) throw new Error('Ambiguous participant identity.');
  normalized.sort((a,b) => a.time-b.time || (a.type === 'join' ? -1 : 1));
  const open = new Map(), intervals = [];
  let incomplete = false;
  for (const event of normalized) {
    const pending = open.get(event.participantId) || [];
    if (event.type === 'join') {pending.push(event.time); open.set(event.participantId,pending);}
    else if (!pending.length) incomplete = true;
    else {
      const joined = pending.shift();
      const from = Math.max(startMs,joined), to = Math.min(endMs,event.time);
      if (to > from) intervals.push([from,to]);
    }
  }
  if ([...open.values()].some(pending => pending.length)) incomplete = true;
  intervals.sort((a,b)=>a[0]-b[0]);
  let total=0, left=null, right=null;
  for (const [from,to] of intervals) {
    if (left === null) {left=from;right=to;}
    else if (from <= right) right=Math.max(right,to);
    else {total+=right-left;left=from;right=to;}
  }
  if (left !== null) total+=right-left;
  return {seconds: Math.floor(total/1000), incomplete};
}
