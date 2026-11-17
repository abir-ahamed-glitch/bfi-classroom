import { addDays, getTimedSessions, isSessionDate } from './timetable.js';

export function selectedTimelineSession(sessions, slotId, date) {
  if (!slotId || !isSessionDate(date) || !Array.isArray(sessions)) return null;
  const matches = sessions.filter(session => String(session.id) === slotId && session.date === date);
  return matches.length === 1 ? matches[0] : null;
}

export function timelineSessions(slots, batch, today) {
  const first = isSessionDate(batch.startDate) ? batch.startDate : addDays(today, -28);
  const last = isSessionDate(batch.endDate) ? batch.endDate : addDays(today, 28);
  const lower = first < addDays(today, -365) ? addDays(today, -365) : first;
  const upper = last > addDays(today, 365) ? addDays(today, 365) : last;
  const dates = [];
  for (let day = lower; day <= upper; day = addDays(day, 1)) dates.push(day);
  return getTimedSessions(slots, dates, batch);
}

export function timelineFocus(sessions, today, time) {
  const activeToday = sessions.findIndex(session =>
    session.date === today && !['cancelled', 'rescheduled'].includes(session.status)
      && session.endTime >= time
  );
  if (activeToday !== -1) return activeToday;
  const upcoming = sessions.findIndex(session =>
    (session.date > today || (session.date === today && session.endTime >= time)) && !['cancelled', 'rescheduled'].includes(session.status)
  );
  return upcoming !== -1 ? upcoming : Math.max(0, sessions.length - 1);
}
