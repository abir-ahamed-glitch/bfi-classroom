import './bootstrap.js';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { initializeDatabase } from './db/database.js';
import db from './db/database.js';

import jwt from 'jsonwebtoken';
import { validateSafePublicUrl, isPrivateIP, createPinnedAgent, readBoundedStream, PayloadTooLargeError } from './utils/ssrf-filter.js';

// Process crash guards — prevent unhandled rejections from terminating the server process
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Guard] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process Guard] Uncaught Exception:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Routes
import authRoutes from './routes/auth.js';
import adminRoutes, { startAnnouncementScheduler } from './routes/admin.js';
import studentRoutes from './routes/student.js';
import portfolioRoutes from './routes/portfolio.js';
import communityRoutes, { startCommunityScheduler } from './routes/community.js';
import courseRoutes from './routes/course.js';
import inboxRoutes from './routes/inbox.js';
import bfiaaRoutes from './routes/bfiaa.js';
import certificationRoutes from './routes/certification.js';
import experienceRoutes from './routes/experience.js';
import registryRoutes from './routes/registry.js';
import { trashEvents } from './utils/trashLogger.js';
import { securityEvents } from './utils/security-events.js';
import notificationsRoutes from './routes/notifications.js';
import analyticsRoutes from './routes/analytics.js';
import reportsRoutes from './routes/reports.js';
import feesRoutes from './routes/fees.js';
import feeTrackerRoutes from './routes/fee-tracker.js';
import batchRoutes from './routes/batches.js';
import studentExportRoutes from './routes/student-export.js';
import courseSettingsRoutes from './routes/course-settings.js';
import courseDefinitionsRoutes from './routes/course-definitions.js';
import { runBatchStatusAutomation } from './utils/batchStatusAutomation.js';
import broadcastRoutes from './routes/broadcast.js';
import trashRoutes from './routes/trash.js';
import adminManagementRoutes from './routes/admin-management.js';
import { checkScheduledBroadcasts } from './utils/broadcastScheduler.js';

import { getJwtRefreshSecret, getJwtSecret } from './config/security.js';
import { authenticateToken } from './middleware/auth.js';

const app = express();
const httpServer = createServer(app);
app.set('trust proxy', 1);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e7
});
app.set('io', io);

const PORT = process.env.PORT || 3001;

// Initialize Database
try {
  initializeDatabase();
  getJwtSecret();
  getJwtRefreshSecret();
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // CRITICAL: 'no-referrer' (helmet default) breaks YouTube embeds — YouTube needs
  // to see the referrer/origin to validate embedded player requests (Error 153 fix).
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Enforce HTTPS and prevent downgrade attacks
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: false, // Set to true after testing
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://static.cloudflareinsights.com", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.cdnfonts.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.cdnfonts.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https://img.youtube.com", "https://i.ytimg.com", "https://*.ytimg.com", "https://*.youtube.com", "https://*.vimeocdn.com", "https://graph.facebook.com", "https://*.dailymotion.com", "https://s1.dmcdn.net", "https://*.fbcdn.net", "https://*.cdninstagram.com"],
      connectSrc: ["'self'", "blob:", "wss:", "https://*.trycloudflare.com", "https://www.youtube.com", "https://*.youtube.com", "https://*.googlevideo.com", "https://vimeo.com", "https://api.vimeo.com", "https://cloudflareinsights.com", "https://*.cloudflareinsights.com", "https://challenges.cloudflare.com"],
      mediaSrc: ["'self'", "data:", "blob:", "https://*.youtube.com", "https://*.vimeo.com", "https://*.googlevideo.com"],
      frameSrc: ["'self'", "https://*.youtube.com", "https://*.vimeo.com", "https://*.facebook.com", "https://challenges.cloudflare.com"],
      workerSrc: ["'self'", "blob:"],
    },
  },
}));

