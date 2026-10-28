import path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from 'fs';

export const TEST_DB_PATH = path.resolve(__dirname, '../server/test_isolated_bfi.db');

// Resolve authoritative production database path (checking if executed inside git worktree)
const worktreeParentProd = path.resolve(__dirname, '../../../server/bfi_classroom.db');
export const PROD_DB_PATH = (fs.existsSync(worktreeParentProd) && fs.statSync(worktreeParentProd).size > 1000000)
  ? worktreeParentProd
  : path.resolve(__dirname, '../server/bfi_classroom.db');
export const TEST_SERVER_PORT = process.env.TEST_PORT || '3099';

let testServerProcess = null;

/**
 * Hard safety check that strictly refuses to run destructive fixtures against the production database.
 * Throws a fatal exception if the provided dbPath resolves to server/bfi_classroom.db.
 */
export function assertIsolatedTestDatabase(dbPath) {
  if (!dbPath) {
    throw new Error('FATAL TEST SAFETY VIOLATION: Database path is undefined or empty.');
  }
  const resolved = path.resolve(dbPath).toLowerCase();
  const prodResolved = PROD_DB_PATH.toLowerCase();

  if (
    resolved === prodResolved ||
    resolved.endsWith('server\\bfi_classroom.db') ||
    resolved.endsWith('server/bfi_classroom.db') ||
    (resolved.includes('bfi_classroom.db') && !resolved.includes('test'))
  ) {
    throw new Error(
      `FATAL TEST SAFETY VIOLATION: Refusing to run destructive test setup or fixtures against production database "${dbPath}". ` +
      `Automated tests must use an isolated disposable database (e.g. server/test_isolated_bfi.db).`
    );
  }
}

export function getTestDbPath() {
  return TEST_DB_PATH;
}

export function getTestApiUrl() {
  return `http://127.0.0.1:${TEST_SERVER_PORT}`;
}

/**
 * Confirm the responding server's environment and database identity.
 * Strictly aborts if the server is the normal production backend or connected to bfi_classroom.db.
 */
