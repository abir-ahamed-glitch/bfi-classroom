/**
 * src/utils/apiClient.js
 *
 * Central authenticated HTTP client for BFI Classroom.
 *
 * Features:
 * 1. Automatic Bearer token injection from localStorage.
 * 2. Automatic credentials: 'include' for session cookies (including httpOnly refresh tokens).
 * 3. Concurrent Refresh Coordination (Mutex / In-Flight Promise Sharing):
 *    Multiple simultaneous 401 responses share a single /api/auth/refresh call,
 *    preventing duplicate refresh token consumption and cookie collision.
 * 4. Transparent Retry: Requests failing with 401 TOKEN_EXPIRED are retried with the fresh token.
 * 5. Safe Failure / Session Expired Signaling:
 *    When refresh fails (revoked or expired refresh token), fires 'bfi:session-expired'
 *    and clears only the invalid access token, preserving user drafts and form states.
 */

export class SessionExpiredError extends Error {
  constructor(message = 'Session expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
    this.code = 'SESSION_EXPIRED';
    this.status = 401;
  }
}

// In-flight refresh promise mutex
let inFlightRefreshPromise = null;

/**
 * Refreshes the access token using the httpOnly refresh cookie.
 * Coordinates concurrent callers so only one /api/auth/refresh request is dispatched.
 *
 * @returns {Promise<string>} The new access token
 */
export async function refreshAccessToken() {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const response = await window.fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        let errData = {};
        try {
          errData = await response.json();
        } catch {
          errData = {};
        }
        const error = new SessionExpiredError(
          errData.error || 'Your session has expired. Please sign in again to continue.'
        );
        error.status = response.status;
        error.code = errData.code || 'SESSION_EXPIRED';
        throw error;
      }

      const data = await response.json();
      if (!data || !data.token) {
        throw new SessionExpiredError('Invalid authentication response from server.');
      }

      localStorage.setItem('token', data.token);

      if (data.user) {
        if (data.user.profilePicture && !data.user.profile_picture) {
          data.user.profile_picture = data.user.profilePicture;
        }
        try {
          localStorage.setItem('auth_user_cache', JSON.stringify(data.user));
        } catch {
          // Ignore localStorage quota errors
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
    } catch (err) {
      // Refresh session is invalid, expired, or revoked
      localStorage.removeItem('token');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bfi:session-expired', {
            detail: { error: err.message || 'Session expired' },
          })
        );
      }
      throw err;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

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
  try {
    const clone = response.clone();
    const data = await clone.json();
    if (
      data.code === 'TOKEN_EXPIRED' ||
      data.error === 'Token expired' ||
      data.error === 'jwt expired' ||
      // Or any 401 where an access token was provided and not revoked
      Boolean(token && data.code !== 'SESSION_REVOKED')
    ) {
      shouldRefresh = true;
    }
  } catch {
    // If body is not JSON but 401 was returned with a token present, attempt refresh
    shouldRefresh = Boolean(token);
  }

  if (!shouldRefresh) {
    return response;
  }

  // Attempt coordinated token refresh
  let newToken = null;
  try {
    newToken = await refreshAccessToken();
  } catch {
    // Refresh failed - session is dead
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
 */
export function clearSession() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('token');
    localStorage.removeItem('auth_user_cache');
  }
}

export default apiClient;
