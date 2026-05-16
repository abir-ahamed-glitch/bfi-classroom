import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from '../utils/haptics';

/**
 * usePullToRefresh — Pull-to-refresh gesture hook
 *
 * Attaches to a scrollable container and detects a downward drag when
 * the container is already scrolled to the top.
 *
 * @param {Object}   containerRef  React ref to the scrollable element
 * @param {Object}   options
 * @param {Function} options.onRefresh   Async callback triggered on release
 * @param {number}   options.threshold   Drag distance to trigger refresh (default 80)
 * @param {boolean}  options.enabled     Master toggle (default true)
 *
 * @returns {{ isPulling, pullDistance, isRefreshing }}
 */
export default function usePullToRefresh(containerRef, options = {}) {
  const {
    onRefresh,
    threshold = 80,
    enabled = true,
  } = options;

  const [state, setState] = useState({
    isPulling: false,
    pullDistance: 0,
    isRefreshing: false,
  });

  const tracking = useRef({
    startY: 0,
    active: false,
  });

  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const handleTouchStart = useCallback((e) => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    // Only activate when scrolled to top
    if (el.scrollTop > 5) return;

    tracking.current = {
      startY: e.touches[0].clientY,
      active: true,
    };
  }, [enabled, containerRef]);

  const handleTouchMove = useCallback((e) => {
    const t = tracking.current;
    if (!t.active) return;

    const dy = e.touches[0].clientY - t.startY;
    if (dy < 0) {
      // Scrolling up — cancel pull
      t.active = false;
      setState(s => ({ ...s, isPulling: false, pullDistance: 0 }));
      return;
    }

    // Rubber-band effect
    const damped = dy <= threshold ? dy : threshold + (dy - threshold) * 0.25;

    e.preventDefault();
    setState(s => ({
      ...s,
      isPulling: true,
      pullDistance: damped,
    }));
  }, [threshold]);

  const handleTouchEnd = useCallback(async () => {
    const t = tracking.current;
    if (!t.active) return;
    t.active = false;

    const { pullDistance } = state;

    if (pullDistance >= threshold) {
      haptic('medium');
      setState(s => ({ ...s, isPulling: false, pullDistance: 0, isRefreshing: true }));
      try {
        await onRefreshRef.current?.();
      } catch { /* swallow */ }
      setState(s => ({ ...s, isRefreshing: false }));
    } else {
      setState({ isPulling: false, pullDistance: 0, isRefreshing: false });
    }
  }, [state, threshold]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [containerRef, enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return state;
}
