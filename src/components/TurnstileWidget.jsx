import { useEffect, useRef } from 'react';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '0x4AAAAAAFjcg344NyZ8QEVR';

export default function TurnstileWidget({ onVerify, onError, onExpire, resetKey = 0, theme = 'dark' }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onVerify, onError, onExpire });

  // Keep latest callbacks without triggering widget re-renders
  useEffect(() => {
    callbacksRef.current = { onVerify, onError, onExpire };
  });

  useEffect(() => {
    let isMounted = true;
    let timer = null;

    const renderWidget = () => {
      if (!window.turnstile || typeof window.turnstile.render !== 'function' || !containerRef.current || !isMounted) {
        return;
      }
      if (widgetIdRef.current !== null) return;

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme,
          callback: (token) => {
            if (isMounted && callbacksRef.current.onVerify) {
              callbacksRef.current.onVerify(token);
            }
          },
          'error-callback': (code) => {
            console.warn('[Turnstile] Verification code:', code);
            if (isMounted && callbacksRef.current.onError) {
              callbacksRef.current.onError(code);
            }
          },
          'expired-callback': () => {
            if (isMounted && callbacksRef.current.onExpire) {
              callbacksRef.current.onExpire();
            }
          },
        });
      } catch (err) {
        console.error('[Turnstile] Render error:', err);
      }
    };

    if (window.turnstile && typeof window.turnstile.render === 'function') {
      renderWidget();
    } else {
      timer = setInterval(() => {
        if (window.turnstile && typeof window.turnstile.render === 'function') {
          clearInterval(timer);
          renderWidget();
        }
      }, 100);
    }

    return () => {
      isMounted = false;
      if (timer) clearInterval(timer);
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup error if already unmounted
        }
        widgetIdRef.current = null;
      }
    };
  }, [theme]);

  // Watch for resetKey increments to clear/reset the widget
  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current !== null && window.turnstile && typeof window.turnstile.reset === 'function') {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch (err) {
        console.warn('[Turnstile] Reset failed:', err);
      }
    }
  }, [resetKey]);

  return (
    <div 
      className="turnstile-wrapper"
      style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        minHeight: '65px',
        margin: '0.2rem 0'
      }}
    >
      <div ref={containerRef} />
    </div>
  );
}
