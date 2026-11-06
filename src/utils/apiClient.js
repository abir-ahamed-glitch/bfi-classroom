/**
 * src/utils/apiClient.js
 *
 * Central authenticated HTTP client for BFI Classroom.
 *
 * Key Capabilities:
 * 1. Automatic Bearer token injection from localStorage.
 * 2. Automatic credentials: 'include' for session cookies (including httpOnly refresh tokens).
 * 3. Multi-Tab & In-Flight Concurrency Coordination:
 *    - Uses navigator.locks ('bfi_auth_refresh_lock') where supported, plus in-flight promise sharing.
 *    - Inspects 'bfi_token_refreshed_at' timestamp: if another tab refreshed the token within 15 seconds,
 *      reuses the newly updated token without issuing a redundant network request.
 * 4. Transparent Request Retry: Requests failing with 401 TOKEN_EXPIRED are retried with the fresh token.
 * 5. Strict Error Discrimination:
 *    - ONLY explicit 401/403 authentication rejections from the refresh endpoint trigger 'bfi:session-expired'
 *      and remove the invalid access token.
 *    - Network errors (TypeError / offline) and 5xx server errors NEVER destroy valid credentials or falsely
 *      claim session expiration.
 */

export class SessionExpiredError extends Error {
  constructor(message = 'Session expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
    this.code = 'SESSION_EXPIRED';
    this.status = 401;
  }
}

export class AuthServerError extends Error {
  constructor(message = 'Authentication server temporarily unavailable.', status = 500) {
    super(message);
    this.name = 'AuthServerError';
    this.code = 'AUTH_SERVER_ERROR';
    this.status = status;
  }
}

// In-flight refresh promise mutex (single tab / single JS context)
let inFlightRefreshPromise = null;

/**
 * Performs the actual network request to /api/auth/refresh.
 * Strict error discrimination:
 * - 401 / 403 => Session truly expired / revoked. Clears token, emits bfi:session-expired, throws SessionExpiredError.
 * - 5xx => Server error. Preserves credentials, throws AuthServerError.
 * - Network exception => Network failure. Preserves credentials, throws Error.
 */
