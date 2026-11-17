export function validZoomAttendanceMinimum(value) {
  return value == null || (Number.isInteger(value) && value >= 1 && value <= 100);
}

export function assessZoomAttendanceMinimum(minimumPercent, evidence) {
  if (minimumPercent == null || !validZoomAttendanceMinimum(minimumPercent)) return null;
  const minimumSeconds = Math.ceil(evidence.scheduledSeconds * minimumPercent / 100);
  return {
    minimumPercent,
    minimumSeconds,
    meetsMinimum: !evidence.incomplete && evidence.seconds >= minimumSeconds
  };
}
