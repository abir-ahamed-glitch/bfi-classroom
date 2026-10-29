/**
 * Staging Environment Isolation Guard
 * Positively confines staging databases, enforces network & credential isolation,
 * and canonicalizes paths to prevent escapes, symlink/junction tricks, and inherited secret leaks.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Strict path containment check: returns true if childPath is strictly inside parentDir.
 * Handles directory boundaries properly, defeating sibling-prefix tricks.
 * E.g., '/var/www/staging' vs '/var/www/staging-evil' -> returns false.
 */
function isStrictlyInside(childPath, parentDir) {
  const normChild = path.normalize(path.resolve(childPath));
  const normParent = path.normalize(path.resolve(parentDir));

  // On Windows, drive letter comparisons should be case-insensitive
  const isWin = process.platform === 'win32';
  const cTarget = isWin ? normChild.toLowerCase() : normChild;
  const pTarget = isWin ? normParent.toLowerCase() : normParent;

  const rel = path.relative(pTarget, cTarget);

  // If child === parent, rel is '' (not strictly inside)
  // If child is outside parent, rel starts with '..'
  // If child is on a different root/drive, rel is absolute
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * Directory-boundary-aware check: returns true if childPath is identical to
 * or strictly inside parentDir.
 * Defeats substring collisions like '/var/www/bfi-classroom' matching '/var/www/bfi-classroom-staging'.
 */
function isPathWithin(childPath, parentDir) {
  const normChild = path.normalize(path.resolve(childPath));
  const normParent = path.normalize(path.resolve(parentDir));

  const isWin = process.platform === 'win32';
  const cTarget = isWin ? normChild.toLowerCase() : normChild;
  const pTarget = isWin ? normParent.toLowerCase() : normParent;

  if (cTarget === pTarget) {
    return true;
  }

  const rel = path.relative(pTarget, cTarget);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Canonicalizes a path even if the final file or some leaf directories do not yet exist.
 * Walks up to the deepest existing ancestor, canonicalizes it with fs.realpathSync,
 * and reconstructs the canonical path.
 *
 * Fails closed on ambiguous or filesystem resolution errors (e.g. ELOOP, EACCES).
 */
function canonicalizePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('[StagingGuard] Target path must be a non-empty string.');
  }

  if (!path.isAbsolute(targetPath)) {
    throw new Error(`[StagingGuard] Path must be absolute (received: '${targetPath}').`);
  }

  const normalized = path.normalize(targetPath);
  let current = normalized;
  const missingSegments = [];

  // Walk up until an existing filesystem ancestor is found
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding any existing ancestor (invalid / ambiguous fs state)
      throw new Error(`[StagingGuard] Canonical path resolution failed: no existing ancestor found for '${targetPath}'.`);
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  // Current existing ancestor found; resolve its canonical realpath
  let realAncestor;
  try {
    realAncestor = fs.realpathSync(current);
  } catch (fsErr) {
    // Fail closed on filesystem errors (e.g. symlink loop, permission denied)
    throw new Error(`[StagingGuard] Filesystem error resolving canonical realpath for '${current}': ${fsErr.message}`);
  }

  const canonicalPath = missingSegments.length > 0
    ? path.resolve(realAncestor, ...missingSegments)
    : realAncestor;

  return {
    canonicalPath,
    realAncestor,
    exists: missingSegments.length === 0
  };
}

/**
 * Known protected production paths and roots that must NEVER be accessed by staging.
 */
const PROTECTED_PRODUCTION_ROOTS = [
  path.normalize('/var/www/bfi-classroom'),
  path.normalize('/home/ubuntu/bfi-classroom'),
  path.resolve(__dirname, '../server/bfi_classroom.db'),
  path.resolve(__dirname, '../../../server/bfi_classroom.db')
];

/**
 * Required staging keys that must be explicitly present, non-empty, and valid in staging config.
 */
const REQUIRED_STAGING_KEYS = [
  'DATABASE_PATH',
  'STAGING_DATA_DIR',
  'PORT',
  'HOST',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'MFA_ENCRYPTION_KEY'
];

/**
 * Validates staging configuration against positive confinement and isolation policies.
 */
