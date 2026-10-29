import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * server/bootstrap.js
 *
 * Explicit Configuration Precedence Matrix:
 *
 * 1. Guarded Staging (process.env.IS_STAGING_SERVER === 'true'):
 *    scripts/staging_guard.cjs has already loaded, validated, and frozen the authoritative
 *    staging configuration (.env.staging). Bootstrap is a strict no-op.
 *
 * 2. Isolated Test Mode (process.env.IS_TEST_SERVER === 'true' || process.env.NODE_ENV === 'test'):
 *    Enforced by server/test-server.js, Playwright, or isolated test harnesses.
 *    - All test-server enforced flags and sentinels (PORT, DATABASE_PATH, NODE_ENV,
 *      IS_TEST_SERVER, APP_URL, CLIENT_URL, DISABLE_OUTBOUND_NOTIFICATIONS,
 *      ALLOW_WINDOWS_DEV_PREFLIGHT) are strictly preserved.
 *    - Default production/development configuration files (.env) must NEVER overwrite
 *      these isolated test settings (override: false).
 *    - Missing required secrets (e.g., JWT_SECRET, encryption keys) are safely
 *      populated from the configuration file without clobbering existing test sentinels.
 *
 * 3. Production / Standard Server (IS_STAGING_SERVER !== 'true' && IS_TEST_SERVER !== 'true' && NODE_ENV !== 'test'):
 *    On production startup or restart (e.g. via PM2, systemd, or direct node):
 *    - Authoritative configuration in .env (or explicit DOTENV_CONFIG_PATH) takes
 *      precedence over stale or inherited process-manager environment variables (override: true).
 *    - This guarantees that intentionally rotated secrets and database paths take
 *      effect immediately upon process restart.
 */

if (process.env.IS_STAGING_SERVER === 'true') {
  // Mode 1: Guarded Staging — validated staging configuration is authoritative
} else if (process.env.IS_TEST_SERVER === 'true' || process.env.NODE_ENV === 'test') {
  // Mode 2: Isolated Test Mode — preserve test sentinels & flags against default dev/prod config
  const testSentinels = {
    PORT: process.env.PORT,
    DATABASE_PATH: process.env.DATABASE_PATH,
    NODE_ENV: process.env.NODE_ENV,
    IS_TEST_SERVER: process.env.IS_TEST_SERVER,
    APP_URL: process.env.APP_URL,
    CLIENT_URL: process.env.CLIENT_URL,
    DISABLE_OUTBOUND_NOTIFICATIONS: process.env.DISABLE_OUTBOUND_NOTIFICATIONS,
    ALLOW_WINDOWS_DEV_PREFLIGHT: process.env.ALLOW_WINDOWS_DEV_PREFLIGHT
  };

  let envPath = process.env.DOTENV_CONFIG_PATH;
  if (!envPath) {
    const cwdEnv = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(cwdEnv)) {
      envPath = cwdEnv;
    } else {
      envPath = path.resolve(__dirname, '..', '.env');
    }
  }

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }

  // Restore test sentinels to guarantee default dev/prod settings never clobber test settings
  for (const [key, val] of Object.entries(testSentinels)) {
    if (val !== undefined) {
      process.env[key] = val;
    }
  }
} else {
  // Mode 3: Production / Standard Server — freshly rotated .env beats stale daemon environment
  let envPath = process.env.DOTENV_CONFIG_PATH;
  if (!envPath) {
    const cwdEnv = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(cwdEnv)) {
      envPath = cwdEnv;
    } else {
      envPath = path.resolve(__dirname, '..', '.env');
    }
  }

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  } else {
    dotenv.config({ override: true });
  }
}
