/**
 * scripts/reproduce_multi_tab_refresh_issues.cjs
 *
 * Reproduces the two multi-tab refresh defects identified by Codex:
 * 1. Simultaneous tab starts without Web Locks: non-atomic check-then-set race allows
 *    both tabs to become "leader" and send duplicate refresh requests, causing
 *    the second tab to hit the server with a consumed token and revoke the legitimate session.
 * 2. Deliberately delayed refresh response (>1.5s): a waiting tab times out prematurely (after 1.5s),
 *    fires its own refresh call with the stale token, and revokes the session.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');

const testDbPath = path.resolve(__dirname, '../server/test_reproduce_race.sqlite');

function cleanupDbFiles() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = testDbPath + ext;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch {}
    }
  }
}
cleanupDbFiles();

process.env.DATABASE_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.IS_TEST_SERVER = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-reproduce-2026';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-reproduce-2026';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function main() {
  console.log('================================================================');
  console.log('REPRODUCING MULTI-TAB REFRESH RACE DEFECTS IDENTIFIED BY CODEX');
  console.log('================================================================\n');

  const distPath = path.resolve(__dirname, '../dist');
  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    throw new Error('dist/index.html is missing. Please run npm run build first.');
  }

  const { default: db, initializeDatabase, ensureSessionGraceAndIdempotencySchema } = await import('../server/db/database.js');
  initializeDatabase();
  ensureSessionGraceAndIdempotencySchema(db);

  const { default: authRouter } = await import('../server/routes/auth.js');
  const { default: courseDefsRouter } = await import('../server/routes/course-definitions.js');
  const { getJwtSecret, getJwtRefreshSecret } = await import('../server/config/security.js');

  const passwordHash = bcrypt.hashSync('Password123!', 10);
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
    VALUES (1, 'lead_admin', 'lead_admin@bfi.edu', ?, 'admin', 'Lead', 'Admin', 1, 1, 1)
  `).run(passwordHash);

  for (const perm of ['courses:create', 'courses:edit', 'courses:view', 'courses:publish', 'courses:delete']) {
    db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (1, ?)').run(perm);
  }

  // Configurable server delay for refresh route
  let refreshDelayMs = 0;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  let reqCounter = 0;
  // Delay middleware for /api/auth/refresh to test Case 2
  app.use((req, res, next) => {
    reqCounter++;
    const reqNum = reqCounter;
    if (req.url.includes('refresh')) {
      const c = req.cookies?.bfi_refresh_token;
      const h = c ? hashToken(c).substring(0, 10) : 'none';
      console.log(`[SERVER Req #${reqNum}] Refresh request arrived at ${Date.now()}: cookie_hash_prefix=${h}, delay=${refreshDelayMs}ms, url=${req.url}`);
      if (refreshDelayMs > 0) {
        setTimeout(() => {
          console.log(`[SERVER Req #${reqNum}] Delay expired for request with hash_prefix=${h} at ${Date.now()}`);
          next();
        }, refreshDelayMs);
      } else {
        next();
      }
    } else {
      next();
    }
  });

  app.use(['/api/auth', '/bfi-classroom/api/auth'], authRouter);
  app.use(['/api/admin/course-definitions', '/bfi-classroom/api/admin/course-definitions'], courseDefsRouter);

  // Serve static assets from dist
  const clientAssetsPath = path.join(distPath, 'assets');
  app.use('/bfi-classroom/assets', express.static(clientAssetsPath));
  app.use('/bfi-classroom', express.static(distPath, { redirect: false }));
  app.use(express.static(distPath));

  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/bfi-classroom/api')) {
      return res.sendFile('index.html', { root: distPath });
    }
    next();
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/bfi-classroom`;

  const browser = await chromium.launch({ headless: true });

  function seedBrowserAuth(userId = 1) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const refreshJwt = jwt.sign(
      { id: userId, username: u.username, role: u.role, is_super_admin: u.is_super_admin, token_version: u.token_version || 1, jti: crypto.randomUUID() },
      getJwtRefreshSecret(),
      { expiresIn: '7d' }
    );
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const insert = db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, expires_at)
      VALUES (?, ?, '127.0.0.1', ?)
    `).run(userId, hashToken(refreshJwt), expiresAt);
    const sessionId = insert.lastInsertRowid;

    const accessToken = jwt.sign(
      { id: userId, username: u.username, role: u.role, is_super_admin: u.is_super_admin, token_version: u.token_version || 1, sessionId, type: 'access' },
      getJwtSecret(),
      { expiresIn: -30 } // EXPIRED
    );

    return { refreshJwt, accessToken, sessionId };
  }

  try {
    // ── REPRODUCTION: Direct demonstration of the two flaws identified by Codex ──
    console.log('\n--- Flaw 1: Non-atomic race (simultaneous leader execution) ---');
    // When two tabs both check bfi_refresh_in_progress before either sets it,
    // both tabs execute executeRefreshHttpCall() with the same refresh token.
    const sessionRace = seedBrowserAuth(1);
    const cookieHeader = `bfi_refresh_token=${sessionRace.refreshJwt}`;

    // Both tabs fire /api/auth/refresh to the server concurrently
    const [resTab1, resTab2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Cookie': cookieHeader }
      }),
      fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Cookie': cookieHeader }
      })
    ]);

    const status1 = resTab1.status;
    const status2 = resTab2.status;
    const body1 = await resTab1.json().catch(() => ({}));
    const body2 = await resTab2.json().catch(() => ({}));

    console.log(`Tab 1: HTTP ${status1}`, body1.code || (body1.token ? 'TOKEN_ISSUED' : ''));
    console.log(`Tab 2: HTTP ${status2}`, body2.code || (body2.token ? 'TOKEN_ISSUED' : ''));

    // Check database session state
    const sessAfterRace = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionRace.sessionId);
    const userAfterRace = db.prepare('SELECT token_version FROM users WHERE id = 1').get();
    console.log(`Session in SQLite: ${sessAfterRace ? 'ALIVE' : 'REVOKED (DELETED)'}`);
    console.log(`User token_version: ${userAfterRace.token_version}`);
    assert.strictEqual(sessAfterRace, undefined, 'Session was revoked due to duplicate refresh requests hitting server');
    console.log('✅ CONFIRMED FLAW 1: Simultaneous refresh requests cause server-side session revocation!\n');

    console.log('--- Flaw 2: Waiting tab times out after 1.5s on delayed refresh ---');
    // If Tab 1 is delayed (e.g. 2.5s network delay), Tab 2 waits only 1.5s (30 * 50ms),
    // times out, and fires its own executeRefreshHttpCall() with the old token.
    const sessionTimeout = seedBrowserAuth(1);
    const cookieTimeout = `bfi_refresh_token=${sessionTimeout.refreshJwt}`;

    // Tab 1 initiates refresh (delayed 2500ms on server)
    refreshDelayMs = 2500;
    const tab1Promise = fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Cookie': cookieTimeout }
    });

    // Tab 2 simulates waiting 1500ms (the 30 * 50ms timeout) then firing its own refresh
    await new Promise(r => setTimeout(r, 1500));
    console.log('Tab 2: 1.5s timeout expired! Tab 2 falls through to executeRefreshHttpCall()...');
    const tab2Promise = fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Cookie': cookieTimeout }
    });

    const [t1Res, t2Res] = await Promise.all([tab1Promise, tab2Promise]);
    const t1Body = await t1Res.json().catch(() => ({}));
    const t2Body = await t2Res.json().catch(() => ({}));

    console.log(`Delayed Tab 1: HTTP ${t1Res.status}`, t1Body.code || (t1Body.token ? 'TOKEN_ISSUED' : ''));
    console.log(`Timed-out Tab 2: HTTP ${t2Res.status}`, t2Body.code || (t2Body.token ? 'TOKEN_ISSUED' : ''));

    const sessAfterTimeout = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionTimeout.sessionId);
    console.log(`Session in SQLite: ${sessAfterTimeout ? 'ALIVE' : 'REVOKED (DELETED)'}`);
    assert.strictEqual(sessAfterTimeout, undefined, 'Session was revoked due to premature 1.5s timeout');
    console.log('✅ CONFIRMED FLAW 2: Premature 1.5s timeout causes duplicate refresh and session revocation!\n');

  } finally {
    await browser.close();
    server.close();
    cleanupDbFiles();
  }
}

main().catch(err => {
  console.error('Reproduction failed with uncaught error:', err);
  process.exit(1);
});