function validateStagingConfig(options = {}) {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath || dbPath.trim() === '') {
    throw new Error('[StagingGuard] CRITICAL: DATABASE_PATH must be explicitly defined for staging.');
  }

  if (!path.isAbsolute(dbPath)) {
    throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH must be an absolute path (received: '${dbPath}').`);
  }

  // 1. Resolve approved staging data directories (positive confinement)
  let approvedDirs = [];
  if (Array.isArray(options.approvedStagingDirs) && options.approvedStagingDirs.length > 0) {
    approvedDirs = options.approvedStagingDirs;
  } else if (process.env.STAGING_DATA_DIR && process.env.STAGING_DATA_DIR.trim() !== '') {
    approvedDirs = [process.env.STAGING_DATA_DIR.trim()];
  } else if (process.env.STAGING_ROOT_DIR && process.env.STAGING_ROOT_DIR.trim() !== '') {
    approvedDirs = [process.env.STAGING_ROOT_DIR.trim()];
  }

  if (approvedDirs.length === 0) {
    throw new Error('[StagingGuard] SAFETY REJECTION: No approved staging data directory configured. Set STAGING_DATA_DIR or options.approvedStagingDirs.');
  }

  // Canonicalize all approved staging directories and ensure none point to production (directory-boundary-aware)
  const canonicalApprovedDirs = approvedDirs.map(dir => {
    if (!path.isAbsolute(dir)) {
      throw new Error(`[StagingGuard] SAFETY REJECTION: Approved staging directory must be an absolute path: '${dir}'.`);
    }
    const { canonicalPath: canonDir } = canonicalizePath(dir);

    // Ensure approved dir is not itself within a protected production directory
    for (const prodRoot of PROTECTED_PRODUCTION_ROOTS) {
      if (isPathWithin(canonDir, prodRoot)) {
        throw new Error(`[StagingGuard] SAFETY REJECTION: Approved staging directory resolves into protected production path: ${canonDir}`);
      }
    }
    return canonDir;
  });

  // 2. Canonicalize the target database path (resolving ancestors if DB does not yet exist)
  const { canonicalPath: canonicalDb, exists: dbExists } = canonicalizePath(dbPath);

  // 3. Positive Confinement Enforcement: DB must reside strictly inside an approved staging directory
  const isConfined = canonicalApprovedDirs.some(approvedDir => isStrictlyInside(canonicalDb, approvedDir));
  if (!isConfined) {
    throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH (${dbPath} -> ${canonicalDb}) is outside approved staging directories (${canonicalApprovedDirs.join(', ')}).`);
  }

  // 4. Explicit check against protected production roots (directory-boundary-aware)
  for (const prodRoot of PROTECTED_PRODUCTION_ROOTS) {
    if (isPathWithin(canonicalDb, prodRoot)) {
      throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH canonicalizes into protected production root: ${canonicalDb}`);
    }
  }

  // 5. Hard-link & Inode Alias Detection (if the database file already exists)
  if (dbExists) {
    const stat = fs.statSync(canonicalDb);

    // Hard-link aliases: A staging database file must not have multiple directory entries
    if (stat.nlink > 1 && !options.allowHardLinks) {
      throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH has multiple hard links (nlink=${stat.nlink}). Hard-link aliases are prohibited.`);
    }

    // Inode check against existing protected production databases
    const knownProdDbPaths = [
      path.resolve(__dirname, '../server/bfi_classroom.db'),
      path.resolve(__dirname, '../../../server/bfi_classroom.db'),
      '/var/www/bfi-classroom/server/bfi_classroom.db',
      '/home/ubuntu/bfi-classroom/server/bfi_classroom.db'
    ];
    for (const prodDb of knownProdDbPaths) {
      if (fs.existsSync(prodDb)) {
        try {
          const prodStat = fs.statSync(prodDb);
          if (stat.dev === prodStat.dev && stat.ino === prodStat.ino) {
            throw new Error(`[StagingGuard] SAFETY REJECTION: DATABASE_PATH shares filesystem inode with production database: ${canonicalDb}`);
          }
        } catch {
          // ignore stat errors on non-accessible prod paths
        }
      }
    }
  }

  // 6. Network isolation: Port must not be production port (3001)
  const port = parseInt(process.env.PORT, 10);
  if (!port || port === 3001) {
    throw new Error(`[StagingGuard] Port must be set to an isolated non-production port (received: ${port || 'undefined'}).`);
  }

  // 7. Network isolation: HOST must be loopback only
  const host = process.env.HOST;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`[StagingGuard] HOST must be strictly set to '127.0.0.1' for loopback isolation (received: '${host || 'undefined'}').`);
  }

  // 8. Secret length & format validation
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('[StagingGuard] SAFETY REJECTION: JWT_SECRET must be at least 32 characters in staging.');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('[StagingGuard] SAFETY REJECTION: JWT_REFRESH_SECRET must be at least 32 characters in staging.');
  }
  if (!process.env.MFA_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.MFA_ENCRYPTION_KEY)) {
    throw new Error('[StagingGuard] SAFETY REJECTION: MFA_ENCRYPTION_KEY must be a 64-character hex string in staging.');
  }

  return {
    databasePath: canonicalDb,
    originalDatabasePath: dbPath,
    approvedStagingDirs: canonicalApprovedDirs,
    port,
    host,
    clientUrl: process.env.CLIENT_URL || `http://${host}:${port}/bfi-classroom`,
    appUrl: process.env.APP_URL || `http://${host}:${port}/bfi-classroom`
  };
}