async function executeRefreshHttpCall() {
  let response;
  try {
    response = await window.fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  } catch (netErr) {
    // Network offline / connection reset: do NOT destroy credentials
    const err = new Error(netErr.message || 'Network error during authentication refresh');
    err.isNetworkError = true;
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    // Session is dead on the server
    localStorage.removeItem('token');
    localStorage.setItem('bfi_session_dead', 'true');
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('bfi_session_expired', 'true');
    }
    let errBody = {};
    try {
      errBody = await response.json();
    } catch {
      /* ignore json parse error */
    }
    const reasonCode = errBody.code || 'SESSION_EXPIRED';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bfi:session-expired', {
          detail: { reason: reasonCode, status: response.status },
        })
      );
    }
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('bfi_auth_channel');
        bc.postMessage({ type: 'SESSION_EXPIRED', reason: reasonCode, status: response.status });
        bc.close();
      }
    } catch { /* ignore */ }
    const error = new SessionExpiredError(
      errBody.error || 'Your session has expired. Please sign in again to continue.'
    );
    error.status = response.status;
    error.code = reasonCode;
    throw error;
  }

  if (response.status >= 500) {
    // Temporary server malfunction: do NOT destroy credentials
    throw new AuthServerError(
      `Authentication service is temporarily unavailable (${response.status}).`,
      response.status
    );
  }

  if (!response.ok) {
    throw new Error(`Authentication refresh failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data || !data.token) {
    throw new SessionExpiredError('Invalid authentication response from server.');
  }

  const now = Date.now();
  localStorage.setItem('token', data.token);
  localStorage.setItem('bfi_token_refreshed_at', String(now));
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('bfi_auth_channel');
      bc.postMessage({ type: 'TOKEN_REFRESHED', token: data.token, refreshedAt: now });
      bc.close();
    }
  } catch { /* ignore */ }

  if (data.user) {
    if (data.user.profilePicture && !data.user.profile_picture) {
      data.user.profile_picture = data.user.profilePicture;
    }
    try {
      localStorage.setItem('auth_user_cache', JSON.stringify(data.user));
    } catch {
      /* ignore quota errors */
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('bfi:token-refreshed', {
        detail: { token: data.token, user: data.user },
      })
    );
  }

  return data.token;
}

/**
 * Refreshes the access token using the httpOnly refresh cookie.
 * Coordinates concurrent callers within the same tab and across separate browser tabs.
 *
 * @returns {Promise<string>} The new access token
 */
export async function refreshAccessToken(failedToken = null) {
  // 1. Check if token was refreshed by another request/tab within the last 15 seconds
  const currentToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  const lastRefreshAt = typeof localStorage !== 'undefined' ? parseInt(localStorage.getItem('bfi_token_refreshed_at') || '0', 10) : 0;
  if (currentToken && (!failedToken || currentToken !== failedToken) && Date.now() - lastRefreshAt < 15000) {
    return currentToken;
  }

  // 2. Intra-tab mutex: reuse active in-flight promise if available
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  // 3. Multi-tab coordination
  const runWithLock = async () => {
    // A. Supported modern browsers: Web Locks API (Platform-level atomic synchronization)
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request('bfi_auth_refresh_lock', async () => {
        // Re-check once lock is acquired
        const tokenNow = localStorage.getItem('token');
        const refreshedAt = parseInt(localStorage.getItem('bfi_token_refreshed_at') || '0', 10);
        if (tokenNow && (!failedToken || tokenNow !== failedToken) && Date.now() - refreshedAt < 15000) {
          return tokenNow;
        }

        // Check if session was marked dead by another tab while waiting for lock
        if (
          localStorage.getItem('bfi_session_dead') ||
          (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('bfi_session_expired'))
        ) {
          throw new SessionExpiredError('Session has expired.');
        }

        return executeRefreshHttpCall();
      });
    }

    // B. Fallback when Web Locks API is unavailable (unsupported browsers):
    // Note: localStorage check-and-set is NOT an atomic mutex.
    // We provide cooperative waiting to reduce collision probability during transient delays,
    // but if concurrent requests race, the server strictly enforces single-use replay rejection
    // (401 TOKEN_ALREADY_ROTATED), and the client fails safely: persists the unsaved draft
    // to author-scoped localStorage and redirects to login for re-authentication.
    if (typeof localStorage !== 'undefined') {
      const inProgressAt = parseInt(localStorage.getItem('bfi_refresh_in_progress') || '0', 10);

      if (inProgressAt && Date.now() - inProgressAt < 6000) {
        // Wait up to 6 seconds (60 * 100ms) for leader to finish
        for (let i = 0; i < 60; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));

          const freshToken = localStorage.getItem('token');
          const freshAt = parseInt(localStorage.getItem('bfi_token_refreshed_at') || '0', 10);
          if (freshToken && (!failedToken || freshToken !== failedToken) && Date.now() - freshAt < 15000) {
            return freshToken;
          }

          if (
            localStorage.getItem('bfi_session_dead') ||
            (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('bfi_session_expired'))
          ) {
            throw new SessionExpiredError('Session has expired.');
          }

          if (!localStorage.getItem('bfi_refresh_in_progress')) {
            break;
          }
        }
      }

      // Check one final time before attempting HTTP call
      const freshTokenAfterWait = localStorage.getItem('token');
      const freshAtAfterWait = parseInt(localStorage.getItem('bfi_token_refreshed_at') || '0', 10);
      if (freshTokenAfterWait && (!failedToken || freshTokenAfterWait !== failedToken) && Date.now() - freshAtAfterWait < 15000) {
        return freshTokenAfterWait;
      }

      localStorage.setItem('bfi_refresh_in_progress', String(Date.now()));
      try {
        return await executeRefreshHttpCall();
      } finally {
        localStorage.removeItem('bfi_refresh_in_progress');
      }
    }

    return executeRefreshHttpCall();
  };

  inFlightRefreshPromise = runWithLock().finally(() => {
    inFlightRefreshPromise = null;
  });

  return inFlightRefreshPromise;
}

/**
 * Checks whether an endpoint URL is an authentication management route
 * that should never trigger an automatic refresh loop.
 */
function isAuthEndpoint(url) {
  if (typeof url !== 'string') return false;
  return (
    url.includes('/api/auth/refresh') ||
    url.includes('/api/auth/login') ||
    url.includes('/api/auth/logout') ||
    url.includes('/api/auth/mfa/verify') ||
    url.includes('/api/auth/mfa-verify')
  );
}

/**
 * Authenticated fetch client wrapper.
 * Compatible with the standard fetch(url, options) API.
 *
 * @param {string | URL | Request} input
 * @param {RequestInit & { _isRetry?: boolean }} [init]
 * @returns {Promise<Response>}
 */
export async function apiClient(input, init = {}) {
  const options = { ...init };

  // Always send cookies (refresh token cookie & session cookies)
  if (!options.credentials) {
    options.credentials = 'include';
  }

  // Normalize headers
  const headers = new Headers(options.headers || {});

  // Inject Bearer token if not already explicitly provided
  const existingAuth = headers.get('Authorization');
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  if (!existingAuth && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Handle plain object JSON body
  if (
    options.body &&
    typeof options.body === 'object' &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof URLSearchParams) &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof ArrayBuffer)
  ) {
    options.body = JSON.stringify(options.body);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  options.headers = headers;

  const urlString = typeof input === 'string' ? input : (input?.url || '');

  // Perform initial request
  const response = await window.fetch(input, options);

  // If request succeeded or is not 401, return response directly
  if (response.status !== 401) {
    return response;
  }

  // If already retried or this is an excluded auth endpoint, return the 401 response directly
  if (options._isRetry || isAuthEndpoint(urlString)) {
    return response;
  }

  // Inspect 401 body without consuming the original response body
  let shouldRefresh = false;
  let isRevoked = false;
  try {
    const clone = response.clone();
    const data = await clone.json();
    if (data.code === 'SESSION_REVOKED') {
      isRevoked = true;
    } else if (
      data.code === 'TOKEN_EXPIRED' ||
      data.error === 'Token expired' ||
      data.error === 'jwt expired' ||
      Boolean(token)
    ) {
      shouldRefresh = true;
    }
  } catch {
    shouldRefresh = Boolean(token);
  }

  if (isRevoked) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('token');
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('bfi_session_expired', 'true');
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('bfi:session-expired', {
          detail: { reason: 'SESSION_REVOKED', status: 401 },
        })
      );
    }
    return response;
  }

  if (!shouldRefresh) {
    return response;
  }

  // Attempt coordinated token refresh
  let newToken = null;
  try {
    newToken = await refreshAccessToken(token);
  } catch {
    // If refresh failed (whether expired or network error), return original 401 response
    return response;
  }

  // Retry the request with the new access token
  const retryHeaders = new Headers(options.headers);
  retryHeaders.set('Authorization', `Bearer ${newToken}`);

  const retryOptions = {
    ...options,
    headers: retryHeaders,
    _isRetry: true,
  };

  return window.fetch(input, retryOptions);
}

/**
 * Convenience helper to clear auth session credentials.
 * Also clears the bfi_session_dead cooperative signaling flag so that
 * a successful re-login does not leave waiting tabs stuck in the dead-session path.
 *
 * NOTE: bfi_session_expired in sessionStorage is intentionally NOT cleared here.
 * ProtectedRoute reads that flag after currentUser becomes null to decide whether to
 * append ?session_expired=true to the login redirect URL. The flag is cleared only
 * after a successful re-login (in AuthContext.login() and AuthContext.verifyMfa()).
 */
export function clearSession() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('token');
    localStorage.removeItem('auth_user_cache');
    localStorage.removeItem('bfi_token_refreshed_at');
    localStorage.removeItem('bfi_refresh_in_progress');
    localStorage.removeItem('bfi_session_dead');
  }
}

export default apiClient;

// Cross-tab real-time sync via BroadcastChannel and Storage Events
if (typeof window !== 'undefined') {
  window.apiClient = apiClient;
  window.refreshAccessToken = refreshAccessToken;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const authChannel = new BroadcastChannel('bfi_auth_channel');
      authChannel.onmessage = (event) => {
        if (event.data?.type === 'TOKEN_REFRESHED' && event.data.token) {
          localStorage.setItem('token', event.data.token);
          localStorage.setItem('bfi_token_refreshed_at', String(event.data.refreshedAt || Date.now()));
        } else if (event.data?.type === 'SESSION_EXPIRED') {
          // A sibling tab's refresh attempt was rejected — mark session dead locally.
          localStorage.setItem('bfi_session_dead', 'true');
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('bfi_session_expired', 'true');
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('bfi:session-expired', {
                detail: { reason: event.data.reason, status: event.data.status },
              })
            );
          }
        }
      };
    } catch {
      /* ignore channel error */
    }
  }

  // Cross-tab sync fallback for browsers lacking BroadcastChannel
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key === 'token' && event.newValue) {
        window.dispatchEvent(
          new CustomEvent('bfi:token-refreshed', {
            detail: { token: event.newValue },
          })
        );
      }
    });
  }
}