export async function verifyServerIsolation(baseUrl = getTestApiUrl()) {
  const identityUrl = `${baseUrl.replace(/\/$/, '')}/api/test/db-identity`;
  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    res = await fetch(identityUrl, { signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    throw new Error(
      `FATAL TEST PRE-FLIGHT CHECK FAILED: Unable to reach database identity endpoint at "${identityUrl}". Error: ${err.message}. ` +
      `Ensure the isolated test server is running on port ${TEST_SERVER_PORT}.`
    );
  }

  if (!res.ok) {
    throw new Error(
      `FATAL TEST PRE-FLIGHT CHECK FAILED: Identity endpoint "${identityUrl}" returned HTTP ${res.status}.`
    );
  }

  const data = await res.json();
  if (data.isProductionDb === true) {
    throw new Error(
      `FATAL TEST SAFETY VIOLATION: Target server at ${baseUrl} is connected to the PRODUCTION database ("${data.dbPath}"). ` +
      `Refusing to perform any mutating API test or fixture setup against production.`
    );
  }

  if (data.isIsolatedTestDb !== true) {
    throw new Error(
      `FATAL TEST SAFETY VIOLATION: Target server at ${baseUrl} is NOT using the designated isolated test database ("${data.dbPath}").`
    );
  }

  return data;
}

/**
 * Start dedicated background test backend process on TEST_SERVER_PORT if not already running.
 */
export async function startTestServer() {
  // Check if test server is already active and isolated
  try {
    const existing = await verifyServerIsolation(getTestApiUrl());
    if (existing?.isIsolatedTestDb) {
      console.log(`[TestIsolation] Reusing active isolated test server on port ${TEST_SERVER_PORT}`);
      return null;
    }
  } catch {
    // Server not yet running, will spawn
  }

  console.log(`[TestIsolation] Spawning dedicated test backend on port ${TEST_SERVER_PORT} with ${TEST_DB_PATH}...`);
  const serverPath = path.resolve(__dirname, '../server/test-server.js');

  testServerProcess = spawn(process.execPath, [serverPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_SERVER_PORT),
      IS_TEST_SERVER: 'true',
      NODE_ENV: 'test',
      DATABASE_PATH: TEST_DB_PATH,
    },
    stdio: 'pipe',
  });

  testServerProcess.stdout.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg.includes('Error') || msg.includes('listen')) {
      console.log(`[TestServer:stdout] ${msg}`);
    }
  });

  testServerProcess.stderr.on('data', (d) => {
    console.error(`[TestServer:stderr] ${d.toString().trim()}`);
  });

  // Poll until ready
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 25000) {
    try {
      const data = await verifyServerIsolation(getTestApiUrl());
      if (data?.isIsolatedTestDb) {
        ready = true;
        console.log(`[TestIsolation] Isolated test server ready on port ${TEST_SERVER_PORT}`);
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (!ready) {
    if (testServerProcess) testServerProcess.kill();
    throw new Error(`[TestIsolation] Test backend failed to start and verify within 25 seconds on port ${TEST_SERVER_PORT}`);
  }

  return testServerProcess;
}

/**
 * Stop test server child process if spawned by this runner
 */
export async function stopTestServer() {
  if (testServerProcess) {
    console.log(`[TestIsolation] Stopping isolated test backend (PID ${testServerProcess.pid})...`);
    try {
      testServerProcess.kill();
    } catch { /* empty */ }
    testServerProcess = null;
  }
}

/**
 * Automatically intercepts browser /api/ requests in Playwright pages and routes them to test backend
 */
export async function setupTestRouteProxy(page, testBaseUrl = getTestApiUrl()) {
  await page.route(url => url.pathname.includes('/api/'), async (route) => {
    const originalUrl = new URL(route.request().url());
    let targetPath = originalUrl.pathname;
    if (targetPath.startsWith('/bfi-classroom/api')) {
      targetPath = targetPath.replace(/^\/bfi-classroom\/api/, '/api');
    }
    const targetUrl = `${testBaseUrl.replace(/\/$/, '')}${targetPath}${originalUrl.search}`;
    try {
      const response = await route.fetch({ url: targetUrl });
      await route.fulfill({ response });
    } catch (err) {
      try {
        await route.abort();
      } catch { /* ignore */ }
    }
  });
}

/**
 * Verification helper: prove that a deliberately misconfigured server target (e.g. production port 3001)
 * is rejected with a fatal error BEFORE any mutation occurs.
 */
export async function assertServerRejectionProof(badUrl = 'http://127.0.0.1:3001') {
  let thrown = false;
  let errMsg = '';
  try {
    await verifyServerIsolation(badUrl);
  } catch (err) {
    thrown = true;
    errMsg = err.message;
  }

  if (!thrown) {
    throw new Error(`SECURITY FAILURE: Expected verifyServerIsolation to reject misconfigured server "${badUrl}", but it passed!`);
  }

  if (
    !errMsg.includes('PRODUCTION') &&
    !errMsg.includes('NOT using the designated isolated test database') &&
    !errMsg.includes('HTTP 404') &&
    !errMsg.includes('FATAL TEST')
  ) {
    throw new Error(`SECURITY WARNING: Rejection error message did not contain safety warning keywords. Message: ${errMsg}`);
  }

  return { verifiedRejection: true, errMsg };
}

/**
 * Initialize a fresh, isolated disposable test database with the complete canonical schema and test seeds.
 * Guarantees zero interaction with production records.
 */
export async function initIsolatedTestDatabase(dbPath = TEST_DB_PATH) {
  assertIsolatedTestDatabase(dbPath);
  process.env.DATABASE_PATH = dbPath;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  // Check if test db already has canonical schema (e.g. batch_students with assigned_by)
  const bsInfo = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'batch_students'").get();
  let hasCanonicalSchema = false;
  if (bsInfo) {
    const cols = db.prepare('PRAGMA table_info(batch_students)').all().map(c => c.name);
    if (cols.includes('assigned_by')) {
      hasCanonicalSchema = true;
    }
  }

  if (!hasCanonicalSchema) {
    // Read canonical schema from PROD_DB_PATH (STRICTLY READONLY)
    const prodDb = new Database(PROD_DB_PATH, { readonly: true });
    const schemaObjs = prodDb.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END"
    ).all();
    prodDb.close();

    // Drop any existing non-sqlite tables in test db to get clean canonical slate
    const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const t of existingTables) {
      try { db.exec(`DROP TABLE IF EXISTS "${t.name}"`); } catch { /* ignore */ }
    }

    // Apply canonical DDL
    for (const obj of schemaObjs) {
      if (obj.sql) {
        try {
          db.exec(obj.sql);
        } catch {
          // ignore already created or minor ordering collisions
        }
      }
    }
  }

  db.pragma('foreign_keys = ON');

  // Run database initializer for any dynamic migrations/triggers
  const { initializeDatabase } = await import('../server/db/database.js');
  initializeDatabase();

  // Seed default admin and moderator users if missing
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password', salt);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin@abir', 'k.eye.films@gmail.com', hash, 'admin', 'Abir', 'Ahmad');
    db.prepare(`
      INSERT OR IGNORE INTO users (username, email, password_hash, role, first_name, last_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin_bfi', 'admin@bfibd.org', hash, 'admin', 'BFI', 'Admin');
  }

  const studentExists = db.prepare("SELECT id FROM users WHERE role = 'student' LIMIT 1").get();
  if (!studentExists) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password', salt);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run('student_default', 'student@bfibd.org', hash, 'student', 'Default', 'Student');
  }

  return db;
}
