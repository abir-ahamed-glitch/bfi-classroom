const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dhakaDateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

export function dhakaNow(now = new Date()) {
  const [date, time] = dhakaDateTime.format(now).split(' ');
  return { date, time };
}

export function addDays(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayOf(date) {
  return weekdays[new Date(date + 'T00:00:00Z').getUTCDay()];
}

export function formatTime12h(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) return timeStr;
  const hour24 = Number(match[1]);
  const minutes = match[2];
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minutes} ${period}`;
}

export function isSessionDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && addDays(date, 0) === date;
}

export function occursOn(slot, date, bounds = {}) {
  if (slot.date) return slot.date === date;
  return slot.weekday === weekdayOf(date)
    && (!bounds.startDate || date >= bounds.startDate)
    && (!bounds.endDate || date <= bounds.endDate);
}

export function getTimedSessions(slots, dates, bounds) {
  const selectedDates = new Set(dates);
  return slots.flatMap((slot, index) => {
    const changes = Array.isArray(slot.sessionChanges) ? slot.sessionChanges : [];
    const byDate = new Map(changes.map(change => [change.originalDate, change]));
    const originalSessions = dates.filter(date => occursOn(slot, date, bounds)).map(date => {
      const change = byDate.get(date);
      return { ...slot, key: index + ':' + date, date, weekday: weekdayOf(date),
        status: change?.status || 'scheduled', movedTo: change?.date };
    });
    const movedSessions = changes.filter(change => change.status === 'rescheduled' && selectedDates.has(change.date))
      .map(change => ({ ...slot, key: index + ':' + change.originalDate + ':moved',
        date: change.date, weekday: weekdayOf(change.date), startTime: change.startTime,
        endTime: change.endTime, status: 'moved', originalDate: change.originalDate }));
    return [...originalSessions, ...movedSessions];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

