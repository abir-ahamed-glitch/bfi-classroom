import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enforce isolated disposable test database and test server port
process.env.DATABASE_PATH = path.resolve(__dirname, 'test_isolated_bfi.db');
process.env.PORT = process.env.PORT || '3099';
process.env.IS_TEST_SERVER = 'true';
process.env.NODE_ENV = 'test';

console.log(`[TestServer] Starting isolated test backend: db=${process.env.DATABASE_PATH} port=${process.env.PORT}`);

import('./server.js');
