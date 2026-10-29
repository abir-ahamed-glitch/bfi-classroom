/**
 * Staging Environment Isolation Guard
 * Validates staging configuration before application modules or database drivers execute.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadAndValidateStagingEnv(envFilePath) {
  const resolvedEnvPath = path.resolve(envFilePath || process.env.STAGING_ENV_FILE || '.env.staging');

  if (!fs.existsSync(resolvedEnvPath)) {
    throw new Error(`[StagingGuard] Staging env file not found at: ${resolvedEnvPath}`);
  }

  // Load the staging environment file into process.env before any imports
  const envConfig = dotenv.parse(fs.readFileSync(resolvedEnvPath));
  for (const k in envConfig) {
    if (!process.env[k] || process.env.OVERRIDE_STAGING_ENV === 'true') {
      process.env[k] = envConfig[k];
    }
  }

  return validateStagingConfig();
}

function validateStagingConfig() {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath) {
    throw new Error('[StagingGuard] CRITICAL: DATABASE_PATH must be explicitly defined for staging.');
  }

  const resolvedDb = path.resolve(dbPath);

  // Check against production database paths and signatures
  const dangerousPatterns = [
    '/var/www/bfi-classroom/server/bfi_classroom.db',
    '\\var\\www\\bfi-classroom\\server\\bfi_classroom.db',
    path.resolve(__dirname, '../server/bfi_classroom.db'),
  ];

  for (const dangerous of dangerousPatterns) {
    if (resolvedDb.toLowerCase() === dangerous.toLowerCase()) {
      throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH resolves to production database: ${resolvedDb}`);
    }
  }

  // Check for symlinks pointing to production
  if (fs.existsSync(resolvedDb)) {
    try {
      const realPath = fs.realpathSync(resolvedDb);
      for (const dangerous of dangerousPatterns) {
        if (realPath.toLowerCase() === dangerous.toLowerCase()) {
          throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH symlink targets production database: ${realPath}`);
        }
      }
    } catch {
      // file might not exist yet before init
    }
  }

  // Network isolation: Port must not be production port (3001)
  const port = parseInt(process.env.PORT, 10);
  if (!port || port === 3001) {
    throw new Error(`[StagingGuard] Port must be set to an isolated non-production port (received: ${port || 'undefined'}).`);
  }

  // Network isolation: HOST must be loopback only
  const host = process.env.HOST;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`[StagingGuard] HOST must be strictly set to '127.0.0.1' for loopback isolation (received: '${host || 'undefined'}').`);
  }

  // Outbound notification safety: Staging must NOT have active live email credentials
  if (process.env.EMAIL_PASS && process.env.EMAIL_PASS.trim() !== '' && process.env.EMAIL_PASS !== 'mock_staging_password') {
    console.warn('[StagingGuard] WARNING: Live EMAIL_PASS detected. Nullifying to prevent real outbound email.');
    process.env.EMAIL_PASS = '';
  }

  return {
    databasePath: resolvedDb,
    port,
    host,
    clientUrl: process.env.CLIENT_URL || `http://${host}:${port}/bfi-classroom`,
    appUrl: process.env.APP_URL || `http://${host}:${port}/bfi-classroom`
  };
}

module.exports = {
  loadAndValidateStagingEnv,
  validateStagingConfig
};
