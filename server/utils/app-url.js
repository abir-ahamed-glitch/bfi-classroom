/**
 * Validated Application URL Resolver
 * 
 * Enforces configured, trusted application URL without trusting hostile request headers (Origin/Host).
 * Enforces HTTPS in production and preserves the application base path.
 */
export function getValidatedAppUrl() {
  const configured = process.env.APP_URL || process.env.CLIENT_URL || process.env.FRONTEND_URL;
  if (!configured || typeof configured !== 'string' || !configured.trim()) {
    const err = new Error('Application URL is not configured. Configure APP_URL or CLIENT_URL in the environment.');
    err.code = 'INVALID_URL_CONFIGURATION';
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(configured.trim());
  } catch {
    const err = new Error('Configured application URL is malformed.');
    err.code = 'INVALID_URL_CONFIGURATION';
    throw err;
  }

  if (process.env.NODE_ENV === 'production') {
    if (parsed.protocol !== 'https:') {
      const err = new Error('Application URL must use HTTPS in production.');
      err.code = 'INVALID_URL_CONFIGURATION';
      throw err;
    }
  } else {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      const err = new Error('Application URL must use HTTP or HTTPS.');
      err.code = 'INVALID_URL_CONFIGURATION';
      throw err;
    }
  }

  let basePath = parsed.pathname.replace(/\/+$/, '');
  if (!basePath) {
    basePath = '';
  }

  return `${parsed.protocol}//${parsed.host}${basePath}`;
}
