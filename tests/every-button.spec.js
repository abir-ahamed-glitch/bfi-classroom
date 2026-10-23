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
      // Stub native browser dialogs/print/popups so they never block headless execution
      window.print = () => {};
      window.confirm = () => false;
      window.alert = () => {};
      window.open = () => ({
        document: { write: () => {}, close: () => {} },
        focus: () => {},
        print: () => {},
        close: () => {},
      });
    },
    { t: token, u: userPayload }
  );
}

/**
 * Intercepts any destructive or mutating API requests (DELETE, PUT, PATCH, POST)
 * except safe read-only POST endpoints so that clicking every button in the app
 * never deletes or corrupts any database records.
 */
async function enableSafeMutationGuard(page) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return route.continue();
    }

    // Allow read-only POST endpoints
    if (method === 'POST' && url.includes('/resolve-audience')) {
      return route.continue();
    }

    // Safely mock all other POST/PUT/PATCH/DELETE mutations during button sweep
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Simulated safe response (mutation guard active)',
        broadcast: { id: 999999, status: 'draft' },
      }),
    });
  });
}

async function closeAnyOpenModalsOrDrawersFast(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const closeSelectors = [
      '.bfi-modal-btn-cancel',
      '.bfi-modal-close',
      '.bc-modal .bc-icon-btn',
      '.analytics-drawer.active .analytics-drawer-close',
      '.modal-overlay .close-btn',
      '[aria-label="Close"]',
    ];
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el && typeof el.click === 'function') {
        el.click();
      }
    }
    document.querySelectorAll('.modal-overlay button, [role="dialog"] button, .bfi-modal button').forEach((btn) => {
      const txt = (btn.innerText || '').trim().toLowerCase();
      if (txt === 'cancel' || txt === 'close') {
        btn.click();
      }
    });
  }).catch(() => {});
}

