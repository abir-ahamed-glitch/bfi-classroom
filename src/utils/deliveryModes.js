/**
 * Single source of truth for class / routine slot delivery modes.
 *
 * `recorded_plus_live_discussion` is the BFI "pre-recorded class + live Q&A" format:
 * students watch the pre-recorded class, then the teacher joins live at the end
 * for a question-and-answer session. For routine slots, the slot date/time
 * is the live Q&A session time.
 */
export const DELIVERY_MODE_OPTIONS = [
  { value: 'live', label: 'Live Online' },
  { value: 'recorded', label: 'Recorded' },
  { value: 'recorded_plus_live_discussion', label: 'Recorded + Live Q&A (teacher joins live after class)' },
  { value: 'offline', label: 'In-Person Studio' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'self_paced', label: 'Self Paced' }
];

const SHORT_LABELS = {
  live: 'Live Online',
  online: 'Live Online',
  recorded: 'Recorded',
  recorded_plus_live_discussion: 'Recorded + Live Q&A',
  offline: 'In-Person Studio',
  hybrid: 'Hybrid',
  self_paced: 'Self Paced'
};

const KNOWN = new Set(DELIVERY_MODE_OPTIONS.map(o => o.value));

/** Maps legacy/unknown values onto the unified vocabulary ('online' -> 'live'). */
export function normalizeDeliveryMode(mode) {
  if (!mode) return 'live';
  if (mode === 'online') return 'live';
  return KNOWN.has(mode) ? mode : 'live';
}

/**
 * Derives the delivery mode from a custom subject: recorded subjects that have a
 * live Q&A become "recorded + live Q&A"; otherwise live/recorded map directly.
 */
export function deliveryModeFromSubject(subject) {
  if (!subject) return 'live';
  if (subject.class_type === 'recorded') {
    return subject.has_live_qa ? 'recorded_plus_live_discussion' : 'recorded';
  }
  return normalizeDeliveryMode(subject.class_type);
}

/** Short human-readable label for badges. */
export function deliveryModeLabel(mode) {
  if (!mode) return '';
  return SHORT_LABELS[mode] || mode;
}

export const DEFAULT_ROUTINE_SLOT = Object.freeze({
  date: '',
  weekday: 'Saturday',
  startTime: '19:00',
  endTime: '21:00',
  timezone: 'Asia/Dhaka',
  subjectName: '',
  classTitle: '',
  teacherName: '',
  deliveryMode: 'recorded',
  category: 'theory',
  platform: 'Zoom'
});

export function createDefaultRoutineSlot(overrides = {}) {
  return {
    ...DEFAULT_ROUTINE_SLOT,
    ...overrides
  };
}

export function isRecordedWithLiveQa(mode) {
  return mode === 'recorded_plus_live_discussion';
}

