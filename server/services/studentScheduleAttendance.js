export function mapAttendanceToSlots(slots, classes, marks) {
  const counts = new Map();
  for (const slot of slots) {
    if (slot.classId != null) {
      const id = String(slot.classId);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const validClasses = new Set(classes.filter(item => item.id != null).map(item => String(item.id)));
  const byClass = new Map(marks.map(mark => [String(mark.class_id), mark.attended]));
  return slots.map(slot => {
    const id = String(slot.classId ?? '');
    if (!slot.date || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date)
        || slot.status === 'cancelled' || slot.sessionChanges?.length || counts.get(id) !== 1 || !validClasses.has(id)
        || !byClass.has(id)) return {};
    return { attendance: byClass.get(id) === 1 ? 'present' : 'absent' };
  });
}
