/**
 * Haptic Feedback Utility
 *
 * Wraps the Vibration API with predefined patterns for common UI actions.
 * Falls back silently on devices/browsers that don't support vibration.
 */

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

const patterns = {
  /** Subtle single tap — bottom nav, button press */
  tap: [8],
  /** Light double pulse — selection change */
  select: [6, 30, 6],
  /** Medium press — long-press menu, pull-to-refresh release */
  medium: [15],
  /** Success confirmation — message sent, action complete */
  success: [10, 40, 10, 40, 15],
  /** Warning or error feedback */
  warning: [30, 50, 30],
  /** Heavy single buzz — destructive action (delete) */
  heavy: [40],
};

/**
 * Trigger haptic feedback.
 * @param {'tap'|'select'|'medium'|'success'|'warning'|'heavy'} type
 */
export function haptic(type = 'tap') {
  if (!canVibrate) return;
  try {
    navigator.vibrate(patterns[type] || patterns.tap);
  } catch {
    // Silently ignore — some browsers throw on locked screens
  }
}

export default haptic;