// Image Proxy to bypass CSP for external thumbnails
// Allowed CDN domain suffixes — broad enough for major platforms
const PROXY_ALLOWED_SUFFIXES = [
  'ytimg.com', 'yt3.googleapis.com', 'youtube.com', // YouTube
  'vimeocdn.com', 'vimeo.com',                 // Vimeo
  'fbcdn.net', 'fbsbx.com',                    // Facebook
  'cdninstagram.com',                          // Instagram
  'twimg.com', 'pbs.twimg.com',                // Twitter/X
  'redd.it', 'redditmedia.com', 'reddituploads.com', 'reddstatic.com', // Reddit
  'dailymotion.com', 's1.dmcdn.net',           // Dailymotion
  'tiktokcdn.com', 'tiktokcdn-us.com',         // TikTok
  'unsplash.com', 'images.unsplash.com',       // Unsplash
  'googleusercontent.com', 'gstatic.com',      // Google
  'github.com', 'avatars.githubusercontent.com', 'opengraph.githubassets.com', // GitHub
  'linkedin.com', 'media.licdn.com',           // LinkedIn
  'pinimg.com',                                // Pinterest
  'twitch.tv', 'static-cdn.jtvnw.net',        // Twitch
];

function isProxyDomainAllowed(hostname) {
  const h = hostname.toLowerCase();
  return PROXY_ALLOWED_SUFFIXES.some(suffix => h === suffix || h.endsWith('.' + suffix));
}


// SEC-02 & SEC-05: Dedicated rate limiter for public proxy and link preview endpoints
const publicProxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60, // 60 requests per 15 minutes per IP
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many proxy requests. Please try again later.' }
});

app.get(['/api/proxy-image', '/bfi-classroom/api/proxy-image'], publicProxyLimiter, async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ error: 'URL is required' });
  
  let dispatcher = null;
  let timeout = null;
  const controller = new AbortController();

  const onClientClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on('close', onClientClose);

  try {
    // SEC-02: Comprehensive SSRF validation & IP pinning
    const { parsedUrl, pinnedIp } = await validateSafePublicUrl(imageUrl, { httpsOnly: true });

    // 8 second deadline maintained through body streaming
    timeout = setTimeout(() => controller.abort(), 8000);
    dispatcher = createPinnedAgent(pinnedIp);

    const response = await fetch(parsedUrl.href, {
      signal: controller.signal,
      dispatcher,
      redirect: 'error',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BFIClassroomBot/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(`Upstream returned ${response.status}`);
    }
    
    const rawContentType = response.headers.get('content-type') || '';
    const contentType = rawContentType.split(';')[0].trim().toLowerCase();
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedImageTypes.includes(contentType)) {
      await response.body?.cancel?.().catch(() => {});
      return res.status(403).json({ error: 'Content must be an allowed image (jpeg, png, webp, gif)' });
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // SEC-02: Bound streaming body to 5MB with active timeout and cleanup
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    const { chunks } = await readBoundedStream(response.body, {
      maxBytes: MAX_IMAGE_BYTES,
      signal: controller.signal,
      mode: 'buffer'
    });
    
    res.send(Buffer.concat(chunks));
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      return res.status(408).json({ error: 'Proxy request timed out or was aborted' });
    }
    if (error.name === 'PayloadTooLargeError') {
      return res.status(413).json({ error: 'Image exceeds maximum allowed size (5MB)' });
    }
    const isRedirectError = error.message?.includes('redirect') || error.cause?.message?.includes('redirect');
    const isSsrf = error.message.includes('forbidden') || error.message.includes('restricted') || error.message.includes('only https');
    const status = isRedirectError ? 400 : (isSsrf ? 403 : 400);
    res.status(status).json({ error: error.message || 'Error proxying image' });
  } finally {
    if (timeout) clearTimeout(timeout);
    res.off('close', onClientClose);
    try { dispatcher?.destroy?.(); } catch (_destroyErr) { /* ignore cleanup error */ }
  }
});

