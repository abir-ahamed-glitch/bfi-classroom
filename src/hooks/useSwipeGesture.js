import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useSwipeGesture — Touch-aware swipe gesture hook
 *
 * Designed following iOS / Android native "swipe-to-go-back" conventions.
 *
 * Key design decisions:
 * - Uses CAPTURE phase for touchstart so gestures work even when the
 *   swipe container holds scrollable children (e.g. chat-messages).
 * - Sets touch-action: pan-y on the container so the browser doesn't
 *   consume horizontal touch moves before JS can process them.
 * - All mutable state lives in a ref to avoid stale closures.
 *
 * @param {Object}   ref        React ref attached to the swipe container
 * @param {Object}   options
 * @param {'right'|'left'|'both'} options.direction  Which swipe to detect
 * @param {number}   options.threshold  Pixel distance for a complete swipe (default 60)
 * @param {number}   options.edgeWidth  Edge zone width when edgeOnly is true (default 80)
 * @param {boolean}  options.edgeOnly   Only start from the leading edge
 * @param {boolean}  options.enabled    Master on/off switch (default true)
 * @param {Function} options.onSwipe    Callback when swipe completes
 */
export default function useSwipeGesture(ref, options = {}) {
  const {
    direction = 'right',
    threshold = 60,
    edgeWidth = 80,
    edgeOnly = false,
    enabled = true,
    onSwipe,
  } = options;

  // Visual state exposed to the component
  const [swipeState, setSwipeState] = useState({
    isSwiping: false,
    swipeOffset: 0,
    progress: 0,
  });

  // Keep all mutable tracking in a single ref — avoids stale closures AND
  // prevents re-creating event handlers on every render.
  const tracking = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    lockedAxis: null,   // null | 'horizontal' | 'vertical'
    active: false,
    lastOffset: 0,
    lastProgress: 0,
  });

  // Keep options + callback in refs so handlers never go stale
  const onSwipeRef = useRef(onSwipe);

  const optionsRef = useRef({ direction, threshold, edgeWidth, edgeOnly, enabled });

  useEffect(() => {
    onSwipeRef.current = onSwipe;
    optionsRef.current = { direction, threshold, edgeWidth, edgeOnly, enabled };
  }, [direction, edgeOnly, edgeWidth, enabled, onSwipe, threshold]);

  // ── Stable event handlers (never recreated) ───────────────────────
  const handleTouchStart = useCallback((e) => {
    const { enabled: en, edgeOnly: eo, edgeWidth: ew, direction: dir } = optionsRef.current;
    if (!en) return;

    const touch = e.touches[0];
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    if (eo) {
      const localX = touch.clientX - rect.left;
      if (dir === 'right' && localX > ew) return;
      if (dir === 'left' && localX < rect.width - ew) return;
    }

    tracking.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      lockedAxis: null,
      active: false,
      lastOffset: 0,
      lastProgress: 0,
    };
  }, [ref]);

  const handleTouchMove = useCallback((e) => {
    const { direction: dir, threshold: thr } = optionsRef.current;
    const t = tracking.current;
    if (t.startX === 0 && t.startY === 0) return;

    const touch = e.touches[0];
    const dx = touch.clientX - t.startX;
    const dy = touch.clientY - t.startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Direction lock (10px dead-zone)
    if (!t.lockedAxis) {
      if (adx < 10 && ady < 10) return;
      t.lockedAxis = adx >= ady ? 'horizontal' : 'vertical';
    }

    if (t.lockedAxis === 'vertical') {
      if (t.active) {
        t.active = false;
        setSwipeState({ isSwiping: false, swipeOffset: 0, progress: 0 });
      }
      return;
    }

    // Horizontal — check direction filter
    if (dir === 'right' && dx <= 0) return;
    if (dir === 'left' && dx >= 0) return;

    // Prevent browser back-navigation / horizontal scroll
    e.preventDefault();
    e.stopPropagation();

    t.active = true;

    // Rubber-band effect
    const raw = adx;
    const clamped = raw <= thr ? raw : thr + (raw - thr) * 0.3;
    const progress = Math.min(raw / thr, 1);

    t.lastOffset = dir === 'left' ? -clamped : clamped;
    t.lastProgress = progress;

    setSwipeState({
      isSwiping: true,
      swipeOffset: t.lastOffset,
      progress,
    });
  }, []);

  const handleTouchEnd = useCallback(() => {
    const t = tracking.current;

    if (t.active) {
      const elapsed = Date.now() - t.startTime;
      const velocity = (Math.abs(t.lastOffset) / Math.max(elapsed, 1));
      const completed = t.lastProgress >= 0.5 || velocity > 0.3;

      if (completed) {
        onSwipeRef.current?.();
      }
    }

    tracking.current = {
      startX: 0,
      startY: 0,
      startTime: 0,
      lockedAxis: null,
      active: false,
      lastOffset: 0,
      lastProgress: 0,
    };
    setSwipeState({ isSwiping: false, swipeOffset: 0, progress: 0 });
  }, []);

  // ── Register listeners — uses capture for touchstart so we beat
  //    scrollable children. Sets touch-action: pan-y so browser
  //    doesn't consume horizontal moves. ─────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;

    // Tell browser: "vertical scroll is yours, horizontal is mine"
    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'pan-y pinch-zoom';

    // Use capture on touchstart so we see the event before any
    // scrollable child elements get it.
    el.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true, capture: true });

    return () => {
      el.style.touchAction = prevTouchAction;
      el.removeEventListener('touchstart', handleTouchStart, { capture: true });
      el.removeEventListener('touchmove', handleTouchMove, { capture: true });
      el.removeEventListener('touchend', handleTouchEnd, { capture: true });
      el.removeEventListener('touchcancel', handleTouchEnd, { capture: true });
    };
  }, [ref, enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return swipeState;
}
