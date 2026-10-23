import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = path.resolve('server/bfi_classroom.db');
const db = new Database(dbPath);
const JWT_SECRET = process.env.JWT_SECRET;

function getTokenAndUser(role, preferredUsername) {
  let user = preferredUsername
    ? db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(preferredUsername)
    : null;
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE role = ? AND is_active = 1 LIMIT 1').get(role);
  }
  if (!user) throw new Error(`No active user found for role: ${role}`);

  let profile = null;
  if (user.role === 'student') {
    profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: `${user.first_name} ${user.last_name}` },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const userPayload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    profilePicture: user.profile_picture,
    profile_picture: user.profile_picture,
    publicKey: user.public_key,
    batch: profile?.batch_number,
    studentId: profile?.student_id,
  };

  return { token, userPayload };
}

async function injectAuth(page, role, preferredUsername) {
  const { token, userPayload } = getTokenAndUser(role, preferredUsername);
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user_cache', JSON.stringify(u));
    },
    { t: token, u: userPayload }
  );
}

function attachErrorCollector(page, findings, label) {
  const entry = { route: label, pageErrors: [], consoleErrors: [], apiErrors: [], errorBoundary: false };
  findings.push(entry);

  const onPageError = (err) => entry.pageErrors.push(err.message || String(err));
  const onConsole = (msg) => {
    if (msg.type() === 'error') entry.consoleErrors.push(msg.text());
  };
  const onResponse = (res) => {
    if (res.status() >= 400) {
      entry.apiErrors.push({
        status: res.status(),
        method: res.request().method(),
        url: res.url().replace('http://localhost:5174', ''),
      });
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  return async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('Something went wrong') || bodyText.includes('Unexpected Application Error')) {
      entry.errorBoundary = true;
    }
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  };
}

test.describe('Specialized Suite 1: Mobile (375x812) & Tablet (768x1024) Responsive Viewport Audit', () => {
  test.setTimeout(180000);

  test('1. Mobile Viewport (375x812) - Bottom Nav, Hamburger Drawer, Theme Toggle & Mobile Inbox', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectAuth(page, 'student', 'eathsharajsharon');

    const findings = [];
    const detach = attachErrorCollector(page, findings, 'Mobile Navigation & Drawer Interactive Flow');

    await page.goto('/bfi-classroom/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    // Verify mobile bottom nav and mobile header bar are visible at 375x812
    const mobileHeader = page.locator('.mobile-header-bar');
    const bottomNav = page.locator('nav.mobile-bottom-nav');
    await expect(mobileHeader).toBeVisible();
    await expect(bottomNav).toBeVisible();

    // Test Notifications bottom nav button
    const notifBtn = bottomNav.locator('button:has-text("Notifications")');
    await notifBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator('.notification-panel')).toBeVisible();
    // Close notification panel
    await page.locator('.notification-panel .close-panel-btn').click();
    await page.waitForTimeout(400);

    // Test Menu bottom nav button -> opens sidebar drawer and hides bottom nav
    const menuBtn = bottomNav.locator('button:has-text("Menu")');
    await menuBtn.click();
    await page.waitForTimeout(500);
    const sidebar = page.locator('aside.sidebar.open');
    await expect(sidebar).toBeVisible();
    await expect(bottomNav).toHaveClass(/bottom-nav-hidden/);

    // Toggle Dark/Light Mode inside mobile sidebar drawer
    const themeToggleBtn = sidebar.locator('.theme-toggle-btn');
    if (await themeToggleBtn.isVisible()) {
      await themeToggleBtn.click();
      await page.waitForTimeout(300);
      await themeToggleBtn.click();
      await page.waitForTimeout(300);
    }

    // Close sidebar drawer by clicking backdrop on the exposed right strip (x: 350)
    const backdrop = page.locator('.sidebar-backdrop');
    await expect(backdrop).toBeVisible();
    await backdrop.click({ position: { x: 350, y: 200 } });
    await page.waitForTimeout(400);
    await expect(sidebar).toBeHidden();

    // Re-open Menu and close via the mobile drawer Close (X) button
    await menuBtn.click();
    await page.waitForTimeout(400);
    await expect(sidebar).toBeVisible();
    await sidebar.locator('.mobile-sidebar-close-btn').click();
    await page.waitForTimeout(400);
    await expect(sidebar).toBeHidden();

    // Test Profile & Inbox bottom nav links
    await bottomNav.locator('a:has-text("Profile")').click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/profile');

    await bottomNav.locator('a:has-text("Inbox")').click();
    await page.waitForTimeout(1400);
    expect(page.url()).toContain('/inbox');

    await detach();

    const problems = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundary
    );
    console.log('MOBILE INTERACTIVE NAV FINDINGS:', JSON.stringify(problems, null, 2));
    expect(problems).toEqual([]);
  });

  test('2. Mobile Viewport (375x812) - Full Admin & Student Pages Responsive Audit', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectAuth(page, 'admin', 'admin@abir');

    const findings = [];
    const mobileAdminRoutes = [
      '/bfi-classroom/',
      '/bfi-classroom/notices',
      '/bfi-classroom/inbox',
      '/bfi-classroom/classroom',
      '/bfi-classroom/community',
      '/bfi-classroom/directory',
      '/bfi-classroom/registry',
      '/bfi-classroom/settings',
      '/bfi-classroom/admin/studentsmanager',
      '/bfi-classroom/admin/batchmanager',
      '/bfi-classroom/admin/batchmanager/53thbatch',
      '/bfi-classroom/admin/teachers',
      '/bfi-classroom/admin/announcements',
      '/bfi-classroom/admin/analytics',
      '/bfi-classroom/admin/reports',
      '/bfi-classroom/admin/additional-options?view=course-settings',
      '/bfi-classroom/admin/additional-options?view=batch-fees',
      '/bfi-classroom/admin/additional-options?view=fee-tracker',
      '/bfi-classroom/admin/additional-options?view=trash',
    ];

    for (const route of mobileAdminRoutes) {
      const detach = attachErrorCollector(page, findings, `Mobile 375x812: ${route}`);
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await detach();
    }

    const problems = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundary
    );
    console.log('MOBILE ADMIN ROUTES FINDINGS:', JSON.stringify(problems, null, 2));
    expect(problems).toEqual([]);
  });

  test('3. Tablet Viewport (768x1024) - Responsive Layout & Navigation Audit', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await injectAuth(page, 'admin', 'admin@abir');

    const findings = [];
    const tabletRoutes = [
      '/bfi-classroom/',
      '/bfi-classroom/inbox',
      '/bfi-classroom/community',
      '/bfi-classroom/admin/studentsmanager',
      '/bfi-classroom/admin/batchmanager/53thbatch',
      '/bfi-classroom/admin/analytics',
      '/bfi-classroom/admin/announcements',
      '/bfi-classroom/admin/certificate-designer',
    ];

    for (const route of tabletRoutes) {
      const detach = attachErrorCollector(page, findings, `Tablet 768x1024: ${route}`);
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await detach();
    }

    const problems = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundary
    );
    console.log('TABLET ROUTES FINDINGS:', JSON.stringify(problems, null, 2));
    expect(problems).toEqual([]);
  });
});
