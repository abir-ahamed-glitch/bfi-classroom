import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enforce isolated disposable staging database and staging server port
process.env.DATABASE_PATH = process.env.DATABASE_PATH || path.resolve(__dirname, 'test_isolated_bfi.db');
process.env.PORT = process.env.PORT || '3098';
process.env.IS_STAGING_SERVER = 'true';
process.env.NODE_ENV = 'production';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
process.env.APP_URL = process.env.APP_URL || 'http://127.0.0.1:3098/bfi-classroom';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://127.0.0.1:3098/bfi-classroom';

console.log(`[StagingServer] Starting isolated production-built backend: db=${process.env.DATABASE_PATH} port=${process.env.PORT} nodeEnv=${process.env.NODE_ENV}`);

import('./server.js');
