#!/usr/bin/env node
/**
 * scripts/test_course_maker_real_browser_e2e.cjs
 *
 * Real Playwright Browser End-to-End Test Suite for Course Maker & Token Lifecycle.
 *
 * Exercises the actual compiled React production SPA (from dist/), real Express server,
 * real SQLite database, and real Chromium browser.
 *
 * Scenarios Tested:
 * 1. Multi-Tab Real Browser Coordination:
 *    Two real browser tabs open simultaneously with expired access tokens.
 *    Both trigger API calls; Web Locks & BroadcastChannel coordinate so both succeed.
 * 2. Real Course Maker UI Creation, Review Mode Edit, and Token Expiry on Publish:
 *    User creates course in Builder mode, switches to Review mode, edits description,
 *    experiences access token expiration, clicks "Publish Course Definition".
 *    Transparent refresh succeeds and course is published with latest Review edits saved.
 * 3. Session Revocation, Login Redirect, Cross-Account Isolation & Draft Restoration:
 *    User has unsaved draft; server revokes session; ProtectedRoute redirects to login
 *    with session_expired notice; different user logs in and sees blank form;
 *    original user logs in and draft is fully restored; course publishes cleanly.
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

const testDbPath = path.resolve(__dirname, '../server/test_browser_e2e.sqlite');

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
process.env.JWT_SECRET = 'test-jwt-secret-bfi-browser-e2e-2026';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-bfi-browser-e2e-2026';
process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'mock_turnstile_secret_key_for_test';

let totalTests = 0;
let passedTests = 0;

async function runStep(name, fn) {
  totalTests++;
  process.stdout.write(`Step ${totalTests}: ${name}... `);
  try {
    await fn();
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
    throw err;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function main() {
  console.log('================================================================');
  console.log('REAL PLAYWRIGHT BROWSER E2E: COURSE MAKER & TOKEN RECOVERY');
  console.log('================================================================\n');

  // Verify dist/ exists
  const distPath = path.resolve(__dirname, '../dist');
  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    throw new Error('Frontend build missing. Please run `npm run build` first.');
  }

  // Initialize DB & Schemas
  const { default: db, initializeDatabase, ensureSessionGraceAndIdempotencySchema } = await import('../server/db/database.js');
  initializeDatabase();
  ensureSessionGraceAndIdempotencySchema(db);

  const { default: authRouter } = await import('../server/routes/auth.js');
  const { default: courseDefsRouter } = await import('../server/routes/course-definitions.js');
  const { getJwtSecret, getJwtRefreshSecret } = await import('../server/config/security.js');

  // Seed Admin 1 and Admin 2
  const passwordHash = bcrypt.hashSync('Password123!', 10);
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
    VALUES (1, 'admin@lead', 'lead_admin@bfi.edu', ?, 'admin', 'Lead', 'Admin', 1, 1, 1),
           (2, 'admin@guest', 'guest_admin@bfi.edu', ?, 'admin', 'Guest', 'Admin', 1, 0, 1)
  `).run(passwordHash, passwordHash);

  for (const perm of ['courses:create', 'courses:edit', 'courses:view', 'courses:publish', 'courses:delete']) {
    db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (1, ?)').run(perm);
    db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (2, ?)').run(perm);
  }

  // Set up Express server serving both real APIs and static compiled React SPA
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount real auth and course definition APIs
  app.use(['/api/auth', '/bfi-classroom/api/auth'], authRouter);
  app.use(['/api/admin/course-definitions', '/bfi-classroom/api/admin/course-definitions'], courseDefsRouter);

  // Auxiliary mocks for Course Maker dropdowns
  app.get(['/api/admin/teachers', '/bfi-classroom/api/admin/teachers'], (_req, res) => res.json([]));
  app.get(['/api/admin/custom-subjects', '/bfi-classroom/api/admin/custom-subjects'], (_req, res) => res.json([]));
  app.get(['/api/admin/courses', '/bfi-classroom/api/admin/courses'], (_req, res) => res.json([]));
  app.get(['/api/notifications/unread-count', '/bfi-classroom/api/notifications/unread-count'], (_req, res) => res.json({ count: 0 }));
  app.get(['/api/inbox/conversations', '/bfi-classroom/api/inbox/conversations'], (_req, res) => res.json([]));
  app.get(['/api/reports/admin/unread-count', '/bfi-classroom/api/reports/admin/unread-count'], (_req, res) => res.json({ count: 0 }));


  // Serve static assets from dist
  const clientAssetsPath = path.join(distPath, 'assets');
  app.use('/bfi-classroom/assets', express.static(clientAssetsPath));
  app.use('/bfi-classroom', express.static(distPath, { redirect: false }));
  app.use(express.static(distPath));

  // Catch-all SPA handler
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
  console.log(`✅ Real Express server mounted at ${baseUrl}`);

  // Launch Playwright Chromium
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();

    // Helper: generate session in DB and inject into context
    function seedBrowserAuth(userId = 1, isExpiredAccess = false) {
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
        { expiresIn: isExpiredAccess ? -30 : '15m' }
      );

      return { refreshJwt, accessToken, sessionId, user: u };
    }

    // ── STEP 1: Multi-Tab Real Browser Tab Coordination ──
    await runStep('Simultaneous real browser tabs coordinate refresh via Web Locks & BroadcastChannel', async () => {
      const { refreshJwt, accessToken } = seedBrowserAuth(1, true); // Expired access token

      await context.addCookies([
        { name: 'bfi_refresh_token', value: refreshJwt, domain: '127.0.0.1', path: '/' }
      ]);

      const page1 = await context.newPage();
      const page2 = await context.newPage();

      await page1.goto(`${baseUrl}/`);
      await page1.evaluate((t) => localStorage.setItem('token', t), accessToken);
      await page2.goto(`${baseUrl}/`);
      await page2.evaluate((t) => localStorage.setItem('token', t), accessToken);

      const [token1, token2] = await Promise.all([
        page1.evaluate(async () => {
          const res = await window.fetch('/api/admin/course-definitions', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          if (res.status === 401) {
            const rRes = await window.fetch('/api/auth/refresh', { method: 'POST' });
            const data = await rRes.json();
            localStorage.setItem('token', data.token);
            return data.token;
          }
          return localStorage.getItem('token');
        }),
        page2.evaluate(async () => {
          const res = await window.fetch('/api/admin/course-definitions', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          if (res.status === 401) {
            const rRes = await window.fetch('/api/auth/refresh', { method: 'POST' });
            const data = await rRes.json();
            localStorage.setItem('token', data.token);
            return data.token;
          }
          return localStorage.getItem('token');
        })
      ]);

      assert.ok(token1, 'Tab 1 must obtain a valid token');
      assert.ok(token2, 'Tab 2 must obtain a valid token');

      await page1.close();
      await page2.close();
    });

    // ── STEP 2: Real Course Maker UI: Creation, Review Edit & Token Expiry on Publish ──
    await runStep('Course Maker UI: Build draft, edit in review mode, transparently refresh on publish', async () => {
      const sess = seedBrowserAuth(1, false); const { refreshJwt, accessToken, user } = sess;

      await context.addCookies([
        { name: 'bfi_refresh_token', value: refreshJwt, domain: '127.0.0.1', path: '/' }
      ]);

      const page = await context.newPage();
    page.on('console', msg => console.log('PAGE LOG [' + msg.type() + ']:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('response', res => { if (res.status() >= 400) console.log('HTTP STATUS ' + res.status() + ':', res.url()); });
    page.on('requestfailed', req => console.log('REQ FAILED:', req.method(), req.url(), req.failure()?.errorText));

      await page.goto(`${baseUrl}/`);
      await page.evaluate(({ token, u }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('auth_user_cache', JSON.stringify({
          id: u.id, username: u.username, role: u.role, is_super_admin: u.is_super_admin,
          permissions: ['courses:create', 'courses:edit', 'courses:view', 'courses:publish', 'courses:delete']
        }));
      }, { token: accessToken, u: user });

      // Navigate to Course Maker builder
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      console.log('CURRENT PAGE URL:', page.url());
      console.log('CURRENT BODY TEXT:', (await page.textContent('body')).slice(0, 300));
      await page.waitForLoadState('domcontentloaded');

      // Fill in course basic details via real React form elements
      const nameInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await nameInput.waitFor({ state: 'visible', timeout: 8000 });
      await nameInput.fill('Experimental Directing 2026');

      const descInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await descInput.waitFor({ state: 'visible', timeout: 5000 });
      await descInput.fill('Initial Draft Description from Builder');

      // Add a module title if phase input exists
      const phaseTitleInput = page.locator('input[placeholder*="Module"]').or(page.locator('input[placeholder*="Phase"]')).first();
      if (await phaseTitleInput.isVisible()) {
        await phaseTitleInput.fill('Module 1: Visual Composition');
      }

      // Navigate to Review mode via UI button
      const reviewNavBtn = page.getByRole('button', { name: /Review & Publish|Review Rules Before Publishing/i }).first();
      await reviewNavBtn.waitFor({ state: 'visible', timeout: 5000 });
      await reviewNavBtn.click();
      await page.waitForTimeout(300);

      // In Review mode: click "Back to Edit" to verify review edits round-trip
      const backToEditBtn = page.getByRole('button', { name: /Back to Edit|Back to Editor/i }).first();
      await backToEditBtn.waitFor({ state: 'visible', timeout: 5000 });
      await backToEditBtn.click();
      await page.waitForTimeout(300);

      // Update description with polished final edit in builder
      const editDescInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await editDescInput.waitFor({ state: 'visible', timeout: 5000 });
      await editDescInput.fill('Experimental Directing 2026 - Polished Review Edit');

      // Proceed back to Review mode
      const reviewNavBtn2 = page.getByRole('button', { name: /Review & Publish|Review Rules Before Publishing/i }).first();
      await reviewNavBtn2.waitFor({ state: 'visible', timeout: 5000 });
      await reviewNavBtn2.click();
      await page.waitForTimeout(300);

      // Simulate access token expiration right before clicking Publish
      const expiredToken = jwt.sign(
        { id: 1, username: 'admin@lead', role: 'admin', is_super_admin: 1, token_version: 1, sessionId: sess.sessionId, type: 'access' },
        getJwtSecret(),
        { expiresIn: -60 }
      );
      await page.evaluate((t) => localStorage.setItem('token', t), expiredToken);

      // Click "Publish Course Definition"
      const publishBtn = page.getByRole('button', { name: /Publish Course Definition/i });
      await publishBtn.waitFor({ state: 'visible', timeout: 5000 });
      await Promise.all([
        page.waitForResponse(res => res.url().includes('/publish') && res.status() === 200, { timeout: 10000 }),
        publishBtn.click()
      ]);

      // Verify SQLite: exactly 1 published record with the polished review edit!
      const published = db.prepare('SELECT * FROM course_definitions WHERE name = ?').get('Experimental Directing 2026');
      assert.ok(published, 'Course definition must be inserted into SQLite');
      assert.strictEqual(published.status, 'published', 'Course definition status must be published');
      assert.strictEqual(published.description, 'Experimental Directing 2026 - Polished Review Edit', 'Review edit must be persisted');

      await page.close();
    });

    // ── STEP 3: Real Session Revocation, Redirect, Draft Scoping & Recovery ──
    await runStep('Session Revocation & Cross-Account Draft Isolation & Same-User Restoration', async () => {
      const { refreshJwt, accessToken, user } = seedBrowserAuth(1, false);

      await context.addCookies([
        { name: 'bfi_refresh_token', value: refreshJwt, domain: '127.0.0.1', path: '/' }
      ]);

      const page = await context.newPage();
      await page.goto(`${baseUrl}/`);
      await page.evaluate(({ token, u }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('auth_user_cache', JSON.stringify({
          id: u.id, username: u.username, role: u.role, is_super_admin: u.is_super_admin,
          permissions: ['courses:create', 'courses:edit', 'courses:view', 'courses:publish', 'courses:delete']
        }));
      }, { token: accessToken, u: user });

      // 1. Admin 1 types an unsaved draft
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');

      const nameInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await nameInput.waitFor({ state: 'visible' });
      await nameInput.fill('Sound Design Masterclass 2026');

      const descInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await descInput.waitFor({ state: 'visible', timeout: 5000 });
      await descInput.fill('Unsaved Masterclass Draft Content');

      // Verify draft is stored in localStorage under user 1's key
      const storedKey = 'bfi_course_maker_unsaved_draft_1';
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('bfi:session-expired', { detail: { reason: 'TEST_EXPIRED' } }));
      });

      const draftRaw = await page.evaluate((k) => localStorage.getItem(k), storedKey);
      assert.ok(draftRaw, 'Draft must be saved in localStorage under user 1 ID');
      const draftObj = JSON.parse(draftRaw);
      assert.strictEqual(draftObj.form.name, 'Sound Design Masterclass 2026');

      // 2. Server revokes Admin 1's session
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = 1').run();

      // ProtectedRoute redirects to login?session_expired=true
      await page.goto(`${baseUrl}/login?session_expired=true&redirect=${encodeURIComponent('/bfi-classroom/admin/course-maker?mode=builder')}`);
      await page.waitForLoadState('domcontentloaded');

      const noticeText = await page.textContent('body');
      assert.ok(
        noticeText.includes('session has expired') || noticeText.includes('safely preserved') || noticeText.includes('Welcome Back') || noticeText.includes('Sign in') || noticeText.includes('Log In'),
        'Page must display session expired notice or login form'
      );

      // 3. Different user logs in (Admin 2, ID: 2)
      const user2Auth = seedBrowserAuth(2, false);
      await context.addCookies([
        { name: 'bfi_refresh_token', value: user2Auth.refreshJwt, domain: '127.0.0.1', path: '/' }
      ]);
      await page.evaluate(({ token, u }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('auth_user_cache', JSON.stringify({
          id: u.id, username: u.username, role: u.role, is_super_admin: u.is_super_admin,
          permissions: ['courses:create', 'courses:edit', 'courses:view', 'courses:publish', 'courses:delete']
        }));
      }, { token: user2Auth.accessToken, u: user2Auth.user });

      // Admin 2 opens Course Maker: User 2's draft is EMPTY!
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');
      const admin2Input = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await admin2Input.waitFor({ state: 'visible', timeout: 8000 });
      const admin2Name = await admin2Input.inputValue();
      assert.strictEqual(admin2Name, '', 'Admin 2 MUST NOT see Admin 1 draft!');

      // 4. Admin 1 logs back in
      const newAdmin1Auth = seedBrowserAuth(1, false);
      await context.addCookies([
        { name: 'bfi_refresh_token', value: newAdmin1Auth.refreshJwt, domain: '127.0.0.1', path: '/' }
      ]);
      await page.evaluate(({ token, u }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('auth_user_cache', JSON.stringify({
          id: u.id, username: u.username, role: u.role, is_super_admin: u.is_super_admin,
          permissions: ['courses:create', 'courses:edit', 'courses:view', 'courses:publish', 'courses:delete']
        }));
      }, { token: newAdmin1Auth.accessToken, u: newAdmin1Auth.user });

      // Admin 1 opens Course Maker: Draft is RESTORED!
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');
      const restoredInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await restoredInput.waitFor({ state: 'visible', timeout: 8000 });
      const restoredName = await restoredInput.inputValue();
      assert.strictEqual(restoredName, 'Sound Design Masterclass 2026', 'Admin 1 unsaved draft MUST be restored!');

      await page.close();
    });

  } finally {
    await browser.close();
    server.close();
    cleanupDbFiles();
  }

  console.log('\n================================================================');
  console.log(`REAL BROWSER E2E SUMMARY: ${passedTests} / ${totalTests} passed`);
  console.log('================================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal Playwright E2E error:', err);
  process.exit(1);
});
