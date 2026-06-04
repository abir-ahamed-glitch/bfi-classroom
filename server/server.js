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
import jwt from 'jsonwebtoken';

// Setup env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Routes
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import studentRoutes from './routes/student.js';
import portfolioRoutes from './routes/portfolio.js';
import communityRoutes, { startCommunityScheduler } from './routes/community.js';
import courseRoutes from './routes/course.js';
import inboxRoutes from './routes/inbox.js';
import bfiaaRoutes from './routes/bfiaa.js';
import certificationRoutes from './routes/certification.js';
import experienceRoutes from './routes/experience.js';
import registryRoutes from './routes/registry.js';
import notificationsRoutes from './routes/notifications.js';
import { getJwtRefreshSecret, getJwtSecret } from './config/security.js';

const app = express();
const httpServer = createServer(app);
app.set('trust proxy', 1);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  }
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
      scriptSrc: ["'self'"], // Removed unsafe-inline and unsafe-eval
      styleSrc: ["'self'", "https://fonts.googleapis.com"], // Removed unsafe-inline
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://img.youtube.com", "https://i.ytimg.com", "https://*.ytimg.com", "https://*.youtube.com", "https://*.vimeocdn.com", "https://graph.facebook.com", "https://*.dailymotion.com", "https://s1.dmcdn.net", "https://*.fbcdn.net", "https://*.cdninstagram.com"],
      connectSrc: ["'self'", "wss:", "https://*.trycloudflare.com", "https://www.youtube.com", "https://*.youtube.com", "https://*.googlevideo.com", "https://vimeo.com", "https://api.vimeo.com"],
      mediaSrc: ["'self'", "data:", "blob:", "https://*.youtube.com", "https://*.vimeo.com", "https://*.googlevideo.com"],
      frameSrc: ["'self'", "https://*.youtube.com", "https://*.vimeo.com", "https://*.facebook.com"],
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

app.get(['/api/proxy-image', '/bfi-classroom/api/proxy-image'], async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ error: 'URL is required' });
  
  try {
    const parsedUrl = new URL(imageUrl);

    // Enforce HTTPS
    if (parsedUrl.protocol !== 'https:') {
      return res.status(403).json({ error: 'Only HTTPS URLs are allowed' });
    }

    // Allow proxying of any public HTTPS images to make pasted links editable,
    // but block local or private addresses to prevent Server-Side Request Forgery (SSRF)
    const privateIpPattern = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i;
    if (privateIpPattern.test(parsedUrl.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BFIClassroomBot/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image/')) {
      return res.status(403).json({ error: 'Content must be an image' });
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Proxy image error:', error.message);
    res.status(500).json({ error: 'Error proxying image' });
  }
});

// Link Preview endpoint — fetches OpenGraph metadata for a given URL
const linkPreviewCache = new Map();
app.get(['/api/link-preview', '/bfi-classroom/api/link-preview'], async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL is required' });

  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BFIClassroomBot/1.0; +https://bfi.gov.bd)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return res.json({ url: targetUrl, title: parsedUrl.hostname });
    }

    // Only read first 100KB to extract meta tags without loading huge pages
    const reader = response.body.getReader();
    let html = '';
    let bytesRead = 0;
    const MAX_BYTES = 100 * 1024; // 100KB

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytesRead += value.length;
      if (bytesRead >= MAX_BYTES || html.includes('</head>')) {
        reader.cancel();
        break;
      }
    }

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
    if (error.name === 'AbortError') {
      res.status(408).json({ error: 'Request timed out' });
    } else {
      console.error('Link preview error:', error.message);
      res.status(500).json({ error: 'Could not fetch preview' });
    }
  }
});

// Rate limiting for DDoS and Brute Force prevention
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
    if (authHeader) {
      return `auth:${authHeader.slice(-32)}`;
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

// Inbox attachments are private. Use /api/inbox/attachments/:filename so the
// API can verify the requesting user belongs to that conversation.
app.use(['/media/inbox-attachments', '/bfi-classroom/media/inbox-attachments'], (_req, res) => {
  res.status(401).json({ error: 'Authentication required' });
});

// Static files for media uploads mapping
app.use('/bfi-classroom/media', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/media', express.static(path.join(__dirname, '..', 'uploads'))); // Keep root for backwards compatibility

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
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
    socket.user = decoded;
    return next();
  } catch {
    return next(new Error('Invalid token'));
  }
});

const userConnections = new Map(); // userId -> Set of socketIds

io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`User connected via Socket.io: socketId=${socket.id}, userId=${userId}`);
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
    io.to(`user:${data.receiverId}`).emit('call-request', data);
  });

  socket.on('call-answered', (data) => {
    io.to(`user:${data.callerId}`).emit('call-answered', data);
  });

  socket.on('call-rejected', (data) => {
    io.to(`user:${data.callerId}`).emit('call-rejected', data);
  });

  socket.on('webrtc-offer', (data) => {
    io.to(`user:${data.receiverId}`).emit('webrtc-offer', data);
  });

  socket.on('webrtc-answer', (data) => {
    io.to(`user:${data.callerId}`).emit('webrtc-answer', data);
  });

  socket.on('ice-candidate', (data) => {
    io.to(`user:${data.targetId}`).emit('ice-candidate', data);
  });

  socket.on('call-ended', (data) => {
    io.to(`user:${data.targetId}`).emit('call-ended', data);
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
app.get('/', (req, res) => {
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

// Start Server
startCommunityScheduler(io);
httpServer.listen(PORT, () => {
  console.log(`🚀 BFI Classroom API Gateway running on port ${PORT}`);
});