// Link Preview endpoint — fetches OpenGraph metadata for a given URL
const linkPreviewCache = new Map();
app.get(['/api/link-preview', '/bfi-classroom/api/link-preview'], publicProxyLimiter, async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL is required' });

  // LRU cache eviction cap at 200 entries
  if (linkPreviewCache.size > 200) {
    const oldestKey = linkPreviewCache.keys().next().value;
    linkPreviewCache.delete(oldestKey);
  }

  // Cache check (5 minutes TTL)
  const cacheKey = targetUrl;
  if (linkPreviewCache.has(cacheKey)) {
    const cached = linkPreviewCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return res.json(cached.data);
    }
    linkPreviewCache.delete(cacheKey);
  }

  let dispatcher = null;
  let timeout = null;
  const controller = new AbortController();

  const onClientClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on('close', onClientClose);

  try {
    // SEC-02: Comprehensive SSRF validation & IP pinning
    const { parsedUrl, pinnedIp } = await validateSafePublicUrl(targetUrl);

    // 6 second deadline maintained through body streaming
    timeout = setTimeout(() => controller.abort(), 6000);
    dispatcher = createPinnedAgent(pinnedIp);

    const response = await fetch(parsedUrl.href, {
      signal: controller.signal,
      dispatcher,
      redirect: 'error',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BFIClassroomBot/1.0; +https://bfi.gov.bd)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      await response.body?.cancel?.().catch(() => {});
      return res.json({ url: targetUrl, title: parsedUrl.hostname });
    }

    // Only read first 100KB to extract meta tags without loading huge pages
    const MAX_PREVIEW_BYTES = 100 * 1024; // 100KB
    const { text: html } = await readBoundedStream(response.body, {
      maxBytes: MAX_PREVIEW_BYTES,
      signal: controller.signal,
      mode: 'text',
      stopPattern: '</head>'
    });

    // Extract OG/Twitter meta tags with a simple regex (no DOM parser needed)
    const getMeta = (property) => {
      const patterns = [
        new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${property}["']`, 'i'),
        new RegExp(`<meta[^>]*name=["']twitter:${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:${property}["']`, 'i'),
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return match[1].trim();
      }
      return null;
    };

    const getTitleTag = () => {
      const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      return match?.[1]?.trim() || null;
    };

    const getFavicon = () => {
      const patterns = [
        /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i,
        /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i,
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
          const iconUrl = match[1].trim();
          if (iconUrl.startsWith('http')) return iconUrl;
          if (iconUrl.startsWith('//')) return `https:${iconUrl}`;
          return `${parsedUrl.protocol}//${parsedUrl.host}${iconUrl.startsWith('/') ? iconUrl : '/' + iconUrl}`;
        }
      }
      // Fallback to /favicon.ico
      return `${parsedUrl.protocol}//${parsedUrl.host}/favicon.ico`;
    };

    const title = getMeta('title') || getTitleTag() || parsedUrl.hostname;
    const description = getMeta('description');
    const image = getMeta('image');
    const siteName = getMeta('site_name') || parsedUrl.hostname;
    const favicon = getFavicon();

    // Resolve relative image URLs
    let resolvedImage = image;
    if (image && !image.startsWith('http')) {
      if (image.startsWith('//')) {
        resolvedImage = `https:${image}`;
      } else {
        resolvedImage = `${parsedUrl.protocol}//${parsedUrl.host}${image.startsWith('/') ? image : '/' + image}`;
      }
    }

    // Route the og:image through our proxy so the browser never needs to
    // hit external CDNs (fbcdn.net, twimg.com, etc.) directly.
    // This bypasses CSP restrictions and avoids auth-required CDN failures.
    const selfBase = req.headers['x-forwarded-proto']
      ? `${req.headers['x-forwarded-proto']}://${req.headers['host']}`
      : `http://localhost:${process.env.PORT || 3001}`;
    const proxyBase = process.env.PUBLIC_URL || selfBase;

    let proxiedImage = null;
    if (resolvedImage) {
      try {
        const imgParsed = new URL(resolvedImage);
        if (isProxyDomainAllowed(imgParsed.hostname)) {
          proxiedImage = `${proxyBase}/api/proxy-image?url=${encodeURIComponent(resolvedImage)}`;
        } else {
          // For domains not in our CDN list, return the URL as-is and let browser try directly
          proxiedImage = resolvedImage;
        }
      } catch {
        proxiedImage = resolvedImage;
      }
    }

    const previewData = {
      url: targetUrl,
      title: title?.substring(0, 200) || parsedUrl.hostname,
      description: description?.substring(0, 400) || null,
      image: proxiedImage || null,
      siteName: siteName?.substring(0, 100),
      favicon,
    };

    linkPreviewCache.set(cacheKey, { data: previewData, timestamp: Date.now() });
    res.json(previewData);
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      res.status(408).json({ error: 'Request timed out' });
    } else {
      console.error('Link preview error:', error.message);
      const isSsrfOrValidation = error.message.includes('forbidden') || 
                                 error.message.includes('restricted') || 
                                 error.message.includes('supported') || 
                                 error.message.includes('Only HTTPS') ||
                                 error.message.includes('Invalid URL');
      const isRedirectError = error.message?.includes('redirect') || error.cause?.message?.includes('redirect');
      const status = isSsrfOrValidation || isRedirectError ? 400 : 500;
      res.status(status).json({ error: isSsrfOrValidation || isRedirectError ? error.message : 'Could not fetch preview' });
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    res.off('close', onClientClose);
    try { dispatcher?.destroy?.(); } catch (_destroyErr) { /* ignore cleanup error */ }
  }
});

