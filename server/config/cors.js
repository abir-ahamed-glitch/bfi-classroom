/**
 * CORS Origin Validator & Options
 * 
 * Enforces an explicit allowlist of authorized frontend origins.
 * Omits Access-Control-Allow-Origin for unauthorized origins so that browsers
 * block cross-origin response reading and reject cross-origin preflights.
 */

export function getAllowedOrigins() {
  const origins = new Set([
    'https://classroom.bfibd.org',
  ]);

  const envCandidates = [
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    process.env.CLIENT_URL,
    process.env.CORS_ALLOWED_ORIGINS,
  ];

  for (const raw of envCandidates) {
    if (!raw || typeof raw !== 'string') continue;
    const parts = raw.split(',');
    for (const part of parts) {
      const trimmed = part.trim().toLowerCase().replace(/\/+$/, '');
      if (trimmed) {
        try {
          const u = new URL(trimmed);
          origins.add(`${u.protocol}//${u.host}`);
        } catch {
          origins.add(trimmed);
        }
      }
    }
  }

  // Preserve local development environments
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:5173');
    origins.add('http://localhost:5174');
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:5173');
    origins.add('http://127.0.0.1:5174');
    origins.add('http://127.0.0.1:3000');
  }

  return Array.from(origins);
}

export function isOriginAllowed(origin) {
  // Allow requests without Origin header (e.g. same-origin, curl, server-to-server, mobile app)
  if (!origin) return true;

  const normalized = origin.trim().toLowerCase().replace(/\/+$/, '');
  const allowed = getAllowedOrigins();
  if (allowed.includes(normalized)) {
    return true;
  }

  // During local development, allow any port on localhost or 127.0.0.1
  if (process.env.NODE_ENV !== 'production') {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
      return true;
    }
  }

  return false;
}

export const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

export const socketCorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
};
