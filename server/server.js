import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import { initializeDatabase } from './db/database.js';

// Setup env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Routes
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import studentRoutes from './routes/student.js';
import portfolioRoutes from './routes/portfolio.js';
import communityRoutes from './routes/community.js';
import courseRoutes from './routes/course.js';
import inboxRoutes from './routes/inbox.js';
import bfiaaRoutes from './routes/bfiaa.js';
import certificationRoutes from './routes/certification.js';
import experienceRoutes from './routes/experience.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

const PORT = process.env.PORT || 3001;

// Initialize Database
try {
  initializeDatabase();
} catch (error) {
  console.error('Failed to initialize database:', error);
}

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting for DDoS and Brute Force prevention
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many requests, please try again later.' }
});

// Apply rate limiter specifically to /api routes
app.use('/api', apiLimiter);

app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Static files for media uploads mapping
app.use('/media', express.static(path.join(__dirname, '..', 'uploads')));

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

// Socket.IO Connection (Chat/Community)
io.on('connection', (socket) => {
  console.log('User connected via Socket.io:', socket.id);
  
  // Note: Add JWT auth for socket later

  socket.on('new_post', (payload) => {
    socket.broadcast.emit('new_post', payload);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Serve frontend in production (Single Deployment)
const clientBuildPath = path.join(__dirname, '..', 'dist');
app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Start Server
httpServer.listen(PORT, () => {
  console.log(`🚀 BFI Classroom API Gateway running on port ${PORT}`);
});