async function testAllButtonsOnRoute(page, routePath, routeLabel, report) {
  const routeResult = {
    route: routeLabel,
    path: routePath,
    buttonsClicked: 0,
    totalButtonsFound: 0,
    uniqueButtonLabels: [],
    errors: [],
  };
  report.push(routeResult);

  let activeButtonLabel = 'Page Load';

  const onPageError = (err) => {
    routeResult.errors.push({
      button: activeButtonLabel,
      type: 'pageerror',
      message: err.message || String(err),
    });
  };

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      routeResult.errors.push({
        button: activeButtonLabel,
        type: 'console.error',
        message: msg.text(),
      });
    }
  };

  const onResponse = async (res) => {
    if (res.status() >= 400) {
      routeResult.errors.push({
        button: activeButtonLabel,
        type: 'http_error',
        status: res.status(),
        method: res.request().method(),
        url: res.url().replace('http://localhost:5174', ''),
      });
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  try {
    await page.goto(routePath, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    // Tag all unique visible buttons in the DOM in a single fast evaluation
    const taggedInfo = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('main button, .desktop-only-header button, main [role="button"]')
      );
      const seenPatterns = new Set();
      const tagged = [];

      nodes.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        if (!visible || disabled) return;

        const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const title = el.getAttribute('title') || '';
        const aria = el.getAttribute('aria-label') || '';
        const label = text || title || aria || `btn-${idx}`;

        if (/log\s*out|sign\s*out|back to/i.test(label)) return;

        const cls = (typeof el.className === 'string' ? el.className : '').trim();
        const normalizedLabel = label.replace(/\d+/g, '#');
        const sig = `${cls}::${normalizedLabel}`;
        if (seenPatterns.has(sig)) return;
        seenPatterns.add(sig);

        const pwId = `pw-btn-${idx}`;
        el.setAttribute('data-pw-btn-id', pwId);
        tagged.push({ pwId, label });
      });

      return { totalCount: nodes.length, tagged };
    });

    routeResult.totalButtonsFound = taggedInfo.totalCount;

    for (const item of taggedInfo.tagged) {
      // Check if previous click navigated away
      const currentUrl = page.url();
      const targetPathname = routePath.split('?')[0];
      if (!currentUrl.includes(targetPathname)) {
        await page.goto(routePath, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      }

      const loc = page.locator(`[data-pw-btn-id="${item.pwId}"]`);
      if ((await loc.count()) === 0) continue;

      activeButtonLabel = item.label;
      try {
        await loc.first().click({ timeout: 1200, force: true });
        routeResult.buttonsClicked++;
        routeResult.uniqueButtonLabels.push(item.label);
        await page.waitForTimeout(80);

        const hasErrorBoundary = await page.evaluate(() => {
          const txt = document.body?.innerText || '';
          return (
            txt.includes('Something went wrong') ||
            txt.includes('Unexpected Application Error') ||
            txt.includes('Component Stack')
          );
        }).catch(() => false);

        if (hasErrorBoundary) {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          routeResult.errors.push({
            button: activeButtonLabel,
            type: 'ErrorBoundary',
            message: bodyText.slice(0, 300),
          });
          await page.goto(routePath, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(800);
        }

        await closeAnyOpenModalsOrDrawersFast(page);
      } catch {
        await closeAnyOpenModalsOrDrawersFast(page);
      }
    }

    console.log(
      `[BUTTON AUDIT] ${routeLabel}: clicked ${routeResult.buttonsClicked} unique buttons (out of ${routeResult.totalButtonsFound} DOM buttons) | Errors: ${routeResult.errors.length}`
    );
    if (routeResult.errors.length > 0) {
      console.log(`  -> ERRORS on ${routeLabel}:`, JSON.stringify(routeResult.errors));
    }
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
}

test.describe('Every Single Button E2E Audit via Microsoft Playwright', () => {
  test.setTimeout(240000);

  test('1. Admin Role - Click Every Unique Button Across All Admin & Shared Pages', async ({ page }) => {
    await injectAuth(page, 'admin', 'admin@abir');
    await enableSafeMutationGuard(page);

    const report = [];
    const routes = [
      { path: '/bfi-classroom/', label: 'Admin Dashboard' },
      { path: '/bfi-classroom/notices', label: 'NoticeBoard' },
      { path: '/bfi-classroom/inbox', label: 'Inbox' },
      { path: '/bfi-classroom/classroom', label: 'Classroom' },
      { path: '/bfi-classroom/profile', label: 'Admin Profile' },
      { path: '/bfi-classroom/profile/8', label: 'Public Profile (#8)' },
      { path: '/bfi-classroom/portfolio', label: 'Portfolio' },
      { path: '/bfi-classroom/experience', label: 'Experience' },
      { path: '/bfi-classroom/community', label: 'Community' },
      { path: '/bfi-classroom/bfiaa', label: 'BFIAA' },
      { path: '/bfi-classroom/directory', label: 'Directory' },
      { path: '/bfi-classroom/registry', label: 'Registry' },
      { path: '/bfi-classroom/instructors', label: 'InstructorDirectory' },
      { path: '/bfi-classroom/settings', label: 'Settings' },
      { path: '/bfi-classroom/admin/studentsmanager', label: 'Admin StudentManager' },
      { path: '/bfi-classroom/admin/batchmanager', label: 'Admin BatchManager' },
      { path: '/bfi-classroom/admin/batchmanager/43rdbatch', label: 'Admin BatchDetail (43rdbatch)' },
      { path: '/bfi-classroom/admin/batchmanager/53thbatch', label: 'Admin BatchDetail (53thbatch)' },
      { path: '/bfi-classroom/admin/teachers', label: 'Admin TeacherManager' },
      { path: '/bfi-classroom/admin/certificate-designer', label: 'Admin CertificateDesigner' },
      { path: '/bfi-classroom/admin/announcements', label: 'Admin BroadcastManager' },
      { path: '/bfi-classroom/admin/course-materials', label: 'Admin CourseMaterialsManager' },
      { path: '/bfi-classroom/admin/analytics', label: 'Admin Analytics' },
      { path: '/bfi-classroom/admin/reports', label: 'Admin Reports' },
      { path: '/bfi-classroom/admin/additional-options?view=course-settings', label: 'Admin Course Settings' },
      { path: '/bfi-classroom/admin/additional-options?view=batch-fees', label: 'Admin Batch Fees' },
      { path: '/bfi-classroom/admin/additional-options?view=fee-tracker', label: 'Admin Fee Tracker' },
      { path: '/bfi-classroom/admin/additional-options?view=trash', label: 'Admin Trash Manager' },
    ];

    for (const r of routes) {
      await testAllButtonsOnRoute(page, r.path, r.label, report);
    }

    const totalClicked = report.reduce((sum, r) => sum + r.buttonsClicked, 0);
    const totalFound = report.reduce((sum, r) => sum + r.totalButtonsFound, 0);
    const routesWithErrors = report.filter((r) => r.errors.length > 0);

    console.log(`ADMIN TOTAL UNIQUE BUTTONS CLICKED: ${totalClicked} (across ${totalFound} total button instances)`);
    expect(routesWithErrors).toEqual([]);
  });

  test('2. Student Role - Click Every Unique Button Across Student Portal & Pages', async ({ page }) => {
    await injectAuth(page, 'student', 'eathsharajsharon');
    await enableSafeMutationGuard(page);

    const report = [];
    const routes = [
      { path: '/bfi-classroom/', label: 'Student Dashboard' },
      { path: '/bfi-classroom/student-portal', label: 'Student Portal' },
      { path: '/bfi-classroom/certificates', label: 'Student Certificates' },
      { path: '/bfi-classroom/courses', label: 'Student Course Materials' },
      { path: '/bfi-classroom/classroom', label: 'Student Classroom' },
      { path: '/bfi-classroom/portfolio', label: 'Student Portfolio' },
      { path: '/bfi-classroom/experience', label: 'Student Experience' },
      { path: '/bfi-classroom/community', label: 'Student Community' },
      { path: '/bfi-classroom/bfiaa', label: 'Student BFIAA' },
      { path: '/bfi-classroom/settings', label: 'Student Settings' },
    ];

    for (const r of routes) {
      await testAllButtonsOnRoute(page, r.path, r.label, report);
    }

    const totalClicked = report.reduce((sum, r) => sum + r.buttonsClicked, 0);
    const totalFound = report.reduce((sum, r) => sum + r.totalButtonsFound, 0);
    const routesWithErrors = report.filter((r) => r.errors.length > 0);

    console.log(`STUDENT TOTAL UNIQUE BUTTONS CLICKED: ${totalClicked} (across ${totalFound} total button instances)`);
    expect(routesWithErrors).toEqual([]);
  });

  test('3. Instructor Role - Click Every Unique Button Across Instructor Pages', async ({ page }) => {
    await injectAuth(page, 'instructor', 'syedshababaliarzoo');
    await enableSafeMutationGuard(page);

    const report = [];
    const routes = [
      { path: '/bfi-classroom/', label: 'Instructor Dashboard' },
      { path: '/bfi-classroom/courses', label: 'Instructor Course Materials' },
      { path: '/bfi-classroom/classroom', label: 'Instructor Classroom' },
      { path: '/bfi-classroom/admin/announcements', label: 'Instructor BroadcastManager' },
      { path: '/bfi-classroom/settings', label: 'Instructor Settings' },
    ];

    for (const r of routes) {
      await testAllButtonsOnRoute(page, r.path, r.label, report);
    }

    const totalClicked = report.reduce((sum, r) => sum + r.buttonsClicked, 0);
    const totalFound = report.reduce((sum, r) => sum + r.totalButtonsFound, 0);
    const routesWithErrors = report.filter((r) => r.errors.length > 0);

    console.log(`INSTRUCTOR TOTAL UNIQUE BUTTONS CLICKED: ${totalClicked} (across ${totalFound} total button instances)`);
    expect(routesWithErrors).toEqual([]);
  });
});
