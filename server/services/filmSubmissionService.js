import { getEnrollmentProgressSync } from './courseProgressService.js';


export function filmTargets(db, enrollment) {
  const progress = getEnrollmentProgressSync(enrollment.id, db);
  if (progress.isLegacy) {
    return enrollment.course_name === 'Online Filmmaking Course'
      ? [{ id: 'phase_2', title: 'Phase 2 · Short film', eligible: enrollment.step3_completed === 1 }] : [];
  }
  const ordered = progress.phases.some(phase => phase.filmWorkflow);
  return progress.phases.filter(phase => !ordered || phase.filmWorkflow).map(phase => {
    const workflow = phase.filmWorkflow;
    const eligible = workflow ? workflow.canSubmit : phase.isAdmitted && !phase.isLocked;
    let blockedReason = 'Submission opens after admission to this phase.';
    if (workflow && phase.isAdmitted && !phase.isLocked) {
      if (!workflow.onlineComplete) blockedReason = 'Complete the required online class attendance.';
      else if (!workflow.shootingComplete) blockedReason = 'Record shooting attendance.';
      else if (!workflow.editingComplete) blockedReason = 'Record editing attendance.';
    }
    return {
      id: phase.id, title: `Phase ${phase.phaseNumber} - ${phase.title}`, eligible, blockedReason,
      ordered: Boolean(workflow), completed: Boolean(workflow && phase.isPassed)
    };
  });
}

export function validateFilmUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const youtube = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host);
    const valid = (host === 'youtu.be' && /^\/[\w-]{11}$/.test(url.pathname))
      || (youtube && ((url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || '')) || /^\/(shorts|embed)\/[\w-]{11}$/.test(url.pathname)))
      || (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host) && /^\/(?:video\/)?\d+(?:\/[a-zA-Z0-9]+)?\/?$/.test(url.pathname));
    return valid ? url.href : null;
  } catch { return null; }
}