/**
 * Loads staging environment variables authoritatively and validates them.
 * Rejects missing required settings and conflicting inherited secrets without credential disclosure.
 */
function loadAndValidateStagingEnv(envFilePath, options = {}) {
  const resolvedEnvPath = path.resolve(envFilePath || process.env.STAGING_ENV_FILE || '.env.staging');

  if (!fs.existsSync(resolvedEnvPath)) {
    throw new Error(`[StagingGuard] Staging env file not found at: ${resolvedEnvPath}`);
  }

  const envConfig = dotenv.parse(fs.readFileSync(resolvedEnvPath));

  // 1. Explicitly require necessary staging secrets and isolation settings in the staging configuration
  for (const reqKey of REQUIRED_STAGING_KEYS) {
    const val = envConfig[reqKey];
    if (val === undefined || typeof val !== 'string' || val.trim() === '') {
      throw new Error(`[StagingGuard] SAFETY REJECTION: Required staging setting '${reqKey}' is missing or empty in staging configuration.`);
    }
  }

  // 2. Reject inherited conflicting environment variables without leaking credentials or prefixes
  const criticalKeys = [
    'DATABASE_PATH',
    'STAGING_DATA_DIR',
    'STAGING_ROOT_DIR',
    'PORT',
    'HOST',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'MFA_ENCRYPTION_KEY',
    'PREVIOUS_MFA_ENCRYPTION_KEY',
    'EMAIL_PASS',
    'SMS_API_KEY'
  ];

  if (options.rejectConflicts !== false) {
    for (const key of criticalKeys) {
      if (process.env[key] !== undefined &&
          process.env[key] !== '' &&
          process.env[key] !== envConfig[key]) {
        throw new Error(
          `[StagingGuard] SAFETY REJECTION: Inherited environment variable '${key}' conflicts with staging configuration. ` +
          `Clear the inherited variable or harmonize before running staging.`
        );
      }
    }
  }

  // 3. Apply staging environment authoritatively into process.env
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }

  // 4. Enforce staging suppression flags & nullify outbound credentials
  process.env.IS_STAGING_SERVER = 'true';
  process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
  process.env.EMAIL_USER = '';
  process.env.EMAIL_PASS = '';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  process.env.SMS_API_KEY = '';
  process.env.TWILIO_AUTH_TOKEN = '';
  process.env.SLACK_WEBHOOK_URL = '';
  process.env.DISCORD_WEBHOOK_URL = '';

  // 5. Monkey-patch dotenv.config to prevent any subsequent module from loading .env
  dotenv.config = function stagingDotenvConfig() {
    return { parsed: {} };
  };

  return validateStagingConfig(options);
}

module.exports = {
  loadAndValidateStagingEnv,
  validateStagingConfig,
  canonicalizePath,
  isStrictlyInside,
  isPathWithin,
  PROTECTED_PRODUCTION_ROOTS,
  REQUIRED_STAGING_KEYS
};