// Rate limiting for DDoS and Brute Force prevention
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req) => {
    // SEC-05: Bind key strictly to verified authenticated user ID or remote IP
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    return ipKeyGenerator(req.ip);
  },
  skip: (req) => req.path === '/auth/login',
  message: { error: 'Too many requests, please try again later.' }
});


// Apply rate limiter specifically to /api routes
app.use('/api', apiLimiter);

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Correlation ID Middleware for end-to-end request tracing & audit logs
app.use((req, res, next) => {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId = (typeof incoming === 'string' && incoming.trim()) ? incoming.trim() : (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15));
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

// Inbox attachments are private. Use /api/inbox/attachments/:filename so the
// API can verify the requesting user belongs to that conversation.
app.use(['/media/inbox-attachments', '/bfi-classroom/media/inbox-attachments'], (_req, res) => {
  res.status(401).json({ error: 'Authentication required' });
});

// Static files for media uploads mapping
const reportScreenshotsPath = path.join(__dirname, '..', 'uploads', 'report-screenshots');
const serveReportScreenshot = (req, res) => {
  const filename = path.basename(req.params.filename || '');
  if (!/^report-screenshot-\d+-\d+\.(jpg|png|webp|gif)$/.test(filename)) {
    return res.status(404).end();
  }
  return res.sendFile(path.join(reportScreenshotsPath, filename), (error) => {
    if (error && !res.headersSent) res.status(error.statusCode || 404).end();
  });
};
app.get('/uploads/report-screenshots/:filename', authenticateToken, serveReportScreenshot);
app.get('/bfi-classroom/uploads/report-screenshots/:filename', authenticateToken, serveReportScreenshot);
const serveStaticOptions = {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      res.setHeader('Content-Disposition', 'inline');
    }
  }
};

