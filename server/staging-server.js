import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadAndValidateStagingEnv } = require('../scripts/staging_guard.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and validate staging environment before any application imports
const stagingEnvPath = process.env.STAGING_ENV_FILE || path.resolve(__dirname, '../.env.staging');
const validatedConfig = loadAndValidateStagingEnv(stagingEnvPath);

console.log(`[StagingServer] Bootstrapping isolated staging server:`);
console.log(`  Database: ${validatedConfig.databasePath}`);
console.log(`  Loopback Bind: ${validatedConfig.host}:${validatedConfig.port}`);
console.log(`  Base URL: ${validatedConfig.appUrl}`);

// Enforce staging flags
process.env.IS_STAGING_SERVER = 'true';
process.env.NODE_ENV = 'production'; // Exercise production code paths with staging config
process.env.HOST = validatedConfig.host;
process.env.PORT = String(validatedConfig.port);
process.env.DATABASE_PATH = validatedConfig.databasePath;
process.env.APP_URL = validatedConfig.appUrl;
process.env.CLIENT_URL = validatedConfig.clientUrl;

// Import server now that process.env is securely primed
import('./server.js');
