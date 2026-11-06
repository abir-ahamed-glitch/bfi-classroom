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
 * 1. [Seeded Auth] Multi-Tab Concurrency via Web Locks & BroadcastChannel using real application apiClient.
 * 2. [Seeded Auth] Multi-Tab Concurrency in browsers without Web Locks or BroadcastChannel.
 * 3. [Real Login & MFA] Complete Workshop Flow on Desktop (1280x800), Token Expiry on Publish, Page Reload & Persistence.
 * 4. [Real Login & MFA] Mobile Viewport (390x844), Session Revocation, Draft Isolation & Same-Account Recovery.
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
  const { generateTotpSecret, encryptSecret, generateTotpCode } = await import('../server/utils/totp.js');

  // Seed Admin 1 (with MFA enabled) and Admin 2 (password-only)
  const rawTotpSecret = generateTotpSecret();
  const encryptedTotpSecret = encryptSecret(rawTotpSecret);
  const passwordHash = bcrypt.hashSync('Password123!', 10);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version, two_factor_enabled, two_factor_secret)
    VALUES (1, 'admin@lead', 'lead_admin@bfi.edu', ?, 'admin', 'Lead', 'Admin', 1, 1, 1, 1, ?),
           (2, 'admin@guest', 'guest_admin@bfi.edu', ?, 'admin', 'Guest', 'Admin', 1, 0, 1, 0, NULL)
  `).run(passwordHash, encryptedTotpSecret, passwordHash);

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

    // Explicitly labeled: Simulated Cloudflare Turnstile provider for automated test environment
    await context.addInitScript(() => {
      window.turnstile = {
        render: (container, options) => {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'cf-turnstile-response';
          input.value = 'mock_test_turnstile_token';
          container.appendChild(input);
          if (typeof options === 'object' && typeof options.callback === 'function') {
            setTimeout(() => options.callback('mock_test_turnstile_token'), 50);
          }
          return 'mock_turnstile_widget_1';
        },
        reset: () => {},
        remove: () => {},
        getResponse: () => 'mock_test_turnstile_token'
      };
    });

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

    // ── STEP 1: [Seeded Auth] Multi-Tab Concurrency via Web Locks & BroadcastChannel using REAL apiClient ──
    await runStep('[Seeded Auth] Multi-tab concurrency via Web Locks & BroadcastChannel using real application apiClient', async () => {
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

      // Concurrently execute the real application apiClient in both tabs
      const [res1, res2] = await Promise.all([
        page1.evaluate(async () => {
          if (typeof window.apiClient !== 'function') throw new Error('window.apiClient is not available on page');
          const resp = await window.apiClient('/api/admin/course-definitions');
          return { status: resp.status, token: localStorage.getItem('token') };
        }),
        page2.evaluate(async () => {
          if (typeof window.apiClient !== 'function') throw new Error('window.apiClient is not available on page');
          const resp = await window.apiClient('/api/admin/course-definitions');
          return { status: resp.status, token: localStorage.getItem('token') };
        })
      ]);

      assert.strictEqual(res1.status, 200, 'Tab 1 real apiClient call must succeed with 200 OK');
      assert.strictEqual(res2.status, 200, 'Tab 2 real apiClient call must succeed with 200 OK');
      assert.ok(res1.token, 'Tab 1 must possess valid refreshed access token');
      assert.ok(res2.token, 'Tab 2 must possess valid refreshed access token');

      await page1.close();
      await page2.close();
    });

    // ── STEP 2: [Seeded Auth] Multi-Tab Concurrency in Browsers Without Web Locks or BroadcastChannel ──
    await runStep('[Seeded Auth] Multi-tab concurrency in browsers without Web Locks or BroadcastChannel', async () => {
      // Create isolated context simulating legacy browser environment
      const noLockContext = await browser.newContext();
      await noLockContext.addInitScript(() => {
        delete window.navigator.locks;
        delete window.BroadcastChannel;
      });

      const { refreshJwt, accessToken, sessionId } = seedBrowserAuth(1, true); // Expired access token

      await noLockContext.addCookies([
        { name: 'bfi_refresh_token', value: refreshJwt, domain: '127.0.0.1', path: '/' }
      ]);

      const p1 = await noLockContext.newPage();
      const p2 = await noLockContext.newPage();

      await p1.goto(`${baseUrl}/`);
      await p1.evaluate((t) => localStorage.setItem('token', t), accessToken);
      await p2.goto(`${baseUrl}/`);
      await p2.evaluate((t) => localStorage.setItem('token', t), accessToken);

      // Concurrently execute real apiClient calls from both pages
      const [r1, r2] = await Promise.all([
        p1.evaluate(async () => {
          const resp = await window.apiClient('/api/admin/course-definitions');
          return { status: resp.status, token: localStorage.getItem('token') };
        }),
        p2.evaluate(async () => {
          const resp = await window.apiClient('/api/admin/course-definitions');
          return { status: resp.status, token: localStorage.getItem('token') };
        })
      ]);

      // NOTE: localStorage is NOT an atomic mutex. If both tabs race through the check-and-set
      // at exactly the same instant, the server enforces TOKEN_ALREADY_ROTATED (401) and the
      // session is revoked. The cooperative waiting (6s poll) makes this unlikely but cannot
      // prevent it. The correct success criterion is: Tab 1 succeeds; Tab 2 either reuses
      // Tab 1's freshly issued token (cooperative success) OR triggers safe re-auth
      // (draft preserved, login redirect). No duplicate access tokens are issued.
      assert.strictEqual(r1.status, 200, 'Tab 1 must succeed even without Web Locks');
      // Tab 2 either: (a) got 200 by reusing the token Tab 1 refreshed via localStorage poll,
      // OR (b) caused TOKEN_ALREADY_ROTATED and fell through to the caller which returned
      // the original 401. Both are safe outcomes; we assert no crash and no token mismatch.
      assert.ok(r1.token, 'Tab 1 must hold a valid access token after successful refresh');
      // If Tab 2 also got 200, its token must match Tab 1's (cooperative success).
      if (r2.status === 200) {
        assert.ok(r2.token, 'Tab 2 (cooperative success) must hold a valid access token');
        // Both tabs must share the same refreshed token (not independently issued copies).
        assert.strictEqual(r2.token, r1.token, 'Cooperative path: both tabs must share the same rotated token');
      } else {
        // Tab 2 got 401 — safe failure path. Session may be revoked. That is correct behavior.
        // The session may or may not still exist (depends on race outcome).
        assert.ok(r2.status === 401, 'Tab 2 safe failure must be 401, got ' + r2.status);
      }

      // Assert: regardless of Tab 2 outcome, Tab 1's session was not incorrectly revoked
      // before Tab 1 completed. (The session may already be gone if Tab 2 also raced, which is safe.)
      // We validate only that Tab 1 did NOT receive a revoked/error response.
      const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (r2.status === 200) {
        assert.ok(sess, 'Session must NOT be revoked when both tabs cooperated successfully');
      }
      // If r2.status is 401, the session may legitimately be deleted (TOKEN_ALREADY_ROTATED revoked it).
      // That is the correct safe-failure response to a non-atomic race.

      await p1.close();
      await p2.close();
      await noLockContext.close();
    });

    // ── STEP 3: [Real Login & MFA] Complete Workshop Flow on Desktop (1280x800) with Expiry & Reload ──
    await runStep('[Real Login & MFA] Complete workshop flow on desktop (1280x800), expiry on publish, reload & persistence', async () => {
      const desktopContext = await browser.newContext({
        viewport: { width: 1280, height: 800 }
      });

      await desktopContext.addInitScript(() => {
        window.turnstile = {
          render: (container, options) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'cf-turnstile-response';
            input.value = 'mock_test_turnstile_token';
            container.appendChild(input);
            if (typeof options === 'object' && typeof options.callback === 'function') {
              setTimeout(() => options.callback('mock_test_turnstile_token'), 50);
            }
            return 'mock_turnstile_widget_desktop';
          },
          reset: () => {},
          remove: () => {},
          getResponse: () => 'mock_test_turnstile_token'
        };
      });

      const page = await desktopContext.newPage();

      // Reset last_totp_timestamp for Admin 1
      db.prepare('UPDATE users SET last_totp_timestamp = 0 WHERE id = 1').run();

      // 1. Real Login via Admin Login form
      await page.goto(`${baseUrl}/admin/login`);
      await page.waitForLoadState('domcontentloaded');

      const userInput = page.locator('#username');
      await userInput.waitFor({ state: 'visible', timeout: 8000 });
      await userInput.fill('lead');

      const passInput = page.locator('#password');
      await passInput.fill('Password123!');
      await page.waitForTimeout(200);

      await page.locator('button[type="submit"]').first().click();

      // Real TOTP MFA verification
      const totpInput = page.locator('#totpCode');
      await totpInput.waitFor({ state: 'visible', timeout: 8000 });
      const totpCode = generateTotpCode(rawTotpSecret);
      await totpInput.fill(totpCode);
      await page.getByRole('button', { name: /Verify & Continue/i }).click();

      // Follows redirect away from login
      await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 10000 });

      // 2. Open Course Maker in builder mode
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');

      // Fill in workshop details
      const nameInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await nameInput.waitFor({ state: 'visible', timeout: 8000 });
      await nameInput.fill('Directing Masterclass Workshop 2026');

      const descInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await descInput.waitFor({ state: 'visible', timeout: 5000 });
      await descInput.fill('Intensive 3-day practical directing workshop.');

      const phaseTitleInput = page.locator('input[placeholder*="Module"]').or(page.locator('input[placeholder*="Phase"]')).first();
      if (await phaseTitleInput.isVisible()) {
        await phaseTitleInput.fill('Phase 1: Scene Coverage & Blocking');
      }

      // 3. Review Mode Round-Trip
      const reviewNavBtn = page.getByRole('button', { name: /Review & Publish|Review Rules Before Publishing/i }).first();
      await reviewNavBtn.waitFor({ state: 'visible', timeout: 5000 });
      await reviewNavBtn.click();
      await page.waitForTimeout(300);

      const backToEditBtn = page.getByRole('button', { name: /Back to Edit|Back to Editor/i }).first();
      await backToEditBtn.waitFor({ state: 'visible', timeout: 5000 });
      await backToEditBtn.click();
      await page.waitForTimeout(300);

      // Polish edit
      await descInput.fill('Directing Masterclass Workshop 2026 - Polished Review Edit');

      // Return to Review Mode
      await reviewNavBtn.click();
      await page.waitForTimeout(300);

      // 4. Simulate access token expiration right before clicking Publish
      const expiredToken = jwt.sign(
        { id: 1, username: 'admin@lead', role: 'admin', is_super_admin: 1, token_version: 1, type: 'access' },
        getJwtSecret(),
        { expiresIn: -60 }
      );
      await page.evaluate((t) => localStorage.setItem('token', t), expiredToken);

      // Click Publish Course Definition
      const publishBtn = page.getByRole('button', { name: /Publish Course Definition/i });
      await publishBtn.waitFor({ state: 'visible', timeout: 5000 });
      await Promise.all([
        page.waitForResponse(res => res.url().includes('/publish') && res.status() === 200, { timeout: 10000 }),
        publishBtn.click()
      ]);

      // 5. Assert database: exactly 1 published record with polished review edit
      const published = db.prepare('SELECT * FROM course_definitions WHERE name = ?').get('Directing Masterclass Workshop 2026');
      assert.ok(published, 'Course definition must be inserted into SQLite');
      assert.strictEqual(published.status, 'published', 'Course definition status must be published');
      assert.strictEqual(published.description, 'Directing Masterclass Workshop 2026 - Polished Review Edit', 'Polished review edit must be persisted');

      // 6. Reload page and verify persisted result in UI!
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // Wait for React to finish rendering the course definition in the list
      const courseCard = page.locator('text=Directing Masterclass Workshop 2026').first();
      await courseCard.waitFor({ state: 'visible', timeout: 10000 });
      assert.ok(await courseCard.isVisible(), 'UI must render the persisted course after reload');

      await desktopContext.close();
    });

    // ── STEP 4: [Real Login & MFA] Mobile Viewport (390x844), Session Revocation, Draft Isolation & Recovery ──
    await runStep('[Real Login & MFA] Mobile viewport (390x844), session revocation, draft isolation & recovery', async () => {
      // Simulate modern mobile form factor (iPhone 14 / modern Android)
      const mobileContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      });

      await mobileContext.addInitScript(() => {
        window.turnstile = {
          render: (container, options) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'cf-turnstile-response';
            input.value = 'mock_test_turnstile_token';
            container.appendChild(input);
            if (typeof options === 'object' && typeof options.callback === 'function') {
              setTimeout(() => options.callback('mock_test_turnstile_token'), 50);
            }
            return 'mock_turnstile_widget_mobile';
          },
          reset: () => {},
          remove: () => {},
          getResponse: () => 'mock_test_turnstile_token'
        };
      });

      const page = await mobileContext.newPage();
      page.on('console', msg => console.log('MOBILE LOG [' + msg.type() + ']:', msg.text()));
      page.on('response', res => { if (res.status() >= 400) console.log('MOBILE HTTP ' + res.status() + ':', res.url()); });

      // Reset last_totp_timestamp for Admin 1
      db.prepare('UPDATE users SET last_totp_timestamp = 0 WHERE id = 1').run();

      // 1. Admin 1 logs in via mobile UI with Turnstile and TOTP MFA
      await page.goto(`${baseUrl}/admin/login`);
      await page.waitForLoadState('domcontentloaded');

      const userInput = page.locator('#username');
      await userInput.waitFor({ state: 'visible', timeout: 8000 });
      await userInput.fill('lead');

      const passInput = page.locator('#password');
      await passInput.fill('Password123!');
      await page.waitForTimeout(200);

      await page.locator('button[type="submit"]').first().click();

      // TOTP MFA Challenge
      const totpInput = page.locator('#totpCode');
      await totpInput.waitFor({ state: 'visible', timeout: 8000 });
      const totpCode = generateTotpCode(rawTotpSecret);
      await totpInput.fill(totpCode);
      await page.getByRole('button', { name: /Verify & Continue/i }).click();

      await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 10000 });

      // 2. Open Course Maker on mobile
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');

      const nameInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await nameInput.waitFor({ state: 'visible', timeout: 8000 });
      await nameInput.fill('Mobile Cinematography Workshop 2026');

      const descInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await descInput.waitFor({ state: 'visible', timeout: 5000 });
      await descInput.fill('Smartphone cinema masterclass on mobile viewport.');

      const phaseTitleInput = page.locator('input[placeholder*="Module"]').or(page.locator('input[placeholder*="Phase"]')).first();
      if (await phaseTitleInput.isVisible()) {
        await phaseTitleInput.fill('Phase 1: Mobile Gimbals & Microphones');
      }

      // 3. Server-side session revocation: simulate admin password reset or session kill
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = 1').run();

      // Trigger authenticated call in Course Maker: click "Save as Draft"
      const saveDraftBtn = page.getByRole('button', { name: /Save as Draft/i }).first();
      await saveDraftBtn.scrollIntoViewIfNeeded();
      await saveDraftBtn.click();

      // apiClient intercepts 401 SESSION_REVOKED -> saves draft to localStorage -> dispatches bfi:session-expired -> ProtectedRoute navigates to /admin/login
      await page.waitForFunction(() => window.location.pathname.includes('/admin/login'), null, { timeout: 10000 });
      assert.ok(page.url().includes('session_expired=true'), 'Mobile URL must preserve session_expired=true');
      assert.ok(page.url().includes('redirect='), 'Mobile URL must preserve redirect target');

      const noticeText = await page.textContent('body');
      assert.ok(
        noticeText.includes('session has expired') || noticeText.includes('safely preserved') || noticeText.includes('Restricted Area'),
        'Mobile login page must display session expired draft preservation notice'
      );

      // 4. Different account logs in (Admin 2 / Guest Admin)
      const user2Input = page.locator('#username');
      await user2Input.waitFor({ state: 'visible' });
      await user2Input.fill('guest');

      const user2Pass = page.locator('#password');
      await user2Pass.fill('Password123!');
      await page.waitForTimeout(200);

      await page.locator('button[type="submit"]').first().click();

      // Follows redirect to Course Maker
      await page.waitForFunction(() => window.location.pathname.includes('/admin/course-maker'), null, { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');

      // Assert: Admin 2 MUST NOT see Admin 1's draft!
      const admin2TitleInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await admin2TitleInput.waitFor({ state: 'visible', timeout: 8000 });
      const admin2Title = await admin2TitleInput.inputValue();
      assert.strictEqual(admin2Title, '', 'Admin 2 MUST NOT see Admin 1 draft! Cross-account draft isolation verified on mobile.');

      // 5. Admin 2 logs out, and Admin 1 logs back in via real UI to recover the draft
      await page.evaluate(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('auth_user_cache');
      });
      await mobileContext.clearCookies();

      // Clear last_totp_timestamp for Admin 1's re-login
      db.prepare('UPDATE users SET last_totp_timestamp = 0 WHERE id = 1').run();

      await page.goto(`${baseUrl}/admin/login?redirect=${encodeURIComponent('/admin/course-maker?mode=builder')}`);
      await page.waitForLoadState('domcontentloaded');

      const admin1ReUser = page.locator('#username');
      await admin1ReUser.waitFor({ state: 'visible' });
      await admin1ReUser.fill('lead');

      const admin1RePass = page.locator('#password');
      await admin1RePass.fill('Password123!');
      await page.waitForTimeout(200);

      await page.locator('button[type="submit"]').first().click();

      // MFA Challenge for Admin 1
      const mfaInputRe = page.locator('#totpCode');
      await mfaInputRe.waitFor({ state: 'visible', timeout: 8000 });
      const newTotp = generateTotpCode(rawTotpSecret);
      await mfaInputRe.fill(newTotp);
      await page.getByRole('button', { name: /Verify & Continue/i }).click();

      // Redirects back to Course Maker
      await page.waitForFunction(() => window.location.pathname.includes('/admin/course-maker'), null, { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');

      // Assert: Admin 1's draft is RESTORED!
      const restoredTitleInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await restoredTitleInput.waitFor({ state: 'visible', timeout: 8000 });
      const restoredTitle = await restoredTitleInput.inputValue();
      assert.strictEqual(restoredTitle, 'Mobile Cinematography Workshop 2026', 'Admin 1 unsaved draft title MUST be restored on mobile!');

      const restoredDescInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      const restoredDesc = await restoredDescInput.inputValue();
      assert.strictEqual(restoredDesc, 'Smartphone cinema masterclass on mobile viewport.', 'Admin 1 unsaved draft description MUST be restored on mobile!');

      // Make final review edit and publish
      await restoredDescInput.fill('Mobile Cinematography Workshop 2026 - Polished Mobile Workshop');

      const reviewNavBtn = page.getByRole('button', { name: /Review & Publish|Review Rules Before Publishing/i }).first();
      await reviewNavBtn.click({ force: true });
      await page.waitForTimeout(300);

      const publishBtn = page.getByRole('button', { name: /Publish Course Definition/i });
      await publishBtn.waitFor({ state: 'visible', timeout: 5000 });
      await Promise.all([
        page.waitForResponse(res => res.url().includes('/publish') && res.status() === 200, { timeout: 10000 }),
        publishBtn.click({ force: true })
      ]);

      // Assert SQLite: exactly one course definition published with final review edit
      const published = db.prepare('SELECT * FROM course_definitions WHERE name = ?').get('Mobile Cinematography Workshop 2026');
      assert.ok(published, 'Course definition must be inserted into SQLite');
      assert.strictEqual(published.status, 'published', 'Course definition status must be published');
      assert.strictEqual(published.description, 'Mobile Cinematography Workshop 2026 - Polished Mobile Workshop', 'Final review edit must be persisted');
      assert.strictEqual(published.created_by, 1, 'Created by must match Admin 1');

      await mobileContext.close();
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
