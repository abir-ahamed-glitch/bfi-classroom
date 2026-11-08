#!/usr/bin/env node
/**
 * scripts/verify_staging_workshop_and_recovery.cjs
 *
 * Isolated Production-Configuration Staging Verification Suite.
 *
 * Validates:
 * 1. NODE_ENV='production' execution with IS_STAGING_SERVER='true' on loopback (127.0.0.1).
 * 2. Natural wall-clock access token expiration (ADMIN_JWT_EXPIRY='3s') without synthetic JWT tampering.
 * 3. Transparent token refresh and workshop publishing after natural access token expiry.
 * 4. RFC 6819 session revocation / session expiry handling during workshop editing.
 * 5. Complete draft preservation, cross-account draft isolation, and same-account recovery.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');

const testDbPath = path.resolve(__dirname, '../server/test_isolated_staging_classroom.db');

function cleanupDbFiles() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = testDbPath + ext;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch {}
    }
  }
}
cleanupDbFiles();

// PRODUCTION CONFIGURATION FOR ISOLATED STAGING
process.env.DATABASE_PATH = testDbPath;
process.env.NODE_ENV = 'production';
delete process.env.IS_TEST_SERVER;
process.env.IS_STAGING_SERVER = 'true';
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ADMIN_JWT_EXPIRY = '3s'; // Natural 3-second token expiration by real wall clock
process.env.JWT_SECRET = 'staging-jwt-secret-bfi-2026-production';
process.env.JWT_REFRESH_SECRET = 'staging-refresh-secret-bfi-2026-production';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'mock_turnstile_secret_key_for_test';

let totalTests = 0;
let passedTests = 0;

async function runStep(name, fn) {
  totalTests++;
  process.stdout.write(`\n[STAGING STEP ${totalTests}] ${name}...\n`);
  try {
    await fn();
    console.log(`✅ [STAGING STEP ${totalTests} PASSED]`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [STAGING STEP ${totalTests} FAILED]: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log('ISOLATED PRODUCTION-MODE STAGING VERIFICATION');
  console.log(`NODE_ENV:             ${process.env.NODE_ENV}`);
  console.log(`IS_STAGING_SERVER:    ${process.env.IS_STAGING_SERVER}`);
  console.log(`ADMIN_JWT_EXPIRY:     ${process.env.ADMIN_JWT_EXPIRY} (Natural Wall-Clock Expiry)`);
  console.log(`Target Database:      ${testDbPath}`);
  console.log('================================================================\n');

  // Verify dist/
  const distPath = path.resolve(__dirname, '../dist');
  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    throw new Error('Frontend build missing. Please run `npm run build` first.');
  }

  // Initialize DB & Schemas via canonical loaders
  const { default: db, initializeDatabase, ensureSessionGraceAndIdempotencySchema } = await import('../server/db/database.js');
  initializeDatabase();
  ensureSessionGraceAndIdempotencySchema(db);

  const { default: authRouter } = await import('../server/routes/auth.js');
  const { default: courseDefsRouter } = await import('../server/routes/course-definitions.js');
  const { generateTotpSecret, encryptSecret, generateTotpCode } = await import('../server/utils/totp.js');

  // Seed Admin 1 (Super Admin with TOTP MFA) and Admin 2 (Standard Admin without MFA)
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

  // Mount production Express server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount real routes
  app.use(['/api/auth', '/bfi-classroom/api/auth'], authRouter);
  app.use(['/api/admin/course-definitions', '/bfi-classroom/api/admin/course-definitions'], courseDefsRouter);

  // Auxiliary API mocks for Course Maker dropdowns
  app.get(['/api/admin/teachers', '/bfi-classroom/api/admin/teachers'], (_req, res) => res.json([]));
  app.get(['/api/admin/custom-subjects', '/bfi-classroom/api/admin/custom-subjects'], (_req, res) => res.json([]));
  app.get(['/api/admin/courses', '/bfi-classroom/api/admin/courses'], (_req, res) => res.json([]));
  app.get(['/api/notifications/unread-count', '/bfi-classroom/api/notifications/unread-count'], (_req, res) => res.json({ count: 0 }));
  app.get(['/api/inbox/conversations', '/bfi-classroom/api/inbox/conversations'], (_req, res) => res.json([]));
  app.get(['/api/reports/admin/unread-count', '/bfi-classroom/api/reports/admin/unread-count'], (_req, res) => res.json({ count: 0 }));

  // Serve compiled production SPA
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
  console.log(`✅ Production staging server listening at ${baseUrl}\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    // ── SCENARIO 1: Real Login, MFA, Natural 3s Expiry & Transparent Publish ──
    await runStep('Real Login + MFA -> Natural 3s Token Expiry on Publish -> Transparent Refresh -> Persistence', async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

      // Configure Turnstile for isolated staging using the sanctioned token 'staging-turnstile-token'
      await context.addInitScript(() => {
        window.turnstile = {
          render: (container, options) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'cf-turnstile-response';
            input.value = 'staging-turnstile-token';
            container.appendChild(input);
            if (typeof options === 'object' && typeof options.callback === 'function') {
              setTimeout(() => options.callback('staging-turnstile-token'), 50);
            }
            return 'staging_turnstile_widget';
          },
          reset: () => {},
          remove: () => {},
          getResponse: () => 'staging-turnstile-token'
        };
      });

      const page = await context.newPage();

      // Navigate to admin login
      await page.goto(`${baseUrl}/admin/login`);
      await page.waitForLoadState('domcontentloaded');

      // Login Admin 1 with username & password
      const userInput = page.locator('#username');
      await userInput.waitFor({ state: 'visible', timeout: 8000 });
      await userInput.fill('lead');

      const passInput = page.locator('#password');
      await passInput.fill('Password123!');
      await page.waitForTimeout(200);

      await page.locator('button[type="submit"]').first().click();

      // Enter TOTP MFA
      const totpInput = page.locator('#totpCode');
      await totpInput.waitFor({ state: 'visible', timeout: 8000 });
      const currentCode = generateTotpCode(rawTotpSecret);
      await totpInput.fill(currentCode);
      await page.getByRole('button', { name: /Verify & Continue/i }).click();

      // Follow redirect away from login
      await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 10000 });
      console.log(`   [Staging Auth] Successfully authenticated Lead Admin via real password + TOTP MFA.`);

      // Navigate to Course Maker in builder mode
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');

      // Fill in workshop details
      const nameInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await nameInput.waitFor({ state: 'visible', timeout: 8000 });
      await nameInput.fill('Production Staging Cinema Masterclass 2026');

      const descInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await descInput.waitFor({ state: 'visible', timeout: 5000 });
      await descInput.fill('Authored under production-mode staging with natural wall-clock token expiry');

      const phaseTitleInput = page.locator('input[placeholder*="Module"]').or(page.locator('input[placeholder*="Phase"]')).first();
      if (await phaseTitleInput.isVisible()) {
        await phaseTitleInput.fill('Phase 1: Pre-Production & Screenwriting');
      }

      // Enter review mode
      const reviewNavBtn = page.getByRole('button', { name: /Review & Publish|Review Rules Before Publishing/i }).first();
      await reviewNavBtn.waitFor({ state: 'visible', timeout: 5000 });
      await reviewNavBtn.click();
      await page.waitForTimeout(300);

      // Verify token is active now
      const tokenBeforeWait = await page.evaluate(() => localStorage.getItem('token'));
      assert.ok(tokenBeforeWait, 'Access token must exist in localStorage after login');

      // ── NATURAL EXPIRATION WAIT ──
      console.log('   [Staging Expiry] Waiting 4.0 seconds for access token to naturally expire by wall clock (ADMIN_JWT_EXPIRY=3s)...');
      await new Promise(r => setTimeout(r, 4000));
      console.log('   [Staging Expiry] 4.0 seconds elapsed. Token in localStorage is now naturally expired.');

      // Record network calls to verify 401 -> refresh -> 200 transparent cycle
      let initial401Intercepted = false;
      let refreshCalled = false;
      let publishSucceeded = false;

      page.on('response', res => {
        const url = res.url();
        if (url.includes('/api/admin/course-definitions')) {
          if (res.status() === 401) {
            initial401Intercepted = true;
            console.log(`   [Network Response] 401 Token Expired intercepted on: ${url}`);
          }
          if (url.includes('/publish') && res.status() === 200) {
            publishSucceeded = true;
            console.log(`   [Network Response] POST /publish succeeded: HTTP 200`);
          }
        }
        if (url.includes('/api/auth/refresh')) {
          if (res.status() === 200) {
            refreshCalled = true;
            console.log(`   [Network Response] POST /refresh succeeded: HTTP 200 (token rotated)`);
          }
        }
      });

      // Click Publish Course Definition
      const publishBtn = page.getByRole('button', { name: /Publish Course Definition/i }).first();
      await publishBtn.waitFor({ state: 'visible', timeout: 5000 });
      await Promise.all([
        page.waitForResponse(res => res.url().includes('/publish') && res.status() === 200, { timeout: 12000 }),
        publishBtn.click()
      ]);

      assert.ok(initial401Intercepted, 'Initial request must return 401 due to natural token expiry');
      assert.ok(refreshCalled, 'POST /api/auth/refresh must be called automatically by apiClient after 401 token expiry');
      assert.ok(publishSucceeded, 'Publish request must succeed with HTTP 200 after transparent refresh');

      // Verify SQLite persistence
      const published = db.prepare('SELECT * FROM course_definitions WHERE name = ?').get('Production Staging Cinema Masterclass 2026');
      assert.ok(published, 'Course definition must be persisted in SQLite');
      assert.strictEqual(published.status, 'published', 'Course definition status must be published');
      assert.strictEqual(published.created_by, 1, 'Created by must match Admin 1 ID');

      // Reload page and verify persistence in UI
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      const courseCard = page.locator('text=Production Staging Cinema Masterclass 2026').first();
      await courseCard.waitFor({ state: 'visible', timeout: 10000 });
      assert.ok(await courseCard.isVisible(), 'UI must display published course after page reload');
      console.log('   [Persistence] UI and SQLite confirmed persisted published workshop definition.');

      await context.close();
    });

    // ── SCENARIO 2: Session-Expiry Draft Recovery Flow ──
    await runStep('Session Revocation -> Draft Preservation -> Isolation Check -> Re-Authentication & 100% Recovery', async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

      await context.addInitScript(() => {
        window.turnstile = {
          render: (container, options) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'cf-turnstile-response';
            input.value = 'staging-turnstile-token';
            container.appendChild(input);
            if (typeof options === 'object' && typeof options.callback === 'function') {
              setTimeout(() => options.callback('staging-turnstile-token'), 50);
            }
            return 'staging_turnstile_widget_2';
          },
          reset: () => {},
          remove: () => {},
          getResponse: () => 'staging-turnstile-token'
        };
      });

      const page = await context.newPage();
      page.on('console', msg => console.log('   [Browser Log Step 2]', msg.text()));
      page.on('response', res => {
        if (res.url().includes('/api/auth/')) {
          console.log(`   [Auth Response Step 2] ${res.url()} -> ${res.status()}`);
        }
      });

      // Reset last_totp_timestamp to allow fresh MFA challenge in new session
      db.prepare('UPDATE users SET last_totp_timestamp = NULL WHERE id = 1').run();

      // Login Admin 1
      await page.goto(`${baseUrl}/admin/login`);
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#username').fill('lead');
      await page.locator('#password').fill('Password123!');
      await page.locator('button[type="submit"]').first().click();

      const totpInput = page.locator('#totpCode');
      await totpInput.waitFor({ state: 'visible', timeout: 8000 });
      await totpInput.fill(generateTotpCode(rawTotpSecret));
      await page.getByRole('button', { name: /Verify & Continue/i }).click();
      await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 10000 });

      // Navigate to Course Maker in builder mode
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');

      // Author a new workshop draft
      const nameInput = page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first();
      await nameInput.waitFor({ state: 'visible', timeout: 8000 });
      await nameInput.fill('Staging Cinematography Lighting Lab 2026');

      const descInput = page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first();
      await descInput.waitFor({ state: 'visible', timeout: 5000 });
      await descInput.fill('Hands-on three-point lighting masterclass authored before session revocation');

      const phaseTitleInput = page.locator('input[placeholder*="Module"]').or(page.locator('input[placeholder*="Phase"]')).first();
      if (await phaseTitleInput.isVisible()) {
        await phaseTitleInput.fill('Phase 1: Key, Fill, and Backlight Controls');
      }

      // Simulate external session revocation (e.g. administrator revoked session or token reuse detected)
      console.log('   [Revocation] Simulating server-side session revocation in SQLite...');
      db.prepare('DELETE FROM sessions WHERE user_id = 1').run();
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = 1').run();

      // Wait 3.5s for access token to expire so the next action triggers /refresh -> 401 session revocation
      await new Promise(r => setTimeout(r, 3500));

      // Click "Save as Draft" while session is revoked
      console.log('   [Action] User clicks Save as Draft with revoked session...');
      const saveDraftBtn = page.getByRole('button', { name: /Save as Draft/i }).first();
      await saveDraftBtn.click();

      // Assert redirection to /admin/login?session_expired=true
      await page.waitForURL(url => url.pathname.includes('/admin/login'), { timeout: 8000 });
      assert.ok(page.url().includes('session_expired=true'), 'User must be redirected to login with session_expired=true');

      // Assert draft was preserved in localStorage
      const preservedDraft = await page.evaluate(() => localStorage.getItem('bfi_course_maker_unsaved_draft_1'));
      assert.ok(preservedDraft, 'Draft must be preserved under bfi_course_maker_unsaved_draft_1');
      const draftObj = JSON.parse(preservedDraft);
      const draftTitle = draftObj.form?.name || draftObj.name;
      const draftDesc = draftObj.form?.description || draftObj.description;
      assert.strictEqual(draftTitle, 'Staging Cinematography Lighting Lab 2026', 'Preserved draft title must match');
      assert.strictEqual(draftDesc, 'Hands-on three-point lighting masterclass authored before session revocation', 'Preserved draft description must match');
      console.log('   [Preservation] Complete workshop draft preserved in localStorage successfully.');

      // ── Isolation Check: Admin 2 logs in -> must NOT see Admin 1 draft ──
      console.log('   [Isolation] Admin 2 logs in to verify cross-account isolation...');
      await page.locator('#username').fill('guest');
      await page.locator('#password').fill('Password123!');
      await page.locator('button[type="submit"]').first().click();
      await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 10000 });

      // Admin 2 opens Course Maker: must see empty form
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');
      const admin2Title = await page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first().inputValue();
      assert.strictEqual(admin2Title, '', 'Admin 2 must see an empty form (no cross-account leakage)');
      console.log('   [Isolation] Cross-account draft isolation verified: Admin 2 sees clean empty form.');

      // ── Recovery Check: Admin 1 logs back in -> draft 100% restored ──
      console.log('   [Recovery] Admin 1 logs back in to restore preserved draft...');
      await page.evaluate(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      });
      db.prepare('UPDATE users SET last_totp_timestamp = NULL WHERE id = 1').run();
      await page.goto(`${baseUrl}/admin/login`);
      await page.locator('#username').fill('lead');
      await page.locator('#password').fill('Password123!');
      await page.locator('button[type="submit"]').first().click();

      const mfaInput = page.locator('#totpCode');
      await mfaInput.waitFor({ state: 'visible', timeout: 8000 });
      await mfaInput.fill(generateTotpCode(rawTotpSecret));
      await page.getByRole('button', { name: /Verify & Continue/i }).click();
      await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 10000 });

      // Navigate to Course Maker to inspect restored draft
      await page.goto(`${baseUrl}/admin/course-maker?mode=builder`);
      await page.waitForLoadState('domcontentloaded');

      const restoredTitle = await page.locator('input[placeholder*="Masterclass"]').or(page.locator('input[placeholder*="Directing"]')).or(page.locator('input[name="name"]')).first().inputValue();
      const restoredDesc = await page.locator('textarea.cm-textarea').or(page.locator('textarea[placeholder*="summary of skills"]')).first().inputValue();

      assert.strictEqual(restoredTitle, 'Staging Cinematography Lighting Lab 2026', 'Recovered workshop title must match');
      assert.strictEqual(restoredDesc, 'Hands-on three-point lighting masterclass authored before session revocation', 'Recovered workshop description must match');

      // Click "Save as Draft" to persist the recovered workshop
      const recoverSaveBtn = page.getByRole('button', { name: /Save as Draft/i }).first();
      await recoverSaveBtn.click();
      await page.waitForTimeout(500);

      const savedDb = db.prepare('SELECT * FROM course_definitions WHERE name = ?').get('Staging Cinematography Lighting Lab 2026');
      assert.ok(savedDb, 'Recovered workshop must be successfully saved into SQLite');
      assert.strictEqual(savedDb.status, 'draft', 'Course definition status must be draft');
      console.log('   [Recovery] 100% of draft content restored and saved successfully into SQLite.');

      await context.close();
    });

    console.log('\n================================================================');
    console.log(`STAGING VERIFICATION COMPLETE: ${passedTests} / ${totalTests} PASSED (100%)`);
    console.log('================================================================');

  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    cleanupDbFiles();
  }
}

main().catch(err => {
  console.error('\nFatal staging test error:', err);
  process.exit(1);
});