app.use(['/bfi-classroom/media', '/media'], (req, res, next) => {
  // SEC-03: Retain strict CSP sandbox and nosniff protection for user-uploaded static files
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  
  let urlPath = req.url || '/';
  if (urlPath.split('?')[0].endsWith('/view')) {
    const parts = urlPath.split('?');
    parts[0] = parts[0].slice(0, -5);
    req.url = parts.join('?');
  }
  
  next();
});
app.use('/bfi-classroom/media', express.static(path.join(__dirname, '..', 'uploads'), serveStaticOptions));
app.use('/media', express.static(path.join(__dirname, '..', 'uploads'), serveStaticOptions)); // Keep root for backwards compatibility

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', feesRoutes);
app.use('/api/admin', feeTrackerRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/bfiaa', bfiaaRoutes);
app.use('/api/certification', certificationRoutes);
app.use('/api/experience', experienceRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin/batches', batchRoutes);
app.use('/api/student-export', studentExportRoutes);
app.use('/api/admin/broadcast', broadcastRoutes);
app.use('/api/admin/trash', trashRoutes);
app.use('/api/admin/course-settings', courseSettingsRoutes);
app.use('/api/admin/course-definitions', courseDefinitionsRoutes);
app.use('/api/admin', adminManagementRoutes);

// Test environment and database identity verification endpoint (strictly restricted to test servers)
app.get('/api/test/db-identity', (req, res) => {
  const isTestServer = Boolean(process.env.IS_TEST_SERVER === 'true');
  const isTestEnv = process.env.NODE_ENV === 'test';

  if (!isTestServer && !isTestEnv) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }

  const resolvedDb = path.resolve(db.name || process.env.DATABASE_PATH || '');
  const lower = resolvedDb.toLowerCase();
  const isProductionDb = lower.endsWith('server\\bfi_classroom.db') || lower.endsWith('server/bfi_classroom.db') || (lower.includes('bfi_classroom.db') && !lower.includes('test'));
  const isIsolatedTestDb = lower.includes('test_isolated_bfi.db');

  res.json({
    status: 'ok',
    port: Number(PORT),
    dbPath: path.basename(resolvedDb),
    isProductionDb,
    isIsolatedTestDb,
    isTestServer,
    nodeEnv: 'test'
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Socket.IO Connection (Chat/Community)
io.use((socket, next) => {
  const rawToken = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!rawToken) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(rawToken, getJwtSecret());
    if (!decoded || !decoded.id) {
      return next(new Error('Invalid token'));
    }

    // Token-purpose separation: Sockets strictly accept only completed-login access tokens
    if (decoded.type !== 'access') {
      return next(new Error('Access token required. Invalid token purpose.'));
    }

    const user = db.prepare('SELECT id, username, role, is_active, deleted_at, archived_at, password_reset_pending, token_version FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.is_active !== 1 || user.deleted_at !== null || user.archived_at !== null) {
      return next(new Error('Account inactive or revoked'));
    }

    if (user.password_reset_pending === 1) {
      return next(new Error('Account password reset pending'));
    }

    if (user.role === 'admin') {
      if (!decoded.sessionId || decoded.token_version === undefined) {
        return next(new Error('Session credentials required for administrator access'));
      }
      if (decoded.token_version !== (user.token_version || 1)) {
        return next(new Error('Session revoked or expired'));
      }
      const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ? AND datetime(expires_at) > datetime(\'now\')').get(decoded.sessionId, user.id);
      if (!session) {
        return next(new Error('Session revoked or expired'));
      }
    } else {
      if (decoded.token_version !== undefined && decoded.token_version !== (user.token_version || 1)) {
        return next(new Error('Session revoked or expired'));
      }
      if (decoded.sessionId) {
        const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ? AND datetime(expires_at) > datetime(\'now\')').get(decoded.sessionId, user.id);
        if (!session) {
          return next(new Error('Session revoked or expired'));
        }
      }
    }

    socket.user = decoded;
    socket.sessionId = decoded.sessionId || null;
    return next();
  } catch {
    return next(new Error('Invalid token'));
  }
});

// Real-time socket session invalidation and disconnection listeners
securityEvents.on('revoke_user', ({ userId }) => {
  if (io && io.of('/').sockets) {
    for (const [, s] of io.of('/').sockets) {
      if (s.user && Number(s.user.id) === Number(userId)) {
        s.emit('session_revoked', { reason: 'Account deactivated or revoked' });
        s.disconnect(true);
      }
    }
  }
});

securityEvents.on('revoke_session', ({ userId, sessionId }) => {
  if (io && io.of('/').sockets) {
    for (const [, s] of io.of('/').sockets) {
      if (s.user && Number(s.user.id) === Number(userId)) {
        if (!sessionId || Number(s.sessionId) === Number(sessionId)) {
          s.emit('session_revoked', { reason: 'Session revoked' });
          s.disconnect(true);
        }
      }
    }
  }
});

securityEvents.on('revoke_other_sessions', ({ userId, currentSessionId }) => {
  if (io && io.of('/').sockets) {
    for (const [, s] of io.of('/').sockets) {
      if (s.user && Number(s.user.id) === Number(userId)) {
        if (Number(s.sessionId) !== Number(currentSessionId)) {
          s.emit('session_revoked', { reason: 'Session revoked by user' });
          s.disconnect(true);
        }
      }
    }
  }
});

const userConnections = new Map(); // userId -> Set of socketIds

// Listen for trash updates and broadcast them
trashEvents.on('update', (payload) => {
  io.emit('trash_updated', payload);
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`User connected via Socket.io: socketId=${socket.id}, userId=${userId}`);

  socket.on('error', (err) => {
    console.error(`Socket error [socketId=${socket.id}, userId=${userId}]:`, err?.message || err);
  });

  socket.join(`user:${userId}`);

  // Track online status
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
    // Broadcast that user is online
    socket.broadcast.emit('user_online', userId);
  }
  userConnections.get(userId).add(socket.id);

  // Send the current list of online users to the newly connected user
  socket.emit('online_users_list', Array.from(userConnections.keys()));

  socket.on('new_post', (payload) => {
    socket.broadcast.emit('new_post', payload);
  });
  
  // WebRTC Signaling Events
  socket.on('call-request', (data) => {
    if (!data || !data.receiverId) return;
    const sanitized = { ...data, callerId: socket.user.id, callerData: { ...(data.callerData || {}), id: socket.user.id } };
    io.to(`user:${data.receiverId}`).emit('call-request', sanitized);
  });

  socket.on('call-answered', (data) => {
    if (!data || !data.callerId) return;
    const sanitized = { ...data, answererId: socket.user.id };
    io.to(`user:${data.callerId}`).emit('call-answered', sanitized);
  });

  socket.on('call-rejected', (data) => {
    if (!data || !data.callerId) return;
    const sanitized = { ...data, rejecterId: socket.user.id };
    io.to(`user:${data.callerId}`).emit('call-rejected', sanitized);
  });

  socket.on('webrtc-offer', (data) => {
    if (!data || !data.receiverId) return;
    const sanitized = { ...data, callerId: socket.user.id };
    io.to(`user:${data.receiverId}`).emit('webrtc-offer', sanitized);
  });

  socket.on('webrtc-answer', (data) => {
    if (!data || !data.callerId) return;
    const sanitized = { ...data, answererId: socket.user.id };
    io.to(`user:${data.callerId}`).emit('webrtc-answer', sanitized);
  });

  socket.on('ice-candidate', (data) => {
    if (!data || !data.targetId) return;
    const sanitized = { ...data, fromId: socket.user.id };
    io.to(`user:${data.targetId}`).emit('ice-candidate', sanitized);
  });

  socket.on('call-ended', (data) => {
    if (!data || !data.targetId) return;
    const sanitized = { ...data, fromId: socket.user.id };
    io.to(`user:${data.targetId}`).emit('call-ended', sanitized);
  });

  // ── Group Call Signaling ──────────────────────────────────────────
  // Invite a new person into an ongoing call
  socket.on('group-call-invite', (data) => {
    // data: { receiverId, callerData, existingParticipants: [{ id, data }], hasVideo }
    io.to(`user:${data.receiverId}`).emit('group-call-invite', data);
  });

  // New person accepted the group call invite
  socket.on('group-call-accepted', (data) => {
    // data: { participantIds: [...], joinerData: { id, name, avatar, hasVideo } }
    // Notify every existing participant so they each create a PC for the joiner
    if (data.participantIds && Array.isArray(data.participantIds)) {
      data.participantIds.forEach(pid => {
        io.to(`user:${pid}`).emit('group-call-accepted', data);
      });
    }
  });

  // Someone left the group call
  socket.on('group-call-left', (data) => {
    // data: { participantIds: [...], userId }
    if (data.participantIds && Array.isArray(data.participantIds)) {
      data.participantIds.forEach(pid => {
        io.to(`user:${pid}`).emit('group-call-left', data);
      });
    }
  });

  // Group-specific WebRTC signaling (uses fromId to disambiguate peer connections)
  socket.on('group-webrtc-offer', (data) => {
    // data: { receiverId, fromId, offer }
    io.to(`user:${data.receiverId}`).emit('group-webrtc-offer', data);
  });

  socket.on('group-webrtc-answer', (data) => {
    // data: { receiverId, fromId, answer }
    io.to(`user:${data.receiverId}`).emit('group-webrtc-answer', data);
  });

  socket.on('group-ice-candidate', (data) => {
    // data: { targetId, fromId, candidate }
    io.to(`user:${data.targetId}`).emit('group-ice-candidate', data);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: socketId=${socket.id}, userId=${userId}`);
    if (userConnections.has(userId)) {
      const sockets = userConnections.get(userId);
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userConnections.delete(userId);
        socket.broadcast.emit('user_offline', userId);
      }
    }
  });
});

// Serve frontend in production (Single Deployment)
const clientBuildPath = path.join(__dirname, '..', 'dist');
const clientAssetsPath = path.join(clientBuildPath, 'assets');

// Detect social link preview scrapers (WhatsApp, Facebook, Twitter, Telegram, Discord, LinkedIn, etc.)
const SOCIAL_BOT_REGEX = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|Discordbot|LinkedInBot|Pinterest|Slackbot|vkShare|W3C_Validator/i;

app.get('/', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  if (SOCIAL_BOT_REGEX.test(userAgent)) {
    return res.sendFile(path.join(clientBuildPath, 'index.html'));
  }
  res.redirect('/bfi-classroom');
});

app.use('/bfi-classroom/assets', express.static(clientAssetsPath));
app.use('/bfi-classroom', express.static(clientBuildPath, { redirect: false }));
app.use(express.static(clientBuildPath));

app.get('/bfi-classroom', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

app.get('/bfi-classroom/', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

app.get(/^\/bfi-classroom(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

app.get(/^\/.*$/, (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, _next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

startCommunityScheduler(io);
startAnnouncementScheduler(io);
const listenArgs = [PORT];
if (process.env.HOST) {
  listenArgs.push(process.env.HOST);
}
httpServer.listen(...listenArgs, () => {
  console.log(`🚀 BFI Classroom API Gateway running on port ${PORT}${process.env.HOST ? ` (bound to ${process.env.HOST})` : ''}`);

  // ── Batch Status Automation Scheduler ─────────────────────────────────────
  // Run once on startup (catches any missed transitions while server was down)
  setTimeout(() => {
    console.log('[BatchAutomation] Running initial check on server start...');
    try {
      const result = runBatchStatusAutomation(db);
      console.log(
        `[BatchAutomation] Initial check complete. ` +
        `Checked: ${result.batches_checked}, Transitions: ${result.transitions.length}`
      );
    } catch (err) {
      console.error('[BatchAutomation] Initial check failed:', err.message);
    }
  }, 5000); // 5-second delay to let all init complete

  // Then run every 24 hours
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    console.log('[BatchAutomation] Running scheduled 24-hour check...');
    try {
      const result = runBatchStatusAutomation(db);
      console.log(
        `[BatchAutomation] Scheduled check complete. ` +
        `Checked: ${result.batches_checked}, Transitions: ${result.transitions.length}`
      );
      if (result.errors.length > 0) {
        console.error('[BatchAutomation] Errors during scheduled run:', result.errors);
      }
    } catch (err) {
      console.error('[BatchAutomation] Scheduled check failed:', err.message);
    }
  }, TWENTY_FOUR_HOURS);
  // ── End Batch Automation Scheduler ────────────────────────────────────────

  // Broadcast scheduler — runs every 5 minutes
  setInterval(() => {
    checkScheduledBroadcasts(io).catch(err =>
      console.error('[BroadcastScheduler] Error:', err)
    );
  }, 5 * 60 * 1000);
});

